/**
 * Turn an author's file into a flat stream of blocks: headings, paragraphs and scene breaks.
 * Supported: .docx .odt .rtf .md .txt .html/.htm/.xhtml .epub .pdf .fdx (Final Draft)
 * and Scrivener projects uploaded as a .zip of the .scriv folder. No network, no native code.
 */
import { strFromU8, unzipSync } from 'fflate';

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'break' };

export interface Parsed {
  format: string;
  title?: string;
  blocks: Block[];
  /** Names the file states outright (Final Draft character cues), when there are any. */
  characters?: string[];
}

export const IMPORT_EXTENSIONS = ['.docx', '.odt', '.rtf', '.md', '.markdown', '.txt', '.text', '.html', '.htm', '.xhtml', '.epub', '.pdf', '.fdx', '.zip', '.scrivx'] as const;

export async function parseManuscript(fileName: string, data: Uint8Array): Promise<Parsed> {
  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const base = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  switch (ext) {
    case '.txt': case '.text': return { format: 'text', title: base, blocks: textToBlocks(decode(data)) };
    case '.md': case '.markdown': return { format: 'markdown', title: base, blocks: markdownToBlocks(decode(data)) };
    case '.html': case '.htm': case '.xhtml': return { format: 'html', title: htmlTitle(decode(data)) ?? base, blocks: htmlToBlocks(decode(data)) };
    case '.rtf': return { format: 'rtf', title: base, blocks: textToBlocks(rtfToText(decode(data, 'latin1'))) };
    case '.docx': return { format: 'docx', title: base, blocks: await docxToBlocks(data) };
    case '.odt': return { format: 'odt', title: base, blocks: odtToBlocks(data) };
    case '.epub': return epubToParsed(data, base);
    case '.pdf': return { format: 'pdf', title: base, blocks: await pdfToBlocks(data) };
    case '.fdx': return fdxToParsed(decode(data), base);
    case '.zip': return zipToParsed(data, base);
    case '.scrivx': throw new Error('A Scrivener project is a folder: zip the whole .scriv folder and import the .zip.');
    default: throw new Error(`Cannot import ${ext || 'this file'} yet. Supported: ${IMPORT_EXTENSIONS.join(' ')}`);
  }
}

// ---------------------------------------------------------------- text-like

