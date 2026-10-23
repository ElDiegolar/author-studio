import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  Studio, WriterStore, defaultAiConfig, pickExemplars, replayWriter, ruleIdOf, stampWriterEvent, styleDrift,
  styleInstructions, tendencies, measure, type AiConfig, type NewWriterEvent, type WriterEvent,
} from '../src/index.js';

const at = (iso: string) => new Date(iso);
function log(...es: [NewWriterEvent, string][]): WriterEvent[] { return es.map(([e, ts], i) => stampWriterEvent(e, i + 1, at(ts))); }

// AI drafts are wordy: long sentences, adverbs, explicit tags. The author's versions are lean.
const DRAFTS = [
  `She walked slowly and carefully across the wide, empty courtyard, feeling the cold wind that came steadily down from the distant hills. "We should not be here," Jonah said quietly, glancing nervously over his shoulder at the gate. Mara answered him softly that she knew, and that they would leave very soon.`,
  `The rain fell heavily and relentlessly on the old tin roof of the station, drumming loudly in a way that made thinking almost impossible for anyone inside. "Is he coming?" she asked anxiously, pacing back and forth across the narrow room. He replied gently that he honestly did not know anymore.`,
  `He opened the letter very slowly, carefully unfolding each crease as if the paper itself might suddenly break apart in his trembling hands. "Read it to me," she said firmly, leaning forward eagerly. He cleared his throat nervously and began to read aloud in a quiet, uncertain voice.`,
];
const FINALS = [
  `She crossed the courtyard. Cold wind off the hills. "We shouldn't be here." Jonah looked back at the gate. "I know. We won't stay."`,
  `Rain on the tin roof. Loud. Too loud to think. "Is he coming?" She paced. He didn't know. He shrugged.`,
  `He unfolded the letter. Crease by crease. His hands shook. "Read it." She leaned in. He cleared his throat. He read.`,
];

describe('writer soul replay', () => {
  const events = log(
    [{ type: 'sample.added', text: 'Short. Sharp. Done.', source: 'author-sample' }, '2026-01-01T00:00:00Z'],
    [{ type: 'rule.proposed', ruleId: ruleIdOf('Cut dialogue tags'), text: 'Cut dialogue tags', origin: 'edits', evidence: 'he said ->' }, '2026-01-02T00:00:00Z'],
    [{ type: 'rule.proposed', ruleId: ruleIdOf('cut  dialogue tags!'), text: 'cut dialogue tags!', origin: 'edits', evidence: 'she asked ->' }, '2026-01-03T00:00:00Z'],
    [{ type: 'rule.proposed', ruleId: ruleIdOf('Use semicolons'), text: 'Use semicolons', origin: 'edits', evidence: '' }, '2026-01-03T00:00:00Z'],
    [{ type: 'rule.rejected', ruleId: ruleIdOf('Use semicolons') }, '2026-01-04T00:00:00Z'],
    [{ type: 'edit.recorded', draft: DRAFTS[0]!, final: FINALS[0]! }, '2026-06-01T00:00:00Z'],
    [{ type: 'rule.confirmed', ruleId: ruleIdOf('Cut dialogue tags') }, '2026-06-02T00:00:00Z'],
  );

  it('folds repeated proposals of the same rule into one with more evidence', () => {
    const st = replayWriter('w', events);
    const tags = st.rules.find((r) => r.id === ruleIdOf('Cut dialogue tags'))!;
    expect(st.rules).toHaveLength(2);
    expect(tags.seen).toBe(2);
    expect(tags.evidence).toEqual(['he said ->', 'she asked ->']);
    expect(tags.status).toBe('confirmed');
    expect(tags.confidence).toBe(1);
    expect(st.rules.find((r) => r.text === 'Use semicolons')!.confidence).toBe(0);
  });
  it('counts an edit as the author\'s prose and as unlearned', () => {
    const st = replayWriter('w', events);
    expect(st.edits).toHaveLength(1);
    expect(st.samples.map((s) => s.source)).toEqual(['author-sample', 'author-edit']);
    expect(st.unlearnedEdits).toBe(1);
    expect(st.stats?.words).toBeGreaterThan(10);
  });
  it('has a time horizon: as of January it knows neither the edit nor the confirmation', () => {
    const jan = replayWriter('w', events, '2026-01-31T00:00:00Z');
    expect(jan.edits).toEqual([]);
    expect(jan.samples).toHaveLength(1);
    expect(jan.rules.find((r) => r.text === 'Cut dialogue tags')!.status).toBe('proposed');
    expect(jan.asOf).toBe('2026-01-31T00:00:00Z');
  });
  it('a learning pass clears the unlearned count', () => {
    const more = [...events, stampWriterEvent({ type: 'learn.ran', edits: 1 }, 99, at('2026-06-03T00:00:00Z'))];
    expect(replayWriter('w', more).unlearnedEdits).toBe(0);
  });
});

