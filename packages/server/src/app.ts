/**
 * The Author Studio HTTP app: one library of novels, local settings, and the open novel's API.
 * Used by the dev server (main.ts) and embedded in the desktop app. Binds to 127.0.0.1 only.
 */
import { Hono, type Context } from 'hono';
import { diffWords } from 'diff';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reveal, within } from './reveal.js';
import {
  Studio, WriterStore, aiConfigFrom, aiEnabled, assembleBook, describeProject, exportBook, importIntoLibrary, listLibrary,
  loadSettings, newProjectDir, writerHome, detectAi, testAi, prepareAi, SERVICES, serviceById, listServiceModels, parseManuscript, preview, publicSettings, saveSettings, settingsPath, structure,
  EXPORT_TYPES, IMPORT_EXTENSIONS, type ExportFormat, type ImportedChapter, type ImportProgress, type Parsed, type Settings,
} from '@author-studio/core';

export interface AppOptions {
  /** Folder holding one folder per novel. */
  library: string;
  /** Local settings file (AI mode, key). */
  settingsFile?: string;
  /** Built web app to serve (absolute path); omit in dev (vite serves it). */
  webDist?: string;
  /** Open this novel at start. */
  project?: string;
  /** Called after a novel is opened, e.g. to update the desktop window title. */
  onOpen?: (title: string, dir: string) => void;
  /** Show a path in the file manager; the desktop app passes the native one. */
  reveal?: (p: string) => Promise<void>;
  /** Author Studio AI (the subscription service); default AUTHOR_CLOUD_URL. Without it the choice is hidden. */
  cloudUrl?: string;
}

class NoProject extends Error { constructor() { super('No novel is open. Open or create one from the library.'); } }

interface ImportJob { id: string; name: string; parsed: Parsed; chapters: ImportedChapter[]; progress?: ImportProgress; status: 'previewed' | 'running' | 'done' | 'failed'; error?: string; dir?: string; warnings?: string[] }

