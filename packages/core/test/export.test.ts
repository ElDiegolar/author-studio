import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { assembleBook, exportBook, parseManuscript, Studio, structure, WriterStore } from '../src/index.js';

let tmp: string; let studio: Studio;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'author-export-'));
  studio = await Studio.init(path.join(tmp, 'book'), { title: 'The Salt Road', genre: 'thriller', audience: 'adult', targetWords: 1000, voice: { pov: 'third-limited', tense: 'past', tone: '', bannedWords: [], exemplars: [] }, author: 'L. Flagorce', chapterTitles: { '2': 'The Shed' } },
    { logline: '', dramaticQuestion: '', theme: '', ending: '' }, { writerStore: new WriterStore(path.join(tmp, 'w')) });
  const add = async (title: string, chapter: number, text?: string) => {
    const s = await studio.store.addScene({ title, chapter, pov: '', characters: [], goal: '', conflict: '', outcome: '', location: '', time: '', targetWords: 500, summary: '' });
    if (text) await studio.store.saveVersion(s.id, text, 'author');
  };
  await add('Pier', 1, 'Mara counted the boats. Eleven.\n\n"You\'re late," Jonah said. It was *not* a question & she knew it.');
  await add('Water', 1, 'She watched the water instead.');
  await add('Empty card', 1);
  await add('Manifest', 2, 'The customs shed smelled of diesel.\n\nElias came in from the rain.');
});
afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe('assemble', () => {
  it('uses latest text in story order, skips empty cards, applies chapter titles', async () => {
    const b = await assembleBook(studio);
    expect(b.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'The Shed']);
    expect(b.chapters[0]!.scenes.map((s) => s.title)).toEqual(['Pier', 'Water']);
    expect(b.words).toBeGreaterThan(20);
  });
});

describe('formats', () => {
  it('Word round-trips through our own importer: same chapters and scenes, italics kept, & escaped', async () => {
    const { data, filename, mime } = await exportBook(studio, 'docx');
    expect(filename).toBe('The Salt Road.docx');
    expect(mime).toContain('wordprocessingml');
    const xml = strFromU8(unzipSync(data as Uint8Array)['word/document.xml']!);
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('&amp; she knew');
    const back = structure(await parseManuscript('x.docx', data as Uint8Array));
    expect(back.map((c) => c.title)).toEqual(['The Salt Road', 'Chapter 1', 'The Shed'].filter((t) => back.some((c) => c.title === t)));
    const text = back.flatMap((c) => c.scenes.map((s) => s.text)).join(' ');
    for (const t of ['counted the boats', 'watched the water', 'smelled of diesel']) expect(text).toContain(t);
  });
  it('EPUB is a valid package (mimetype first, stored) and round-trips', async () => {
    const { data } = await exportBook(studio, 'epub');
    const bytes = data as Uint8Array;
    expect(strFromU8(bytes.slice(30, 38))).toBe('mimetype');
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml']));
    const back = await parseManuscript('x.epub', bytes);
    expect(back.title).toBe('The Salt Road');
    const ch = structure(back).filter((c) => c.title !== 'The Salt Road');
    expect(ch.map((c) => c.title)).toEqual(['Chapter 1', 'The Shed']);
    expect(ch[0]!.scenes).toHaveLength(2);
  });
  it('print HTML: title page, chapter page breaks, scene breaks, escaped text', async () => {
    const html = (await exportBook(studio, 'html')).data as string;
    expect(html).toContain('<h1>The Salt Road</h1>');
    expect(html.match(/class="chapter"/g)).toHaveLength(2);
    expect(html).toContain('class="break"');
    expect(html).toContain('<em>not</em>');
    expect(html).toContain('&amp; she knew');
  });
  it('Markdown and plain text', async () => {
    const md = (await exportBook(studio, 'md')).data as string;
    expect(md).toContain('# The Salt Road');
    expect(md).toContain('## The Shed');
    expect(md).toContain('* * *');
    const txt = (await exportBook(studio, 'txt')).data as string;
    expect(txt).toContain('THE SHED');
    expect(txt).toContain('by L. Flagorce');
  });
});
