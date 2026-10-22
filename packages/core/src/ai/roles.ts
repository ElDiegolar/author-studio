import { z } from 'zod/v4';
import type { Bible, Character, Fact, Scene } from '../types.js';
import type { CharacterState } from '../character/replay.js';
import type { Provider } from './provider.js';
import { ACTOR_SYSTEM, ARCHITECT_SYSTEM, BUILDER_SYSTEM, DRAFTER_SYSTEM, EDITOR_SYSTEM, EXTRACTOR_SYSTEM, IMPORT_BOOK_SYSTEM, IMPORT_CARD_SYSTEM, IMPORT_CAST_SYSTEM, LEARN_RULES_SYSTEM, DECIDE_SYSTEM, MIRROR_SYSTEM, MUSE_SYSTEM, PROOFREADER_SYSTEM, SEED_SYSTEM, STYLE_SHEET_SYSTEM, WITNESS_SYSTEM, bibleBrief, characterStateBrief, sceneCard } from '../prompts/index.js';
import { styleInstructions, type StyleView } from '../writer/instructions.js';
import type { WriterEdit, WriterRule } from '../writer/replay.js';

// ---- schemas (the .description doubles as the example small local models follow) ----
export const SceneCardSchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string(),
  pov: z.string().describe('character id'),
  location: z.string(),
  time: z.string(),
  goal: z.string(),
  conflict: z.string(),
  outcome: z.string(),
  characters: z.array(z.string()).describe('character ids present'),
  targetWords: z.number().int().min(300).max(6000),
});
export const OutlineSchema = z.object({ scenes: z.array(SceneCardSchema) })
  .describe('{"scenes":[{"chapter":1,"title":"...","pov":"c_xxx","location":"...","time":"...","goal":"...","conflict":"...","outcome":"...","characters":["c_xxx"],"targetWords":1500}]}');

export const FactsSchema = z.object({
  facts: z.array(z.object({ subject: z.string(), predicate: z.string(), object: z.string(), text: z.string(), single: z.boolean().describe('true only if this property can have exactly one value at a time: eye colour, age, birthplace, name, relationship to X. false for actions, possessions, events, locations') })),
}).describe('{"facts":[{"subject":"mara","predicate":"eye colour","object":"grey","text":"Mara\'s grey eyes","single":true}]}');

export const WitnessSchema = z.object({
  summary: z.string(),
  learned: z.array(z.string()),
  feeling: z.string(),
}).describe('{"summary":"...","learned":["the bridge is guarded at night"],"feeling":"uneasy"}');

export type SceneCard = z.infer<typeof SceneCardSchema>;

// ---- roles ----
export async function outline(p: Provider, bible: Bible, chapters: number, scenesPerChapter = 3): Promise<SceneCard[]> {
  const existing = bible.scenes.length ? `\nExisting scenes (continue after them):\n${bible.scenes.map((s) => `${s.order}. ch${s.chapter} ${s.title}: ${s.outcome}`).join('\n')}` : '';
  const res = await p.structured(
    {
      system: ARCHITECT_SYSTEM,
      messages: [{ role: 'user', content: `${bibleBrief(bible)}${existing}\n\nPropose ${chapters} chapters of about ${scenesPerChapter} scenes each. Use only the character ids and world entries listed.` }],
      effort: 'high',
      maxTokens: 12000,
    },
    OutlineSchema,
    'outline',
  );
  return res.scenes;
}

export interface DraftContext {
  bible: Bible;
  scene: Scene;
  states: CharacterState[]; // states of present characters as of scene.order - 1
  facts: Fact[]; // relevant facts so far
  previousSummary: string;
  style: StyleView;
  /** Decisions the present characters have already made for this scene; the prose must honour them. */
  decisions?: { name: string; decision: string; emotion: string }[];
}

