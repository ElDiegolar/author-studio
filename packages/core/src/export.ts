/**
 * The full work out of the studio: Word (.docx), EPUB 3, print-ready HTML (save as PDF from the
 * reader or the desktop app), Markdown and plain text. Built from the latest version of every
 * scene, in story order, with chapter titles, a title page and scene breaks. No dependencies
 * beyond fflate; the author's files are read, never changed.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Studio } from './studio.js';

export interface BookScene { id: string; title: string; text: string; status: string; order: number }
export interface BookChapter { n: number; title: string; scenes: BookScene[] }
export interface Book { title: string; author: string; genre: string; words: number; chapters: BookChapter[] }

export type ExportFormat = 'docx' | 'epub' | 'html' | 'md' | 'txt';
export const EXPORT_TYPES: Record<ExportFormat, { mime: string; ext: string; label: string }> = {
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', label: 'Word' },
  epub: { mime: 'application/epub+zip', ext: 'epub', label: 'EPUB e-book' },
  html: { mime: 'text/html; charset=utf-8', ext: 'html', label: 'Print / PDF' },
  md: { mime: 'text/markdown; charset=utf-8', ext: 'md', label: 'Markdown' },
  txt: { mime: 'text/plain; charset=utf-8', ext: 'txt', label: 'Plain text' },
};

/** The book as it stands: latest text of every scene that has any, grouped by chapter. */
export async function assembleBook(studio: Studio): Promise<Book> {
  const b = await studio.bible();
  const chapters = new Map<number, BookChapter>();
  let words = 0;
  for (const s of [...b.scenes].sort((x, y) => x.order - y.order)) {
    const v = await studio.store.latest(s.id);
    if (!v?.text.trim()) continue;
    const ch = chapters.get(s.chapter) ?? { n: s.chapter, title: b.project.chapterTitles?.[String(s.chapter)] ?? `Chapter ${s.chapter}`, scenes: [] };
    ch.scenes.push({ id: s.id, title: s.title, text: v.text.trim(), status: s.status, order: s.order });
    chapters.set(s.chapter, ch);
    words += (v.text.match(/[\p{L}'’-]+/gu) ?? []).length;
  }
  return { title: b.project.title, author: b.project.author ?? '', genre: b.project.genre, words, chapters: [...chapters.values()].sort((x, y) => x.n - y.n) };
}

export async function exportBook(studio: Studio, format: ExportFormat): Promise<{ data: Uint8Array | string; mime: string; filename: string }> {
  const book = await assembleBook(studio);
  const t = EXPORT_TYPES[format];
  const filename = `${book.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'book'}.${t.ext}`;
  const data = format === 'docx' ? toDocx(book) : format === 'epub' ? toEpub(book) : format === 'html' ? toHtml(book) : format === 'md' ? toMarkdown(book) : toText(book);
  return { data, mime: t.mime, filename };
}

const paras = (text: string) => text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** *emphasis* and _emphasis_ in the author's text become italics in rich formats. */
const inline = (s: string) => esc(s).replace(/(^|[\s(“"‘'])[*_]([^*_\n]+?)[*_](?=[\s.,;:!?)”"’']|$)/g, '$1<em>$2</em>');

export function toMarkdown(b: Book): string {
  const out = [`# ${b.title}`, b.author ? `\n*${b.author}*` : ''];
  for (const c of b.chapters) {
    out.push(`\n## ${c.title}\n`);
    out.push(c.scenes.map((s) => paras(s.text).join('\n\n')).join('\n\n* * *\n\n'));
  }
  return out.join('\n') + '\n';
}

export function toText(b: Book): string {
  const out = [b.title.toUpperCase(), b.author ? `by ${b.author}` : '', ''];
  for (const c of b.chapters) out.push('', '', c.title.toUpperCase(), '', c.scenes.map((s) => paras(s.text).join('\n\n')).join('\n\n          *\n\n'));
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
}

/** Print-ready: each chapter on a new page, book typography; "Save as PDF" gives a manuscript-quality PDF. */
export function toHtml(b: Book): string {
  const body = b.chapters.map((c) => `<section class="chapter"><h2>${esc(c.title)}</h2>${c.scenes.map((s) => paras(s.text).map((p) => `<p>${inline(p)}</p>`).join('')).join('<p class="break" aria-hidden="true">⁂</p>')}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(b.title)}</title><style>
@page { size: 6in 9in; margin: 0.8in 0.7in 0.9in; @bottom-center { content: counter(page); font: 10pt Georgia, serif; } }
:root { color-scheme: light; } body { margin: 0 auto; max-width: 34em; padding: 2em 1.2em; background: #fff; color: #111; font: 12pt/1.6 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; hyphens: auto; }
.title { text-align: center; padding: 30vh 0 0; page-break-after: always; break-after: page; } .title h1 { font-size: 2.4em; font-weight: 400; letter-spacing: -0.01em; margin: 0 0 .4em; } .title p { font-style: italic; }
.chapter { break-before: page; page-break-before: always; } .chapter h2 { text-align: center; font-weight: 400; font-size: 1.5em; margin: 3em 0 2em; }
p { margin: 0; text-indent: 1.4em; text-align: justify; widows: 2; orphans: 2; } h2 + p, .break + p { text-indent: 0; } .break { text-align: center; text-indent: 0; margin: 1em 0; }
@media screen { body { padding-bottom: 6em; } }
</style></head><body><header class="title"><h1>${esc(b.title)}</h1>${b.author ? `<p>${esc(b.author)}</p>` : ''}</header>${body}</body></html>`;
}

// ---- docx ----
function toDocx(b: Book): Uint8Array {
  const run = (text: string) => {
    const parts = inline(text).split(/(<em>.*?<\/em>)/);
    return parts.filter(Boolean).map((p) => p.startsWith('<em>') ? `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${p.slice(4, -5)}</w:t></w:r>` : `<w:r><w:t xml:space="preserve">${p}</w:t></w:r>`).join('');
  };
  const p = (style: string, text: string, extra = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${run(text)}</w:p>`;
  const body: string[] = [p('Title', b.title)];
  if (b.author) body.push(p('Subtitle', b.author));
  for (const c of b.chapters) {
    body.push(p('Heading1', c.title, '<w:pageBreakBefore/>'));
    c.scenes.forEach((s, i) => {
      if (i) body.push(p('SceneBreak', '* * *'));
      paras(s.text).forEach((t, j) => body.push(p(j === 0 ? 'FirstParagraph' : 'BodyText', t)));
    });
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const style = (id: string, name: string, ppr: string, rpr: string, basedOn = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${style('BodyText', 'Body Text', '<w:ind w:firstLine="720"/>', '')}${style('FirstParagraph', 'First Paragraph', '', '')}
${style('Title', 'Title', '<w:jc w:val="center"/><w:spacing w:before="4800" w:after="240"/>', '<w:sz w:val="56"/>')}${style('Subtitle', 'Subtitle', '<w:jc w:val="center"/>', '<w:i/><w:sz w:val="28"/>')}
${style('Heading1', 'heading 1', '<w:keepNext/><w:jc w:val="center"/><w:spacing w:before="2400" w:after="720"/><w:outlineLvl w:val="0"/>', '<w:sz w:val="36"/>')}${style('SceneBreak', 'Scene Break', '<w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/>', '')}
</w:styles>`;
  const files: Zippable = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(styles),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(b.title)}</dc:title><dc:creator>${esc(b.author)}</dc:creator></cp:coreProperties>`),
  };
  return zipSync(files);
}

// ---- epub ----
function toEpub(b: Book): Uint8Array {
  const id = `urn:uuid:${hashUuid(b.title + b.author)}`;
  const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" href="book.css"/></head><body>${body}</body></html>`;
  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/book.css': strToU8('body{font-family:serif;line-height:1.5;margin:0 5%}h1,h2{text-align:center;font-weight:normal;margin:2em 0 1.5em}p{margin:0;text-indent:1.4em;text-align:justify}h2+p,.break+p{text-indent:0}.break{text-align:center;text-indent:0;margin:1em 0}.title{text-align:center;margin-top:30%}'),
    'OEBPS/title.xhtml': strToU8(xhtml(b.title, `<section class="title" epub:type="titlepage"><h1>${esc(b.title)}</h1>${b.author ? `<p>${esc(b.author)}</p>` : ''}</section>`)),
  };
  b.chapters.forEach((c, i) => {
    files[`OEBPS/ch${i + 1}.xhtml`] = strToU8(xhtml(c.title, `<section epub:type="chapter"><h2>${esc(c.title)}</h2>${c.scenes.map((s) => paras(s.text).map((p) => `<p>${inline(p)}</p>`).join('')).join('<p class="break">* * *</p>')}</section>`));
  });
  files['OEBPS/nav.xhtml'] = strToU8(xhtml('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>${b.chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav>`));
  const items = b.chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  const spine = b.chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('');
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${esc(b.title)}</dc:title><dc:language>en</dc:language>${b.author ? `<dc:creator>${esc(b.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${items}</manifest><spine><itemref idref="title"/>${spine}</spine></package>`);
  return zipSync(files);
}

function hashUuid(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0; }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
