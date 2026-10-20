/**
 * The studio agent: everything is chat. The agent plans actions over the same operations
 * the CLI, MCP server and web app use, executes them, and reports. Works on any provider,
 * because the tool protocol is a structured JSON turn, not provider-specific tool use.
 * Every write is versioned or snapshotted by the store, so anything it does can be undone.
 */
import { z } from 'zod/v4';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { nestedClaudeEnv } from './ai/claudeCode.js';
import type { Studio } from './studio.js';
import type { Provider } from './ai/provider.js';
import { bibleBrief } from './prompts/index.js';

export interface AgentTool { name: string; description: string; requires?: string[]; run: (args: Record<string, unknown>) => Promise<unknown> }

export function studioTools(s: Studio): AgentTool[] {
  const str = (a: Record<string, unknown>, k: string) => String(a[k] ?? '');
  const num = (a: Record<string, unknown>, k: string) => (a[k] === undefined || a[k] === null || a[k] === '' ? undefined : Number(a[k]));
  /** Scene order from a number, a scene id, or a title; agents mix these up. */
  const sceneOrder = async (a: Record<string, unknown>, k: string) => {
    const v = a[k]; if (v === undefined || v === null || v === '') return undefined;
    if (typeof v === 'number' || /^\d+$/.test(String(v))) return Number(v);
    const b = await s.bible(); const sc = b.scenes.find((x) => x.id === v || x.title.toLowerCase() === String(v).toLowerCase());
    return sc?.order;
  };
  const arr = (a: Record<string, unknown>, k: string) => (Array.isArray(a[k]) ? (a[k] as string[]) : typeof a[k] === 'string' && a[k] ? String(a[k]).split(',').map((x) => x.trim()) : []);
  return [
    { name: 'bible', description: 'Read project, premise, cast, world, scenes, fact count', run: async () => { const b = await s.bible(); return { project: b.project, premise: b.premise, characters: b.characters.map((c) => ({ id: c.id, name: c.name, role: c.role, summary: c.summary })), world: b.world, scenes: b.scenes.map((x) => ({ id: x.id, order: x.order, chapter: x.chapter, title: x.title, status: x.status, pov: x.pov, characters: x.characters, goal: x.goal, outcome: x.outcome })), facts: b.facts.length }; } },
    { name: 'set_premise', description: 'args: logline, dramaticQuestion, theme, ending (any subset)', run: async (a) => { const b = await s.bible(); const p = { ...b.premise }; for (const k of ['logline', 'dramaticQuestion', 'theme', 'ending'] as const) if (a[k] !== undefined) p[k] = str(a, k); await s.store.savePremise(p); return p; } },
    { name: 'set_voice', description: 'args: pov (first|third-limited|third-omniscient), tense (past|present), tone, bannedWords (array)', run: async (a) => { const b = await s.bible(); const v = { ...b.project.voice }; if (a.pov) v.pov = str(a, 'pov') as typeof v.pov; if (a.tense) v.tense = str(a, 'tense') as typeof v.tense; if (a.tone !== undefined) v.tone = str(a, 'tone'); if (a.bannedWords) v.bannedWords = arr(a, 'bannedWords'); await s.store.saveProject({ ...b.project, voice: v }); return v; } },
    { name: 'add_world', requires: ["kind", "name", "summary"], description: 'args: kind (location|faction|rule|item|glossary), name, summary, details?, introducedAt? (scene order)', run: async (a) => { const at = await sceneOrder(a, 'introducedAt'); return s.store.addWorld({ kind: str(a, 'kind') as 'location', name: str(a, 'name'), summary: str(a, 'summary'), details: str(a, 'details'), ...(at !== undefined ? { introducedAt: at } : {}) }); } },
    { name: 'edit_world', requires: ['id'], description: 'args: id plus any of kind, name, summary, details, introducedAt (scene order)', run: async (a) => { const b = await s.bible(); const w = b.world.find((x) => x.id === a.id); if (!w) throw new Error('no such world entry'); const next = { ...w }; for (const k of ['name', 'summary', 'details'] as const) if (a[k] !== undefined) next[k] = str(a, k); if (a.kind) next.kind = str(a, 'kind') as typeof w.kind; const at = await sceneOrder(a, 'introducedAt'); if (at !== undefined) next.introducedAt = at; await s.store.updateWorld(next); return next; } },
    { name: 'add_character', requires: ["name", "role", "summary"], description: 'args: name, role, summary, want?, need?, wound?, arc?, voiceSample?, secrets? (array)', run: async (a) => { const c = await s.store.addCharacter({ name: str(a, 'name'), role: str(a, 'role'), summary: str(a, 'summary'), want: str(a, 'want'), need: str(a, 'need'), wound: str(a, 'wound'), arc: str(a, 'arc'), voiceSample: str(a, 'voiceSample'), secrets: arr(a, 'secrets') }); await s.store.saveSoul(c.id, 'base'); return c; } },
    { name: 'edit_character', requires: ["id"], description: 'args: id, then any of name, role, summary, want, need, wound, arc, voiceSample, secrets (array)', run: async (a) => { const patch: Record<string, unknown> = {}; for (const k of ['name', 'role', 'summary', 'want', 'need', 'wound', 'arc', 'voiceSample']) if (a[k] !== undefined) patch[k] = str(a, k); if (a.secrets) patch.secrets = arr(a, 'secrets'); return s.updateCharacterSafe(str(a, 'id'), patch); } },
    { name: 'relate', requires: ["id", "otherId", "relation"], description: 'args: id, otherId, relation, mutual?', run: async (a) => { await s.relate(str(a, 'id'), str(a, 'otherId'), str(a, 'relation'), a.mutual ? str(a, 'mutual') : undefined); return 'ok'; } },
    { name: 'seed_character', requires: ["inspiration"], description: 'Design an original character from a reference. args: inspiration, notes?, add? (true to add it)', run: async (a) => { const seed = await s.seed(str(a, 'inspiration'), a.notes ? str(a, 'notes') : undefined); return a.add ? s.addSeeded(seed) : seed; } },
    { name: 'character_state', requires: ["id"], description: 'Soul replayed as of a scene. args: id, asOf?', run: async (a) => s.state(str(a, 'id'), await sceneOrder(a, 'asOf')) },
    { name: 'mirror', requires: ["id"], description: 'Build the psychological mirror. args: id', run: async (a) => s.mirror(str(a, 'id')) },
    { name: 'decide', requires: ["id", "situation"], description: 'Character decides for themselves. args: id, situation, asOf?', run: async (a) => s.decide(str(a, 'id'), str(a, 'situation'), await sceneOrder(a, 'asOf')) },
    { name: 'character_chat', requires: ["id", "message"], description: 'Ask a character in character. args: id, message, asOf?', run: async (a) => s.chat(str(a, 'id'), str(a, 'message'), await sceneOrder(a, 'asOf')) },
    { name: 'add_scene', requires: ["title", "pov", "goal", "conflict", "outcome"], description: 'args: title, chapter, pov (character id), characters (array of ids), goal, conflict, outcome, location?, time?, targetWords?', run: async (a) => s.store.addScene({ title: str(a, 'title'), chapter: Number(a.chapter ?? 1), pov: str(a, 'pov'), characters: arr(a, 'characters'), goal: str(a, 'goal'), conflict: str(a, 'conflict'), outcome: str(a, 'outcome'), location: str(a, 'location'), time: str(a, 'time'), targetWords: Number(a.targetWords ?? 1500), summary: '' }) },
    { name: 'edit_scene', requires: ["id"], description: 'args: id plus any scene card field', run: async (a) => { const b = await s.bible(); const sc = b.scenes.find((x) => x.id === a.id); if (!sc) throw new Error('no such scene'); const next = { ...sc }; for (const k of ['title', 'goal', 'conflict', 'outcome', 'location', 'time', 'pov', 'summary'] as const) if (a[k] !== undefined) next[k] = str(a, k); if (a.chapter !== undefined) next.chapter = Number(a.chapter); if (a.order !== undefined) next.order = Number(a.order); if (a.characters) next.characters = arr(a, 'characters'); if (a.targetWords) next.targetWords = Number(a.targetWords); await s.store.updateScene(next); return next; } },
    { name: 'outline', description: 'Architect proposes scene cards and adds them. args: chapters, per?', run: async (a) => s.outline(Number(a.chapters ?? 3), Number(a.per ?? 3)) },
    { name: 'scene_text', requires: ["id"], description: 'Latest text of a scene. args: id', run: async (a) => (await s.store.latest(str(a, 'id')))?.text ?? null },
    { name: 'draft', requires: ["id"], description: 'Draft a scene. args: id, agency? (true | array of character ids)', run: async (a) => { const r = await s.draft(str(a, 'id'), { agency: a.agency === true ? true : Array.isArray(a.agency) ? (a.agency as string[]) : undefined }); return { version: r.version.version, words: r.version.text.split(/\s+/).length, findings: r.findings, decisions: r.decisions, text: r.version.text }; } },
    { name: 'save_text', requires: ["id", "text"], description: 'Save author text for a scene (edits of AI drafts teach the style). args: id, text', run: async (a) => s.saveAuthorText(str(a, 'id'), str(a, 'text')) },
    { name: 'edit_passage', requires: ["passage", "note"], description: 'Line-edit a passage to a note; returns revised text (not saved). args: passage, note', run: async (a) => s.editPassage(str(a, 'passage'), str(a, 'note')) },
    { name: 'accept', requires: ["id"], description: 'Accept latest text: facts to ledger, characters witness. args: id', run: async (a) => s.accept(str(a, 'id')) },
    { name: 'muse', description: 'Ideas for writer\'s block. args: scenario?, asOf?, characters?, count?, agency? (true | array of ids)', run: async (a) => s.muse({ scenario: a.scenario ? str(a, 'scenario') : undefined, asOf: await sceneOrder(a, 'asOf'), characters: arr(a, 'characters'), count: Number(a.count ?? 6), agency: a.agency === true ? true : Array.isArray(a.agency) ? (a.agency as string[]) : undefined }) },
    { name: 'proofread', requires: ["id"], description: 'args: id', run: async (a) => s.proofread(str(a, 'id')) },
    { name: 'style_sample', requires: ["text"], description: 'Add the author\'s prose as a style sample. args: text', run: async (a) => (await s.addStyleSample(str(a, 'text'))).stats },
    { name: 'style_sheet', description: 'Distil the style sheet from samples', run: async () => (await s.refreshStyleSheet()).sheet },
    { name: 'soul', requires: ["id", "action"], description: 'args: id, action (save|list|restore|reset), name?', run: async (a) => { const id = str(a, 'id'); const act = str(a, 'action'); if (act === 'save') return s.store.saveSoul(id, a.name ? str(a, 'name') : `snapshot-${Date.now()}`); if (act === 'list') return s.store.listSouls(id); if (act === 'restore') { await s.store.restoreSoul(id, str(a, 'name')); return 'restored'; } return s.store.resetSoul(id); } },
    { name: 'verify', description: 'Deterministic checks over the whole book', run: async () => s.verifyAll() },
    { name: 'export', description: 'Manuscript as Markdown', run: async () => s.exportMarkdown() },
  ];
}

