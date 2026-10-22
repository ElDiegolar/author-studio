export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}
export interface Character { id: string; name: string; role: string; summary: string; want: string; need: string; wound: string; arc: string; voiceSample: string; secrets: string[] }
export interface Scene { id: string; order: number; chapter: number; title: string; pov: string; location: string; time: string; goal: string; conflict: string; outcome: string; characters: string[]; status: string; summary: string; targetWords: number }
export interface Bible { project: { id: string; title: string; genre: string; audience: string; targetWords: number; voice: { pov: string; tense: string; tone: string; bannedWords: string[] } }; premise: { logline: string; dramaticQuestion: string; theme: string; ending: string }; world: { id: string; kind: string; name: string; summary: string }[]; characters: Character[]; scenes: Scene[]; facts: { id: string; order: number; text: string }[] }
export interface Finding { level: string; code: string; message: string }
export interface Version { version: number; text: string; source: string; createdAt: string }
