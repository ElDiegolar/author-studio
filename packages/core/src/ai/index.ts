import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AnthropicProvider } from './anthropic.js';

/** Load KEY=value lines from ~/.config/author-studio/env and ./.env into process.env (existing vars win). No dependency needed. */
export function loadEnvFiles(): void {
  const home = process.env.HOME ?? '';
  for (const f of [path.join(home, '.config', 'author-studio', 'env'), path.resolve('.env')]) {
    try {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
      }
    } catch { /* no file */ }
  }
}
loadEnvFiles();
import { LocalProvider } from './local.js';
import type { Provider } from './provider.js';

export type Role = 'architect' | 'drafter' | 'actor' | 'extractor' | 'editor';

export interface AiConfig {
  /** Provider per role. 'anthropic' needs credentials; 'local' needs llama-server. */
  roles: Record<Role, { provider: 'anthropic' | 'local'; model?: string }>;
  localUrl: string;
  localThinking: boolean;
}

export function defaultAiConfig(): AiConfig {
  const haveClaude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.AUTHOR_USE_CLAUDE);
  const strong = haveClaude ? ('anthropic' as const) : ('local' as const);
  const local = { provider: 'local' as const, model: process.env.AUTHOR_LOCAL_MODEL ?? 'bonsai2-9b' };
  const s = { provider: strong, model: strong === 'anthropic' ? (process.env.AUTHOR_MODEL ?? 'claude-opus-5-5') : local.model };
  // Per-role overrides: AUTHOR_MODEL_ARCHITECT=claude-haiku-5-5 etc. Any claude-* value selects the Anthropic provider.
  const role = (r: Role, fallback: { provider: 'anthropic' | 'local'; model?: string }) => {
    const m = process.env[`AUTHOR_MODEL_${r.toUpperCase()}`];
    if (!m) return fallback;
    return m.startsWith('claude-') ? { provider: 'anthropic' as const, model: m } : { provider: 'local' as const, model: m };
  };
  const cheap = haveClaude ? { provider: 'anthropic' as const, model: process.env.AUTHOR_MODEL_CHEAP ?? 'claude-haiku-5-5' } : local;
  return {
    roles: { architect: role('architect', s), drafter: role('drafter', s), actor: role('actor', s), editor: role('editor', s), extractor: role('extractor', cheap) },
    localUrl: process.env.AUTHOR_LOCAL_URL ?? 'http://127.0.0.1:8081/v1',
    localThinking: process.env.AUTHOR_LOCAL_THINKING === '1',
  };
}

const cache = new Map<string, Provider>();
export function providerFor(role: Role, cfg: AiConfig = defaultAiConfig()): Provider {
  const r = cfg.roles[role];
  const key = `${r.provider}:${r.model ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    p = r.provider === 'anthropic' ? new AnthropicProvider(r.model) : new LocalProvider(cfg.localUrl, r.model, cfg.localThinking);
    cache.set(key, p);
  }
  return p;
}

export { AnthropicProvider, LocalProvider };
export type { Provider } from './provider.js';