const TurnSchema = z.object({
  thought: z.string().describe('one line: what you are doing and why'),
  actions: z.array(z.object({ tool: z.string(), args: z.record(z.string(), z.unknown()) })).describe('tools to run now, in order; empty when you only need to talk'),
  reply: z.string().describe('what to say to the author now; if actions are pending, a short progress note'),
  done: z.boolean().describe('true when the turn is complete and the reply is final'),
}).describe('{"thought":"...","actions":[{"tool":"bible","args":{}}],"reply":"...","done":false}');
export type AgentTurn = z.infer<typeof TurnSchema>;

export interface AgentEvent { kind: 'thought' | 'action' | 'result' | 'reply'; text: string; data?: unknown }

export const AGENT_SYSTEM = `You are the studio agent for a novelist. Everything in this studio happens by talking to you; the author can also edit the files and screens by hand, and you must respect what they changed.
You have tools over the book's database. You call them ONLY by listing them in the "actions" array of your JSON turn (tool name + args object); every tool in the list below is available and will be run for you, and its result comes back in the next message. You have no other tools and must not look for any. Read before you write (call bible first in a new conversation). Make the smallest change that does what was asked. Never invent character or scene ids: get them from bible. Prefer proposing over doing when the author is thinking aloud; do when they ask.
Writes are versioned or snapshotted, so you can act, but tell the author exactly what you changed, by name. Keep replies short and concrete. When you draft or get long text back, summarise it and say where it is; do not paste whole scenes unless asked.`;

