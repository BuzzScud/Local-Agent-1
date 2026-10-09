// The start page (home-looks.jsx, 8 Oct 2026): the Menu, one list of the conversations and what you can do,
// and the Launcher before it (start.jsx), picked with /home. The Menu fills its room and never more, keeps
// its items in place between the model's states, and is worked from the keyboard (tab, the arrows, enter,
// esc) and the mouse (homeItems). The app tests run with the Launcher (pty.mjs); these set the Menu.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HomePage, homeItems, homeNav, itemAt, actionsOf, HOME_LOOKS, lookOf, nextLook } from '../src/app/home-looks.jsx';
import { StartPage, recentRows } from '../src/app/start.jsx';
import { runInPty } from './pty.mjs';
import { setup, quit } from './app-setup.mjs';

const h = React.createElement;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const draw = (props, cols) => strip(renderToString(h(HomePage, props), { columns: cols })).split('\n');
const NOW = new Date(2026, 9, 8, 19, 42).getTime();
const at = (hours) => new Date(NOW - hours * 3600e3).toISOString();
const START = {
  model: 'Qwen3.6 35B', effort: 'high', ctx: 65536, cwd: '~/Desktop/trades-export', git: 'branch main, 2 changed files', notes: ['AGENTS.md', 'memory'],
  mode: 'manual', now: NOW, took: 18, typical: 21,
  recent: [
    { id: 'a', title: 'Add a --since flag to export.mjs', updated: at(0.5), turns: 3 },
    { id: 'b', title: 'Why does toCsv drop the header?', updated: at(3), turns: 12 },
    { id: 'c', title: 'Write tests for the price rounding', updated: at(27), turns: 5 },
    { id: 'd', title: 'Let the CSV columns come from a JSON file', updated: at(50), turns: 31 },
    { id: 'e', title: 'git status', updated: at(75), turns: 1 },
    { id: 'f', title: 'Rename side to direction everywhere', updated: at(140), turns: 9 },
  ],
};
const LOADING = { phase: 'reading', secs: 12.4, left: { left: 9, done: 0.55, over: false } };
const SIZES = [[80, 4], [80, 9], [80, 13], [80, 17], [100, 24], [144, 33], [220, 60]];
const shape = (items) => items.map((it) => `${it.key}@${it.rects.map((r) => `${r.row}:${r.from}-${r.to}`).join(',')}`).join(' ');

test('/home names: the Menu first and by default; a number, an id or a name; alone it goes to the other one', () => {
  expect(HOME_LOOKS.map((l) => l.id)).toEqual(['menu', 'launcher']);
  expect(lookOf(undefined)).toBe('menu');
  expect(lookOf('2')).toBe('launcher');
  expect(lookOf(' Launcher ')).toBe('launcher');
  expect(lookOf('cockpit')).toBe('menu');
  expect([nextLook('menu'), nextLook('launcher')]).toEqual(['launcher', 'menu']);
});

test('the Launcher is the page as it was, letter for letter, and its conversations are its items', () => {
  const s = { ...START, look: 'launcher', room: 30 };
  expect(renderToString(h(HomePage, { start: s, width: 120 }), { columns: 120 })).toBe(renderToString(h(StartPage, { start: s, width: 120 }), { columns: 120 }));
  const items = homeItems(s, 120);
  expect(items.map((it) => it.id)).toEqual(recentRows(s, 120).map((r) => r.id)); // the rows a click on it opened before
  expect(items.length).toBeGreaterThan(2);
  expect(items.every((it) => it.kind === 'conv')).toBe(true);
});

