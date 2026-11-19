// The menu before the app starts (app/pick.mjs): its keys, and nothing of it left on stdin after
// it closes, since the app's prompt box reads the same stdin next (2 Oct 2026).
import { test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickOnTerminal, keysOf } from '../src/app/pick.mjs';

test('keys: arrows in both spellings, a lone esc, other escape sequences skipped', () => {
  expect(keysOf('\x1b[A\x1b[B2')).toEqual(['up', 'down', '2']);
  expect(keysOf('\x1bOB\r')).toEqual(['down', '\r']);
  expect(keysOf('\x1b')).toEqual(['esc']);
  expect(keysOf('\x1b[1;2Cj')).toEqual(['j']);
  // ←→ for the folder page's doors, side by side (folder-page.jsx); shift+→ is still skipped
  expect(keysOf('\x1b[C\x1b[D\x1bOC')).toEqual(['right', 'left', 'right']);
});

test('← and → move too: the doors of the folder page sit side by side', async () => {
  const input = new PassThrough();
  const output = new PassThrough(); output.resume();
  const p = pickOnTerminal(['a', 'b'], { input, output });
  input.write('\x1b[C\x1b[C\x1b[D\x1b[D\x1b[C\r');
  expect(await p).toBe(1);
});

test('the menu picks, takes off every listener it put on stdin, and never pauses it', async () => {
  const input = new PassThrough();
  const output = new PassThrough(); output.resume();
  let paused = 0;
  input.on('pause', () => paused++);
  const p = pickOnTerminal(['a', 'b', 'c'], { input, output });
  input.write('\x1b[B\x1b[B\x1b[A\r');
  expect(await p).toBe(1);
  for (const e of ['data', 'readable', 'keypress']) expect(input.listenerCount(e)).toBe(0);
  const q = pickOnTerminal(['a', 'b'], { input, output });
  input.write('\x1b');
  expect(await q).toBeNull();
  for (const e of ['data', 'readable', 'keypress']) expect(input.listenerCount(e)).toBe(0);
  expect(paused).toBe(0); // the pause is what left the prompt box deaf (pick.mjs)
});

// Whatever reads the terminal before the app (or between its screens) never pauses stdin: under
// Bun 1.4.2 a pause can leave the prompt box that reads next with no keys, and only on some Macs,
// so a test that types after the menu alone does not catch it everywhere (2 Oct 2026).
test('nothing in the app pauses the terminal\'s input', () => {
  const src = join(import.meta.dir, '..', 'src');
  const files = readdirSync(src, { recursive: true }).filter((f) => /\.(mjs|jsx|js)$/.test(f));
  const found = files.filter((f) => /\b(stdin|input)\.pause\(\)/.test(readFileSync(join(src, f), 'utf8')));
  expect(found).toEqual([]);
});

// What the app's prompt box does next (Ink: 'readable' and read()): it gets the keys typed after
// the menu closed. With 'data' and pause() it got nothing under Bun 1.4.2 (2 Oct 2026).
test('after the menu, a reader like the prompt box gets what is typed next', async () => {
  const input = new PassThrough();
  const output = new PassThrough(); output.resume();
  const p = pickOnTerminal(['a', 'b'], { input, output });
  input.write('2');
  expect(await p).toBe(1);
  const got = new Promise((resolve) => input.on('readable', () => { const c = input.read(); if (c !== null) resolve(String(c)); }));
  input.write('hello');
  expect(await got).toBe('hello');
});

// A row wider than the terminal wraps onto more rows: each move goes up by the rows on the screen, not the lines, so
// no copy of the menu is left above it (18 Nov 2026, the UI audit). Colours take no room, a wide character two.
test('the redraw goes up by the rows a wrapped menu takes on the screen', async () => {
  const { rowsUp } = await import('../src/app/pick.mjs');
  expect(rowsUp('ab\ncd\n', 80)).toBe(2);
  expect(rowsUp(`${'x'.repeat(45)}\n`, 20)).toBe(3);
  expect(rowsUp(`${'x'.repeat(40)}\n`, 20)).toBe(2); // exactly two rows: the line break after it starts the third
  expect(rowsUp('\x1b[38;5;147m❯ 1. ok\x1b[0m\n\n', 6)).toBe(3); // "❯ 1. ok" is 7 wide: two rows, then the blank one
  expect(rowsUp('漢字漢字\n', 4)).toBe(2);
  expect(rowsUp('ab\ncd', 80)).toBe(1); // a page that ends on its last row: the cursor is on it
  expect(rowsUp('ab\nxxxxxxxxxx', 4)).toBe(3); // and that row wrapped twice
  expect(rowsUp('ab\ncd\n', undefined)).toBe(2); // not a terminal: lines only, as before

  const input = new PassThrough();
  const output = new PassThrough(); output.columns = 20;
  let written = ''; output.on('data', (c) => { written += String(c); });
  const long = 'a'.repeat(45); // "❯ 1. " + 45 = 50 wide: three rows of 20
  const p = pickOnTerminal([long, 'b'], { input, output });
  input.write('\x1b[B\r');
  expect(await p).toBe(1);
  // 3 rows for the long one, 1 for b, the blank line, and the hint (30 wide: 2 rows) = 7, where counting lines said 4
  expect(written).toContain('\x1b[7A\r\x1b[J');
  expect(written).not.toContain('\x1b[4A');
});
