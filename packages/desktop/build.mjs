/**
 * Bundle the desktop app into app/: one ESM file for the studio server (core + server + every
 * dependency), one for the MCP server, the built web app, the Electron main/preload and the icon.
 * electron-builder then packages app/ with no node_modules at all.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'app');
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Some dependencies (mammoth) still use require(); give the ESM bundle a real one.
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
const common = { bundle: true, platform: 'node', format: 'esm', target: 'node22', banner, logLevel: 'warning', legalComments: 'none', minify: true, sourcemap: false };
await build({ ...common, entryPoints: [path.join(here, 'src/server.ts')], outfile: path.join(out, 'server.mjs') });
await build({ ...common, entryPoints: [path.join(here, '../mcp/src/main.ts')], outfile: path.join(out, 'mcp.mjs') });

cpSync(path.join(here, '../web/dist'), path.join(out, 'web'), { recursive: true });
for (const f of ['main.cjs', 'preload.cjs']) cpSync(path.join(here, 'src', f), path.join(out, f));
cpSync(path.join(here, 'build/icon.png'), path.join(out, 'icon.png'));
writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'author-studio', productName: 'Author Studio', version: pkg.version, description: pkg.description, main: 'main.cjs', author: 'Author Studio', license: 'UNLICENSED' }, null, 2));
console.log(`bundled desktop app ${pkg.version} -> ${path.relative(process.cwd(), out)}`);
