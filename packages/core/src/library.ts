/**
 * The library: one folder on the writer's machine holding one folder per novel.
 * Default: ~/Documents/Author Studio (AUTHOR_LIBRARY overrides). Nothing here is uploaded anywhere.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LibraryEntry { dir: string; title: string; genre: string; scenes: number; characters: number; words: number; updatedAt: string }

export function defaultLibrary(): string {
  return process.env.AUTHOR_LIBRARY ?? path.join(os.homedir(), 'Documents', 'Author Studio');
}

export async function listLibrary(root: string): Promise<LibraryEntry[]> {
  await fs.mkdir(root, { recursive: true });
  const out: LibraryEntry[] = [];
  for (const name of await fs.readdir(root)) {
    const dir = path.join(root, name);
    const entry = await describeProject(dir);
    if (entry) out.push(entry);
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function describeProject(dir: string): Promise<LibraryEntry | null> {
  try {
    const project = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')) as { title: string; genre: string };
    const read = async <T>(f: string, d: T): Promise<T> => { try { return JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as T; } catch { return d; } };
    const scenes = await read<{ id: string }[]>('scenes.json', []);
    const characters = await read<unknown[]>('characters.json', []);
    let words = 0; let updated = (await fs.stat(path.join(dir, 'project.json'))).mtime;
    for (const s of scenes) {
      const sd = path.join(dir, 'manuscript', s.id);
      let files: string[] = [];
      try { files = (await fs.readdir(sd)).filter((f) => /^v\d+\.md$/.test(f)); } catch { continue; }
      const last = files.sort((a, b) => Number(a.slice(1, -3)) - Number(b.slice(1, -3))).at(-1);
      if (!last) continue;
      const st = await fs.stat(path.join(sd, last));
      if (st.mtime > updated) updated = st.mtime;
      words += ((await fs.readFile(path.join(sd, last), 'utf8')).replace(/^<!--.*?-->\n/, '').match(/[A-Za-z'’-]+/g) ?? []).length;
    }
    return { dir, title: project.title, genre: project.genre, scenes: scenes.length, characters: characters.length, words, updatedAt: updated.toISOString() };
  } catch { return null; }
}

/** A folder name for a new novel that does not clash with an existing one. */
export async function newProjectDir(root: string, title: string): Promise<string> {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
  for (let i = 0; ; i++) {
    const dir = path.join(root, i ? `${base}-${i + 1}` : base);
    try { await fs.access(dir); } catch { return dir; }
  }
}
