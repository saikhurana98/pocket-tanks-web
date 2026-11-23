// Usage: node tools/pack-game.mjs <directory extracted from the distributed game ZIP>
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const source = process.argv[2];
if (!source) throw Error("Supply the extracted game directory");
const groups = new Map();
async function collect(dir) {
  for (const entry of (await readdir(dir, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,"en"))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { await collect(file); continue; }
    const bytes = await readFile(file);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!groups.has(digest)) groups.set(digest, {paths:[], bytes});
    groups.get(digest).paths.push(path.relative(source,file).split(path.sep).join("/"));
  }
}
await collect(source);

// Reversible decorrelation for the 16-bit PCM that dominates the game data.
// Store high and low bytes separately so gzip can compress quiet passages.
function encodePcm(bytes) {
  if (bytes.toString("ascii",0,4)!=="RIFF" || bytes.toString("ascii",8,12)!=="WAVE") return;
  let channels = 0;
  for (let pos=12; pos+8<=bytes.length;) {
    const id=bytes.toString("ascii",pos,pos+4), size=bytes.readUInt32LE(pos+4), start=pos+8;
    if (start+size>bytes.length) return;
    if (id==="fmt " && size>=16 && bytes.readUInt16LE(start)===1 && bytes.readUInt16LE(start+14)===16)
      channels=bytes.readUInt16LE(start+2);
    if (id==="data" && (channels===1 || channels===2) && size && size%(2*channels)===0) {
      const out=Buffer.from(bytes), prev=new Uint16Array(channels), frames=size/(channels*2);
      for (let frame=0; frame<frames; frame++) {
        let left=0;
        for (let ch=0; ch<channels; ch++) {
          let sample=bytes.readUInt16LE(start+2*(frame*channels+ch));
          if (ch===1) sample=(sample-left)&65535; else left=sample;
          const delta=(sample-prev[ch])&65535;
          prev[ch]=sample;
          const offset=ch*frames+frame;
          out[start+offset]=delta;
          out[start+size/2+offset]=delta>>>8;
        }
      }
      return {out,pcm:[start,size,channels]};
    }
    pos=start+size+(size%2);
  }
}
const files=[], chunks=[];
for (const [sha256,{bytes,paths}] of groups) {
  const encoded=encodePcm(bytes);
  chunks.push(encoded?.out ?? bytes);
  files.push({paths,size:bytes.length,...(encoded && {pcm:encoded.pcm}),sha256});
}
const compressed=gzipSync(Buffer.concat(chunks),{level:9});
const dir=new URL("../assets/",import.meta.url);
await mkdir(dir,{recursive:true});
const parts=[];
for (let offset=0; offset<compressed.length; offset+=8*1024*1024) {
  const chunk=compressed.subarray(offset,offset+8*1024*1024);
  const digest=createHash("sha256").update(chunk).digest("hex").slice(0,16);
  const name="game-"+digest+".bin";
  await writeFile(new URL(name,dir),chunk);
  parts.push(name);
}
await writeFile(new URL("game.json",dir),JSON.stringify({parts,compressedSize:compressed.length,files}));
console.log(files.length+" unique assets, "+compressed.length+" compressed bytes");
