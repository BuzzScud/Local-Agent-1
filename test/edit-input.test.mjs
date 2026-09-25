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