test('what the page offers: a new conversation, the model on this Mac (start, starting, stop), the model list, the mode, all conversations, /init without AGENTS.md, settings, the Launcher', () => {
  expect(actionsOf({ ...START, off: true }).map((a) => a.id)).toEqual(['new', 'start', 'model', 'mode', 'resume', 'settings', 'look']);
  expect(actionsOf({ ...START, off: true }).find((a) => a.id === 'start').label).toBe('Start the model');
  expect(actionsOf(START, LOADING, 0).find((a) => a.id === 'start').label).toBe('Starting ◐ 12s');
  expect(actionsOf(START).find((a) => a.id === 'start').label).toBe('Stop the model');
  expect(actionsOf({ ...START, local: false }).map((a) => a.id)).not.toContain('start'); // a remote or --url: nothing to load here
  expect(actionsOf({ ...START, recent: [], notes: ['memory'] }).map((a) => a.id)).toEqual(['new', 'start', 'model', 'mode', 'init', 'settings', 'look']);
  expect(actionsOf({ ...START, mode: 'plan' }).find((a) => a.id === 'mode').label).toBe('Mode · plan');
});

test('the Menu fills its room exactly, never wider than the window, and its items stay put whatever the model is doing or which is picked', () => {
  for (const [w, room] of SIZES) {
    const s = { ...START, room };
    const items = homeItems(s, w);
    expect(items.length).toBeGreaterThanOrEqual(Math.min(room - 2, 9));
    const pages = [
      { start: s }, { start: { ...s, off: true } }, { start: s, loading: LOADING }, { start: s, walk: 7 },
      ...items.slice(0, 4).map((it) => ({ start: s, focus: it.key })),
    ];
    for (const p of pages) {
      const lines = draw({ width: w, ...p }, w);
      expect(lines).toHaveLength(room);
      for (const l of lines) expect([...l].length).toBeLessThanOrEqual(w);
    }
    expect(shape(homeItems({ ...s, off: true }, w))).toBe(shape(items));
    expect(new Set(items.map((it) => it.key)).size).toBe(items.length);
  }
  // a short window has no box: a conversation, then the actions, as many as fit
  expect(homeItems({ ...START, room: 6 }, 80).map((it) => it.key)).toEqual(['conv:a', 'act:new', 'act:start', 'act:model']);
  expect(draw({ start: { ...START, room: 30 }, width: 120 }, 120).join('\n')).toContain('╭');
});

test('every item is drawn where homeItems says, and a click there finds it', () => {
  for (const [w, room] of [[80, 9], [80, 17], [144, 33]]) {
    const s = { ...START, room };
    const lines = draw({ start: s, width: w }, w);
    const items = homeItems(s, w);
    for (const it of items) {
      const r = it.rects[0];
      const text = [...lines[r.row]].slice(r.from - 1, r.to).join('');
      const words = it.kind === 'conv' ? START.recent.find((c) => c.id === it.id).title : actionsOf(s).find((a) => a.id === it.id).label;
      expect(text).toContain(words.replace(/^git /, '').split(' ')[0]);
      expect(itemAt(items, r.row, Math.floor((r.from + r.to) / 2))?.key).toBe(it.key);
    }
    expect(itemAt(items, 0, 1)).toBeNull(); // the first row is the model's, not an item
  }
});

test('the keys: tab goes through every item in order, up and down move by row, and the picked one says what enter does', () => {
  const s = { ...START, room: 33 };
  const items = homeItems(s, 144);
  let k = items[0].key;
  const seen = [k];
  for (let i = 1; i < items.length; i++) { k = homeNav(items, k, 'next'); seen.push(k); }
  expect(seen).toEqual(items.map((it) => it.key));
  expect(homeNav(items, k, 'next')).toBe(items[0].key); // round again
  expect(homeNav(items, items[0].key, 'back')).toBe(items.at(-1).key);
  expect(homeNav(items, 'gone', 'down')).toBe(items[0].key);
  expect(homeNav(items, 'conv:a', 'down')).toBe('conv:b');
  expect(homeNav(items, 'conv:a', 'up')).toBe('conv:a'); // nothing above: it stays
  expect(homeNav(items, 'conv:f', 'down')).toBe('act:new');
  expect(homeNav(items, 'act:new', 'right')).toBe('act:new'); // one column
  const picked = draw({ start: s, width: 144, focus: 'conv:b' }, 144);
  expect(picked.find((l) => l.includes('Why does toCsv'))).toMatch(/❯ {2}2 {2}Why does toCsv/);
  expect(picked.at(-1)).toContain('↵ opens conversation 2 again: Why does toCsv drop the header?');
  expect(draw({ start: s, width: 144 }, 144).at(-1)).toContain('tab to pick from this page');
});

