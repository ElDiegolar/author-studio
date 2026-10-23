/**
 * Helping a writer switch AI on without knowing how AI works: find what this computer already has
 * (Claude Code signed in, a local model app running), and test a choice with one tiny request,
 * explaining any failure in plain words instead of an error code.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { providerFor } from './index.js';
import { resolveClaude } from './claudeCode.js';
import { aiConfigFrom, type Settings } from '../settings.js';
import { listServiceModels, pickServiceModels, serviceById } from './services.js';

export interface LocalServer { url: string; app: string; models: string[] }
export interface AiDetection {
  /** signedIn is null where it cannot be known without trying (macOS keeps the login in the Keychain). */
  claudeCode: { installed: boolean; signedIn: boolean | null };
  local: LocalServer[];
}

/** Where the common local model apps listen by default. */
const LOCAL_APPS: { app: string; url: string }[] = [
  { app: 'Ollama', url: 'http://127.0.0.1:11434/v1' },
  { app: 'LM Studio', url: 'http://127.0.0.1:1234/v1' },
  { app: 'llama.cpp', url: 'http://127.0.0.1:8080/v1' },
  { app: 'llama.cpp', url: 'http://127.0.0.1:8081/v1' },
];

async function probeLocal(app: string, url: string): Promise<LocalServer | null> {
  try {
    const r = await fetch(`${url}/models`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { id: string }[] };
    return { app, url, models: (j.data ?? []).map((m) => m.id).filter(Boolean) };
  } catch { return null; }
}

function claudeVersion(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { command, prefix } = resolveClaude(bin);
    let done = false; const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
    try {
      const child = spawn(command, [...prefix, '--version'], { stdio: 'ignore', windowsHide: true });
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0));
      setTimeout(() => { child.kill(); finish(false); }, 4000);
    } catch { finish(false); }
  });
}

export async function detectAi(): Promise<AiDetection> {
  const bin = process.env.AUTHOR_CLAUDE_BIN ?? 'claude';
  // AUTHOR_LOCAL_PROBE overrides where to look (comma-separated URLs; empty: do not look), for tests.
  const probe = process.env.AUTHOR_LOCAL_PROBE;
  const apps = probe === undefined ? LOCAL_APPS : probe.split(',').filter(Boolean).map((url) => ({ app: 'Local model', url }));
  const [installed, ...found] = await Promise.all([claudeVersion(bin), ...apps.map((a) => probeLocal(a.app, a.url))]);
  const creds = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), '.credentials.json');
  const signedIn = !installed ? false : existsSync(creds) ? true : process.platform === 'darwin' ? null : false;
  return { claudeCode: { installed, signedIn }, local: found.filter((x): x is LocalServer => x !== null) };
}

export type AiTest = { ok: true; ms: number } | { ok: false; reason: string };

