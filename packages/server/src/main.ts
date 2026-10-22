/**
 * Dev / self-hosted server: the same app the desktop shell embeds, on 127.0.0.1.
 * Env: AUTHOR_LIBRARY (folder of novels, default ~/Documents/Author Studio), AUTHOR_PROJECT (open
 * this novel at start; its parent becomes the library unless AUTHOR_LIBRARY is set), AUTHOR_SETTINGS, PORT (8790).
 */
import { serve } from '@hono/node-server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLibrary } from '@author-studio/core';
import { createApp } from './app.js';

const project = process.env.AUTHOR_PROJECT ? path.resolve(process.env.AUTHOR_PROJECT) : undefined;
const library = process.env.AUTHOR_LIBRARY ?? (project ? path.dirname(project) : defaultLibrary());
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const hasWeb = await fs.access(webDist).then(() => true, () => false);
const app = await createApp({ library, ...(project ? { project } : {}), ...(hasWeb ? { webDist } : {}) });
const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`author-studio server on http://127.0.0.1:${port}  library=${library}${project ? `  project=${project}` : ''}`));