function decode(data: Uint8Array, enc: 'utf-8' | 'latin1' = 'utf-8'): string {
  const t = new TextDecoder(enc).decode(data);
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

const BREAK = /^\s*(?:(?:\*\s*){3,}|(?:#\s*){1,3}|⁂|~{3,}|-{3,}|_{3,}|(?:•\s*){3,}|(?:o\s+){2}o|§)\s*$/;
const CHAPTER = /^\s*(?:(?:chapter|part|book)\s+(?:[0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[a-z-]+teen|twenty[a-z- ]*|thirty[a-z- ]*|forty[a-z- ]*|fifty[a-z- ]*)\b.*|prologue|epilogue|interlude|afterword|foreword|[0-9]{1,3}\.?|[IVXLCDM]{1,7}\.?)\s*$/i;

/** Plain text: blank-line paragraphs; chapter-like lines become headings; ***, #, ⁂ become scene breaks. */
export function textToBlocks(text: string): Block[] {
  const out: Block[] = [];
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  // Text with single newlines only (one paragraph per line) is common from PDFs and some exports.
  const lines = paras.length < 3 && text.split('\n').length > 20 ? text.replace(/\r\n?/g, '\n').split('\n') : paras;
  for (const raw of lines) {
    const p = raw.replace(/\s*\n\s*/g, ' ').trim();
    if (!p) continue;
    if (BREAK.test(p)) { out.push({ kind: 'break' }); continue; }
    if (p.length < 80 && CHAPTER.test(p)) { out.push({ kind: 'heading', level: /^(part|book)\b/i.test(p) ? 1 : 2, text: p }); continue; }
    out.push({ kind: 'para', text: p });
  }
  return out;
}

export function markdownToBlocks(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const p = raw.trim();
    if (!p) continue;
    const h = /^(#{1,6})\s+(.+)$/.exec(p.split('\n')[0]!);
    if (h) {
      out.push({ kind: 'heading', level: h[1]!.length, text: stripMd(h[2]!) });
      const rest = p.split('\n').slice(1).join(' ').trim();
      if (rest) out.push({ kind: 'para', text: stripMd(rest) });
      continue;
    }
    if (/^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/.test(p) || BREAK.test(p)) { out.push({ kind: 'break' }); continue; }
    out.push({ kind: 'para', text: stripMd(p.replace(/\s*\n\s*/g, ' ')) });
  }
  return out;
}
function stripMd(s: string): string {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(.+?)\1/g, '$2').replace(/^>\s?/gm, '').trim();
}

// ---------------------------------------------------------------- html / xml

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', shy: '' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);
}
const inner = (s: string) => decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function htmlTitle(html: string): string | undefined {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return t ? inner(t[1]!) || undefined : undefined;
}

export function htmlToBlocks(html: string): Block[] {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const out: Block[] = [];
  const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<p\b([^>]*)>([\s\S]*?)<\/p>|<hr\b[^>]*\/?>|<(?:div|li|blockquote)\b[^>]*>([^<]{1,4000}?)<\/(?:div|li|blockquote)>/gi;
  for (const m of body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').matchAll(re)) {
    if (m[1]) { const t = inner(m[2]!); if (t) out.push({ kind: 'heading', level: Number(m[1][1]), text: t }); continue; }
    if (m[0].toLowerCase().startsWith('<hr')) { out.push({ kind: 'break' }); continue; }
    const t = inner(m[4] ?? m[5] ?? '');
    if (!t) continue;
    if (BREAK.test(t)) out.push({ kind: 'break' });
    else if (t.length < 80 && CHAPTER.test(t) && /class="[^"]*(?:chapter|title|heading)/i.test(m[3] ?? '')) out.push({ kind: 'heading', level: 2, text: t });
    else out.push({ kind: 'para', text: t });
  }
  return out;
}

async function docxToBlocks(data: Uint8Array): Promise<Block[]> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(data) }, {
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Chapter Title'] => h2:fresh", "p[style-name='Scene Break'] => hr", "p[style-name='Separator'] => hr"],
  });
  // Word manuscripts often mark chapters only with "Chapter 3" in a plain paragraph.
  return htmlToBlocks(value).map((b) => (b.kind === 'para' && b.text.length < 80 && CHAPTER.test(b.text) ? { kind: 'heading', level: 2, text: b.text } : b));
}

function odtToBlocks(data: Uint8Array): Block[] {
  const files = unzipSync(data, { filter: (f) => f.name === 'content.xml' });
  const xml = strFromU8(files['content.xml'] ?? new Uint8Array());
  const out: Block[] = [];
  for (const m of xml.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>|<text:(?:h|p)\b[^>]*\/>/g)) {
    if (!m[1]) continue;
    const t = inner(m[3]!.replace(/<text:s\b[^>]*\/>/g, ' ').replace(/<text:tab\/>/g, ' ').replace(/<text:line-break\/>/g, ' '));
    if (!t) continue;
    if (m[1] === 'h') out.push({ kind: 'heading', level: Number(/text:outline-level="(\d)"/.exec(m[2]!)?.[1] ?? 2), text: t });
    else if (BREAK.test(t)) out.push({ kind: 'break' });
    else if (t.length < 80 && CHAPTER.test(t)) out.push({ kind: 'heading', level: 2, text: t });
    else out.push({ kind: 'para', text: t });
  }
  return out;
}

