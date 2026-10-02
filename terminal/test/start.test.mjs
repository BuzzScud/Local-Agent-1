// The start page (start.jsx): two columns under a titled line, the model loading in place, the
// tip under the prompt box until the first message, and the safety check in the same columns.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
const h = React.createElement;
import { StartPage, TrustPage, botPixels, botRows, botCells, botGlyph, greyOf, nameOf, BOT_STRIP_ROW, ago, titleOf, recentOf, gitWords, notesWords, startTip, tipsOn, TIPS, INIT_TIP } from '../src/app/start.jsx';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { setup, T, quit } from './app-setup.mjs';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const draw = (el, cols) => strip(renderToString(el, { columns: cols })).split('\n');
const NOW = Date.parse('2026-09-30T03:30:00Z');
const at = (h) => new Date(NOW - h * 3600e3).toISOString();
const START = {
  model: 'Qwen3.5 9B', effort: 'high', ctx: 65536, cwd: '~', git: 'not a git repository', notes: ['AGENTS.md', 'memory'], now: NOW,
  recent: [
    { title: 'Write a self-contained HTML file for an in-app notification card. Show an app ic', updated: at(1) },
    { title: 'Write a self-contained HTML file for an in-app notification card. Show an app ic', updated: at(1.9) },
    { title: 'Create a single HTML file that renders a small weather widget for a city. Includ', updated: at(6) },
    { title: 'w01 · Fix a futures roll\n------------------\nthat stays', updated: at(30) },
  ],
};

test('the page: a titled line, the greeting, the bot, the model; recent activity, this folder and keys to try beside them', () => {
  const lines = draw(h(StartPage, { start: START, width: 107 }), 107);
  expect(lines[0]).toMatch(/^── Agentic Coder v\d+\.\d+\.\d+ ─+$/);
  const text = lines.join('\n');
  for (const s of ['Welcome back!', 'Qwen3.5 9B', '● ready · effort high · 64k context', 'Recent activity', '1h ago', '6h ago', '1d ago', '1 prompt', '/resume for more', 'This folder', 'Try', '@ a file   ! a command   / every command']) expect(text).toContain(s);
  expect(draw(h(StartPage, { start: START, width: 127 }), 127).join('\n')).toContain('/ every command   shift+tab switch mode'); // as many keys as fit
  expect(text).toMatch(/where\s+~ · your home folder/); // this folder as labelled rows
  expect(text).toMatch(/git\s+none here/);
  expect(text).toMatch(/reads\s+AGENTS\.md \+ memory/);
  const turns = draw(h(StartPage, { start: { ...START, recent: [{ ...START.recent[0], turns: 4 }] }, width: 107 }), 107).join('\n');
  expect(turns).toContain('4 prompts'); // how many prompts each one had
  expect(text.match(/In-app notification card/g)).toHaveLength(1); // the same prompt run again shows once, by its subject
  expect(text).toContain('Small weather widget for a city');
  expect(text).toContain('w01 · Fix a futures roll that stays'); // one line, the separator run gone
  expect(text).not.toContain('┌');
  expect(text).not.toContain('╭'); // no box
  const also = draw(h(StartPage, { start: { ...START, also: ['folder settings (model)', 'starts in auto-edit (/permissions)'] }, width: 107 }), 107).join('\n');
  expect(also).toContain('starts in auto-edit (/permissions)'); // what this folder changes at the start
  expect(also).toContain('folder settings (model)');
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(107);
});

test('loading and ready take the same rows, so nothing moves when the page is printed', () => {
  for (const w of [80, 107, 155]) {
    const ready = draw(h(StartPage, { start: START, width: w }), w);
    const loading = draw(h(StartPage, { start: START, width: w, loading: { phase: 'reading', secs: 12.4 } }), w);
    expect(loading.length).toBe(ready.length);
    // the start's steps under the model's name: done, now (with its seconds), still to come
    expect(loading.join('\n')).toContain(w >= 100 ? '✓ model ─ ◐ instructions 12s ─ ○ ready' : '✓ model ◐ reading 12s ○ ready');
    const model = draw(h(StartPage, { start: START, width: w, loading: { phase: 'loading', secs: 3 } }), w).join('\n');
    expect(model).toMatch(/[◐◓◑◒] model 3s/);
    expect(model).toContain('○ ready');
    // a long name has its own line, never a cut one
    const gemma = draw(h(StartPage, { start: { ...START, model: 'Gemma 4 12B QAT' }, width: w, loading: { phase: 'reading', secs: 12.4 } }), w).join('\n');
    expect(gemma).toContain('Gemma 4 12B QAT');
    expect(gemma).not.toContain('…│');
    for (const l of [...ready, ...loading]) expect(l.length).toBeLessThanOrEqual(w);
    // the left column never wraps: the rail between the columns is on every row but the title's two
    expect(ready.slice(2).every((l) => l.includes('│'))).toBe(true);
  }
});