/**
 * Run one author message through the agent loop. Calls `onEvent` as it goes so a UI can stream progress.
 * `history` is the prior conversation (author/agent turns only; tool traffic is not persisted).
 */
export async function runAgent(studio: Studio, p: Provider, history: { role: 'user' | 'assistant'; content: string }[], message: string, onEvent?: (e: AgentEvent) => void, maxSteps = 8): Promise<{ reply: string; events: AgentEvent[] }> {
  const tools = studioTools(studio);
  const bible = await studio.bible();
  const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
  const system = `${AGENT_SYSTEM}\n\nTOOLS (call by name with a JSON args object):\n${toolList}\n\nTHE BOOK RIGHT NOW\n${bibleBrief(bible)}`;
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => { events.push(e); onEvent?.(e); };
  const msgs: { role: 'user' | 'assistant'; content: string }[] = [...history, { role: 'user', content: message }];
  let reply = '';
  for (let step = 0; step < maxSteps; step++) {
    const turn = await p.structured({ system, messages: msgs, effort: 'medium', maxTokens: 4000 }, TurnSchema, 'turn');
    if (turn.thought) emit({ kind: 'thought', text: turn.thought });
    reply = turn.reply;
    if (!turn.actions.length || turn.done && !turn.actions.length) { emit({ kind: 'reply', text: reply }); return { reply, events }; }
    const results: string[] = [];
    for (const a of turn.actions) {
      const t = tools.find((x) => x.name === a.tool);
      emit({ kind: 'action', text: `${a.tool} ${JSON.stringify(a.args)}` });
      let out: unknown;
      const missing = (t?.requires ?? []).filter((k) => a.args[k] === undefined || a.args[k] === null || a.args[k] === '');
      try { out = !t ? { error: `unknown tool ${a.tool}` } : missing.length ? { error: `missing required args: ${missing.join(', ')}. Tool spec: ${t.description}` } : await t.run(a.args); } catch (e) { out = { error: (e as Error).message }; }
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      emit({ kind: 'result', text: `${a.tool}: ${text.slice(0, 300)}${text.length > 300 ? '…' : ''}`, data: out });
      results.push(`RESULT of ${a.tool}: ${text.slice(0, 6000)}`);
    }
    msgs.push({ role: 'assistant', content: JSON.stringify({ thought: turn.thought, actions: turn.actions, reply: turn.reply }) });
    msgs.push({ role: 'user', content: `${results.join('\n\n')}\n\nContinue. If the task is complete, return no actions and done=true with the final reply.` });
    if (turn.done) { emit({ kind: 'reply', text: reply }); return { reply, events }; }
  }
  emit({ kind: 'reply', text: reply || 'I stopped after several steps; tell me how to continue.' });
  return { reply, events };
}