test('with no conversations the Menu says so, and its actions are still there', () => {
  const s = { ...START, room: 30, recent: [] };
  expect(draw({ start: s, width: 120 }, 120).join('\n')).toContain('No conversations here yet.');
  const items = homeItems(s, 120);
  expect(items.some((it) => it.kind === 'conv')).toBe(false);
  expect(items.map((it) => it.id)).toEqual(['new', 'start', 'model', 'mode', 'settings', 'look']);
});

test('the real window opens on the Menu: tab picks, the arrows move, enter does it, esc gives the keys back; /home switches to the Launcher and back, and is kept', async () => {
  const { ENGINE, MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs'); // inside the test: an early import would fix HOME for later files
  const D = MODELS[DEFAULT_MODEL];
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  const sessions = join(home, 'sessions', realpathSync(cwd).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100));
  mkdirSync(sessions, { recursive: true });
  for (const [id, title, hours] of [['s1', 'Add a --since flag to export.mjs', 1], ['s2', 'Why does toCsv drop the header?', 5]]) {
    writeFileSync(join(sessions, `${id}.json`), JSON.stringify({ id, title, updated: new Date(Date.now() - hours * 3600e3).toISOString(), messages: [{ role: 'user', content: title }, { role: 'assistant', content: `Answer to ${id}.` }] }));
  }
  // AGENTIC_HOME_LOOK empty: the window's own default (pty.mjs sets the Launcher for the other tests)
  const r = await runInPty({ cwd, env: { ...env, FAKE_LLAMA_LOAD_MS: '500', AGENTIC_HOME_LOOK: '' }, cols: 120, rows: 36, args: ['--no-flows'], timeoutMs: 90_000, steps: [
    { wait: 'tab to pick from this page', ms: 30_000 }, { waitGone: 'loading · ctrl+t stop', ms: 30_000 }, { sleep: 300 }, { snapshot: 'menu' },
    { key: 'tab' }, { wait: '↵ opens conversation 1 again' }, { snapshot: 'one' },
    { key: 'down' }, { wait: '↵ opens conversation 2 again' }, { snapshot: 'two' },
    { key: 'esc' }, { wait: 'tab to pick from this page' },
    { key: 'tab' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: 'down' }, { sleep: 100 }, { key: 'down' },
    { wait: '↵ switches to the next mode' }, { key: 'enter' }, { wait: 'Mode · accept edits' }, { snapshot: 'mode' },
    { type: '/home' }, { sleep: 200 }, { key: 'enter' }, { wait: 'Pick up where you left off' }, { sleep: 300 }, { snapshot: 'launcher' },
    { type: '/home' }, { sleep: 200 }, { key: 'enter' }, { wait: 'tab to pick from this page' }, { sleep: 300 },
    { key: 'tab' }, { wait: '↵ opens conversation 1 again' }, { key: 'enter' }, { wait: 'resumed: Add a --since flag' }, { sleep: 300 }, { snapshot: 'opened' },
    ...quit,
  ] });
  expect(r.snapshots.menu).toContain('PICK UP');
  expect(r.snapshots.menu).toContain('Stop the model');
  expect(r.snapshots.one).toMatch(/❯ {2}1 {2}Add a --since flag/);
  expect(r.snapshots.two).toMatch(/❯ {2}2 {2}Why does toCsv/);
  expect(r.snapshots.mode).toContain('accept edits on'); // the footer says it too
  expect(r.snapshots.launcher).not.toContain('PICK UP');
  expect(r.snapshots.opened).toContain('resumed: Add a --since flag to export.mjs'); // as /resume 1 opens it
  expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).homeLook).toBe('menu');
}, 120_000);