test('the bot sleeps while the model is off, looks about while it loads, and is happy when ready', () => {
  // Its eyes: the green light on the glass in its face (rows 4–9); the chest strip is row 15.
  const eyes = (state, k) => botPixels(state, k).flatMap((row, y) => row.map((c, x) => (y >= 4 && y <= 9 && x >= 4 && x <= 17 && [65, 71, 120, 157, 194].includes(c) ? `${x},${y}:${c}` : null))).filter(Boolean);
  const strip = (state, k) => botPixels(state, k)[BOT_STRIP_ROW].slice(7, 15);
  expect(eyes('off')).toEqual(['6,7:65', '7,7:65', '8,7:65', '13,7:65', '14,7:65', '15,7:65']); // – –
  expect(botPixels('off')[0][18]).toBe(243); // and a Z
  expect(eyes('trust')).toContain('13,6:71'); // one eye open at the safety check
  expect(eyes('ready')).toEqual(['7,6:157', '8,6:157', '13,6:157', '14,6:157', '6,7:157', '9,7:157', '12,7:157', '15,7:157']); // ^ ^
  expect(strip('off', 0).every((c) => c === 236)).toBe(true);
  expect(strip('ready', 0).every((c) => c === 114)).toBe(true);
  expect(strip('loading', 3).filter((c) => c === 120)).toHaveLength(3); // it fills while it loads
  expect(eyes('loading', 2)).not.toEqual(eyes('loading', 0)); // it looks about
  expect(eyes('loading', 9).every((e) => e.includes(',7:'))).toBe(true); // and blinks
  expect(botPixels('loading', 0)[0][10]).not.toBe(botPixels('loading', 2)[0][10]); // the antenna's light pulses
  // 22 columns × 10 rows, every row as wide
  const rows = botRows('ready');
  expect(rows).toHaveLength(10);
  for (const r of rows) expect(r.props.children).toHaveLength(22);
});

test('the bot leaves no line through it in Terminal: each cell takes the glyph whose sliver matches its neighbours', () => {
  // SF Mono in Terminal: ▄ leaves 0.175 pt of the background under it, ▀ 2.145 pt over it.
  expect(botGlyph(null, 250, 250, null)).toEqual({ ch: ' ', bg: 250 }); // one colour: a background, the whole cell
  expect(botGlyph(255, 255, 233, 233)).toEqual({ ch: '▄', fg: 233, bg: 255 }); // the helmet over the glass: its own colour under ▄
  expect(botGlyph(null, 255, 233, 233).ch).toBe('▀'); // with the window above, the glass's sliver goes there, dark on dark
  expect(botGlyph(233, 157, 233, 233).ch).toBe('▀'); // a ^ eye's top on the glass: the glass shows over it, beside the glass
  expect(botGlyph(null, 243, null, null).ch).toBe('▀'); // a pixel alone: the window shows over it
  const apart = (a, b) => Math.abs(greyOf(a) - greyOf(b));
  for (const [state, look] of [['off', null], ['trust', null], ['loading', null], ['ready', null], ['ready', 0.5]]) {
    const px = botPixels(state, 3, look);
    const cells = botCells(state, 3, look);
    expect(cells.flat().some((c) => c.ch === '█')).toBe(false);
    let longest = 0;
    cells.forEach((row, r) => {
      let run = 0;
      row.forEach((c, x) => {
        const [up, t, b, dn] = [px[2 * r - 1]?.[x] ?? null, px[2 * r][x], px[2 * r + 1]?.[x] ?? null, px[2 * r + 2]?.[x] ?? null];
        const shows = c.ch === ' ' ? 0 : c.ch === '▀' ? 2.145 * Math.min(apart(b, up), apart(b, t)) : 0.175 * Math.min(apart(t, b), apart(t, dn));
        run = shows > 5 ? run + 1 : 0;
        longest = Math.max(longest, run);
      });
    });
    expect(longest).toBeLessThanOrEqual(2); // the first bot drew lines 20 columns long
  }
});

