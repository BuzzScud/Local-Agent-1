// The start page (start.jsx): since 7 Oct 2026 the Launcher, a centred column (the bot walking
// like Pac-Man when there is room, the name in block letters, the model loading in place, the
// conversations to pick up, the keys to start something new); and the safety check in two columns.
// Also where to start (start-folder.mjs): typed in the home folder, which folder to work in.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
const h = React.createElement;
import { StartPage, TrustPage, FolderPage, folderCard, botPixels, botRows, botCells, botGlyph, greyOf, nameOf, BOT_STRIP_ROW, ago, titleOf, recentOf, gitWords, notesWords, startTip, tipsOn, TIPS, INIT_TIP, subjectOf, headline, recentRows, tidySubject, walkCells, blockWord, launcherPad } from '../src/app/start.jsx';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { setup, T, quit, quitTyped as quitTypedSteps } from './app-setup.mjs';
import { HUE } from '../src/ui/theme.mjs';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFolders, folderOption, folderFacts } from '../src/app/start-folder.mjs';
import { C } from '../src/ui/theme.mjs';

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

test('the Launcher: the greeting, the name in block letters, the model, this folder in a line; the conversations to pick up, the keys to start something new', () => {
  const lines = draw(h(StartPage, { start: START, width: 107 }), 107);
  const text = lines.join('\n');
  for (const s of ['Welcome back!', blockWord('AGENTIC')[0], blockWord('CODER')[1], 'Qwen3.5 9B', '● ready · effort high · 64k context', 'no git here  ·  reads AGENTS.md + memory',
    'Pick up where you left off', ' 1  1h ago', ' 2  6h ago', ' 3  1d ago', '1 prompt', 'click one, or /resume 2', 'Or start something new', '↵  type in the box below and press enter',
    '@ a file   ! a command   / every command   shift+tab switch mode   esc esc rewind']) expect(text).toContain(s);
  const turns = draw(h(StartPage, { start: { ...START, recent: [{ ...START.recent[0], turns: 4 }] }, width: 107 }), 107).join('\n');
  expect(turns).toContain('4 prompts'); // how many prompts each one had
  expect(text.match(/In-app notification card/g)).toHaveLength(1); // the same prompt run again shows once, by its subject
  expect(text).toContain('Small weather widget for a city');
  expect(text).toContain('w01 · Fix a futures roll that stays'); // one line, the separator run gone
  expect(text).not.toContain('╭'); // no box
  // a centred column: the conversations start at its left edge
  expect(lines.find((l) => l.includes('1h ago')).indexOf(' 1  1h ago')).toBe(launcherPad(107));
  const also = draw(h(StartPage, { start: { ...START, also: ['folder settings (model)', 'starts in auto-edit (/permissions)'] }, width: 107 }), 107).join('\n');
  expect(also).toContain('starts in auto-edit (/permissions)'); // what this folder changes at the start
  expect(also).toContain('folder settings (model)');
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(107);
  // the bot in the middle above it all when the window has the rows; in a short one the name says it in words
  const tall = draw(h(StartPage, { start: { ...START, room: 40 }, width: 107 }), 107);
  expect(tall.findIndex((l) => l.includes('▄▄            ▄▄'))).toBeLessThan(tall.findIndex((l) => l.includes('Welcome back!')));
  expect(text).not.toContain('▄▄            ▄▄');
  const narrow = draw(h(StartPage, { start: { ...START, room: 12 }, width: 80 }), 80).join('\n');
  expect(narrow).toContain('Agentic Coder v');
  expect(narrow).not.toContain(blockWord('AGENTIC')[0]);
});

test('loading and ready take the same rows, so nothing moves when the page is printed', () => {
  for (const w of [80, 107, 155]) for (const room of [22, 40]) {
    const ready = draw(h(StartPage, { start: { ...START, room }, width: w }), w);
    const loading = draw(h(StartPage, { start: { ...START, room }, width: w, loading: { phase: 'reading', secs: 12.4 } }), w);
    expect(loading.length).toBe(ready.length);
    expect(loading.findIndex((l) => l.includes('Pick up where'))).toBe(ready.findIndex((l) => l.includes('Pick up where')));
    // the start's steps beside the model's name: done, now (with its seconds), still to come
    expect(loading.join('\n')).toMatch(/✓ model ─ ◐ (instructions|reading) 12s ─ ○ ready/);
    const model = draw(h(StartPage, { start: { ...START, room }, width: w, loading: { phase: 'loading', secs: 3 } }), w).join('\n');
    expect(model).toMatch(/[◐◓◑◒] model 3s/);
    expect(model).toContain('○ ready');
    const gemma = draw(h(StartPage, { start: { ...START, room, model: 'Gemma 4 12B QAT' }, width: w, loading: { phase: 'reading', secs: 12.4 } }), w).join('\n');
    expect(gemma).toContain('Gemma 4 12B QAT');
    for (const l of [...ready, ...loading]) expect(l.length).toBeLessThanOrEqual(w);
  }
});

