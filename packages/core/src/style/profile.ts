/**
 * Writing style developed from the writer.
 * Two layers: measured statistics (deterministic, from the author's own prose) and a
 * style sheet the editor role distils from samples. Every author edit of an AI draft is
 * added as a sample, so the profile keeps converging on the writer, not on the model.
 */
export interface StyleStats {
  words: number;
  avgSentenceLen: number;
  sentenceLenStdev: number;
  avgParagraphLen: number;
  dialogueRatio: number; // share of paragraphs that contain quoted speech
  adverbRate: number; // -ly words per 100 words
  commaPerSentence: number;
  topWords: string[]; // distinctive frequent words, stopwords removed
}

export interface StyleSample { text: string; source: 'author-sample' | 'author-edit'; sceneId?: string; addedAt: string }

export interface StyleProfile {
  samples: StyleSample[];
  stats: StyleStats | null;
  /** Prose description the drafter follows, distilled by the editor role from samples. */
  sheet: string;
  updatedAt: string;
}

const STOP = new Set('the a an and or but of to in on at for with as by from that this it is was were be been he she they we you i his her their its not no so if then than into out up down over under about after before while when where which who whom what had has have do did does said says say'.split(' '));

export function measure(text: string): StyleStats {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z"'“])/).filter((s) => s.trim().length > 1);
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const lens = sentences.map((s) => (s.match(/[a-z']+/gi) ?? []).length);
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const stdev = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lens.length));
  const freq = new Map<string, number>();
  for (const w of words) if (!STOP.has(w) && w.length > 3) freq.set(w, (freq.get(w) ?? 0) + 1);
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
  return {
    words: words.length,
    avgSentenceLen: round(mean),
    sentenceLenStdev: round(stdev),
    avgParagraphLen: round(words.length / Math.max(1, paragraphs.length)),
    dialogueRatio: round(paragraphs.filter((p) => /["“]/.test(p)).length / Math.max(1, paragraphs.length)),
    adverbRate: round((words.filter((w) => w.endsWith('ly') && w.length > 4).length / Math.max(1, words.length)) * 100),
    commaPerSentence: round((text.match(/,/g) ?? []).length / Math.max(1, sentences.length)),
    topWords,
  };
}

export function emptyProfile(): StyleProfile {
  return { samples: [], stats: null, sheet: '', updatedAt: new Date().toISOString() };
}

export function addSample(p: StyleProfile, sample: Omit<StyleSample, 'addedAt'>): StyleProfile {
  const samples = [...p.samples, { ...sample, addedAt: new Date().toISOString() }];
  const corpus = samples.map((s) => s.text).join('\n\n');
  return { ...p, samples, stats: measure(corpus), updatedAt: new Date().toISOString() };
}

/** Render the profile as instructions for the drafter. Stats are turned into concrete targets. */
export function styleInstructions(p: StyleProfile, voice: { pov: string; tense: string; tone: string; bannedWords: string[] }): string {
  const lines = [
    `Point of view: ${voice.pov}. Tense: ${voice.tense}. Tone: ${voice.tone}.`,
  ];
  if (voice.bannedWords.length) lines.push(`Never use these words: ${voice.bannedWords.join(', ')}.`);
  if (p.stats) {
    const s = p.stats;
    lines.push(
      `Match the author's measured habits: average sentence ${s.avgSentenceLen} words (vary, stdev about ${s.sentenceLenStdev}), ` +
      `paragraphs about ${s.avgParagraphLen} words, roughly ${Math.round(s.dialogueRatio * 100)}% of paragraphs carry dialogue, ` +
      `adverbs about ${s.adverbRate} per 100 words, about ${s.commaPerSentence} commas per sentence.`,
    );
  }
  if (p.sheet) lines.push(`Style sheet distilled from the author's own writing:\n${p.sheet}`);
  const ex = p.samples.slice(-3).map((s) => s.text.slice(0, 1200));
  if (ex.length) lines.push(`Samples of the author's prose. Write like this, not like a generic novel:\n---\n${ex.join('\n---\n')}\n---`);
  return lines.join('\n');
}

function round(n: number): number { return Math.round(n * 100) / 100; }
