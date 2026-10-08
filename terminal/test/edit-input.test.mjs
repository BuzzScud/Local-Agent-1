import { test, expect } from 'bun:test';
import { editInput, insertText, cursorLine, mentionAt } from '../src/app/edit-input.mjs';

const type = (s, text) => [...text].reduce((st, ch) => editInput(st, ch, {}), s);

test('typing, moving and deleting', () => {
  let s = type({ value: '', cursor: 0 }, 'hello world');
  expect(s).toEqual({ value: 'hello world', cursor: 11 });
  s = editInput(s, '', { leftArrow: true, meta: true });
  expect(s.cursor).toBe(6);
  s = editInput(s, 'a', { ctrl: true });
  s = type(s, '> ');
  expect(s.value).toBe('> hello world');
  s = editInput(s, 'e', { ctrl: true });
  s = editInput(s, 'w', { ctrl: true });
  expect(s.value).toBe('> hello ');
  s = editInput(s, '', { delete: true });
  expect(s.value).toBe('> hello');
  s = editInput(s, 'u', { ctrl: true });
  expect(s).toEqual({ value: '', cursor: 0 });
});

test('control keys do not type letters', () => {
  const s = { value: 'x', cursor: 1 };
  expect(editInput(s, 'l', { ctrl: true })).toBe(s);
  expect(editInput(s, '', { return: true })).toBe(s);
});

test('multi-line: line of the cursor, paste keeps newlines', () => {
  const s = insertText({ value: '', cursor: 0 }, 'one\ntwo\nthree');
  expect(cursorLine(s)).toEqual({ line: 2, lines: 3 });
  expect(cursorLine({ value: s.value, cursor: 0 })).toEqual({ line: 0, lines: 3 });
});

test('@mentions', () => {
  expect(mentionAt({ value: 'look at @src/ap', cursor: 15 })).toEqual({ query: 'src/ap', start: 8 });
  expect(mentionAt({ value: 'mail me@x.com', cursor: 13 })).toBe(null);
});

// Selecting with shift + arrows, like Claude Code: delete removes the
// selection, typing or pasting replaces it, a plain arrow drops it.
import { selection, selectedText } from '../src/app/edit-input.mjs';
test('shift + arrows select; delete, typing and paste act on the selection; plain arrows and other keys drop it', () => {
  let s = type({ value: '', cursor: 0 }, 'hello world');
  for (let i = 0; i < 5; i++) s = editInput(s, '', { shift: true, leftArrow: true });
  expect(selectedText(s)).toBe('world');
  expect(editInput(s, '', { backspace: true })).toEqual({ value: 'hello ', cursor: 6 });
  expect(editInput(s, 'x', {})).toEqual({ value: 'hello x', cursor: 7 }); // typing replaces
  expect(insertText(s, 'there')).toEqual({ value: 'hello there', cursor: 11 }); // a paste replaces
  expect(editInput(s, '', { leftArrow: true })).toEqual({ value: 'hello world', cursor: 6 }); // to its start
  expect(editInput(s, '', { rightArrow: true })).toEqual({ value: 'hello world', cursor: 11 }); // to its end
  expect(selection(editInput(s, 'u', { ctrl: true }))).toBeNull(); // other keys work as usual, without it
  // shift + option: a word at a time
  const w = editInput({ value: 'hello world', cursor: 11 }, '', { shift: true, meta: true, leftArrow: true });
  expect(selectedText(w)).toBe('world');
  // shift + ↑ from the end of one line selects everything; the anchor stays put
  const all = editInput({ value: 'one line', cursor: 8 }, '', { shift: true, upArrow: true });
  expect(selectedText(all)).toBe('one line');
  expect(editInput(all, '', { delete: true })).toEqual({ value: '', cursor: 0 });
  // across lines: up keeps the column (or the line's end), then reaches the very start
  let m = { value: 'abc\ndefgh', cursor: 9 };
  m = editInput(m, '', { shift: true, upArrow: true });
  expect([m.cursor, selectedText(m)]).toEqual([3, '\ndefgh']);
  m = editInput(m, '', { shift: true, upArrow: true });
  expect(selectedText(m)).toBe('abc\ndefgh'); // everything
  m = editInput(m, '', { shift: true, downArrow: true });
  expect([m.cursor, selectedText(m)]).toEqual([4, 'defgh']);
  m = editInput(m, '', { shift: true, downArrow: true });
  expect(selection(m)).toBeNull(); // back at the anchor: nothing selected
  expect(selectedText(editInput({ value: 'abc\ndefgh', cursor: 4 }, '', { shift: true, downArrow: true }))).toBe('defgh'); // past the last line: the end
});

