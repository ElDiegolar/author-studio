import { describe, expect, it } from 'vitest';
import { replay, type CharacterEvent, stampEvent, leaks, measure, addSample, emptyProfile } from '../src/index.js';
import type { Bible } from '../src/index.js';

function ev(partial: Parameters<typeof stampEvent>[0], seq: number): CharacterEvent { return stampEvent(partial, seq, new Date(0)); }

const events: CharacterEvent[] = [
  ev({ type: 'created', characterId: 'c1', order: 0, name: 'Mara' }, 1),
  ev({ type: 'trait.set', characterId: 'c1', order: 0, key: 'want', value: 'leave the valley' }, 2),
  ev({ type: 'scene.witnessed', characterId: 'c1', order: 1, sceneId: 's1', summary: 'met Jonah at the bridge', learned: ['the bridge is guarded at night'], feeling: 'wary' }, 3),
  ev({ type: 'scene.witnessed', characterId: 'c1', order: 5, sceneId: 's5', summary: 'found the letter', learned: ['Jonah is her brother'], feeling: 'shattered' }, 4),
  ev({ type: 'author.chat', characterId: 'c1', order: 2, question: 'Do you trust Jonah?', answer: 'Not yet.' }, 5),
];

describe('knowledge horizon', () => {
  it('replays everything with no horizon', () => {
    const st = replay('c1', events);
    expect(st.asOf).toBe(5);
    expect(st.knowledge).toEqual(['the bridge is guarded at night', 'Jonah is her brother']);
    expect(st.witnessed).toHaveLength(2);
    expect(st.chats).toHaveLength(1);
  });
  it('as of scene 2 does not know scene 5', () => {
    const st = replay('c1', events, 2);
    expect(st.knowledge).toEqual(['the bridge is guarded at night']);
    expect(st.witnessed.map((w) => w.order)).toEqual([1]);
    expect(st.chats).toHaveLength(1);
    expect(st.traits.want).toBe('leave the valley');
  });
  it('as of scene 0 is the base sheet only', () => {
    const st = replay('c1', events, 0);
    expect(st.knowledge).toEqual([]);
    expect(st.chats).toEqual([]);
    expect(st.name).toBe('Mara');
  });
  it('ignores other characters and orders deterministically', () => {
    const shuffled = [...events].reverse().concat(ev({ type: 'created', characterId: 'c2', order: 0, name: 'Jonah' }, 1));
    expect(replay('c1', shuffled, 2)).toEqual(replay('c1', events, 2));
  });
});

describe('leak detector', () => {
  const bible: Bible = {
    project: { id: 'p', title: 't', genre: 'g', audience: 'a', targetWords: 1000, voice: { pov: 'third-limited', tense: 'past', tone: '', bannedWords: [], exemplars: [] }, createdAt: '' },
    premise: { logline: '', dramaticQuestion: '', theme: '', ending: '' },
    world: [{ id: 'w1', kind: 'location', name: 'Greyhaven', summary: '', details: '', introducedAt: 7 }],
    characters: [
      { id: 'c1', name: 'Mara', role: '', summary: '', want: '', need: '', wound: '', arc: '', voiceSample: '', secrets: [] },
      { id: 'c3', name: 'Ilsa Vane', role: '', summary: '', want: '', need: '', wound: '', arc: '', voiceSample: '', secrets: [] },
    ],
    scenes: [
      { id: 's1', order: 1, chapter: 1, title: '', pov: 'c1', location: '', time: '', goal: '', conflict: '', outcome: '', characters: ['c1'], status: 'accepted', summary: '', targetWords: 1000 },
      { id: 's8', order: 8, chapter: 3, title: '', pov: 'c1', location: '', time: '', goal: '', conflict: '', outcome: '', characters: ['c1', 'c3'], status: 'card', summary: '', targetWords: 1000 },
    ],
    facts: [{ id: 'f1', sceneId: 's6', order: 6, subject: 'mara', predicate: 'owns', object: 'the Ashen Key', text: 'Mara took the Ashen Key' }],
  };
  it('flags names introduced after the horizon', () => {
    const st = replay('c1', events, 2);
    const f = leaks(bible, st, 'I will take the Ashen Key to Greyhaven and find Ilsa.');
    expect(f.map((x) => x.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('Greyhaven'), expect.stringContaining('Ashen'), expect.stringContaining('Ilsa'),
    ]));
  });
  it('is quiet when the answer stays inside the horizon', () => {
    const st = replay('c1', events, 2);
    expect(leaks(bible, st, 'The bridge is guarded at night. I do not trust Jonah yet.')).toEqual([]);
  });
});

describe('style profile', () => {
  it('measures prose and accumulates samples', () => {
    const p = addSample(emptyProfile(), { text: 'She walked slowly. "Why?" he asked. The rain, cold and grey, did not answer.', source: 'author-sample' });
    expect(p.samples).toHaveLength(1);
    expect(p.stats?.words).toBeGreaterThan(10);
    expect(measure('A. B. C.').avgSentenceLen).toBe(1);
  });
});