export function draftPrompt(ctx: DraftContext): { system: string; user: string } {
  const chars = ctx.bible.characters;
  const present = ctx.scene.characters.map((id) => chars.find((c) => c.id === id)).filter((c): c is Character => Boolean(c));
  const pov = chars.find((c) => c.id === ctx.scene.pov)?.name ?? 'the POV character';
  const povRule = ctx.bible.project.voice.pov === 'first'
    ? `Narrate in first person as ${pov}.`
    : `Narrate in ${ctx.bible.project.voice.pov.replace('-', ' ')} person: refer to ${pov} by name and pronoun. Never use "I", "me" or "my" outside quoted dialogue, even though the character notes below are written in second person.`;
  const system = `${DRAFTER_SYSTEM}\n${povRule}\nIf a character's decision conflicts with the scene card, the decision wins: adapt the conflict to it.\n\n${styleInstructions(ctx.style, ctx.bible.project.voice, `${ctx.scene.title} ${ctx.scene.goal} ${ctx.scene.conflict}`)}`;
  const user = [
    bibleBrief(ctx.bible),
    '',
    'Characters present, as they are at this point in the story:',
    ...present.map((c) => {
      const st = ctx.states.find((s) => s.id === c.id);
      return st ? characterStateBrief(c, st) : `${c.name}: ${c.summary}`;
    }),
    '',
    ctx.facts.length ? `Established facts (do not contradict):\n${ctx.facts.map((f) => `- ${f.text}`).join('\n')}` : '',
    ctx.previousSummary ? `Previous scene: ${ctx.previousSummary}` : 'This is the opening scene.',
    ctx.decisions?.length ? `\nWhat each character has decided to do in this scene (the prose must honour these choices, in their own way):\n${ctx.decisions.map((d) => `- ${d.name}: ${d.decision} (feeling ${d.emotion})`).join('\n')}` : '',
    '',
    'SCENE CARD',
    sceneCard(ctx.scene, chars),
    '',
    'Write the scene now.',
  ].join('\n');
  return { system, user };
}

export async function draft(p: Provider, ctx: DraftContext): Promise<string> {
  const { system, user } = draftPrompt(ctx);
  const { text } = await p.complete({ system, messages: [{ role: 'user', content: user }], effort: 'high', maxTokens: Math.max(4000, ctx.scene.targetWords * 3) });
  return text.trim();
}

export async function edit(p: Provider, passage: string, note: string, style: StyleView, bible: Bible): Promise<string> {
  const { text } = await p.complete({
    system: `${EDITOR_SYSTEM}\n\n${styleInstructions(style, bible.project.voice)}`,
    messages: [{ role: 'user', content: `NOTE: ${note}\n\nPASSAGE:\n${passage}` }],
    effort: 'medium',
    maxTokens: Math.max(2000, passage.length),
  });
  return text.trim();
}

export async function chat(p: Provider, c: Character, st: CharacterState, history: { role: 'user' | 'assistant'; content: string }[], message: string, known = ''): Promise<string> {
  const { text } = await p.complete({
    system: `${ACTOR_SYSTEM}\n\nCHARACTER STATE\n${characterStateBrief(c, st)}${known ? `\n\nPEOPLE YOU KNOW (use these names, never invent others):\n${known}` : ''}`,
    messages: [...history, { role: 'user', content: message }],
    effort: 'medium',
    maxTokens: 1200,
  });
  return text.trim();
}

export async function extractFacts(p: Provider, scene: Scene, text: string): Promise<Omit<Fact, 'id'>[]> {
  const res = await p.structured(
    { system: EXTRACTOR_SYSTEM, messages: [{ role: 'user', content: `SCENE ${scene.order}: ${scene.title}\n\n${text}` }], effort: 'low', maxTokens: 4000 },
    FactsSchema,
    'facts',
  );
  return res.facts.map((f) => ({ ...f, subject: norm(f.subject), predicate: norm(f.predicate), object: norm(f.object), sceneId: scene.id, order: scene.order }));
}

export async function witness(p: Provider, c: Character, scene: Scene, text: string): Promise<z.infer<typeof WitnessSchema>> {
  return p.structured(
    { system: WITNESS_SYSTEM, messages: [{ role: 'user', content: `CHARACTER: ${c.name} (${c.summary})\nSCENE ${scene.order}: ${scene.title}\n\n${text}` }], effort: 'low', maxTokens: 2000 },
    WitnessSchema,
    'witness',
  );
}