test('while you type, the awake bot looks down at the prompt box, left or right with the cursor', () => {
  const eyes = (state, look) => botPixels(state, 0, look).flatMap((row, y) => row.map((c, x) => (y >= 4 && y <= 9 && x >= 4 && x <= 17 && [120, 157, 194].includes(c) ? `${x},${y}` : null))).filter(Boolean);
  expect(eyes('ready', 0.1)).toEqual(['6,8', '7,8', '12,8', '13,8', '6,9', '7,9', '12,9', '13,9']); // down and to the left
  expect(eyes('ready', 0.9)).toEqual(['8,8', '9,8', '14,8', '15,8', '8,9', '9,9', '14,9', '15,9']); // down and to the right
  expect(eyes('loading', 0.5)).toEqual(eyes('ready', 0.5).map((e) => e)); // loading too
  expect(botPixels('off', 0, 0.5)).toEqual(botPixels('off', 0)); // asleep, it does not look
  const page = (typing) => renderToString(h(StartPage, { start: START, width: 107, typing }), { columns: 107 });
  expect(page(0.1)).not.toBe(page(null));
});

test('Recent activity names a conversation by its subject, not the opening most prompts share', () => {
  const n = (title) => nameOf({ title });
  expect(n('Create a self-contained HTML file for a compact media player card. Show album ar')).toBe('Compact media player card');
  expect(n('Write a self-contained HTML file for an in-app notification card. Show an app ic')).toBe('In-app notification card');
  expect(n('Make one HTML file that displays a social feed post. Include an author a')).toBe('Social feed post');
  expect(n('Write a Python script that lists the 10 largest files in a folder and their sizes. Then sort')).toBe('Lists the 10 largest files in a folder and their sizes');
  const saved = 'Create one self-contained HTML file called notes.html that works when I double-click it'.slice(0, 80); // titles are saved cut to 80
  expect(n(saved)).toBe('notes.html that works when I double-c…'); // a file name keeps its case; still cut where it was saved
  for (const t of ['what is two plus two', 'Create a file', 'rsync -a --delete src/ dst/', 'fix the login test']) expect(n(t)).toBe(t); // anything else as it is
});

test('the start is timed: a bar with the seconds left, "/start takes about" while off, "started in" once ready', () => {
  const left = (est) => draw(h(StartPage, { start: START, width: 107, loading: { phase: 'reading', secs: 14.5, left: est } }), 107).join('\n');
  expect(left({ left: 9.6, done: 0.6, over: false })).toMatch(/━+─+ about 10 s left/);
  expect(left({ left: 0, done: 1, over: true })).toMatch(/━+ longer than usual/);
  expect(left(null)).toContain('timing this start for next time'); // no start on record yet
  expect(draw(h(StartPage, { start: START, width: 107, loading: { phase: 'waiting', secs: 3 } }), 107).join('\n')).toContain('starts once the memory is free');
  expect(draw(h(StartPage, { start: { ...START, off: true, typical: 18.4 }, width: 107 }), 107).join('\n')).toContain('/start takes about 18 s');
  expect(draw(h(StartPage, { start: { ...START, took: 31.2 }, width: 107 }), 107).join('\n')).toContain('started in 31 s');
  for (const w of [80, 107]) for (const l of draw(h(StartPage, { start: START, width: w, loading: { phase: 'reading', secs: 3, left: { left: 120, done: 0.02, over: false } } }), w)) expect(l.length).toBeLessThanOrEqual(w);
});

test('a new folder: welcome, nothing here yet, and /init', () => {
  const text = draw(h(StartPage, { start: { ...START, cwd: '~/Desktop/new-project', notes: ['memory'], recent: [] }, width: 80 }), 80).join('\n');
  for (const s of ['Welcome!', 'No conversations here yet', '/init writes an AGENTS.md for this project', 'no AGENTS.md yet · reads memory', '~/Desktop/new-project']) expect(text).toContain(s);
  expect(text).not.toContain('Welcome back!');
});

