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
