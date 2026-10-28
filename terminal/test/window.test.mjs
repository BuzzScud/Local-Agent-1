// Agentic Coder in its own window (terminal/src/window/, 12 Oct 2026): the pretend terminal's screen (vt.mjs), the
// conversation as the window draws it (view.mjs), when `coding` opens the window, the app's side of the line
// (bridge.mjs) and the window server end to end with a stand-in app (server.mjs): its key, the state passed on,
// keys passed back, the app's end; and the pill beside the model (bridge.mjs usageOf, meterOf).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { VtScreen } from '../src/window/vt.mjs';
import { viewItem, heldView, stepView, ansiRows, cellRows, xterm } from '../src/window/view.mjs';
import { windowWanted, runWindow, dropText, openWindowFree } from '../src/window/server.mjs';
import { droppedFiles, pathsOnly } from '../src/agent/images.mjs';
import { makeBridge, usageOf, meterOf, modelNowOf, effortWords } from '../src/window/bridge.mjs';
import { printedOf } from '../src/app/screen.jsx';
import { HOME } from '../../models/index.mjs';

test('the pretend screen keeps text, moves, erasing, wide letters, the other screen, and answers where the cursor is', () => {
  const said = [];
  const vt = new VtScreen(20, 5, { reply: (s) => said.push(s) });
  vt.write('hello\r\nworld');
  expect(vt.text().slice(0, 2)).toEqual(['hello', 'world']);
  vt.write('\x1b[1;1H\x1b[2KHI');
  expect(vt.text()[0]).toBe('HI');
  vt.write('\x1b[2;3H\x1b[K');
  expect(vt.text()[1]).toBe('wo');
  vt.write('\x1b[3;1H日本');
  expect(vt.cells()[2][1].ch).toBe('');
  expect(vt.text()[2]).toBe('日本');
  vt.write('\x1b[38;5;75mX\x1b[0m');
  expect(vt.cells()[2][4]).toMatchObject({ ch: 'X', fg: 75 });
  vt.write('\x1b[6n');
  expect(said).toEqual(['\x1b[3;6R']);
  vt.write('\x1b[?1049h\x1b[HALT');
  expect(vt.text()[0]).toBe('ALT');
  vt.write('\x1b[?1049l');
  expect(vt.text()[0]).toBe('HI');
  // past the last row the screen scrolls
  vt.write('\x1b[5;1Hlast\r\nmore');
  expect(vt.text().at(-1)).toBe('more');
  expect(cellRows(vt.cells()).length).toBe(5);
});

