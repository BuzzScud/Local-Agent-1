// The window changing size under the real app: a resizable terminal (a pty
// read back by a terminal emulator that re-wraps lines as Terminal does).
// Every resize must end in one clean screen at the new size.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { openTerm } from './term.mjs';
import { checkScreen } from './screen-checks.mjs';

const T = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'bonsai-resize-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  return { cwd, env: { BONSAI_HOME: join(base, 'home') } };
}
const LONG = 'The project is a small Node.js script that reads trades.json and prints it as CSV, with two tests in export.test.mjs and no dependencies beyond Node itself.';
async function clean(t, what) {
  const bad = checkScreen(await t.lines(), { cols: t.cols, rows: t.rows, anchored: true, scrollback: await t.lines({ all: true }) }).filter((c) => !c.ok);
  expect([what, bad.map((c) => `${c.what} ${c.detail}`)]).toEqual([what, []]);
}
async function settle(t, c, r) { t.resize(c, r); await sleep(150); await t.idle(400, 5000); }

test('shrink, grow, drag and height-only resizes each end in one clean screen', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: LONG }], { delayMs: 2 });
  const t = openTerm({ cwd, env, cols: 155, rows: 43, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts'); await t.type('hi'); t.key('enter'); await t.waitFor('no dependencies'); await t.idle();
    for (const [c, r] of [[80, 24], [200, 50], [120, 24], [155, 43]]) { await settle(t, c, r); await clean(t, `${c}×${r}`); }
    // A fast drag: one redraw at the end, nothing drawn in between.
    const before = t.raw().length;
    for (let c = 155; c >= 85; c -= 5) { t.resize(c, 43); await sleep(20); }
    await sleep(150); await t.idle(400, 5000);
    await clean(t, 'after a drag');
    expect(t.raw().subarray(before).toString('latin1').split('\x1b[3J').length - 1).toBe(1);
    expect(await t.screen()).toContain('no dependencies'); // the conversation is still there
  } finally { await t.close(); await fake.close(); }
}, T);

test('below 80×24 a note replaces the screen and keys wait; it all comes back', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hi.' }], { delayMs: 2 });
  const t = openTerm({ cwd, env, cols: 100, rows: 30, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    await settle(t, 70, 20);
    expect(await t.screen()).toContain('Make the window at least 80×24');
    await t.type('hello'); t.key('enter'); await sleep(300); // ignored while too small
    expect(fake.requests.length).toBe(0);
    await settle(t, 100, 30);
    await clean(t, 'back to 100×30');
    expect(await t.screen()).toContain('Welcome to Bonsai Code');
    expect(await t.screen()).not.toContain('hello');
  } finally { await t.close(); await fake.close(); }
}, T);

test('esc closes the "/" menu first and keeps Bonsai working; the next esc stops it', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ reasoning: 'Thinking it over at length. '.repeat(400) }], { delayMs: 10 });
  const t = openTerm({ cwd, env, cols: 120, rows: 36, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts'); await t.type('think'); t.key('enter'); await t.waitFor('esc to stop');
    await t.type('/'); await t.waitFor('/help');
    t.key('esc'); await sleep(300);
    expect(await t.screen()).not.toContain('Show commands and keys');
    expect(await t.screen()).toContain('esc to stop');
    t.key('backspace'); await sleep(100); t.key('esc');
    await t.waitFor('Interrupted');
  } finally { await t.close(); await fake.close(); }
}, T);

test('text and enter arriving together (a busy app) still send the message', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Got it.' }], { delayMs: 2 });
  const t = openTerm({ cwd, env, cols: 100, rows: 30, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts');
    t.key('explain the tests\r'); // one write: the app reads it as one chunk
    await t.waitFor('Got it.');
    expect(await t.screen()).toContain('> explain the tests');
  } finally { await t.close(); await fake.close(); }
}, T);
