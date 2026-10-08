// Text editing for the prompt box, as a pure function so it can be tested:
// (state, typed input, key, rows) → new state. state = { value, cursor, anchor? }.
// anchor is where a selection started (shift + arrows); the selection is the
// text between anchor and cursor. No anchor, or anchor === cursor: none.
// rows = { width, skip }: the box's text width in cells and how many leading
// characters it does not draw (the ! of shell mode). Without it, a row is a line.
import stringWidth from 'string-width';

const wordLeft = (v, c) => { let i = c; while (i > 0 && /\s/.test(v[i - 1])) i--; while (i > 0 && !/\s/.test(v[i - 1])) i--; return i; };
const wordRight = (v, c) => { let i = c; while (i < v.length && /\s/.test(v[i])) i++; while (i < v.length && !/\s/.test(v[i])) i++; return i; };
const lineStart = (v, c) => v.lastIndexOf('\n', c - 1) + 1;
const lineEnd = (v, c) => { const i = v.indexOf('\n', c); return i < 0 ? v.length : i; };

// The prompt box's text width: its border, padding and the "> " in front.
export const promptTextWidth = (boxWidth) => Math.max(1, boxWidth - 6);

// How many cells a character takes (a CJK letter or an emoji: two).
const cellWidth = (ch) => { const c = ch.codePointAt(0); return c >= 0x20 && c < 0x300 ? 1 : stringWidth(ch); };
const cells = (text) => { let n = 0; for (const ch of text) n += cellWidth(ch); return n; };

// One line as the rows the box draws it on: a row breaks after the last space
// that fits, or mid-word when one word is longer than a row. A space that
// just misses the edge stays on the row (not drawn), so no row starts with it.
function lineRows(text, base, width) {
  const rows = [];
  let start = 0;
  for (;;) {
    let used = 0, i = start, brk = -1;
    while (i < text.length) {
      const ch = String.fromCodePoint(text.codePointAt(i));
      const w = cellWidth(ch);
      if (used + w > width) break;
      used += w; i += ch.length;
      if (ch === ' ') brk = i;
    }
    if (i >= text.length) { rows.push({ start: base + start, end: base + text.length, last: true }); return rows; }
    const end = text[i] === ' ' ? i + 1 : brk > start ? brk : Math.max(i, start + String.fromCodePoint(text.codePointAt(start)).length);
    rows.push({ start: base + start, end: base + end, last: false });
    start = end;
  }
}

// Every row of the value: [{ start, end, last }], last = the end of a line.
export function promptRows(value, { width = Infinity, skip = 0 } = {}) {
  const rows = [];
  let base = skip;
  for (const line of value.slice(skip).split('\n')) { rows.push(...lineRows(line, base, width)); base += line.length + 1; }
  return rows;
}

// A row's text as drawn: without the space past the edge.
export function rowText(value, row, { width = Infinity } = {}) {
  const t = value.slice(row.start, row.end);
  return !row.last && t.endsWith(' ') && cells(t) > width ? t.slice(0, -1) : t;
}

// The row a position is drawn on: the end of a wrapped row is the next one's start.
export function rowAt(rows, i) {
  for (let r = 0; r < rows.length; r++) if (i < rows[r].end || (i === rows[r].end && rows[r].last)) return r;
  return rows.length - 1;
}
// Where the cursor is drawn: its row, and its cell in that row.
export function cursorCell(s, opts) {
  const rows = promptRows(s.value, opts);
  const row = rowAt(rows, s.cursor);
  return { row, x: cells(s.value.slice(rows[row].start, Math.max(rows[row].start, s.cursor))), rows };
}
// The position at a cell of a row; past its end, the row's last place.
function indexAt(value, row, x) {
  const max = row.last ? row.end : row.end - 1;
  let i = row.start, used = 0;
  while (i < max) {
    const ch = String.fromCodePoint(value.codePointAt(i));
    const w = cellWidth(ch);
    if (used + w > x) break;
    used += w; i += ch.length;
  }
  return i;
}