/** Turns a provider failure into a sentence a writer can act on. */
export function explainAiError(mode: Settings['ai']['mode'], e: unknown, service?: string): string {
  const m = String((e as Error)?.message ?? e);
  if (/timed? ?out|aborted/i.test(m)) return 'It took too long to answer. Try again; if it keeps happening, check your internet connection.';
  if (mode === 'studio') {
    if (/limit|402|credit|insufficient|quota/i.test(m)) return 'You have used this month\'s AI allowance. It refills at the start of next month; your writing is unaffected.';
    if (/401|403|disabled|unauthori/i.test(m)) return 'Your Author Studio AI subscription is not active. Check it in your account, or sign in again in Settings.';
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network/i.test(m)) return 'Could not reach the AI. Check your internet connection.';
  }
  if (mode === 'anthropic' || mode === 'cloud') {
    const who = mode === 'anthropic' ? 'Anthropic' : serviceById(service)?.name ?? 'the service';
    if (/401|authenticat|invalid.*key|api.?key.*(invalid|not valid)|incorrect api key|x-api-key|API_KEY_INVALID/i.test(m)) return `That key was not accepted. Check you copied all of it${mode === 'anthropic' ? ', starting with sk-ant-' : ''}.`;
    if (/credit|billing|balance|402|quota|insufficient/i.test(m)) return `The key works, but the ${who} account has no credit (or used its free allowance). Add some on their billing page, then try again.`;
    if (/403|permission|not allowed|region|location/i.test(m)) return `${who} would not allow this key to be used here. Check the key's permissions on their site.`;
    if (/429|rate/i.test(m)) return `${who} is busy or the account hit its limit. Wait a minute and try again.`;
    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network/i.test(m)) return `Could not reach ${who}. Check your internet connection.`;
    if (/no key|api key|apiKey/i.test(m)) return 'Paste your key first.';
  }
  if (mode === 'claude-code') {
    if (/ENOENT|not found|not recognized/i.test(m)) return 'Claude Code is not installed on this computer.';
    if (/log ?in|logged|auth|credential|401/i.test(m)) return 'Claude Code is installed but not signed in. Open Claude Code once, sign in, then try again.';
  }
  if (mode === 'local') {
    if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(m)) return 'Nothing is answering at that address. Is the model app open and running?';
    if (/404|model/i.test(m)) return 'The app is running, but that model is not loaded. Pick one of the models it lists.';
  }
  return `It did not work: ${m.slice(0, 200)}`;
}

/** One tiny request through the cheap role, so a working setup is proven before it is saved. */
export async function testAi(settings: Settings): Promise<AiTest> {
  const { mode } = settings.ai;
  if (mode === 'none') return { ok: true, ms: 0 };
  if (mode === 'anthropic' && !settings.ai.apiKey) return { ok: false, reason: 'Paste your key first.' };
  if (mode === 'cloud' && !(settings.ai.service && settings.ai.keys?.[settings.ai.service])) return { ok: false, reason: 'Paste your key first.' };
  if (mode === 'studio' && !settings.ai.studio) return { ok: false, reason: 'Sign in to Author Studio AI first.' };
  const started = Date.now();
  try {
    const p = providerFor('extractor', aiConfigFrom(settings));
    const call = p.complete({ system: 'Reply with the single word OK.', messages: [{ role: 'user', content: 'Are you there?' }], maxTokens: 8, effort: 'low' });
    const limit = mode === 'claude-code' ? 90_000 : 45_000;
    await Promise.race([call, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), limit))]);
    return { ok: true, ms: Date.now() - started };
  } catch (e) { return { ok: false, reason: explainAiError(mode, e, settings.ai.service) }; }
}

/**
 * Fill in what a writer should not have to know: for a hosted service, read its model list with the
 * key and pick a strong and a cheap model (keeping a choice the writer already made, if still offered).
 */
export async function prepareAi(settings: Settings): Promise<{ ok: true; settings: Settings; models: string[] } | { ok: false; reason: string }> {
  const { mode, service } = settings.ai;
  if (mode !== 'cloud') return { ok: true, settings, models: [] };
  const svc = serviceById(service);
  const key = service ? settings.ai.keys?.[service] : undefined;
  if (!svc) return { ok: false, reason: 'Choose a service first.' };
  if (!key) return { ok: false, reason: 'Paste your key first.' };
  let models: string[];
  try { models = await listServiceModels(svc, key); } catch (e) { return { ok: false, reason: explainAiError('cloud', e, service) }; }
  const picked = pickServiceModels(svc, models);
  if (!picked) return { ok: false, reason: `The key works, but ${svc.name} lists no models it can use for writing.` };
  const keep = (m: string | undefined) => (m && (models.includes(m) || !models.length) ? m : undefined);
  return { ok: true, models, settings: { ai: { ...settings.ai, model: keep(settings.ai.model) ?? picked.model, cheapModel: keep(settings.ai.cheapModel) ?? picked.cheapModel } } };
}
