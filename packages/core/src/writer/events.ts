/**
 * The writer is a soul too: an append-only log of everything the studio learns about how the
 * author writes, replayed into a style state. It lives outside any one project
 * (writers/<writerId>/events.jsonl) so it follows the author from book to book.
 * Its horizon is time: replaying "as of" a date gives the voice the author had then.
 */
export interface WriterEventBase {
  seq: number;
  ts: string;
  /** Project the event came from, when it came from one. */
  projectId?: string;
}

export type RuleOrigin = 'edits' | 'samples' | 'author';

export type WriterEvent =
  | (WriterEventBase & { type: 'sample.added'; text: string; source: 'author-sample' | 'author-edit'; sceneId?: string })
  /** The author rewrote an AI draft. The pair is the strongest style signal there is. */
  | (WriterEventBase & { type: 'edit.recorded'; draft: string; final: string; sceneId?: string })
  /** Proposing the same rule text again adds evidence to it instead of a duplicate. */
  | (WriterEventBase & { type: 'rule.proposed'; ruleId: string; text: string; origin: RuleOrigin; evidence: string })
  | (WriterEventBase & { type: 'rule.confirmed'; ruleId: string })
  | (WriterEventBase & { type: 'rule.rejected'; ruleId: string })
  | (WriterEventBase & { type: 'sheet.distilled'; text: string })
  /** Marks a learning pass over the edits recorded before it. */
  | (WriterEventBase & { type: 'learn.ran'; edits: number })
  /** A legacy per-project style.json was folded into this soul. */
  | (WriterEventBase & { type: 'imported'; from: string; count: number });

export type NewWriterEvent = WriterEvent extends infer E
  ? E extends WriterEventBase
    ? Omit<E, 'seq' | 'ts'>
    : never
  : never;

export function stampWriterEvent(e: NewWriterEvent, seq: number, now = new Date()): WriterEvent {
  return { ...e, seq, ts: now.toISOString() } as WriterEvent;
}

/** Stable id for a rule's text, so the same rule proposed twice is one rule. */
export function ruleIdOf(text: string): string {
  const norm = text.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return `r_${h.toString(36)}`;
}
