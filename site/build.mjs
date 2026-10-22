#!/usr/bin/env node
// Zero-dependency static build for the Author Studio landing page.
//   SITE_URL=https://yourdomain node site/build.mjs
// Reads site/src, writes site/dist. Keeps site/dist/downloads/ (installers) between builds.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

const SITE_URL = (process.env.SITE_URL || "https://authorstudio.example").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+/.test(SITE_URL)) {
  console.error(`SITE_URL must be an absolute http(s) URL, got: ${SITE_URL}`);
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);

// Download link: single source of truth is DOWNLOADS in src/assets/site.js
const siteJs = readFileSync(join(src, "assets/site.js"), "utf8");
const m = siteJs.match(/windows:\s*"([^"]+)"/);
if (!m) { console.error("Could not find DOWNLOADS.windows in src/assets/site.js"); process.exit(1); }
const DOWNLOAD_WINDOWS = m[1];
const DOWNLOAD_WINDOWS_ABS = /^https?:\/\//.test(DOWNLOAD_WINDOWS)
  ? DOWNLOAD_WINDOWS
  : `${SITE_URL}/${DOWNLOAD_WINDOWS.replace(/^\/+/, "")}`;

// FAQPage JSON-LD is generated from the visible FAQ so the two always match.
const decode = (s) => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

function faqJsonLd(html) {
  const re = /<details class="faq-item">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-a">([\s\S]*?)<\/div>\s*<\/details>/g;
  const items = [...html.matchAll(re)].map(([, q, a]) => ({
    "@type": "Question",
    name: decode(q),
    acceptedAnswer: { "@type": "Answer", text: decode(a) },
  }));
  if (!items.length) throw new Error("No FAQ items found in index.html");
  return JSON.stringify({ "@type": "FAQPage", "@id": `${SITE_URL}/#faq`, mainEntity: items }, null, 2)
    .split("\n").map((l, i) => (i ? "    " + l : l)).join("\n");
}

const fill = (s) => s
  .replaceAll("{{SITE_URL}}", SITE_URL)
  .replaceAll("{{DOWNLOAD_WINDOWS_ABS}}", DOWNLOAD_WINDOWS_ABS)
  .replaceAll("{{DOWNLOAD_WINDOWS}}", DOWNLOAD_WINDOWS);

// Clean dist, but never delete installers in dist/downloads
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(dist)) {
  if (name !== "downloads") rmSync(join(dist, name), { recursive: true, force: true });
}
mkdirSync(join(dist, "downloads"), { recursive: true });

// Pages
let index = readFileSync(join(src, "index.html"), "utf8");
index = fill(index.replace("{{FAQ_JSONLD}}", faqJsonLd(index)));
const leftover = index.match(/\{\{[A-Z_]+\}\}/);
if (leftover) { console.error(`Unreplaced token ${leftover[0]} in index.html`); process.exit(1); }
writeFileSync(join(dist, "index.html"), index);
writeFileSync(join(dist, "404.html"), fill(readFileSync(join(src, "404.html"), "utf8")));

// Static files
cpSync(join(src, "assets"), join(dist, "assets"), { recursive: true });
for (const f of ["favicon.svg", "og.png", "og.svg", "icon-512.png", "apple-touch-icon.png", "site.webmanifest"]) {
  if (existsSync(join(src, f))) cpSync(join(src, f), join(dist, f));
}

// robots + sitemap
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(dist, "sitemap.xml"),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${today}</lastmod>
  </url>
</urlset>
`);

console.log(`Built ${dist}\n  SITE_URL=${SITE_URL}\n  Windows download=${DOWNLOAD_WINDOWS}\n  lastmod=${today}`);