test("the conversation as the window draws it: the app's own grouping, colours by number as #rrggbb", () => {
  const items = [
    { key: 'u1', type: 'user', text: 'fix the bug', cards: [] },
    { key: 't1', rail: true, type: 'text', text: 'Looking at the file first.' },
    { key: 'r1', rail: true, type: 'tool', label: 'Read', arg: 'a.mjs', view: { kind: 'read', lines: 12, total: 12 } },
    { key: 'e1', rail: true, type: 'tool', label: 'Update', arg: 'a.mjs', view: { kind: 'diff', path: 'a.mjs', hunk: [{ type: '+', text: 'x' }, { type: '-', text: 'y' }] } },
    { key: 'a1', rail: true, type: 'text', text: 'Done: **fixed** the bug.\n\n- one\n- two' },
    { key: 'd1', rail: true, type: 'done', past: 'Baked', secs: 12, at: 0, steps: 2, usd: 0.1 },
  ];
  const { printed } = printedOf(items, false, { steps: 'grouped', open: new Set() });
  const views = printed.map(viewItem).filter(Boolean);
  expect(views.map((v) => v.t)).toEqual(['user', 'taskrun', 'taskend', 'text', 'done']);
  const run = views.find((v) => v.t === 'taskrun');
  expect(run.label).toBe('EDITING');
  expect(run.color).toMatch(/^#[0-9a-f]{6}$/);
  expect(run.facts.files).toEqual([{ name: 'a.mjs', a: 0, r: 0, created: false }]);
  expect(viewItem({ key: 'w', type: 'welcome' })).toEqual({ t: 'skip', key: 'w' });
  expect(viewItem({ key: 'z', type: 'something-new' })).toBeNull(); // drawn as the app draws it
  expect(xterm(75)).toBe('#5fafff');
  const rows = ansiRows('\x1b[1m\x1b[38;5;75mhi\x1b[0m there');
  expect(rows[0]).toEqual([['hi', '#5fafff', null, 1], [' there', null, null, 0]]);
});

test('coding opens the window only on a Mac with it built, never with --terminal, -p, over SSH, in tmux or in the tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-app-'));
  const app = join(dir, 'agentic-coder-window');
  writeFileSync(app, '');
  const env = { AGENTIC_WINDOW_APP: app };
  const mac = process.platform === 'darwin';
  expect(windowWanted({}, env)).toBe(mac);
  expect(windowWanted({ terminal: true }, env)).toBe(false);
  expect(windowWanted({ print: true }, env)).toBe(false);
  expect(windowWanted({ bg: true }, env)).toBe(false);
  expect(windowWanted({}, { ...env, AGENTIC_WINDOW: 'off' })).toBe(false);
  expect(windowWanted({}, { ...env, SSH_TTY: '/dev/ttys001' })).toBe(false);
  expect(windowWanted({}, { ...env, TMUX: '/tmp/tmux' })).toBe(false);
  expect(windowWanted({}, { ...env, NODE_ENV: 'test' })).toBe(false);
  expect(windowWanted({}, { AGENTIC_WINDOW_APP: join(dir, 'not-there'), HOME: dir })).toBe(false);
});

test('coding in a terminal starts the window on its own (detached), so that Terminal can be closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-free-'));
  const started = [];
  const run = (cmd, args, o) => { started.push({ cmd, args, o }); return { unref: () => { started.at(-1).unref = true; } }; };
  const cmd = openWindowFree({ folder: dir, args: ['--terminal', '--mode', 'auto'], env: { X: '1' }, run });
  expect(started.length).toBe(1);
  const [{ args, o, unref }] = started;
  expect(args.slice(-5)).toEqual(['window', '--folder', dir, '--mode', 'auto']);
  expect(cmd.slice(1)).toEqual(args);
  expect(o).toMatchObject({ cwd: dir, detached: true, env: { X: '1' } });
  expect(o.stdio[0]).toBe('ignore');
  expect(unref).toBe(true);
});

