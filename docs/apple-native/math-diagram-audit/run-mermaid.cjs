const fs = require("fs"), path = require("path"), os = require("os");
const modules = process.env.WORLDS_MERMAID_MODULES;
const esbuild = require(path.join(modules, "esbuild"));
const { chromium } = require(path.join(modules, "playwright-core"));
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worlds-mermaid-audit-"));
  try {
    const entry = path.join(root, "entry.mjs"), output = path.join(root, "bundle.js");
    fs.writeFileSync(entry, `import mermaid from ${JSON.stringify(path.join(modules, "mermaid/dist/mermaid.esm.min.mjs").replaceAll("\\", "/"))}; globalThis.worldsMermaid=mermaid;`);
    await esbuild.build({entryPoints: [entry], bundle: true, platform: "browser", format: "iife", outfile: output, logLevel: "silent"});
    const browser = await chromium.launch({headless: true, executablePath: process.env.WORLDS_CHROME_PATH, args: ["--no-sandbox"]});
    try {
      const page = await browser.newPage(); await page.setContent("<!doctype html><html><body></body></html>"); await page.addScriptTag({path: output});
      const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "mermaid-corpus.json"), "utf8"));
      for (const item of corpus) {
        const accepted = await page.evaluate(async code => {
          try { worldsMermaid.initialize({startOnLoad: false, securityLevel: "strict", theme: "dark"}); await worldsMermaid.parse(code); return true; }
          catch { return false; }
        }, item.code);
        console.log(`${item.id}\t${accepted ? "accepted" : "rejected"}`);
      }
    } finally { await browser.close(); }
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
