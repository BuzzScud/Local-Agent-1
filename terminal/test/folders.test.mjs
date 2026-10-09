// Folders (9 Oct 2026): each stretch of steps between the model's words is one box (rail.jsx groupWork), its
// row in the top edge with a small title for its main task, in that task's colour (groupTask, GroupBox);
// closed it keeps your answers and its newest failure in sight; a click or ctrl+o opens it, and the window
// is printed again with it open; the boxes you opened are kept with the conversation; /steps grouped · open ·
// words. The other app tests run with AGENTIC_STEPS=open (pty.mjs); the last test here drives the boxes.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { readFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupWork, groupFacts, groupTask, groupLine, stepsOf, TASKS } from '../src/app/rail.jsx';
import { ItemFrame, primeRows, printedAt, stepGroups } from '../src/app/screen.jsx';
import { runInPty } from './pty.mjs';
import { setup, quit } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';
import { MOUSE_ON, MOUSE_OFF, REST_MS } from '../src/app/mouse.mjs';

const h = React.createElement;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const draw = (it, width = 135) => strip(renderToString(h(ItemFrame, { it, width, model: 'm', cwd: '~/p', loaded: '', start: {} }), { columns: width })).split('\n');
let n = 0;
const k = () => `i${++n}`;
const think = (text) => ({ key: k(), rail: true, type: 'thinking', text, secs: 1 });
const read = (path) => ({ key: k(), rail: true, type: 'tool', label: 'Read', arg: path, view: { kind: 'read', lines: 10, total: 10 } });
const bash = (cmd, code = 0, lines = []) => ({ key: k(), rail: true, type: 'tool', label: 'Bash', arg: cmd, view: { kind: 'bash', code, lines, ms: 5 } });
const diff = (path, a, r) => ({ key: k(), rail: true, type: 'tool', label: 'Update', arg: path, view: { kind: 'diff', path, additions: a, removals: r, hunk: [{ type: '+', newNo: 1, text: 'x' }] } });
const say = (text) => ({ key: k(), rail: true, type: 'text', text });
const ask = (q, a) => ({ key: k(), rail: true, type: 'tool', label: 'Ask', arg: q, view: { kind: 'answer', question: q, text: a } });

test('a stretch of steps between the model’s words is one box; one step stays a step; its sentences lose their empty rows', () => {
  const items = [say('Looking.'), think('a'), read('a.mjs'), bash('bun run test ./t.test.mjs', 1, [' 3 pass', ' 1 fail']), say('One fails.'), read('b.mjs'), say('Done.')];
  const { printed, held } = groupWork(items);
  expect(printed.map((it) => it.type)).toEqual(['text', 'group', 'text', 'tool', 'text']);
  expect(held).toBeNull();
  expect(printed[0].tight && printed[0].key.endsWith(':t')).toBe(true);
  expect(printed[1].list).toHaveLength(3);
  // while it works, the stretch at the end is held for the live area
  const live = groupWork([say('Go.'), think('x'), read('c.mjs')], { working: true });
  expect(live.printed.map((it) => it.type)).toEqual(['text']);
  expect(live.held).toHaveLength(2);
  // an id from the first step, the same after /resume's new keys; opened, its key says so
  const again = groupWork(items.map((it) => ({ ...it, key: `r${it.key}` })), { open: new Set([printed[1].id]) });
  expect(again.printed[1].id).toBe(printed[1].id);
  expect(again.printed[1].open).toBe(true);
  expect(again.printed[1].key).toBe(`${printed[1].id}:open`);
  expect(stepsOf('words')).toBe('words');
  expect(stepsOf('nonsense')).toBe('grouped');
});

