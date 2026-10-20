import type { CharacterEvent } from './events.js';

export interface Witnessed {
  sceneId: string;
  order: number;
  summary: string;
  learned: string[];
  feeling: string;
}

/** The psychological mirror lives in traits under the psyche.* keys; this projects it. */
export function psycheOf(st: CharacterState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(st.traits)) if (k.startsWith('psyche.')) out[k.slice(7)] = v;
  return out;
}

export interface CharacterState {
  id: string;
  name: string;
  /** The horizon: highest scene order this state knows about. */
  asOf: number;
  traits: Record<string, string>;
  relationships: Record<string, string>;
  witnessed: Witnessed[];
  /** Everything the character knows, in story order. */
  knowledge: string[];
  chats: { order: number; question: string; answer: string }[];
  observations: string[];
  decisions: { order: number; situation: string; decision: string; reasoning: string; emotion: string; cost: string }[];
  eventCount: number;
}

export function emptyState(id: string, asOf: number): CharacterState {
  return {
    id,
    name: id,
    asOf,
    traits: {},
    relationships: {},
    witnessed: [],
    knowledge: [],
    chats: [],
    observations: [],
    decisions: [],
    eventCount: 0,
  };
}

/**
 * Deterministic reducer. Events are applied in (order, seq) order; events with
 * order > asOf are skipped entirely. This is the knowledge horizon.
 */
export function replay(id: string, events: CharacterEvent[], asOf = Number.POSITIVE_INFINITY): CharacterState {
  const state = emptyState(id, asOf === Number.POSITIVE_INFINITY ? maxOrder(events) : asOf);
  const sorted = [...events]
    .filter((e) => e.characterId === id)
    .sort((a, b) => a.order - b.order || a.seq - b.seq);
  for (const e of sorted) {
    if (e.order > asOf) continue;
    state.eventCount += 1;
    switch (e.type) {
      case 'created':
        state.name = e.name;
        break;
      case 'trait.set':
        state.traits[e.key] = e.value;
        break;
      case 'relationship.set':
        state.relationships[e.other] = e.relation;
        break;
      case 'scene.witnessed':
        state.witnessed.push({
          sceneId: e.sceneId,
          order: e.order,
          summary: e.summary,
          learned: e.learned,
          feeling: e.feeling,
        });
        for (const k of e.learned) if (!state.knowledge.includes(k)) state.knowledge.push(k);
        break;
      case 'author.chat':
        state.chats.push({ order: e.order, question: e.question, answer: e.answer });
        break;
      case 'observation':
        state.observations.push(e.text);
        break;
      case 'decision':
        state.decisions.push({ order: e.order, situation: e.situation, decision: e.decision, reasoning: e.reasoning, emotion: e.emotion, cost: e.cost });
        break;
    }
  }
  return state;
}

function maxOrder(events: CharacterEvent[]): number {
  return events.reduce((m, e) => Math.max(m, e.order), 0);
}