test('the bot walks like Pac-Man: across the window and back in at the left edge, eating the dots in front of it, which come back on a new lap', () => {
  const W = 60;
  const cells = botCells('ready');
  const dots = (lines) => lines[4].map((c, x) => (c.ch === '·' ? x : null)).filter((x) => x != null);
  const at0 = walkCells(cells, 0, W); // it sets off from the middle, where it stood
  expect(at0[0].slice(19, 41).map((c) => c.ch)).toEqual(cells[0].map((c) => c.ch));
  expect(dots(at0).every((x) => x > 40 && x % 3 === 1)).toBe(true); // only ahead of it
  expect(dots(at0).length).toBe(6);
  const at10 = walkCells(cells, 10, W); // 20 cells on, at the right edge: every dot it went over is eaten
  expect(dots(at10)).toEqual([]);
  const wrapped = walkCells(cells, 20, W); // at the right edge: what is past it shows at the left
  expect(wrapped[0][59].ch).toBe(cells[0][0].ch);
  expect(wrapped[0].slice(0, 21).map((c) => c.ch)).toEqual(cells[0].slice(1).map((c) => c.ch));
  const lap = walkCells(cells, 25, W); // a new lap: every dot ahead of it again
  expect(dots(lap).length).toBeGreaterThan(dots(at10).length);
  for (const line of [...at0, ...wrapped, ...lap]) expect(line).toHaveLength(W);
  // on the page: it moves with the step, and stands in the middle while the model loads or is off
  const page = (walk, extra = {}) => renderToString(h(StartPage, { start: { ...START, room: 40, ...extra }, width: 107, walk }), { columns: 107 });
  expect(page(1)).not.toBe(page(2));
  expect(strip(page(1))).toContain('·  ·');
  expect(strip(page(1, { off: true }))).toBe(strip(page(null, { off: true })));
});

test('a first prompt in capitals reads in sentence case; one that is a shell command shows as one', () => {
  expect(tidySubject('CAN YOU HELP ME INPROVE THIS PROGRAM ? THE AGENTIC CODER TERMINAL?')).toBe('Can you help me inprove this program ? the agentic coder terminal?');
  expect(tidySubject('HELLO')).toBe('Hello');
  expect(tidySubject('I NEED HELP WITH THIS')).toBe('I need help with this');
  expect(tidySubject("Rsync -a --delete --exclude '.git' src/ dst/")).toBe("$ rsync -a --delete --exclude '.git' src/ dst/");
  for (const t of ['notes.html that works', 'Fix the API', 'Small weather widget for a city']) expect(tidySubject(t)).toBe(t);
});

