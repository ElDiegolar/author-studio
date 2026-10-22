/**
 * App settings, stored on the writer's machine (never in a project, never uploaded).
 * AI is a choice: the writer's own Anthropic key, Claude Code if installed, a local model,
 * or none at all (manual mode: every AI action is hidden and the book is written by hand).
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultAiConfig, type AiConfig } from './ai/index.js';

export type AiMode = 'anthropic' | 'claude-code' | 'local' | 'none';

export interface Settings {
  ai: {
    mode: AiMode;
    /** Anthropic API key (mode anthropic). Stored only in the local settings file. */
    apiKey?: string;
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
export function publicSettings(s: Settings | null): { ai: Omit<Settings['ai'], 'apiKey'> & { hasKey: boolean; keyHint: string } } {
  const ai = s?.ai ?? { mode: envMode() };
  const { apiKey, ...rest } = ai;
  return { ai: { ...rest, hasKey: Boolean(apiKey), keyHint: apiKey ? `…${apiKey.slice(-4)}` : '' } };
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
  const strong = { provider: mode, model: s.ai.model || (mode === 'claude-code' ? 'claude-haiku-5-5' : 'claude-opus-5-5'), ...(s.ai.apiKey ? { apiKey: s.ai.apiKey } : {}) };
  const cheap = { ...strong, model: s.ai.cheapModel || 'claude-haiku-5-5' };
  return { ...base, roles: { architect: strong, drafter: strong, actor: strong, editor: strong, extractor: cheap } };
}

export function aiEnabled(cfg: AiConfig): boolean {
  return cfg.roles.drafter.provider !== 'none';
}
