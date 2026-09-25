// Text editing for the prompt box, as a pure function so it can be tested:
// (state, typed input, key) → new state. state = { value, cursor }.

const wordLeft = (v, c) => { let i = c; while (i > 0 && /\s/.test(v[i - 1])) i--; while (i > 0 && !/\s/.test(v[i - 1])) i--; return i; };
const wordRight = (v, c) => { let i = c; while (i < v.length && /\s/.test(v[i])) i++; while (i < v.length && !/\s/.test(v[i])) i++; return i; };
const lineStart = (v, c) => v.lastIndexOf('\n', c - 1) + 1;
const lineEnd = (v, c) => { const i = v.indexOf('\n', c); return i < 0 ? v.length : i; };

export function insertText(s, text) {
  return { value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor), cursor: s.cursor + text.length };
}

export function editInput(s, input, key) {
  const { value: v, cursor: c } = s;
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
