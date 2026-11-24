const stage = document.getElementById("inline");
const screenButton = document.getElementById("fullscreen");
const canvas = document.getElementById("canvas");
const notice = document.getElementById("display-notice");
const capture = document.getElementById("pointerLock");
const software = new URL(location.href);
software.searchParams.set("display","software");
const recovery = document.getElementById("recovery");

function showFailure(text, graphics = false) {
  document.getElementById("loading").hidden = true;
  notice.textContent = text;
  recovery.href = graphics ? software.href : location.href;
  recovery.textContent = graphics ? "Restart in software mode" : "Retry";
  recovery.hidden = false;
}

const stretch = document.getElementById("stretch");
try { stretch.checked = localStorage.getItem("pt-stretch") === "1"; } catch {}
stage.classList.toggle("stretched",stretch.checked);
stretch.addEventListener("change", () => {
  stage.classList.toggle("stretched",stretch.checked);
  try { localStorage.setItem("pt-stretch",stretch.checked ? "1" : "0"); } catch {}
});

function fullscreenChanged() {
  const active = !!document.fullscreenElement || stage.classList.contains("expanded");
  screenButton.textContent = active ? "Exit fullscreen" : "Fullscreen";
  screenButton.setAttribute("aria-pressed",String(active));
}
screenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (stage.classList.contains("expanded")) stage.classList.remove("expanded");
    else if (document.fullscreenEnabled && stage.requestFullscreen) await stage.requestFullscreen();
    else stage.classList.add("expanded");
  } catch { stage.classList.add("expanded"); }
  fullscreenChanged();
});
document.addEventListener("fullscreenchange",fullscreenChanged);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && stage.classList.contains("expanded")) {
    stage.classList.remove("expanded");
    fullscreenChanged();
  }
});
capture.addEventListener("change", () => {
  if (!capture.checked) document.exitPointerLock?.();
});
canvas.addEventListener("click", () => {
  if (capture.checked && !document.pointerLockElement)
    canvas.requestPointerLock?.()?.catch?.(()=>{capture.checked=false;});
});
document.addEventListener("pointerlockerror",()=>{capture.checked=false;});
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  showFailure("The graphics context was lost. Restart to continue.",true);
});

function hasAcceleratedWebGL() {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl",{failIfMajorPerformanceCaveat:true});
  if (!gl) return false;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}
const softwareMode = new URL(location.href).searchParams.get("display")==="software" || !hasAcceleratedWebGL();
Config.urlParams = "work=d:/&p=pockettanks.exe&resolution=800x600";
const hints = softwareMode ? ["SDL_FRAMEBUFFER_ACCELERATION:0","SDL_RENDER_DRIVER:software"] : [];
if (!window.AudioContext && !window.webkitAudioContext) {
  hints.push("SDL_AUDIODRIVER:dummy");
  Config.urlParams += "&sound=false";
  notice.textContent = "Audio is unavailable in this browser. Playing without sound.";
}
if (hints.length) Config.urlParams += "&em-env=%22" + hints.join(";") + "%22";
const modeLink = document.getElementById("display-mode");
modeLink.href = softwareMode ? location.pathname : software.href;
modeLink.textContent = softwareMode ? "Software display · retry automatic" : "Use software display";