// The box wraps a long line itself, at word ends; ↑ ↓ and ⌥-click work on
// those rows, and the terminal's cursor is put on the cell the rows give.
import { promptRows, rowText, cursorCell, moveBy, withUndo, undoEdit, redoEdit, promptTextWidth } from '../src/app/edit-input.mjs';
test('rows: a long line wraps after the last space that fits, a long word mid-word', () => {
  const v = 'the quick brown fox jumps';
  expect(promptRows(v, { width: 10 }).map((r) => v.slice(r.start, r.end))).toEqual(['the quick ', 'brown fox ', 'jumps']);
  const rows = promptRows(v, { width: 9 });
  expect(rows.map((r) => rowText(v, r, { width: 9 }))).toEqual(['the quick', 'brown fox', 'jumps']);
  expect(rows.map((r) => v.slice(r.start, r.end))).toEqual(['the quick ', 'brown fox ', 'jumps']); // the space past the edge stays on its row, not drawn
  expect(promptRows('abcdefghijkl', { width: 5 }).map((r) => [r.start, r.end])).toEqual([[0, 5], [5, 10], [10, 12]]);
  expect(promptRows('one\n\ntwo', {}).map((r) => [r.start, r.end, r.last])).toEqual([[0, 3, true], [4, 4, true], [5, 8, true]]);
  // shell mode: the ! is not drawn, rows start after it
  expect(promptRows('!ls -la', { width: 80, skip: 1 })).toEqual([{ start: 1, end: 7, last: true }]);
  // a wide character takes two cells
  expect(promptRows('日本語日本語', { width: 5 }).map((r) => [r.start, r.end])).toEqual([[0, 2], [2, 4], [4, 6]]);
  expect(promptTextWidth(100)).toBe(94);
});

test('the cell the cursor is drawn on: the end of a wrapped row is the next row\'s start', () => {
  const v = 'the quick brown fox jumps';
  const at = (cursor) => { const c = cursorCell({ value: v, cursor }, { width: 10 }); return [c.row, c.x]; };
  expect(at(0)).toEqual([0, 0]);
  expect(at(9)).toEqual([0, 9]); // on the space after "quick"
  expect(at(10)).toEqual([1, 0]); // "brown"
  expect(at(25)).toEqual([2, 5]); // the very end
  expect(cursorCell({ value: '!ls', cursor: 0 }, { width: 10, skip: 1 })).toMatchObject({ row: 0, x: 0 });
  expect(cursorCell({ value: '日本x', cursor: 2 }, { width: 10 })).toMatchObject({ row: 0, x: 4 });
});

test('⌥-click: the arrows Terminal sends at once move by rows and cells, kept inside the text', () => {
  const v = 'the quick brown fox jumps'; // rows: "the quick " / "brown fox " / "jumps"
  const o = { width: 10 };
  const s = { value: v, cursor: 25 }; // end: row 2, cell 5
  expect(moveBy(s, -2, -1, o).cursor).toBe(4); // row 0, cell 4: the q of "quick"
  expect(moveBy(s, -1, 3, o).cursor).toBe(18); // row 1, cell 8: the x of "fox"
  expect(moveBy(s, -1, 40, o).cursor).toBe(19); // past the row's end: its last place (the space), not the next row
  expect(moveBy(s, -9, -40, o).cursor).toBe(0); // above the box and left of it: the start
  expect(moveBy({ value: v, cursor: 0 }, 5, 0, o).cursor).toBe(20); // below the box: the last row, same cell
  expect(moveBy(s, 0, -4, o).cursor).toBe(21); // same row: 4 cells left
  // after a line break, the next line's rows
  expect(moveBy({ value: 'one\ntwo three', cursor: 1 }, 1, 2, {}).cursor).toBe(7);
});

test('↑ ↓ move a row inside a wrapped prompt and keep the cell; past the edge, the start or end', () => {
  const v = 'the quick brown fox jumps';
  const o = { width: 10 };
  let s = editInput({ value: v, cursor: 23 }, '', { upArrow: true }, o); // row 2 cell 3 → row 1 cell 3
  expect(s.cursor).toBe(13);
  s = editInput(s, '', { upArrow: true }, o);
  expect(s.cursor).toBe(3);
  expect(editInput(s, '', { upArrow: true }, o).cursor).toBe(0);
  // the cell is kept across a shorter row: "ab" / "abcdefgh"
  let m = editInput({ value: 'abcdefgh\nab\nabcdefgh', cursor: 7 }, '', { downArrow: true }, {});
  expect(m.cursor).toBe(11); // the end of "ab"
  m = editInput(m, '', { downArrow: true }, {});
  expect(m.cursor).toBe(19); // back on cell 7
  expect(editInput(m, '', { downArrow: true }, {}).cursor).toBe(20); // past the last row: the end
});