// The window's timeline (27 Oct 2026, the owner's pick "7 · Smooth"): each step whole with its time (stepView), a reply in
// parts by the lines it says and by the moves in its plan (partsOf, the model's line kept when its plan names the part),
// the part under way (heldView), and the bridge sending a step only when it changed.
const todosAt = (now) => ({ kind: 'todos', items: [{ text: 'Find the bug', status: now === 0 ? 'in_progress' : 'done' }, { text: 'Fix and test it', status: now === 1 ? 'in_progress' : 'pending' }] });
const TURN = [
  { key: 'u1', type: 'user', text: 'fix the rounding', cards: [] },
  { key: 't1', rail: true, type: 'text', text: 'Looking at the cart first.', at: 1000 },
  { key: 'p1', rail: true, type: 'tool', label: 'TodoWrite', arg: '2 to-dos', view: todosAt(0), at: 1100, ms: 3 },
  { key: 'r1', rail: true, type: 'tool', label: 'Read', arg: 'cart.mjs', view: { kind: 'read', lines: 3, total: 3, content: 'a\nb\nc' }, at: 1200, ms: 4 },
  { key: 'k1', rail: true, type: 'thinking', text: 'It floors. It should round.', secs: 2.5, tokens: 12, at: 1300 },
  { key: 'p2', rail: true, type: 'tool', label: 'TodoWrite', arg: '2 to-dos', view: todosAt(1), at: 1400, ms: 2 },
  { key: 'e1', rail: true, type: 'tool', label: 'Update', arg: 'cart.mjs', view: { kind: 'diff', path: 'cart.mjs', hunk: [{ type: '-', text: 'Math.floor(x)', oldNo: 2 }, { type: '+', text: 'Math.round(x)', newNo: 2 }] }, at: 1500, ms: 5 },
  { key: 'b1', rail: true, type: 'tool', label: 'Bash', arg: 'bun test', view: { kind: 'bash', code: 1, lines: ['cart.test.mjs:', '(pass) rounds', '(fail) totals', '', ' 4 pass', ' 1 fail'] }, at: 1600, ms: 900 },
  { key: 'a1', rail: true, type: 'text', text: 'Fixed the rounding; one test still fails.' },
  { key: 'd1', rail: true, type: 'done', reason: 'done', past: 'Baked', secs: 12, at: 0, steps: 3, calls: 5 },
];
test('the timeline: every step whole with its time, a reply in parts by its lines and its plan, and the part under way', () => {
  const grouped = { steps: 'grouped', open: new Set() };
  const ctx = { plan: null, raws: new Map() };
  const views = printedOf(TURN, false, grouped).printed.map((it) => viewItem(it, ctx)).filter(Boolean);
  // the plan moved from its first to-do to its second: two parts, each named by its to-do, the model's line kept
  expect(views.find((v) => v.t === 'taskrun').parts).toEqual([
    { key: 'p:p1', title: 'Find the bug', said: true, plan: true, keys: ['p1', 'r1', 'k1'], line: 'Looking at the cart first.' },
    { key: 'p:p2', title: 'Fix and test it', said: true, plan: true, keys: ['p2', 'e1', 'b1'] },
  ]);
  expect(views.find((v) => v.t === 'done')).toMatchObject({ steps: 3, calls: 5 });
  const steps = Object.fromEntries([...ctx.raws].map(([k, x]) => [k, stepView(x)]));
  expect(Object.keys(steps)).toEqual(['p1', 'r1', 'k1', 'p2', 'e1', 'b1']);
  // each with when it started and how long it took; the thought's time is its own
  expect(steps.k1).toEqual({ key: 'k1', at: 1300, k: 'think', text: 'It floors. It should round.', tokens: 12, ms: 2500 });
  expect(steps.r1).toMatchObject({ k: 'read', at: 1200, ms: 4, lines: 3, total: 3, content: ['a', 'b', 'c'] });
  expect(steps.p2.items).toEqual([{ text: 'Find the bug', done: true, now: false }, { text: 'Fix and test it', done: false, now: true }]);
  expect(steps.e1).toMatchObject({ k: 'diff', path: 'cart.mjs', add: 1, del: 1, hunk: [['-', 2, null, 'Math.floor(x)'], ['+', null, 2, 'Math.round(x)']], more: 0 });
  // a test run says how it went, read from its own output
  expect(steps.b1).toMatchObject({ k: 'bash', code: 1, n: 6, ms: 900, tests: { passed: 4, failed: 1 } });
  // a web search keeps its query and sources; one saved before them says its query from the call
  expect(stepView({ key: 'w1', type: 'tool', label: 'WebSearch', arg: '"bun 1.3"', view: { kind: 'websearch', count: 2, service: 'Anthropic' } })).toMatchObject({ k: 'websearch', query: 'bun 1.3', sources: [] });
  expect(stepView({ key: 'w2', type: 'tool', label: 'WebSearch', arg: '""', view: { kind: 'websearch', count: 1, query: 'bun', sources: [{ title: 'Bun', url: 'https://bun.sh', age: null }] } })).toMatchObject({ query: 'bun', sources: [{ title: 'Bun', url: 'https://bun.sh', age: null }] });
  // a line said with no step after it (another line came) is a part of its own
  const lines = [TURN[0], { key: 's1', rail: true, type: 'text', text: 'First a word.' }, { key: 's2', rail: true, type: 'text', text: 'Now the file.' }, TURN[3], TURN[8]];
  const c3 = { plan: null, raws: new Map() };
  const parts = printedOf(lines, false, grouped).printed.map((it) => viewItem(it, c3)).find((v) => v?.t === 'taskrun').parts;
  expect(parts.map((p) => [p.title, p.keys])).toEqual([['First a word.', []], ['Now the file.', ['r1']]]);
  // under way: the parts done so far, then the part under way, named by its plan, its line said before it
  const c2 = { plan: null, raws: new Map() };
  const w = printedOf(TURN.slice(0, 7), true, grouped);
  w.printed.forEach((it) => viewItem(it, c2));
  const live = heldView(w.held, c2);
  expect(live.parts.map((p) => [p.title, p.keys, Boolean(p.now)])).toEqual([['Find the bug', ['p1', 'r1', 'k1'], false], ['Fix and test it', ['p2', 'e1'], true]]);
  expect([live.line, live.plan, live.now.words]).toEqual(['Looking at the cart first.', 'Fix and test it', 'Looking at the cart first.']);
});

