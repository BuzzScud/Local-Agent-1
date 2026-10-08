// Files that are not pictures or PDFs, read with what macOS already has (8 Oct 2026, the owner's
// pick: any file dropped into the window goes with the message). Word, RTF and saved web pages through
// textutil; an Excel workbook unzipped and its sheets read as rows; a zip's and a folder's list of
// what is inside; anything else that is text as text. No package, nothing downloaded.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import { isImage, isPdf } from './media.mjs';

// A Mac "file" that is really a folder (a document package): dropped, it counts as one file.
const PACKAGE = /\.(rtfd|pages|numbers|key|app|bundle|framework|playground|xcodeproj|xcworkspace|photoslibrary|band|logicx)$/i;
// A web page (.html) is code here, read as text; a saved Safari page (.webarchive) is not.
const DOC = /\.(docx?|rtfd?|odt|webarchive|wordml)$/i;
const SHEET = /\.(xlsx|xlsm)$/i;
const ZIP = /\.zip$/i;
// Folders a listing names but does not go into (each can hold thousands of files).
const SKIP = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', '.cache', '.Trash']);

// What a dropped path is: { kind: 'image' | 'pdf' | 'folder' | 'file', sub?: 'text' | 'doc' | 'sheet'
// | 'zip' | 'other' }. Throws when it is not there.
export function fileKind(abs) {
  const st = statSync(abs);
  if (st.isDirectory() && !PACKAGE.test(abs)) return { kind: 'folder' };
  if (isImage(abs) && st.isFile()) return { kind: 'image' };
  if (isPdf(abs) && st.isFile()) return { kind: 'pdf' };
  if (DOC.test(abs)) return { kind: 'file', sub: 'doc' };
  if (SHEET.test(abs)) return { kind: 'file', sub: 'sheet' };
  if (ZIP.test(abs)) return { kind: 'file', sub: 'zip' };
  if (st.isFile() && looksLikeText(abs)) return { kind: 'file', sub: 'text' };
  return { kind: 'file', sub: 'other' };
}

// Files that are never text, whatever their first bytes look like.
const BINARY = /\.(mov|mp4|m4v|avi|mkv|webm|mp3|wav|m4a|aac|flac|ogg|aiff?|dmg|pkg|iso|exe|dll|so|dylib|o|a|class|jar|wasm|sqlite3?|db|psd|sketch|fig|ttf|otf|woff2?|gz|tgz|bz2|xz|7z|rar|tar|bin)$/i;
// Text: its first 8 KB is UTF-8 (a letter cut in two at the end of a part is fine) with no NUL and
// next to no control characters (tab, line ends, form feed and escape aside).
function looksLikeText(abs) {
  if (BINARY.test(abs)) return false;
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n);
    let odd = 0;
    for (const b of head) { if (b === 0) return false; if (b < 32 && b !== 9 && b !== 10 && b !== 12 && b !== 13 && b !== 27) odd++; }
    if (odd > Math.max(2, n / 100)) return false;
    // Read only in part: its last letter may be cut in two, so the last bytes are left out.
    const whole = n < buf.length;
    try { new TextDecoder('utf-8', { fatal: true }).decode(whole ? head : head.subarray(0, n - 4)); return true; } catch { return false; }
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

// What a card calls a file: "Word", "Excel", "CSV", "zip", "MOV"…
export function kindLabel(abs, sub) {
  const ext = extname(abs).slice(1).toLowerCase();
  if (sub === 'doc') return /^docx?$|^wordml$/.test(ext) ? 'Word' : /^rtfd?$/.test(ext) ? 'RTF' : ext === 'odt' ? 'OpenDocument' : 'Web page';
  if (sub === 'sheet') return 'Excel';
  if (sub === 'zip') return 'zip';
  if (ext === 'md' || ext === 'markdown') return 'Markdown';
  if (sub === 'text') return ext ? ext.toUpperCase() : 'Text';
  return ext ? ext.toUpperCase() : 'File';
}

// The lines of a text file (null past `max` bytes: counting a huge log would hold the window up).
export function lineCount(abs, { max = 64 * 1024 * 1024 } = {}) {
  const size = statSync(abs).size;
  if (size > max) return null;
  const buf = readFileSync(abs);
  let n = 0;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
  return size && buf[size - 1] !== 10 ? n + 1 : n;
}

// A Word, RTF, OpenDocument or saved web page file as plain text, by macOS's textutil.
export function docText(abs) {
  const r = spawnSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', abs], { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(String(r.stderr || r.error?.message || 'macOS could not read it').trim().split('\n')[0]);
  return r.stdout;
}
export const wordCount = (text) => (String(text).match(/\S+/g) ?? []).length;

