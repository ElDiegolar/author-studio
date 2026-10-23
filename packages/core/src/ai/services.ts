/**
 * The well-known AI services a writer may already have an account with. Each speaks the
 * OpenAI-style chat API, so one provider covers them all. Model names change every few months, so
 * nothing here pins one: after the key is in, the service's own model list is read and a sensible
 * default is picked by pattern (newest first), which the writer can change.
 */
export type ServiceId = 'openai' | 'gemini' | 'xai' | 'deepseek' | 'mistral' | 'openrouter';

export interface Service {
  id: ServiceId;
  name: string;
  /** What people call it. */
  known: string;
  blurb: string;
  keyUrl: string;
  /** Plain steps to a key, shown in order. */
  steps: string[];
  keyPrefix?: string;
  baseUrl: string;
  /** Newer OpenAI models reject max_tokens. */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /** Reasoning models spend tokens thinking before they write; give them room so replies are not cut off. */
  thinkingRoom: number;
  prefer: RegExp[];
  cheap: RegExp[];
  fallback?: { model: string; cheapModel: string };
}

/** Models that are not for writing (speech, images, embeddings, moderation…). */
const NOT_CHAT = /embed|tts|whisper|transcri|dall-e|image|imagen|veo|audio|realtime|live|moderation|search|codex|computer|guard|ocr|aqa|vision-only|-instruct$/i;

export const SERVICES: Service[] = [
  {
    id: 'openai', name: 'OpenAI', known: 'ChatGPT', blurb: 'The company behind ChatGPT. A ChatGPT subscription does not include this: the API is billed separately, pay as you go.',
    keyUrl: 'https://platform.openai.com/api-keys', keyPrefix: 'sk-',
    steps: ['Sign in at platform.openai.com (your ChatGPT login works).', 'Add a little credit under Billing.', 'Create a new secret key, copy it, and paste it here.'],
    baseUrl: 'https://api.openai.com/v1', tokenParam: 'max_completion_tokens', thinkingRoom: 4096,
    prefer: [/^gpt-\d+(\.\d+)?-terra$/, /^gpt-\d+(\.\d+)?$/, /^gpt-\d+(\.\d+)?-mini$/, /^gpt-4o$/],
    cheap: [/^gpt-\d+(\.\d+)?-luna$/, /^gpt-\d+(\.\d+)?-mini$/, /^gpt-\d+(\.\d+)?-nano$/, /^gpt-4o-mini$/],
  },
  {
    id: 'gemini', name: 'Google Gemini', known: 'Gemini', blurb: 'Google\'s AI. Has a free tier to start with; a Google account is all you need.',
    keyUrl: 'https://aistudio.google.com/apikey', keyPrefix: 'AI',
    steps: ['Sign in at Google AI Studio with your Google account.', 'Press "Create API key".', 'Copy the key and paste it here.'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', tokenParam: 'max_tokens', thinkingRoom: 4096,
    prefer: [/gemini-[\d.]+-pro$/, /gemini-[\d.]+-flash$/, /gemini-[\d.]+-pro/, /gemini-[\d.]+-flash/],
    cheap: [/gemini-[\d.]+-flash-lite$/, /gemini-[\d.]+-flash$/, /gemini-[\d.]+-flash/],
  },
  {
    id: 'xai', name: 'xAI', known: 'Grok', blurb: 'The company behind Grok. Pay as you go.',
    keyUrl: 'https://console.x.ai', keyPrefix: 'xai-',
    steps: ['Sign in at console.x.ai.', 'Add credit under Billing.', 'Create an API key, copy it, and paste it here.'],
    baseUrl: 'https://api.x.ai/v1', tokenParam: 'max_tokens', thinkingRoom: 2048,
    prefer: [/^grok-\d+(\.\d+)?$/, /^grok-\d+(\.\d+)?-\d+$/, /^grok/],
    cheap: [/^grok-.*(mini|fast)/, /^grok-\d+(\.\d+)?$/],
  },
  {
    id: 'deepseek', name: 'DeepSeek', known: 'DeepSeek', blurb: 'Low-cost models from DeepSeek. Pay as you go.',
    keyUrl: 'https://platform.deepseek.com/api_keys', keyPrefix: 'sk-',
    steps: ['Sign in at platform.deepseek.com.', 'Top up a small balance.', 'Create an API key, copy it, and paste it here.'],
    baseUrl: 'https://api.deepseek.com/v1', tokenParam: 'max_tokens', thinkingRoom: 0,
    prefer: [/^deepseek-chat$/], cheap: [/^deepseek-chat$/], fallback: { model: 'deepseek-chat', cheapModel: 'deepseek-chat' },
  },
  {
    id: 'mistral', name: 'Mistral', known: 'Le Chat', blurb: 'European models from Mistral AI, the makers of Le Chat. Has a free tier to try.',
    keyUrl: 'https://console.mistral.ai/api-keys',
    steps: ['Sign in at console.mistral.ai.', 'Choose a plan (the free one is fine to try).', 'Create an API key, copy it, and paste it here.'],
    baseUrl: 'https://api.mistral.ai/v1', tokenParam: 'max_tokens', thinkingRoom: 0,
    prefer: [/^mistral-large-latest$/, /^mistral-medium-latest$/], cheap: [/^mistral-small-latest$/], fallback: { model: 'mistral-large-latest', cheapModel: 'mistral-small-latest' },
  },
  {
    id: 'openrouter', name: 'OpenRouter', known: 'OpenRouter', blurb: 'One key for hundreds of models from every company. Pay as you go.',
    keyUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-',
    steps: ['Sign in at openrouter.ai.', 'Add credit.', 'Create a key, copy it, and paste it here.'],
    baseUrl: 'https://openrouter.ai/api/v1', tokenParam: 'max_tokens', thinkingRoom: 2048,
    prefer: [/^openrouter\/auto$/], cheap: [/^openrouter\/auto$/], fallback: { model: 'openrouter/auto', cheapModel: 'openrouter/auto' },
  },
];

export const serviceById = (id: string | undefined): Service | undefined => SERVICES.find((s) => s.id === id);

/** The service's own list of models this key can use, newest release first. */
export async function listServiceModels(s: Service, apiKey: string): Promise<string[]> {
  const r = await fetch(`${s.baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: { id: string; created?: number }[] };
  const list = (j.data ?? []).map((m) => ({ id: m.id.replace(/^models\//, ''), created: m.created ?? 0 })).filter((m) => m.id && !NOT_CHAT.test(m.id));
  // Release dates beat names: grok-4.6 came after grok-4.20.
  return list.sort((a, b) => b.created - a.created || byNewest(a.id, b.id)).map((m) => m.id);
}

/** Without release dates, version numbers compare numerically, so gpt-5.10 beats gpt-5.9. */
const byNewest = (a: string, b: string) => b.localeCompare(a, 'en', { numeric: true });
function pick(ids: string[], patterns: RegExp[]): string | undefined {
  const stable = ids.filter((id) => !/preview|exp|beta|alpha/i.test(id));
  // `ids` arrive newest first (see listServiceModels), so the first match is the newest one.
  for (const pool of [stable, ids]) for (const re of patterns) { const hit = pool.find((id) => re.test(id)); if (hit) return hit; }
  return undefined;
}

/** A strong model for drafting and characters, a cheap one for extraction and proofreading. */
export function pickServiceModels(s: Service, ids: string[]): { model: string; cheapModel: string } | null {
  const model = pick(ids, s.prefer) ?? s.fallback?.model ?? ids[0];
  if (!model) return null;
  return { model, cheapModel: pick(ids, s.cheap) ?? s.fallback?.cheapModel ?? model };
}