test('the bridge sends a step of the timeline once, and again only when it changed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-steps-'));
  const path = join(dir, 'b.sock');
  const lines = [];
  const srv = net.createServer((s) => { let buf = ''; s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } }); });
  await new Promise((r) => srv.listen(path, r));
  const bridge = makeBridge(path, 'k');
  const app = { items: TURN, live: { phase: 'idle' }, input: { value: '', cursor: 0 }, mode: 'auto', modelName: 'Stand-in', width: 100, columns: 100, rows: 30, stepsView: { steps: 'grouped', open: new Set() } };
  const next = async (n) => { for (let i = 0; i < 40 && lines.length < n; i++) await Bun.sleep(25); return lines[n - 1]; };
  bridge.publish(app, {});
  expect(Object.keys((await next(2)).steps)).toEqual(['p1', 'r1', 'k1', 'p2', 'e1', 'b1']);
  expect(lines[1].steps.e1).toMatchObject({ k: 'diff', add: 1, del: 1 });
  bridge.publish({ ...app, input: { value: 'a', cursor: 1 } }, {});
  expect((await next(3)).steps).toEqual({});
  // the same step made again with something new in it: that step alone
  const items = TURN.map((it) => (it.key === 'b1' ? { ...it, view: { ...it.view, code: 0, lines: [' 5 pass', ' 0 fail'] } } : it));
  bridge.publish({ ...app, items }, {});
  expect(Object.keys((await next(4)).steps)).toEqual(['b1']);
  expect(lines[3].steps.b1.tests).toEqual({ passed: 5, failed: 0 });
  bridge.close();
  srv.close();
});

