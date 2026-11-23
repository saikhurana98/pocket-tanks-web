// Decode complete files as the HTTP body arrives. Only the current file and the
// current decompressor chunk need staging space outside the guest filesystem.
async function loadGameFiles() {
  const manifestResponse = await fetch("assets/game.json");
  if (!manifestResponse.ok) throw Error("Could not download the game index.");
  const { parts, compressedSize, files } = await manifestResponse.json();
  const status = document.querySelector("#transfer");
  const progress = document.querySelector("#transfer-progress");
  progress.max = compressedSize;
  progress.hidden = false;
  let received = 0;
  const meter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      progress.value = received;
      controller.enqueue(chunk);
    }
  });
  const reader = gameStream(parts).pipeThrough(meter).pipeThrough(new DecompressionStream("gzip")).getReader();
  const disk = new BrowserFS.FileSystem.InMemory();
  const Buffer = BrowserFS.BFSRequire("buffer").Buffer;
  const dirs = new Set([""]);
  const FileSystem = BrowserFS.BFSRequire('fs').FS;
  const fs = new FileSystem();
  fs.initialize(disk);
  let pending = new Uint8Array(0);
  let count = 0, lastUpdate = -Infinity;
  try {
    for (const file of files) {
      const bytes = Buffer.alloc(file.size);
      let offset = 0;
      while (offset < bytes.length) {
        if (!pending.length) {
          const chunk = await reader.read();
          if (chunk.done) throw Error("The download ended early.");
          pending = chunk.value;
        }
        const n = Math.min(bytes.length - offset, pending.length);
        bytes.set(pending.subarray(0,n),offset);
        offset += n;
        pending = pending.subarray(n);
      }
      if (file.pcm) restorePcm(bytes, ...file.pcm);
      for (const path of file.paths) {
        const parts = path.split("/");
        let dir = "";
        for (const part of parts.slice(0,-1)) {
          dir += "/" + part;
          if (!dirs.has(dir)) { fs.mkdirSync(dir,0o755); dirs.add(dir); }
        }
        fs.writeFileSync("/"+path,bytes);
        count++;
      }
      if (performance.now()-lastUpdate>100) {
        status.textContent = "Downloading and unpacking · " + Math.round(received/compressedSize*100) + "% · " + count + " files ready";
        lastUpdate = performance.now();
      }
    }
    if (pending.length || !(await reader.read()).done || received !== compressedSize)
      throw Error("The game download was incomplete or invalid.");
  } catch (error) {
    await reader.cancel().catch(()=>{});
    throw error;
  } finally { reader.releaseLock(); }
  status.textContent = "Starting Pocket Tanks Deluxe…";
  progress.hidden = true;
  return new BrowserFS.FileSystem.FolderAdapter("/",disk);
}

function restorePcm(bytes,start,size,channels) {
  const planes = Uint8Array.from(bytes.subarray(start,start+size));
  const frames = size/(2*channels), previous = new Uint16Array(channels);
  for (let frame=0; frame<frames; frame++) {
    let left=0;
    for (let ch=0; ch<channels; ch++) {
      const i=ch*frames+frame;
      previous[ch] += planes[i] | (planes[i+size/2]<<8);
      let sample=previous[ch];
      if (ch===1) sample=(sample+left)&65535; else left=sample;
      const out=start+2*(frame*channels+ch);
      bytes[out]=sample;
      bytes[out+1]=sample>>>8;
    }
  }
}


// Feed the pieces of one gzip stream in order. Begin the next HTTP request
// while the current response is being consumed, and let fetch cache each piece.
function gameStream(parts) {
  const abort = new AbortController();
  let index = 0, next, reader, completed;
  function fetchNext() {
    if (index === parts.length) return null;
    const url = "assets/" + parts[index++];
    // Observe failures immediately even while another response is draining.
    return cachedAsset(url, url.match(/game-([a-f0-9]+)\.bin$/)[1], abort.signal)
      .catch(error => ({error}));
  }
  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            const result = await (next || fetchNext());
            if (!result) { controller.close(); return; }
            if (result.error) throw result.error;
            if (!result.response.ok || !result.response.body) throw Error("Could not download the game data.");
            reader = result.response.body.getReader();
            completed = result.completed;
            next = fetchNext();
          }
          const {done,value} = await reader.read();
          if (!done) { controller.enqueue(value); return; }
          const failure = await completed;
          if (failure) throw failure;
          reader.releaseLock();
          reader = null;
        }
      } catch (error) {
        abort.abort();
        controller.error(error);
      }
    },
    cancel() { abort.abort(); }
  });
}

const assetCache = (async () => {
  try { return await caches.open("pocket-tanks-assets-" + new URL(".",location.href).pathname); }
  catch { return null; }
})();

// Stream to the decoder immediately. Verify a second branch before committing
// it to persistent storage, so interrupted responses can be retried safely.
async function cachedAsset(url, digest, signal) {
  const cache = await assetCache;
  const hit = cache && await cache.match(url).catch(() => null);
  if (hit) return {response:hit, completed:null};
  const response = await fetch(url,{signal});
  if (!response.ok || !response.body) throw Error("Could not download " + url);
  const copy = response.clone();
  const completed = (async () => {
    const bytes = await copy.arrayBuffer();
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    const actual = Array.from(hash,b=>b.toString(16).padStart(2,"0")).join("");
    if (!actual.startsWith(digest)) throw Error("Downloaded data failed verification. Please retry.");
    if (cache) await cache.put(url,new Response(bytes)).catch(()=>{});
  })().then(()=>null,error=>error);
  return {response,completed};
}

async function wineRoot() {
  const digest = "695e905bc38f6fd37e92fbb223e0822fe06c327b12bbdaaf0d718c5a4baf9506";
  const {response,completed} = await cachedAsset("boxedwine.zip?v="+digest.slice(0,16),digest);
  const bytes = await response.arrayBuffer();
  const failure = await completed;
  if (failure) throw failure;
  const Buffer = BrowserFS.BFSRequire("buffer").Buffer;
  return new Promise((resolve,reject)=>{
    BrowserFS.FileSystem.ZipFS.Create({zipData:Buffer.from(bytes)},(error,fs)=>error ? reject(error) : resolve(fs));
  });
}
