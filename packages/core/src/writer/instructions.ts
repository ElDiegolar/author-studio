import type { Voice } from '../types.js';
import { pickExemplars, type WriterState } from './replay.js';

export type StyleView = Pick<WriterState, 'stats' | 'sheet' | 'samples' | 'rules' | 'tendencies'>;

/**
 * The style half of every drafting and editing prompt, from the writer soul. Order of authority:
 * rules the author confirmed, then habits measured from their edits, then the measured stats,
 * the distilled sheet and finally samples of their own prose chosen to fit the scene (`hint`).
 */
export function styleInstructions(w: StyleView, voice: Pick<Voice, 'pov' | 'tense' | 'tone' | 'bannedWords'>, hint = ''): string {
  const lines = [`Point of view: ${voice.pov}. Tense: ${voice.tense}. Tone: ${voice.tone}.`];
  if (voice.bannedWords.length) lines.push(`Never use these words: ${voice.bannedWords.join(', ')}.`);
  const confirmed = w.rules.filter((r) => r.status === 'confirmed');
  const tentative = w.rules.filter((r) => r.status === 'proposed' && r.seen >= 2);
  if (confirmed.length) lines.push(`The author's own rules. Follow them:\n${confirmed.map((r) => `- ${r.text}`).join('\n')}`);
  if (tentative.length) lines.push(`Habits seen repeatedly in the author's edits (not yet confirmed):\n${tentative.map((r) => `- ${r.text}`).join('\n')}`);
  if (w.tendencies.length) lines.push(`When the author rewrites AI drafts they consistently: ${w.tendencies.map((t) => t.text).join('; ')}. Write it that way the first time.`);
  if (w.stats) {
    const s = w.stats;
    lines.push(
      `Match the author's measured habits: average sentence ${s.avgSentenceLen} words (vary, stdev about ${s.sentenceLenStdev}), ` +
      `paragraphs about ${s.avgParagraphLen} words, roughly ${Math.round(s.dialogueRatio * 100)}% of paragraphs carry dialogue, ` +
      `adverbs about ${s.adverbRate} per 100 words, about ${s.commaPerSentence} commas per sentence.`,
    );
  }
  if (w.sheet) lines.push(`Style sheet distilled from the author's own writing:\n${w.sheet}`);
  const ex = pickExemplars(w, hint).map((t) => t.slice(0, 1200));
  if (ex.length) lines.push(`Samples of the author's prose. Write like this, not like a generic novel:\n---\n${ex.join('\n---\n')}\n---`);
  return lines.join('\n');
}