test("the app's side: each redraw as data, only what changed, and the window's clicks back as actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-bridge-'));
  const path = join(dir, 'b.sock');
  const lines = [];
  let conn = null;
  const srv = net.createServer((s) => { conn = s; let buf = ''; s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } }); });
  await new Promise((r) => srv.listen(path, r));
  const bridge = makeBridge(path, 'the-window-key');
  const toggled = [];
  const self = { toggleGroup: (id) => toggled.push(id), setMode: () => {}, resumeSession: () => {} };
  const app = { items: [{ key: 'u1', type: 'user', text: 'hi', cards: [] }, { key: 'x1', rail: true, type: 'text', text: 'hello back' }], live: { phase: 'idle' }, input: { value: '/he', cursor: 3 }, menu: { kind: 'slash', index: 0, items: [{ label: '/help', desc: 'Help' }] }, mode: 'auto', modelName: 'Stand-in', width: 100, columns: 100, rows: 30, stepsView: { steps: 'grouped', open: new Set() } };
  bridge.publish(app, self);
  for (let i = 0; i < 40 && lines.length < 2; i++) await Bun.sleep(25);
  // first the window's key (server.mjs hears only the app that has it), then the state
  expect(lines[0]).toEqual({ t: 'hi', key: 'the-window-key' });
  expect(lines[1]).toMatchObject({ t: 'state', mode: 'auto', modelName: 'Stand-in', input: { value: '/he', cursor: 3 }, menu: { index: 0, items: [{ label: '/help', desc: 'Help' }] } });
  // the keys are the printed ones (the grouping names a reply after its item: x1:t)
  expect(lines[1].order).toEqual(['u1', 'x1:t']);
  expect(Object.keys(lines[1].items)).toEqual(['u1', 'x1:t']);
  bridge.publish({ ...app, input: { value: '/hel', cursor: 4 } }, self);
  for (let i = 0; i < 40 && lines.length < 3; i++) await Bun.sleep(25);
  expect(lines[2].items).toEqual({});
  expect(lines[2].order).toBeUndefined();
  conn.write(`${JSON.stringify({ t: 'act', do: 'toggle', id: 'row-1' })}\n`);
  for (let i = 0; i < 40 && !toggled.length; i++) await Bun.sleep(25);
  expect(toggled).toEqual(['row-1']);
  // the thinking under way goes as its words (18 Oct 2026: the window showed "∴ [object Object]")
  bridge.publish({ ...app, live: { phase: 'working', turnStart: 1, thinking: { text: 'First the config file.', startedAt: 1, tokens: 5 } } }, self);
  for (let i = 0; i < 40 && lines.length < 4; i++) await Bun.sleep(25);
  expect(lines[3].live.thinking).toBe('First the config file.');
  bridge.close();
  srv.close();
});

// The window audit (15 Oct 2026): a mode chip switched to Bypass without the note /mode gives, and a conversation picked
// in the window opened while a reply was under way, its messages swapped under the running turn.
test('the window\'s clicks do what the same thing typed does: a mode chip as /mode, a conversation as /resume', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-acts-'));
  const path = join(dir, 'b.sock');
  let conn = null;
  const srv = net.createServer((s) => { conn = s; });
  await new Promise((r) => srv.listen(path, r));
  const bridge = makeBridge(path, 'k');
  const did = [];
  const self = { agent: { busy: true }, holdRef: { current: true }, applyChoice: (id, v) => did.push(['choice', id, v]), setMode: (m) => did.push(['setMode', m]), resumeSession: (id) => did.push(['resume', id]), flash: (t) => did.push(['flash', t]), toggleGroup: () => {} };
  bridge.publish({ items: [], live: { phase: 'idle' }, input: { value: '', cursor: 0 }, mode: 'ask', width: 100, columns: 100, rows: 30, stepsView: { steps: 'grouped', open: new Set() } }, self);
  for (let i = 0; i < 40 && !conn; i++) await Bun.sleep(25);
  const act = async (m, n) => { conn.write(`${JSON.stringify({ t: 'act', ...m })}\n`); for (let i = 0; i < 40 && did.length < n; i++) await Bun.sleep(25); };
  await act({ do: 'mode', mode: 'bypass' }, 1);
  expect(did[0]).toEqual(['choice', 'mode', 'bypass']); // the note and Bypass's warning come with it
  await act({ do: 'resume', id: 'conv-1' }, 2);
  expect(did[1]).toEqual(['flash', 'Wait for Agentic Coder to finish, or press esc first']);
  expect(self.holdRef.current).toBe(true);
  self.agent.busy = false;
  await act({ do: 'resume', id: 'conv-1' }, 3);
  expect(did[2]).toEqual(['resume', 'conv-1']);
  expect(self.holdRef.current).toBe(false); // the start page goes, as /resume <n> does
  bridge.close();
  srv.close();
});

