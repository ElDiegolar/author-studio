/**
 * One project = one directory the author owns.
 *   project.json premise.json world.json characters.json scenes.json facts.json
 *   events/<characterId>.jsonl          append-only soul of each character
 *   souls/<characterId>/<name>.jsonl    saved snapshots of a soul
 *   manuscript/<sceneId>/v<N>.md        every version of every scene
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Bible, Character, Fact, Premise, Project, Scene, SceneVersion, WorldEntry } from '../types.js';
import { newId } from '../types.js';
import type { CharacterEvent, NewEvent } from '../character/events.js';
import { stampEvent } from '../character/events.js';

export class FileStore {
  constructor(readonly dir: string) {}

  static async init(dir: string, project: Omit<Project, 'id' | 'createdAt'>, premise: Premise): Promise<FileStore> {
    await fs.mkdir(dir, { recursive: true });
    const s = new FileStore(dir);
    const p: Project = { ...project, id: newId('proj'), createdAt: new Date().toISOString() };
    await s.writeJson('project.json', p);
    await s.writeJson('premise.json', premise);
    await s.writeJson('world.json', []);
    await s.writeJson('characters.json', []);
    await s.writeJson('scenes.json', []);
    await s.writeJson('facts.json', []);
    await fs.mkdir(path.join(dir, 'events'), { recursive: true });
    await fs.mkdir(path.join(dir, 'manuscript'), { recursive: true });
    await fs.mkdir(path.join(dir, 'souls'), { recursive: true });
    return s;
  }

  static async open(dir: string): Promise<FileStore> {
    await fs.access(path.join(dir, 'project.json'));
    return new FileStore(dir);
  }

  // ---- bible ----
  async bible(): Promise<Bible> {
    const [project, premise, world, characters, scenes, facts] = await Promise.all([
      this.readJson<Project>('project.json'),
      this.readJson<Premise>('premise.json'),
      this.readJson<WorldEntry[]>('world.json'),
      this.readJson<Character[]>('characters.json'),
      this.readJson<Scene[]>('scenes.json'),
      this.readJson<Fact[]>('facts.json'),
    ]);
    scenes.sort((a, b) => a.order - b.order);
    return { project, premise, world, characters, scenes, facts };
  }
  async saveProject(p: Project): Promise<void> { await this.writeJson('project.json', p); }
  async savePremise(p: Premise): Promise<void> { await this.writeJson('premise.json', p); }

  async addWorld(entry: Omit<WorldEntry, 'id'>): Promise<WorldEntry> {
    const all = await this.readJson<WorldEntry[]>('world.json');
    const e: WorldEntry = { ...entry, id: newId('w') };
    all.push(e);
    await this.writeJson('world.json', all);
    return e;
  }

  async updateWorld(e: WorldEntry): Promise<void> {
    const all = await this.readJson<WorldEntry[]>('world.json');
    const i = all.findIndex((x) => x.id === e.id);
    if (i < 0) throw new Error(`no world entry ${e.id}`);
    all[i] = e;
    await this.writeJson('world.json', all);
  }

  async addCharacter(c: Omit<Character, 'id'>): Promise<Character> {
    const all = await this.readJson<Character[]>('characters.json');
    const ch: Character = { ...c, id: newId('c') };
    all.push(ch);
    await this.writeJson('characters.json', all);
    await this.appendEvent({ type: 'created', characterId: ch.id, order: 0, name: ch.name });
    for (const [key, value] of Object.entries({ role: c.role, want: c.want, need: c.need, wound: c.wound }))
      if (value) await this.appendEvent({ type: 'trait.set', characterId: ch.id, order: 0, key, value });
    return ch;
  }
  async updateCharacter(c: Character): Promise<void> {
    const all = await this.readJson<Character[]>('characters.json');
    const i = all.findIndex((x) => x.id === c.id);
    if (i < 0) throw new Error(`no character ${c.id}`);
    all[i] = c;
    await this.writeJson('characters.json', all);
  }

  async addScene(s: Omit<Scene, 'id' | 'status' | 'order'> & { order?: number }): Promise<Scene> {
    const all = await this.readJson<Scene[]>('scenes.json');
    const order = s.order ?? (all.reduce((m, x) => Math.max(m, x.order), 0) + 1);
    const sc: Scene = { ...s, order, id: newId('s'), status: 'card' };
    all.push(sc);
    await this.writeJson('scenes.json', all);
    return sc;
  }
  async updateScene(s: Scene): Promise<void> {
    const all = await this.readJson<Scene[]>('scenes.json');
    const i = all.findIndex((x) => x.id === s.id);
    if (i < 0) throw new Error(`no scene ${s.id}`);
    all[i] = s;
    await this.writeJson('scenes.json', all);
  }

  async addFacts(facts: Omit<Fact, 'id'>[]): Promise<Fact[]> {
    const all = await this.readJson<Fact[]>('facts.json');
    const added = facts.map((f) => ({ ...f, id: newId('f') }));
    all.push(...added);
    await this.writeJson('facts.json', all);
    return added;
  }
  async removeFactsForScene(sceneId: string): Promise<void> {
    const all = await this.readJson<Fact[]>('facts.json');
    await this.writeJson('facts.json', all.filter((f) => f.sceneId !== sceneId));
  }

  // ---- manuscript ----
  async versions(sceneId: string): Promise<SceneVersion[]> {
    const d = path.join(this.dir, 'manuscript', sceneId);
    let names: string[] = [];
    try { names = await fs.readdir(d); } catch { return []; }
    const out: SceneVersion[] = [];
    for (const n of names.filter((x) => /^v\d+\.md$/.test(x))) {
      const raw = await fs.readFile(path.join(d, n), 'utf8');
      const m = /^<!-- (\{.*\}) -->\n/.exec(raw);
      const meta = m ? (JSON.parse(m[1]!) as { source: 'ai' | 'author'; createdAt: string }) : { source: 'author' as const, createdAt: '' };
      out.push({ sceneId, version: Number(n.slice(1, -3)), text: m ? raw.slice(m[0].length) : raw, ...meta });
    }
    return out.sort((a, b) => a.version - b.version);
  }
  async latest(sceneId: string): Promise<SceneVersion | undefined> {
    const v = await this.versions(sceneId);
    return v[v.length - 1];
  }
  async saveVersion(sceneId: string, text: string, source: 'ai' | 'author'): Promise<SceneVersion> {
    const d = path.join(this.dir, 'manuscript', sceneId);
    await fs.mkdir(d, { recursive: true });
    const prev = await this.versions(sceneId);
    const version = (prev[prev.length - 1]?.version ?? 0) + 1;
    const createdAt = new Date().toISOString();
    await fs.writeFile(path.join(d, `v${version}.md`), `<!-- ${JSON.stringify({ source, createdAt })} -->\n${text}`);
    return { sceneId, version, text, source, createdAt };
  }

  // ---- souls (character event logs) ----
  private eventsPath(characterId: string): string { return path.join(this.dir, 'events', `${characterId}.jsonl`); }

  async events(characterId: string): Promise<CharacterEvent[]> {
    let raw = '';
    try { raw = await fs.readFile(this.eventsPath(characterId), 'utf8'); } catch { return []; }
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as CharacterEvent);
  }
  async appendEvent(e: NewEvent): Promise<CharacterEvent> {
    const prev = await this.events(e.characterId);
    const stamped = stampEvent(e, (prev[prev.length - 1]?.seq ?? 0) + 1);
    await fs.appendFile(this.eventsPath(e.characterId), JSON.stringify(stamped) + '\n');
    return stamped;
  }
  /** Remove every event tied to a scene (used when a scene is re-accepted). */
  async retractScene(characterId: string, sceneId: string): Promise<number> {
    const prev = await this.events(characterId);
    const kept = prev.filter((e) => !(e.type === 'scene.witnessed' && e.sceneId === sceneId));
    await fs.writeFile(this.eventsPath(characterId), kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
    return prev.length - kept.length;
  }

  /** Save the whole soul under a name. Snapshots are immutable copies of the log. */
  async saveSoul(characterId: string, name: string): Promise<string> {
    const safe = name.replace(/[^a-z0-9_-]+/gi, '-');
    const d = path.join(this.dir, 'souls', characterId);
    await fs.mkdir(d, { recursive: true });
    const dest = path.join(d, `${safe}.jsonl`);
    const events = await this.events(characterId);
    await fs.writeFile(dest, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    return dest;
  }
  async listSouls(characterId: string): Promise<string[]> {
    try { return (await fs.readdir(path.join(this.dir, 'souls', characterId))).filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6)); }
    catch { return []; }
  }
  /** Replace the live log with a saved snapshot. The replaced log is archived first. */
  async restoreSoul(characterId: string, name: string): Promise<void> {
    const src = path.join(this.dir, 'souls', characterId, `${name}.jsonl`);
    await fs.access(src);
    await this.saveSoul(characterId, `before-restore-${Date.now()}`);
    await fs.copyFile(src, this.eventsPath(characterId));
  }
  /**
   * Reset to base: keep only the order-0 sheet events (created, traits, relationships).
   * Everything the character lived or discussed is archived under souls/, not deleted.
   */
  async resetSoul(characterId: string): Promise<{ kept: number; archived: string }> {
    const archived = await this.saveSoul(characterId, `before-reset-${Date.now()}`);
    const prev = await this.events(characterId);
    const base = prev.filter((e) => e.order === 0 && (e.type === 'created' || e.type === 'trait.set' || e.type === 'relationship.set'));
    await fs.writeFile(this.eventsPath(characterId), base.map((e) => JSON.stringify(e)).join('\n') + (base.length ? '\n' : ''));
    return { kept: base.length, archived };
  }

  // ---- io ----
  private async readJson<T>(name: string): Promise<T> {
    return JSON.parse(await fs.readFile(path.join(this.dir, name), 'utf8')) as T;
  }
  private async writeJson(name: string, value: unknown): Promise<void> {
    const tmp = path.join(this.dir, `.${name}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, path.join(this.dir, name));
  }
}
