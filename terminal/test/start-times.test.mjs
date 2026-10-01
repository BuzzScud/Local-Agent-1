// How long a start takes (start-times.mjs): kept per model, the last five of each part, and turned
// into what the running start has left. Every read and write here goes to a throwaway file.
import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-times-home-')); // before the models part is imported
const { saveTime, loadTimes, median, startLeft, typicalStart } = await import('../src/app/start-times.mjs');
const file = () => join(mkdtempSync(join(tmpdir(), 'agentic-times-')), 'start-times.json');

test('the last five of each part are kept per model, with the kind the last start had', () => {
  const f = file();
  for (const s of [10, 11, 12, 13, 14, 15]) saveTime('qwen', 'load', s, f);
  saveTime('qwen', 'read', 29.94, f);
  saveTime('qwen', 'restore', 1.2, f);
  saveTime('gemma', 'read', 40, f);
  const t = loadTimes(f);
  expect(t.qwen.load).toEqual([11, 12, 13, 14, 15]);
  expect(t.qwen.read).toEqual([29.9]);
  expect(t.qwen.last).toBe('restore'); // the likeliest next
  expect(t.gemma.read).toEqual([40]);
  saveTime('qwen', 'load', NaN, f); // a broken time is not kept
  expect(JSON.parse(readFileSync(f, 'utf8')).qwen.load).toHaveLength(5);
  expect(loadTimes(join(tmpdir(), 'no-such-dir', 'start-times.json'))).toEqual({});
});

test('what the running start has left, from its phase and how long each part has run', () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([1, 2, 3, 4])).toBe(2.5);
  expect(median([])).toBe(null);
  const t = { load: [10, 12, 11], read: [30, 28], restore: [2, 3], last: 'restore' };
  const loading = startLeft(t, { phase: 'loading', sinceLoad: 4 });
  expect(loading.left).toBe(7 + 2.5); // the rest of the load, then a restore like the last start
  expect(loading.done).toBeCloseTo(4 / 13.5);
  expect(startLeft(t, { phase: 'reading', sinceWarm: 10 }).left).toBe(19);
  expect(startLeft(t, { phase: 'restoring', sinceWarm: 1 }).left).toBe(1.5);
  expect(startLeft(t, { phase: 'loading', cold: false, sinceLoad: 0 }).left).toBe(2.5); // a model already loaded: no load part
  const late = startLeft(t, { phase: 'reading', sinceWarm: 40 });
  expect(late.over).toBe(true); // longer than usual
  expect(late.left).toBe(0);
  expect(startLeft(t, { phase: 'waiting' })).toBe(null); // waiting for memory: nobody knows how long
  expect(startLeft({}, { phase: 'loading' })).toBe(null); // nothing on record yet
  expect(startLeft(undefined, { phase: 'loading' })).toBe(null);
  expect(typicalStart(t)).toBe(13.5);
  expect(typicalStart({ load: [5] })).toBe(null);
});

// 1 Oct 2026: the screen's clock, up to 100 ms behind a part's start, gave a negative time; done
// came out -0.25 and the bar's '━'.repeat(-5) ended the app as the model started.
test('a clock a moment behind the start never makes the bar go below empty', () => {
  const bonsai = { load: [1.8, 7.8, 2.5, 1.3, 7.1], read: [67, 67.8, 66.5], restore: [0.2, 0.2, 0.1], last: 'restore' };
  for (const a of [{ phase: 'restoring', cold: false, sinceWarm: -0.05 }, { phase: 'loading', sinceLoad: -0.08 }, { phase: 'reading', sinceWarm: -3 }, { phase: 'loading', sinceLoad: NaN }]) {
    const r = startLeft(bonsai, a);
    expect([a, r.done >= 0 && r.done <= 1]).toEqual([a, true]);
  }
  expect(startLeft(bonsai, { phase: 'restoring', cold: false, sinceWarm: -0.05 }).done).toBe(0);
});
