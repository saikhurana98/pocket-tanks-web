const archive = document.querySelector("#archive");
const message = document.querySelector("#message");
archive.addEventListener("change", async () => {
  const file = archive.files[0];
  if (!file) return;
  archive.disabled = true;
  message.textContent = "Opening game archive…";
  try {
    const bytes = BrowserFS.BFSRequire("buffer").Buffer.from(await file.arrayBuffer());
    const zip = await new Promise((resolve, reject) => {
      BrowserFS.FileSystem.ZipFS.Create({zipData: bytes}, (error, fs) => error ? reject(error) : resolve(fs));
    });
    const folders = ["/", ...zip.readdirSync("/").map(name => "/" + name).filter(path => zip.statSync(path).isDirectory())];
    const folder = folders.find(path => zip.readdirSync(path).includes("pockettanks.exe"));
    if (!folder) throw new Error("Choose a ZIP containing pockettanks.exe and the game's data files.");
    Config.localGame = new BrowserFS.FileSystem.FolderAdapter(folder, zip);
    Config.urlParams = "work=d:/&p=pockettanks.exe";
    document.body.classList.remove("selecting");
    document.querySelector("#picker").hidden = true;
    const script = document.createElement("script");
    script.src = "boxedwine.js";
    document.body.append(script);
  } catch (error) {
    message.textContent = error.message;
    archive.value = "";
    archive.disabled = false;
  }
});
