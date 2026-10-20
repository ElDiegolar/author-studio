import type { ZodType } from 'zod/v4';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Rough quality knob; providers map it to effort / sampling. */
  effort?: 'low' | 'medium' | 'high';
}

export interface CompleteResult { text: string; inputTokens?: number; outputTokens?: number }

export interface Provider {
  readonly name: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
  /** Return an object validated by `schema`. Providers may use native structured output or a JSON prompt. */
  structured<T>(req: CompleteRequest, schema: ZodType<T>, schemaName: string): Promise<T>;
}

/** Pull the first JSON object/array out of free text (local models wrap JSON in prose or fences). */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fence ? fence[1]! : text;
  const start = Math.min(...['{', '['].map((c) => body.indexOf(c)).filter((i) => i >= 0));
  if (!Number.isFinite(start)) throw new Error('no JSON in model output');
  const open = body[start]!; const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  return JSON.parse(body.slice(start, end + 1));
}
