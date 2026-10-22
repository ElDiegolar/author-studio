/**
 * One writer = one directory, shared by every project that names this writer.
 *   writers/<writerId>/events.jsonl        append-only writer soul
 *   writers/<writerId>/souls/<name>.jsonl  saved snapshots (a pen name, "before-reset-…")
 * Home: AUTHOR_WRITER_HOME, default ~/.config/author-studio/writers.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stampWriterEvent, type NewWriterEvent, type WriterEvent } from './events.js';

export function writerHome(): string {
  return process.env.AUTHOR_WRITER_HOME ?? path.join(os.homedir(), '.config', 'author-studio', 'writers');
}

export class WriterStore {
  constructor(readonly dir: string, readonly writerId = path.basename(dir)) {}

  static forWriter(writerId: string): WriterStore {
    const safe = writerId.replace(/[^a-z0-9_-]+/gi, '-');
    return new WriterStore(path.join(writerHome(), safe), safe);
  }

  private eventsPath(): string { return path.join(this.dir, 'events.jsonl'); }

  async events(): Promise<WriterEvent[]> {
    let raw = '';
    try { raw = await fs.readFile(this.eventsPath(), 'utf8'); } catch { return []; }
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as WriterEvent);
  }
  async append(e: NewWriterEvent, now?: Date): Promise<WriterEvent> {
    await fs.mkdir(this.dir, { recursive: true });
    const prev = await this.events();
    const stamped = stampWriterEvent(e, (prev[prev.length - 1]?.seq ?? 0) + 1, now);
    await fs.appendFile(this.eventsPath(), JSON.stringify(stamped) + '\n');
    return stamped;
  }

  /** Save the whole writer soul under a name. Snapshots are immutable copies of the log. */
  async saveSoul(name: string): Promise<string> {
    const safe = name.replace(/[^a-z0-9_-]+/gi, '-');
    const d = path.join(this.dir, 'souls');
    await fs.mkdir(d, { recursive: true });
    const dest = path.join(d, `${safe}.jsonl`);
    const events = await this.events();
    await fs.writeFile(dest, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    return dest;
  }
  async listSouls(): Promise<string[]> {
    try { return (await fs.readdir(path.join(this.dir, 'souls'))).filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6)); }
    catch { return []; }
  }
  /** Replace the live log with a snapshot. The replaced log is archived first. */
  async restoreSoul(name: string): Promise<void> {
    const src = path.join(this.dir, 'souls', `${name}.jsonl`);
    await fs.access(src);
    await this.saveSoul(`before-restore-${Date.now()}`);
    await fs.copyFile(src, this.eventsPath());
  }
  /** Start the writer over. Nothing is deleted: the whole log is archived under souls/. */
  async resetSoul(): Promise<{ archived: string }> {
    const archived = await this.saveSoul(`before-reset-${Date.now()}`);
    await fs.writeFile(this.eventsPath(), '');
    return { archived };
  }
}
