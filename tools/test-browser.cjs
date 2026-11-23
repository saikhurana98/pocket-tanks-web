// Set PLAYWRIGHT_MODULE to a playwright-core installation. Pass a site URL
// and one of edge, nogpu, webgl, touch, audio, firefox or webkit. EDGE_PATH overrides the executable.
const assert = require("node:assert/strict");
const {attachMeter} = require('./audio-meter.cjs');
const path = require("node:path");
const {chromium, webkit, firefox} = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const [url, mode="edge"] = process.argv.slice(2);
if (!url) throw Error("Supply the test site URL");
const flags = ["nogpu","touch"].includes(mode) ? ["--disable-gpu","--disable-webgl"] : [];
const sleep = ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run() {
  const browser = mode==="webkit" ? await webkit.launch() : mode==="firefox" ? await firefox.launch() :
    await chromium.launch({executablePath:process.env.EDGE_PATH || path.join(process.env["ProgramFiles(x86)"],"Microsoft/Edge/Application/msedge.exe"),args:flags});
  try {
    const page = await browser.newPage(mode==="touch" ? {viewport:{width:390,height:750},isMobile:true,hasTouch:true} : {viewport:{width:1200,height:820}});
    const errors=[];
    page.on("pageerror", e=>errors.push(e.message));
    page.on("console", m => { if (/^(Game audio load failed|Music playback failed|Using Wine audio)/.test(m.text())) errors.push(m.text()); });
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
      const tx=rect.x+rect.width*x/800, ty=rect.y+rect.height*y/600;
      if (mode==="touch") {
        const cdp=await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:tx,y:ty}]});
        await sleep(240);
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
        await cdp.detach();
        return;
      }
      await page.mouse.move(tx,ty,{steps:4});
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
    if (mode === "audio") {
      await attachMeter(page, false);
      await sleep(1500);
      for (const stressed of [false, true]) {
        await page.evaluate(() => window.readAudioMeter());
        if (stressed) await page.evaluate(() => {
          window.audioLoad = setInterval(() => {
            const end = performance.now() + 70;
            while (performance.now() < end) {}
          }, 420);
        });
        await sleep(10000);
        const m = await page.evaluate(() => { clearInterval(window.audioLoad); return window.readAudioMeter(); });
        console.log(stressed ? "Title with 70 ms main-thread stalls" : "Title", m);
        assert(m.frames >= 9*m.rate && m.active > .98*m.frames && m.silentFrames < .06*m.rate,
          "title music must remain continuous");
      }
      await page.evaluate(() => window.closeAudioMeter());
    }
    await click(590,580);
    await until("Game mode menu",s=>s.at(20,420)[2]>70);
    await sleep(1800);
    await click(400,262);
    await until("Target Practice terrain",s=>s.green>220);
    if (mode === "audio") {
      await attachMeter(page, false);
      await sleep(1200);
      await page.evaluate(() => window.readAudioMeter());
      await sleep(7000);
      const m = await page.evaluate(() => window.readAudioMeter());
      console.log("Target Practice soundtrack", m);
      assert(m.frames >= 6*m.rate && m.active > .98*m.frames, "in-game music must remain continuous");
      await page.evaluate(() => window.closeAudioMeter());
    }
    await page.locator("#fullscreen").click();
    await page.waitForFunction(()=>!document.fullscreenElement && !document.querySelector(".expanded"));
    await checkAspect();
    await page.setViewportSize({width:390,height:750}); await checkAspect();
    await page.setViewportSize({width:1200,height:820});
    await page.locator("#showConsole").check(); assert(await page.locator("#output").isVisible());
    await page.locator("#showConsole").uncheck(); assert(!await page.locator("#output").isVisible());
    const checkEffects = mode === "touch" || mode === "audio";
    if (checkEffects) {
      await attachMeter(page, true);
      await page.evaluate(() => window.readAudioMeter());
    }
    const start=await sample();
    const before=await page.evaluate(()=>[performance.now(),window.paintCount]);
    await click(405,493);
    await until("Shot changes the terrain",s=>Math.abs(s.green-start.green)>=2);
    await sleep(1500);
    if (checkEffects) {
      const measured = await page.evaluate(() => window.readAudioMeter());
      console.log("Shot sound effects", measured);
      assert(measured.active > .05 * measured.rate, "weapon effects must be audible independently of music");
      await page.evaluate(() => window.closeAudioMeter());
    }
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
    console.log("Browser audio", await page.evaluate(() => gameAudio.context?.state || "unavailable"));
    assert.deepEqual(errors,[]);
    console.log("PASS fullscreen round trips, 4:3 viewport, 390px layout, log toggle, no uncaught page errors");
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
