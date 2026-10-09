// Steps grouped (9 Oct 2026): the steps between two things the model says are one stretch (rail.jsx
// groupWork); the model's short line and the stretch after it are one row, neighbouring rows of one kind of
// work one task row, the task rows of an answer one box with its totals on the bottom edge (task-rows.jsx,
// "3 · Task rows"). A command counts by what it does (commandKind). A click or ctrl+o opens a task row, then
// a row; the window is printed again with it open; what you opened is kept with the conversation; /steps
// grouped · open · words. The other app tests run with AGENTIC_STEPS=open (pty.mjs); the last test here
// drives the rows.
import { test, expect } from 'bun:test';
import React from 'react';
import { renderToString } from 'ink';
import { readFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldSteps, groupWork, groupFacts, groupTask, commandKind, stepsOf, TASKS } from '../src/app/rail.jsx';
import { taskRows, LiveRun } from '../src/app/task-rows.jsx';
import { ItemFrame, primeRows, printedAt, pieceAt, stepRuns } from '../src/app/screen.jsx';
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
const you = (text) => ({ key: k(), type: 'user', text });
const rowsOf = (items, opts = {}) => { const g = groupWork(foldSteps(items).printed, opts); return taskRows(g.printed, { held: g.held, working: Boolean(opts.working), open: opts.open }); };

test('a stretch of steps between the model’s words; one step stays a step; its sentences lose their empty rows', () => {
  const items = [say('Looking.'), think('a'), read('a.mjs'), bash('bun run test ./t.test.mjs', 1, [' 3 pass', ' 1 fail']), say('One fails.'), read('b.mjs'), say('Done.')];
  const { printed, held } = groupWork(items);
  expect(printed.map((it) => it.type)).toEqual(['text', 'group', 'text', 'tool', 'text']);
  expect(held).toBeNull();
  expect(printed[0].tight && printed[0].key.endsWith(':t')).toBe(true);
  expect(printed[1].list).toHaveLength(3);
  const live = groupWork([say('Go.'), think('x'), read('c.mjs')], { working: true });
  expect(live.printed.map((it) => it.type)).toEqual(['text']);
  expect(live.held).toHaveLength(2);
  expect(stepsOf('words')).toBe('words');
  expect(stepsOf('nonsense')).toBe('grouped');
});

// 9 Oct 2026 afternoon: every command was RUNNING, so a grep or a git log between two edits made a box of its own.
test('a command by what it does: tests, commits, edits, only looking, running something', () => {
  for (const [c, want] of [
    ['bun run test ./terminal/test/x.test.mjs', 'testing'], ['cd ~/w && bun run check --fast > /tmp/c.txt 2>&1; echo "exit $?"', 'testing'],
    ['sleep 115; grep -cE "^\\((pass|fail)\\)" /tmp/split/full-after.txt', 'testing'], ['pytest -q', 'testing'],
    ['git commit -q -F /tmp/msg.txt && git log --oneline -1', 'committing'], ['cd ~/w && git push origin main', 'committing'],
    ["sed -i '' '743,778d' App.jsx", 'editing'], ['cp a.mjs src/b.mjs', 'editing'], ['printf "x" > notes.md', 'editing'], ['git checkout -- a.mjs', 'editing'],
    ["sed -n '743,777p' App.jsx > /tmp/split/block.txt && wc -l < /tmp/split/block.txt", 'exploring'], ['cp App.jsx /tmp/split/App.before.jsx', 'running'],
    ['grep -nE "1[_,]?000|big file|lines" models/x.mjs | head', 'exploring'], ["awk 'NR>343' a.mjs | grep -nw lookFloor", 'exploring'],
    ['git status --short; git log -1 --format=%h', 'exploring'], ['find docs -iname "*structure*" | head; ls terminal/test', 'exploring'],
    ['for n in a b; do grep -c "$n" App.jsx; done', 'exploring'],
    ['bun build --target=bun terminal/src/cli.jsx --outdir /tmp/b', 'running'], ['curl -s http://localhost:8080/health', 'running'], ['bun scripts/x.mjs', 'running'],
  ]) expect([c, commandKind(c)]).toEqual([c, want]);
});

