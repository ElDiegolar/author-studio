/**
 * App settings, stored on the writer's machine (never in a project, never uploaded).
 * AI is a choice: the writer's own Anthropic key, Claude Code if installed, a local model,
 * or none at all (manual mode: every AI action is hidden and the book is written by hand).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAiConfig, type AiConfig } from './ai/index.js';
import type { ServiceId } from './ai/services.js';

export type AiMode = 'anthropic' | 'claude-code' | 'local' | 'cloud' | 'studio' | 'none';

export interface Settings {
  ai: {
    mode: AiMode;
    /** Anthropic API key (mode anthropic). Stored only in the local settings file. */
    apiKey?: string;
    /** Mode cloud: which hosted service (OpenAI, Gemini, Grok…). */
    service?: ServiceId;
    /** One key per hosted service, so switching back and forth never asks twice. Local file only. */
    keys?: Partial<Record<ServiceId, string>>;
    /** Mode studio: Author Studio AI, the subscription. The key arrives by device sign-in; the writer never sees it. */
    studio?: { key: string; email: string; plan: string; baseUrl: string; model: string; cheapModel: string; portalUrl?: string };
    /** Strong model for drafting, characters and the agent. */
    model?: string;
    /** Cheap model for extraction and proofreading. */
    cheapModel?: string;
    localUrl?: string;
    localModel?: string;
  };
}

export function settingsPath(): string {
  return process.env.AUTHOR_SETTINGS ?? path.join(os.homedir(), '.config', 'author-studio', 'settings.json');
}

/** Null when the writer has never saved settings (then the environment decides, as before). */
export async function loadSettings(file = settingsPath()): Promise<Settings | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as Settings; } catch { return null; }
}

export async function saveSettings(s: Settings, file = settingsPath()): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** Settings as the UI may see them: the key is never sent back, only whether one is set. */
const hint = (k: string) => `…${k.slice(-4)}`;
/** Settings as the UI may see them: keys are never sent back, only which services have one and its last four characters. */
export function publicSettings(s: Settings | null): { ai: Omit<Settings['ai'], 'apiKey' | 'keys' | 'studio'> & { hasKey: boolean; keyHint: string; keyHints: Partial<Record<ServiceId, string>>; studio?: { email: string; plan: string; portalUrl?: string } } } {
  const ai = s?.ai ?? { mode: envMode() };
  const { apiKey, keys, studio, ...rest } = ai;
  const keyHints = Object.fromEntries(Object.entries(keys ?? {}).filter(([, k]) => k).map(([id, k]) => [id, hint(k!)])) as Partial<Record<ServiceId, string>>;
  return { ai: { ...rest, hasKey: Boolean(apiKey), keyHint: apiKey ? hint(apiKey) : '', keyHints, ...(studio ? { studio: { email: studio.email, plan: studio.plan, ...(studio.portalUrl ? { portalUrl: studio.portalUrl } : {}) } } : {}) } };
}

function envMode(): AiMode {
  const r = defaultAiConfig().roles.drafter.provider;
  return r;
}

export function aiConfigFrom(s: Settings | null): AiConfig {
  if (!s) return defaultAiConfig();
  const base = defaultAiConfig();
  const { mode } = s.ai;
  if (mode === 'none') {
    const none = { provider: 'none' as const };
    return { ...base, roles: { architect: none, drafter: none, actor: none, editor: none, extractor: none } };
  }
  if (mode === 'local') {
    const local = { provider: 'local' as const, model: s.ai.localModel || 'local' };
    return { ...base, localUrl: s.ai.localUrl || base.localUrl, roles: { architect: local, drafter: local, actor: local, editor: local, extractor: local } };
  }
  if (mode === 'studio') {
    const st = s.ai.studio;
    if (!st) return aiConfigFrom({ ai: { mode: 'none' } });
    const strong = { provider: 'cloud' as const, service: 'openrouter' as const, baseUrl: st.baseUrl, model: st.model, apiKey: st.key };
    return { ...base, roles: { architect: strong, drafter: strong, actor: strong, editor: strong, extractor: { ...strong, model: st.cheapModel || st.model } } };
  }
  if (mode === 'cloud') {
    const apiKey = s.ai.service ? s.ai.keys?.[s.ai.service] : undefined;
    const strong = { provider: 'cloud' as const, service: s.ai.service, model: s.ai.model, ...(apiKey ? { apiKey } : {}) };
    return { ...base, roles: { architect: strong, drafter: strong, actor: strong, editor: strong, extractor: { ...strong, model: s.ai.cheapModel || s.ai.model } } };
  }
  const strong = { provider: mode, model: s.ai.model || (mode === 'claude-code' ? 'claude-haiku-5-5' : 'claude-opus-5-5'), ...(s.ai.apiKey ? { apiKey: s.ai.apiKey } : {}) };
  const cheap = { ...strong, model: s.ai.cheapModel || 'claude-haiku-5-5' };
  return { ...base, roles: { architect: strong, drafter: strong, actor: strong, editor: strong, extractor: cheap } };
}

export function aiEnabled(cfg: AiConfig): boolean {
  return cfg.roles.drafter.provider !== 'none';
}