test('what a box was about: tests, edits, commands, the web, reads, thoughts, a question to you', () => {
  expect(groupTask([think('a'), bash('bun run test x'), bash('grep -E "pass|fail" /tmp/t.log')])).toBe('testing');
  expect(groupTask([diff('a.mjs', 3, 1), diff('b.mjs', 1, 0), read('a.mjs')])).toBe('editing');
  expect(groupTask([bash('ls -la'), bash('git status'), read('x')])).toBe('running');
  expect(groupTask([read('a'), read('b'), think('x')])).toBe('exploring');
  expect(groupTask([think('a'), think('b')])).toBe('thinking');
  expect(groupTask([think('a'), ask('Which?', 'This one')])).toBe('asking');
  expect(groupTask([{ key: k(), rail: true, type: 'tool', label: 'WebSearch', arg: 'x', view: { kind: 'websearch', count: 3 } }, think('a')])).toBe('research');
  const f = groupFacts([think('a'), diff('src/a.mjs', 4, 2), bash('bun run test', 1, [' 3 pass', ' 1 fail']), bash('false', 2), ask('Go on?', 'Yes')]);
  expect(f).toMatchObject({ steps: 4, commands: 2, thoughts: 1, task: 'testing' });
  expect(f.test).toEqual({ words: '3 pass · 1 fail', bad: true });
  expect(f.files).toEqual([{ path: 'src/a.mjs', a: 4, r: 2, created: false }]);
  expect(f.failures).toHaveLength(2);
  for (const t of Object.values(TASKS)) for (const c of [t.title, t.edge]) expect([114, 71, 65, 120, 157, 194, 22]).not.toContain(Number(/\((\d+)\)/.exec(c)[1]));
});

