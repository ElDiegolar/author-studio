/**
 * Build a new novel in the library from an imported manuscript.
 * Without AI: chapters and scenes with the author's text (as author versions), the cast the author
 * ticked, who appears in which scene, a guessed POV, and the voice (POV/tense) measured from the prose.
 * With AI: also scene cards, character sheets from the passages they appear in, premise and world,
 * and optionally continuity (facts + every present character witnessing every scene).
 * Either way a few scenes become samples on the writer soul, so drafting starts in their voice.
 */
import { providerFor, type AiConfig } from '../ai/index.js';
import * as roles from '../ai/roles.js';
import { newProjectDir } from '../library.js';
import { aiEnabled } from '../settings.js';
import { Studio } from '../studio.js';
import type { Character, Voice } from '../types.js';
import type { WriterStore } from '../writer/store.js';
import { namesIn, type ImportedChapter } from './structure.js';

export interface ImportOptions {
  title: string;
  genre?: string;
  /** Character names the author kept from the suggestions (or typed). */
  characters: string[];
  /** Use AI for cards, sheets, premise and world (ignored when AI is off). */
  useAi: boolean;
  /** Also extract facts and let characters witness every scene (slow on long books). */
  continuity: boolean;
}

export interface ImportProgress { step: string; done: number; total: number; warnings: string[] }