export async function styleSheet(p: Provider, samples: string[]): Promise<string> {
  const { text } = await p.complete({
    system: STYLE_SHEET_SYSTEM,
    messages: [{ role: 'user', content: samples.map((s, i) => `SAMPLE ${i + 1}:\n${s.slice(0, 3000)}`).join('\n\n') }],
    effort: 'medium',
    maxTokens: 1500,
  });
  return text.trim();
}

export const LearnedRulesSchema = z.object({
  rules: z.array(z.object({
    text: z.string().describe('one imperative rule a drafter can follow'),
    evidence: z.string().describe('short before -> after quote from the edits'),
  })),
}).describe('{"rules":[{"text":"...","evidence":"..."}]}');

/**
 * Learn the author's rules from their rewrites of AI drafts. Returns proposals only; the author
 * confirms or rejects each one. Known rules are passed in so a repeat reuses the exact text.
 */
export async function learnRules(p: Provider, edits: WriterEdit[], known: WriterRule[]): Promise<z.infer<typeof LearnedRulesSchema>['rules']> {
  const pairs = edits.map((e, i) => `EDIT ${i + 1}\nAI DRAFT:\n${e.draft.slice(0, 2500)}\nAUTHOR'S VERSION:\n${e.final.slice(0, 2500)}`).join('\n\n');
  const knownList = known.filter((r) => r.status !== 'rejected').map((r) => `- [${r.status}] ${r.text}`).join('\n');
  const rejected = known.filter((r) => r.status === 'rejected').map((r) => `- ${r.text}`).join('\n');
  const res = await p.structured(
    {
      system: LEARN_RULES_SYSTEM,
      messages: [{ role: 'user', content: `${knownList ? `KNOWN RULES (reuse the exact text if the edits support one again):\n${knownList}\n\n` : ''}${rejected ? `REJECTED BY THE AUTHOR (never propose these):\n${rejected}\n\n` : ''}${pairs}` }],
      effort: 'medium',
      maxTokens: 2000,
    },
    LearnedRulesSchema,
    'learned_rules',
  );
  return res.rules.slice(0, 6);
}

function norm(s: string): string { return s.trim().toLowerCase().replace(/\s+/g, ' '); }

export const MuseSchema = z.object({
  ideas: z.array(z.object({
    kind: z.string().describe('complication | reversal | character-beat | dialogue | painful | fun'),
    idea: z.string(),
    growsFrom: z.string().describe('the character, relationship, secret or fact this idea comes from'),
    characters: z.array(z.string()).describe('character ids involved'),
  })),
}).describe('{"ideas":[{"kind":"complication","idea":"...","growsFrom":"Mara\'s secret about the letter","characters":["c_xxx"]}]}');
export type MuseIdea = z.infer<typeof MuseSchema>['ideas'][number];

export async function muse(p: Provider, bible: Bible, states: CharacterState[], scenario: string | undefined, count = 6, decisions: { name: string; decision: string; reasoning: string; emotion: string }[] = []): Promise<MuseIdea[]> {
  const chars = bible.characters;
  const souls = states.map((st) => {
    const c = chars.find((x) => x.id === st.id);
    return c ? characterStateBrief(c, st) : '';
  }).filter(Boolean).join('\n\n');
  const user = [
    bibleBrief(bible),
    '',
    'CHARACTER SOULS AT THIS POINT IN THE STORY:',
    souls,
    '',
    scenario ? `SCENARIO THE AUTHOR IS STUCK ON:\n${scenario}` : 'The author has no scenario in mind. Find the pressure points in the material.',
    decisions.length ? `\nWHAT EACH CHARACTER SAYS THEY WOULD DO (they decided for themselves; build on these, including the friction between them):\n${decisions.map((d) => `- ${d.name}: ${d.decision} (${d.emotion}). Their reasoning: ${d.reasoning}`).join('\n')}` : '',
    '',
    `Give ${count} ideas.`,
  ].join('\n');
  const res = await p.structured({ system: MUSE_SYSTEM, messages: [{ role: 'user', content: user }], effort: 'high', maxTokens: 6000 }, MuseSchema, 'ideas');
  return res.ideas;
}

