// One-off: renders src/og.svg -> src/og.png (1200x630) and the favicon to PNG icons,
// using the Playwright Chromium bundled with the local playwright skill.
// Run: node site/tools/make-images.cjs   (outputs are committed; build.mjs only copies them)
const path = require("path");
const fs = require("fs");
const { chromium } = require(process.env.HOME + "/.claude/skills/playwright/node_modules/playwright");

const src = path.join(__dirname, "..", "src");
const fontUrl = "file://" + path.join(src, "assets/fonts/geist-latin-wght-normal.woff2");
const page = (svg, w, h) => `<!doctype html><html><head><style>
@font-face{font-family:Geist;src:url("${fontUrl}") format("woff2");font-weight:100 900}
html,body{margin:0;width:${w}px;height:${h}px;background:#050505;overflow:hidden}
svg{display:block;width:${w}px;height:${h}px}</style></head><body>${svg}</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const shots = [
    ["og.svg", "og.png", 1200, 630],
    ["favicon.svg", "icon-512.png", 512, 512],
    ["favicon.svg", "apple-touch-icon.png", 180, 180],
  ];
  for (const [inp, out, w, h] of shots) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    const tmp = path.join(src, `.tmp-${out}.html`);
    fs.writeFileSync(tmp, page(fs.readFileSync(path.join(src, inp), "utf8"), w, h));
    await p.goto("file://" + tmp);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(src, out), omitBackground: out !== "og.png" });
    fs.unlinkSync(tmp);
    await p.close();
    console.log("wrote", out);
  }
  await browser.close();
})();