/** Minimal RTF to text: paragraphs, unicode and hex escapes; destinations like fonts and pictures are skipped. */
export function rtfToText(rtf: string): string {
  let out = ''; let depth = 0; const skip: number[] = []; let uc = 1; let i = 0;
  const skipping = () => skip.length > 0 && depth >= skip[skip.length - 1]!;
  while (i < rtf.length) {
    const ch = rtf[i]!;
    if (ch === '{') { depth++; i++; if (rtf.startsWith('\\*', i)) skip.push(depth); continue; }
    if (ch === '}') { if (skip.length && skip[skip.length - 1] === depth) skip.pop(); depth--; i++; continue; }
    if (ch === '\\') {
      const nx = rtf[i + 1];
      if (nx === "'") { if (!skipping()) out += String.fromCharCode(parseInt(rtf.slice(i + 2, i + 4), 16)); i += 4; continue; }
      if (nx === '\\' || nx === '{' || nx === '}') { if (!skipping()) out += nx; i += 2; continue; }
      if (nx === '~') { if (!skipping()) out += ' '; i += 2; continue; }
      const m = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40));
      if (!m) { i += 2; continue; }
      const [all, word, num] = m as unknown as [string, string, string | undefined];
      i += all.length;
      if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'generator'].includes(word)) { skip.push(depth); continue; }
      if (skipping()) continue;
      if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out += word === 'line' ? ' ' : '\n\n';
      else if (word === 'tab') out += ' ';
      else if (word === 'uc') uc = Number(num ?? 1);
      else if (word === 'u') { out += String.fromCharCode((Number(num) + 65536) % 65536); i += uc; }
      else if (word === 'emdash') out += '—'; else if (word === 'endash') out += '–';
      else if (word === 'lquote') out += '‘'; else if (word === 'rquote') out += '’';
      else if (word === 'ldblquote') out += '“'; else if (word === 'rdblquote') out += '”';
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (!skipping()) out += ch;
    i++;
  }
  return out;
}

function epubToParsed(data: Uint8Array, base: string): Parsed {
  const files = unzipSync(data);
  const read = (p: string) => strFromU8(files[p] ?? new Uint8Array());
  const opfPath = /full-path="([^"]+)"/.exec(read('META-INF/container.xml'))?.[1];
  if (!opfPath) throw new Error('This EPUB has no package file (META-INF/container.xml).');
  const opf = read(opfPath);
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1]; const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
    if (id && href) manifest.set(id, decodeURIComponent(href));
  }
  const blocks: Block[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
    const href = manifest.get(m[1]!);
    if (!href || !/\.x?html?$/i.test(href)) continue;
    const doc = htmlToBlocks(read(dir + href));
    if (!doc.length) continue;
    // Each spine document starts a new chapter, even when the book has no visible chapter heading.
    if (doc[0]!.kind !== 'heading' && blocks.length) blocks.push({ kind: 'heading', level: 2, text: '' });
    blocks.push(...doc);
  }
  const title = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf)?.[1];
  return { format: 'epub', title: title ? inner(title) : base, blocks };
}