// One file inside a zip (null when it is not there).
function unzipOne(abs, member) {
  const r = spawnSync('/usr/bin/unzip', ['-p', abs, member], { encoding: 'utf8', timeout: 30_000, maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}
// The names in a zip, folders left out (and macOS's __MACOSX shadow copies).
export function zipNames(abs) {
  const r = spawnSync('/usr/bin/zipinfo', ['-1', abs], { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(String(r.stderr || r.error?.message || 'not a zip macOS can open').trim().split('\n')[0]);
  return r.stdout.split('\n').filter((n) => n && !n.endsWith('/') && !n.startsWith('__MACOSX/'));
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

// An Excel workbook's sheet names, in order.
export function sheetNames(abs) {
  const wb = unzipOne(abs, 'xl/workbook.xml');
  if (wb == null) throw new Error('not an Excel workbook macOS can open');
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => unxml(attr(m[0], 'name') ?? ''));
}

// "B12" → 1 (the column, from 0).
const colOf = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? 'A') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
// A cell's number shown as a date where its style is a date's (Excel keeps days since 1900).
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function dateStyles(styles) {
  const custom = new Map([...String(styles ?? '').matchAll(/<numFmt\b[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), unxml(attr(m[0], 'formatCode') ?? '')]));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(String(styles ?? ''))?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    if (BUILT_IN_DATES.has(id)) return true;
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '') ?? '';
    return /[dy]/i.test(code);
  });
}
function excelDate(v, date1904) {
  const ms = Math.round((Number(v) + (date1904 ? 1462 : 0)) * 86_400_000) + Date.UTC(1899, 11, 30);
  const iso = new Date(ms).toISOString();
  return Number(v) % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}
const csvCell = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// Every sheet of a workbook as rows of comma-separated cells: [{ name, rows: ['a,b', …], cols }].
// A formula gives the value Excel saved for it.
export function sheetsOf(abs) {
  const wb = unzipOne(abs, 'xl/workbook.xml');
  if (wb == null) throw new Error('not an Excel workbook macOS can open');
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wb);
  const rels = unzipOne(abs, 'xl/_rels/workbook.xml.rels') ?? '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const shared = [...(unzipOne(abs, 'xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unxml(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').match(/<t\b[^>]*>([\s\S]*?)<\/t>/g)?.map((t) => t.replace(/<[^>]+>/g, '')).join('') ?? ''));
  const dates = dateStyles(unzipOne(abs, 'xl/styles.xml'));
  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unxml(attr(m[0], 'name') ?? '');
    const t = target.get(attr(m[0], 'r:id')) ?? `worksheets/sheet${out.length + 1}.xml`;
    const xml = unzipOne(abs, t.startsWith('/') ? t.slice(1) : `xl/${t}`) ?? '';
    const rows = [];
    let cols = 0;
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = c[1];
        const body = c[2] ?? '';
        const type = attr(head, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let text = '';
        if (type === 's') text = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') text = unxml((body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, '')).join(''));
        else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
        else if (v != null) text = type !== 'str' && type !== 'e' && dates[Number(attr(head, 's') ?? 0)] && /^-?\d+(\.\d+)?$/.test(v) ? excelDate(v, date1904) : unxml(v);
        const at = attr(head, 'r') ? colOf(attr(head, 'r')) : cells.length;
        while (cells.length < at) cells.push('');
        cells[at] = text;
      }
      while (cells.length && cells.at(-1) === '') cells.pop();
      const at = Number(/\br="(\d+)"/.exec(r[0])?.[1] ?? rows.length + 1) - 1;
      while (rows.length < at) rows.push('');
      rows[at] = cells.map(csvCell).join(',');
      cols = Math.max(cols, cells.length);
    }
    while (rows.length && rows.at(-1) === '') rows.pop();
    out.push({ name, rows, cols });
  }
  return out;
}

// What is in a folder, walked in name order: { files, bytes, entries: [{ rel, dir, bytes }], cut }.
// Folders in SKIP are named, not gone into; cut: it stopped at `max` entries or `ms`.
export function walkFolder(root, { max = 5000, ms = 1500 } = {}) {
  const until = Date.now() + ms;
  const entries = [];
  let files = 0;
  let bytes = 0;
  let cut = false;
  const go = (dir, rel) => {
    let list;
    try { list = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return; }
    for (const d of list) {
      if (cut) return;
      if (entries.length >= max || Date.now() > until) { cut = true; return; }
      if (d.name === '.DS_Store') continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      const abs = join(dir, d.name);
      if (d.isDirectory() && !PACKAGE.test(d.name)) {
        const skipped = SKIP.has(d.name);
        entries.push({ rel: r, dir: true, skipped });
        if (!skipped) go(abs, r);
        continue;
      }
      let size = 0;
      try { size = statSync(abs).size; } catch {}
      files++;
      bytes += size;
      entries.push({ rel: r, dir: false, bytes: size });
    }
  };
  go(root, '');
  return { files, bytes, entries, cut };
}