test("the pill beside the model: the Claude API's month as the footer said it, a free model's context and memory", () => {
  const GB = 2 ** 30;
  const month = { model: 'claude-opus-5-5', modelName: 'Opus 5.5', cap: 200, tierCap: 500, ownLimit: 200, tier: 'Start', spent: 156.84, left: 43.16, low: false, monthName: 'October', last14: [0, 9.85, 66.81], today: { usd: 1.2 }, window: 0.4, pace: { perDay: 26, runsOut: Date.UTC(2026, 9, 14), beforeReset: true }, limits: null, resetsOn: Date.UTC(2026, 10, 1), capped: null, source: { kind: 'typed', usd: 102.35, at: 1, since: 54.49, days: 1, stale: false } };
  expect(usageOf(null)).toBeNull();
  // amber when it runs out before the 1st, red under a tenth, "paused" at the cap, the month's dollars with no cap known
  expect(usageOf(month)).toMatchObject({ text: '$43.16 left', tone: 'warn', left: 43.16, cap: 200, own: true, today: 1.2, beforeReset: true, source: { kind: 'typed', usd: 102.35 } });
  expect(usageOf({ ...month, left: 14.2, low: true })).toMatchObject({ text: '$14.20 left', tone: 'bad' });
  expect(usageOf({ ...month, pace: { perDay: 2, runsOut: null, beforeReset: false } })).toMatchObject({ tone: null });
  expect(usageOf({ ...month, capped: { kind: 'own', until: 9e15 } })).toMatchObject({ text: 'paused', tone: 'bad', capped: true });
  expect(usageOf({ ...month, cap: null, left: null, spent: 138.32 })).toMatchObject({ text: '$138.32 this month' });
  // on the Claude API the pill is the month's; with --url there is no model to speak of
  expect(meterOf({ usage: month, modelState: { remote: true, state: 'on' } })).toBeNull();
  expect(meterOf({ modelState: null })).toBeNull();
  // a model on this Mac: the context, the Mac's memory in Activity Monitor's units, what the model holds
  const local = meterOf({ modelState: { state: 'on', name: 'Qwen3.5 9B', gb: 6.9 }, ctx: 32768, stats: { ctxUsed: 8192, tps: 21, ttft: 0.6, speeds: [20, 21] }, mac: { total: 16 * GB, avail: 6 * GB, level: 1 } });
  expect(local).toMatchObject({ remote: false, name: 'Qwen3.5 9B', ctx: 32768, ctxUsed: 8192, pct: 25, ctxWord: '32k', modelGb: 6.9, mac: { used: 10, total: 16, pressure: 'fine' }, gpu: null, tps: 21 });
  expect(meterOf({ modelState: { state: 'off' }, ctx: 32768, stats: {}, mac: { total: 16 * GB, avail: 1 * GB, level: 4 } })).toMatchObject({ state: 'off', pct: null, mac: { pressure: 'critical' } });
  // a model on another service: its GPU from Ollama's /api/ps once loaded, never the Mac's memory
  const svc = { modelState: { remote: true, state: 'on', name: 'Qwen3.6:35B-A3B', where: 'server-1' }, ctx: 65536, stats: { ctxUsed: 48650 }, mac: { total: 16 * GB, avail: 6 * GB, level: 1 } };
  expect(meterOf({ ...svc, server: { loaded: true, size: 31.2e9, vram: 24.3e9, gpuPct: 78, until: null, ms: 44 } })).toMatchObject({ remote: true, where: 'server-1', pct: 74, ctxWord: '64k', mac: null, gpu: { size: 31.2e9, vram: 24.3e9, pct: 78, ms: 44 } });
  expect(meterOf({ ...svc, server: { loaded: false } })).toMatchObject({ gpu: null, mac: null });
});