test('the bot sleeps while the model is off, looks about while it loads, and is happy when ready', () => {
  // Its eyes: the light (the app's blue, ui/theme.mjs HUE) on the glass in its face (rows 4–9); the chest strip is row 15.
  const { deep, dim, bright, light, lighter, accent } = HUE;
  const eyes = (state, k) => botPixels(state, k).flatMap((row, y) => row.map((c, x) => (y >= 4 && y <= 9 && x >= 4 && x <= 17 && [deep, dim, bright, light, lighter].includes(c) ? `${x},${y}:${c}` : null))).filter(Boolean);
  const strip = (state, k) => botPixels(state, k)[BOT_STRIP_ROW].slice(7, 15);
  expect(eyes('off')).toEqual([6, 7, 8, 13, 14, 15].map((x) => `${x},7:${deep}`)); // – –
  expect(botPixels('off')[0][18]).toBe(243); // and a Z
  expect(eyes('trust')).toContain(`13,6:${dim}`); // one eye open at the safety check
  expect(eyes('ready')).toEqual(['7,6', '8,6', '13,6', '14,6', '6,7', '9,7', '12,7', '15,7'].map((p) => `${p}:${light}`)); // ^ ^
  expect(strip('off', 0).every((c) => c === 236)).toBe(true);
  expect(strip('ready', 0).every((c) => c === accent)).toBe(true);
  expect(strip('loading', 3).filter((c) => c === bright)).toHaveLength(3); // it fills while it loads
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
  const eyes = (state, look) => botPixels(state, 0, look).flatMap((row, y) => row.map((c, x) => (y >= 4 && y <= 9 && x >= 4 && x <= 17 && [HUE.bright, HUE.light, HUE.lighter].includes(c) ? `${x},${y}` : null))).filter(Boolean);
  expect(eyes('ready', 0.1)).toEqual(['6,8', '7,8', '12,8', '13,8', '6,9', '7,9', '12,9', '13,9']); // down and to the left
  expect(eyes('ready', 0.9)).toEqual(['8,8', '9,8', '14,8', '15,8', '8,9', '9,9', '14,9', '15,9']); // down and to the right
  expect(eyes('loading', 0.5)).toEqual(eyes('ready', 0.5).map((e) => e)); // loading too
  expect(botPixels('off', 0, 0.5)).toEqual(botPixels('off', 0)); // asleep, it does not look
  const page = (typing) => renderToString(h(StartPage, { start: { ...START, room: 40 }, width: 107, typing }), { columns: 107 }); // a page with room for the bot
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

const FOLDERS = [
  { shown: '~', what: 'your home folder', good: 'general questions, Desktop files', convs: 8, last: at(1), trusted: true },
  { shown: '~/agentic-coder', what: 'Agentic Coder', good: 'its code, tests and docs', convs: 0, last: null, trusted: false },
];
test('where to start in the same columns: each folder a card, the one picked lit, both columns ending together, nothing past the edge', () => {
  for (const w of [80, 107]) {
    const lines = draw(h(FolderPage, { width: w, folders: FOLDERS, model: 'Qwen3.5 9B', selected: 0, now: NOW }), w);
    const text = lines.join('\n');
    for (const s of ['Where should it work?', 'so it asks which one first', 'general questions, Desktop files', 'its code, tests and docs', '8 conversations', '✓ trusted', 'no conversations yet', 'safety check next', 'wakes up where you pick', '↑↓ choose   enter start here   esc exit']) expect(text).toContain(s);
    expect(text).toMatch(/│ ❯ 1  ~ +your home folder │/);
    expect(text).toMatch(/│   2  ~\/agentic-coder +Agentic Coder │/);
    expect(text).not.toContain('started ~'); // the old line that repeated the first folder
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(w);
    // the right column ends on the bot side's last row: the model's state line, or the row under it
    const keys = lines.findIndex((l) => l.includes('↑↓ choose')), state = lines.findIndex((l) => l.includes('wakes up where you pick'));
    expect(keys - state).toBeGreaterThanOrEqual(0);
    expect(keys - state).toBeLessThanOrEqual(1);
  }
  expect(draw(h(FolderPage, { width: 107, folders: FOLDERS, model: 'Qwen3.5 9B', now: NOW }), 107).join('\n')).toContain('8 conversations · last 1h ago'); // when it fits
  // the card picked has its border in the choice colour (C.ask), the other a dark one
  expect(folderCard(FOLDERS[0], 0, true, 60, NOW)[0].props.color).toBe(C.ask);
  expect(folderCard(FOLDERS[1], 1, false, 60, NOW)[0].props.color).not.toBe(C.ask);
});

test('a folder\'s card says what the app already knows: its conversations, the last one\'s time, and whether a yes covers it', () => {
  const sessions = (p) => (p === '/h' ? [{ updated: at(1) }, { updated: at(30) }] : []);
  const trusted = (p) => p === '/h';
  expect(folderFacts({ path: '/h', shown: '~' }, { sessions, trusted })).toEqual({ path: '/h', shown: '~', convs: 2, last: at(1), trusted: true });
  expect(folderFacts({ path: '/h/x', shown: '~/x' }, { sessions, trusted })).toEqual({ path: '/h/x', shown: '~/x', convs: 0, last: null, trusted: false });
});

test('where to start is asked only in the home folder, with Agentic Coder\'s folder found; not elsewhere, and not when continuing', () => {
  const base = mkdtempSync(join(tmpdir(), 'agentic-start-folder-')); // under a link on macOS (/var is /private/var)
  const home = join(base, 'home'), repo = join(home, 'agentic-coder'), other = join(home, 'project');
  mkdirSync(repo, { recursive: true });
  mkdirSync(other);
  // A Terminal's folder is the real path: still the home folder, offered as spelled so it shows under ~.
  const offered = startFolders({ cwd: realpathSync(home) }, { home, repo });
  expect(offered.map(folderOption)).toEqual(['~ · your home folder', '~/agentic-coder · Agentic Coder']);
  expect(offered.map((f) => f.path)).toEqual([home, repo]);
  for (const o of [{ cwd: other }, { cwd: repo }, { cwd: home, continueLast: true }, { cwd: home, resumeId: 'abc' }, { cwd: home, folder: true }]) expect(startFolders(o, { home, repo })).toBe(null);
  expect(startFolders({ cwd: home }, { home, repo: null })).toBe(null); // no repo found: nothing to pick between
  expect(startFolders({ cwd: home }, { home, repo: home })).toBe(null);
  expect(startFolders({ cwd: home }, { home, repo: '/opt/agentic-coder' }).map(folderOption)[1]).toBe('/opt/agentic-coder · Agentic Coder');
});

test('the real app: the tip on the page under Try until the first message, the footer "? for shortcuts"', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Hello there.' }]);
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_TIPS: 'on' }, rows: 43, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'Tip  /init writes an AGENTS.md' }, { sleep: 300 }, { snapshot: 'before' },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hello there.' }, { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'after' }, ...quit,
  ] });
  await fake.close();
  const before = r.snapshots.before.split('\n');
  const tip = before.findIndex((l) => l.includes('Tip  /init writes an AGENTS.md with notes about this project')); // the demo project has no AGENTS.md
  expect(tip).toBeGreaterThan(before.findIndex((l) => l.includes('@ a file   ! a command'))); // on the page, under the keys
  expect(tip).toBeLessThan(before.findIndex((l) => l.startsWith('╭'))); // above the prompt box
  expect(before.find((l) => l.includes('for shortcuts'))).toBeTruthy(); // the footer is free for the model and the mode
  expect(r.snapshots.before).not.toContain('※ Tip:');
  expect(r.snapshots.before).toContain('Welcome!');
  expect(r.snapshots.before).toContain('Pick up where you left off');
  expect(r.snapshots.after.split('\n').find((l) => l.includes('for shortcuts'))).toBeTruthy(); // the page went up with your message; the footer never had the tip
  expect(r.snapshots.after).not.toContain('※ Tip:');
}, T);

