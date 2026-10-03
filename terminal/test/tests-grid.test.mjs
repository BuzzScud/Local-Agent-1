// The Tests page's grid (terminal/src/app/tests.html): each test a row, in two halves, with its name in
// full; each model a column. Before 3 Oct 2026 it was the other way round, and at 25 tests across a
// test's name was one letter and "never run" was cut to "nev". The page is built from a record of its
// own and read back from a real browser.
import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { needs } from './needs.mjs';
import { findChrome } from '../src/flows/layoutcheck.mjs';

// A throwaway home before the models part is imported (it reads AGENTIC_HOME once).
const base = mkdtempSync(join(tmpdir(), 'agentic-tests-grid-'));
process.env.AGENTIC_HOME = join(base, 'home');
const { MODELS, recordTest, recordData, writeSnapshot, modelPath } = await import('../../models/index.mjs');

const src = readFileSync(join(import.meta.dir, '..', 'src', 'app', 'tests.html'), 'utf8');
const nameOf = (t) => t.re.replace(/^\^|\$$/g, '').replace(/\\(.)/g, '$1'); // a name its pattern matches

// A record of its own: two models on "this Mac", a check run twice on one (so it has a change), one
// that failed, and most cells never run.
function page() {
  const file = join(base, 'record.jsonl'), docsDir = join(base, 'docs');
  mkdirSync(docsDir, { recursive: true });
  const ids = Object.keys(MODELS).slice(0, 2);
  for (const id of ids) { mkdirSync(dirname(modelPath(MODELS[id])), { recursive: true }); writeFileSync(modelPath(MODELS[id]), 'stand-in'); }
  const board = recordData(file).board;
  const t = (id) => board.find((x) => x.id === id);
  const put = (id, model, passed, total, at, more = {}) => recordTest({ kind: t(id).kind, name: nameOf(t(id)), model, passed, total, secs: 60, at, ...more }, { file, snapshot: false, quiet: true });
  put('sorting', ids[0], 79, 82, '2026-09-29T10:00:00.000Z', { bar: 'at most 4 wrong', result: 'pass' });
  put('sorting', ids[0], 80, 82, '2026-09-30T10:00:00.000Z', { bar: 'at most 4 wrong', result: 'pass' });
  put('twoatonce', ids[1], 0, 3, '2026-09-30T11:00:00.000Z');
  const out = writeSnapshot({ file, docsDir });
  return { out, board, ids, models: recordData(file).models };
}

test('the page keeps one ▶ for the cell picked, in the hub only, and a never-run cell can be picked', () => {
  // The grid's cells carry no button of their own; the one ▶ is on the line under the grid.
  expect(src.match(/class="go"/g)).toHaveLength(1);
  expect(src).toContain('const run = live ? `<button type="button" class="go" data-run=');
  expect(src).toContain('▶ Run it in the Arena</button>');
  expect(src).toContain("const td = e.target.closest('td[data-cell]');\n    if (td) {"); // never run: picked like any other
  expect(src).toContain('▶ under the grid runs it.');
});

test.skipIf(needs('chrome', findChrome))('in a real browser: every test is a row with its name in full, in two halves of the same height; each model is a column; a never-run cell says so; the cell picked is said under the grid', () => {
  const { out, board, ids, models } = page();
  expect(models.map((m) => m.id).sort()).toEqual([...ids].sort());
  const prof = mkdtempSync(join(tmpdir(), 'agentic-tests-grid-chrome-'));
  const r = spawnSync(findChrome(), ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${prof}`, '--window-size=1803,890', '--virtual-time-budget=3000', '--dump-dom', `file://${out}`], { encoding: 'utf8', timeout: 60_000 });
  const dom = r.stdout;
  const grid = dom.slice(dom.indexOf('<div class="board turn">'), dom.indexOf('<section id="trend">'));
  expect(grid.length).toBeGreaterThan(1000);
  const halves = grid.split('<table>').slice(1);
  expect(halves).toHaveLength(2);
  // Every test the Arena can run is a row, by its whole name, once.
  for (const t of board) expect([t.name, grid.split(`<th title="${t.name.replace(/&/g, '&amp;')}">${t.name.replace(/&/g, '&amp;')}</th>`).length - 1]).toEqual([t.name, 1]);
  // The two halves have the same number of rows (a spare row evens an odd count), so rows line up.
  const rows = halves.map((h) => h.split('<tbody>')[1].split('<tr').length - 1);
  expect(rows[0]).toBe(rows[1]);
  expect(rows[0] + rows[1] - (board.length % 2)).toBe(board.length);
  // Each model on this Mac is a column in both halves, by a short name, its whole name on pointing.
  for (const m of models) expect(grid.split(`<th title="${m.name}">`).length - 1).toBe(2);
  // A run: its count, and an arrow for the change since the run before. A failed one in red.
  const cell = (id, model) => new RegExp(`<td[^>]*data-cell="${model}\\|${id}"[^>]*>(.*?)</td>`).exec(grid)?.[1] ?? '';
  expect(cell('sorting', ids[0])).toContain('<span class="v ok">✓ 80/82</span>');
  expect(cell('sorting', ids[0])).toMatch(/<span class="q up1"[^>]*>↑<\/span>/);
  expect(cell('twoatonce', ids[1])).toContain('<span class="v bad">✗ 0/3</span>');
  // Never run: the word, not an empty cell; and every model × test cell is there.
  expect(cell('sorting', ids[1])).toBe('never');
  expect(grid.split('data-cell="').length - 1).toBe(board.length * models.length);
  expect(grid.split('>never</td>').length - 1).toBe(board.length * models.length - 2);
  // The cell picked (the one with a line to draw), in words, under the grid; no ▶ in the saved copy.
  const picked = /<div class="picked">(.*?)<\/div>/.exec(grid)?.[1] ?? '';
  expect(picked).toContain('<b>Sorting check</b>');
  expect(picked).toContain('✓ 80 of 82');
  expect(picked).toContain('its bar: at most 4 wrong');
  expect(picked).toContain('+1 vs the run before');
  expect(grid).not.toContain('class="go"');
  expect(grid).toContain(`data-cell="${ids[0]}|sorting" aria-selected="true"`);
}, 90_000);