// 18 Oct 2026, the owner: the window said "Ready" and "17% of 32k" for the ~12 s a model was loading on the service
// (then "2% of 256k"), and "high effort" then "on effort" as it connected.
test('a model on the service before it has loaded: no context size, its state for the status line, and the thinking in words', () => {
  const svc = { modelState: { remote: true, state: 'loading', name: 'Qwen3.6:35B-A3B', where: '203.0.113.9:60009', gb: 26.1 }, ctx: 32768, stats: { ctxUsed: 5571 } };
  // the 32k the app plans for until then is not the service's size: none is said, the tokens used still are
  expect(meterOf(svc)).toMatchObject({ remote: true, state: 'loading', ctx: null, pct: null, ctxWord: '', ctxUsed: 5571, modelGb: 26.1 });
  expect(meterOf({ ...svc, modelState: { ...svc.modelState, state: 'connecting' } })).toMatchObject({ ctx: null, pct: null });
  // loaded: the size the service runs it at
  expect(meterOf({ ...svc, modelState: { ...svc.modelState, state: 'on' }, ctx: 262144 })).toMatchObject({ ctx: 262144, pct: 2, ctxWord: '256k' });
  // the state as the window's status line reads it
  expect(modelNowOf(svc.modelState)).toEqual({ remote: true, state: 'loading', name: 'Qwen3.6:35B-A3B', where: '203.0.113.9:60009', gb: 26.1 });
  expect(modelNowOf({ state: 'on', name: 'Qwen3.5 9B' })).toEqual({ remote: false, state: 'on', name: 'Qwen3.5 9B', where: null, gb: null });
  expect(modelNowOf(null)).toBeNull();
  // the levels' labels (registry.mjs, remote.mjs remoteLevels) in words; none while not known
  expect(['high', 'medium', 'low', 'on', 'off', 'none', 'max', null].map(effortWords)).toEqual(['high effort', 'medium effort', 'low effort', 'thinking on', 'thinking off', 'no thinking', 'max effort', null]);
});

test('files dropped on the window are typed as Terminal types a drop, so the app finds each one again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-drop-'));
  const shot = join(dir, 'Screenshot 2026-10-14 at 9.41.07\u202fAM.png');
  const odd = join(dir, "it's (v2) & [final].pdf");
  writeFileSync(shot, '');
  writeFileSync(odd, '');
  const text = dropText([shot, odd, '', 7]);
  expect(text).toBe(`${shot.replace(/ |\u202f/g, '\\$&')} ${odd.replace(/[ '()&[\]]/g, '\\$&')} `);
  expect(pathsOnly(text)).toBe(true);
  expect(droppedFiles(text, dir, { any: true }).map((d) => d.path)).toEqual([shot, odd]);
  expect(dropText([])).toBe('');
});

test('the window\'s socket is the app\'s alone: once the bridge has it, nothing the app starts (a command, a test) gets it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-sock-'));
  const sock = join(dir, 'w.sock');
  const got = [];
  const server = net.createServer((c) => got.push(c)).listen(sock);
  await new Promise((r) => server.once('listening', r));
  // An app in the window: the bridge loads (App.jsx imports it), then the app runs a command.
  const app = join(dir, 'app.mjs');
  writeFileSync(app, `
    const { windowBridge } = await import(${JSON.stringify(join(import.meta.dir, '..', 'src', 'window', 'bridge.mjs'))});
    // As the Bash tool and background jobs start one (tools/run.mjs): with a copy of process.env.
    const child = Bun.spawnSync(['/bin/sh', '-c', 'printf %s "$AGENTIC_WINDOW_SOCK$AGENTIC_WINDOW_KEY"'], { env: { ...process.env } });
    console.log(JSON.stringify({ bridge: Boolean(windowBridge), child: String(child.stdout) }));
    windowBridge?.close();
  `);
  const p = Bun.spawn([process.execPath, app], { env: { ...process.env, AGENTIC_WINDOW_SOCK: sock, AGENTIC_WINDOW_KEY: 'the-window-key' }, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(p.stdout).text();
  await p.exited;
  for (const c of got) c.destroy();
  server.close();
  expect(JSON.parse(out.trim().split('\n').pop())).toEqual({ bridge: true, child: '' });
});

