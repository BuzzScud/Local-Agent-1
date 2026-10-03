// The Mac's memory, live in the footer only: the words, this Mac's own
// numbers, and the real app (no panel beside the start page since 28 Sep).
import { test, expect } from 'bun:test';
import { needs } from './needs.mjs';
import React from 'react';
import { renderToString } from 'ink';
import { footerLabel, pressureWord } from '../src/app/mac-memory.mjs';
import { StartPage } from '../src/app/start.jsx';
import { macMemory } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';
import { openTerm } from './term.mjs';
import { setup, T } from './app-setup.mjs';

const G = 2 ** 30;
// This Mac at 13:39 on 28 Sep: Gemma loaded at 16k, 1.4 GB free.
const LOADED = { total: 16 * G, avail: 1.44 * G, compressed: 3.0 * G, swapUsed: 1.07 * G, level: 2 };
// The same Mac after `coding stop`: Gemma's 7 GB free again.
const FRESH = { ...LOADED, avail: 8.44 * G, level: 1 };
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('the footer says it the way Activity Monitor does, and the pressure has a word', () => {
  expect(footerLabel(LOADED)).toBe('Mac 14.6/16 GB');
  expect(footerLabel(FRESH)).toBe('Mac 7.6/16 GB');
  expect([1, 2, 4].map((level) => pressureWord({ level }))).toEqual(['fine', 'tight', 'critical']);
});

test('the start page says nothing about the memory: that is the footer', () => {
  const out = strip(renderToString(React.createElement(StartPage, { start: { model: 'Gemma 4 12B QAT', effort: 'low', ctx: 32768, cwd: '~', git: 'not a git repository', notes: ['AGENTS.md', 'memory'], recent: [] }, width: 155 }), { columns: 155 }));
  expect(out).toContain('Agentic Coder v');
  expect(out).not.toContain('Mac memory');
  expect(out).not.toContain('does not fit');
  for (const line of out.split('\n')) expect(line.trimEnd().length).toBeLessThanOrEqual(155);
});

test('measured on this Mac: the numbers add up', () => {
  const m = macMemory();
  expect(m.total).toBeGreaterThan(0);
  expect(m.avail).toBeGreaterThanOrEqual(0);
  expect(m.avail).toBeLessThanOrEqual(m.total);
  expect([1, 2, 4]).toContain(m.level);
});

test.skipIf(needs('python3'))('the real app: no memory panel beside the start page; the memory is live in the footer, and a narrow window does not cut the footer short', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const t = openTerm({ cwd, cols: 155, rows: 43, env, args: ['--url', fake.url] });
  try {
    await t.waitFor('? for shortcuts'); await t.idle();
    const lines = (await t.lines()).map((l) => l.text);
    expect(lines.find((l) => l.includes('Agentic Coder v'))).not.toContain('Mac memory');
    expect(lines.some((l) => l.includes('squeezed') || l.includes('swap'))).toBe(false);
    const footer = lines.find((l) => l.includes('? for shortcuts'));
    expect(footer).toMatch(/● Mac \d+\.\d\/\d+ GB/);
    t.resize(80, 24); await new Promise((r) => setTimeout(r, 150)); await t.idle(400, 5000);
    const small = (await t.lines()).map((l) => l.text);
    expect(small.find((l) => l.includes('? for shortcuts'))).not.toContain('…');
  } finally { await t.close(); await fake.close(); }
}, T);
