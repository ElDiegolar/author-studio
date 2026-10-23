/**
 * Deterministic checks. No model is consulted here; this is what decides who is right.
 */
import type { Bible, Fact, Scene } from '../types.js';
import type { CharacterState } from '../character/replay.js';
import { measure, type StyleStats } from '../style/profile.js';

export interface Finding { level: 'error' | 'warn'; code: string; message: string }

export function verifyScene(bible: Bible, scene: Scene, text: string): Finding[] {
  const out: Finding[] = [];
  const words = (text.match(/[A-Za-z']+/g) ?? []).length;
  if (words < scene.targetWords * 0.6) out.push({ level: 'warn', code: 'length.short', message: `${words} words, target ${scene.targetWords}` });
  if (words > scene.targetWords * 1.6) out.push({ level: 'warn', code: 'length.long', message: `${words} words, target ${scene.targetWords}` });

  for (const w of bible.project.voice.bannedWords) {
    const re = new RegExp(`\\b${escape(w)}\\b`, 'i');
    if (re.test(text)) out.push({ level: 'error', code: 'style.banned', message: `banned word "${w}"` });
  }

  const pov = bible.characters.find((c) => c.id === scene.pov);
  // No POV yet is fine (a scene written by hand, or imported without a cast); a dangling one is not.
  if (scene.pov && !pov) out.push({ level: 'error', code: 'scene.pov', message: `POV character ${scene.pov} does not exist` });
  for (const id of scene.characters) if (!bible.characters.some((c) => c.id === id)) out.push({ level: 'error', code: 'scene.cast', message: `character ${id} does not exist` });

  if (bible.project.voice.pov === 'first') {
    const firstPerson = (text.match(/\b(I|I'm|I've|I'd|my|me)\b/g) ?? []).length;
    if (firstPerson < 3) out.push({ level: 'warn', code: 'pov.first', message: 'first-person POV but almost no first-person pronouns' });
  } else if (pov) {
    const firstPerson = (text.match(/\b(I|I'm|I've|my)\b/g) ?? []).length;
    const quoted = (text.match(/["“][^"”]*["”]/g) ?? []).join(' ');
    const inDialogue = (quoted.match(/\b(I|I'm|I've|my)\b/g) ?? []).length;
    if (firstPerson - inDialogue > 5) out.push({ level: 'warn', code: 'pov.third', message: 'third-person POV but first-person narration detected outside dialogue' });
  }

  if (bible.project.voice.tense === 'past') {
    const present = (text.match(/\b(walks|says|looks|turns|feels|sees|thinks|is|are)\b/g) ?? []).length;
    const past = (text.match(/\b(walked|said|looked|turned|felt|saw|thought|was|were)\b/g) ?? []).length;
    if (present > past * 1.5 && present > 10) out.push({ level: 'warn', code: 'tense.present', message: 'past tense set but prose reads as present tense' });
  }

  // Names of characters NOT present should not speak or act in the scene (they may be mentioned).
  for (const c of bible.characters) {
    if (scene.characters.includes(c.id)) continue;
    const re = new RegExp(`\\b${escape(c.name.split(' ')[0] ?? c.name)}\\b\\s+(said|asked|replied|walked|turned|looked|stepped|grabbed|whispered|shouted)`, 'i');
    if (re.test(text)) out.push({ level: 'warn', code: 'scene.absent-acts', message: `${c.name} is not on the scene card but appears to act in the scene` });
  }
  return out;
}

/**
 * Style drift: does this text read like the writer? Compares measured stats against the writer
 * soul's. Quiet until there are about 300 words of the author's own prose to compare against.
 */
export function styleDrift(writer: StyleStats | null, text: string): Finding[] {
  if (!writer || writer.words < 300) return [];
  const m = measure(text);
  if (m.words < 150) return [];
  const out: Finding[] = [];
  const rel = (a: number, b: number) => (a - b) / Math.max(b, 0.5);
  const sent = rel(m.avgSentenceLen, writer.avgSentenceLen);
  if (Math.abs(sent) > 0.35) out.push({ level: 'warn', code: 'style.drift', message: `sentences average ${m.avgSentenceLen} words, ${Math.round(Math.abs(sent) * 100)}% ${sent > 0 ? 'longer' : 'shorter'} than yours (${writer.avgSentenceLen})` });
  const para = rel(m.avgParagraphLen, writer.avgParagraphLen);
  if (Math.abs(para) > 0.5) out.push({ level: 'warn', code: 'style.drift', message: `paragraphs average ${m.avgParagraphLen} words vs your ${writer.avgParagraphLen}` });
  if (m.adverbRate - writer.adverbRate > 1 && m.adverbRate > writer.adverbRate * 1.5) out.push({ level: 'warn', code: 'style.drift', message: `${m.adverbRate} adverbs per 100 words vs your ${writer.adverbRate}` });
  if (Math.abs(m.dialogueRatio - writer.dialogueRatio) > 0.3) out.push({ level: 'warn', code: 'style.drift', message: `${Math.round(m.dialogueRatio * 100)}% of paragraphs carry dialogue vs your ${Math.round(writer.dialogueRatio * 100)}%` });
  return out;
}

/** Contradictions in the ledger: same subject+predicate, different object. */
export function continuity(facts: Fact[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Map<string, Fact>();
  const volatile = /^(would|will|plan|intend|feel|think|want|decide|say|said|location|position)/;
  for (const f of [...facts].sort((a, b) => a.order - b.order)) {
    if (f.single === false || volatile.test(f.predicate) || f.subject === 'narrator' || f.subject === 'i') continue; // locations and intentions change scene to scene
    const key = `${f.subject}|${f.predicate}`;
    const prev = seen.get(key);
    if (prev && prev.object !== f.object)
      out.push({ level: 'error', code: 'continuity', message: `scene ${f.order}: "${f.text}" contradicts scene ${prev.order}: "${prev.text}"` });
    else if (!prev) seen.set(key, f);
  }
  return out;
}

export function timeline(scenes: Scene[]): Finding[] {
  const out: Finding[] = [];
  const orders = scenes.map((s) => s.order);
  if (new Set(orders).size !== orders.length) out.push({ level: 'error', code: 'timeline.dup', message: 'duplicate scene order' });
  let ch = 0;
  for (const s of [...scenes].sort((a, b) => a.order - b.order)) {
    if (s.chapter < ch) out.push({ level: 'error', code: 'timeline.chapter', message: `scene ${s.order} is in chapter ${s.chapter} after chapter ${ch}` });
    ch = Math.max(ch, s.chapter);
  }
  return out;
}

/**
 * Horizon leak detector: a character answer must not contain proper nouns or facts that are
 * introduced after the character's horizon. Deterministic, so it checks the model, not trusts it.
 */
export function leaks(bible: Bible, st: CharacterState, answer: string): Finding[] {
  const out: Finding[] = [];
  const futureNames = new Set<string>();
  for (const w of bible.world) if (w.introducedAt !== undefined && w.introducedAt > st.asOf) futureNames.add(w.name);
  for (const f of bible.facts) if (f.order > st.asOf) {
    for (const tok of f.text.match(/\b[A-Z][a-z]{2,}\b/g) ?? []) futureNames.add(tok);
  }
  // names of characters whose first appearance is after the horizon
  for (const c of bible.characters) {
    const first = bible.scenes.filter((s) => s.characters.includes(c.id)).map((s) => s.order).sort((a, b) => a - b)[0];
    if (first !== undefined && first > st.asOf && !st.knowledge.join(' ').includes(c.name)) futureNames.add(c.name.split(' ')[0] ?? c.name);
  }
  const common = new Set(['The', 'And', 'But', 'She', 'They', 'There', 'This', 'That', 'What', 'When', 'Where', 'Why', 'How', 'Yes', 'Not', 'You', 'Then']);
  for (const n of futureNames) {
    if (common.has(n) || st.knowledge.join(' ').includes(n)) continue;
    if (new RegExp(`\\b${escape(n)}\\b`).test(answer)) out.push({ level: 'error', code: 'horizon.leak', message: `answer mentions "${n}", which is introduced after scene ${st.asOf}` });
  }
  return out;
}

function escape(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