// 80 × 24: the small page has no Try rows, so the tip stays on the footer, cut there.
// A tip shows whole or not at all ("1 · Tidy", 9 Oct 2026: a cut tip read "ctrl+b sends this windo…"):
// in a window too narrow for it "? for shortcuts" stands in, and the memory beside it stays whole.
test('a narrow window leaves out a tip that does not fit whole, never the memory beside it; a wider one shows it whole', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const footerOf = (text) => text.split('\n').find((l) => l.includes('● Mac '));
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_TIPS: 'on' }, cols: 80, rows: 24, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: '● Mac ' }, { sleep: 400 }, { snapshot: 'narrow' }, { key: 'shiftTab' }, { wait: '⏵⏵ accept edits │' }, { sleep: 200 }, { snapshot: 'mode' }, ...quit] });
  const w = await runInPty({ cwd, env: { ...env, AGENTIC_TIPS: 'on' }, cols: 110, rows: 24, args: ['--url', fake.url, '--no-flows'], steps: [{ wait: 'Tip: /init' }, { sleep: 400 }, { snapshot: 'wide' }, ...quit] });
  await fake.close();
  for (const k of ['narrow', 'mode']) {
    const footer = footerOf(r.snapshots[k]);
    expect(footer).toMatch(/^│ \? for shortcuts\s{2,}● Mac \d+\.\d\/\d+ GB/); // no tip, the memory whole
    expect(footer).not.toContain('…');
    expect(footer.trimEnd().length).toBe(80);
  }
  expect(footerOf(w.snapshots.wide)).toContain('※ Tip: /init writes an AGENTS.md with notes about this project  ');
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
  expect(r.text.match(/Pick up where you left off/g)).toHaveLength(1); // the page was printed once, whole
}, 120_000);


