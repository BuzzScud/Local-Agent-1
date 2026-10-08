// Pictures and PDFs, with what macOS already has: media-tool.swift, built on
// first use with the Mac's own Swift compiler (Apple's command line tools, which
// the installer asks for) and kept in ~/.agentic-coder/tools under the source's
// hash, so a changed source is built again. No package, nothing downloaded.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HOME } from '../../../models/index.mjs';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i;
export const isImage = (p) => IMAGE_EXT.test(String(p ?? ''));
export const isPdf = (p) => /\.pdf$/i.test(String(p ?? ''));
// A picture goes to the model no larger than this on its long side: a Retina
// screenshot (2880 px) would otherwise cost thousands of tokens, and the text
// on it stays readable at this size.
export const MAX_SIDE = 1280;

// The Swift source, read the way terminal/src/agent/rules.mjs reads its rules:
// under Bun an import the one-file app carries inside it, under Node the file.
async function loadSource() {
  if (typeof Bun !== 'undefined') {
    const text = (await import('./media-tool.swift', { with: { type: 'text' } })).default;
    return text.startsWith('/$bunfs/') ? readFileSync(text, 'utf8') : text;
  }
  return readFileSync(new URL('./media-tool.swift', import.meta.url), 'utf8');
}
const SOURCE = await loadSource();

let built = null;
export function mediaTool() {
  if (built && existsSync(built)) return built;
  const src = SOURCE;
  const dir = join(HOME, 'tools');
  const bin = join(dir, `media-${createHash('sha256').update(src).digest('hex').slice(0, 12)}`);
  if (!existsSync(bin)) {
    mkdirSync(dir, { recursive: true });
    const file = join(tmpdir(), `agentic-media-${process.pid}.swift`);
    writeFileSync(file, src);
    const tmp = `${bin}.${process.pid}`;
    const r = spawnSync('/usr/bin/swiftc', ['-O', file, '-o', tmp], { encoding: 'utf8', timeout: 240_000 });
    rmSync(file, { force: true });
    if (r.status !== 0) { rmSync(tmp, { force: true }); throw new Error(`the picture and PDF helper did not build (it needs Apple's command line tools: xcode-select --install). ${String(r.stderr || r.error?.message || '').trim().split('\n')[0]}`); }
    renameSync(tmp, bin);
  }
  return (built = bin);
}

function run(args, { timeout = 60_000 } = {}) {
  const r = spawnSync(mediaTool(), args, { encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status, out: r.stdout ?? '', err: String(r.stderr || r.error?.message || '').trim() };
}
const scratch = (ext) => join(tmpdir(), `agentic-media-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);

// A picture ready for the model: a JPEG no larger than MAX_SIDE, as base64.
// { path, mime, data, w, h, srcW, srcH }
export function preparedImage(path, { max = MAX_SIDE } = {}) {
  const out = scratch('jpg');
  const r = run(['image', path, out, String(max)]);
  try {
    if (r.code !== 0) throw new Error(r.err || 'macOS could not open the picture');
    const meta = JSON.parse(r.out);
    return { path, mime: 'image/jpeg', data: readFileSync(out).toString('base64'), w: meta.w, h: meta.h, srcW: meta.srcW, srcH: meta.srcH };
  } finally { rmSync(out, { force: true }); }
}

// A PDF's text, page by page (an empty string for a page that is only a picture, a scan).
export function pdfText(path) {
  const r = run(['pdf-text', path], { timeout: 120_000 });
  if (r.code === 4) throw new Error('the PDF is locked with a password');
  if (r.code !== 0) throw new Error(r.err || 'macOS could not open the PDF');
  return JSON.parse(r.out).pages;
}

// One page of a PDF as a picture for the model (a scan, a figure).
export function pdfPageImage(path, page, { max = MAX_SIDE } = {}) {
  const png = scratch('png');
  try {
    const r = run(['pdf-page', path, String(page), png, String(max)]);
    if (r.code !== 0) throw new Error(r.err || `could not draw page ${page}`);
    return { ...preparedImage(png, { max }), path: `${path} (page ${page})` };
  } finally { rmSync(png, { force: true }); }
}

// The clipboard's picture saved as a PNG at `out`; null when there is none.
// AGENTIC_TEST_CLIPBOARD: a picture file the tests use in place of the real
// clipboard, so a test never reads or changes yours.
export function clipboardImage(out) {
  const fake = process.env.AGENTIC_TEST_CLIPBOARD;
  if (fake !== undefined) { if (!fake || !existsSync(fake)) return null; writeFileSync(out, readFileSync(fake)); const p = preparedImage(out); return { w: p.srcW, h: p.srcH }; }
  const r = run(['clipboard', out], { timeout: 15_000 });
  if (r.code === 3) return null;
  if (r.code !== 0) throw new Error(r.err || 'could not read the clipboard');
  return JSON.parse(r.out);
}

// A picture as a few coloured dots, for the prompt box's tray (app/attach.mjs): at most `cols`
// wide and `rows` × 2 tall, since a cell draws two (▀ in two colours). A PDF: its first page.
// { w, h, srcW, srcH, px: ['rrggbb' | null (see-through), …] row by row, pages? }
export function thumbnail(path, { cols = 24, rows = 5 } = {}) {
  if (isPdf(path)) {
    const png = scratch('png');
    try {
      const r = run(['pdf-page', path, '1', png, '512']);
      if (r.code === 4) throw new Error('the PDF is locked with a password');
      if (r.code !== 0) throw new Error(r.err || 'macOS could not open the PDF');
      const { srcW, srcH, ...t } = thumbnail(png, { cols, rows });
      return { ...t, pages: JSON.parse(r.out).pages };
    } finally { rmSync(png, { force: true }); }
  }
  const r = run(['thumb', path, String(cols), String(rows)]);
  if (r.code !== 0) throw new Error(r.err || 'macOS could not open the picture');
  const t = JSON.parse(r.out);
  const px = [];
  for (let i = 0; i < t.w * t.h; i++) { const c = t.px.slice(i * 6, i * 6 + 6); px.push(c === '------' ? null : c); }
  return { w: t.w, h: t.h, srcW: t.srcW, srcH: t.srcH, px };
}

// Black text on white at `out` (the tests' pictures, the vision check's).
export function textImage(out, text, { w = 640, h = 240 } = {}) {
  const r = run(['text-image', out, String(w), String(h), text]);
  if (r.code !== 0) throw new Error(r.err || 'could not draw');
  return out;
}

// A PDF with one page of text for each of `pages` (the tests' PDFs).
export function textPdf(out, pages) {
  const r = run(['text-pdf', out, ...pages]);
  if (r.code !== 0) throw new Error(r.err || 'could not write the PDF');
  return out;
}