test('ctrl+a twice selects everything; once, the start of the line', () => {
  let s = { value: 'one\ntwo', cursor: 6 };
  s = editInput(s, 'a', { ctrl: true });
  expect([s.cursor, selectedText(s)]).toEqual([4, '']);
  s = editInput(s, 'a', { ctrl: true });
  expect(selectedText(s)).toBe('one\ntwo');
  // anything in between: a second ctrl+a is the start of the line again
  let t = editInput({ value: 'one two', cursor: 7 }, 'a', { ctrl: true });
  t = editInput(t, '', { rightArrow: true });
  expect(selectedText(editInput(t, 'a', { ctrl: true }))).toBe('');
  expect(selection(editInput(editInput({ value: '', cursor: 0 }, 'a', { ctrl: true }), 'a', { ctrl: true }))).toBeNull(); // nothing to select
});

test('⌥A selects everything at once (not to be copied): delete clears it, typing replaces it; in shell mode the ! stays', () => {
  let s = editInput({ value: 'one\ntwo', cursor: 2 }, 'a', { meta: true });
  expect([selectedText(s), s.all]).toEqual(['one\ntwo', true]);
  expect(editInput(s, '', { backspace: true })).toEqual({ value: '', cursor: 0 });
  expect(editInput(s, 'x', {})).toEqual({ value: 'x', cursor: 1 });
  // ctrl+a twice selects the same way; a selection made by hand is copied as before
  expect(editInput(editInput({ value: 'one', cursor: 3, lastKey: 'ctrl+a' }, 'a', { ctrl: true }), '', { shift: true, leftArrow: true }).all).toBeUndefined();
  expect(editInput({ value: 'one', cursor: 3, lastKey: 'ctrl+a' }, 'a', { ctrl: true }).all).toBe(true);
  // shell mode: the box does not draw the !, and it stays when the command is deleted
  const sh = editInput({ value: '!ls -la', cursor: 3 }, 'a', { meta: true }, { skip: 1 });
  expect(selectedText(sh)).toBe('ls -la');
  expect(editInput(sh, '', { delete: true }, { skip: 1 })).toEqual({ value: '!', cursor: 1 });
  expect(selection(editInput({ value: '!', cursor: 1 }, 'a', { meta: true }, { skip: 1 }))).toBeNull();
  expect(editInput({ value: '', cursor: 0 }, 'a', { meta: true })).toEqual({ value: '', cursor: 0 }); // nothing to select
});

test('undo and redo: a word at a time, a run of deletes, a paste; a move ends a word', () => {
  const key = (s, input, k = {}) => withUndo(s, editInput(s, input, k));
  let s = { value: '', cursor: 0 };
  for (const ch of 'hello world') s = key(s, ch);
  s = withUndo(s, insertText(s, ' PASTED'));
  s = key(s, '', { backspace: true });
  s = key(s, '', { backspace: true });
  expect(s.value).toBe('hello world PAST');
  s = undoEdit(s); expect(s.value).toBe('hello world PASTED'); // both deletes at once
  s = undoEdit(s); expect(s.value).toBe('hello world'); // the paste
  s = undoEdit(s); expect(s.value).toBe('hello '); // "world"
  s = undoEdit(s); expect([s.value, s.cursor]).toEqual(['', 0]); // "hello "
  expect(undoEdit(s)).toBe(s); // nothing left
  s = redoEdit(s); expect(s.value).toBe('hello ');
  s = redoEdit(s); expect(s.value).toBe('hello world');
  // a new change drops what redo had
  s = key(s, '!');
  expect(redoEdit(s)).toBe(s);
  expect(undoEdit(s).value).toBe('hello world');
  // moving the cursor starts a new step, and a move keeps the steps
  let m = { value: '', cursor: 0 };
  for (const ch of 'ab') m = key(m, ch);
  m = key(m, '', { leftArrow: true });
  m = key(m, 'X');
  expect(m.value).toBe('aXb');
  expect(undoEdit(m).value).toBe('ab');
  // a clear (esc twice, ctrl+c) comes back
  expect(undoEdit(withUndo(m, { value: '', cursor: 0 })).value).toBe('aXb');
});
