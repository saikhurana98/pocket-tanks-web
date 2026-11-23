// Run from the repository root with 32-bit TinyCC 0.9.27.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pt-bass-"));
try {
  const dll = path.join(dir, "bass.dll");
  execFileSync(process.env.TCC || "tcc", ["-shared", "-o", dll, "audio/bass.c", "-lkernel32"]);
  // TinyCC decorates Win32 stdcall exports. The game imports their plain names.
  // Keep the export table offsets and sorted order intact.
  const bytes = fs.readFileSync(dll);
  const symbols = [...bytes.toString("latin1").matchAll(/_(BASS_\w+)@\d+\0/g)];
  if (symbols.length !== 18) throw Error("Unexpected BASS export table");
  for (const symbol of symbols) {
    bytes.fill(0, symbol.index, symbol.index + symbol[0].length);
    bytes.write(symbol[1], symbol.index, "ascii");
  }
  fs.writeFileSync("audio/bass.dll", bytes);
} finally {
  fs.rmSync(dir, {recursive:true, force:true});
}
