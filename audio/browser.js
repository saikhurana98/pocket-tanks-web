/* Pocket Tanks writes BASS commands through its Wine drive. The browser plays
   the two tracker arrangements and the original sample files on its audio clock. */
const gameAudio = (() => {
  const assets = new Map(), voices = new Map();
  const volumes = [1, 1, 1];
  // Command numbers are shared with the 32-bit driver in bass.c.
  const [LOAD, CHANNEL, PLAY, PAUSE, STOP, FREE, CONFIG, MASTER, RESET] = [1,2,3,4,5,6,7,8,9];
  let ctx, output, effects, pending = new Uint8Array(), enabled = true;
  function unlock() {
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
    for (const voice of voices.values()) if (voice.asset.media?.paused && voice.wanted) start(voice);
  }
  for (const event of ["pointerdown", "keydown", "click"])
    document.addEventListener(event, unlock, true);

  function halt(voice, keepPosition) {
    if (!voice) return;
    const media = voice.asset.media;
    if (media) {
      media.pause();
      if (!keepPosition) media.currentTime = 0;
    }
    const source = voice.source;
    if (source) {
      voice.offset = keepPosition ? (voice.offset + ctx.currentTime - voice.started) % source.buffer.duration : 0;
      source.onended = null;
      source.stop();
      source.disconnect();
      voice.source = null;
    } else if (!keepPosition) voice.offset = 0;
    voice.wanted = false;
  }
  function start(voice) {
    if (!voice.wanted || !enabled || voice.source) return;
    const media = voice.asset.media;
    if (media) {
      media.loop = voice.asset.loop;
      media.play().catch(error => {
        if (!["AbortError","NotAllowedError"].includes(error.name)) console.warn("Music playback failed", error);
      });
      return;
    }
    if (!voice.asset.buffer) { voice.asset.prepare(); return; }
    const source = ctx.createBufferSource();
    source.buffer = voice.asset.buffer;
    source.loop = voice.asset.loop;
    source.connect(voice.asset.gain);
    voice.started = ctx.currentTime;
    voice.source = source;
    source.onended = () => {
      if (voice.source !== source) return;
      voice.source = null;
      voice.wanted = false;
      voice.offset = 0;
      if (voice.ephemeral) voices.delete(voice.id);
    };
    source.start(0, voice.offset);
  }
  function addVoice(id, asset, ephemeral) {
    const voice = {id, asset, ephemeral, offset:0, wanted:false};
    voices.set(id, voice);
    return voice;
  }
  function dispose(id) {
    const asset = assets.get(id);
    for (const [key, voice] of voices) {
      if (key === id || voice.asset === asset) { halt(voice, false); voices.delete(key); }
    }
    if (asset?.media) {
      asset.media.onended = null;
      asset.media.removeAttribute("src");
      asset.media.load();
      asset.mediaNode.disconnect();
    }
    asset?.gain.disconnect();
    assets.delete(id);
  }
  function load(id, kind, encoding, payload) {
    const gain = ctx.createGain();
    gain.gain.value = volumes[kind];
    gain.connect(kind === 0 ? effects : output);
    const asset = {kind, gain, loop:false};
    assets.set(id, asset);
    if (kind !== 0) addVoice(id, asset, false);
    const decode = async () => {
      let data = payload;
      if (encoding !== 1) {
        const name = new TextDecoder(encoding === 2 ? "utf-16le" : "windows-1252").decode(payload)
          .replaceAll("\\", "/").replace(/^(?:d:)?\/?/i, "").replace(/^\.\//, "");
        data = FS.readFile(Config.appDirPrefix + name);
      }
      if (String.fromCharCode(...data.subarray(0,4)) === "IMPM") {
        const title = new TextDecoder().decode(data.subarray(4,30));
        const media = document.createElement("audio");
        asset.media = media;
        asset.mediaNode = ctx.createMediaElementSource(media);
        asset.mediaNode.connect(gain);
        media.preload = "auto";
        media.src = title.toLowerCase().includes("ingame") ? "audio/ingame.mp3" : "audio/pocket.mp3";
        media.onended = () => { const voice = voices.get(id); if (voice) voice.wanted = false; };
        return null;
      }
      return ctx.decodeAudioData(data.slice().buffer);
    };
    asset.prepare = () => {
      if (asset.loading) return;
      asset.loading = true;
      decode().then(buffer => {
        if (assets.get(id) !== asset) return;
        asset.buffer = buffer;
        for (const voice of voices.values()) if (voice.asset === asset) start(voice);
      }).catch(error => {
        asset.loading = false;
        console.warn("Game audio load failed", error);
      });
    };
    // Prepare music during the scene change. Weapon sounds decode on first use.
    if (kind !== 0) asset.prepare();
  }
  function command(op, a, b, c, payload) {
    switch (op) {
      case LOAD: load(a, b, c, payload); break;
      case CHANNEL: if (assets.has(b)) addVoice(a, assets.get(b), true); break;
      case PLAY: {
        const voice = voices.get(a);
        if (!voice) break;
        if (b) halt(voice, false);
        voice.wanted = true;
        start(voice);
        break;
      }
      case PAUSE: halt(voices.get(a), true); break;
      case STOP:
        for (const [id, voice] of voices) if (voice.asset === assets.get(a)) {
          halt(voice, false);
          if (voice.ephemeral) voices.delete(id);
        }
        break;
      case FREE: dispose(a); break;
      case CONFIG:
        if (a && b === 0xffffffff && assets.has(a)) assets.get(a).loop = !!c;
        // BASS_CONFIG_GVOL_SAMPLE, STREAM and MUSIC are 4, 5 and 6.
        if (!a && b >= 4 && b <= 6) {
          const kind = [0,2,1][b-4];
          volumes[kind] = Math.min(1, c / 10000);
          for (const asset of assets.values()) if (asset.kind === kind) asset.gain.gain.value = volumes[kind];
        }
        break;
      case MASTER:
        enabled = a === 1;
        for (const voice of voices.values()) {
          if (enabled) start(voice);
          else if (a === 2) halt(voice, false);
          else if (voice.wanted) { halt(voice, true); voice.wanted = true; }
        }
        break;
      case RESET: for (const id of [...assets.keys()]) dispose(id); break;
    }
  }
  function receive(bytes) {
    const all = new Uint8Array(pending.length + bytes.length);
    all.set(pending); all.set(bytes, pending.length);
    const view = new DataView(all.buffer);
    let i = 0;
    while (i + 20 <= all.length) {
      const size = view.getUint32(i, true);
      if (size < 16 || size > 32*1024*1024) { pending = new Uint8Array(); return; }
      if (i + 4 + size > all.length) break;
      const word = offset => view.getUint32(i + offset, true);
      command(word(4), word(8), word(12), word(16), all.subarray(i + 20, i + 4 + size));
      i += 4 + size;
    }
    pending = all.slice(i);
  }
  async function install() {
    if (!Config.isSoundEnabled) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !document.createElement("audio").canPlayType("audio/mpeg")) return;
    const response = await fetch("audio/bass.dll");
    if (!response.ok) throw Error("Could not load the browser audio driver.");
    const dll = new Uint8Array(await response.arrayBuffer());
    ctx = new Audio();
    output = ctx.createGain();
    output.connect(ctx.destination);
    effects = ctx.createGain();
    effects.connect(output);
    FS.writeFile(Config.appDirPrefix + "bass.dll", dll);
    const write = FS.write;
    FS.write = function(stream, buffer, offset, length, ...rest) {
      if (stream.path?.toLowerCase().endsWith("/ptaudio.bus")) {
        receive(buffer.subarray(offset,offset+length));
        return length;
      }
      return write.call(this, stream, buffer, offset, length, ...rest);
    };
    unlock();
  }
  return {install, get output(){return output;}, get context(){return ctx;}, get effects(){return effects;}};
})();
