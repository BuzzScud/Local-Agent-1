// The files the model has seen in this conversation, each kept as it was then: read by the
// model, given by the app before its first step, or written by the model itself.
// Like Claude Code, an existing file is changed only from what is really there now: one that
// changed on disk since it was seen (a formatter, a command, you in your editor, another
// session) is not edited from the old copy. The change is turned back with the lines that
// changed, and that counts as seeing it again (the owner's pick, 3 Oct 2026), so a small
// model does not have to read the whole file once more.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { splitCommand } from './permissions.mjs';

// A file is kept in full up to this size; a bigger one keeps only its fingerprint, and a
// change to it asks for a new Read.
const KEEP_MAX = 512 * 1024;
// The lines a turned-back change shows at most (old and new together); past this a new
// Read is asked for instead.
export const SHOW_MAX = 40;

const hashOf = (s) => createHash('sha1').update(s).digest('hex');

export class SeenFiles {
  #files = new Map();
  get size() { return this.#files.size; }
  has(abs) { return this.#files.has(abs); }
  paths() { return [...this.#files.keys()]; }
  delete(abs) { return this.#files.delete(abs); }
  clear() { this.#files.clear(); }

  // abs as it is on disk now (text: what was just written there, so it is not read again).
  // A file that is not there is not kept: Write may make it with nothing seen.
  add(abs, text) {
    let now = text;
    try {
      if (!statSync(abs).isFile()) return this;
      if (typeof now !== 'string') now = readFileSync(abs, 'utf8');
    } catch { this.#files.delete(abs); return this; }
    this.#files.set(abs, { hash: hashOf(now), text: now.length <= KEEP_MAX ? now : null });
    return this;
  }

  // How abs changed since it was seen: null when it did not, was never seen, or is gone
  // (Edit says a missing file is missing; Write may make it again). Otherwise
  // { before, now, blocks }, before and blocks null for a file too big to keep.
  changed(abs) {
    const s = this.#files.get(abs);
    if (!s) return null;
    let now;
    try { now = readFileSync(abs, 'utf8'); } catch { return null; }
    if (hashOf(now) === s.hash) return null;
    return { before: s.text, now, blocks: s.text === null ? null : changedBlocks(s.text, now) };
  }
}

// The places two texts differ, line by line: [{ from, to, newFrom, newTo, removed, added }]
// with 1-based line numbers (from..to of the old text, newFrom..newTo of the new; an empty
// range has to = from - 1). Equal lines are matched greedily, a run of SYNC lines at a time,
// so a change at line 10 and another at line 500 are two blocks, not one 490 lines long.
const SYNC = 2;
const LOOK = 400;
export function changedBlocks(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const blocks = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { i++; j++; continue; }
    const [ni, nj] = resync(a, b, i, j) ?? [a.length, b.length];
    blocks.push({ from: i + 1, to: ni, newFrom: j + 1, newTo: nj, removed: a.slice(i, ni), added: b.slice(j, nj) });
    i = ni;
    j = nj;
  }
  return blocks;
}

// The nearest point after (i, j) where the two texts run together again: SYNC equal lines,
// not all of them blank, or equal lines to the end of both.
function resync(a, b, i, j) {
  for (let d = 1; d <= 2 * LOOK; d++) {
    for (let di = Math.max(0, d - LOOK); di <= Math.min(d, LOOK); di++) {
      const x = i + di;
      const y = j + d - di;
      if (x === a.length && y === b.length) return [x, y];
      if (x >= a.length || y >= b.length) continue;
      let k = 0;
      let solid = false;
      while (k < SYNC && x + k < a.length && y + k < b.length && a[x + k] === b[y + k]) { if (a[x + k].trim()) solid = true; k++; }
      if ((solid && k === SYNC) || (k && x + k === a.length && y + k === b.length)) return [x, y];
    }
  }
  return null;
}

// The changed lines of ch, each place headed with where it is and the new lines numbered, as the
// model is shown them; null when they do not fit SHOW_MAX (or the file was too big to keep).
export function changesText(ch) {
  const blocks = ch.blocks;
  const size = blocks ? blocks.reduce((n, bl) => n + bl.removed.length + bl.added.length + 1, 0) : Infinity;
  if (!blocks || size > SHOW_MAX) return null;
  return blocks.map((bl) => {
    const was = bl.removed.map((l) => `- ${l}`);
    const now = bl.added.map((l, k) => `${bl.newFrom + k}: ${l}`);
    const where = bl.added.length
      ? (bl.added.length === 1 ? `Line ${bl.newFrom} now reads` : `Lines ${bl.newFrom}-${bl.newTo} now read`)
      : `After line ${bl.newFrom - 1}, ${bl.removed.length === 1 ? 'this line was' : `these ${bl.removed.length} lines were`} removed`;
    return [`${where}${was.length && bl.added.length ? ` (in place of ${bl.removed.length === 1 ? 'one line' : `${bl.removed.length} lines`})` : ''}:`, ...(bl.added.length ? now : was)].join('\n');
  }).join('\n');
}

// What the model is told when its Edit or Write of rel was turned back. With the changed
// lines when they fit SHOW_MAX: { text, shown: true } (the file then counts as seen again);
// otherwise a new Read is asked for, from the first changed line: { text, shown: false }.
export function changedNote(rel, ch, name = 'Edit') {
  const head = `${rel} changed since you read it (a command, a formatter, the user or another program changed it), so this ${name} was not made.`;
  const again = name === 'Write'
    ? `Write it again from the file as it is now, keeping what changed unless the request says otherwise.`
    : `Send the Edit again with old_text copied from the file as it is now.`;
  const lines = changesText(ch);
  if (!lines) {
    const blocks = ch.blocks;
    const first = blocks?.[0]?.newFrom;
    const count = ch.now.split('\n').length;
    return { shown: false, text: `${head} Too much changed to show here${blocks ? ` (${blocks.length} ${blocks.length === 1 ? 'place' : 'places'})` : ''}: Read it again${first ? ` (offset ${Math.max(1, first - 3)} starts just before the first change)` : ''}; it is ${count} lines now. Then ${again[0].toLowerCase()}${again.slice(1)}` };
  }
  return { shown: true, text: `${head} What changed (this counts as reading it again):\n${lines}\n${again}` };
}

// The files a command printed for the model to see: cat, head, tail, nl, or sed -n with its lines
// (cat x; sed -n 20,40p x), after any cd in the same command. Like a Read, they count as seen, so
// the Edit that follows is not turned back with "Read it first" (8 Oct 2026: a sed -n of
// agent-said.mjs, then its Edit, cost a step). Not a file whose output went on into a pipe, and
// nothing from a command that runs another or writes a file.
const PRINTERS = /^(cat|head|tail|nl|sed)$/;
export function printedFiles(command, cwd, home = homedir()) {
  const s = splitCommand(command);
  if (s.nested || s.writes || s.open) return [];
  const out = [];
  let dir = cwd;
  s.parts.forEach((part, i) => {
    const words = (part.trim().match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^(['"])(.*)\1$/, '$2'));
    if (!words.length) return;
    const [cmd, ...rest] = words;
    const full = (p) => resolve(dir, p.replace(/^~(?=\/|$)/, home));
    if (cmd === 'cd') { dir = full(rest[0] ?? home); return; }
    if (!PRINTERS.test(cmd) || s.seps[i] === '|' || s.seps[i - 1] === '|') return;
    if (cmd === 'sed' && (rest[0] !== '-n' || rest.some((w) => /^-[A-Za-z]*i|^--in-place/.test(w)))) return;
    // sed -n's script, and the number after head/tail -n, are not files
    const args = cmd === 'sed' ? rest.slice(2) : rest.filter((w, k) => !w.startsWith('-') && !(/^-[nc]$/.test(rest[k - 1] ?? '')));
    for (const a of args) {
      const abs = full(a);
      try { if (statSync(abs).isFile()) out.push(abs); } catch {}
    }
  });
  return out;
}
