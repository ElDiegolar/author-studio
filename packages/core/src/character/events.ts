/**
 * Characters are souls: an append-only event log per character, replayed into state.
 * Every event carries `order`, the scene order it belongs to (0 = before the story),
 * so the character's state can be rebuilt "as of" any point in the book.
 */
export interface EventBase {
  seq: number;
  ts: string;
  characterId: string;
  order: number;
}

export type CharacterEvent =
  | (EventBase & { type: 'created'; name: string })
  | (EventBase & { type: 'trait.set'; key: string; value: string })
  | (EventBase & { type: 'relationship.set'; other: string; relation: string })
  | (EventBase & {
      type: 'scene.witnessed';
      sceneId: string;
      summary: string;
      learned: string[];
      feeling: string;
    })
  | (EventBase & { type: 'author.chat'; question: string; answer: string })
  | (EventBase & { type: 'observation'; text: string })
  | (EventBase & {
      type: 'decision';
      situation: string;
      decision: string;
      reasoning: string;
      rejected: string[];
      emotion: string;
      cost: string;
    });

export type NewEvent = CharacterEvent extends infer E
  ? E extends EventBase
    ? Omit<E, 'seq' | 'ts'>
    : never
  : never;

export function stampEvent(e: NewEvent, seq: number, now = new Date()): CharacterEvent {
  return { ...e, seq, ts: now.toISOString() } as CharacterEvent;
}
