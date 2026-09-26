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
