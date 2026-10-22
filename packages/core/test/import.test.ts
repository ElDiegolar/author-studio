import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { castCandidates, defaultAiConfig, importIntoLibrary, listLibrary, measureVoice, parseManuscript, preview, rtfToText, structure, WriterStore, aiConfigFrom, type Parsed } from '../src/index.js';

const CH1 = ['Mara counted the boats from the end of the pier. Eleven. There should have been twelve.', '"You\'re late," Jonah said. He did not turn around.', 'She watched the water instead. Mara knew the Albatross was gone.'];
const CH2 = ['The customs shed smelled of diesel. Jonah waited by the desk with the manifest.', '"Sign it," Jonah said. Mara read every line before she did.', 'Elias Thorne came in from the rain and said nothing at all.'];

const u8 = (s: string) => strToU8(s);
const docx = (paras: [string, string?][]) => zipSync({
  '[Content_Types].xml': u8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': u8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': u8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map(([t, style]) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`),
});
/** A one-page PDF with one text line per paragraph (enough for pdf.js text extraction). */
function pdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 11 Tf 50 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return u8(out);
}
const rtf = (paras: string[]) => `{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}{\\*\\generator Test;}\\f0 ${paras.map((p) => p.replace(/[{}\\]/g, (c) => `\\${c}`).replace(/[“”]/g, (c) => (c === '“' ? '\\ldblquote ' : '\\rdblquote '))).join('\\par\n')}\\par}`;

const chapterTexts = (p: Parsed) => structure(p).map((c) => c.scenes.map((s) => s.text).join(' '));

describe('parsers: every format becomes chapters and scenes', () => {
  it('plain text: chapter lines and *** breaks', async () => {
    const p = await parseManuscript('the-salt-road.txt', u8(['Chapter 1', ...CH1.slice(0, 2), '***', CH1[2], 'Chapter Two', ...CH2].join('\n\n')));
    const ch = structure(p);
    expect(p.title).toBe('the salt road');
    expect(ch.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter Two']);
    expect(ch[0]!.scenes).toHaveLength(2);
    expect(ch[1]!.scenes[0]!.text).toContain('customs shed');
  });
  it('markdown: # headings, --- breaks, emphasis stripped', async () => {
    const p = await parseManuscript('book.md', u8(`# Part One\n\n## The Pier\n\n${CH1[0]} *Eleven.*\n\n---\n\n${CH1[1]}\n\n## The Shed\n\n${CH2.join('\n\n')}`));
    const ch = structure(p);
    expect(ch.map((c) => c.title)).toEqual(['Part One: The Pier', 'The Shed']);
    expect(ch[0]!.scenes).toHaveLength(2);
    expect(ch[0]!.scenes[0]!.text).not.toContain('*');
  });
  it('Word .docx: heading styles and "Chapter N" paragraphs', async () => {
    const p = await parseManuscript('novel.docx', docx([['Chapter 1'], ...CH1.map((t) => [t] as [string]), ['The Shed', 'Heading1'], ...CH2.map((t) => [t] as [string])]));
    expect(structure(p).map((c) => c.title)).toEqual(['Chapter 1', 'The Shed']);
    expect(chapterTexts(p)[1]).toContain('Elias Thorne');
  });
  it('OpenDocument .odt', async () => {
    const xml = `<office:document-content xmlns:office="o" xmlns:text="t"><office:body><office:text><text:h text:outline-level="1">Chapter 1</text:h>${CH1.map((t) => `<text:p>${t.replace(/"/g, '&quot;')}</text:p>`).join('')}<text:p>* * *</text:p><text:p>${CH2[0]}</text:p></office:text></office:body></office:document-content>`;
    const p = await parseManuscript('novel.odt', zipSync({ 'content.xml': u8(xml), mimetype: u8('application/vnd.oasis.opendocument.text') }));
    const ch = structure(p);
    expect(ch[0]!.title).toBe('Chapter 1');
    expect(ch[0]!.scenes).toHaveLength(2);
    expect(ch[0]!.scenes[0]!.text).toContain('"You\'re late,"');
  });
  it('RTF: paragraphs, escapes and smart quotes; font tables skipped', async () => {
    expect(rtfToText("{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}Caf\\'e9 noir\\par Line two\\par}")).toContain('Café noir');
    const p = await parseManuscript('novel.rtf', u8(rtf(['Chapter 1', ...CH1, 'Chapter 2', ...CH2])));
    expect(structure(p).map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(chapterTexts(p)[0]).not.toContain('Times');
  });
  it('HTML: h1/h2, <p>, <hr>, entities', async () => {
    const p = await parseManuscript('book.html', u8(`<html><head><title>The Salt Road</title></head><body><h1>Chapter 1</h1>${CH1.slice(0, 2).map((t) => `<p>${t.replace(/"/g, '&ldquo;')}</p>`).join('')}<hr/><p>${CH1[2]}</p><h2>Chapter 2</h2><p>${CH2[0]}</p><script>bad()</script></body></html>`));
    expect(p.title).toBe('The Salt Road');
    const ch = structure(p);
    expect(ch[0]!.scenes).toHaveLength(2);
    expect(ch[0]!.scenes[0]!.text).toContain('“');
    expect(chapterTexts(p).join(' ')).not.toContain('bad()');
  });
  it('EPUB: spine order, one chapter per document, dc:title', async () => {
    const x = (body: string) => u8(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`);
    const p = await parseManuscript('book.epub', zipSync({
      mimetype: u8('application/epub+zip'),
      'META-INF/container.xml': u8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
      'OEBPS/content.opf': u8('<package><metadata><dc:title>The Salt Road</dc:title></metadata><manifest><item id="c2" href="ch2.xhtml"/><item id="c1" href="ch1.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>'),
      'OEBPS/ch1.xhtml': x(`<h1>The Pier</h1>${CH1.map((t) => `<p>${t}</p>`).join('')}`),
      'OEBPS/ch2.xhtml': x(CH2.map((t) => `<p>${t}</p>`).join('')),
    }));
    expect(p.title).toBe('The Salt Road');
    const ch = structure(p);
    expect(ch).toHaveLength(2);
    expect(ch[0]!.title).toBe('The Pier');
    expect(ch[1]!.scenes[0]!.text).toContain('customs shed');
  });
  it('PDF: text extracted, page numbers dropped', async () => {
    const p = await parseManuscript('book.pdf', pdf(['Chapter 1', '', ...CH1.flatMap((t) => [t, '']), '7']));
    const text = chapterTexts(p).join(' ');
    expect(text).toContain('counted the boats');
    expect(text).toContain('Albatross');
  });
  it('Final Draft .fdx: scenes from headings, exact cast from character cues', async () => {
    const para = (type: string, t: string) => `<Paragraph Type="${type}"><Text>${t}</Text></Paragraph>`;
    const p = await parseManuscript('script.fdx', u8(`<FinalDraft><Content>${para('Scene Heading', 'EXT. PIER - NIGHT')}${para('Action', 'Mara counts boats.')}${para('Character', 'JONAH (V.O.)')}${para('Dialogue', 'You are late.')}${para('Scene Heading', 'INT. CUSTOMS SHED - DAY')}${para('Character', 'MARA')}${para('Dialogue', 'Sign it.')}${para('Character', 'JONAH')}${para('Dialogue', 'No.')}</Content></FinalDraft>`));
    expect(p.characters).toEqual(['Jonah', 'Mara']);
    expect(structure(p)[0]!.scenes).toHaveLength(2);
  });
  it('Scrivener (.scriv folder zipped): Draft folders are chapters, texts are scenes, research ignored', async () => {
    const scrivx = `<ScrivenerProject><Binder><BinderItem UUID="D" Type="DraftFolder"><Title>Draft</Title><Children>
      <BinderItem UUID="F1" Type="Folder"><Title>The Pier</Title><Children><BinderItem UUID="T1" Type="Text"><Title>Counting</Title></BinderItem><BinderItem UUID="T2" Type="Text"><Title>Late</Title></BinderItem></Children></BinderItem>
      <BinderItem UUID="F2" Type="Folder"><Title>The Shed</Title><Children><BinderItem UUID="T3" Type="Text"><Title>Manifest</Title></BinderItem></Children></BinderItem>
      </Children></BinderItem><BinderItem UUID="R" Type="ResearchFolder"><Title>Research</Title><Children><BinderItem UUID="T9" Type="Text"><Title>Notes</Title></BinderItem></Children></BinderItem></Binder></ScrivenerProject>`;
    const p = await parseManuscript('Salt.zip', zipSync({
      'Salt Road.scriv/Salt Road.scrivx': u8(scrivx),
      'Salt Road.scriv/Files/Data/T1/content.rtf': u8(rtf([CH1[0]!])), 'Salt Road.scriv/Files/Data/T2/content.rtf': u8(rtf(CH1.slice(1))),
      'Salt Road.scriv/Files/Data/T3/content.rtf': u8(rtf(CH2)), 'Salt Road.scriv/Files/Data/T9/content.rtf': u8(rtf(['RESEARCH ONLY'])),
    }));
    const ch = structure(p);
    expect(ch.map((c) => c.title)).toEqual(['The Pier', 'The Shed']);
    expect(ch[0]!.scenes).toHaveLength(2);
    expect(chapterTexts(p).join(' ')).not.toContain('RESEARCH ONLY');
  });
  it('a bare .scrivx and unknown types explain what to do', async () => {
    await expect(parseManuscript('x.scrivx', u8(''))).rejects.toThrow(/zip the whole .scriv folder/);
    await expect(parseManuscript('x.pages', u8(''))).rejects.toThrow(/Supported/);
  });
});

describe('structure without chapter headings', () => {
  it('cuts long unbroken text into scenes and groups them into chapters', () => {
    const para = 'Mara walked the length of the harbour wall and counted every boat she passed, twice, because once was never enough for her. '.repeat(10);
    const ch = structure({ format: 'text', blocks: Array.from({ length: 80 }, () => ({ kind: 'para' as const, text: para })) });
    expect(ch.length).toBeGreaterThan(1);
    for (const c of ch) for (const s of c.scenes) expect(s.words).toBeLessThanOrEqual(3600);
    expect(ch[0]!.title).toBe('Chapter 1');
  });
});

describe('cast suggestions without AI', () => {
  it('finds recurring names, merges first names into full names, ranks speakers first, skips common words', async () => {
    const p = await parseManuscript('b.txt', u8([...CH1, ...CH2, 'Later, Jonah said nothing. Then Mara Voss left. On Monday Mara returned.', 'When Elias Thorne spoke, Mara listened. Elias Thorne was dying.'].join('\n\n')));
    const names = castCandidates(structure(p)).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Mara Voss', 'Jonah', 'Elias Thorne']));
    expect(names).not.toContain('Mara');
    expect(names).not.toContain('Monday');
    expect(names).not.toContain('When');
  });
  it('preview summarises chapters, scenes and words', async () => {
    const p = await parseManuscript('the-salt-road.txt', u8(['Chapter 1', ...CH1, 'Chapter 2', ...CH2].join('\n\n')));
    const pv = preview(p, structure(p));
    expect(pv.chapters).toHaveLength(2);
    expect(pv.scenes).toBe(2);
    expect(pv.words).toBeGreaterThan(50);
  });
});

describe('voice detection', () => {
  it('tells first person from third, present from past (dialogue ignored)', () => {
    expect(measureVoice('I walked to the pier. I was late and my hands were cold. "You are here," he said.')).toEqual({ pov: 'first', tense: 'past' });
    expect(measureVoice('She walks to the pier. She is late. "I was here," I said nothing.'.replace('I said nothing', 'he says')).tense).toBe('present');
  });
});

describe('importing into the library', () => {
  let tmp: string;
  beforeAll(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'author-import-')); });
  afterAll(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('without AI: a novel with chapters, scenes as author text, the ticked cast, appearances and a seeded writer soul', async () => {
    const long = (t: string) => `${t} ${'She counted the boats again and wrote the number in the ledger in her small square hand. '.repeat(30)}`;
    const p = await parseManuscript('the-salt-road.txt', u8(['Chapter 1', long(CH1.join('\n\n')), 'Chapter 2', long(CH2.join('\n\n'))].join('\n\n')));
    const writer = new WriterStore(path.join(tmp, 'writers', 'default'));
    const steps: string[] = [];
    const { dir, studio, warnings } = await importIntoLibrary(path.join(tmp, 'library'), structure(p), { title: 'The Salt Road', characters: ['Mara Voss', 'Jonah', 'Elias Thorne'], useAi: true, continuity: true }, aiConfigFrom({ ai: { mode: 'none' } }), writer, (pr) => steps.push(pr.step));
    expect(warnings).toEqual([]);
    const b = await studio.bible();
    expect(b.project.title).toBe('The Salt Road');
    expect(b.project.voice.pov).toBe('third-limited');
    expect(b.characters.map((c) => c.name)).toEqual(['Mara Voss', 'Jonah', 'Elias Thorne']);
    expect(b.scenes.map((s) => s.chapter)).toEqual([1, 2]);
    expect(b.scenes.every((s) => s.status === 'drafted')).toBe(true);
    const elias = b.characters.find((c) => c.name === 'Elias Thorne')!;
    expect(b.scenes[0]!.characters).not.toContain(elias.id);
    expect(b.scenes[1]!.characters).toContain(elias.id);
    expect((await studio.store.latest(b.scenes[0]!.id))!.source).toBe('author');
    expect((await studio.writer()).samples.length).toBeGreaterThan(0);
    expect(steps.at(-1)).toMatch(/voice/);
    expect((await listLibrary(path.join(tmp, 'library'))).map((e) => e.dir)).toEqual([dir]);
    // Importing the same title again never overwrites the first.
    const again = await importIntoLibrary(path.join(tmp, 'library'), structure(p), { title: 'The Salt Road', characters: [], useAi: false, continuity: false }, defaultAiConfig(), writer);
    expect(again.dir).not.toBe(dir);
  });
});