test('what a stretch was about: tests, a commit, edits, commands, the web, looks, thoughts, a question to you', () => {
  expect(groupTask([think('a'), bash('bun run test x'), bash('grep -E "pass|fail" /tmp/t.log')])).toBe('testing');
  expect(groupTask([bash('git add a.mjs'), bash('git commit -m x'), bash('git push')])).toBe('committing');
  expect(groupTask([diff('a.mjs', 3, 1), diff('b.mjs', 1, 0), read('a.mjs')])).toBe('editing');
  expect(groupTask([bash('bun build x'), bash('node script.mjs'), read('x')])).toBe('running');
  expect(groupTask([bash('ls -la'), bash('git status'), read('x')])).toBe('exploring');
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

// 9 Oct 2026, the owner: "i dont really like the purple and orange" → "3 · Nord"; a pale sea for a commit.
test('the task colours: Nord by their numbers, no purple, orange or green', () => {
  const num = (c) => Number(/\((\d+)\)/.exec(c)[1]);
  expect(Object.fromEntries(Object.entries(TASKS).map(([key, t]) => [key, [num(t.title), num(t.edge)]]))).toEqual({
    testing: [222, 101], committing: [152, 30], editing: [117, 31], running: [109, 66], research: [253, 243], exploring: [110, 60], thinking: [245, 239], asking: [174, 95],
  });
  // an xterm-256 colour's hue; purple 250°–330°, orange 15°–39° (gold, 40° and up, is not), green 70°–175°
  const hue = (i) => {
    if (i >= 232) return null;
    const v = [0, 95, 135, 175, 215, 255], c = i - 16, [r, g, b] = [v[Math.floor(c / 36)], v[Math.floor(c / 6) % 6], v[c % 6]];
    const hi = Math.max(r, g, b), d = hi - Math.min(r, g, b);
    if (!d) return null;
    const x = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (x * 60 + 360) % 360;
  };
  for (const t of Object.values(TASKS)) for (const c of [t.title, t.edge]) {
    const x = hue(num(c));
    if (x != null) expect([c, x >= 250 && x <= 330, x >= 15 && x < 40, x >= 70 && x <= 175]).toEqual([c, false, false, false]);
  }
});

test('task rows: a line and its steps are a row; looking joins what it was for; a long answer stays in the open; totals at the end', () => {
  const items = [
    you('split it'),
    say('Reading the file.'), think('a'), read('a.mjs'),
    say('Now the edit.'), diff('a.mjs', 3, 1), think('b'),
    say('Checking it.'), bash('grep -n x a.mjs'), think('c'),
    say('Tests now.'), bash('bun run test ./a.test.mjs', 0, [' 5 pass', ' 0 fail']), think('d'),
    say('The plan, in full:\n\n1. one\n2. two'),
    say('Saving it.'), bash('git commit -m x'), bash('git push'),
    say('Done: split and pushed.'),
  ];
  const { printed, held } = rowsOf(items);
  expect(held).toBeNull();
  expect(printed.map((it) => it.type)).toEqual(['user', 'taskrun', 'taskrun', 'taskend', 'text', 'taskrun', 'taskend', 'text']);
  const [, edit, test1] = printed;
  expect(edit.first).toBe(true);
  expect(edit.run.task).toBe('editing');
  expect(edit.run.rows.map((r) => r.text)).toEqual(['Reading the file.', 'Now the edit.']);
  // the grep after the edit is looking: it joins the test run after it
  expect(test1.run.task).toBe('testing');
  expect(test1.run.rows.map((r) => r.text)).toEqual(['Checking it.', 'Tests now.']);
  expect(printed[4].text).toMatch(/^The plan/); // never folded
  expect(printed[5].run.task).toBe('committing');
  expect(printed[7].text).toBe('Done: split and pushed.'); // the answer after the last steps
  // the same ids after /resume's new keys; opened, the key says so
  const again = rowsOf(items.map((it) => ({ ...it, key: `r${it.key}` })), { open: new Set([edit.id, edit.run.rows[1].id]) });
  expect(again.printed[1].id).toBe(edit.id);
  expect(again.printed[1].open).toBe(true);
  expect([...again.printed[1].openRows]).toEqual([edit.run.rows[1].id]);
  expect(again.printed[1].key).not.toBe(edit.key);
});

test('while it works: the task row under way is held, and what is printed only ever grows at its end', () => {
  const items = [
    you('go'), say('Reading.'), read('a.mjs'), think('a'), say('Editing.'), diff('a.mjs', 1, 1), think('b'), say('Again.'), diff('b.mjs', 2, 0),
    say('Looking.'), bash('grep x b.mjs'), say('Testing.'), bash('bun run test', 0, [' 2 pass', ' 0 fail']), think('c'), say('More tests.'), bash('bun run test x'),
    say('All done.'), { key: k(), rail: true, type: 'done', past: 'Worked', secs: 9, at: Date.now() },
  ];
  let before = [];
  for (let i = 1; i <= items.length; i++) {
    const working = i < items.length;
    const { printed, held } = rowsOf(items.slice(0, i), { working });
    const keys = printed.map((it) => it.key);
    expect(keys.slice(0, before.length)).toEqual(before);
    before = keys;
    if (i === 9) {
      // two edit rows so far, nothing settled: the box's top edge is in the live area with them
      expect(printed.map((it) => it.type)).toEqual(['user']);
      expect(held).toMatchObject({ type: 'tasklive', first: true, line: 'Again.' });
      expect(held.run.task).toBe('editing');
      expect(held.run.rows.map((r) => r.text)).toEqual(['Reading.', 'Editing.']);
      expect(held.list).toHaveLength(1);
      // drawn: the box's top edge, the task row so far, the row under way with the line just said, its step
      const drawn = strip(renderToString(h(LiveRun, { live: held, width: 100, drawSteps: (list, w) => list.map((x) => h(ItemFrame, { key: x.key, it: x, width: w, model: 'm', cwd: '~/p', loaded: '', start: {} })) }), { columns: 100 })).split('\n');
      expect(drawn[0]).toBe(`  ╭${'─'.repeat(94)}╮`);
      expect(drawn[1]).toMatch(/^ {2}│ ▾ EDITING {4}Editing\. +✎ a\.mjs \+1 −1 {2}2 parts {3}2 steps │$/);
      expect(drawn[2]).toMatch(/^ {2}│ {5}▾ Again\. +Working +1 step │$/);
      expect(drawn.join('\n')).toContain('b.mjs');
      for (const l of drawn) expect(l.length).toBeLessThanOrEqual(98);
    }
    if (i === 13) {
      // the test row is under way: the grep before it waits with the edits until a row that acts has finished
      expect(printed.filter((it) => it.type === 'taskrun')).toEqual([]);
      expect(held).toMatchObject({ line: 'Testing.' });
      expect(held.run.rows.map((r) => r.text)).toEqual(['Reading.', 'Editing.', 'Again.', 'Looking.']);
    }
    if (i === 15) {
      // the test row finished: the edit task row is printed, the grep went with the tests
      expect(printed.filter((it) => it.type === 'taskrun').map((it) => it.run.task)).toEqual(['editing']);
      expect(held).toMatchObject({ line: 'More tests.', first: false });
      expect(held.run.task).toBe('testing');
      expect(held.run.rows.map((r) => r.text)).toEqual(['Looking.', 'Testing.']);
    }
    if (i === 10) {
      // only looking after the edits: drawn as the edits so far, the look under way under them
      const d = strip(renderToString(h(LiveRun, { live: held, width: 100, drawSteps: () => null }), { columns: 100 })).split('\n').filter((l) => !l.startsWith('  ╭'));
      expect(d[0]).toMatch(/▾ EDITING {4}Again\./);
      expect(d[1]).toMatch(/^ {2}│ {5}▾ Looking\. +Working/);
    }
    if (i === 13) {
      // the test under way after them: a task row of its own under the edits
      const d = strip(renderToString(h(LiveRun, { live: held, width: 100, drawSteps: () => null }), { columns: 100 })).split('\n').filter((l) => !l.startsWith('  ╭'));
      expect(d[0]).toMatch(/▸ EDITING {4}Again\..*✎ 2 files  3 parts/);
      expect(d[1]).toMatch(/^ {2}│ ▾ TESTING {4}Testing\. +Working +1 step │$/);
    }
  }
  expect(before.filter((x) => x.endsWith(':end'))).toHaveLength(1);
});

test('the box: its top edge, a task row closed and open, a row open, the end with the newest failure and the totals, every row the box’s width', () => {
  const items = [
    you('go'), say('Edit one.'), diff('src/a.mjs', 4, 2), think('a'), say('Run the tests.'), bash('bun run test ./x.test.mjs', 1, [' 3 pass', ' 1 fail']), bash('false', 2),
    say('Which way?'), ask('Go on?', 'Yes'), think('b'), say('Bye.'),
  ];
  const { printed } = rowsOf(items);
  const runs = printed.filter((it) => it.type === 'taskrun');
  const end = printed.find((it) => it.type === 'taskend');
  for (const width of [135, 80]) {
    const first = draw(runs[0], width);
    expect(first[0]).toBe(`  ╭${'─'.repeat(width - 6)}╮`);
    expect(first[1]).toMatch(/^ {2}│ ▸ EDITING {4}Edit one\./);
    expect(first[1]).toMatch(/✎ a\.mjs \+4 −2 +1 part +1 step │$/);
    const asking = draw(runs.at(-1), width);
    expect(asking.join('\n')).toContain('? Go on? → Yes');
    const tail = draw(end, width);
    expect(tail.at(-2)).toMatch(/✗ Ran {2}false · exit 2 {2}· 1 more failed/);
    expect(tail.at(-1)).toMatch(width > 100 ? /^ {2}╰─ 4 steps · changed 1 file · ran 2 commands · 2 thoughts · 3 pass · 1 fail ─+╯$/ : /^ {2}╰─ 4 steps · changed 1 file · ran 2 commands .*… ╯$/);
    for (const l of [...first, ...asking, ...tail]) expect([l, l.length]).toEqual([l, width - 2]);
    const open = draw({ ...runs[1], open: true, openRows: new Set([runs[1].run.rows[0].id]) }, width);
    expect(open[0]).toMatch(/▾ TESTING/);
    expect(open[1]).toMatch(/^ {2}│ {5}▾ Run the tests\./);
    expect(open.join('\n')).toContain('bun run test ./x.test.mjs');
    for (const l of open) expect(l.length).toBeLessThanOrEqual(width - 2);
  }
});

test('a click finds the task row, or a row of an open one, by its rows up from the live part; ctrl+o’s list holds the task rows', () => {
  const items = [you('go'), say('One.'), think('a'), read('a.mjs'), diff('a.mjs', 1, 0), say('Two.'), bash('bun run test'), say('Three.')];
  const ctx = { width: 120, modelName: 'm', cwdShort: '~/p', loaded: '', start: {}, view: { steps: 'grouped', open: new Set() } };
  primeRows(items, ctx);
  // from the bottom: "Three." (1 row), the end (1 row: no failure), TESTING, EDITING with the top edge (2 rows)
  expect(printedAt(items, ctx, false, 1).it.type).toBe('text');
  expect(pieceAt(printedAt(items, ctx, false, 2).it, printedAt(items, ctx, false, 2).row, ctx)).toBeNull();
  const test1 = printedAt(items, ctx, false, 3);
  expect(test1.it.run.task).toBe('testing');
  expect(pieceAt(test1.it, test1.row, ctx)).toBe(test1.it.id);
  const top = printedAt(items, ctx, false, 5);
  expect(top.row).toBe(0); // the top edge opens it too
  expect(pieceAt(top.it, top.row, ctx)).toBe(top.it.id);
  const runs = stepRuns(items, ctx.view);
  expect(runs.map((it) => it.run.task)).toEqual(['editing', 'testing']);
  // opened, its row's own line opens that row; the row's steps are text
  const open = { ...ctx, view: { steps: 'grouped', open: new Set([runs[0].id]) } };
  primeRows(items, open);
  const [edit] = stepRuns(items, open.view);
  expect(pieceAt(edit, 2, open)).toBe(edit.run.rows[0].id);
  expect(pieceAt(edit, 3, open)).toBeNull();
});

test('the real window: a reply’s steps as a task row; the pointer resting on it keeps the mouse, a click opens it and its row, ctrl+o closes it; resting on the reply’s words gives Terminal the mouse; /steps open shows every step, kept', async () => {
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
  const rowOf = (text, has) => { const lines = text.split('\n'); const at = lines.findIndex((l) => l.includes(has)); return at < 0 ? -1 : at - (lines.length - 40); };
  const click = (row) => ({ fn: async ({ write }) => { if (row() >= 0) { write(`\x1b[<0;20;${row() + 1}M`); await new Promise((r) => setTimeout(r, 150)); write(`\x1b[<0;20;${row() + 1}m`); } } });
  let runRow = null, partRow = null;
  const seen = {};
  const mouseNow = (name) => ({ fn: ({ raw }) => { seen[name] = raw().lastIndexOf(MOUSE_ON) > raw().lastIndexOf(MOUSE_OFF) ? 'app' : 'Terminal'; } });
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_STEPS: '' }, args: ['--url', fake.url, '--no-flows'], cols: 120, rows: 40, timeoutMs: 90_000, steps: [
    { wait: '? for shortcuts' }, { sleep: 300 },
    { type: 'what does this project do?' }, { key: 'enter' }, { wait: 'It turns trades into CSV rows.', ms: 30_000 }, { sleep: 800 }, { snapshot: 'closed' },
    // the screen text is the whole buffer; the window is its last 40 rows (Terminal counts them from 1)
    { fn: ({ text, write }) => { runRow = rowOf(text, '▸ EXPLORING'); if (runRow >= 0) write(`\x1b[<35;20;${runRow + 1}M`); } }, // resting on it first
    { sleep: REST_MS + 350 }, mouseNow('onRun'),
    click(() => runRow), { wait: '▾ EXPLORING', ms: 10_000 }, { sleep: 500 }, { snapshot: 'run' },
    { fn: ({ text }) => { partRow = rowOf(text, '▸ Read export.mjs'); } },
    click(() => partRow), { wait: 'I will read the export first', ms: 10_000 }, { sleep: 500 }, { snapshot: 'part' },
    { key: 'ctrlO' }, { wait: 'Open or close a task row' }, { snapshot: 'list' }, { key: 'enter' }, { waitGone: '▾ EXPLORING', ms: 10_000 }, { sleep: 500 }, { snapshot: 'shut' },
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
  expect(r.snapshots.closed).toMatch(/│ ▸ EXPLORING {2}Read export\.mjs +1 part +\d steps │/);
  expect(r.snapshots.closed).toMatch(/╰─ \d steps · read \d · 2 thoughts ─+╯/);
  expect(r.snapshots.closed).not.toContain('I will read the export first');
  expect(runRow).toBeGreaterThan(0);
  expect(seen.onRun).toBe('app');
  expect(seen.onWords).toBe('Terminal');
  expect(partRow).toBeGreaterThan(runRow);
  expect(r.snapshots.part).toContain('I will read the export first'); // the thought, inside the open row
  expect(r.snapshots.list).toMatch(/EXPLORING · 1 part · \d steps/);
  expect(r.snapshots.shut).toContain('▸ EXPLORING');
  expect(r.snapshots.open).not.toContain('EXPLORING');
  expect(r.snapshots.open).toContain('I will read the export first');
  expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).steps).toBe('open');
}, 120_000);