export const NATIVE_AGENT_SYSTEM = `You are the studio agent for a novelist. Everything in this studio happens by talking to you; the author can also edit files and screens by hand, and you respect what they changed.
Your tools (the author server) are the book's database. Read before you write: call bible_overview first in a new conversation. Never invent character or scene ids; take them from bible_overview. Scene "as of" arguments are scene ORDER numbers, not ids.
Make the smallest change that does what was asked. Writes are versioned or snapshotted, so act when asked, and then say exactly what you changed, by name. When the author is thinking aloud, propose rather than do. When the author is stuck or asks for ideas, call muse with their scenario; "let X decide" means agency set to X's character id. "Let X decide" on a draft means draft_scene with agency [X's id]. When asked for a character's exact words, quote the tool output verbatim.
Keep replies short and concrete; summarise long text and say where it lives instead of pasting it.`;

/**
 * Native path: run the agent as headless Claude Code with the author MCP server attached to this project.
 * Used when the provider is claude-code. Tool calls are real tool calls, streamed back as events.
 */
export function runNativeAgent(projectDir: string, model: string, history: { role: 'user' | 'assistant'; content: string }[], message: string, onEvent?: (e: AgentEvent) => void, bin = process.env.AUTHOR_CLAUDE_BIN ?? 'claude'): Promise<{ reply: string; events: AgentEvent[] }> {
  const require = createRequire(import.meta.url);
  let mcpMain: string;
  try { mcpMain = require.resolve('@author-studio/mcp/dist/main.js'); }
  catch { mcpMain = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../mcp/dist/main.js'); }
  const mcpConfig = JSON.stringify({ mcpServers: { author: { command: process.execPath, args: [mcpMain], env: { AUTHOR_PROJECT: projectDir, AUTHOR_PROVIDER: process.env.AUTHOR_PROVIDER ?? 'claude-code', AUTHOR_MODEL: process.env.AUTHOR_MODEL ?? model, AUTHOR_MODEL_CHEAP: process.env.AUTHOR_MODEL_CHEAP ?? 'claude-haiku-5-5' } } } });
  const prompt = history.length
    ? history.map((m) => (m.role === 'user' ? `AUTHOR:\n${m.content}` : `YOU (earlier):\n${m.content}`)).join('\n\n') + `\n\nAUTHOR:\n${message}`
    : message;
  const args = ['-p', prompt, '--model', model, '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--mcp-config', mcpConfig, '--allowedTools', 'mcp__author__*', '--no-session-persistence', '--system-prompt', NATIVE_AGENT_SYSTEM];
  const events: AgentEvent[] = [];
  const emit = (e: AgentEvent) => { events.push(e); onEvent?.(e); };
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: nestedClaudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = ''; let reply = ''; let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.on('data', (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let m: { type?: string; message?: { content?: { type: string; name?: string; input?: unknown; text?: string }[] }; result?: unknown; is_error?: boolean };
        try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'assistant') {
          for (const b of m.message?.content ?? []) {
            if (b.type === 'tool_use') emit({ kind: 'action', text: `${(b.name ?? '').replace(/^mcp__author__/, '')} ${JSON.stringify(b.input ?? {}).slice(0, 200)}` });
            else if (b.type === 'text' && b.text) emit({ kind: 'thought', text: b.text.slice(0, 200) });
          }
        } else if (m.type === 'result') {
          reply = String(m.result ?? '');
          if (m.is_error) reject(new Error(`claude: ${reply.slice(0, 300)}`));
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!reply) { reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`)); return; }
      emit({ kind: 'reply', text: reply });
      resolve({ reply, events });
    });
  });
}
