const fs = require("fs"), path = require("path");
const katex = require(path.join(process.env.WORLDS_KATEX_MODULES, "katex"));
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "math-corpus.json"), "utf8"));
for (const item of corpus) {
  try {
    katex.renderToString(item.latex, {displayMode: true, throwOnError: true, strict: "ignore", trust: false, output: "htmlAndMathml"});
    console.log(`${item.id}\taccepted`);
  } catch { console.log(`${item.id}\trejected`); }
}
