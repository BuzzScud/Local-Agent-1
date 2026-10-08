// Pictures and PDFs waiting in the prompt box (7 Oct 2026, the owner's picks: the tray over the
// box, Quick Look, the file copied at once, a chip deleted in one piece, PDFs too). A file dragged
// into the window arrives as its path (Terminal types it, escaped); it becomes [Image #n] or
// [PDF #n] at once, as a picture pasted with ctrl+v does, and the tray over the box shows each one
// the box holds: a small picture of it (▀ in two colours a cell), its name and its size. The file
// is copied when it comes, so moving or deleting it before enter changes nothing (macOS's floating
// screenshot can be a file that goes away). A click on one (/mouse on) or ctrl+f opens it full
// size in Quick Look. A chip deleted takes its card out of the tray; ctrl+z brings both back.
import { appendFileSync, copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, extname, join } from 'node:path';
import stringWidth from 'string-width';
import { droppedFiles, ATTACH_TOKEN } from '../agent/images.mjs';
import { clipboardImage, thumbnail } from '../tools/media.mjs';

// The thumbnail's most: cells across and rows down (a cell is two dots tall).
export const THUMB = { cols: 20, rows: 5 };
const TEXT_W = 28; // the words beside a thumbnail, at most
const GAP = 3; // between two cards
export const TRAY_INDENT = 2; // from the window's left edge
// A window shorter than this, or narrower than TRAY_MIN_COLS, gets the tray as one line.
const TRAY_MIN_ROWS = 24;
const TRAY_MIN_COLS = 60;

// What the tray keeps of an attachment, its thumbnail made now (a picture macOS cannot open throws).
function describe(file, { kind, name, from = null }) {
  const thumb = thumbnail(file, THUMB);
  return { kind, name, from, bytes: statSync(file).size, srcW: thumb.srcW, srcH: thumb.srcH, pages: thumb.pages, thumb };
}
const chipOf = (kind, n) => `[${kind === 'pdf' ? 'PDF' : 'Image'} #${n}]`;

// The pictures and PDFs in text that was pasted or dropped, each copied to `dir` and put in
// `pasted` ({ n, files: Map n → copy, info: Map n → what the tray shows }), its path in the text
// made a chip. One that cannot be copied or opened keeps its path, as typed. Answers
// { text, added: [{ n, token, … }], failed: [{ path, error }] }.
export function attachDropped(text, { cwd, pasted, dir, id }) {
  const found = droppedFiles(text, cwd);
  if (!found.length) return { text, added: [], failed: [] };
  mkdirSync(dir, { recursive: true });
  const added = [];
  const failed = [];
  let out = text;
  for (const d of found) {
    const n = pasted.n + 1;
    const file = join(dir, `${id}-${n}${extname(d.path).toLowerCase()}`);
    try {
      copyFileSync(d.path, file);
      const info = describe(file, { kind: d.kind, name: basename(d.path), from: d.path });
      pasted.n = n;
      pasted.files.set(n, file);
      pasted.info.set(n, info);
      const token = chipOf(d.kind, n);
      out = out.replace(d.raw, token);
      added.push({ n, token, ...info });
    } catch (e) {
      rmSync(file, { force: true });
      failed.push({ path: d.path, error: e.message });
    }
  }
  return { text: out, added, failed };
}

// The clipboard's picture (ctrl+v) as the next attachment: { n, token, … }, or null when there is none.
export function attachClipboard({ pasted, dir, id }) {
  mkdirSync(dir, { recursive: true });
  const n = pasted.n + 1;
  const file = join(dir, `${id}-${n}.png`);
  const got = clipboardImage(file);
  if (!got) return null;
  let info;
  try { info = describe(file, { kind: 'image', name: 'Pasted picture' }); } catch { info = { kind: 'image', name: 'Pasted picture', from: null, bytes: statSync(file).size, srcW: got.w, srcH: got.h, thumb: null }; }
  pasted.n = n;
  pasted.files.set(n, file);
  pasted.info.set(n, info);
  return { n, token: chipOf('image', n), ...info };
}

// The attachments the box holds, in the order their chips appear (each once).
export function trayItems(value, pasted) {
  const seen = new Set();
  const out = [];
  for (const m of String(value ?? '').matchAll(ATTACH_TOKEN)) {
    const n = Number(m[2]);
    const file = pasted?.files?.get(n);
    if (seen.has(n) || !file) continue;
    seen.add(n);
    out.push({ n, token: m[0], file, ...(pasted.info?.get(n) ?? { kind: m[1] === 'PDF' ? 'pdf' : 'image', name: basename(file) }) });
  }
  return out;
}

