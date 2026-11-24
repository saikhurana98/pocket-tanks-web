// Rebuild from the checked-in BoxedWine runtime with WABT 1.0.39.
// node tools/build-pointer-driver.cjs [path to the unpacked wabt npm package]
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const {execFileSync}=require("node:child_process");
const {createHash}=require("node:crypto");
const root=path.resolve(__dirname,"..");
const original=path.join(root,"boxedwine.wasm");
const expected="82817f3109e7e1d8dd94c3f24cbb230394c7416d479c75fb522b614481c9c768";
if(createHash("sha256").update(fs.readFileSync(original)).digest("hex")!==expected){
  throw Error("Recheck the SDL_Mouse layout for this version of BoxedWine.");
}
const wabt=process.argv[2]||path.dirname(require.resolve("wabt/package.json"));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"boxedwine-pointer-"));
const wat=path.join(dir,"boxedwine.wat");
function run(tool,...args){
  execFileSync(process.execPath,[path.join(wabt,"bin",tool),...args],{stdio:"inherit"});
}
try{
  run("wasm2wat","--generate-names",original,"-o",wat);
  let source=fs.readFileSync(wat,"utf8");
  const originalWarp=`  (func $Emscripten_WarpMouse (type $t3) (param $p0 i32) (param $p1 i32) (param $p2 i32)
    i32.const 4
    call $SDL_Error
    drop)`;
  if(!source.includes(originalWarp))throw Error("SDL's browser warp stub changed.");
  source=source.replace('  (import "a" "a"', '  (import "a" "guestWarp" (func $hostwarp (param i32 i32)))\n  (import "a" "a"');
  // SDL_GetMouseState reads x/y. SDL_PrivateSendMouseMotion compares last_x/y
  // to decide whether a physical movement should generate another guest event.
  source=source.replace(originalWarp,`  (func $Emscripten_WarpMouse (type $t3) (param $window i32) (param $x i32) (param $y i32)
    (i32.store (i32.const 4432500) (local.get $x))
    (i32.store (i32.const 4432504) (local.get $y))
    (i32.store (i32.const 4432516) (local.get $x))
    (i32.store (i32.const 4432520) (local.get $y))
    (call $hostwarp (local.get $x) (local.get $y)))`);
  fs.writeFileSync(wat,source);
  run("wat2wasm",wat,"-o",path.join(root,"boxedwine-pointer.wasm"));
}finally{
  if(fs.existsSync(wat))fs.unlinkSync(wat);
  fs.rmdirSync(dir);
}