export async function createApp(opts: AppOptions): Promise<Hono> {
  const settingsFile = opts.settingsFile ?? settingsPath();
  let settings: Settings | null = await loadSettings(settingsFile);
  let studio: Studio | null = null;
  const S = (): Studio => { if (!studio) throw new NoProject(); return studio; };
  const jobs = new Map<string, ImportJob>();
  await fs.mkdir(opts.library, { recursive: true });

  async function openProject(dir: string): Promise<Studio> {
    const s = await Studio.open(dir, aiConfigFrom(settings));
    studio = s;
    opts.onOpen?.((await s.bible()).project.title, dir);
    return s;
  }
  if (opts.project) await openProject(opts.project);

  const app = new Hono();
  app.onError((e, c) => {
    if (e instanceof NoProject) return c.json({ error: e.message, code: 'no-project' }, 409);
    console.error(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path}: ${e.message}`);
    return c.json({ error: e.message, ...(e.name === 'AiOffError' ? { code: 'ai-off' } : {}) }, 500);
  });

  // ---- library, settings, import, export, reader ----
  app.get('/api/library', async (c) => c.json({ dir: opts.library, current: studio?.store.dir ?? null, projects: await listLibrary(opts.library) }));
  app.post('/api/library/open', async (c) => {
    const { dir } = await c.req.json();
    const abs = path.resolve(dir);
    if (!(await describeProject(abs))) return c.json({ error: 'That folder is not an Author Studio novel.' }, 400);
    await openProject(abs);
    return c.json({ ok: true, dir: abs });
  });
  app.post('/api/library/create', async (c) => {
    const { title, genre, author } = await c.req.json();
    if (!title?.trim()) return c.json({ error: 'A title is required.' }, 400);
    const dir = await newProjectDir(opts.library, title);
    await Studio.init(dir, { title: title.trim(), genre: genre ?? '', audience: 'adult', targetWords: 80000, voice: { pov: 'third-limited', tense: 'past', tone: '', bannedWords: [], exemplars: [] }, ...(author ? { author } : {}) }, { logline: '', dramaticQuestion: '', theme: '', ending: '' });
    const st = await openProject(dir);
    // A blank first scene, so a new book opens straight onto a page to write on.
    await st.store.addScene({ title: 'Scene 1', chapter: 1, pov: '', characters: [], goal: '', conflict: '', outcome: '', location: '', time: '', targetWords: 1500, summary: '' });
    return c.json({ ok: true, dir });
  });
  app.post('/api/library/close', (c) => { studio = null; return c.json({ ok: true }); });

  app.get('/api/settings', (c) => c.json({ ...publicSettings(settings), aiOn: aiEnabled(aiConfigFrom(settings)), settingsFile, library: opts.library, writerHome: writerHome() }));
  // Only the studio's own places can be shown: the library (and every novel in it), settings, the writer soul.
  app.post('/api/reveal', async (c) => {
    const { path: p } = await c.req.json<{ path?: string }>();
    if (!p || !within(p, [opts.library, settingsFile, writerHome(), ...(studio ? [studio.store.dir] : [])])) return c.json({ error: 'That is not one of the studio\'s folders.' }, 403);
    try { await fs.stat(p); } catch { return c.json({ error: 'That folder does not exist yet.' }, 404); }
    try { await (opts.reveal ?? reveal)(p); return c.json({ ok: true }); } catch (e) { return c.json({ error: `Could not open it: ${(e as Error).message}` }, 500); }
  });
  /**
   * The settings a request asks for, on top of what is saved. `apiKey` is the key for the chosen
   * service; an empty field keeps the stored one and clearKey removes it. Other services' keys are
   * kept, and a model picked for one service never leaks into another.
   */
  const merged = (body: Settings['ai'] & { clearKey?: boolean }): Settings => {
    const { clearKey, apiKey: typed, ...ai } = body;
    const prev = settings?.ai;
    const keys = { ...(prev?.keys ?? {}) };
    let apiKey = prev?.apiKey;
    const k = typed?.trim();
    if (ai.mode === 'cloud' && ai.service) { if (clearKey) delete keys[ai.service]; else if (k) keys[ai.service] = k; }
    if (ai.mode === 'anthropic') { if (clearKey) apiKey = undefined; else if (k) apiKey = k; }
    const same = prev && prev.mode === ai.mode && prev.service === ai.service;
    // The subscription's key only ever arrives by device sign-in; the page never sends it back.
    const { studio: _fromPage, ...asked } = ai as Settings['ai'];
    const next: Settings = { ai: { ...(same ? { model: prev.model, cheapModel: prev.cheapModel } : {}), ...asked, ...(apiKey ? { apiKey } : {}), ...(Object.keys(keys).length ? { keys } : {}), ...(prev?.studio ? { studio: prev.studio } : {}) } };
    if (next.ai.mode === 'studio' && !next.ai.studio) next.ai.mode = 'none';
    for (const f of ['model', 'cheapModel', 'localUrl', 'localModel'] as const) if (!next.ai[f]) delete next.ai[f];
    return next;
  };
  const adopt = async (next: Settings) => {
    settings = next;
    await saveSettings(settings, settingsFile);
    if (studio) studio.ai = aiConfigFrom(settings);
    return { ...publicSettings(settings), aiOn: aiEnabled(aiConfigFrom(settings)) };
  };
  app.put('/api/settings', async (c) => c.json(await adopt(merged((await c.req.json() as { ai: Settings['ai'] & { clearKey?: boolean } }).ai))));
  /** What this computer already has: Claude Code, a local model app. */
  app.get('/api/ai/detect', async (c) => c.json(await detectAi()));
  /** Try a choice with one tiny request and keep it only if it works. */
  app.post('/api/ai/connect', async (c) => {
    const ready = await prepareAi(merged((await c.req.json() as { ai: Settings['ai'] }).ai));
    if (!ready.ok) return c.json({ ok: false, reason: ready.reason });
    const t = await testAi(ready.settings);
    if (!t.ok) return c.json({ ok: false, reason: t.reason, models: ready.models });
    return c.json({ ok: true, ms: t.ms, models: ready.models, ...(await adopt(ready.settings)) });
  });
  // ---- Author Studio AI: device sign-in to the subscription ----
  const cloud = (opts.cloudUrl ?? process.env.AUTHOR_CLOUD_URL ?? '').replace(/\/+$/, '');
  let pendingLink: { code: string; pollSecret: string } | null = null;
  const cloudCall = async (route: string, body?: unknown) => {
    const r = await fetch(`${cloud}/${route}`, body === undefined ? { signal: AbortSignal.timeout(15_000) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> };
  };
  app.get('/api/studio-ai', async (c) => {
    const st = settings?.ai.studio;
    // Models are chosen on the service side; pick up a change without an app update.
    if (cloud && st && settings?.ai.mode === 'studio') {
      try { const { body: cfg } = await cloudCall('config'); if (cfg.model && (cfg.model !== st.model || cfg.cheapModel !== st.cheapModel || cfg.portalUrl !== st.portalUrl)) await adopt({ ai: { ...settings.ai, studio: { ...st, model: cfg.model, cheapModel: cfg.cheapModel ?? cfg.model, baseUrl: cfg.baseUrl ?? st.baseUrl, ...(cfg.portalUrl ? { portalUrl: cfg.portalUrl } : {}) } } }); } catch { /* offline: keep what we have */ }
    }
    return c.json({ available: Boolean(cloud), connected: Boolean(st), email: st?.email ?? '', plan: st?.plan ?? '', portalUrl: settings?.ai.studio?.portalUrl ?? '' });
  });
  app.post('/api/studio-ai/start', async (c) => {
    if (!cloud) return c.json({ error: 'Author Studio AI is not available in this version.' }, 404);
    try {
      const { status, body } = await cloudCall('start', { deviceName: os.hostname() });
      if (status !== 200) return c.json({ error: body.error ?? 'Could not start sign-in. Try again.' }, 502);
      pendingLink = { code: body.code, pollSecret: body.pollSecret };
      return c.json({ code: body.code, verifyUrl: body.verifyUrl, interval: body.interval ?? 3, expiresIn: body.expiresIn ?? 600 });
    } catch { return c.json({ error: 'Could not reach Author Studio AI. Check your internet connection.' }, 502); }
  });
  app.post('/api/studio-ai/poll', async (c) => {
    if (!cloud || !pendingLink) return c.json({ status: 'expired' });
    try {
      const { body } = await cloudCall('poll', pendingLink);
      if (body.status !== 'ok') { if (['expired', 'consumed', 'unknown'].includes(body.status)) pendingLink = null; return c.json({ status: body.status ?? 'pending', email: body.email ?? '' }); }
      pendingLink = null;
      const out = await adopt({ ai: { mode: 'studio', ...(settings?.ai.apiKey ? { apiKey: settings.ai.apiKey } : {}), ...(settings?.ai.keys ? { keys: settings.ai.keys } : {}),
        studio: { key: body.key, email: body.email ?? '', plan: body.plan ?? '', baseUrl: body.baseUrl, model: body.model, cheapModel: body.cheapModel ?? body.model, ...(body.portalUrl ? { portalUrl: body.portalUrl } : {}) } } });
      return c.json({ status: 'ok', ...out });
    } catch { return c.json({ status: 'pending' }); }
  });
  /** This month's use, straight from the key's own counters (no account call needed). */
  app.get('/api/studio-ai/usage', async (c) => {
    const st = settings?.ai.studio; if (!st) return c.json({ usage: null, limit: null });
    try {
      const r = await fetch(`${st.baseUrl}/key`, { headers: { authorization: `Bearer ${st.key}` }, signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as { data?: { usage?: number; limit?: number | null; limit_remaining?: number | null; usage_monthly?: number } };
      const used = j.data?.usage_monthly ?? j.data?.usage ?? null; const limit = j.data?.limit ?? null;
      return c.json({ usage: used, limit, fraction: used !== null && limit ? Math.min(1, used / limit) : null });
    } catch { return c.json({ usage: null, limit: null }); }
  });
  app.post('/api/studio-ai/signout', async (c) => {
    if (!settings) return c.json({ ok: true });
    const { studio: _gone, ...ai } = settings.ai;
    return c.json(await adopt({ ai: { ...ai, mode: ai.mode === 'studio' ? 'none' : ai.mode } }));
  });

  /** The hosted services, for the setup screen (no keys in here). */
  app.get('/api/ai/services', (c) => c.json(SERVICES.map(({ prefer, cheap, fallback, baseUrl, tokenParam, thinkingRoom, ...pub }) => pub)));
  /** Models the saved key can use on the chosen service, for the advanced picker. */
  app.get('/api/ai/models', async (c) => {
    const svc = serviceById(c.req.query('service')); const key = svc ? settings?.ai.keys?.[svc.id] : undefined;
    if (!svc || !key) return c.json([]);
    try { return c.json(await listServiceModels(svc, key)); } catch { return c.json([]); }
  });

  app.get('/api/import/formats', (c) => c.json(IMPORT_EXTENSIONS));
  /** Upload: raw file body, name in ?name=. Returns a preview; nothing is written yet. */
  app.post('/api/import/preview', async (c) => {
    const name = c.req.query('name') ?? 'manuscript.txt';
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (!data.length) return c.json({ error: 'The file is empty.' }, 400);
    const parsed = await parseManuscript(name, data);
    const chapters = structure(parsed);
    if (!chapters.length) return c.json({ error: 'No text found in that file.' }, 400);
    const id = Math.random().toString(36).slice(2, 10);
    jobs.set(id, { id, name, parsed, chapters, status: 'previewed' });
    return c.json({ id, ...preview(parsed, chapters), aiOn: aiEnabled(aiConfigFrom(settings)) });
  });
  /** Build the novel in the background; poll GET /api/import/:id. */
  app.post('/api/import/:id/commit', async (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'Import expired; upload the file again.' }, 404);
    if (job.status === 'running') return c.json({ error: 'Already importing.' }, 409);
    const o = await c.req.json() as { title: string; genre?: string; characters: string[]; useAi: boolean; continuity: boolean };
    job.status = 'running';
    const ai = aiConfigFrom(settings);
    void importIntoLibrary(opts.library, job.chapters, { title: o.title || job.parsed.title || 'Imported novel', ...(o.genre ? { genre: o.genre } : {}), characters: o.characters ?? [], useAi: Boolean(o.useAi), continuity: Boolean(o.continuity) }, ai, undefined, (p) => { job.progress = p; })
      .then(async (r) => { job.status = 'done'; job.dir = r.dir; job.warnings = r.warnings; await openProject(r.dir); })
      .catch((e: Error) => { job.status = 'failed'; job.error = e.message; });
    return c.json({ ok: true });
  });
  app.get('/api/import/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    if (!job) return c.json({ error: 'No such import.' }, 404);
    return c.json({ status: job.status, progress: job.progress ?? null, error: job.error ?? null, dir: job.dir ?? null, warnings: job.warnings ?? [] });
  });

  app.get('/api/book', async (c) => c.json(await assembleBook(S())));
  app.get('/api/export/formats', (c) => c.json(EXPORT_TYPES));
  app.get('/api/export/:format', async (c) => {
    const f = c.req.param('format') as ExportFormat;
    if (!(f in EXPORT_TYPES)) return c.json({ error: `Unknown format ${f}` }, 400);
    const { data, mime, filename } = await exportBook(S(), f);
    const inline = c.req.query('inline') === '1';
    return new Response(typeof data === 'string' ? data : Buffer.from(data), { headers: { 'content-type': mime, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}` } });
  });

  // ---- the open novel ----
