# Author Studio landing page

Static, dependency-free landing page. Source in `src/`, output in `dist/`.

## Build

```sh
SITE_URL=https://yourdomain node site/build.mjs
```

`SITE_URL` defaults to `https://authorstudio.example` (a placeholder). It fills the canonical URL,
Open Graph/Twitter tags, JSON-LD, `robots.txt` and `sitemap.xml` (`lastmod` = build date).
The FAQPage JSON-LD is generated from the visible FAQ in `src/index.html`, so edit the FAQ there only.

Upload the contents of `site/dist/` to any static host. Configure the host to serve `404.html` for missing pages.

## Installers

Put installer files in `site/dist/downloads/` (the build never deletes that folder).
The default Windows link is `downloads/AuthorStudio-Setup-latest.exe`.

## What to change before hosting

- **Domain**: pass your real `SITE_URL` when building.
- **Download links**: edit the `DOWNLOADS` object at the top of `src/assets/site.js`
  (`windows`, `macos`, `ios`, `releaseNotes`). The build also writes `windows` into the HTML so the
  link works without JavaScript. A full `https://` URL (e.g. a GitHub release asset) works too.
  Set `releaseNotes` to turn "Version and checksums are listed on the release" into a link.
- **Social image**: `src/og.svg` is the source; `src/og.png` (1200x630) and the PNG icons are
  rendered from it once with `node site/tools/make-images.cjs` (needs the local Playwright skill).
  Re-run it if you change the SVGs.

## Current download links

`src/assets/site.js` points at the GitHub release:
- **Installer:** https://github.com/ElDiegolar/author-studio/releases/download/v0.1.0/AuthorStudio-Setup-0.1.0.exe
- **Release notes and checksums:** https://github.com/ElDiegolar/author-studio/releases/tag/v0.1.0

For a new version, upload the installer to a new release, update `DOWNLOADS.windows` and `DOWNLOADS.releaseNotes`, then rebuild.
