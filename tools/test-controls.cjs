const assert = require("node:assert/strict");

// Compare the game's own numeric readouts after stepping the original arrow
// buttons and after dragging the same distance. This works on both renderers.
module.exports = async function testControls(page, click, touch) {
  const wait = ms => page.waitForTimeout(ms);
  await page.evaluate(() => {
    window.observedCommits=0;
    window.centerWarps=0;
    const warp=Module.onGuestMouseWarp;
    Module.onGuestMouseWarp=(x,y)=>{
      warp(x,y);
      if(x===400&&y===225)window.centerWarps++;
      if(y>=450)window.observedCommits++;
    };
    const present = window.presentPocketTanks;
    window.presentPocketTanks = (pixels,w,h) => {
      present(pixels,w,h);
      if (w !== 800 || h !== 600) return;
      const value = y => {
        let hash = 0, yellow = false;
        for (let j=y;j<y+20;j++) for (let x=502;x<544;x++) {
          const i = (j*w+x)*4;
          if (pixels[i]>50 && pixels[i]===pixels[i+1] && pixels[i+2]<8) yellow=true;
          hash = (Math.imul(hash,31) + (pixels[i]>160 ? 1 : 0)) | 0;
        }
        return [hash,yellow];
      };
      window.originalHud = {angle:value(497),power:value(564)};
    };
  });
  await page.waitForFunction(()=>window.originalHud);
  const read = field => page.evaluate(field=>window.originalHud[field],field);
  async function park(){
    await wait(130);
    const r=await page.locator("#canvas").boundingBox();
    await page.mouse.move(r.x+r.width*.85,r.y+r.height*.72);
    await wait(150);
  }
  async function committed(action){
    const n=await page.evaluate(()=>window.observedCommits);
    await action();
    await page.waitForFunction(n=>window.observedCommits>n,n,{timeout:4500});
    // The original places its painted cursor back on the control. Move it
    // clear of the digits before comparing them with the arrow-button result.
    await park();
  }
  async function drag(x,y,logicalDistance) {
    const r=await page.locator("#canvas").boundingBox();
    const xx=r.x+x*r.width/800, yy=r.y+y*r.height/600, dx=logicalDistance*r.width/800;
    if (touch) {
      const cdp=await page.context().newCDPSession(page);
      try {
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:xx,y:yy}]});
        await wait(100);
        for(let i=1;i<=8;i++){
          await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:xx+dx*i/8,y:yy}]});
          await wait(12);
        }
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      } finally { await cdp.detach(); }
    } else {
      await page.mouse.move(xx,yy);await page.mouse.down();await wait(100);
      await page.mouse.move(xx+dx,yy,{steps:8});await page.mouse.up();
    }
  }
  for (const [field,y,headerY] of [["power",574,548],["angle",506,482]]) {
    await park();
    const initial=(await read(field))[0], stepped=[];
    for(let i=0;i<3;i++){await click(552,y);await park();stepped.push((await read(field))[0]);}
    assert.equal(new Set([initial,...stepped]).size,4,field+" arrow increments");
    for(let i=0;i<3;i++){await click(493,y);await wait(120);}
    await park();assert.equal((await read(field))[0],initial,field+" restored");
    await committed(()=>drag(521,headerY,12.5));
    await page.waitForFunction(({field,expected})=>{
      const [n,armed]=window.originalHud[field];return !armed && n===expected;
    },{field,expected:stepped[2]},{timeout:4500});
    console.log("PASS",field,"12.5 logical pixels match three original button steps");
    await wait(250);
    assert.equal((await read(field))[0],stepped[2],field+" drifted on release");
    for(let i=0;i<3;i++){await click(493,y);await wait(120);}
    await park();
    assert.equal((await read(field))[0],initial,field+" drag restored");
    if(!touch){
      const r=await page.locator("#canvas").boundingBox();
      await page.mouse.move(r.x+521*r.width/800,r.y+headerY*r.height/600);
      const delta=field==="power"?-100:100;
      await committed(async()=>{
        for(let packet=0;packet<4;packet++)await page.mouse.wheel(0,delta/4);
      });
      await page.waitForFunction(({field,expected})=>{
        const [n,armed]=window.originalHud[field];return !armed && n===expected;
      },{field,expected:stepped[0]},{timeout:4500});
      await wait(220);
      await page.mouse.move(r.x+521*r.width/800,r.y+headerY*r.height/600);
      await committed(()=>page.mouse.wheel(0,-delta));
      await page.waitForFunction(({field,expected})=>{
        const [n,armed]=window.originalHud[field];return !armed && n===expected;
      },{field,expected:initial},{timeout:4500});
      await wait(220);console.log("PASS",field,"wheel steps in both directions");
      await committed(async()=>{
        const previous=await page.evaluate(()=>window.centerWarps);
        await click(521,headerY);
        await page.waitForFunction(n=>window.centerWarps>n,previous,{timeout:4500});
        await page.mouse.move(r.x+525.2*r.width/800,r.y+(headerY+15)*r.height/600);
        await wait(350);
        await page.mouse.down();await page.mouse.up();
      });
      assert.equal((await read(field))[0],stepped[0],field+" click, adjust, click to commit");
      await click(493,y);await park();
    }
  }
};
