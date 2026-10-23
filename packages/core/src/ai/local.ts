import { z, type ZodType } from 'zod/v4';
import { extractJson, type CompleteRequest, type CompleteResult, type Provider } from './provider.js';

/** Options for a hosted OpenAI-style service (OpenAI, Gemini, Grok…) rather than a server on this machine. */
export interface RemoteOptions { apiKey: string; tokenParam?: 'max_tokens' | 'max_completion_tokens'; thinkingRoom?: number; service?: string }

/** Any OpenAI-compatible server: a local one (llama-server, Ollama, LM Studio) or a hosted service with a key. */
export class LocalProvider implements Provider {
  readonly name: string;
  constructor(readonly baseUrl = 'http://127.0.0.1:8081/v1', readonly model = 'local', readonly thinking = false, readonly remote?: RemoteOptions) {
    this.name = remote ? `${remote.service ?? 'remote'}:${model}` : `local:${model}`;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const max = req.maxTokens ?? 2048;
    const body = this.remote
      ? { model: this.model, messages: [{ role: 'system', content: req.system }, ...req.messages], [this.remote.tokenParam ?? 'max_tokens']: max + (this.remote.thinkingRoom ?? 0) }
      : { model: this.model, messages: [{ role: 'system', content: req.system }, ...req.messages], max_tokens: max, chat_template_kwargs: { enable_thinking: this.thinking } };
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(this.remote ? { authorization: `Bearer ${this.remote.apiKey}` } : {}) }, body: JSON.stringify(body),
      ...(this.remote ? { signal: AbortSignal.timeout(300_000) } : {}),
    });
    if (!r.ok) throw new Error(`${this.remote ? this.remote.service ?? 'remote' : 'local'} provider ${r.status}: ${(await r.text()).slice(0, 400)}`);
    const j = (await r.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
    return { text: j.choices[0]?.message.content ?? '', inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens };
  }

  async structured<T>(req: CompleteRequest, schema: ZodType<T>, name: string): Promise<T> {
    // Hosted models follow a JSON schema well; small local ones do better with a worked example.
    const shape = this.remote ? `${schema.description ? `${schema.description}\n` : ''}JSON schema:\n${JSON.stringify(z.toJSONSchema(schema as ZodType<unknown>, { target: 'draft-7', unrepresentable: 'any' }))}` : describe(schema);
    const sys = `${req.system}\n\nReply with ONLY a JSON value named ${name} matching this shape, no prose:\n${shape}`;
    let last = ''; let why = '';
    let messages = req.messages;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { text } = await this.complete({ ...req, system: sys, messages });
      last = text;
      try {
        const parsed = schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        why = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      } catch (e) { why = (e as Error).message; }
      // tell the model exactly what was wrong and ask again
      messages = [...req.messages, { role: 'assistant', content: text }, { role: 'user', content: `That JSON was invalid (${why}). Return only the corrected JSON.` }];
    }
    throw new Error(`local provider could not produce valid ${name} (${why}): ${last.slice(0, 200)}`);
  }
}

function describe(schema: ZodType<unknown>): string {
  // zod has no built-in JSON-schema printer in v3; the schemas in this project carry a `.description`
  // with a worked example, which is what small models follow best.
  return schema.description ?? '(see field names in the request)';
}
