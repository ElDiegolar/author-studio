import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { run } from './helpers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sh = promisify(execFile);

/** Same model wiring as the web server under test, but a separate project and writer soul. */
function env(project: string): NodeJS.ProcessEnv {
  const r = run();
  const e: NodeJS.ProcessEnv = { ...process.env, AUTHOR_PROJECT: project, AUTHOR_WRITER_HOME: path.join(r.tmp, 'cli-writers') };
  if (!r.live) Object.assign(e, { AUTHOR_PROVIDER: 'local', AUTHOR_LOCAL_URL: r.fakeUrl!, AUTHOR_LOCAL_MODEL: 'fake' });
  return e;
}
async function cli(project: string, ...args: string[]): Promise<string> {
  const { stdout } = await sh(process.execPath, [path.join(root, 'packages/cli/dist/main.js'), ...args], { env: env(project), maxBuffer: 1 << 24 });
  return stdout;
}
const lastJson = (out: string) => JSON.parse(out.slice(out.lastIndexOf('\n{') + 1));

test.describe.serial('CLI and MCP', () => {
  let project = '';
  let mara = '';
  let scene = '';

  test('CLI: init, cast, scene, draft, rewrite, accept, chat at a horizon, writer soul, verify, export', async () => {
    project = path.join(run().tmp, 'cli-novel');
    await cli(project, 'init', project, '--title', 'CLI Road', '--genre', 'thriller');
    mara = lastJson(await cli(project, 'character', 'add', project, '--name', 'Mara Voss', '--role', 'protagonist', '--summary', 'Counts boats.')).id;
    const s = lastJson(await cli(project, 'scene', 'add', project, '--title', 'The Manifest', '--chapter', '1', '--pov', mara, '--cast', mara, '--goal', 'check it', '--conflict', 'pressure', '--outcome', 'copy kept', '--words', '150'));
    scene = s.id;
    const drafted = await cli(project, 'draft', project, scene);
    expect(lastJson(drafted).version).toBe(1);
    const draftText = drafted.slice(0, drafted.lastIndexOf('\n{')).trim();
    const mine = path.join(run().tmp, 'mine.md');
    await fs.writeFile(mine, draftText.replace(/ said (quietly|softly)[^.]*\./g, '."').replace(/slowly and carefully /g, ''));
    expect(lastJson(await cli(project, 'write', project, scene, mine)).version).toBe(2);
    const accepted = JSON.parse(await cli(project, 'accept', project, scene));
    expect(accepted.witnessed).toContain('Mara Voss');
    const state = JSON.parse(await cli(project, 'state', project, mara, '--as-of', '0'));
    expect(state.witnessed).toEqual([]);
    const writer = JSON.parse(await cli(project, 'writer', 'show', project));
    expect(writer.edits).toBe(1);
    const learned = JSON.parse(await cli(project, 'writer', 'learn', project)) as string[];
    expect(learned.length).toBeGreaterThan(0);
    const ruleId = learned[0]!.split(' ')[0]!;
    expect(JSON.parse(await cli(project, 'writer', 'confirm', project, ruleId)).status).toBe('confirmed');
    const report = JSON.parse(await cli(project, 'verify', project));
    expect(report).toHaveProperty('continuity');
    expect(await cli(project, 'export', project)).toContain('# CLI Road');
  });

  test('MCP: tools are listed and answer over stdio', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'packages/mcp/dist/main.js')], env: env(project) as Record<string, string> });
    const client = new Client({ name: 'e2e', version: '1.0.0' });
    await client.connect(transport);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name);
      for (const t of ['bible_overview', 'character_chat', 'draft_scene', 'writer_soul', 'writer_rule', 'verify', 'export_markdown']) expect(tools).toContain(t);
      const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);
      expect(text(await client.callTool({ name: 'bible_overview', arguments: {} }))).toContain('CLI Road');
      const soul = JSON.parse(text(await client.callTool({ name: 'writer_soul', arguments: {} })));
      expect(soul.rules.some((r: { status: string }) => r.status === 'confirmed')).toBe(true);
      const chat = JSON.parse(text(await client.callTool({ name: 'character_chat', arguments: { id: mara, message: 'Did you keep a copy?', as_of: 1 } })));
      expect(typeof chat.answer).toBe('string');
    } finally { await client.close(); }
  });
});
