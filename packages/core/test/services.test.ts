import { describe, expect, it } from 'vitest';
import { explainAiError, pickServiceModels, serviceById } from '../src/index.js';

describe('known AI services', () => {
  it('picks the newest strong and cheap models from what the key can use, skipping previews', () => {
    const openai = serviceById('openai')!;
    // newest first, as listServiceModels returns them
    expect(pickServiceModels(openai, ['gpt-6-terra-preview', 'gpt-5.10-terra', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-4o', 'gpt-4o-mini'])).toEqual({ model: 'gpt-5.10-terra', cheapModel: 'gpt-5.6-luna' });
    expect(pickServiceModels(serviceById('gemini')!, ['gemini-3.5-pro-preview', 'gemini-3.1-pro', 'gemini-3.1-flash', 'gemini-3.1-flash-lite'])).toEqual({ model: 'gemini-3.1-pro', cheapModel: 'gemini-3.1-flash-lite' });
    expect(pickServiceModels(serviceById('xai')!, ['grok-4.6', 'grok-build-0.1', 'grok-4.3', 'grok-4.20'])!.model).toBe('grok-4.6');
    expect(pickServiceModels(serviceById('mistral')!, [])).toEqual({ model: 'mistral-large-latest', cheapModel: 'mistral-small-latest' });
  });
  it('explains failures in plain words', () => {
    expect(explainAiError('cloud', new Error('openai provider 401: Incorrect API key provided'), 'openai')).toMatch(/not accepted/);
    expect(explainAiError('cloud', new Error('429 You exceeded your current quota'), 'gemini')).toMatch(/no credit/);
    expect(explainAiError('claude-code', new Error('spawn claude ENOENT'))).toMatch(/not installed/);
    expect(explainAiError('local', new Error('fetch failed'))).toMatch(/model app open/);
  });
});
