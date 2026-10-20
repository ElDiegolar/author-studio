#!/usr/bin/env node
/**
 * author: CLI over a project directory. Everything it does is also in the MCP server and the web app.
 *
 *   author init <dir> --title T --genre G [--audience A] [--words N] [--pov first|third-limited|third-omniscient] [--tense past|present]
 *   author premise <dir> --logline .. --question .. --theme .. --ending ..
 *   author character add <dir> --name .. --role .. --summary .. [--want --need --wound --arc --voice --secret ..]
 *   author character seed <dir> "like Rick Deckard" [--notes ..] [--add]
 *   author character relate <dir> <id> <otherId> "relation" ["mutual relation"]
 *   author character mirror <dir> <id>                   build the psychological mirror (psyche.* on the soul)
 *   author character decide <dir> <id> "situation" [--as-of N]   the character decides; appended to the soul
 *   author world add <dir> --kind location|faction|rule|item|glossary --name .. --summary .. [--details ..] [--at N]
 *   author scene add <dir> --title .. --chapter N --pov <charId> --cast id,id --goal .. --conflict .. --outcome .. [--location --time --words N]
 *   author outline <dir> --chapters N [--per 3]
 *   author draft <dir> <sceneId> [--agency all|id,id]   AI draft; named characters decide first, the rest follow the card
 *   author write <dir> <sceneId> <file.md>           author text -> new version (edits of AI drafts train the style)
 *   author accept <dir> <sceneId>                    facts to ledger, characters witness the scene
 *   author chat <dir> <charId> "message" [--as-of N]
 *   author state <dir> <charId> [--as-of N]
 *   author muse <dir> [--as-of N] [--cast id,id] [--scenario ..] [--count 6] [--agency all|id,id]   (named characters decide for themselves; the rest follow the author)
 *   author soul save|list|restore|reset <dir> <charId> [name]
 *   author style sample <dir> <file.md> | author style sheet <dir>
 *   author proof <dir> <sceneId>
 *   author verify <dir>
 *   author export <dir> [--out book.md]
 *   author show <dir>
 */
import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { Studio } from '@author-studio/core';

const [cmd, sub, ...rest] = process.argv.slice(2);

function opts(args: string[], spec: Record<string, { type: 'string' | 'boolean'; default?: string }>) {
  const o: Record<string, { type: 'string' | 'boolean' }> = {};
  for (const [k, v] of Object.entries(spec)) o[k] = { type: v.type };
  const { values, positionals } = parseArgs({ args, options: o, allowPositionals: true, strict: false });
  const out: Record<string, string | boolean | undefined> = {};
  for (const [k, v] of Object.entries(spec)) out[k] = (values as Record<string, string | boolean | undefined>)[k] ?? v.default;
  return { v: out as Record<string, string | undefined>, pos: positionals };
}
const str = (x: unknown, name: string): string => { if (typeof x !== 'string' || !x) throw new Error(`--${name} is required`); return x; };
const num = (x: unknown): number | undefined => (typeof x === 'string' ? Number(x) : undefined);
/** --agency all | --agency id,id | absent -> none */
const agencyArg = (x: unknown): boolean | string[] | undefined => (x === 'all' || x === true ? true : typeof x === 'string' && x ? x.split(',') : undefined);
const list = (x: unknown): string[] => (typeof x === 'string' && x ? x.split(',').map((s) => s.trim()) : []);
function print(x: unknown): void { console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2)); }

