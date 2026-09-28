// The Mac's memory beside the welcome box (as the window opened) and live in
// the footer: the bar's parts, the words, where it shows, and the real app.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { memoryParts, footerLabel, pressureWord, openingMemory } from '../src/app/mac-memory.mjs';
import { Welcome } from '../src/app/screen.jsx';
import { macMemory, MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';
import { openTerm } from './term.mjs';
import { setup, T } from './app-setup.mjs';

const G = 2 ** 30;
// This Mac at 13:39 on 28 Sep: Gemma loaded at 16k, 1.4 GB free.
const LOADED = { total: 16 * G, avail: 1.44 * G, compressed: 3.0 * G, swapUsed: 1.07 * G, level: 2, name: 'Gemma', loaded: { bytes: 7.0 * G, ctx: 16384 }, need: null };
// The same Mac after `coding stop`: Gemma's 7 GB free again, 8 GB needed at 32k.
const FRESH = { ...LOADED, avail: 8.44 * G, level: 1, loaded: null, need: { bytes: 8.0 * G, ctx: 32768 } };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const welcome = (width, mem, cwd = '~') => strip(renderToString(React.createElement(Welcome, { model: 'Gemma 4 12B QAT', cwd, width, loaded: 'AGENTS.md + memory · no git', mem }), { columns: width }));

test('the bar always fills its cells exactly, and the room Gemma needs sits inside the free part', () => {
  for (const m of [LOADED, FRESH, { ...FRESH, avail: 0.1 * G }, { ...LOADED, avail: 15.9 * G, compressed: 0 }]) {
    const p = memoryParts(m, 50);
    expect(p.model + p.apps + p.packed + p.room + p.free).toBe(50);
    for (const k of ['model', 'apps', 'packed', 'room', 'free']) expect(p[k]).toBeGreaterThanOrEqual(0);
  }
  expect(memoryParts(LOADED, 50)).toMatchObject({ model: 22, room: 0, fits: null });
  expect(memoryParts(FRESH, 50)).toMatchObject({ model: 0, room: 25, fits: true });
  expect(memoryParts({ ...FRESH, avail: 5 * G }, 50).fits).toBe(false);
});

test('the footer says it the way Activity Monitor does, and the pressure has a word', () => {
  expect(footerLabel(LOADED)).toBe('Mac 14.6/16 GB');
  expect(footerLabel(FRESH)).toBe('Mac 7.6/16 GB');
  expect([1, 2, 4].map((level) => pressureWord({ level }))).toEqual(['fine', 'tight', 'critical']);
});

test('beside the welcome box when the window has room, on the box\'s lines, without making it taller', () => {
  const plain = welcome(107, null).split('\n');
  const loaded = welcome(107, LOADED).split('\n');
  expect(loaded.length).toBe(plain.length);
  expect(loaded[1]).toContain('Welcome to Agentic Coder!');
  expect(loaded[1]).toContain('Mac memory · 16.0 GB');
  expect(loaded[1]).toContain('● tight');
  expect(loaded[4]).toContain('■ Gemma 7.0  ■ apps 4.6  ■ squeezed 3.0  ░ free 1.4');
  expect(loaded[6]).toContain('Gemma loaded at 16k  ·  swap 1.1 GB');
  const fresh = welcome(107, FRESH).split('\n');
  expect(fresh[3]).toContain('▒');
  expect(fresh[6]).toContain('▒ Gemma at 32k: fits');
  for (const line of [...loaded, ...fresh]) expect(line.length).toBeLessThanOrEqual(107);
  // 106 columns is the least that holds both; narrower, the welcome is as it was.
  expect(welcome(106, LOADED)).toContain('Mac memory');
  expect(welcome(105, LOADED)).toBe(welcome(105, null));
  expect(welcome(80, LOADED)).toBe(welcome(80, null));
});

test('a long folder does not push the memory out: the box gives up width and the folder keeps its end', () => {
  const deep = '~/worktrees/agentic-mac-memory/terminal/test/fixture-page/some/deeper/folder';
  expect(welcome(107, null, deep).split('\n')[0].length).toBe(76); // alone, the box grows for the folder
  const lines = welcome(107, LOADED, deep).split('\n');
  expect(lines[1]).toContain('Mac memory');
  expect(lines.find((l) => l.includes('cwd:'))).toMatch(/cwd: …\S*\/some\/deeper\/folder /);
  expect(lines.find((l) => l.includes('/help for help'))).toContain('/stats for your current setup');
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(107);
});

test('measured on this Mac: the numbers add up, and --url says nothing about the model\'s room', () => {
  const m = macMemory();
  expect(m.total).toBeGreaterThan(0);
  expect(m.avail).toBeGreaterThanOrEqual(0);
  expect(m.avail).toBeLessThanOrEqual(m.total);
  expect([1, 2, 4]).toContain(m.level);
  const remote = openingMemory(MODELS[DEFAULT_MODEL], { url: 'http://127.0.0.1:1' });
  expect(remote.need).toBeNull();
  expect(remote.loaded).toBeNull();
});

test('the real app: the memory beside the welcome box and live in the footer, both gone in a narrow window', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const t = openTerm({ cwd, cols: 155, rows: 43, env, args: ['--url', fake.url] });
  try {
    await t.waitFor('? for shortcuts'); await t.idle();
    const lines = (await t.lines()).map((l) => l.text);
    const top = lines.find((l) => l.includes('Welcome to Agentic Coder'));
    expect(top).toContain('Mac memory');
    const footer = lines.find((l) => l.includes('? for shortcuts'));
    expect(footer).toMatch(/● Mac \d+\.\d\/\d+ GB/);
    expect(lines.some((l) => l.includes('swap'))).toBe(true);
    t.resize(80, 24); await new Promise((r) => setTimeout(r, 150)); await t.idle(400, 5000);
    const small = (await t.lines()).map((l) => l.text);
    expect(small.find((l) => l.includes('Welcome to Agentic Coder'))).not.toContain('Mac memory');
    expect(small.find((l) => l.includes('? for shortcuts'))).not.toContain('…');
  } finally { await t.close(); await fake.close(); }
}, T);