test('titles, times, git and notes in the page\'s words', () => {
  expect(titleOf({ title: 'a\nb   c' })).toBe('a b c');
  expect(titleOf({ title: 'x'.repeat(80) })).toBe(`${'x'.repeat(80)}…`); // cut when it was saved
  expect(recentOf([{ title: 'a' }, { title: 'a ' }, { title: 'b' }, { title: 'c' }, { title: 'd' }]).map((s) => s.title)).toEqual(['a', 'b', 'c']);
  expect(ago(at(0.2), NOW)).toBe('12m ago');
  expect(ago(at(5), NOW)).toBe('5h ago');
  expect(ago(at(50), NOW)).toBe('2d ago');
  expect(gitWords('branch main, no uncommitted changes')).toBe('git main · clean');
  expect(gitWords('branch dev, 3 changed files')).toBe('git dev · 3 changed');
  expect(gitWords('not a git repository')).toBe('no git');
  expect(notesWords(['AGENTS.md'])).toBe('reads AGENTS.md');
  expect(notesWords([])).toBe('no AGENTS.md yet');
});

test('the tip: /init first where there is no AGENTS.md, one of the others elsewhere, none when AGENTIC_TIPS=off', () => {
  const was = process.env.AGENTIC_TIPS;
  try {
    delete process.env.AGENTIC_TIPS;
    expect(startTip({ notes: ['memory'] })).toBe(INIT_TIP);
    expect(TIPS).toContain(startTip({ notes: ['AGENTS.md'] }));
    process.env.AGENTIC_TIPS = 'off';
    expect(tipsOn()).toBe(false);
    expect(startTip({ notes: ['AGENTS.md'] })).toBe(null);
  } finally { if (was === undefined) delete process.env.AGENTIC_TIPS; else process.env.AGENTIC_TIPS = was; }
});

test('the safety check in the same columns: nothing read, the question, the answer marked', () => {
  for (const w of [80, 107]) {
    const lines = draw(h(TrustPage, { width: w, cwd: "~/Desktop/new-project", model: "Qwen3.5 9B", selected: 1 }), w);
    const text = lines.join('\n');
    for (const s of ['Quick safety check', 'Is this a folder you created or one you trust?', '  1. Yes, I trust this folder', '❯ 2. No, exit', 'not trusted yet', 'nothing read here yet', 'wakes up after you say yes']) expect(text).toContain(s);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(w);
  }
});

test('the real app: a tip under the prompt box until the first message, then "? for shortcuts"', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hello there.' }]);
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_TIPS: 'on' }, rows: 43, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Tip: /init writes an AGENTS.md' }, { sleep: 300 }, { snapshot: 'before' },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hello there.' }, { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'after' }, ...quit,
  ] });
  await fake.close();
  const before = r.snapshots.before.split('\n');
  const tip = before.findIndex((l) => l.includes('※ Tip: /init writes an AGENTS.md with notes about this project')); // the demo project has no AGENTS.md
  expect(tip).toBeGreaterThan(before.findLastIndex((l) => l.startsWith('╰'))); // under the prompt box
  expect(r.snapshots.before).toContain('Welcome!');
  expect(r.snapshots.before).toContain('Recent activity');
  expect(r.snapshots.after).not.toContain('※ Tip:');
}, T);

test('a narrow window cuts a long tip, never the memory beside it', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_TIPS: 'on' }, cols: 80, rows: 24, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: 'Tip: /init' }, { sleep: 400 }, { snapshot: 'narrow' }, { key: 'shiftTab' }, { sleep: 400 }, { snapshot: 'mode' }, ...quit] });
  await fake.close();
  for (const k of ['narrow', 'mode']) {
    const footer = r.snapshots[k].split('\n').find((l) => l.includes('※ Tip:'));
    expect(footer).toMatch(/…\s{2,}● Mac \d+\.\d\/\d+ GB/); // the tip ends in …, two spaces, then the memory whole
    expect(footer.trimEnd().length).toBeLessThanOrEqual(80);
  }
  expect(r.snapshots.mode).toContain('accept edits on');
}, T);

test('a panel opened while the model loads prints the page out of its way: whole, once, above the Starting line', async () => {
  const { ENGINE, MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs'); // inside the test: an early import would fix HOME for later files
  const D = MODELS[DEFAULT_MODEL]; // the stand-in plays the default model
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_LOAD_MS: '9000' }, rows: 30, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: 'loading · ctrl+t stop', ms: 30_000 }, { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 300 }, { snapshot: 'panel' },
    { key: 'esc' }, { wait: `Starting ${D.name}` }, { sleep: 300 }, { snapshot: 'closed' },
    ...quit,
  ] });
  expect(r.snapshots.panel).toContain('Effort and limits');
  expect(r.snapshots.closed).toContain(`Starting ${D.name}…`); // the old line carries the loading now
  expect(r.text.match(/Recent activity/g)).toHaveLength(1); // the page was printed once, whole
}, 120_000);

