// Text editing for the prompt box, as a pure function so it can be tested:
// (state, typed input, key) → new state. state = { value, cursor, anchor? }.
// anchor is where a selection started (shift + arrows); the selection is the
// text between anchor and cursor. No anchor, or anchor === cursor: none.

const wordLeft = (v, c) => { let i = c; while (i > 0 && /\s/.test(v[i - 1])) i--; while (i > 0 && !/\s/.test(v[i - 1])) i--; return i; };
const wordRight = (v, c) => { let i = c; while (i < v.length && /\s/.test(v[i])) i++; while (i < v.length && !/\s/.test(v[i])) i++; return i; };
const lineStart = (v, c) => v.lastIndexOf('\n', c - 1) + 1;
const lineEnd = (v, c) => { const i = v.indexOf('\n', c); return i < 0 ? v.length : i; };
// One line up or down at the same column; past the first or last line, the
// very start or end of the text (so shift+↑ from the end selects everything).
const lineUp = (v, c) => { const st = lineStart(v, c); if (st === 0) return 0; const pst = lineStart(v, st - 1); return Math.min(pst + (c - st), st - 1); };
const lineDown = (v, c) => { const en = lineEnd(v, c); if (en === v.length) return v.length; const nst = en + 1; return Math.min(nst + (c - lineStart(v, c)), lineEnd(v, nst)); };

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

export function editInput(s, input, key) {
  // shift + an arrow (option for a word, home/end for the line) selects
  if (key.shift && (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.home || key.end)) {
    const { value: v, cursor: c } = s;
    const to = key.leftArrow ? (key.meta ? wordLeft(v, c) : Math.max(0, c - 1))
      : key.rightArrow ? (key.meta ? wordRight(v, c) : Math.min(v.length, c + 1))
      : key.upArrow ? lineUp(v, c) : key.downArrow ? lineDown(v, c)
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
  if (key.home || (key.ctrl && input === 'a')) return { value: v, cursor: lineStart(v, c) };
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

// Which line of a multi-line value the cursor is on (for ↑/↓ history).
export function cursorLine(s) {
  const before = s.value.slice(0, s.cursor);
  return { line: before.split('\n').length - 1, lines: s.value.split('\n').length };
}

// The @word being typed at the cursor, if any.
export function mentionAt(s) {
  const before = s.value.slice(0, s.cursor);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  return m ? { query: m[2], start: s.cursor - m[2].length - 1 } : null;
}
