/** The book is a database. These are its tables. */

export interface Voice {
  pov: 'first' | 'third-limited' | 'third-omniscient';
  tense: 'past' | 'present';
  tone: string;
  bannedWords: string[];
  exemplars: string[];
}

export interface Project {
  id: string;
  title: string;
  genre: string;
  audience: string;
  targetWords: number;
  voice: Voice;
  createdAt: string;
}

export interface Premise {
  logline: string;
  dramaticQuestion: string;
  theme: string;
  ending: string;
}

export type WorldKind = 'location' | 'faction' | 'rule' | 'item' | 'glossary';

export interface WorldEntry {
  id: string;
  kind: WorldKind;
  name: string;
  summary: string;
  details: string;
  /** Scene order at which this entry first appears on the page (undefined = background). */
  introducedAt?: number;
}

/** Static character sheet. Everything that changes over the story lives in events. */
export interface Character {
  id: string;
  name: string;
  role: string;
  summary: string;
  want: string;
  need: string;
  wound: string;
  arc: string;
  voiceSample: string;
  secrets: string[];
}

export type SceneStatus = 'card' | 'drafted' | 'accepted';

export interface Scene {
  id: string;
  order: number;
  chapter: number;
  title: string;
  pov: string; // character id
  location: string; // world entry id or free text
  time: string;
  goal: string;
  conflict: string;
  outcome: string;
  characters: string[]; // character ids present
  status: SceneStatus;
  summary: string;
  targetWords: number;
}

export interface SceneVersion {
  sceneId: string;
  version: number;
  text: string;
  source: 'ai' | 'author';
  createdAt: string;
}

/** A fact asserted by the prose. subject/predicate/object are normalised lowercase. */
export interface Fact {
  id: string;
  sceneId: string;
  order: number;
  subject: string;
  predicate: string;
  object: string;
  text: string;
  /** True when the property can hold only one value at a time (eye colour, age, birthplace). Only these can contradict. */
  single?: boolean;
}

export interface Bible {
  project: Project;
  premise: Premise;
  world: WorldEntry[];
  characters: Character[];
  scenes: Scene[];
  facts: Fact[];
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
