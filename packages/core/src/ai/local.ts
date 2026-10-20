import type { ZodType } from 'zod/v4';
import { extractJson, type CompleteRequest, type CompleteResult, type Provider } from './provider.js';

/** Any OpenAI-compatible local server (llama-server). Used for cheap bulk roles and offline work. */
export class LocalProvider implements Provider {
  readonly name: string;
  constructor(readonly baseUrl = 'http://127.0.0.1:8081/v1', readonly model = 'local', readonly thinking = false) {
    this.name = `local:${model}`;
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const body = {
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_tokens: req.maxTokens ?? 2048,
      chat_template_kwargs: { enable_thinking: this.thinking },
    };
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`local provider ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
    return { text: j.choices[0]?.message.content ?? '', inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens };
  }

  async structured<T>(req: CompleteRequest, schema: ZodType<T>, name: string): Promise<T> {
    const sys = `${req.system}\n\nReply with ONLY a JSON value named ${name} matching this shape, no prose:\n${describe(schema)}`;
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