test('the real app: the bot walks while the page waits, four steps a second; it stops the moment you type', async () => {
  const { ENGINE, MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs'); // inside the test: an early import would fix HOME for later files
  const D = MODELS[DEFAULT_MODEL];
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  const band = (t) => t.split('\n').slice(0, t.split('\n').findIndex((l) => l.includes('Welcome!'))).join('\n'); // the rows above the greeting
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_BOT_WALK: 'on' }, rows: 48, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: '● ready ·', ms: 60_000 }, { sleep: 700 }, { snapshot: 'a' }, { sleep: 700 }, { snapshot: 'b' },
    { type: 'x' }, { sleep: 400 }, { snapshot: 'c' }, { sleep: 800 }, { snapshot: 'd' },
    ...quitTypedSteps,
  ] });
  expect(band(r.snapshots.a)).toContain('·  ·'); // the dots in front of it
  expect(band(r.snapshots.a)).not.toBe(band(r.snapshots.b)); // it moved
  expect(band(r.snapshots.c)).toBe(band(r.snapshots.d)); // typing: it stands where it was
}, 120_000);

// The page keeps to the rows App gives it (start.room), the conversations numbered for /resume <n>.
const MANY = {
  ...START,
  recent: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, title: `fix bug number ${i} in the cart`, updated: at(i * 5 + 1), turns: 2 })),
  news: [
    { at: at(1), text: 'feat(loops): Steer a loop while it runs — a form for its rules, a note at its next step [skip ci]' },
    { at: at(3), text: 'fix(remote): A refused web fetch names WebFetch' },
    { at: at(9), text: 'feat(start): A click on a Recent activity row opens that conversation' },
  ],
  places: [{ folder: '~/Desktop/shop', convs: 3, updated: at(50) }, { folder: '~/Desktop', convs: 1, updated: at(240) }],
  folders: 4, memory: { you: 9, project: 0 }, running: [{ name: 'home-1', folder: '~' }], tip: INIT_TIP,
};

test('the page keeps to the rows it is given: never more, nothing past the edge, more conversations as it grows', () => {
  for (const [w, room] of [[152, 49], [152, 41], [120, 33], [120, 25], [100, 15], [80, 17], [80, 9], [80, 4]]) {
    const lines = draw(h(StartPage, { start: { ...MANY, room }, width: w }), w);
    expect(lines.length).toBeLessThanOrEqual(room);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(w);
    // loading takes the same rows as ready, so nothing moves when it is ready
    expect(draw(h(StartPage, { start: { ...MANY, room }, width: w, loading: { phase: 'loading', secs: 3 } }), w)).toHaveLength(lines.length);
  }
  // short of rows, the bot, the name, the newest change and the background go before the fourth
  // conversation does; given rows, it shows up to 8 (/resume lists the rest), with the bot over them
  const page = (room) => draw(h(StartPage, { start: { ...MANY, room }, width: 120 }), 120);
  const shown = (room) => page(room).filter((l) => / ago {2,3}Fix bug number/.test(l)).length;
  for (const room of [19, 25, 33]) expect(shown(room)).toBeGreaterThanOrEqual(4);
  expect(shown(49)).toBe(8);
  expect(page(49).join('\n')).toContain('▄▄            ▄▄');
  expect(page(19).join('\n')).not.toContain('Running in the background');
  expect(page(25).join('\n')).toContain('Running in the background');
});

test('the full page: numbered conversations, background sessions, the app\'s newest change, the tip', () => {
  const text = draw(h(StartPage, { start: { ...MANY, room: 49 }, width: 152 }), 152).join('\n');
  for (const s of [' 1  1h ago   Fix bug number 0 in the cart', 'click one, or /resume 2', '/resume lists all 30', 'Running in the background', 'coding attach <name>', 'home-1',
    'New in the app', 'Steer a loop while it runs', 'Tip  /init writes an AGENTS.md']) expect(text).toContain(s);
  expect(text).not.toContain('feat(loops)'); // a change by its headline
  expect(text).not.toContain('[skip ci]');
  const none = draw(h(StartPage, { start: { ...START, room: 49 }, width: 152 }), 152).join('\n');
  for (const s of ['Running in the background', 'New in the app', 'Tip ', '/resume lists all']) expect(none).not.toContain(s); // each only when it is there
});

