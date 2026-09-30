// The start page (start.jsx): two columns under a titled line, the model loading in place, the
// tip under the prompt box until the first message, and the safety check in the same columns.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
const h = React.createElement;
import { StartPage, TrustPage, logoRows, ago, titleOf, recentOf, gitWords, notesWords, startTip, tipsOn, TIPS, INIT_TIP } from '../src/app/start.jsx';
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

test('the page: a titled line, the greeting, the model, the folder; recent activity and this folder beside them', () => {
  const lines = draw(h(StartPage, { start: START, width: 107 }), 107);
  expect(lines[0]).toMatch(/^── Agentic Coder v\d+\.\d+\.\d+ ─+$/);
  const text = lines.join('\n');
  for (const s of ['Welcome back!', 'Qwen3.5 9B · effort high · 64k', '~ · your home folder', 'Recent activity', '1h ago', '6h ago', '1d ago', '/resume for more', 'This folder', 'no git', 'reads AGENTS.md + memory']) expect(text).toContain(s);
  expect(text.match(/in-app notif/g)).toHaveLength(1); // the same prompt run again shows once
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
    expect(loading.join('\n')).toContain(w >= 100 ? 'Qwen3.5 9B · reading instructions · 12s' : 'Qwen3.5 9B · reading · 12s');
    // a long name gets the short words, never a cut line
    const gemma = draw(h(StartPage, { start: { ...START, model: 'Gemma 4 12B QAT' }, width: w, loading: { phase: 'reading', secs: 12.4 } }), w).join('\n');
    expect(gemma).toContain(w >= 100 ? 'Gemma 4 12B QAT · reading · 12s' : 'Gemma 4 12B QAT · reading 12s');
    expect(gemma).not.toContain('…│');
    for (const l of [...ready, ...loading]) expect(l.length).toBeLessThanOrEqual(w);
    // the left column never wraps: the rail between the columns is on every row but the title's two
    expect(ready.slice(2).every((l) => l.includes('│'))).toBe(true);
  }
});

test('the mark goes round while it loads, is all lit when ready, and off before the safety check\'s yes', () => {
  // The dots' colours, row by row, read from the drawing itself (the tests run without colour).
  const dots = (mode, k) => logoRows(mode, k).flatMap((row) => row.props.children.filter((c) => c?.props?.color).map((c) => Number(c.props.color.match(/\((\d+)\)/)[1])));
  expect(dots('lit')).toEqual([157, 157, 114, 114, 71, 71]);
  expect(dots('off')).toEqual([240, 240, 240, 240, 240, 240]);
  const a = dots('spin', 0);
  expect(a.filter((c) => c === 120)).toHaveLength(1); // one lit dot, one fading behind it
  expect(a.filter((c) => c === 71)).toHaveLength(1);
  expect(dots('spin', 1)).not.toEqual(a); // it moves on
  expect(dots('spin', 6)).toEqual(a); // round in six steps
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
    for (const s of ['Quick safety check', 'Is this a folder you created or one you trust?', '  1. Yes, I trust this folder', '❯ 2. No, exit', 'not trusted yet', 'nothing read here yet', 'loads after you say yes']) expect(text).toContain(s);
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
    { wait: ' · loading', ms: 30_000 }, { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 300 }, { snapshot: 'panel' },
    { key: 'esc' }, { wait: `Starting ${D.name}` }, { sleep: 300 }, { snapshot: 'closed' },
    ...quit,
  ] });
  expect(r.snapshots.panel).toContain('Effort and limits');
  expect(r.snapshots.closed).toContain(`Starting ${D.name}…`); // the old line carries the loading now
  expect(r.text.match(/Recent activity/g)).toHaveLength(1); // the page was printed once, whole
}, 120_000);

