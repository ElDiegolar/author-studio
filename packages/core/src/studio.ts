/**
 * Studio: the one facade every front end (CLI, MCP, HTTP) uses. Holds no state beyond
 * the project directory; every call reads and writes the files the author owns.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FileStore } from './store/fileStore.js';
import { providerFor, type AiConfig, defaultAiConfig } from './ai/index.js';
import * as roles from './ai/roles.js';
import { replay, psycheOf, type CharacterState } from './character/replay.js';
import type { Bible, Character, Fact, Premise, Project, Scene, SceneVersion } from './types.js';
import { addSample, emptyProfile, type StyleProfile } from './style/profile.js';
import { continuity, leaks, timeline, verifyScene, type Finding } from './verify/verifier.js';

export class Studio {
  constructor(readonly store: FileStore, readonly ai: AiConfig = defaultAiConfig()) {}

  static async init(dir: string, project: Omit<Project, 'id' | 'createdAt'>, premise: Premise): Promise<Studio> {
    return new Studio(await FileStore.init(dir, project, premise));
  }
  static async open(dir: string, ai?: AiConfig): Promise<Studio> {
    return new Studio(await FileStore.open(dir), ai);
  }

  bible(): Promise<Bible> { return this.store.bible(); }

  // ---- souls ----
  async state(characterId: string, asOf?: number): Promise<CharacterState> {
    const st = replay(characterId, await this.store.events(characterId), asOf);
    const c = (await this.bible()).characters.find((x) => x.id === characterId);
    if (c) st.name = c.name;
    return st;
  }
  async statesForScene(scene: Scene): Promise<CharacterState[]> {
    return Promise.all(scene.characters.map((id) => this.state(id, scene.order - 1)));
  }

  /** Update the static sheet; name changes are also recorded on the soul. */
  async updateCharacterSafe(id: string, patch: Partial<Character>): Promise<Character> {
    const c = Studio.characterOf(await this.bible(), id);
    const next = { ...c, ...patch, id };
    await this.store.updateCharacter(next);
    if (patch.name && patch.name !== c.name) await this.store.appendEvent({ type: 'created', characterId: id, order: 0, name: patch.name });
    return next;
  }

  // ---- style ----
  private stylePath(): string { return path.join(this.store.dir, 'style.json'); }
  async style(): Promise<StyleProfile> {
    try { return JSON.parse(await fs.readFile(this.stylePath(), 'utf8')) as StyleProfile; } catch { return emptyProfile(); }
  }
  private async saveStyle(p: StyleProfile): Promise<void> { await fs.writeFile(this.stylePath(), JSON.stringify(p, null, 2)); }
  /** Feed the author's own prose in; the drafter imitates it from then on. */
  async addStyleSample(text: string, source: 'author-sample' | 'author-edit' = 'author-sample', sceneId?: string): Promise<StyleProfile> {
    const p = addSample(await this.style(), sceneId ? { text, source, sceneId } : { text, source });
    await this.saveStyle(p);
    return p;
  }
  async refreshStyleSheet(): Promise<StyleProfile> {
    const p = await this.style();
    if (!p.samples.length) return p;
    const sheet = await roles.styleSheet(providerFor('editor', this.ai), p.samples.slice(-5).map((s) => s.text));
    const next = { ...p, sheet, updatedAt: new Date().toISOString() };
    await this.saveStyle(next);
    return next;
  }

  // ---- structure ----
  async outline(chapters: number, scenesPerChapter = 3): Promise<Scene[]> {
    const bible = await this.bible();
    const cards = await roles.outline(providerFor('architect', this.ai), bible, chapters, scenesPerChapter);
    const added: Scene[] = [];
    for (const card of cards) added.push(await this.store.addScene({ ...card, summary: '' }));
    return added;
  }

  // ---- drafting ----
  async draft(sceneId: string, opts: { agency?: boolean | string[] } = {}): Promise<{ version: SceneVersion; findings: Finding[]; decisions?: { name: string; decision: string; emotion: string }[] }> {
    const bible = await this.bible();
    const scene = mustScene(bible, sceneId);
    let decisions: { name: string; decision: string; emotion: string }[] | undefined;
    const agents = Studio.agents(scene.characters, opts.agency);
    if (agents.size) {
      decisions = [];
      for (const id of agents) {
        const c = bible.characters.find((x) => x.id === id); if (!c) continue;
        const d = await this.decide(id, `Scene ${scene.order}, ${scene.title}. ${scene.location ? `At ${scene.location}, ${scene.time}. ` : ''}Goal of the scene: ${scene.goal}. Conflict: ${scene.conflict}. What do you do?`, scene.order);
        decisions.push({ name: c.name, decision: d.decision, emotion: d.emotion });
      }
    }
    const states = await this.statesForScene(scene);
    const prev = bible.scenes.filter((s) => s.order < scene.order).sort((a, b) => b.order - a.order)[0];
    const facts = bible.facts.filter((f) => f.order < scene.order).slice(-60);
    const text = await roles.draft(providerFor('drafter', this.ai), { bible, scene, states, facts, previousSummary: prev?.summary ?? '', style: await this.style(), ...(decisions ? { decisions } : {}) });
    const version = await this.store.saveVersion(sceneId, text, 'ai');
    if (scene.status === 'card') await this.store.updateScene({ ...scene, status: 'drafted' });
    return { version, findings: verifyScene(bible, scene, text), ...(decisions ? { decisions } : {}) };
  }

  /** The author's own text for a scene. If it edits an AI draft, the edit becomes a style sample. */
  async saveAuthorText(sceneId: string, text: string): Promise<{ version: SceneVersion; findings: Finding[] }> {
    const bible = await this.bible();
    const scene = mustScene(bible, sceneId);
    const prev = await this.store.latest(sceneId);
    const version = await this.store.saveVersion(sceneId, text, 'author');
    if (prev?.source === 'ai' && text !== prev.text && text.length > 400) await this.addStyleSample(text, 'author-edit', sceneId);
    if (scene.status === 'card') await this.store.updateScene({ ...scene, status: 'drafted' });
    return { version, findings: verifyScene(bible, scene, text) };
  }

  async editPassage(passage: string, note: string): Promise<string> {
    return roles.edit(providerFor('editor', this.ai), passage, note, await this.style(), await this.bible());
  }

  /**
   * Accept the latest version: extract facts into the ledger and let every present character
   * witness the scene (append scene.witnessed to their souls). Re-accepting replaces both.
   */
  async accept(sceneId: string): Promise<{ facts: Fact[]; witnessed: string[]; findings: Finding[] }> {
    const bible = await this.bible();
    const scene = mustScene(bible, sceneId);
    const v = await this.store.latest(sceneId);
    if (!v) throw new Error('scene has no text to accept');
    const extractor = providerFor('extractor', this.ai);
    await this.store.removeFactsForScene(sceneId);
    const facts = await this.store.addFacts(await roles.extractFacts(extractor, scene, v.text));
    const witnessed: string[] = [];
    for (const id of scene.characters) {
      const c = bible.characters.find((x) => x.id === id);
      if (!c) continue;
      await this.store.retractScene(id, sceneId);
      const w = await roles.witness(extractor, c, scene, v.text);
      await this.store.appendEvent({ type: 'scene.witnessed', characterId: id, order: scene.order, sceneId, summary: w.summary, learned: w.learned, feeling: w.feeling });
      witnessed.push(c.name);
    }
    const summary = facts.length ? `${scene.goal} -> ${scene.outcome}` : scene.outcome;
    await this.store.updateScene({ ...scene, status: 'accepted', summary: scene.summary || summary });
    const all = await this.bible();
    return { facts, witnessed, findings: [...continuity(all.facts), ...timeline(all.scenes)] };
  }

  // ---- character room ----
  async chat(characterId: string, message: string, asOf?: number, history: { role: 'user' | 'assistant'; content: string }[] = []): Promise<{ answer: string; findings: Finding[]; state: CharacterState }> {
    const bible = await this.bible();
    const c = bible.characters.find((x) => x.id === characterId);
    if (!c) throw new Error(`no character ${characterId}`);
    const st = await this.state(characterId, asOf);
    const answer = await roles.chat(providerFor('actor', this.ai), c, st, history, message, this.knownPeople(bible, c, st));
    const findings = leaks(bible, st, answer);
    await this.store.appendEvent({ type: 'author.chat', characterId, order: st.asOf, question: message, answer });
    return { answer, findings, state: st };
  }

  /** Names this character can legitimately use: relationships on the soul, plus anyone they have shared an accepted scene with by the horizon. */
  knownPeople(bible: Bible, c: Character, st: CharacterState): string {
    const lines: string[] = [];
    const met = new Set<string>();
    for (const s of bible.scenes) if (s.order <= st.asOf && s.characters.includes(c.id)) for (const id of s.characters) if (id !== c.id) met.add(id);
    for (const other of bible.characters) {
      if (other.id === c.id) continue;
      const rel = st.relationships[other.id] ?? st.relationships[other.name];
      if (rel) lines.push(`- ${other.name}: ${rel}`);
      else if (met.has(other.id)) lines.push(`- ${other.name} (${other.role}): someone you have met`);
    }
    return lines.join('\n');
  }

  /** Build (or rebuild) the psychological mirror from the sheet and the lived soul; stored as psyche.* traits at order 0. */
  async mirror(characterId: string): Promise<roles.Psyche> {
    const bible = await this.bible();
    const c = Studio.characterOf(bible, characterId);
    const st = await this.state(characterId);
    const psyche = await roles.mirror(providerFor('architect', this.ai), c, st);
    for (const [k, v] of Object.entries(psyche)) await this.store.appendEvent({ type: 'trait.set', characterId, order: 0, key: `psyche.${k}`, value: v });
    return psyche;
  }
  async psyche(characterId: string): Promise<Record<string, string>> { return psycheOf(await this.state(characterId)); }

  /** The character decides for themselves. The decision is appended to the soul at `order`. */
  async decide(characterId: string, situation: string, order?: number): Promise<roles.Decision & { order: number }> {
    const bible = await this.bible();
    const c = Studio.characterOf(bible, characterId);
    const st = await this.state(characterId, order);
    const d = await roles.decide(providerFor('actor', this.ai), c, st, situation, this.knownPeople(bible, c, st));
    const at = order ?? st.asOf;
    await this.store.appendEvent({ type: 'decision', characterId, order: at, situation, decision: d.decision, reasoning: d.reasoning, rejected: d.rejected, emotion: d.emotion, cost: d.cost });
    return { ...d, order: at };
  }

  async relate(characterId: string, otherId: string, relation: string, mutual?: string): Promise<void> {
    const bible = await this.bible();
    Studio.characterOf(bible, characterId); Studio.characterOf(bible, otherId);
    await this.store.appendEvent({ type: 'relationship.set', characterId, order: 0, other: otherId, relation });
    if (mutual) await this.store.appendEvent({ type: 'relationship.set', characterId: otherId, order: 0, other: characterId, relation: mutual });
  }

  async observe(characterId: string, text: string, order = 0): Promise<void> {
    await this.store.appendEvent({ type: 'observation', characterId, order, text });
  }

  /** Seed an original character from a reference ("like Deckard", "a Miss Havisham figure"). Author reviews before it is added. */
  async seed(inspiration: string, notes?: string): Promise<roles.SeedResult> {
    return roles.seedCharacter(providerFor('architect', this.ai), await this.bible(), inspiration, notes);
  }
  async addSeeded(seed: roles.SeedResult): Promise<Character> {
    const { traits, ...sheet } = seed;
    const c = await this.store.addCharacter(sheet);
    for (const t of traits) await this.store.appendEvent({ type: 'trait.set', characterId: c.id, order: 0, key: t.key, value: t.value });
    await this.store.saveSoul(c.id, 'base');
    return c;
  }

  /** Which of `ids` act with agency: true = all, false/undefined = none, array = those ids. The rest adhere to the drafter or author. */
  private static agents(ids: string[], agency: boolean | string[] | undefined): Set<string> {
    if (agency === true) return new Set(ids);
    if (Array.isArray(agency)) return new Set(agency.filter((id) => ids.includes(id)));
    return new Set();
  }

  /** Everything is chat: one author message through the studio agent (tool loop over this facade). */
  async agent(history: { role: 'user' | 'assistant'; content: string }[], message: string, onEvent?: (e: import('./agent.js').AgentEvent) => void): Promise<{ reply: string; events: import('./agent.js').AgentEvent[] }> {
    const { runAgent } = await import('./agent.js');
    return runAgent(this, providerFor('architect', this.ai), history, message, onEvent);
  }

  // ---- chat-based character building ----
  /** One turn of the builder conversation. Edits are proposals until applyEdits is called. */
  async buildTurn(characterId: string | null, history: { role: 'user' | 'assistant'; content: string }[], message: string): Promise<roles.BuilderTurn> {
    const bible = await this.bible();
    const current = characterId ? { sheet: Studio.characterOf(bible, characterId), state: await this.state(characterId) } : null;
    return roles.builderTurn(providerFor('architect', this.ai), bible, current, history, message);
  }

  /** Apply builder edits: creates the character if none, updates the sheet, appends traits/relationships to the soul, snapshots it. */
  async applyEdits(characterId: string | null, edits: roles.EditOp[]): Promise<Character> {
    const bible = await this.bible();
    const fields = ['name', 'role', 'summary', 'want', 'need', 'wound', 'arc', 'voiceSample'] as const;
    type F = (typeof fields)[number];
    let c: Character;
    if (characterId) c = Studio.characterOf(bible, characterId);
    else {
      const name = edits.find((e) => e.op === 'set' && e.field === 'name')?.value;
      if (!name) throw new Error('a new character needs a name edit first');
      c = await this.store.addCharacter({ name, role: '', summary: '', want: '', need: '', wound: '', arc: '', voiceSample: '', secrets: [] });
    }
    const next: Character = { ...c, secrets: [...c.secrets] };
    for (const e of edits) {
      if (e.op === 'set' && e.field && (fields as readonly string[]).includes(e.field)) {
        next[e.field as F] = e.value;
        if (e.field !== 'name' && e.field !== 'summary' && e.field !== 'voiceSample' && e.field !== 'arc') await this.store.appendEvent({ type: 'trait.set', characterId: next.id, order: 0, key: e.field, value: e.value });
        if (e.field === 'name' && e.value !== c.name) await this.store.appendEvent({ type: 'created', characterId: next.id, order: 0, name: e.value });
      } else if (e.op === 'secret') { if (!next.secrets.includes(e.value)) next.secrets.push(e.value); }
      else if (e.op === 'trait' && e.key) await this.store.appendEvent({ type: 'trait.set', characterId: next.id, order: 0, key: e.key, value: e.value });
      else if (e.op === 'relate' && e.other) { if (bible.characters.some((x) => x.id === e.other)) await this.store.appendEvent({ type: 'relationship.set', characterId: next.id, order: 0, other: e.other, relation: e.value }); }
    }
    await this.store.updateCharacter(next);
    await this.store.saveSoul(next.id, characterId ? `edited-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}` : 'base');
    return next;
  }

  // ---- muse ----
  /**
   * Ideas for writer's block. With `agency` on, each character first decides what they would do in
   * the scenario (ephemeral: nothing is written to their soul) and the muse builds on those choices.
   */
  async muse(opts: { asOf?: number; characters?: string[]; scenario?: string; count?: number; agency?: boolean | string[] } = {}): Promise<{ ideas: roles.MuseIdea[]; decisions: { name: string; decision: string; reasoning: string; emotion: string }[] }> {
    const bible = await this.bible();
    const ids = opts.characters?.length ? opts.characters : bible.characters.map((c) => c.id);
    const states = await Promise.all(ids.map((id) => this.state(id, opts.asOf)));
    const decisions: { name: string; decision: string; reasoning: string; emotion: string }[] = [];
    const agents = Studio.agents(ids, opts.agency);
    if (agents.size && opts.scenario) {
      for (const st of states) {
        if (!agents.has(st.id)) continue;
        const c = bible.characters.find((x) => x.id === st.id); if (!c) continue;
        const d = await roles.decide(providerFor('actor', this.ai), c, st, opts.scenario, this.knownPeople(bible, c, st));
        decisions.push({ name: c.name, decision: d.decision, reasoning: d.reasoning, emotion: d.emotion });
      }
    }
    const ideas = await roles.muse(providerFor('architect', this.ai), bible, states, opts.scenario, opts.count ?? 6, decisions);
    return { ideas, decisions };
  }

  /** Mechanical proofreading pass; returns issues the author applies or ignores. */
  async proofread(sceneId: string): Promise<roles.ProofIssue[]> {
    const v = await this.store.latest(sceneId);
    if (!v) throw new Error('scene has no text');
    const deterministic: roles.ProofIssue[] = [];
    for (const m of v.text.matchAll(/\b(\w+)\s+\1\b/gi)) deterministic.push({ original: m[0], fix: m[1]!, reason: 'repeated word' });
    for (const m of v.text.matchAll(/[.!?]{2,}(?!\.)|,,|\s,/g)) deterministic.push({ original: m[0], fix: m[0][0]!, reason: 'doubled punctuation' });
    const ai = await roles.proofread(providerFor('extractor', this.ai), v.text);
    return [...deterministic, ...ai.filter((i) => !deterministic.some((d) => d.original === i.original))];
  }

  // ---- verification & export ----
  async verifyAll(): Promise<Record<string, Finding[]>> {
    const bible = await this.bible();
    const out: Record<string, Finding[]> = { continuity: continuity(bible.facts), timeline: timeline(bible.scenes) };
    for (const s of bible.scenes) {
      const v = await this.store.latest(s.id);
      if (v) out[`scene:${s.order}`] = verifyScene(bible, s, v.text);
    }
    return out;
  }

  async exportMarkdown(): Promise<string> {
    const bible = await this.bible();
    const parts = [`# ${bible.project.title}\n`];
    let chapter = 0;
    for (const s of bible.scenes) {
      const v = await this.store.latest(s.id);
      if (!v) continue;
      if (s.chapter !== chapter) { chapter = s.chapter; parts.push(`\n## Chapter ${chapter}\n`); }
      parts.push(v.text.trim(), '\n\n* * *\n');
    }
    return parts.join('\n');
  }

  static characterOf(bible: Bible, id: string): Character {
    const c = bible.characters.find((x) => x.id === id);
    if (!c) throw new Error(`no character ${id}`);
    return c;
  }
}

function mustScene(bible: Bible, id: string): Scene {
  const s = bible.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`no scene ${id}`);
  return s;
}