// The cursor moved by rows and cells, kept inside the text. ⌥-click in
// Terminal sends the whole move as arrow keys at once: up or down a row per
// line, left or right a cell per column, counted from the terminal's cursor.
export function moveBy(s, dRow, dCol, opts) {
  const { row, x, rows } = cursorCell(s, opts);
  const to = Math.min(rows.length - 1, Math.max(0, row + dRow));
  return { value: s.value, cursor: indexAt(s.value, rows[to], Math.max(0, x + dCol)) };
}
// The position under the mouse: a cell of a drawn row. Above the first row
// it is the start of the text, below the last row its end.
export function posAt(s, row, x, opts) {
  const rows = promptRows(s.value, opts);
  if (row < 0) return rows[0].start;
  if (row >= rows.length) return s.value.length;
  return indexAt(s.value, rows[row], Math.max(0, x));
}
// The word at a position (a double click): [start, end), or the run of
// spaces when it is on one.
export function wordAt(value, i) {
  const at = Math.min(i, value.length - 1);
  if (at < 0) return [0, 0];
  const same = /\s/.test(value[at]) ? (ch) => /\s/.test(ch) && ch !== '\n' : (ch) => !/\s/.test(ch);
  if (value[at] === '\n') return [at, at];
  let a = at, b = at + 1;
  while (a > 0 && same(value[a - 1])) a--;
  while (b < value.length && same(value[b])) b++;
  return [a, b];
}

// One row up or down at the same cell (or the one kept from the row before,
// goalX); past the first or last row, the very start or end of the text (so
// shift+↑ from the end selects everything), and the kept cell is let go.
function rowMove(s, dir, opts) {
  const { row, x, rows } = cursorCell(s, opts);
  const goalX = s.goalX ?? x;
  if (row + dir < 0) return { cursor: 0 };
  if (row + dir >= rows.length) return { cursor: s.value.length };
  return { cursor: indexAt(s.value, rows[row + dir], goalX), goalX };
}

// The whole prompt highlighted by a key (⌥A, or ctrl+a twice). all: it is not
// copied, so ⌥A then ⌘V pastes over it. skip: the ! of shell mode stays out,
// so a delete keeps the mode.
const selectAll = (v, skip = 0) => ({ value: v, cursor: v.length, anchor: Math.min(skip, v.length), all: true });

// The selected range [start, end), or null.
export function selection(s) {
  if (s.anchor == null || s.anchor === s.cursor) return null;
  return [Math.min(s.anchor, s.cursor), Math.max(s.anchor, s.cursor)];
}
export const selectedText = (s) => { const r = selection(s); return r ? s.value.slice(r[0], r[1]) : ''; };
// The text with the selection taken out (or unchanged, without its anchor).
function withoutSelection(s) {
  const r = selection(s);
  return r ? { value: s.value.slice(0, r[0]) + s.value.slice(r[1]), cursor: r[0] } : { value: s.value, cursor: s.cursor };
}

// Typed or pasted text goes in at the cursor, replacing a selection.
export function insertText(s, text) {
  const b = withoutSelection(s);
  return { value: b.value.slice(0, b.cursor) + text + b.value.slice(b.cursor), cursor: b.cursor + text.length };
}