async function main(): Promise<void> {
  if (!cmd || cmd === 'help') { console.log((await fs.readFile(new URL(import.meta.url), 'utf8')).split('*/')[0]); return; }

  if (cmd === 'init') {
    const { v, pos } = opts([sub!, ...rest], { title: { type: 'string' }, genre: { type: 'string' }, audience: { type: 'string', default: 'adult' }, words: { type: 'string', default: '80000' }, pov: { type: 'string', default: 'third-limited' }, tense: { type: 'string', default: 'past' }, tone: { type: 'string', default: '' } });
    const dir = pos[0]!;
    await Studio.init(dir, { title: str(v.title, 'title'), genre: str(v.genre, 'genre'), audience: v.audience!, targetWords: Number(v.words), voice: { pov: v.pov as 'first', tense: v.tense as 'past', tone: v.tone ?? '', bannedWords: [], exemplars: [] } }, { logline: '', dramaticQuestion: '', theme: '', ending: '' });
    print(`initialised ${dir}`); return;
  }

  const grouped = ['character', 'world', 'soul', 'style', 'scene'].includes(cmd);
  const dir = grouped ? rest[0]! : sub!;
  const studio = await Studio.open(dir);
  const args = grouped ? rest.slice(1) : rest;

  switch (cmd) {
    case 'show': {
      const b = await studio.bible();
      print({ project: b.project.title, characters: b.characters.map((c) => `${c.id} ${c.name} (${c.role})`), world: b.world.map((w) => `${w.id} ${w.name}`), scenes: b.scenes.map((s) => `${s.id} #${s.order} ch${s.chapter} [${s.status}] ${s.title}`), facts: b.facts.length });
      return;
    }
    case 'premise': {
      const { v } = opts(args, { logline: { type: 'string' }, question: { type: 'string' }, theme: { type: 'string' }, ending: { type: 'string' } });
      await studio.store.savePremise({ logline: v.logline ?? '', dramaticQuestion: v.question ?? '', theme: v.theme ?? '', ending: v.ending ?? '' });
      print('premise saved'); return;
    }
    case 'character': {
      if (sub === 'add') {
        const { v } = opts(args, { name: { type: 'string' }, role: { type: 'string' }, summary: { type: 'string' }, want: { type: 'string', default: '' }, need: { type: 'string', default: '' }, wound: { type: 'string', default: '' }, arc: { type: 'string', default: '' }, voice: { type: 'string', default: '' }, secret: { type: 'string', default: '' } });
        const c = await studio.store.addCharacter({ name: str(v.name, 'name'), role: str(v.role, 'role'), summary: v.summary ?? '', want: v.want!, need: v.need!, wound: v.wound!, arc: v.arc!, voiceSample: v.voice!, secrets: list(v.secret) });
        await studio.store.saveSoul(c.id, 'base');
        print(c); return;
      }
      if (sub === 'mirror') { print(await studio.mirror(args[0]!)); return; }
      if (sub === 'decide') { const { v, pos } = opts(args, { 'as-of': { type: 'string' } }); print(await studio.decide(pos[0]!, pos[1]!, num(v['as-of']))); return; }
      if (sub === 'relate') { await studio.relate(args[0]!, args[1]!, args[2]!, args[3]); print('related'); return; }
      if (sub === 'seed') {
        const { v, pos } = opts(args, { notes: { type: 'string' }, add: { type: 'boolean' } });
        const seed = await studio.seed(pos[0]!, v.notes);
        print(seed);
        if (v.add) print(await studio.addSeeded(seed));
        return;
      }
      break;
    }
    case 'world': {
      const { v } = opts(args, { kind: { type: 'string' }, name: { type: 'string' }, summary: { type: 'string', default: '' }, details: { type: 'string', default: '' }, at: { type: 'string' } });
      const at = num(v.at);
      print(await studio.store.addWorld({ kind: str(v.kind, 'kind') as 'location', name: str(v.name, 'name'), summary: v.summary!, details: v.details!, ...(at !== undefined ? { introducedAt: at } : {}) })); return;
    }
    case 'scene': {
      const { v } = opts(args, { title: { type: 'string' }, chapter: { type: 'string', default: '1' }, pov: { type: 'string' }, cast: { type: 'string' }, goal: { type: 'string', default: '' }, conflict: { type: 'string', default: '' }, outcome: { type: 'string', default: '' }, location: { type: 'string', default: '' }, time: { type: 'string', default: '' }, words: { type: 'string', default: '1500' } });
      print(await studio.store.addScene({ title: str(v.title, 'title'), chapter: Number(v.chapter), pov: str(v.pov, 'pov'), characters: list(v.cast), goal: v.goal!, conflict: v.conflict!, outcome: v.outcome!, location: v.location!, time: v.time!, targetWords: Number(v.words), summary: '' })); return;
    }
    case 'outline': { const { v } = opts(args, { chapters: { type: 'string', default: '3' }, per: { type: 'string', default: '3' } }); print(await studio.outline(Number(v.chapters), Number(v.per))); return; }
    case 'draft': { const { v, pos } = opts(args, { agency: { type: 'string' } }); const r = await studio.draft(pos[0]!, { agency: agencyArg(v.agency) }); print(r.version.text); print({ version: r.version.version, findings: r.findings, decisions: r.decisions }); return; }
    case 'write': { const r = await studio.saveAuthorText(args[0]!, await fs.readFile(args[1]!, 'utf8')); print({ version: r.version.version, findings: r.findings }); return; }
    case 'accept': { print(await studio.accept(args[0]!)); return; }
    case 'chat': { const { v, pos } = opts(args, { 'as-of': { type: 'string' } }); const r = await studio.chat(pos[0]!, pos[1]!, num(v['as-of'])); print(r.answer); if (r.findings.length) print({ findings: r.findings }); return; }
    case 'state': { const { v, pos } = opts(args, { 'as-of': { type: 'string' } }); print(await studio.state(pos[0]!, num(v['as-of']))); return; }
    case 'muse': { const { v } = opts(args, { 'as-of': { type: 'string' }, cast: { type: 'string' }, scenario: { type: 'string' }, count: { type: 'string', default: '6' }, agency: { type: 'string' } }); print(await studio.muse({ asOf: num(v['as-of']), characters: list(v.cast), scenario: v.scenario, count: Number(v.count), agency: agencyArg(v.agency) })); return; }
    case 'soul': {
      const id = args[0]!;
      if (sub === 'save') print(await studio.store.saveSoul(id, args[1] ?? `snapshot-${Date.now()}`));
      else if (sub === 'list') print(await studio.store.listSouls(id));
      else if (sub === 'restore') { await studio.store.restoreSoul(id, args[1]!); print('restored'); }
      else if (sub === 'reset') print(await studio.store.resetSoul(id));
      return;
    }
    case 'style': {
      if (sub === 'sample') print((await studio.addStyleSample(await fs.readFile(args[0]!, 'utf8'))).stats);
      else if (sub === 'sheet') print((await studio.refreshStyleSheet()).sheet);
      return;
    }
    case 'proof': { print(await studio.proofread(args[0]!)); return; }
    case 'verify': { print(await studio.verifyAll()); return; }
    case 'export': { const { v } = opts(args, { out: { type: 'string' } }); const md = await studio.exportMarkdown(); if (v.out) { await fs.writeFile(v.out, md); print(`wrote ${v.out}`); } else print(md); return; }
  }
  throw new Error(`unknown command: ${cmd} ${sub ?? ''}`);
}

main().catch((e: Error) => { console.error(e.message); process.exit(1); });
