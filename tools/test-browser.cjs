// Set PLAYWRIGHT_MODULE to a playwright-core installation. Pass a site URL
// and one of edge, nogpu, webgl or webkit. EDGE_PATH overrides the executable.
const assert = require("node:assert/strict");
const path = require("node:path");
const {chromium, webkit, firefox} = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const [url, mode="edge"] = process.argv.slice(2);
if (!url) throw Error("Supply the test site URL");
const flags = mode==="nogpu" ? ["--disable-gpu","--disable-webgl"] : [];
const sleep = ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run() {
  const browser = mode==="webkit" ? await webkit.launch() : mode==="firefox" ? await firefox.launch() :
    await chromium.launch({executablePath:process.env.EDGE_PATH || path.join(process.env["ProgramFiles(x86)"],"Microsoft/Edge/Application/msedge.exe"),args:flags});
  try {
    const page = await browser.newPage({viewport:{width:1200,height:820}});
    const errors=[];
    page.on("pageerror", e=>errors.push(e.message));
    await page.addInitScript(mode=>{
      window.paintCount=0;
      for (const [proto,method] of [[window.CanvasRenderingContext2D?.prototype,"putImageData"],[window.WebGLRenderingContext?.prototype,"drawArrays"],[window.WebGLRenderingContext?.prototype,"drawElements"]]) {
        if (!proto) continue;
        const original=proto[method];
        proto[method]=function(...args){window.paintCount++; return original.apply(this,args);};
      }
      if (mode==="webgl") {
        // Exercise the WebGL code path on runners with a software GL adapter.
        const get=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,attrs){
          if (attrs?.failIfMajorPerformanceCaveat) attrs={...attrs,failIfMajorPerformanceCaveat:false};
          return get.call(this,type,attrs);
        };
      }
    },mode);
    await page.goto(url);
    await page.waitForFunction(()=>window.paintCount>0 || !document.getElementById("recovery").hidden,null,{timeout:180000});
    assert(await page.locator("#recovery").isHidden());
    // Sample screenshots outside the game context to also check WebGL frames
    // whose drawing buffers have already been cleared after presentation.
    const png = require(path.join(path.dirname(require.resolve(process.env.PLAYWRIGHT_MODULE || "playwright-core")),"lib/utilsBundle.js")).PNG;
    async function sample() {
      const image=png.sync.read(await page.locator("#canvas").screenshot());
      const at=(x,y)=>{
        const i=(Math.floor(y*image.height/600)*image.width+Math.floor(x*image.width/800))*4;
        return image.data.subarray(i,i+3);
      };
      let green=0;
      for(let y=40;y<445;y+=8) for(let x=0;x<800;x+=8){
        const [r,g,b]=at(x,y); if(g>35 && g>r*1.4 && g>b*1.4) green++;
      }
      return {at,green};
    }
    async function until(name, predicate,timeout=90000) {
      const end=Date.now()+timeout;
      do { if(predicate(await sample())) { console.log("PASS",name); return; } await sleep(500); } while(Date.now()<end);
      await page.screenshot({path:require("node:path").join(require("node:os").tmpdir(),"pt-failed-"+mode+".png")});
      console.log(await page.locator("#canvas").evaluate(c=>[document.fullscreenElement?.id,c.getBoundingClientRect().toJSON(),c.width,c.height]));
      throw Error("Timed out waiting for "+name);
    }
    async function click(x,y) {
      const rect=await page.locator("#canvas").boundingBox();
      await page.mouse.move(rect.x+rect.width*x/800,rect.y+rect.height*y/600,{steps:4});
      await sleep(180); await page.mouse.down(); await sleep(220); await page.mouse.up();
    }
    await until("Deluxe start screen",s=>s.at(552,503)[1]>80 && s.at(552,503)[2]>80);
    console.log("Renderer",await page.evaluate(()=>Module.ctx?.constructor.name || Module.canvas.GLctxObject?.GLctx?.constructor.name));
    await page.locator("#fullscreen").click();
    await page.waitForFunction(()=>document.fullscreenElement || document.querySelector(".expanded"));
    async function checkAspect() {
      const dims=await page.locator("#canvas").evaluate(c=>[c.width,c.height,c.clientWidth,c.clientHeight]);
      assert.deepEqual(dims.slice(0,2),[800,600]);
      assert(Math.abs(dims[2]/dims[3]-4/3)<0.01);
    }
    await checkAspect();
    // Wait for the original fade-in to enable the Start Game button.
    await sleep(2200);
    await click(635,525);
    await sleep(1800);
    if ((await sample()).at(552,503)[2]>80) await click(635,525);
    await until("Start Game click in scaled fullscreen",s=>s.at(520,577)[0]>65 && s.at(520,577)[1]>65 && s.at(520,577)[2]>65);
    await click(590,580);
    await until("Game mode menu",s=>s.at(20,420)[2]>70);
    await sleep(1800);
    await click(400,262);
    await until("Target Practice terrain",s=>s.green>220);
    await page.locator("#fullscreen").click();
    await page.waitForFunction(()=>!document.fullscreenElement && !document.querySelector(".expanded"));
    await checkAspect();
    await page.setViewportSize({width:390,height:750}); await checkAspect();
    await page.setViewportSize({width:1200,height:820});
    await page.locator("#showConsole").check(); assert(await page.locator("#output").isVisible());
    await page.locator("#showConsole").uncheck(); assert(!await page.locator("#output").isVisible());
    const start=await sample();
    const before=await page.evaluate(()=>[performance.now(),window.paintCount]);
    await click(405,493);
    await until("Shot changes the terrain",s=>Math.abs(s.green-start.green)>=2);
    await sleep(1500);
    const after=await page.evaluate(()=>[performance.now(),window.paintCount]);
    console.log("Paint calls during shot per second",((after[1]-before[1])*1000/(after[0]-before[0])).toFixed(1));
    await page.locator("#fullscreen").click(); await checkAspect();
    await page.evaluate(()=>document.fullscreenElement && document.exitFullscreen());
    await page.waitForFunction(()=>document.getElementById("fullscreen").textContent==="Fullscreen");
    if (mode==="webgl") {
      const lost=await page.evaluate(()=>{
        const gl=Module.canvas.GLctxObject?.GLctx || Module.ctx;
        const ext=gl.getExtension("WEBGL_lose_context");
        if (!ext) return false;
        ext.loseContext();
        return true;
      });
      assert(lost);
      await page.locator("#recovery").waitFor();
      assert((await page.locator("#recovery").getAttribute("href")).includes("display=software"));
      await page.locator("#recovery").click();
      await page.waitForFunction(()=>Module.SDL2?.image?.width===800,null,{timeout:180000});
      console.log("PASS real context loss and restart using Canvas 2D");
    }
    const output=await page.locator("#output").inputValue();
    console.log("Audio initialization",output.includes("openAudio:"));
    assert.deepEqual(errors,[]);
    console.log("PASS fullscreen round trips, 4:3 viewport, 390px layout, log toggle, no uncaught page errors");
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