describe('tendencies from edits', () => {
  const edits = DRAFTS.map((d, i) => ({ draft: d, final: FINALS[i]!, at: '' }));
  it('needs two edits that agree', () => {
    expect(tendencies(edits.slice(0, 1))).toEqual([]);
  });
  it('finds that the author shortens sentences, cuts adverbs and cuts tags', () => {
    const keys = tendencies(edits).map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['avgSentenceLen', 'adverbRate', 'tagRate', 'words']));
    const sent = tendencies(edits).find((t) => t.key === 'avgSentenceLen')!;
    expect(sent.change).toBeLessThan(-0.3);
    expect(sent.text).toMatch(/^shortens sentences \(-\d+% on average over 3 edits\)$/);
  });
  it('ignores directions the edits disagree on', () => {
    const mixed = [edits[0]!, { draft: FINALS[1]!, final: DRAFTS[1]!, at: '' }];
    expect(tendencies(mixed).find((t) => t.key === 'avgSentenceLen')).toBeUndefined();
  });
});

describe('exemplars and instructions', () => {
  const talky = '"Where?" she said.\n\n"There." He pointed.\n\n"Why?"\n\n"Because."';
  const lean = 'He ran. The dogs ran. The fence was close.';
  const edit = 'A revised paragraph that still carries some model phrasing in it.';
  it('prefers the author\'s uploads over their revisions of AI text', () => {
    const st = { samples: [{ text: lean, source: 'author-sample' as const, addedAt: '' }, { text: edit, source: 'author-edit' as const, addedAt: '' }] };
    expect(pickExemplars(st, '', 1)).toEqual([lean]);
  });
  it('picks dialogue-heavy samples for a confrontation', () => {
    const st = { samples: [{ text: lean, source: 'author-sample' as const, addedAt: '' }, { text: talky, source: 'author-sample' as const, addedAt: '' }] };
    expect(pickExemplars(st, 'Mara confronts Jonah', 1)).toEqual([talky]);
    expect(pickExemplars(st, 'the chase through the market', 1)).toEqual([lean]);
  });
  it('puts confirmed rules in the prompt, tentative ones only with repeat evidence, never rejected ones', () => {
    const rule = (text: string, status: 'proposed' | 'confirmed' | 'rejected', seen = 1) => ({ id: ruleIdOf(text), text, origin: 'edits' as const, status, seen, evidence: [], confidence: 0 });
    const out = styleInstructions(
      { stats: null, sheet: '', samples: [], tendencies: [], rules: [rule('Cut dialogue tags', 'confirmed'), rule('Open on action', 'proposed', 2), rule('Use fragments', 'proposed', 1), rule('Use semicolons', 'rejected', 3)] },
      { pov: 'third-limited', tense: 'past', tone: 'spare', bannedWords: [] },
    );
    expect(out).toContain('- Cut dialogue tags');
    expect(out).toContain('- Open on action');
    expect(out).not.toContain('Use fragments');
    expect(out).not.toContain('semicolons');
  });
});

describe('style drift check', () => {
  const lean = Array.from({ length: 40 }, (_, i) => `She ran ${i}. The gate held. He looked back.`).join('\n\n');
  const wordy = Array.from({ length: 12 }, () => DRAFTS[0]).join('\n\n');
  it('stays quiet until there is enough of the author to compare with', () => {
    expect(styleDrift(measure('Too little.'), wordy)).toEqual([]);
  });
  it('flags a draft that does not read like the author', () => {
    const f = styleDrift(measure(lean), wordy);
    expect(f.map((x) => x.code)).toContain('style.drift');
    expect(f.some((x) => /longer than yours/.test(x.message))).toBe(true);
  });
  it('passes the author\'s own prose', () => {
    expect(styleDrift(measure(lean), lean)).toEqual([]);
  });
});