export const fmtBytes = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
// macOS's screenshot names are long ("Screenshot 2026-10-07 at 10.12.33 AM.png"): the time is enough.
export function shortName(name, max = TEXT_W) {
  const shot = /^(Screenshot|Screen Shot|Screen Recording) \d{4}-\d{2}-\d{2} at (\d{1,2})\.(\d{2})\.\d{2}[\s ]?([AP]M)?/.exec(name ?? '');
  const s = shot ? `${shot[1]} ${shot[2]}.${shot[3]}${shot[4] ? ` ${shot[4]}` : ''}` : String(name ?? '');
  if (stringWidth(s) <= max) return s;
  const ext = extname(s).length <= 6 ? extname(s) : '';
  return `${s.slice(0, Math.max(1, max - 1 - ext.length))}…${ext}`;
}
const sizeLine = (it) => (it.kind === 'pdf'
  ? `PDF · ${it.pages ?? '?'} page${it.pages === 1 ? '' : 's'} · ${fmtBytes(it.bytes)}`
  : [it.srcW ? `${it.srcW}×${it.srcH}` : '', fmtBytes(it.bytes)].filter(Boolean).join(' · '));
export const openHint = (mouse) => (mouse ? 'click · ctrl+f: open' : 'ctrl+f: open full size');

// A card's words: its chip, its name, its size, how to open it.
export const cardLines = (it, { mouse = false } = {}) => [it.token, shortName(it.name), sizeLine(it), openHint(mouse)];

// Where the tray draws each card, for the drawing and for a click: { compact, height, cards:
// [{ n, x, w, textW, from, to }], more }. x, w: from the window's left edge; from, to: the window's
// columns as the mouse counts them, from 1. compact: one line, for a small window. more: cards
// that did not fit (the line ends "+N more").
export function trayLayout(items, { width, rows, mouse = false }) {
  if (!items?.length) return null;
  const cards = [];
  if (rows < TRAY_MIN_ROWS || width < TRAY_MIN_COLS) {
    let x = TRAY_INDENT;
    for (const it of items) {
      const w = stringWidth(compactText(it));
      if (x + w > width - 1 - 6) break;
      cards.push({ n: it.n, x, w, from: x + 1, to: x + w });
      x += w + GAP;
    }
    return { compact: true, height: 1, cards, more: items.length - cards.length };
  }
  let x = TRAY_INDENT;
  let height = 4;
  for (const it of items) {
    const tw = it.thumb?.w ?? 0;
    const textW = Math.min(TEXT_W, Math.max(...cardLines(it, { mouse }).map((l) => stringWidth(l))));
    const w = (tw ? tw + 2 : 0) + textW;
    if (x + w > width - 1 - 8) break;
    cards.push({ n: it.n, x, w, textW, from: x + 1, to: x + w });
    height = Math.max(height, Math.ceil((it.thumb?.h ?? 0) / 2));
    x += w + GAP;
  }
  if (!cards.length) return trayLayout(items, { width, rows: 0, mouse });
  return { compact: false, height, cards, more: items.length - cards.length };
}
export const compactText = (it) => `▣ ${it.token} ${shortName(it.name, 22)} · ${sizeLine(it)}`;

// A thumbnail's rows for the screen: each a list of runs { text, fg, bg } ('rrggbb' or null).
// A cell is two dots, ▀ (its top dot as the letter, its bottom as the background); a see-through
// dot is the window's own background.
export function thumbRows(t) {
  if (!t?.w) return [];
  const rows = [];
  for (let r = 0; r * 2 < t.h; r++) {
    const runs = [];
    for (let c = 0; c < t.w; c++) {
      const top = t.px[r * 2 * t.w + c] ?? null;
      const bottom = r * 2 + 1 < t.h ? (t.px[(r * 2 + 1) * t.w + c] ?? null) : null;
      const cell = top ? { ch: '▀', fg: top, bg: bottom } : bottom ? { ch: '▄', fg: bottom, bg: null } : { ch: ' ', fg: null, bg: null };
      const last = runs.at(-1);
      if (last && last.fg === cell.fg && last.bg === cell.bg && last.text.at(-1) === cell.ch) last.text += cell.ch;
      else runs.push({ text: cell.ch, fg: cell.fg, bg: cell.bg });
    }
    rows.push(runs);
  }
  return rows;
}

// The pictures full size in Quick Look (macOS's space-bar preview; with several, ← → go through
// them). It runs on its own, so the window goes on. AGENTIC_TEST_QUICKLOOK names a file the tests
// read instead; AGENTIC_NO_OPEN (the tests' windows) opens nothing.
export function quickLook(files) {
  if (!files.length) return false;
  if (process.env.AGENTIC_TEST_QUICKLOOK) { try { appendFileSync(process.env.AGENTIC_TEST_QUICKLOOK, `${files.join('\n')}\n`); return true; } catch { return false; } }
  if (process.env.AGENTIC_NO_OPEN) return true;
  try {
    const p = spawn('/usr/bin/qlmanage', ['-p', ...files], { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
    return true;
  } catch { return false; }
}
