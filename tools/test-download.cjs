// Usage: node tools/test-download.cjs <site URL> <original, extracted game directory>
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const crypto=require("node:crypto");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const [url,source]=process.argv.slice(2);
async function main(){
 const b=await chromium.launch({executablePath:process.env.EDGE_PATH || path.join(process.env["ProgramFiles(x86)"],"Microsoft/Edge/Application/msedge.exe")});
 try{
  const p=await b.newPage();
  // Test just the loader, before the game can change its own files.
  await p.route("**/boxedwine.js",route=>route.fulfill({contentType:"text/javascript",body:""}));
  await p.goto(url);
  const result=await p.evaluate(async()=>{
    const nativeFetch=window.fetch;
    let release,paused=false;
    const gate=new Promise(r=>release=r);
    window.fetch=async(...args)=>{
      const resp=await nativeFetch(...args);
      if(!String(args[0]).endsWith(".bin")) return resp;
      let received=0;
      return new Response(resp.body.pipeThrough(new TransformStream({async transform(data,out){
        received+=data.length;
        if(!paused && received>5e6){paused=true;await gate;}
        out.enqueue(data);
      }})));
    };
    const loading=loadGameFiles();
    try{
      const deadline=performance.now()+60000;
      while(!paused || !/[1-9]\d* files ready/.test(document.querySelector("#transfer").textContent)){
        if(performance.now()>deadline) throw Error("No extraction before network completion");
        await new Promise(r=>setTimeout(r,30));
      }
      const partial=document.querySelector("#transfer").textContent;
      release();
      const adapter=await loading;
      await new Promise((resolve,reject)=>adapter.initialize(e=>e?reject(e):resolve()));
      const LocalFS=BrowserFS.BFSRequire("fs").FS;
      const local=new LocalFS();local.initialize(adapter);
      const hashes={};
      async function visit(dir){
        for(const name of local.readdirSync("/"+dir)){
          const file=dir+name;
          if(local.statSync("/"+file).isDirectory()){await visit(file+"/");continue;}
          const data=local.readFileSync("/"+file);
          hashes[file]=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),b=>b.toString(16).padStart(2,"0")).join("");
        }
      }
      await visit("");return {hashes,partial};
    }finally{release();window.fetch=nativeFetch;}
  });
  let checked=0;
  async function visit(dir){
    for(const entry of await fs.readdir(dir,{withFileTypes:true})){
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()){await visit(file);continue;}
      const relative=path.relative(source,file).split(path.sep).join("/");
      assert.equal(result.hashes[relative],crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex"),relative);
      checked++;
    }
  }
  await visit(source);assert.equal(Object.keys(result.hashes).length,checked);
  console.log("PASS all",checked,"restored files match; gated download showed",result.partial);
  for(const failure of ["missing manifest","missing bundle","truncated gzip"]){
    const pattern=failure==="missing manifest"?"**/assets/game.json":"**/assets/*.bin";
    await p.route(pattern,route=>failure==="truncated gzip"?route.fulfill({body:Buffer.from([31,139,8,0])}):route.fulfill({status:404,body:""}));
    await p.evaluate(()=>buildAppFileSystems(()=>{throw Error("Unexpected success")}));
    await p.waitForFunction(()=>!document.querySelector("#recovery").hidden);
    assert.equal(await p.locator("#recovery").textContent(),"Retry");
    await p.unroute(pattern);
    await p.reload();
    console.log("PASS",failure,"shows retry");
  }
  await p.evaluate(()=>{Object.defineProperty(document,"fullscreenEnabled",{value:false,configurable:true})});
  await p.locator("#fullscreen").click();
  assert(await p.locator("#inline.expanded").count());
  await p.keyboard.press("Escape");
  assert.equal(await p.locator("#inline.expanded").count(),0);
  console.log("PASS fallback fullscreen and Escape");
 }finally{await b.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