describe('studio with a writer soul', () => {
  let tmp: string;
  let server: http.Server;
  let ai: AiConfig;
  const replies: string[] = [];
  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'author-writer-'));
    // A fake OpenAI-compatible model that returns queued replies.
    server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: replies.shift() ?? '{"rules":[]}' } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = defaultAiConfig();
    const local = { provider: 'local' as const, model: 'fake' };
    ai = { ...base, localUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, roles: { architect: local, drafter: local, actor: local, editor: local, extractor: local } };
  });
  afterAll(async () => { server.close(); await fs.rm(tmp, { recursive: true, force: true }); });

  async function project(name: string, writer: WriterStore): Promise<Studio> {
    const s = await Studio.init(path.join(tmp, name), { title: name, genre: 'thriller', audience: 'adult', targetWords: 1000, voice: { pov: 'third-limited', tense: 'past', tone: '', bannedWords: [], exemplars: [] } }, { logline: '', dramaticQuestion: '', theme: '', ending: '' }, { ai, writerStore: writer });
    const c = await s.store.addCharacter({ name: 'Mara', role: 'lead', summary: '', want: '', need: '', wound: '', arc: '', voiceSample: '', secrets: [] });
    await s.store.addScene({ title: 'Gate', chapter: 1, pov: c.id, characters: [c.id], goal: '', conflict: '', outcome: '', location: '', time: '', targetWords: 50, summary: '' });
    return s;
  }

  it('records the draft/final pair when the author rewrites an AI draft, and nothing otherwise', async () => {
    const w = new WriterStore(path.join(tmp, 'writers', 'w1'));
    const s = await project('book1', w);
    const scene = (await s.bible()).scenes[0]!;
    await s.saveAuthorText(scene.id, FINALS[0]!.repeat(5)); // no AI draft before it: not an edit
    expect((await s.writer()).edits).toHaveLength(0);
    await s.store.saveVersion(scene.id, DRAFTS[0]!.repeat(2), 'ai');
    await s.saveAuthorText(scene.id, FINALS[0]!.repeat(5), { autoLearn: false });
    const st = await s.writer();
    expect(st.edits).toHaveLength(1);
    expect(st.edits[0]!.draft).toBe(DRAFTS[0]!.repeat(2));
  });

  it('autosave folds into one version and never teaches; settling records the rewrite once', async () => {
    const w = new WriterStore(path.join(tmp, 'writers', 'auto'));
    const s = await project('bookAuto', w);
    const scene = (await s.bible()).scenes[0]!;
    await s.store.saveVersion(scene.id, DRAFTS[0]!.repeat(2), 'ai');
    await s.saveAuthorText(scene.id, FINALS[0]!, { autosave: true });
    await s.saveAuthorText(scene.id, FINALS[0]!.repeat(5), { autosave: true });
    const vs = await s.store.versions(scene.id);
    expect(vs.map((v) => v.source)).toEqual(['ai', 'author']);
    expect(vs[1]!.text).toBe(FINALS[0]!.repeat(5));
    expect((await s.writer()).edits).toHaveLength(0);
    // Settling the same text adds no version but hands the rewrite to the writer soul, once.
    await s.saveAuthorText(scene.id, FINALS[0]!.repeat(5), { autoLearn: false });
    await s.saveAuthorText(scene.id, FINALS[0]!.repeat(5), { autoLearn: false });
    expect(await s.store.versions(scene.id)).toHaveLength(2);
    const st = await s.writer();
    expect(st.edits).toHaveLength(1);
    expect(st.edits[0]!.draft).toBe(DRAFTS[0]!.repeat(2));
  });

  it('learns rules every third edit, and the author confirms or rejects them', async () => {
    const w = new WriterStore(path.join(tmp, 'writers', 'w2'));
    const s = await project('book2', w);
    const scene = (await s.bible()).scenes[0]!;
    replies.push(JSON.stringify({ rules: [{ text: 'Drop dialogue tags when the speaker is clear', evidence: '"Is he coming?" she asked anxiously -> "Is he coming?"' }, { text: 'Use sentence fragments for atmosphere', evidence: 'Rain on the tin roof. Loud.' }] }));
    let last;
    for (let i = 0; i < 3; i++) {
      await s.store.saveVersion(scene.id, DRAFTS[i]!.repeat(2), 'ai');
      last = await s.saveAuthorText(scene.id, FINALS[i]!.repeat(5));
    }
    expect(last!.proposed?.map((r) => r.text)).toEqual(['Drop dialogue tags when the speaker is clear', 'Use sentence fragments for atmosphere']);
    let st = await s.writer();
    expect(st.unlearnedEdits).toBe(0);
    expect(st.tendencies.map((t) => t.key)).toContain('avgSentenceLen');

    const [tags, frags] = st.rules;
    st = await s.ruleVerdict(tags!.id, 'confirm');
    st = await s.ruleVerdict(frags!.id, 'reject');
    st = await s.addRule('Never open a chapter with weather');
    expect(st.rules.map((r) => [r.text, r.status])).toEqual([
      ['Drop dialogue tags when the speaker is clear', 'confirmed'],
      ['Use sentence fragments for atmosphere', 'rejected'],
      ['Never open a chapter with weather', 'confirmed'],
    ]);
    // A rejected rule proposed again stays rejected and out of the prompt.
    replies.push(JSON.stringify({ rules: [{ text: 'Use sentence fragments for atmosphere', evidence: 'again' }] }));
    await s.store.saveVersion(scene.id, DRAFTS[0]!.repeat(2), 'ai');
    await s.saveAuthorText(scene.id, FINALS[0]!.repeat(5), { autoLearn: false });
    const again = await s.learnFromEdits();
    expect(again.proposed).toEqual([]);
    expect(again.state.rules.find((r) => r.text.startsWith('Use sentence'))!.status).toBe('rejected');
  });

  it('a learning failure never loses the author\'s text', async () => {
    const w = new WriterStore(path.join(tmp, 'writers', 'w3'));
    const s = await project('book3', w);
    const scene = (await s.bible()).scenes[0]!;
    replies.push('not json', 'still not', 'nope');
    let r;
    for (let i = 0; i < 3; i++) {
      await s.store.saveVersion(scene.id, DRAFTS[i]!.repeat(2), 'ai');
      r = await s.saveAuthorText(scene.id, FINALS[i]!.repeat(5));
    }
    expect(r!.findings.map((f) => f.code)).toContain('writer.learn');
    expect((await s.store.latest(scene.id))!.text).toBe(FINALS[2]!.repeat(5));
  });

  it('follows the author across projects, and a project can pin an earlier voice', async () => {
    const w = new WriterStore(path.join(tmp, 'writers', 'shared'));
    const one = await project('series1', w);
    await one.addStyleSample('Book one voice. Short. Hard.');
    const cutoff = new Date(Date.now() + 5).toISOString();
    await new Promise((r) => setTimeout(r, 20));
    const two = await project('series2', w);
    await two.addStyleSample('Book two voice, which has grown longer, looser, more patient with its clauses.');
    expect((await one.writer()).samples).toHaveLength(2);
    await one.pinWriter(cutoff);
    const pinned = await one.writer();
    expect(pinned.samples.map((x) => x.text)).toEqual(['Book one voice. Short. Hard.']);
    expect((await one.writer(null)).samples).toHaveLength(2);
    await one.pinWriter(null);
    expect((await one.bible()).project.writerAsOf).toBeUndefined();
  });

  it('folds a legacy style.json into the soul exactly once', async () => {
    const w = new WriterStore(path.join(tmp, 'writers', 'legacy'));
    const s = await project('legacy', w);
    await fs.writeFile(path.join(s.store.dir, 'style.json'), JSON.stringify({ samples: [{ text: 'Old sample.', source: 'author-sample', addedAt: '' }], stats: null, sheet: 'Old sheet.', updatedAt: '' }));
    await Studio.open(s.store.dir, ai, { writerStore: w });
    const reopened = await Studio.open(s.store.dir, ai, { writerStore: w });
    const st = await reopened.writer();
    expect(st.samples.map((x) => x.text)).toEqual(['Old sample.']);
    expect(st.sheet).toBe('Old sheet.');
  });

  it('snapshots and resets the writer soul without deleting anything', async () => {
    const w = new WriterStore(path.join(tmp, 'writers', 'snap'));
    const s = await project('snap', w);
    await s.addStyleSample('Pen name A.');
    await w.saveSoul('pen-a');
    const { archived } = await w.resetSoul();
    expect((await s.writer()).eventCount).toBe(0);
    await expect(fs.access(archived)).resolves.toBeUndefined();
    await w.restoreSoul('pen-a');
    expect((await s.writer()).samples.map((x) => x.text)).toEqual(['Pen name A.']);
    expect(await w.listSouls()).toEqual(expect.arrayContaining(['pen-a']));
  });
});
