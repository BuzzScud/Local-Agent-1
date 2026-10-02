// The menu before the app starts (app/pick.mjs): its keys, and nothing of it left on stdin after
// it closes, since the app's prompt box reads the same stdin next (2 Oct 2026).
import { test, expect } from 'bun:test';
import { PassThrough } from 'node:stream';
import { pickOnTerminal, keysOf } from '../src/app/pick.mjs';

test('keys: arrows in both spellings, a lone esc, other escape sequences skipped', () => {
  expect(keysOf('\x1b[A\x1b[B2')).toEqual(['up', 'down', '2']);
  expect(keysOf('\x1bOB\r')).toEqual(['down', '\r']);
  expect(keysOf('\x1b')).toEqual(['esc']);
  expect(keysOf('\x1b[1;2Cj')).toEqual(['j']);
});

test('the menu picks, and takes off every listener it put on stdin', async () => {
  const input = new PassThrough();
  const output = new PassThrough(); output.resume();
  const before = input.listenerCount('data');
  const p = pickOnTerminal(['a', 'b', 'c'], { input, output });
  input.write('\x1b[B\x1b[B\x1b[A\r');
  expect(await p).toBe(1);
  expect(input.listenerCount('data')).toBe(before);
  expect(input.listenerCount('keypress')).toBe(0);
  const q = pickOnTerminal(['a', 'b'], { input, output });
  input.write('\x1b');
  expect(await q).toBeNull();
  expect(input.listenerCount('data')).toBe(before);
});
