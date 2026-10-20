import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod/v4';
import type { CompleteRequest, CompleteResult, Provider } from './provider.js';

/**
 * Claude provider. Default model claude-opus-5-5 with server-side refusal fallbacks on.
 * Credentials come from ANTHROPIC_API_KEY or an `ant auth login` profile.
 */
export class AnthropicProvider implements Provider {
  readonly name: string;
  private client: Anthropic;
  constructor(readonly model = 'claude-opus-5-5') {
    this.client = new Anthropic();
    this.name = `anthropic:${model}`;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages,
      output_config: { effort: req.effort ?? 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('model declined this request');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
  }

  async structured<T>(req: CompleteRequest, schema: ZodType<T>, _name: string): Promise<T> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: req.messages,
      output_config: { effort: req.effort ?? 'medium', format: zodOutputFormat(schema) },
    });
    if (res.parsed_output == null) throw new Error('structured output failed to parse');
    return res.parsed_output as T;
  }
}