async function pdfToBlocks(data: Uint8Array): Promise<Block[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  // Drop running headers/footers: short lines that repeat on many pages, and bare page numbers.
  const pages = (text as string[]).map((p) => p.split('\n'));
  const freq = new Map<string, number>();
  for (const lines of pages) for (const l of new Set(lines.map((x) => x.trim()))) if (l.length < 60) freq.set(l, (freq.get(l) ?? 0) + 1);
  const noise = (l: string) => /^\d{1,4}$/.test(l.trim()) || ((freq.get(l.trim()) ?? 0) > Math.max(3, pages.length / 3));
  const body = pages.map((lines) => lines.filter((l) => !noise(l)).join('\n')).join('\n\n');
  // PDF lines are wrapped at the page width: rejoin lines that do not end a sentence.
  const unwrapped = body.replace(/([^\n.!?:"”’…])\n(?=[a-z“"‘'(])/g, '$1 ');
  return textToBlocks(unwrapped);
}

function fdxToParsed(xml: string, base: string): Parsed {
  const blocks: Block[] = []; const names = new Map<string, number>();
  for (const m of xml.matchAll(/<Paragraph\b[^>]*Type="([^"]+)"[^>]*>([\s\S]*?)<\/Paragraph>/g)) {
    const type = m[1]!; const t = inner(m[2]!.replace(/<\/Text>\s*<Text[^>]*>/g, ''));
    if (!t) continue;
    if (type === 'Scene Heading') { blocks.push({ kind: 'break' }, { kind: 'para', text: t }); continue; }
    if (type === 'Character') { const n = t.replace(/\s*\(.*\)\s*$/, '').trim(); names.set(n, (names.get(n) ?? 0) + 1); blocks.push({ kind: 'para', text: `${titleCase(n)}:` }); continue; }
    if (type === 'Transition' || type === 'Shot') continue;
    blocks.push({ kind: 'para', text: t });
  }
  const title = /<TitlePage>[\s\S]*?<Text[^>]*>([^<]+)<\/Text>/.exec(xml)?.[1];
  return { format: 'final-draft', title: title?.trim() || base, blocks, characters: [...names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => titleCase(n)) };
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** A zipped Scrivener project: walk the Draft folder in binder order; folders are chapters, texts are scenes. */
function zipToParsed(data: Uint8Array, base: string): Parsed {
  const files = unzipSync(data);
  const scrivx = Object.keys(files).find((f) => f.endsWith('.scrivx'));
  if (!scrivx) throw new Error('This .zip is not a Scrivener project (no .scrivx inside). Zip the whole .scriv folder, or import a single document.');
  const root = scrivx.includes('/') ? scrivx.slice(0, scrivx.lastIndexOf('/') + 1) : '';
  const xml = strFromU8(files[scrivx]!);
  const draft = subtree(xml, /<BinderItem\b[^>]*Type="DraftFolder"[^>]*>/) ?? xml;
  const content = (uuid: string) => {
    const key = Object.keys(files).find((f) => f.startsWith(`${root}Files/Data/${uuid}/`) && f.endsWith('content.rtf')) ?? Object.keys(files).find((f) => f.startsWith(`${root}Files/Docs/`) && f.endsWith(`/${uuid}.rtf`));
    return key ? rtfToText(strFromU8(files[key]!, true)) : '';
  };
  const blocks: Block[] = [];
  // Tokenise the binder: opening items (with type, uuid, title), and their closings, to know depth.
  const tok = /<BinderItem\b([^>]*)>|<\/BinderItem>|<Title>([\s\S]*?)<\/Title>/g;
  const stack: { type: string; uuid: string; titled: boolean }[] = [];
  for (const m of draft.matchAll(tok)) {
    if (m[1] !== undefined) { stack.push({ type: /Type="([^"]+)"/.exec(m[1])?.[1] ?? '', uuid: /(?:UUID|ID)="([^"]+)"/.exec(m[1])?.[1] ?? '', titled: false }); continue; }
    if (m[2] !== undefined) {
      const top = stack[stack.length - 1];
      if (!top || top.titled) continue;
      top.titled = true;
      const title = inner(m[2]);
      if (top.type === 'Folder') blocks.push({ kind: 'heading', level: 2, text: title });
      else if (top.type === 'Text') { blocks.push({ kind: 'break' }); blocks.push(...textToBlocks(content(top.uuid)).filter((b) => b.kind !== 'heading')); }
      continue;
    }
    stack.pop();
  }
  return { format: 'scrivener', title: /<ProjectTitle>([^<]+)</.exec(xml)?.[1] ?? base.replace(/\.scriv$/i, ''), blocks };
}

/** The XML of one BinderItem and everything nested in it, found by counting open/close tags. */
function subtree(xml: string, open: RegExp): string | null {
  const m = open.exec(xml);
  if (!m) return null;
  let depth = 0;
  for (const t of xml.slice(m.index).matchAll(/<BinderItem\b[^>]*?(\/)?>|<\/BinderItem>/g)) {
    if (t[0].startsWith('</')) depth--; else if (!t[1]) depth++;
    if (depth === 0) return xml.slice(m.index, m.index + t.index! + t[0].length);
  }
  return xml.slice(m.index);
}
