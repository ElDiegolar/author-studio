import type { RuleOrigin, WriterEvent } from './events.js';
import { measure, type StyleSample, type StyleStats } from '../style/profile.js';

export interface WriterRule {
  id: string;
  text: string;
  origin: RuleOrigin;
  status: 'proposed' | 'confirmed' | 'rejected';
  /** How many times the rule was proposed independently (more edits agreeing = more evidence). */
  seen: number;
  evidence: string[];
  /** 1 confirmed, 0 rejected, otherwise grows with independent evidence. */
  confidence: number;
}

/** A habit measured from the author's edits of AI drafts. Deterministic, no model involved. */
export interface Tendency {
  key: keyof typeof TENDENCY_LABELS;
  text: string;
  /** Mean relative change from AI draft to the author's version. */
  change: number;
  edits: number;
}

export interface WriterEdit { draft: string; final: string; sceneId?: string; projectId?: string; at: string }

export interface WriterState {
  writerId: string;
  /** The horizon: events after this time are not known. Null = everything. */
  asOf: string | null;
  samples: StyleSample[];
  edits: WriterEdit[];
  /** Measured over the author's own prose (uploads and their revised text). */
  stats: StyleStats | null;
  sheet: string;
  rules: WriterRule[];
  tendencies: Tendency[];
  /** Edits recorded since the last learning pass. */
  unlearnedEdits: number;
  eventCount: number;
  updatedAt: string;
}

export function emptyWriterState(writerId: string, asOf: string | null = null): WriterState {
  return { writerId, asOf, samples: [], edits: [], stats: null, sheet: '', rules: [], tendencies: [], unlearnedEdits: 0, eventCount: 0, updatedAt: '' };
}

/**
 * Deterministic reducer, in seq order. Events stamped after `asOf` are skipped: that is the
 * writer's horizon, so a series can keep drafting in the voice the author had for book one.
 */
export function replayWriter(writerId: string, events: WriterEvent[], asOf: string | null = null): WriterState {
  const st = emptyWriterState(writerId, asOf);
  const rules = new Map<string, WriterRule>();
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (asOf && e.ts > asOf) continue;
    st.eventCount += 1;
    st.updatedAt = e.ts;
    switch (e.type) {
      case 'sample.added':
        st.samples.push({ text: e.text, source: e.source, ...(e.sceneId ? { sceneId: e.sceneId } : {}), addedAt: e.ts });
        break;
      case 'edit.recorded':
        st.edits.push({ draft: e.draft, final: e.final, at: e.ts, ...(e.sceneId ? { sceneId: e.sceneId } : {}), ...(e.projectId ? { projectId: e.projectId } : {}) });
        st.samples.push({ text: e.final, source: 'author-edit', ...(e.sceneId ? { sceneId: e.sceneId } : {}), addedAt: e.ts });
        st.unlearnedEdits += 1;
        break;
      case 'rule.proposed': {
        const r = rules.get(e.ruleId);
        if (r) { r.seen += 1; if (e.evidence && !r.evidence.includes(e.evidence)) r.evidence.push(e.evidence); }
        else rules.set(e.ruleId, { id: e.ruleId, text: e.text, origin: e.origin, status: 'proposed', seen: 1, evidence: e.evidence ? [e.evidence] : [], confidence: 0 });
        break;
      }
      case 'rule.confirmed': { const r = rules.get(e.ruleId); if (r) r.status = 'confirmed'; break; }
      case 'rule.rejected': { const r = rules.get(e.ruleId); if (r) r.status = 'rejected'; break; }
      case 'sheet.distilled':
        st.sheet = e.text;
        break;
      case 'learn.ran':
        st.unlearnedEdits = 0;
        break;
      case 'imported':
        break;
    }
  }
  st.rules = [...rules.values()].map((r) => ({ ...r, confidence: r.status === 'confirmed' ? 1 : r.status === 'rejected' ? 0 : Math.min(0.9, 0.4 + 0.1 * r.seen) }));
  const corpus = st.samples.map((s) => s.text).join('\n\n');
  st.stats = corpus.trim() ? measure(corpus) : null;
  st.tendencies = tendencies(st.edits);
  return st;
}

export const TENDENCY_LABELS = {
  avgSentenceLen: ['shortens sentences', 'lengthens sentences'],
  avgParagraphLen: ['tightens paragraphs', 'lets paragraphs run longer'],
  adverbRate: ['cuts adverbs', 'adds adverbs'],
  dialogueRatio: ['cuts dialogue', 'adds dialogue'],
  commaPerSentence: ['uses fewer commas', 'uses more commas'],
  words: ['cuts length', 'expands the draft'],
  tagRate: ['cuts dialogue tags', 'adds dialogue tags'],
} as const;

const TAG = /\b(said|asked|replied|whispered|shouted|muttered|murmured|snapped|answered|added)\b/gi;
function tagRate(text: string): number {
  const words = (text.match(/[A-Za-z']+/g) ?? []).length;
  return ((text.match(TAG) ?? []).length / Math.max(1, words)) * 100;
}

function metric(key: keyof typeof TENDENCY_LABELS, text: string): number {
  return key === 'tagRate' ? tagRate(text) : measure(text)[key];
}

/**
 * What the author consistently does to AI drafts. A habit counts when at least two edits agree
 * in direction (75% or more of them) and the mean change is at least 10%.
 */
export function tendencies(edits: WriterEdit[]): Tendency[] {
  if (edits.length < 2) return [];
  const out: Tendency[] = [];
  for (const key of Object.keys(TENDENCY_LABELS) as (keyof typeof TENDENCY_LABELS)[]) {
    const changes: number[] = [];
    for (const e of edits) {
      const before = metric(key, e.draft);
      const after = metric(key, e.final);
      if (!before && !after) continue;
      changes.push((after - before) / Math.max(Math.abs(before), key === 'dialogueRatio' ? 0.1 : 0.5));
    }
    if (changes.length < 2) continue;
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const agree = changes.filter((c) => Math.sign(c) === Math.sign(mean) && c !== 0).length / changes.length;
    if (Math.abs(mean) < 0.1 || agree < 0.75) continue;
    const label = TENDENCY_LABELS[key][mean < 0 ? 0 : 1];
    out.push({ key, text: `${label} (${mean < 0 ? '' : '+'}${Math.round(mean * 100)}% on average over ${changes.length} edits)`, change: Math.round(mean * 100) / 100, edits: changes.length });
  }
  return out;
}

const TALK = /\b(argu|confront|convers|tells?|asks?|negotiat|interrogat|confess|plead|bargain|question|talk|meet)/i;
const ACTION = /\b(fight|chase|escap|run|attack|ambush|flee|storm|race|battle|hunt|break[- ]in|raid)/i;

/**
 * Pick the samples to show the drafter. The author's own uploads outrank their revisions of AI
 * text (which can still carry model phrasing); a dialogue-heavy scene prefers dialogue-heavy
 * samples, an action scene prefers lean ones; recency breaks ties.
 */
export function pickExemplars(st: Pick<WriterState, 'samples'>, hint = '', n = 3): string[] {
  const talk = TALK.test(hint), action = ACTION.test(hint);
  const scored = st.samples.map((s, i) => {
    const m = measure(s.text);
    let score = (s.source === 'author-sample' ? 2 : 1) + i / Math.max(1, st.samples.length);
    if (talk) score += m.dialogueRatio * 2;
    if (action) score += Math.max(0, 1 - m.avgSentenceLen / 25) * 2 - m.dialogueRatio;
    return { text: s.text, score, i };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i).map((s) => s.text);
}
