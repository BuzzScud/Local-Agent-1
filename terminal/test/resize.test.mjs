// The window changing size under the real app: a resizable terminal (a pty
// read back by a terminal emulator that re-wraps lines as Terminal does).
// Every resize must end in one clean screen at the new size.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { openTerm } from './term.mjs';
import { checkScreen } from './screen-checks.mjs';

const T = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'agentic-resize-'));
  const cwd = join(base, 'demo-project');
  cpSync(join(import.meta.dir, '..', 'demo-project'), cwd, { recursive: true });
  // Pre-trusted, so the run starts on the welcome, not the safety check.
  mkdirSync(join(base, 'home'), { recursive: true });
  writeFileSync(join(base, 'home', 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
  return { cwd, env: { AGENTIC_HOME: join(base, 'home') } };
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
    expect(await t.screen()).toContain('Recent activity');
    expect(await t.screen()).not.toContain('hello');
  } finally { await t.close(); await fake.close(); }
}, T);

test('esc closes the "/" menu first and keeps Agentic Coder working; the next esc stops it', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ reasoning: 'Thinking it over at length. '.repeat(400) }], { delayMs: 10 });
  const t = openTerm({ cwd, env, cols: 120, rows: 36, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts'); await t.type('think'); t.key('enter'); await t.waitFor('esc to interrupt');
    await t.type('/'); await t.waitFor('/help');
    t.key('esc'); await sleep(300);
    expect(await t.screen()).not.toContain('Open the Help page in the browser');
    expect(await t.screen()).toContain('esc to interrupt');
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
    expect(await t.screen()).toContain('› explain the tests');
  } finally { await t.close(); await fake.close(); }
}, T);

test('the footer fits narrow windows: the right side drops words, never runs into "? for shortcuts"', async () => {
  const { footerRight } = await import('../src/app/screen.jsx');
  expect(footerRight('edits', 200)).toEqual({ cycle: true });
  expect(footerRight('edits', 30)).toEqual({ cycle: false }); // the mode stays, the "(shift+tab to cycle)" hint goes
  expect(footerRight('plan', 30)).toEqual({ cycle: false });
  expect(footerRight('ask', 20)).toEqual({ cycle: true }); // nothing on the right in ask mode
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const t = openTerm({ cwd, cols: 80, rows: 24, env, args: ['--url', fake.url, '--mode', 'edits'] });
  try {
    await t.waitFor('? for shortcuts'); await t.idle();
    const footer = (await t.lines()).map((l) => l.text).find((l) => l.includes('? for shortcuts'));
    expect(footer).toContain('⏵⏵ accept edits on');
    expect(footer).not.toContain('…');
    await settle(t, 155, 43);
    expect((await t.lines()).map((l) => l.text).find((l) => l.includes('? for shortcuts'))).toContain('(shift+tab to cycle)');
  } finally { await t.close(); await fake.close(); }
}, T);

test('a reply being written is cut to the lines it takes on screen, not its source lines', async () => {
  const { tailToFit } = await import('../src/app/screen.jsx');
  const long = 'word '.repeat(40).trim(); // 199 chars: 3 lines at 77 columns
  const text = Array.from({ length: 10 }, (_, i) => `- ${i} ${long}`).join('\n');
  const shown = tailToFit(text, 8, 77);
  expect(shown.split('\n').length).toBe(2); // 2 × 3 lines = 6 ≤ 8; a third would make 9
  expect(shown.endsWith(`- 9 ${long}`)).toBe(true);
  expect(tailToFit('short\nlines', 8, 77)).toBe('short\nlines');
  expect(tailToFit('x'.repeat(2000), 3, 50).length).toBeLessThanOrEqual(150);
});

test('a long reply being written never spills into the scrollback (it once printed its first line 249 times)', async () => {
  const { cwd, env } = setup();
  // Paragraphs with blank lines between them: rendered taller than their source lines.
  const reply = ['FIRST-LINE-MARKER: I checked the file four ways.', ...Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of the answer, long enough to wrap once at eighty columns in a small window like this one.`)].join('\n\n');
  const fake = await startFakeServer([{ text: reply }], { delayMs: 3 });
  const t = openTerm({ cwd, cols: 80, rows: 24, env, args: ['--url', fake.url, '--no-flows'] });
  try {
    await t.waitFor('? for shortcuts'); await t.idle();
    await t.type('explain it'); t.key('enter');
    await t.waitFor('Paragraph 30', 30_000); await t.waitGone('esc to interrupt', 30_000); await t.idle();
    const all = (await t.lines({ all: true })).map((l) => l.text).join('\n');
    expect(all.split('FIRST-LINE-MARKER').length - 1).toBe(1);
  } finally { await t.close(); await fake.close(); }
}, T);

test('memoryWarning: silent under 70%, then says what happens next', async () => {
  const { memoryWarning } = await import('../src/app/screen.jsx');
  expect(memoryWarning(10_000, 32_768)).toBeNull();
  expect(memoryWarning(23_500, 32_768)).toMatch(/^Memory 72% full: old tool output is trimmed soon/);
  expect(memoryWarning(28_500, 32_768)).toMatch(/^Memory 87% full: the conversation is summarized/);
  // With the room kept for the next reply counted: at 16k with a 4,096 cap, notes came at 58% used.
  expect(memoryWarning(9_500, 16_384, 6_144)).toBe('Memory 58% used + 38% kept for the next reply: notes or a summary at the next step');
  expect(memoryWarning(6_000, 16_384, 6_144)).toBe('Memory 37% used + 38% kept for the next reply: old tool output is trimmed soon');
  expect(memoryWarning(3_000, 16_384, 6_144)).toBeNull();
});
