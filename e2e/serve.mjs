/**
 * Test harness: builds a fresh fixture novel in a temp dir, starts the fake model (unless
 * E2E_LIVE=1, which uses the real provider from ~/.config/author-studio/env), then runs the real
 * HTTP server against them. Writes e2e/.run.json so specs know where everything is.
 * Never touches ~/novels or the real writer soul: AUTHOR_WRITER_HOME points into the temp dir.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeModel } from './fake-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const live = process.env.E2E_LIVE === '1';
const port = Number(process.env.E2E_PORT ?? 8798);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'author-e2e-'));
const project = path.join(tmp, 'novel');
const writerHome = path.join(tmp, 'writers');
process.env.AUTHOR_WRITER_HOME = writerHome;

const { Studio } = await import(path.join(root, 'packages/core/dist/index.js'));
const studio = await Studio.init(project, {
  title: 'The Test Road', genre: 'literary thriller', audience: 'adult', targetWords: 60000,
  voice: { pov: 'third-limited', tense: 'past', tone: 'spare', bannedWords: ['suddenly'], exemplars: [] },
}, { logline: 'A customs clerk keeps a private ledger of a harbour that lies.', dramaticQuestion: 'Will Mara publish the ledger?', theme: 'Records and truth', ending: 'She publishes it and loses her brother.' });
const mara = await studio.store.addCharacter({ name: 'Mara Voss', role: 'protagonist', summary: 'Customs clerk who counts everything.', want: 'to prove the harbour lies', need: 'to trust someone', wound: 'her father\'s disgrace', arc: 'from records to people', voiceSample: 'Eleven boats. There should be twelve.', secrets: ['she copied the manifest'] });
const jonah = await studio.store.addCharacter({ name: 'Jonah Voss', role: 'antagonist', summary: 'Her brother, a pilot in debt.', want: 'to clear his debt', need: 'to stop running', wound: 'being the favourite who failed', arc: 'from debt to choice', voiceSample: 'You always count the wrong things, Mara.', secrets: ['he signed the clearance'] });
for (const c of [mara, jonah]) await studio.store.saveSoul(c.id, 'base');
await studio.relate(mara.id, jonah.id, 'younger brother she does not trust', 'older sister who watches him');
await studio.store.addWorld({ kind: 'location', name: 'Greyhaven', summary: 'The next harbour down the coast.', details: '', introducedAt: 3 });
await studio.store.addWorld({ kind: 'item', name: 'The Albatross', summary: 'A trawler that left without clearance.', details: '' });
await studio.store.addScene({ title: 'The Manifest', chapter: 1, pov: mara.id, characters: [mara.id, jonah.id], goal: 'check the Albatross manifest', conflict: 'Jonah wants it signed unread', outcome: 'Mara keeps a copy', location: 'customs shed', time: 'dawn', targetWords: 150, summary: '' });
await studio.store.addScene({ title: 'Night at the Quay', chapter: 1, pov: mara.id, characters: [mara.id], goal: 'count the boats', conflict: 'one is missing', outcome: 'she suspects Jonah', location: 'the quay', time: 'night', targetWords: 150, summary: '' });
await studio.store.addScene({ title: 'Greyhaven', chapter: 2, pov: mara.id, characters: [mara.id], goal: 'find the Albatross', conflict: 'nobody will talk', outcome: 'she finds the hull', location: 'Greyhaven', time: 'morning', targetWords: 150, summary: '' });

const env = { ...process.env, AUTHOR_PROJECT: project, PORT: String(port), AUTHOR_WRITER_HOME: writerHome };
let fake = null;
if (!live) {
  fake = await startFakeModel();
  Object.assign(env, { AUTHOR_PROVIDER: 'local', AUTHOR_LOCAL_URL: fake.url, AUTHOR_LOCAL_MODEL: 'fake', AUTHOR_LOCAL_THINKING: '0' });
}
await fs.writeFile(path.join(root, 'e2e', '.run.json'), JSON.stringify({ tmp, project, writerHome, live, fakeUrl: fake?.url ?? null, base: `http://127.0.0.1:${port}`, ids: { mara: mara.id, jonah: jonah.id } }, null, 2));

const server = spawn(process.execPath, [path.join(root, 'packages/server/dist/main.js')], { env, stdio: 'inherit' });
const stop = async () => { server.kill(); fake?.server.close(); await fs.rm(tmp, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
server.on('exit', (code) => { fake?.server.close(); process.exit(code ?? 0); });