// 9 Oct 2026, the owner: "i dont really like the purple and orange" → "3 · Nord".
test('the box colours: Nord by their numbers, no purple or orange in any box', () => {
  const n = (c) => Number(/\((\d+)\)/.exec(c)[1]);
  expect(Object.fromEntries(Object.entries(TASKS).map(([k, t]) => [k, [n(t.title), n(t.edge)]]))).toEqual({
    testing: [222, 101], editing: [117, 31], running: [109, 66], research: [253, 243], exploring: [110, 60], thinking: [245, 239], asking: [174, 95],
  });
  // an xterm-256 colour's hue; purple 250°–330°, orange 15°–39° (gold, 40° and up, is not)
  const hue = (i) => {
    if (i >= 232) return null;
    const v = [0, 95, 135, 175, 215, 255], c = i - 16, [r, g, b] = [v[Math.floor(c / 36)], v[Math.floor(c / 6) % 6], v[c % 6]];
    const hi = Math.max(r, g, b), d = hi - Math.min(r, g, b);
    if (!d) return null;
    const h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (const t of Object.values(TASKS)) for (const c of [t.title, t.edge]) {
    const h = hue(n(c));
    if (h != null) expect(h >= 250 && h <= 330).toBe(false), expect(h >= 15 && h < 40).toBe(false);
  }
});

test('the box: its title and row in the top edge, your answer and the newest failure inside, its steps when open, every row the box’s width', () => {
  const list = [think('a'), diff('src/a.mjs', 4, 2), bash('bun run test ./x.test.mjs', 1, [' 3 pass', ' 1 fail']), bash('false', 2), ask('Go on?', 'Yes')];
  const { printed } = groupWork([say('Hi.'), ...list, say('Bye.')]);
  const g = printed[1];
  for (const width of [135, 80]) {
    const closed = draw(g, width);
    expect(closed[0]).toMatch(/^ {2}╭─ TESTING ─ ▸ 4 steps · changed 1 file · ran 2 commands · 3 pass · 1 fail/);
    expect(closed[0]).toEndWith('╮');
    expect(closed.at(-1)).toBe(`  ╰${'─'.repeat(width - 6)}╯`);
    for (const l of closed) expect(l.length).toBe(width - 2);
    expect(closed.join('\n')).toContain('? Go on? → Yes');
    expect(closed.join('\n')).toMatch(/✗ Ran {2}false · exit 2 {2}· 1 more failed/);
    const open = draw({ ...g, open: true, key: `${g.id}:open` }, width);
    expect(open[0]).toContain('▾ 4 steps');
    expect(open.join('\n')).toContain('Changed');
    for (const l of open) expect(l.length).toBeLessThanOrEqual(width - 2);
  }
  expect(groupLine(list)).toMatch(/^TESTING · 4 steps · changed 1 file/);
  // a box with nothing to keep in sight is two rows
  expect(draw(groupWork([say('a'), think('x'), read('y.mjs'), say('b')]).printed[1])).toHaveLength(2);
});

test('a click finds the printed box by its rows up from the live part; ctrl+o’s list holds the boxes', () => {
  const items = [say('One.'), think('a'), read('a.mjs'), say('Two.'), think('b'), bash('ls'), say('Three.')];
  const view = { steps: 'grouped', open: new Set() };
  const ctx = { width: 120, modelName: 'm', cwdShort: '~/p', loaded: '', start: {}, view };
  primeRows(items, ctx);
  // from the bottom: "Three." (1 row), the second box (2 rows), "Two.", the first box, "One."
  expect(printedAt(items, ctx, false, 1).it.type).toBe('text');
  const hit = printedAt(items, ctx, false, 2);
  expect(hit.it.type).toBe('group');
  expect(hit.row).toBe(1); // its bottom edge
  expect(printedAt(items, ctx, false, 3)).toMatchObject({ row: 0 });
  expect(printedAt(items, ctx, false, 99)).toBeNull();
  expect(stepGroups(items, view).map((g) => g.list.length)).toEqual([2, 2]);
});

test('the real window: a reply’s steps in a box; the pointer resting on it keeps the mouse, a click opens it, ctrl+o closes it; resting on the reply’s words gives Terminal the mouse; /steps open shows every step, kept', async () => {
  const { ENGINE, MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs'); // inside the test: an early import would fix HOME for later files
  const D = MODELS[DEFAULT_MODEL];
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  mkdirSync(join(home, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(home, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(home, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(home, 'models', D.file), 'stand-in');
  const fake = await startFakeServer([
    { reasoning: 'I will read the export first to see how it builds its rows.', tool: { name: 'Read', args: { path: 'export.mjs' } } },
    { reasoning: 'Now the folder, to find its tests.', tool: { name: 'List', args: { path: '.' } } },
    { text: 'It turns trades into CSV rows.' },
  ]);
  let boxRow = null;
  const seen = {};
  const mouseNow = (name) => ({ fn: ({ raw }) => { seen[name] = raw().lastIndexOf(MOUSE_ON) > raw().lastIndexOf(MOUSE_OFF) ? 'app' : 'Terminal'; } });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_STEPS: '' }, args: ['--url', fake.url, '--no-flows'], cols: 120, rows: 40, timeoutMs: 90_000, steps: [
    { wait: '? for shortcuts' }, { sleep: 300 },
    { type: 'what does this project do?' }, { key: 'enter' }, { wait: 'It turns trades into CSV rows.', ms: 30_000 }, { sleep: 800 }, { snapshot: 'closed' },
    { fn: ({ text, write }) => {
      // the screen text is the whole buffer; the window is its last 40 rows (Terminal counts them from 1)
      const lines = text.split('\n');
      const at = lines.findIndex((l) => l.includes('╭─ EXPLORING'));
      boxRow = at < 0 ? -1 : at - (lines.length - 40);
      if (boxRow >= 0) write(`\x1b[<35;20;${boxRow + 1}M`); // the pointer resting on the box first (9 Oct 2026)
    } },
    { sleep: REST_MS + 350 }, mouseNow('onBox'),
    { fn: ({ write }) => { if (boxRow >= 0) write(`\x1b[<0;20;${boxRow + 1}M`); } },
    { sleep: 150 }, { fn: ({ write }) => { if (boxRow >= 0) write(`\x1b[<0;20;${boxRow + 1}m`); } },
    { wait: '▾ 3 steps', ms: 10_000 }, { sleep: 500 }, { snapshot: 'opened' },
    { key: 'ctrlO' }, { wait: 'Open or close a group of steps' }, { snapshot: 'list' }, { key: 'enter' }, { waitGone: '▾ 3 steps', ms: 10_000 }, { sleep: 500 }, { snapshot: 'shut' },
    // resting on the reply's own words: Terminal's, for its own highlight; typing takes it back
    { fn: ({ text, write }) => {
      const lines = text.split('\n');
      const at = lines.findLastIndex((l) => l.includes('It turns trades into CSV rows.'));
      write(`\x1b[<35;10;${at - (lines.length - 40) + 1}M`);
    } },
    { sleep: REST_MS + 350 }, mouseNow('onWords'),
    { type: '/steps open' }, { sleep: 200 }, { key: 'enter' }, { wait: 'Open: every step' }, { sleep: 800 }, { snapshot: 'open' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.closed).toMatch(/╭─ EXPLORING ─ ▸ 3 steps · read 3 · 2 thoughts/);
  expect(r.snapshots.closed).not.toContain('I will read the export first');
  expect(boxRow).toBeGreaterThan(0);
  expect(seen.onBox).toBe('app');
  expect(seen.onWords).toBe('Terminal');
  expect(r.snapshots.opened).toContain('I will read the export first'); // the thought, inside the open box
  expect(r.snapshots.list).toMatch(/EXPLORING · 3 steps/);
  expect(r.snapshots.shut).toContain('▸ 3 steps');
  expect(r.snapshots.open).not.toContain('╭─ EXPLORING');
  expect(r.snapshots.open).toContain('I will read the export first');
  expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).steps).toBe('open');
}, 120_000);
