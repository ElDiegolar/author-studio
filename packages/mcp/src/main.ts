#!/usr/bin/env node
/**
 * author-mcp: MCP server (stdio) over one Author Studio project, so any agent
 * (Claude Code, Hermes, horizon-ui sub-agents) can read and write the story bible.
 *
 * Env: AUTHOR_PROJECT (required) — the project directory. Model env as in core (AUTHOR_LOCAL_URL etc).
 * Writes go through the same Studio facade as the CLI and web app; nothing bypasses the files.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Studio } from '@author-studio/core';

const dir = process.env.AUTHOR_PROJECT;
if (!dir) { console.error('AUTHOR_PROJECT is required'); process.exit(1); }
const studio = await Studio.open(dir);

const server = new McpServer({ name: 'author-studio', version: '0.1.0' }, {
  instructions: 'This is a novelist\'s story bible. Read before you write. Characters are souls with a knowledge horizon: get_character(as_of) returns only what they know by that scene. Never put plot a character has not lived into their mouth. Every write is a proposal the author can see in their files; keep them small and named.',
});

const text = (x: unknown) => ({ content: [{ type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2) }] });

server.tool('bible_overview', 'Project, premise, cast, world and scene list', {}, async () => {
  const b = await studio.bible();
  return text({ project: b.project, premise: b.premise, characters: b.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, summary: c.summary })), world: b.world, scenes: b.scenes.map((s) => ({ id: s.id, order: s.order, chapter: s.chapter, title: s.title, status: s.status, pov: s.pov, characters: s.characters })), facts: b.facts.length });
});
server.tool('get_character', 'Character sheet plus replayed soul state as of a scene order (omit for whole story)', { id: z.string(), as_of: z.number().int().optional() }, async ({ id, as_of }) => {
  const b = await studio.bible();
  return text({ sheet: Studio.characterOf(b, id), state: await studio.state(id, as_of) });
});
server.tool('get_scene', 'Scene card and its latest text', { id: z.string() }, async ({ id }) => {
  const b = await studio.bible();
  const s = b.scenes.find((x) => x.id === id);
  if (!s) return text({ error: 'no such scene' });
  return text({ scene: s, text: (await studio.store.latest(id))?.text ?? null, facts: b.facts.filter((f) => f.sceneId === id) });
});
server.tool('search_bible', 'Case-insensitive search across characters, world, scene cards and facts', { q: z.string() }, async ({ q }) => {
  const b = await studio.bible(); const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return text({
    characters: b.characters.filter((c) => re.test(JSON.stringify(c))).map((c) => c.id + ' ' + c.name),
    world: b.world.filter((w) => re.test(JSON.stringify(w))).map((w) => w.id + ' ' + w.name),
    scenes: b.scenes.filter((s) => re.test(JSON.stringify(s))).map((s) => `${s.id} #${s.order} ${s.title}`),
    facts: b.facts.filter((f) => re.test(f.text)).map((f) => `scene ${f.order}: ${f.text}`),
  });
});
server.tool('add_character', 'Add a character (static sheet; a base soul snapshot is saved)', { name: z.string(), role: z.string(), summary: z.string(), want: z.string().default(''), need: z.string().default(''), wound: z.string().default(''), arc: z.string().default(''), voiceSample: z.string().default(''), secrets: z.array(z.string()).default([]) }, async (c) => {
  const ch = await studio.store.addCharacter(c); await studio.store.saveSoul(ch.id, 'base'); return text(ch);
});
server.tool('seed_character', 'Design an original character in the mould of a named reference; returns a proposal (use add_character to keep it)', { inspiration: z.string(), notes: z.string().optional() }, async ({ inspiration, notes }) => text(await studio.seed(inspiration, notes)));
server.tool('relate', 'Record a relationship on a character\'s soul (optionally the mutual one on the other)', { id: z.string(), otherId: z.string(), relation: z.string(), mutual: z.string().optional() }, async ({ id, otherId, relation, mutual }) => { await studio.relate(id, otherId, relation, mutual); return text('ok'); });
server.tool('add_world_entry', 'Add a location, faction, rule, item or glossary entry', { kind: z.enum(['location', 'faction', 'rule', 'item', 'glossary']), name: z.string(), summary: z.string(), details: z.string().default(''), introducedAt: z.number().int().optional() }, async ({ introducedAt, ...e }) => text(await studio.store.addWorld(introducedAt !== undefined ? { ...e, introducedAt } : e)));
server.tool('add_scene', 'Add a scene card', { title: z.string(), chapter: z.number().int(), pov: z.string(), characters: z.array(z.string()), goal: z.string(), conflict: z.string(), outcome: z.string(), location: z.string().default(''), time: z.string().default(''), targetWords: z.number().int().default(1500) }, async (s) => text(await studio.store.addScene({ ...s, summary: '' })));
server.tool('save_scene_text', 'Save a new version of a scene\'s text. source=author trains the style profile when it edits an AI draft', { id: z.string(), text: z.string(), source: z.enum(['ai', 'author']).default('ai') }, async ({ id, text: t, source }) => {
  if (source === 'author') return text(await studio.saveAuthorText(id, t));
  const v = await studio.store.saveVersion(id, t, 'ai'); return text({ version: v.version });
});
server.tool('draft_scene', 'Have the drafter write the scene from its card, souls and ledger; with agency=true each present character decides first and the prose honours it', { id: z.string(), agency: z.union([z.boolean(), z.array(z.string())]).default(false) }, async ({ id, agency }) => text(await studio.draft(id, { agency })));
server.tool('accept_scene', 'Accept latest text: extract facts, let present characters witness it', { id: z.string() }, async ({ id }) => text(await studio.accept(id)));
server.tool('character_chat', 'Talk to a character in character, bounded by their knowledge horizon; leak findings are returned', { id: z.string(), message: z.string(), as_of: z.number().int().optional() }, async ({ id, message, as_of }) => text(await studio.chat(id, message, as_of)));
server.tool('character_mirror', 'Build the character\'s psychological mirror from sheet + lived soul (stored as psyche.* traits)', { id: z.string() }, async ({ id }) => text(await studio.mirror(id)));
server.tool('character_decide', 'Let the character decide what they do in a situation, from their psyche and horizon; the decision is appended to their soul', { id: z.string(), situation: z.string(), as_of: z.number().int().optional() }, async ({ id, situation, as_of }) => text(await studio.decide(id, situation, as_of)));
server.tool('character_observe', 'Record something the character notices about the author/conversation (appended to the soul)', { id: z.string(), text: z.string() }, async ({ id, text: t }) => { await studio.observe(id, t); return text('ok'); });
server.tool('muse', 'Ideas for writer\'s block, grounded in the souls at a point in the story and an optional scenario', { as_of: z.number().int().optional(), characters: z.array(z.string()).optional(), scenario: z.string().optional(), count: z.number().int().default(6), agency: z.union([z.boolean(), z.array(z.string())]).default(false).describe('true = every character decides for themselves; array = only these ids; false = all adhere to the author') }, async ({ as_of, characters, scenario, count, agency }) => text(await studio.muse({ asOf: as_of, characters, scenario, count, agency })));
server.tool('soul', 'save | list | restore | reset a character\'s soul (event log). reset keeps the base sheet and archives the rest', { id: z.string(), action: z.enum(['save', 'list', 'restore', 'reset']), name: z.string().optional() }, async ({ id, action, name }) => {
  if (action === 'save') return text(await studio.store.saveSoul(id, name ?? `snapshot-${Date.now()}`));
  if (action === 'list') return text(await studio.store.listSouls(id));
  if (action === 'restore') { await studio.store.restoreSoul(id, name ?? 'base'); return text('restored'); }
  return text(await studio.store.resetSoul(id));
});
server.tool('add_fact', 'Assert a continuity fact by hand', { sceneId: z.string(), subject: z.string(), predicate: z.string(), object: z.string(), text: z.string() }, async (f) => {
  const b = await studio.bible(); const s = b.scenes.find((x) => x.id === f.sceneId); if (!s) return text({ error: 'no such scene' });
  return text(await studio.store.addFacts([{ ...f, order: s.order }]));
});
server.tool('proofread', 'Proofreading issues for a scene', { id: z.string() }, async ({ id }) => text(await studio.proofread(id)));
server.tool('verify', 'Deterministic checks: continuity contradictions, timeline, per-scene style/POV/length', {}, async () => text(await studio.verifyAll()));
server.tool('export_markdown', 'The manuscript as Markdown', {}, async () => text(await studio.exportMarkdown()));

await server.connect(new StdioServerTransport());
