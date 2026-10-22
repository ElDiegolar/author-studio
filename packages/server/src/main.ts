/**
 * HTTP API for the web app. Same Studio facade as the CLI and MCP. Local only by default.
 * Env: AUTHOR_PROJECT (dir), PORT (default 8790).
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { diffWords } from 'diff';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Studio } from '@author-studio/core';

const dir = process.env.AUTHOR_PROJECT;
if (!dir) { console.error('AUTHOR_PROJECT is required'); process.exit(1); }
const studio = await Studio.open(dir);
const app = new Hono();

app.onError((e, c) => { console.error(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path}: ${e.message}`); return c.json({ error: e.message }, 500); });

app.post('/api/agent', async (c) => { const { history, message } = await c.req.json(); return c.json(await studio.agent(history ?? [], message)); });
app.get('/api/bible', async (c) => c.json(await studio.bible()));
app.put('/api/premise', async (c) => { await studio.store.savePremise(await c.req.json()); return c.json({ ok: true }); });
app.put('/api/project', async (c) => { await studio.store.saveProject(await c.req.json()); return c.json({ ok: true }); });

app.post('/api/characters', async (c) => { const ch = await studio.store.addCharacter(await c.req.json()); await studio.store.saveSoul(ch.id, 'base'); return c.json(ch); });
app.put('/api/characters/:id', async (c) => { await studio.updateCharacterSafe(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
app.post('/api/characters/build', async (c) => { const { id, history, message } = await c.req.json(); return c.json(await studio.buildTurn(id ?? null, history ?? [], message)); });
app.post('/api/characters/apply', async (c) => { const { id, edits } = await c.req.json(); return c.json(await studio.applyEdits(id ?? null, edits)); });
app.post('/api/characters/seed', async (c) => { const { inspiration, notes, add } = await c.req.json(); const seed = await studio.seed(inspiration, notes); return c.json(add ? await studio.addSeeded(seed) : seed); });
app.get('/api/characters/:id/state', async (c) => c.json(await studio.state(c.req.param('id'), c.req.query('asOf') ? Number(c.req.query('asOf')) : undefined)));
app.get('/api/characters/:id/events', async (c) => c.json(await studio.store.events(c.req.param('id'))));
app.post('/api/characters/:id/chat', async (c) => { const { message, asOf, history } = await c.req.json(); return c.json(await studio.chat(c.req.param('id'), message, asOf, history ?? [])); });
app.post('/api/characters/:id/observe', async (c) => { const { text } = await c.req.json(); await studio.observe(c.req.param('id'), text); return c.json({ ok: true }); });
app.get('/api/characters/:id/souls', async (c) => c.json(await studio.store.listSouls(c.req.param('id'))));
app.post('/api/characters/:id/souls', async (c) => { const { action, name } = await c.req.json(); const id = c.req.param('id');
  if (action === 'save') return c.json({ path: await studio.store.saveSoul(id, name ?? `snapshot-${Date.now()}`) });
  if (action === 'restore') { await studio.store.restoreSoul(id, name); return c.json({ ok: true }); }
  if (action === 'reset') return c.json(await studio.store.resetSoul(id));
  return c.json({ error: 'bad action' }, 400); });

app.post('/api/characters/:id/relate', async (c) => { const { otherId, relation, mutual } = await c.req.json(); await studio.relate(c.req.param('id'), otherId, relation, mutual); return c.json({ ok: true }); });
app.post('/api/world', async (c) => c.json(await studio.store.addWorld(await c.req.json())));
app.post('/api/scenes', async (c) => { const body = await c.req.json(); return c.json(await studio.store.addScene({ summary: '', ...body })); });
app.put('/api/scenes/:id', async (c) => { await studio.store.updateScene(await c.req.json()); return c.json({ ok: true }); });
app.get('/api/scenes/:id/versions', async (c) => c.json(await studio.store.versions(c.req.param('id'))));
app.post('/api/scenes/:id/draft', async (c) => { const body = await c.req.json().catch(() => ({})); return c.json(await studio.draft(c.req.param('id'), { agency: body.agency })); });
app.post('/api/characters/:id/mirror', async (c) => c.json(await studio.mirror(c.req.param('id'))));
app.post('/api/characters/:id/decide', async (c) => { const { situation, asOf, save } = await c.req.json(); return c.json(await studio.decide(c.req.param('id'), situation, asOf, { save: save === true })); });
app.post('/api/characters/:id/decisions', async (c) => { const { situation, decision, asOf } = await c.req.json(); await studio.recordDecision(c.req.param('id'), situation, decision, asOf ?? 0); return c.json({ ok: true }); });
app.post('/api/scenes/:id/text', async (c) => { const { text } = await c.req.json(); return c.json(await studio.saveAuthorText(c.req.param('id'), text)); });
app.post('/api/scenes/:id/accept', async (c) => c.json(await studio.accept(c.req.param('id'))));
app.post('/api/scenes/:id/proof', async (c) => c.json(await studio.proofread(c.req.param('id'))));
app.post('/api/outline', async (c) => { const { chapters, per } = await c.req.json(); return c.json(await studio.outline(chapters ?? 3, per ?? 3)); });
app.post('/api/edit', async (c) => { const { passage, note } = await c.req.json(); const revised = await studio.editPassage(passage, note); return c.json({ revised, diff: diffWords(passage, revised) }); });
app.post('/api/muse', async (c) => c.json(await studio.muse(await c.req.json())));
app.get('/api/style', async (c) => c.json(await studio.style()));
app.post('/api/style/sample', async (c) => { const { text } = await c.req.json(); return c.json(await studio.addStyleSample(text)); });
app.post('/api/style/sheet', async (c) => c.json(await studio.refreshStyleSheet()));
app.get('/api/writer', async (c) => c.json(await studio.writer(c.req.query('asOf') ?? undefined)));
app.post('/api/writer/learn', async (c) => c.json(await studio.learnFromEdits()));
app.post('/api/writer/rules', async (c) => { const { action, id, text } = await c.req.json();
  if (action === 'add') return c.json(await studio.addRule(text));
  if (action === 'confirm' || action === 'reject') return c.json(await studio.ruleVerdict(id, action));
  return c.json({ error: 'bad action' }, 400); });
app.post('/api/writer/souls', async (c) => { const { action, name } = await c.req.json();
  if (action === 'save') return c.json({ path: await studio.writerStore.saveSoul(name ?? `snapshot-${Date.now()}`) });
  if (action === 'list') return c.json(await studio.writerStore.listSouls());
  if (action === 'restore') { await studio.writerStore.restoreSoul(name); return c.json({ ok: true }); }
  if (action === 'reset') return c.json(await studio.writerStore.resetSoul());
  return c.json({ error: 'bad action' }, 400); });
app.put('/api/writer/pin', async (c) => { const { asOf } = await c.req.json(); return c.json(await studio.pinWriter(asOf ?? null)); });
app.get('/api/verify', async (c) => c.json(await studio.verifyAll()));
app.get('/api/export.md', async (c) => c.text(await studio.exportMarkdown()));

// static web build, if present
const webDist = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../web/dist');
try { await fs.access(webDist); app.use('/*', serveStatic({ root: path.relative(process.cwd(), webDist) })); } catch { /* dev: use vite */ }

const port = Number(process.env.PORT ?? 8790);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`author-studio server on http://127.0.0.1:${port}  project=${dir}`));