export function editInput(s, input, key, opts) {
  // shift + an arrow (option for a word, home/end for the line) selects
  if (key.shift && (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.home || key.end)) {
    const { value: v, cursor: c } = s;
    if (key.upArrow || key.downArrow) return { value: v, ...rowMove(s, key.upArrow ? -1 : 1, opts), anchor: s.anchor ?? c };
    const to = key.leftArrow ? (key.meta ? wordLeft(v, c) : Math.max(0, c - 1))
      : key.rightArrow ? (key.meta ? wordRight(v, c) : Math.min(v.length, c + 1))
      : key.home ? lineStart(v, c) : lineEnd(v, c);
    return { value: v, cursor: to, anchor: s.anchor ?? c };
  }
  const r = selection(s);
  if (r) {
    if (key.leftArrow && !key.meta) return { value: s.value, cursor: r[0] };
    if (key.rightArrow && !key.meta) return { value: s.value, cursor: r[1] };
    if (key.backspace || key.delete) return withoutSelection(s);
    if (input && !key.ctrl && !key.meta && !key.escape && !key.tab && !key.return && !key.upArrow && !key.downArrow && !key.pageUp && !key.pageDown) return insertText(s, input.replace(/\r\n?/g, '\n'));
  }
  // anything else works as usual and drops the selection
  const { value: v, cursor: c } = s;
  if (s.anchor != null) s = { value: v, cursor: c };
  if (key.leftArrow) return { value: v, cursor: key.meta ? wordLeft(v, c) : Math.max(0, c - 1) };
  if (key.rightArrow) return { value: v, cursor: key.meta ? wordRight(v, c) : Math.min(v.length, c + 1) };
  // ↑ ↓ move a row (the app takes the first and last row for earlier prompts)
  if ((key.upArrow || key.downArrow) && !key.ctrl && !key.meta) { const m = rowMove(s, key.upArrow ? -1 : 1, opts); return { value: v, ...m }; }
  // ⌥A selects everything; ctrl+a goes to the start of the line, and pressed again right away, it does too
  if (key.meta && input === 'a') return v.length > (opts?.skip ?? 0) ? selectAll(v, opts?.skip) : s;
  if (key.ctrl && input === 'a' && s.lastKey === 'ctrl+a' && v) return selectAll(v, opts?.skip);
  if (key.home || (key.ctrl && input === 'a')) return { value: v, cursor: lineStart(v, c), ...(key.ctrl ? { lastKey: 'ctrl+a' } : {}) };
  if (key.end || (key.ctrl && input === 'e')) return { value: v, cursor: lineEnd(v, c) };
  if (key.meta && input === 'b') return { value: v, cursor: wordLeft(v, c) };
  if (key.meta && input === 'f') return { value: v, cursor: wordRight(v, c) };
  if (key.ctrl && input === 'u') { const st = lineStart(v, c); return { value: v.slice(0, st) + v.slice(c), cursor: st }; }
  if (key.ctrl && input === 'k') return { value: v.slice(0, c) + v.slice(lineEnd(v, c)), cursor: c };
  if ((key.ctrl && input === 'w') || (key.meta && (key.backspace || key.delete))) { const st = wordLeft(v, c); return { value: v.slice(0, st) + v.slice(c), cursor: st }; }
  if (key.backspace || key.delete) return c > 0 ? { value: v.slice(0, c - 1) + v.slice(c), cursor: c - 1 } : s;
  if (key.ctrl || key.meta || key.escape || key.tab || key.return || key.upArrow || key.downArrow || key.pageUp || key.pageDown) return s;
  if (!input) return s;
  return insertText(s, input.replace(/\r\n?/g, '\n'));
}

// Undo: every change of the text keeps the one before (a word typed, a run
// of deletes, a paste, a cut line), up to UNDO_MAX; ctrl+z steps back,
// ctrl+y forward again. withUndo(before, after) carries the steps along.
const UNDO_MAX = 200;
const isSpace = (ch) => ch != null && /\s/.test(ch);
export function withUndo(prev, next) {
  if (next === prev) return prev;
  if (next.value === prev.value) return { ...next, undo: prev.undo, redo: prev.redo }; // a move ends a word
  const kind = !selection(prev) && next.value.length === prev.value.length + 1 && next.cursor === prev.cursor + 1 ? 'type'
    : !selection(prev) && next.value.length === prev.value.length - 1 && next.cursor <= prev.cursor ? 'delete' : 'edit';
  // one step per word: typing goes on in the same step until a letter follows a space
  const same = kind !== 'edit' && prev.lastEdit === kind && !(kind === 'type' && isSpace(prev.value[prev.cursor - 1]) && !isSpace(next.value[next.cursor - 1]));
  const undo = same ? prev.undo : [...(prev.undo ?? []), { value: prev.value, cursor: prev.cursor }].slice(-UNDO_MAX);
  return { ...next, undo, redo: [], lastEdit: kind };
}
export function undoEdit(s) {
  const u = s.undo?.at(-1);
  if (!u) return s;
  return { value: u.value, cursor: u.cursor, undo: s.undo.slice(0, -1), redo: [...(s.redo ?? []), { value: s.value, cursor: s.cursor }] };
}
export function redoEdit(s) {
  const r = s.redo?.at(-1);
  if (!r) return s;
  return { value: r.value, cursor: r.cursor, undo: [...(s.undo ?? []), { value: s.value, cursor: s.cursor }], redo: s.redo.slice(0, -1) };
}

// Which row of the value the cursor is on (for ↑/↓ history): a line, or
// with the box's width, a row as drawn.
export function cursorLine(s, opts) {
  const { row, rows } = cursorCell(s, opts);
  return { line: row, lines: rows.length };
}

// The @word being typed at the cursor, if any.
export function mentionAt(s) {
  const before = s.value.slice(0, s.cursor);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  return m ? { query: m[2], start: s.cursor - m[2].length - 1 } : null;
}