export async function importIntoLibrary(
  root: string, chapters: ImportedChapter[], opts: ImportOptions, ai: AiConfig,
  writerStore: WriterStore | undefined, onProgress: (p: ImportProgress) => void = () => {},
): Promise<{ dir: string; studio: Studio; warnings: string[] }> {
  const useAi = opts.useAi && aiEnabled(ai);
  const scenes = chapters.flatMap((c, ci) => c.scenes.map((s) => ({ ...s, chapter: ci + 1 })));
  const allText = scenes.map((s) => s.text).join('\n\n');
  const warnings: string[] = [];
  const total = 2 + opts.characters.length + scenes.length + (useAi ? 1 : 0) + (useAi && opts.continuity ? scenes.length : 0);
  let done = 0;
  const tick = (step: string) => onProgress({ step, done: ++done, total, warnings });

  const dir = await newProjectDir(root, opts.title);
  const words = (allText.match(/[\p{L}'’-]+/gu) ?? []).length;
  const studio = await Studio.init(dir, { title: opts.title, genre: opts.genre ?? '', audience: 'adult', targetWords: Math.max(words, 1000), voice: { ...measureVoice(allText), tone: '', bannedWords: [], exemplars: [] } },
    { logline: '', dramaticQuestion: '', theme: '', ending: '' }, { ai, ...(writerStore ? { writerStore } : {}) });
  const chapterTitles = Object.fromEntries(chapters.map((c, i) => [String(i + 1), c.title]).filter(([n, t]) => t && t !== `Chapter ${n}`));
  if (Object.keys(chapterTitles).length) await studio.store.saveProject({ ...(await studio.bible()).project, chapterTitles });
  tick('Created the novel');

  // Premise and world first, so character sheets and cards can be read against them.
  if (useAi) {
    try {
      const book = await roles.importBook(providerFor('architect', ai), scenes.slice(0, 3).map((s) => s.text).join('\n\n'), scenes.slice(-2).map((s) => s.text).join('\n\n'));
      await studio.store.savePremise({ logline: book.logline, dramaticQuestion: book.dramaticQuestion, theme: book.theme, ending: book.ending });
      for (const w of book.world.slice(0, 15)) await studio.store.addWorld({ kind: worldKind(w.kind), name: w.name, summary: w.summary, details: '' });
    } catch (e) { warnings.push(`Premise and world: ${(e as Error).message}`); }
    tick('Read the premise and world');
  }

  const cast: Character[] = [];
  for (const name of opts.characters) {
    let sheet: Omit<Character, 'id'> = { name, role: '', summary: '', want: '', need: '', wound: '', arc: '', voiceSample: '', secrets: [] };
    let traits: { key: string; value: string }[] = [];
    if (useAi) {
      const passages = scenes.flatMap((s) => s.text.split('\n\n')).filter((p) => namesIn(p, [name]).length).slice(0, 14);
      try { const c = await roles.importCast(providerFor('architect', ai), name, passages); ({ traits } = c); sheet = { ...sheet, ...c, name }; delete (sheet as Partial<roles.ImportCast>).traits; }
      catch (e) { warnings.push(`${name}: ${(e as Error).message}`); }
    }
    const c = await studio.store.addCharacter(sheet);
    for (const t of traits) await studio.store.appendEvent({ type: 'trait.set', characterId: c.id, order: 0, key: t.key, value: t.value });
    await studio.store.saveSoul(c.id, 'base');
    cast.push(c);
    tick(`Cast: ${name}`);
  }
  const byName = (n: string) => cast.find((c) => c.name.toLowerCase() === n.toLowerCase()) ?? cast.find((c) => c.name.split(' ')[0]!.toLowerCase() === n.split(' ')[0]!.toLowerCase());

  const places = new Set((await studio.bible()).world.map((w) => w.name.toLowerCase()));
  const sceneIds: string[] = [];
  for (const s of scenes) {
    const present = namesIn(s.text, cast.map((c) => c.name)).map((n) => byName(n)!.id);
    let card = { title: s.title, pov: guessPov(s.text, cast, present), characters: present, location: '', time: '', goal: '', conflict: '', outcome: '', summary: '' };
    if (useAi) {
      try {
        const c = await roles.importCard(providerFor('extractor', ai), s.text, cast.map((x) => x.name));
        const ids = c.characters.map((n) => byName(n)?.id).filter((x): x is string => Boolean(x));
        card = { ...card, ...c, pov: byName(c.pov)?.id ?? card.pov, characters: [...new Set([...ids, ...present])] };
        // Only short, new place names become world entries; "the shed, by the desk" is a description of a known place.
        const loc = c.location.trim().replace(/^the\s+/i, '');
        const known = [...places].some((p) => loc.toLowerCase().includes(p.replace(/^the\s+/, '')) || p.includes(loc.toLowerCase()));
        if (loc && !known && loc.split(/\s+/).length <= 4 && !/[,;]/.test(loc)) { places.add(loc.toLowerCase()); await studio.store.addWorld({ kind: 'location', name: c.location.trim(), summary: '', details: '' }); }
      } catch (e) { warnings.push(`${s.title}: ${(e as Error).message}`); }
    }
    const scene = await studio.store.addScene({ title: card.title, chapter: s.chapter, pov: card.pov, characters: card.characters, goal: card.goal, conflict: card.conflict, outcome: card.outcome, location: card.location, time: card.time, targetWords: Math.max(300, Math.round(s.words / 100) * 100), summary: card.summary });
    await studio.store.saveVersion(scene.id, s.text, 'author');
    await studio.store.updateScene({ ...scene, status: 'drafted' });
    sceneIds.push(scene.id);
    tick(`Scene: ${card.title}`);
  }

  if (useAi && opts.continuity) {
    for (const id of sceneIds) {
      try { await studio.accept(id); } catch (e) { warnings.push(`Continuity for a scene: ${(e as Error).message}`); }
      tick('Continuity: facts and memories');
    }
  }

  // Teach the writer soul from the manuscript itself: the author's own prose is the best sample there is.
  for (const s of pickSamples(scenes.map((x) => x.text))) await studio.addStyleSample(s);
  tick('Learned your voice from the manuscript');
  return { dir, studio, warnings };
}

function worldKind(k: string): 'location' | 'faction' | 'rule' | 'item' | 'glossary' {
  const x = k.toLowerCase();
  return x.startsWith('loc') || x === 'place' ? 'location' : x.startsWith('fac') || x.startsWith('org') ? 'faction' : x.startsWith('it') || x.startsWith('obj') ? 'item' : x.startsWith('rule') ? 'rule' : 'glossary';
}

/** POV guess without AI: the present character named most often outside dialogue. */
function guessPov(text: string, cast: Character[], present: string[]): string {
  const narration = text.replace(/["“][^"”]*["”]/g, ' ');
  let best = present[0] ?? cast[0]?.id ?? ''; let most = -1;
  for (const id of present) {
    const c = cast.find((x) => x.id === id)!;
    const n = (narration.match(new RegExp(`\\b${c.name.split(' ')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length;
    if (n > most) { most = n; best = id; }
  }
  return best;
}

/** POV and tense measured from narration (dialogue removed). */
export function measureVoice(text: string): Pick<Voice, 'pov' | 'tense'> {
  const narration = text.slice(0, 200_000).replace(/["“][^"”]*["”]/g, ' ');
  const words = Math.max(1, (narration.match(/[A-Za-z']+/g) ?? []).length);
  const first = (narration.match(/\b(I|I'm|I've|I'd|me|my|myself)\b/g) ?? []).length;
  const past = (narration.match(/\b(was|were|had|said|looked|walked|turned|felt|saw|thought|knew)\b/g) ?? []).length;
  const present = (narration.match(/\b(is|are|has|says|looks|walks|turns|feels|sees|thinks|knows)\b/g) ?? []).length;
  return { pov: first / words > 0.012 ? 'first' : 'third-limited', tense: present > past * 1.3 ? 'present' : 'past' };
}

/** Three well-spread passages of 300-1500 words to seed the writer soul. */
function pickSamples(texts: string[]): string[] {
  const ok = texts.filter((t) => { const n = t.split(/\s+/).length; return n >= 300; });
  if (!ok.length) return texts.filter(Boolean).slice(0, 1).map((t) => t.slice(0, 9000));
  const picks = [0, Math.floor(ok.length / 2), ok.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return picks.map((i) => ok[i]!.split(/\s+/).slice(0, 1500).join(' '));
}
