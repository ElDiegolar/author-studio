import { spawn } from 'node:child_process';
import { z, type ZodType } from 'zod/v4';
import { extractJson, type CompleteRequest, type CompleteResult, type Provider } from './provider.js';

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
    const args = ['-p', prompt, '--model', this.model, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--system-prompt', req.system];
    if (jsonSchema) args.push('--json-schema', jsonSchema);
    const env = { ...process.env };
    // A nested claude must not inherit the parent session's identity.
    for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') || k === 'CLAUDECODE' || k === 'CLAUDE_PID') delete env[k];
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
