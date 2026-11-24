/* The game recenters the guest cursor at (400,225) while one of the yellow
   numeric controls is active. SDL's browser backend cannot warp the OS cursor. */
(() => {
  const canvas = document.getElementById("canvas");
  const loading = document.getElementById("loading");
  let hud = false, mode = "", lastX;
  let gesture, open, pendingX = 0, finish, commit = false;
  let waitingForWarp = false, wheelTimer, scrolling = "";
  let frames = 0, scheduled = false;
  const injected = new WeakSet();

  function mouse(type, x, y, dx = 0, dy = 0) {
    const box = canvas.getBoundingClientRect();
    const event = new MouseEvent(type, {bubbles:true, cancelable:true, button:0,
      buttons:type === "mousedown" ? 1 : 0, clientX:box.left+x*box.width/800,
      clientY:box.top+y*box.height/600, movementX:dx, movementY:dy});
    injected.add(event);
    Module.guestPointer = {x:Math.round(x), y:Math.round(y)};
    try { canvas.dispatchEvent(event); } finally { Module.guestPointer = null; }
  }
  function controlAt(x, y) {
    if (x >= 483 && x < 563 && y >= 466 && y < 495 ||
        x >= 502 && x < 544 && y >= 495 && y < 518) return "angle";
    if (x >= 431 && x < 563 && y >= 531 && y < 561 ||
        x >= 502 && x < 544 && y >= 562 && y < 584) return "power";
    return "";
  }
  function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  // A warp to the center of the playfield acknowledges that the original
  // game consumed the previous mouse position. It also occurs when aiming
  // starts. On exit the game warps back to its controls.
  const centerX=400, centerY=225;
  Module.onGuestMouseWarp=(x,y)=>{
    if (x===centerX && y===centerY && (open || mode)){
      if(open){mode=open.control;open=undefined}
      waitingForWarp=false;
      wake();
    }else if(mode){
      mode="";pendingX=0;waitingForWarp=false;commit=false;scrolling="";
      clearTimeout(wheelTimer);
    }
  };
  function pump() {
    scheduled=false;
    if (open?.release && !open.sent && frames>open.frame && performance.now()-open.time>=35) {
      open.sent=frames;
      mouse("mouseup",open.x,open.y);
      return;
    }
    if(finish){
      if(frames>finish.frame && performance.now()-finish.time>=45){
        finish=null;mouse("mouseup",centerX,centerY);
      }
      return;
    }
    if(!mode || waitingForWarp)return;
    const dx=Math.max(-399,Math.min(399,Math.trunc(pendingX)));
    if(dx){
      pendingX-=dx;
      waitingForWarp=true;
      mouse("mousemove",centerX+dx,centerY,dx,0);
    }else if(commit){
      commit=false;finish={frame:frames,time:performance.now()};
      mouse("mousedown",centerX,centerY);
    }
  }
  function wake() {
    if (!scheduled) { scheduled = true; queueMicrotask(pump); }
  }
  function reset() {
    if (open && !open.sent) mouse("mouseup",open.x,open.y);
    if (finish) mouse("mouseup",centerX,centerY);
    clearTimeout(wheelTimer);scrolling="";
    gesture=undefined;open=undefined;finish=null;commit=!!mode;pendingX=0;waitingForWarp=false;
    lastX=undefined;
    if(commit)wake();
  }
  function move(event) {
    const box=canvas.getBoundingClientRect();
    const locked = document.pointerLockElement === canvas;
    const dx=locked ? event.movementX : lastX===undefined ? 0 : event.clientX-lastX;
    lastX=event.clientX;
    if (!(mode || gesture || open) || finish || commit) return;
    if(scrolling)return;
    pendingX+=dx*800/box.width;
    if (gesture && !gesture.drag && Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>=3) {
      gesture.drag=true;
      if (open) open.release=true;
    }
    wake();
  }
  canvas.addEventListener("pointerdown",event=>{
    if (!event.isPrimary || event.button!==0) return;
    const r=canvas.getBoundingClientRect();
    const x=(event.clientX-r.left)*800/r.width, y=(event.clientY-r.top)*600/r.height;
    const item=hud && controlAt(x,y);
    if (!mode && !item || gesture || finish) return;
    lastX=event.clientX;
    gesture={id:event.pointerId,x:lastX,y:event.clientY,drag:false,adjusting:!!mode};
    if(document.pointerLockElement!==canvas)canvas.setPointerCapture(event.pointerId);
    if (!mode) {
      open={control:item,x,y,frame:frames,time:performance.now(),release:false,sent:0};
      mouse("mousemove",x,y);mouse("mousedown",x,y);
    }
    stop(event);
  },true);
  canvas.addEventListener("pointermove",event=>{
    if (event.isPrimary && (!gesture || gesture.id===event.pointerId)) move(event);
  },true);
  function release(event) {
    if (!gesture || event.pointerId!==gesture.id) return;
    if (event.type==="pointerup") move(event);
    if (open) open.release=true;
    commit=gesture.adjusting || gesture.drag;
    gesture=undefined;
    wake();
    stop(event);
  }
  canvas.addEventListener("pointerup",release,true);
  canvas.addEventListener("pointercancel",release,true);
  canvas.addEventListener("wheel",event=>{
    if(!hud || gesture || finish || event.ctrlKey)return;
    const r=canvas.getBoundingClientRect();
    const x=(event.clientX-r.left)*800/r.width, y=(event.clientY-r.top)*600/r.height;
    const target=x>=482 && x<564 && y>=465 && y<519 ? "angle"
      : x>=430 && x<564 && y>=531 && y<586 ? "power" : "";
    if(!target || (mode && mode!==target) || (scrolling && scrolling!==target))return;
    const delta=Math.abs(event.deltaY)>=Math.abs(event.deltaX)?event.deltaY:event.deltaX;
    if(!delta)return;
    stop(event);
    if(!mode && !open){
      const headerY=target==="angle"?482:548;
      open={control:target,x:521,y:headerY,frame:frames,time:performance.now(),release:true,sent:0};
      mouse("mousemove",open.x,open.y);mouse("mousedown",open.x,open.y);
    }
    scrolling=target;commit=false;
    // A conventional wheel notch is 100 CSS pixels or three text lines.
    const notches=event.deltaMode===1?delta/3:event.deltaMode===2?delta:delta/100;
    pendingX+=notches*4*(target==="power"?-1:1);
    clearTimeout(wheelTimer);
    wheelTimer=setTimeout(()=>{commit=true;wake()},180);
    wake();
  },{capture:true,passive:false});
  canvas.addEventListener("pointerleave",()=>{ if (!gesture) {lastX=undefined;} });
  for (const type of ["mousemove","mousedown","mouseup","touchstart","touchmove","touchend","touchcancel"]) {
    window.addEventListener(type,event=>{
      if (event.target===canvas && !injected.has(event) && (gesture || mode || open || commit || finish)) stop(event);
    },{capture:true,passive:false});
  }
  window.addEventListener("blur",reset);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)reset()});

  window.presentPocketTanks = (data,width,height) => {
    if (width!==800 || height!==600 || !data) return;
    if (!loading.hidden) {
      let visible=0;
      for(let y=20;y<600 && visible<8;y+=32) for(let x=20;x<800 && visible<8;x+=32) {
        const i=(y*800+x)*4;
        if(Math.max(data[i],data[i+1],data[i+2])>40) visible++;
      }
      if (visible>=8) loading.hidden=true;
    }
    frames++;
    // Static panel pixels distinguish gameplay from the title and menu pages.
    hud=data[(452*800+2)*4]===82 && data[(499*800+360)*4]===44;
    if (open?.sent && frames-open.sent>8 && !mode) reset();
    if (open || finish || commit || Math.abs(pendingX)>=1) wake();
  };
})();
