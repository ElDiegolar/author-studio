import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { z, type ZodType } from 'zod/v4';
import { extractJson, type CompleteRequest, type CompleteResult, type Provider } from './provider.js';

/**
 * A private CLAUDE_CONFIG_DIR for nested runs: the author's credentials (symlinked) and nothing else,
 * so the studio never inherits the machine's hooks, MCP servers, memory or settings.
 */
export function isolatedClaudeConfigDir(): string {
  const dir = process.env.AUTHOR_CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'author-studio', 'claude');
  const creds = path.join(dir, '.credentials.json');
  const source = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), '.credentials.json');
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Windows needs admin rights for symlinks; a copy works (claude refreshes it like its own).
    if (!existsSync(creds) && existsSync(source)) { try { symlinkSync(source, creds); } catch { copyFileSync(source, creds); } }
  } catch { /* best effort: claude will report auth problems itself */ }
  return dir;
}

/** Spawn args and env shared by every nested claude run. */
export function nestedClaudeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: isolatedClaudeConfigDir() };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE' || k === 'CLAUDE_PID') delete env[k];
  return env;
}

/**
 * Where `claude` really is. On Windows a shell-less spawn cannot run the npm `claude.cmd` shim (and a
 * shell would mangle prompts), so prefer the native claude.exe, else run the shim's cli.js with node.
 */
export function resolveClaude(bin: string): { command: string; prefix: string[] } {
  if (process.platform !== 'win32' || /[\\/]/.test(bin)) return { command: bin, prefix: [] };
  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean);
  const extra = [path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA ?? '', 'npm')];
  for (const d of [...dirs, ...extra]) { const exe = path.join(d, `${bin}.exe`); if (existsSync(exe)) return { command: exe, prefix: [] }; }
  for (const d of [...dirs, ...extra]) {
    const cmd = path.join(d, `${bin}.cmd`);
    if (!existsSync(cmd)) continue;
    const js = /"%~?dp0%?\\?([^"]+\.js)"/i.exec(readFileSync(cmd, 'utf8'))?.[1];
    if (js) return { command: process.env.AUTHOR_NODE_BIN ?? 'node', prefix: [path.join(d, js.replace(/^\\/, ''))] };
  }
  return { command: `${bin}.exe`, prefix: [] };
}

/** Spawn claude with no shell; the prompt goes over stdin (no quoting issues, no command-line length limit). */
export function spawnClaude(bin: string, args: string[], prompt: string): ChildProcessByStdio<Writable, Readable, Readable> {
  const { command, prefix } = resolveClaude(bin);
  const child = spawn(command, [...prefix, ...args], { env: nestedClaudeEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stdin.on('error', () => { /* claude exited early; its stderr says why */ });
  child.stdin.end(prompt);
  return child;
}

/**
 * Headless Claude Code as a provider: every call is `claude -p … --output-format json`.
 * Uses the author's Claude subscription (whatever `claude` is logged in as), no API key.
 * Tools are disabled and sessions are not persisted, so each call is a plain completion.
 */
export class ClaudeCodeProvider implements Provider {
  readonly name: string;
  constructor(readonly model = 'claude-haiku-5-5', readonly bin = process.env.AUTHOR_CLAUDE_BIN ?? 'claude') {
    this.name = `claude-code:${model}`;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const out = await this.run(req);
    return { text: String(out.result ?? ''), inputTokens: out.usage?.input_tokens, outputTokens: out.usage?.output_tokens };
  }

  async structured<T>(req: CompleteRequest, schema: ZodType<T>, name: string): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema as ZodType<unknown>, { target: 'draft-7', unrepresentable: 'any' });
    const out = await this.run(req, JSON.stringify(jsonSchema));
    const raw = out.structured_output ?? (typeof out.result === 'string' ? safeExtract(out.result) : out.result);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    throw new Error(`claude-code provider: invalid ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }

  private run(req: CompleteRequest, jsonSchema?: string): Promise<ClaudeResult> {
    // Fold the conversation into one prompt: headless mode takes a single user prompt.
    const prompt = req.messages.length === 1
      ? req.messages[0]!.content
      : req.messages.map((m) => (m.role === 'user' ? `AUTHOR:\n${m.content}` : `YOU (earlier):\n${m.content}`)).join('\n\n') + '\n\nRespond to the last AUTHOR message.';
    // --tools '' drops built-in tools; --strict-mcp-config with an empty config drops the user's MCP servers,
    // otherwise the nested claude sees (and tries to use) every server registered on this machine.
    const args = ['-p', '--model', this.model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--system-prompt', req.system];
    if (jsonSchema) args.push('--json-schema', jsonSchema);
    return new Promise((resolve, reject) => {
      const child = spawnClaude(this.bin, args, prompt);
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        let out: ClaudeResult;
        try { out = JSON.parse(stdout) as ClaudeResult; } catch { reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300) || stdout.slice(0, 300)}`)); return; }
        if (out.is_error) reject(new Error(`claude: ${String(out.result).slice(0, 300)}`)); else resolve(out);
      });
    });
  }
}

interface ClaudeResult { result?: unknown; structured_output?: unknown; is_error?: boolean; usage?: { input_tokens?: number; output_tokens?: number }; total_cost_usd?: number }

function safeExtract(text: string): unknown { try { return extractJson(text); } catch { return text; } }