app.post('/api/agent', async (c) => { const { history, message } = await c.req.json(); return c.json(await S().agent(history ?? [], message)); });
app.get('/api/bible', async (c) => c.json(await S().bible()));
app.put('/api/premise', async (c) => { await S().store.savePremise(await c.req.json()); return c.json({ ok: true }); });
app.put('/api/project', async (c) => { await S().store.saveProject(await c.req.json()); return c.json({ ok: true }); });

app.post('/api/characters', async (c) => { const ch = await S().store.addCharacter(await c.req.json()); await S().store.saveSoul(ch.id, 'base'); return c.json(ch); });
app.put('/api/characters/:id', async (c) => { await S().updateCharacterSafe(c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
app.post('/api/characters/build', async (c) => { const { id, history, message } = await c.req.json(); return c.json(await S().buildTurn(id ?? null, history ?? [], message)); });
app.post('/api/characters/apply', async (c) => { const { id, edits } = await c.req.json(); return c.json(await S().applyEdits(id ?? null, edits)); });
// add=true with a `seed` saves that exact (possibly author-edited) proposal; without one it proposes and saves in one go.
app.post('/api/characters/seed', async (c) => { const { inspiration, notes, add, seed } = await c.req.json(); if (add && seed) return c.json(await S().addSeeded(seed)); const s = await S().seed(inspiration, notes); return c.json(add ? await S().addSeeded(s) : s); });
app.get('/api/characters/:id/state', async (c) => c.json(await S().state(c.req.param('id'), c.req.query('asOf') ? Number(c.req.query('asOf')) : undefined)));
app.get('/api/characters/:id/events', async (c) => c.json(await S().store.events(c.req.param('id'))));
app.post('/api/characters/:id/chat', async (c) => { const { message, asOf, history } = await c.req.json(); return c.json(await S().chat(c.req.param('id'), message, asOf, history ?? [])); });
app.post('/api/characters/:id/observe', async (c) => { const { text } = await c.req.json(); await S().observe(c.req.param('id'), text); return c.json({ ok: true }); });
app.get('/api/characters/:id/souls', async (c) => c.json(await S().store.listSouls(c.req.param('id'))));
app.post('/api/characters/:id/souls', async (c) => { const { action, name } = await c.req.json(); const id = c.req.param('id');
  if (action === 'save') return c.json({ path: await S().store.saveSoul(id, name ?? `snapshot-${Date.now()}`) });
  if (action === 'restore') { await S().store.restoreSoul(id, name); return c.json({ ok: true }); }
  if (action === 'reset') return c.json(await S().store.resetSoul(id));
  return c.json({ error: 'bad action' }, 400); });

app.post('/api/characters/:id/relate', async (c) => { const { otherId, relation, mutual } = await c.req.json(); await S().relate(c.req.param('id'), otherId, relation, mutual); return c.json({ ok: true }); });
app.post('/api/world', async (c) => c.json(await S().store.addWorld(await c.req.json())));
app.post('/api/scenes', async (c) => { const body = await c.req.json(); return c.json(await S().store.addScene({ summary: '', ...body })); });
app.put('/api/scenes/:id', async (c) => { await S().store.updateScene(await c.req.json()); return c.json({ ok: true }); });
app.get('/api/scenes/:id/versions', async (c) => c.json(await S().store.versions(c.req.param('id'))));
app.post('/api/scenes/:id/draft', async (c) => { const body = await c.req.json().catch(() => ({})); return c.json(await S().draft(c.req.param('id'), { agency: body.agency })); });
app.post('/api/characters/:id/mirror', async (c) => c.json(await S().mirror(c.req.param('id'))));
app.post('/api/characters/:id/decide', async (c) => { const { situation, asOf, save } = await c.req.json(); return c.json(await S().decide(c.req.param('id'), situation, asOf, { save: save === true })); });
app.post('/api/characters/:id/decisions', async (c) => { const { situation, decision, asOf } = await c.req.json(); await S().recordDecision(c.req.param('id'), situation, decision, asOf ?? 0); return c.json({ ok: true }); });
app.post('/api/scenes/:id/text', async (c) => { const { text, autosave } = await c.req.json(); return c.json(await S().saveAuthorText(c.req.param('id'), text, { autosave: !!autosave })); });
app.post('/api/scenes/:id/accept', async (c) => c.json(await S().accept(c.req.param('id'))));
app.post('/api/scenes/:id/proof', async (c) => c.json(await S().proofread(c.req.param('id'))));
app.post('/api/outline', async (c) => { const { chapters, per } = await c.req.json(); return c.json(await S().outline(chapters ?? 3, per ?? 3)); });
app.post('/api/edit', async (c) => { const { passage, note } = await c.req.json(); const revised = await S().editPassage(passage, note); return c.json({ revised, diff: diffWords(passage, revised) }); });
app.post('/api/muse', async (c) => c.json(await S().muse(await c.req.json())));
app.get('/api/style', async (c) => c.json(await S().style()));
app.post('/api/style/sample', async (c) => { const { text } = await c.req.json(); return c.json(await S().addStyleSample(text)); });
app.post('/api/style/sheet', async (c) => c.json(await S().refreshStyleSheet()));
app.get('/api/writer', async (c) => c.json(await S().writer(c.req.query('asOf') ?? undefined)));
app.post('/api/writer/learn', async (c) => c.json(await S().learnFromEdits()));
app.post('/api/writer/rules', async (c) => { const { action, id, text } = await c.req.json();
  if (action === 'add') return c.json(await S().addRule(text));
  if (action === 'confirm' || action === 'reject') return c.json(await S().ruleVerdict(id, action));
  return c.json({ error: 'bad action' }, 400); });
app.post('/api/writer/souls', async (c) => { const { action, name } = await c.req.json();
  if (action === 'save') return c.json({ path: await S().writerStore.saveSoul(name ?? `snapshot-${Date.now()}`) });
  if (action === 'list') return c.json(await S().writerStore.listSouls());
  if (action === 'restore') { await S().writerStore.restoreSoul(name); return c.json({ ok: true }); }
  if (action === 'reset') return c.json(await S().writerStore.resetSoul());
  return c.json({ error: 'bad action' }, 400); });
app.put('/api/writer/pin', async (c) => { const { asOf } = await c.req.json(); return c.json(await S().pinWriter(asOf ?? null)); });
app.get('/api/verify', async (c) => c.json(await S().verifyAll()));
app.get('/api/export.md', async (c) => c.text(await S().exportMarkdown()));


  // ---- the web app ----
  if (opts.webDist) {
    const root = opts.webDist;
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
    app.get('*', async (c: Context) => {
      if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
      const rel = path.normalize(decodeURIComponent(c.req.path)).replace(/^([/\\])+/, '');
      let file = path.join(root, rel);
      if (!file.startsWith(root)) return c.text('forbidden', 403);
      try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html'); } catch { file = path.join(root, 'index.html'); }
      const body = await fs.readFile(file);
      return new Response(body, { headers: { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' } });
    });
  }
  return app;
}

export { WriterStore };