test('a small window: the title, the model, the conversations, the keys', () => {
  const lines = draw(h(StartPage, { start: { ...MANY, room: 9 }, width: 80 }), 80);
  expect(lines).toHaveLength(9);
  expect(lines[0]).toMatch(/^── Agentic Coder/);
  expect(lines[1]).toContain('Qwen3.5 9B  ● ready');
  expect(lines[2]).toMatch(/^Recent activity\s+click one, or \/resume 2$/);
  expect(lines[3]).toMatch(/^ 1 {2}1h ago/);
  expect(lines.at(-1)).toContain('@ a file');
});

test('a subject without http:// and with a capital; a change by its headline', () => {
  expect(subjectOf({ title: 'analyze the link: http://example.com:60011/index.html / learn' })).toBe('Analyze the link: example.com:60011/index.html / learn');
  expect(subjectOf({ title: 'notes.html that works' })).toBe('notes.html that works');
  expect(headline('feat(loops): You can steer a loop while it runs — a form for its rules [skip ci]')).toBe('You can steer a loop while it runs');
});

test('recentRows finds each numbered row where it is drawn, on the full page and the small one', () => {
  for (const [w, room] of [[152, 41], [80, 9]]) {
    const start = { ...MANY, room };
    const lines = draw(h(StartPage, { start, width: w }), w);
    const rows = recentRows(start, w);
    expect(rows.length).toBeGreaterThan(2);
    rows.forEach((r, i) => {
      expect(r.id).toBe(`c${i}`);
      expect(lines[r.row].slice(r.from - 1)).toMatch(new RegExp(`^ ?${i + 1}  `));
    });
  }
});

test('the real app: /resume 2 opens the conversation the page numbers 2; the / menu takes rows from the page, which stays live', async () => {
  const { cwd, env, base } = setup();
  const slug = realpathSync(cwd).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100);
  const dir = join(base, 'home', 'sessions', slug);
  mkdirSync(dir, { recursive: true });
  const save = (id, title, answer, hours, before = [], after = []) => writeFileSync(join(dir, `${id}.json`), JSON.stringify({ title, messages: [{ role: 'system', content: 's' }, { role: 'user', content: title }, { role: 'assistant', content: answer }], items: [...before, { type: 'user', text: title }, ...after, { type: 'text', text: answer }], cwd, id, updated: new Date(Date.now() - hours * 3_600_000).toISOString() }));
  save('2026-10-04T10-00-00-000Z', 'the newest one', 'Newest answer.', 1);
  // saved by a window that was itself resumed: its own resume line and start note, and a note said twice
  const lean = "Lean harness: the app's checks, reminders and put-back are off (/hooks full brings them back).";
  save('2026-10-04T09-00-00-000Z', 'the one before', 'The answer before.', 2,
    [{ type: 'divider', text: 'resumed: the one before' }, { type: 'note', text: 'Started in bypass permissions, as the last window left it · shift+tab changes it', tone: 'warn' }],
    [{ type: 'note', text: lean, tone: 'dim' }, { type: 'note', text: lean, tone: 'dim' }]);
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, rows: 40, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: 'The one before' }, { sleep: 300 }, { snapshot: 'page' },
    { type: '/' }, { sleep: 500 }, { snapshot: 'menu' }, { key: 'backspace' }, { sleep: 300 },
    { type: '/resume 2' }, { key: 'enter' }, { wait: 'The answer before.' }, { sleep: 300 }, { snapshot: 'end' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.page).toMatch(/ 2 {2}2h ago {3}The one before/);
  expect(r.snapshots.menu).toContain('Welcome back!'); // the page is still there, above the menu
  expect(r.snapshots.menu).toContain('/resume');
  expect(r.snapshots.end).toContain('resumed: the one before');
  expect(r.snapshots.end).not.toContain('Newest answer.');
  // the earlier window's own lines are not shown again, and a note only once (7 Oct 2026)
  expect(r.snapshots.end.match(/resumed: the one before/g)).toHaveLength(1);
  expect(r.snapshots.end).not.toContain('Started in bypass permissions');
  expect(r.snapshots.end.match(/Lean harness: the app's checks/g)).toHaveLength(1);
}, T);