export const ProofSchema = z.object({
  issues: z.array(z.object({ original: z.string(), fix: z.string(), reason: z.string() })),
}).describe('{"issues":[{"original":"the the","fix":"the","reason":"repeated word"}]}');
export type ProofIssue = z.infer<typeof ProofSchema>['issues'][number];

export async function proofread(p: Provider, text: string): Promise<ProofIssue[]> {
  const res = await p.structured({ system: PROOFREADER_SYSTEM, messages: [{ role: 'user', content: text }], effort: 'low', maxTokens: 6000 }, ProofSchema, 'issues');
  return res.issues.filter((i) => i.original && text.includes(i.original));
}

export const SeedSchema = z.object({
  name: z.string(), role: z.string(), summary: z.string(), want: z.string(), need: z.string(), wound: z.string(), arc: z.string(),
  voiceSample: z.string().describe('2-3 sentences the character might say, in their register'),
  secrets: z.array(z.string()),
  traits: z.array(z.object({ key: z.string(), value: z.string() })).describe('a few concrete traits, e.g. habit, fear, skill'),
}).describe('{"name":"...","role":"...","summary":"...","want":"...","need":"...","wound":"...","arc":"...","voiceSample":"...","secrets":["..."],"traits":[{"key":"habit","value":"..."}]}');
export type SeedResult = z.infer<typeof SeedSchema>;

export async function seedCharacter(p: Provider, bible: Bible, inspiration: string, notes?: string): Promise<SeedResult> {
  const user = [bibleBrief(bible), '', `REFERENCE: ${inspiration}`, notes ? `AUTHOR NOTES: ${notes}` : '', '', 'Design the original character for this novel.'].join('\n');
  return p.structured({ system: SEED_SYSTEM, messages: [{ role: 'user', content: user }], effort: 'high', maxTokens: 4000 }, SeedSchema, 'character');
}

export const PsycheSchema = z.object({
  values: z.string(), fears: z.string(), defenses: z.string(), attachment: z.string(), moralLines: z.string(),
  decisionStyle: z.string(), selfImage: z.string(), blindSpot: z.string(), breakingPoint: z.string(), healing: z.string(),
}).describe('{"values":"...","fears":"...","defenses":"...","attachment":"...","moralLines":"...","decisionStyle":"...","selfImage":"...","blindSpot":"...","breakingPoint":"...","healing":"..."}');
export type Psyche = z.infer<typeof PsycheSchema>;

export async function mirror(p: Provider, c: Character, st: CharacterState): Promise<Psyche> {
  return p.structured({ system: MIRROR_SYSTEM, messages: [{ role: 'user', content: characterStateBrief(c, st) }], effort: 'high', maxTokens: 4000 }, PsycheSchema, 'psyche');
}

export const DecisionSchema = z.object({
  decision: z.string(), reasoning: z.string(), rejected: z.array(z.string()), emotion: z.string(), cost: z.string(),
}).describe('{"decision":"...","reasoning":"...","rejected":["..."],"emotion":"...","cost":"..."}');
export type Decision = z.infer<typeof DecisionSchema>;

export async function decide(p: Provider, c: Character, st: CharacterState, situation: string, known = ''): Promise<Decision> {
  const user = `WHO YOU ARE\n${characterStateBrief(c, st)}${known ? `\n\nPEOPLE YOU KNOW\n${known}` : ''}\n\nSITUATION\n${situation}\n\nDecide.`;
  return p.structured({ system: DECIDE_SYSTEM, messages: [{ role: 'user', content: user }], effort: 'high', maxTokens: 3000 }, DecisionSchema, 'decision');
}

export const EditOpSchema = z.object({
  op: z.enum(['set', 'secret', 'trait', 'relate']),
  field: z.string().optional().describe('for set: name|role|summary|want|need|wound|arc|voiceSample'),
  key: z.string().optional().describe('for trait'),
  other: z.string().optional().describe('for relate: existing character id'),
  value: z.coerce.string(),
});
export type EditOp = z.infer<typeof EditOpSchema>;
export const BuilderTurnSchema = z.object({ reply: z.string(), edits: z.array(EditOpSchema), ready: z.boolean() })
  .describe('{"reply":"...","edits":[{"op":"set","field":"name","value":"Mara Voss"},{"op":"trait","key":"habit","value":"..."},{"op":"relate","other":"c_xxx","value":"older brother"}],"ready":false}');
