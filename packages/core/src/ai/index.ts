import { AnthropicProvider } from './anthropic.js';
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
  return {
    roles: { architect: s, drafter: s, actor: s, editor: s, extractor: local },
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