test('the window server: its page only with its key, the state passed on, keys passed back, and the end of the app', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-server-'));
  // The stand-in app: says one state over the bridge, prints what it is typed, and ends at q.
  const stand = join(dir, 'stand-in.mjs');
  writeFileSync(stand, `
    import net from 'node:net';
    const s = net.connect(process.env.AGENTIC_WINDOW_SOCK);
    s.on('connect', () => s.write(JSON.stringify({ t: 'hi', key: process.env.AGENTIC_WINDOW_KEY }) + '\\n' + JSON.stringify({ t: 'state', now: Date.now(), order: ['a'], items: { a: { t: 'text', key: 'a', text: 'hi from the app' } }, mode: 'plan', modelName: 'Stand-in', input: { value: '', cursor: 0 }, live: { phase: 'idle' } }) + '\\n'));
    process.stdin.setRawMode?.(true);
    process.stdin.on('data', (d) => { const t = String(d); if (t.includes('q')) process.exit(3); s.write(JSON.stringify({ t: 'typed', text: t }) + '\\n'); });
  `);
  let url = null;
  const done = runWindow({ folder: dir, open: false, command: [process.execPath, stand], onUrl: (u) => { url = u; }, say: () => {} });
  for (let i = 0; i < 80 && !url; i++) await Bun.sleep(25);
  const base = url.split('?')[0];
  expect((await fetch(base)).status).toBe(403);
  expect((await fetch(`${base}?t=wrong`)).status).toBe(403);
  const page = await fetch(url);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('data-tauri-drag-region');
  const got = [];
  const ws = new WebSocket(url.replace('http://', 'ws://').replace('/?', '/ws?'));
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  for (let i = 0; i < 80 && !got.some((m) => m.t === 'state'); i++) await Bun.sleep(25);
  expect(got[0].t).toBe('hello');
  const state = got.find((m) => m.t === 'state');
  expect(state.items.a.text).toBe('hi from the app');
  ws.send(JSON.stringify({ t: 'keys', data: 'x' }));
  for (let i = 0; i < 80 && !got.some((m) => m.t === 'typed'); i++) await Bun.sleep(25);
  expect(got.find((m) => m.t === 'typed').text).toBe('x');
  // Another copy of the app with the socket but not the key (a test's app started from inside the window, 14 Oct
  // 2026): not heard. Before, the window took it for the app started again, dropped the conversation and drew it.
  const resets = got.filter((m) => m.t === 'reset').length;
  const stray = net.connect(join(HOME, 'window', `${process.pid}.sock`));
  await new Promise((r) => stray.on('connect', r));
  stray.write(`${JSON.stringify({ t: 'state', now: Date.now(), order: ['b'], items: { b: { t: 'text', key: 'b', text: 'a stray copy' } } })}\n`);
  const strayGone = new Promise((r) => stray.on('close', r));
  const typedNow = got.filter((m) => m.t === 'typed').length;
  ws.send(JSON.stringify({ t: 'keys', data: 'y' }));
  for (let i = 0; i < 80 && got.filter((m) => m.t === 'typed').length === typedNow; i++) await Bun.sleep(25);
  await strayGone;
  expect(got.filter((m) => m.t === 'reset').length).toBe(resets);
  expect(JSON.stringify(got)).not.toContain('a stray copy');
  // a screenshot dropped on the window (main.rs hands the page its path) reaches the app as a pasted drop
  ws.send(JSON.stringify({ t: 'drop', paths: ['/Users/me/Desktop/Screenshot 2026-10-14 at 9.41.07\u202fAM.png'] }));
  for (let i = 0; i < 80 && !got.some((m) => m.t === 'typed' && m.text.includes('200~')); i++) await Bun.sleep(25);
  expect(got.filter((m) => m.t === 'typed').map((m) => m.text).join('')).toContain('\x1b[200~/Users/me/Desktop/Screenshot\\ 2026-10-14\\ at\\ 9.41.07\\\u202fAM.png \x1b[201~');
  ws.send(JSON.stringify({ t: 'keys', data: 'q' }));
  expect(await done).toBe(3);
  for (let i = 0; i < 40 && !got.some((m) => m.t === 'exit'); i++) await Bun.sleep(25);
  expect(got.at(-1)).toMatchObject({ t: 'exit', code: 3 });
  ws.close();
});