export type BuilderTurn = z.infer<typeof BuilderTurnSchema>;

export async function builderTurn(p: Provider, bible: Bible, current: { sheet: Character; state: CharacterState } | null, history: { role: 'user' | 'assistant'; content: string }[], message: string): Promise<BuilderTurn> {
  const ctx = current ? `CHARACTER SO FAR\n${characterStateBrief(current.sheet, current.state)}` : 'No character yet. Start from what the author says.';
  const system = `${BUILDER_SYSTEM}\n\nTHE NOVEL\n${bibleBrief(bible)}\n\n${ctx}`;
  return p.structured({ system, messages: [...history, { role: 'user', content: message }], effort: 'medium', maxTokens: 3000 }, BuilderTurnSchema, 'turn');
}

// ---- import ----
export const ImportCardSchema = z.object({
  title: z.string(), pov: z.string().describe('name of the point-of-view character, or "" if unclear'),
  characters: z.array(z.string()).describe('names present, from the cast list'), location: z.string(), time: z.string(),
  goal: z.string(), conflict: z.string(), outcome: z.string(), summary: z.string(),
}).describe('{"title":"...","pov":"Mara Voss","characters":["Mara Voss"],"location":"...","time":"...","goal":"...","conflict":"...","outcome":"...","summary":"..."}');
export type ImportCard = z.infer<typeof ImportCardSchema>;

export async function importCard(p: Provider, text: string, cast: string[]): Promise<ImportCard> {
  return p.structured({ system: IMPORT_CARD_SYSTEM, messages: [{ role: 'user', content: `CAST: ${cast.join(', ') || '(none given)'}\n\nSCENE:\n${text.slice(0, 24000)}` }], effort: 'low', maxTokens: 1500 }, ImportCardSchema, 'scene_card');
}

export const ImportCastSchema = z.object({
  role: z.string(), summary: z.string(), want: z.string(), need: z.string(), wound: z.string(), arc: z.string(),
  voiceSample: z.string(), secrets: z.array(z.string()), traits: z.array(z.object({ key: z.string(), value: z.string() })),
}).describe('{"role":"...","summary":"...","want":"...","need":"...","wound":"...","arc":"...","voiceSample":"...","secrets":[],"traits":[{"key":"habit","value":"..."}]}');
export type ImportCast = z.infer<typeof ImportCastSchema>;

export async function importCast(p: Provider, name: string, passages: string[]): Promise<ImportCast> {
  return p.structured({ system: IMPORT_CAST_SYSTEM, messages: [{ role: 'user', content: `CHARACTER: ${name}\n\nPASSAGES:\n${passages.map((x, i) => `[${i + 1}] ${x}`).join('\n\n').slice(0, 20000)}` }], effort: 'medium', maxTokens: 2000 }, ImportCastSchema, 'character');
}

export const ImportBookSchema = z.object({
  logline: z.string(), dramaticQuestion: z.string(), theme: z.string(), ending: z.string(),
  world: z.array(z.object({ kind: z.string().describe('location | faction | item | rule | glossary'), name: z.string(), summary: z.string() })),
}).describe('{"logline":"...","dramaticQuestion":"...","theme":"...","ending":"...","world":[{"kind":"location","name":"...","summary":"..."}]}');
export type ImportBook = z.infer<typeof ImportBookSchema>;

export async function importBook(p: Provider, opening: string, ending: string): Promise<ImportBook> {
  return p.structured({ system: IMPORT_BOOK_SYSTEM, messages: [{ role: 'user', content: `OPENING:\n${opening.slice(0, 18000)}\n\nENDING:\n${ending.slice(0, 12000)}` }], effort: 'medium', maxTokens: 3000 }, ImportBookSchema, 'bible');
}
