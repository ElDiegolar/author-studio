/**
 * From blocks to a book: chapters (headings) holding scenes (scene breaks), plus a suggested cast
 * found without any AI. Long stretches with no breaks are cut at paragraph boundaries so no
 * scene is unworkably long.
 */
import type { Block, Parsed } from './parse.js';

export interface ImportedScene { title: string; text: string; words: number }
export interface ImportedChapter { title: string; scenes: ImportedScene[] }
export interface CastCandidate { name: string; count: number; dialogue: number }
export interface ImportPreview {
  format: string;
  title: string;
  words: number;
  chapters: { title: string; scenes: number; words: number }[];
  scenes: number;
  candidates: CastCandidate[];
  /** True when the file named its characters outright (Final Draft), so candidates are exact. */
  exactCast: boolean;
}

const MAX_SCENE_WORDS = 3500;
const wc = (s: string) => (s.match(/[\p{L}'’-]+/gu) ?? []).length;

export function structure(parsed: Parsed): ImportedChapter[] {
  const chapters: ImportedChapter[] = [];
  let ch: ImportedChapter | null = null;
  let paras: string[] = [];
  const flush = () => {
    if (!paras.length) return;
    if (!ch) { ch = { title: '', scenes: [] }; chapters.push(ch); }
    // Split overlong runs at paragraph boundaries.
    let cur: string[] = []; let n = 0;
    const push = () => { if (cur.length) ch!.scenes.push({ title: '', text: cur.join('\n\n'), words: n }); cur = []; n = 0; };
    for (const p of paras) { const w = wc(p); if (n + w > MAX_SCENE_WORDS && n > MAX_SCENE_WORDS / 3) push(); cur.push(p); n += w; }
    push();
    paras = [];
  };
  for (const b of parsed.blocks) {
    if (b.kind === 'heading') {
      // A level-1 heading right before a level-2 one (Part I / Chapter 1) is folded into the chapter title.
      flush();
      if (ch && !ch.scenes.length && ch.title) { ch.title = `${ch.title}: ${b.text}`.replace(/^: |: $/g, ''); continue; }
      ch = { title: b.text, scenes: [] };
      chapters.push(ch);
    } else if (b.kind === 'break') flush();
    else paras.push(b.text);
  }
  flush();
  const kept = chapters.filter((c) => c.scenes.length);
  // A book with no chapter headings at all: group scenes into chapters of about 4,500 words.
  if (kept.length === 1 && kept[0]!.scenes.length > 4 && !kept[0]!.title) {
    const regrouped: ImportedChapter[] = []; let cur: ImportedChapter = { title: '', scenes: [] }; let n = 0;
    for (const s of kept[0]!.scenes) { if (n > 4500) { regrouped.push(cur); cur = { title: '', scenes: [] }; n = 0; } cur.scenes.push(s); n += s.words; }
    if (cur.scenes.length) regrouped.push(cur);
    return name(regrouped);
  }
  return name(kept);
}

function name(chapters: ImportedChapter[]): ImportedChapter[] {
  chapters.forEach((c, i) => {
    c.title = c.title || `Chapter ${i + 1}`;
    c.scenes.forEach((s, j) => { s.title = c.scenes.length === 1 ? c.title : `${c.title}, scene ${j + 1}`; });
  });
  return chapters;
}

const NOT_NAMES = new Set(('I The A An And But Or So Then When Where What Who Why How If It Its He She They We You His Her Their Our Your This That These Those There Here ' +
  'Yes No Not Oh Ah Well Now Just Still Even Only Once After Before Again Maybe Perhaps Mr Mrs Ms Miss Dr Sir Lady Lord Saint St God ' +
  'On In At For From To With By Of As Later Though Although Because Since While Until Meanwhile Outside Inside Above Below Behind Beside Without Within Today Tonight Tomorrow Yesterday Morning Evening Night ' +
  'Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December ' +
  'Chapter Part Book Prologue Epilogue One Two Three Four Five Six Seven Eight Nine Ten Nothing Everything Something Someone Everyone Nobody Somebody ' +
  'Christmas Easter English French German Spanish Italian American British Mom Dad Mum Mother Father Okay OK Hey Hello Goodbye Please Thanks Thank Sorry Good Great All Every Each').split(' '));
const SAY = /^(?:said|asked|replied|whispered|shouted|muttered|murmured|called|answered|added|snapped|cried|told)\b/;

/** Likely characters: capitalised words that are not sentence-initial and recur, boosted by dialogue tags. */
export function castCandidates(chapters: ImportedChapter[], limit = 16): CastCandidate[] {
  const count = new Map<string, number>(); const dialogue = new Map<string, number>(); const initial = new Map<string, number>();
  for (const c of chapters) for (const s of c.scenes) {
    for (const m of s.text.matchAll(/(^|[.!?…]["”’]?\s+|["“‘]\s*|[^\p{L}\s]?\s)(\p{Lu}[\p{Ll}'’]+(?:\s\p{Lu}[\p{Ll}'’]+){0,2})/gu)) {
      // "Then Mara Voss" / "When Elias": drop leading and trailing common words, keep up to two name words.
      const words = m[2]!.split(' ');
      let lead = m[1]!;
      // Keep the last run of name-like words: "On Monday Mara" -> "Mara".
      const cut = words.reduce((at, w, i) => (NOT_NAMES.has(w) ? i + 1 : at), 0);
      if (cut) { words.splice(0, cut); lead = ' '; }
      if (!words.length) continue;
      const key = words.slice(0, 2).join(' ');
      const sentenceStart = lead === '' || /[.!?…]["”’]?\s+$|^["“‘]\s*$/.test(lead);
      if (sentenceStart) { initial.set(key, (initial.get(key) ?? 0) + 1); continue; }
      count.set(key, (count.get(key) ?? 0) + 1);
      const after = s.text.slice(m.index! + m[0].length, m.index! + m[0].length + 12).trim();
      if (SAY.test(after)) dialogue.set(key, (dialogue.get(key) ?? 0) + 1);
    }
  }
  // Merge "Mara" into "Mara Voss" when the full name exists.
  for (const full of [...count.keys()].filter((k) => k.includes(' '))) {
    const first = full.split(' ')[0]!;
    if (count.has(first) || initial.has(first)) {
      count.set(full, count.get(full)! + (count.get(first) ?? 0)); initial.set(full, (initial.get(full) ?? 0) + (initial.get(first) ?? 0));
      dialogue.set(full, (dialogue.get(full) ?? 0) + (dialogue.get(first) ?? 0));
      count.delete(first); dialogue.delete(first); initial.delete(first);
    }
  }
  for (const [k, n] of initial) if (!count.has(k) && n >= 3 && !NOT_NAMES.has(k)) count.set(k, 0);
  return [...count.entries()]
    .map(([name, n]) => ({ name, count: n + (initial.get(name) ?? 0), dialogue: dialogue.get(name) ?? 0 }))
    .filter((c) => c.count >= 3)
    .sort((a, b) => b.dialogue * 3 + b.count - (a.dialogue * 3 + a.count))
    .slice(0, limit);
}

export function preview(parsed: Parsed, chapters: ImportedChapter[]): ImportPreview {
  const exact = Boolean(parsed.characters?.length);
  const candidates = exact ? parsed.characters!.map((name) => ({ name, count: 0, dialogue: 0 })) : castCandidates(chapters);
  return {
    format: parsed.format,
    title: parsed.title?.trim() || 'Imported novel',
    words: chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + s.words, 0), 0),
    chapters: chapters.map((c) => ({ title: c.title, scenes: c.scenes.length, words: c.scenes.reduce((m, s) => m + s.words, 0) })),
    scenes: chapters.reduce((n, c) => n + c.scenes.length, 0),
    candidates,
    exactCast: exact,
  };
}

/** Which of `names` appear in `text` (first names count). */
export function namesIn(text: string, names: string[]): string[] {
  return names.filter((n) => new RegExp(`\\b(${[n, n.split(' ')[0]].map((x) => x!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`).test(text));
}
