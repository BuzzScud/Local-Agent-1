// The window's page in a real browser (15 Oct 2026, the window audit, docs/private/window-audit-2026-10-15/): the real
// page (src/window/ui.html) from the real window server (server.mjs), a stand-in app behind it, and a headless Chrome
// clicked and typed into over the DevTools protocol. What the audit found broken: the search box typed backwards (made
// anew at each letter, its caret at the start), rows that looked clickable did nothing, and every redraw rebuilt the
// whole conversation (17 ms on 1,050 items while an answer streamed, and a selection in an earlier answer was lost).
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWindow } from '../src/window/server.mjs';
import { meterOf, modelNowOf, effortWords } from '../src/window/bridge.mjs';
import { viewItem, heldView, stepView } from '../src/window/view.mjs';
import { printedOf } from '../src/app/screen.jsx';
import { knownOf } from '../src/app/start.jsx';
import { saveSession } from '../src/app/store.mjs';
import { findChrome } from '../src/flows/layoutcheck.mjs';
import { needs } from './needs.mjs';

// The stand-in app: says the state in AUDIT_STATE whenever that file changes, and writes down every key typed into its
// terminal and every action the window sends it.
const STAND_IN = `
import net from 'node:net';
import { readFileSync, appendFileSync, statSync } from 'node:fs';
const note = (m) => appendFileSync(process.env.AUDIT_LOG, JSON.stringify(m) + '\\n');
const s = net.connect(process.env.AGENTIC_WINDOW_SOCK);
let seen = 0, inbox = '';
const say = () => { try { const at = statSync(process.env.AUDIT_STATE).mtimeMs; if (at === seen) return; seen = at; s.write(JSON.stringify({ t: 'state', now: Date.now(), ...JSON.parse(readFileSync(process.env.AUDIT_STATE, 'utf8')) }) + '\\n'); } catch {} };
s.on('connect', () => { s.write(JSON.stringify({ t: 'hi', key: process.env.AGENTIC_WINDOW_KEY }) + '\\n'); say(); setInterval(say, 30); });
s.on('data', (d) => { inbox += d; let i; while ((i = inbox.indexOf('\\n')) >= 0) { const l = inbox.slice(0, i); inbox = inbox.slice(i + 1); try { note({ from: 'socket', ...JSON.parse(l) }); } catch {} } });
process.stdin.setRawMode?.(true);
process.stdin.on('data', (d) => note({ from: 'keys', data: String(d) }));
`;

async function openPage() {
  const folder = mkdtempSync(join(tmpdir(), 'window-page-'));
  const log = join(folder, 'got.jsonl'), stateFile = join(folder, 'state.json'), standIn = join(folder, 'stand-in.mjs');
  writeFileSync(log, '');
  writeFileSync(standIn, STAND_IN);
  saveSession(folder, 'conv-tax', { title: 'Fix the tax rounding in checkout', messages: [{ role: 'user', content: 'a' }] });
  saveSession(folder, 'conv-docs', { title: 'Write the README install steps', messages: [{ role: 'user', content: 'a' }] });
  let n = 0;
  const say = async (st) => { writeFileSync(stateFile, JSON.stringify({ ...st, n: ++n })); await Bun.sleep(150); };
  let url = null;
  const done = runWindow({ folder, open: false, command: [process.execPath, standIn], env: { ...process.env, AUDIT_LOG: log, AUDIT_STATE: stateFile }, onUrl: (u) => { url = u; }, say: () => {} });
  for (let i = 0; i < 200 && !url; i++) await Bun.sleep(25);
  // The graphics chip in the browser's own process: a sandboxed run has no GPU process of its own.
  const chrome = Bun.spawn([findChrome(), '--headless', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--in-process-gpu', '--single-process', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'window-page-chrome-'))}`, '--remote-debugging-port=0', 'about:blank'], { stderr: 'pipe', stdout: 'ignore' });
  let devtools = null;
  const reader = chrome.stderr.getReader();
  for (let text = ''; !devtools;) { const { value, done: end } = await reader.read(); if (end) break; text += new TextDecoder().decode(value); devtools = /DevTools listening on (ws:\S+)/.exec(text)?.[1] ?? null; }
  const ws = new WebSocket(devtools);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description); };
  const call = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++seq; waiting.set(id, (m) => (m.error ? bad(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const on = (m, p) => call(m, p, sessionId);
  await on('Runtime.enable');
  await on('Emulation.setDeviceMetricsOverride', { width: 1340, height: 860, deviceScaleFactor: 1, mobile: false });
  await on('Page.navigate', { url });
  const js = async (expression) => (await on('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  for (let i = 0; i < 80 && !(await js(`Boolean(document.getElementById('tb'))`)); i++) await Bun.sleep(50);
  const click = async (sel, nth = 0) => {
    const at = await js(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!at) throw new Error(`nothing at ${sel}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await on('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await Bun.sleep(250);
  };
  const type = async (text) => { for (const ch of text) { await on('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch }); await on('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); } await Bun.sleep(200); };
  const press = async (key, code, shift = false) => { for (const t of ['rawKeyDown', 'keyUp']) await on('Input.dispatchKeyEvent', { type: t, key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 }); await Bun.sleep(150); };
  const got = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const close = async () => { ws.close(); chrome.kill(); writeFileSync(stateFile, '{}'); process.emit('SIGTERM'); await done; };
  return { say, js, click, type, press, on, got, errors, close, folder };
}

const items = {
  u1: { t: 'user', key: 'u1', text: 'why does checkout round 19.995 down?', cards: [] },
  a1: { t: 'text', key: 'a1', text: 'It rounds with **Math.floor**, so 19.995 becomes 19.99.' },
  d1: { t: 'done', key: 'd1', past: 'Worked', secs: 41, at: 0, usd: 0, steps: 2 },
};
const base = { order: Object.keys(items), items, mode: 'ask', modelName: 'Stand-in', cwdShort: '~/project', input: { value: '', cursor: 0 }, placeholder: 'Ask anything', live: { phase: 'idle' }, files: [{ name: 'cart.mjs', add: 3, del: 1 }], todos: [{ text: 'Fix roundCents', status: 'in_progress' }], stats: {} };

test.skipIf(needs('chrome', findChrome))('in a real browser: the search box types in order and finds; a row that looks clickable does something; a streamed answer keeps the rest of the conversation as it was', async () => {
  const p = await openPage();
  try {
    await p.say(base);
    // Search (⌘K's box): "tax" stays "tax" and finds the one conversation; a click on it opens it.
    await p.click('[data-act="find"]');
    await p.type('tax');
    expect(await p.js(`document.getElementById('fq').value`)).toBe('tax');
    expect(await p.js(`[...document.querySelectorAll('.drop [data-resume]')].map((e) => e.dataset.resume)`)).toEqual(['conv-tax']);
    await p.click('.drop [data-resume]');
    expect(p.got().filter((m) => m.from === 'socket')).toContainEqual({ from: 'socket', t: 'act', do: 'resume', id: 'conv-tax' });
    // The side bar: every row with a hand opens something; the files and to-dos are lists to read.
    await p.click('[data-act="side"]');
    for (let i = 0; i < 40 && (await p.js(`document.querySelectorAll('#side [data-resume]').length`)) < 2; i++) await Bun.sleep(50);
    const rows = await p.js(`[...document.querySelectorAll('#side .row')].map((e) => ({ t: e.textContent.slice(0, 30), hand: getComputedStyle(e).cursor === 'pointer', does: Boolean(e.dataset.resume || e.dataset.act) }))`);
    expect(rows.map((r) => r.t)).toEqual(['Write the README install steps', 'Fix the tax rounding in checko', '✎ cart.mjs+3 −1', '◐Fix roundCents']);
    expect(rows.filter((r) => r.hand !== r.does)).toEqual([]);
    await p.click('[data-act="side"]');
    // A streamed answer: the earlier items keep their elements (and a selection in them); the new words come in.
    await p.js(`(() => { window.__first = document.querySelector('.reply'); const r = document.createRange(); r.selectNodeContents(window.__first); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
    for (const text of ['The', 'The rounding', 'The rounding happens in roundCents.']) await p.say({ ...base, items: {}, live: { phase: 'working', turnStart: Date.now(), tokens: 3, text } });
    expect(await p.js(`document.querySelector('.reply') === window.__first && String(getSelection()).includes('Math.floor')`)).toBe(true);
    expect(await p.js(`document.querySelector('.ch7.live .tail7').textContent`)).toContain('The rounding happens in roundCents.');
    // The answer done: it comes as an item, the part under way goes.
    await p.say({ ...base, order: [...base.order, 'a2'], items: { a2: { t: 'text', key: 'a2', text: 'The rounding happens in roundCents.' } } });
    expect(await p.js(`[document.querySelectorAll('#items .reply').length, document.querySelectorAll('.ch7.live').length, document.getElementById('live').textContent]`)).toEqual([2, 0, '']);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// The keyboard and the Mac's reduce-motion setting (15 Oct 2026, the window audit): the search results and the side
// bar's conversations could only be clicked, and the bar's shine, the caret and the spinner moved whatever the Mac said.
test.skipIf(needs('chrome', findChrome))('in a real browser: Enter and Tab work in the search box and the side bar, the row you are on shows a ring, and reduce motion stills the window', async () => {
  const p = await openPage();
  try {
    await p.say({ ...base, input: { value: 'hi', cursor: 2 } });
    const resumes = () => p.got().filter((m) => m.from === 'socket' && m.do === 'resume').map((m) => m.id);
    // Enter in the box opens the first match.
    await p.click('[data-act="find"]');
    await p.type('readme');
    for (let i = 0; i < 40 && !(await p.js(`Boolean(document.querySelector('.drop [data-resume]'))`)); i++) await Bun.sleep(50);
    await p.press('Enter', 13);
    expect(resumes()).toEqual(['conv-docs']);
    expect(p.got().filter((m) => m.from === 'keys' && m.data === '\r')).toEqual([]);
    // In the side bar: Tab from the box goes to the first conversation, which shows a ring; Tab again to the next, and
    // Enter opens it. None of these keys reach the app.
    await p.click('[data-act="side"]');
    for (let i = 0; i < 40 && (await p.js(`document.querySelectorAll('#side [data-resume]').length`)) < 2; i++) await Bun.sleep(50);
    await p.js(`document.getElementById('sq').focus()`);
    await p.press('Tab', 9);
    expect(await p.js(`[document.activeElement.dataset.resume, getComputedStyle(document.activeElement).outlineStyle]`)).toEqual(['conv-docs', 'solid']);
    await p.press('Tab', 9);
    expect(await p.js(`document.activeElement.dataset.resume`)).toBe('conv-tax');
    await p.press('Enter', 13);
    expect(resumes()).toEqual(['conv-docs', 'conv-tax']);
    expect(p.got().filter((m) => m.from === 'keys')).toEqual([]);
    // Closed, the side bar is out of Tab's reach; outside the panels Tab goes to the app again.
    expect(await p.js(`document.getElementById('side').inert`)).toBe(true);
    await p.press('Tab', 9);
    expect(p.got().filter((m) => m.from === 'keys').map((m) => m.data)).toEqual(['\t']);
    // Reduce motion: the caret holds still, and the spinner is one still mark.
    expect(await p.js(`getComputedStyle(document.querySelector('.caret')).animationName`)).toBe('blink');
    await p.on('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await p.say({ ...base, input: { value: 'hi', cursor: 2 }, live: { phase: 'working', turnStart: Date.now(), tokens: 3, text: '' } });
    expect(await p.js(`getComputedStyle(document.querySelector('.caret')).animationName`)).toBe('none');
    const marks = [];
    for (let i = 0; i < 4; i++) { marks.push(await p.js(`document.querySelector('.ac')?.textContent.slice(0, 1)`)); await Bun.sleep(300); }
    expect(new Set(marks)).toEqual(new Set(['⠿']));
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// What the UI sweep of 19 Oct 2026 found in the window (the real app in this page, on a stand-in service): a reply stopped
// with esc ended "for 1s · done" as if it had finished, a message sent while a reply worked showed nowhere, and the line
// under the title named the mode by its id ("ask"). The end items are the bridge's own (view.mjs viewItem).
test.skipIf(needs('chrome', findChrome))('in a real browser: a stopped reply says why, a message sent while it works shows as queued, and the mode has its name', async () => {
  const p = await openPage();
  try {
    const stopped = viewItem({ type: 'done', key: 'd2', reason: 'interrupted', text: 'Interrupted · What should Agentic Coder do instead?', secs: 1.2, at: Date.now() });
    const limit = viewItem({ type: 'done', key: 'd3', reason: 'limit', text: 'Stopped at the step limit', secs: 30, at: Date.now() });
    await p.say({ ...base, order: [...base.order, 'd2', 'd3'], items: { ...items, d2: stopped, d3: limit } });
    const ends = await p.js(`[...document.querySelectorAll('#items .endline')].map((e) => e.textContent)`);
    expect(ends).toHaveLength(3);
    expect(ends[0]).toContain('Worked for 41s');
    expect(ends[1]).toContain('■Interrupted · What should Agentic Coder do instead?');
    expect(ends[1]).not.toContain(' for ');
    expect(ends[2]).toContain('Stopped at the step limit · 30s');
    expect(await p.js(`document.querySelector('.hero .sub').textContent`)).toBe('Stand-in · manual');
    // While it works, a message sent waits for the next step, and the status line says so.
    await p.say({ ...base, live: { phase: 'working', turnStart: Date.now(), tokens: 3 }, queued: 'also check the README' });
    expect(await p.js(`document.getElementById('status').textContent`)).toContain('⏵ Queued: also check the README');
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// A press held as long as a person holds one (19 Oct 2026, the UI sweep): the part under way is drawn again with each
// state while the thinking streams, so a box pressed was gone by the release and 0 of 8 clicks opened or closed it. The
// line under way shows or hides what streams on the press (27 Oct 2026, the timeline: steps-page.js).
test.skipIf(needs('chrome', findChrome))('in a real browser: what streams shows and hides on a press of the line under way, held while the thinking streams', async () => {
  const p = await openPage();
  try {
    let n = 0, on = true;
    const think = () => ({ ...base, order: [], items: {}, live: { phase: 'working', turnStart: Date.now(), tokens: n, thinking: Array.from({ length: 6 + n }, (_, i) => `Thought line ${i}`).join('\n') } });
    await p.say(think());
    const streaming = (async () => { while (on) { n++; await p.say(think()); } })();
    const shown = () => p.js(`Boolean(document.querySelector('.ch7.live .tail7'))`);
    const press = async () => {
      const at = await p.js(`(() => { const r = document.querySelector('[data-tail7]').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
      await p.on('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
      await p.on('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await Bun.sleep(400); // two states or more arrive while it is held
      await p.on('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await Bun.sleep(200);
    };
    expect(await shown()).toBe(true);
    await press();
    expect([await shown(), await p.js(`localStorage.getItem('think-open')`)]).toEqual([false, '0']);
    await press();
    expect([await shown(), await p.js(`localStorage.getItem('think-open')`)]).toEqual([true, '1']);
    on = false;
    await streaming;
    expect(p.got()).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// The window's first seconds on a model on the service (18 Oct 2026, the owner, from pictures of the real window taken
// as it opened): it said Ready with a green dot for the ~12 s the model was still loading there, "ctx 17% of 32k" until
// it jumped to "2% of 256k", and "on effort". The states are the bridge's own (meterOf, modelNowOf, effortWords with start.jsx knownOf).
test.skipIf(needs('chrome', findChrome))('in a real browser: a model still loading on the service is not Ready, shows no context size yet, and says thinking on', async () => {
  const p = await openPage();
  try {
    const name = 'Qwen3.6:35B-A3B', where = '203.0.113.9:60009';
    const at = (state, more = {}) => {
      const app = { modelState: { remote: true, state, name, where, gb: state === 'loading' ? 26.1 : null }, ctx: state === 'on' ? 262144 : 32768, stats: { ctxUsed: 5571 }, ...more };
      return { ...base, order: [], items: {}, hold: true, modelName: `${name} · ${where}`, start: { model: `${name} · ${where}`, effort: effortWords(knownOf({ effort: state === 'connecting' ? 'high' : 'on', svc: app.modelState }).effort), cwd: '~/project', recent: [] }, meter: meterOf(app), model: modelNowOf(app.modelState) };
    };
    const seen = () => p.js(`({ status: document.getElementById('status').textContent, dot: document.getElementById('pilldot').className, pill: document.getElementById('uslot').textContent, sub: document.querySelector('.home .sub').textContent })`);
    // Connecting: no effort yet (the levels are a stand-in's until the service answers)
    await p.say(at('connecting'));
    expect(await seen()).toMatchObject({ status: expect.stringContaining(`Connecting to ${where}…`), dot: 'dot busy', pill: 'ctx once loaded', sub: `in ~/project · ${name} · ${where}` });
    // Loading on the service: not Ready, what you type waits, no size until the service says it
    await p.say(at('loading'));
    let s = await seen();
    expect(s).toMatchObject({ dot: 'dot busy', pill: 'ctx once loaded', sub: `in ~/project · ${name} · ${where} · thinking on` });
    expect(s.status).toContain(`Loading ${name} on the service · 26.1 GB…`);
    expect(s.status).toContain('You can type now: it sends once the model has loaded');
    expect(s.status).not.toContain('Ready');
    await p.click('[data-act="usage"]');
    expect(await p.js(`document.getElementById('ucard').textContent`)).toContain('its size shows once the model has loaded on the service');
    await p.click('[data-act="usage"]');
    // A message typed meanwhile: queued, and says what it waits for
    await p.say({ ...at('loading'), queued: 'fix the tax rounding' });
    expect((await seen()).status).toContain('⏵ Queued: fix the tax rounding · sends once the model has loaded on the service');
    // Loaded: Ready, and the size the service runs it at with its GPU
    await p.say(at('on', { server: { loaded: true, size: 26.1e9, vram: 26.1e9, gpuPct: 100, until: null, ms: 40 } }));
    s = await seen();
    expect(s).toMatchObject({ dot: 'dot', pill: 'ctx 2% of 256kGPU 26.1 GB', sub: `in ~/project · ${name} · ${where} · thinking on` });
    expect(s.status.startsWith('Ready')).toBe(true);
    // The service gone: said, not Ready
    await p.say(at('down'));
    expect(await seen()).toMatchObject({ status: expect.stringContaining(`${where} is not answering · /remote`), dot: 'dot off' });
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// The reply as the bridge sends it (view.mjs viewItem, heldView, stepView over the app's own grouping): its items, the part
// under way and every step. The turn: a line, a plan that moves from its first to-do to its second, a read, a thought, an
// edit and a test run.
const todosAt = (now) => ({ kind: 'todos', items: [{ text: 'Find the bug', status: now === 0 ? 'in_progress' : 'done' }, { text: 'Fix and test it', status: now === 1 ? 'in_progress' : 'pending' }] });
const turnRaw = (t0) => [
  { key: 'u2', type: 'user', text: 'fix the rounding', cards: [] },
  { key: 't1', rail: true, type: 'text', text: 'Looking at the cart first.', at: t0 + 1000 },
  { key: 'p1', rail: true, type: 'tool', label: 'TodoWrite', arg: '2 to-dos', view: todosAt(0), at: t0 + 2000, ms: 3 },
  { key: 'r1', rail: true, type: 'tool', label: 'Read', arg: 'cart.mjs', view: { kind: 'read', lines: 2, total: 2, content: 'export const total = (x) =>\n  Math.floor(x * 100) / 100;' }, at: t0 + 3000, ms: 4 },
  { key: 'k1', rail: true, type: 'thinking', text: 'It floors. It should round.', secs: 2.5, tokens: 12, at: t0 + 4000 },
  { key: 'p2', rail: true, type: 'tool', label: 'TodoWrite', arg: '2 to-dos', view: todosAt(1), at: t0 + 7000, ms: 2 },
  { key: 'e1', rail: true, type: 'tool', label: 'Update', arg: 'cart.mjs', view: { kind: 'diff', path: 'cart.mjs', hunk: [{ type: '-', text: '  Math.floor(x * 100) / 100;', oldNo: 2 }, { type: '+', text: '  Math.round(x * 100) / 100;', newNo: 2 }] }, at: t0 + 8000, ms: 5 },
  { key: 'b1', rail: true, type: 'tool', label: 'Bash', arg: 'bun test', view: { kind: 'bash', code: 1, lines: ['cart.test.mjs:', '(pass) rounds', '(fail) totals', '', ' 4 pass', ' 1 fail'] }, at: t0 + 9000, ms: 900 },
];
const turnState = (raw, working) => {
  const ctx = { plan: null, raws: new Map() };
  const { printed, held } = printedOf(raw, working, { steps: 'grouped', open: new Set() });
  const views = printed.map((it) => viewItem(it, ctx)).filter((v) => v && v.t !== 'skip');
  const live = working ? heldView(held, ctx) : null;
  return { order: views.map((v) => v.key), items: Object.fromEntries(views.map((v) => [v.key, v])), held: live, steps: Object.fromEntries([...ctx.raws].map(([k, x]) => [k, stepView(x)])) };
};
// Each part as drawn: its title, under way or folded, its lines (coloured verb, what it was on, how it went), what is open.
const PARTS = `[...document.querySelectorAll('#items .ch7')].map((el) => { const ti = el.querySelector('.hd7 .ti').cloneNode(true); ti.querySelector('.nw7')?.remove(); return { title: ti.textContent.trim(), live: el.classList.contains('live'), shut: el.classList.contains('shut'), lines: [...el.querySelectorAll('.l7')].map((l) => [l.querySelector('.tg').textContent, l.querySelector('.tx').textContent, l.querySelector('.rs').textContent].join(' | ')), open: el.querySelectorAll('.det7').length }; })`;

// The reply under way in parts (27 Oct 2026, the owner's pick "7 · Smooth" after five rounds, and "keep everything here,
// not in the bottom chat box"): each part a box with every step on a line, the part under way says what it does now; a
// line opens in place and a finished part folds, in the page alone (18 Oct 2026, the owner: "when i click on the dropdown
// or the boxes to expand or collapse, it doesnt work"), and what is new slides in while the rest keeps its elements.
test.skipIf(needs('chrome', findChrome))('in a real browser: the reply under way in parts, a step opens in place, a finished part folds, and the next state keeps both', async () => {
  const p = await openPage();
  try {
    const t0 = Date.now() - 60_000, raw = turnRaw(t0);
    const at = (n, live) => ({ ...base, ...turnState(raw.slice(0, n), true), live: { phase: 'working', turnStart: t0, stepStart: Date.now() - 2000, tokens: 3, ...live } });
    await p.say(at(7, { running: { label: 'Bash', arg: 'bun test' } }));
    // the plan named each part; the model's line stays as its first line; the part under way ends with the step under way
    expect(await p.js(PARTS)).toEqual([
      { title: '▸ Find the bug', live: false, shut: false, open: 0, lines: ['Said | Looking at the cart first. | ', 'Planning | 2 to-dos · 0 done | ', 'Reading | cart.mjs | ', 'Thought | It floors. | '] },
      { title: '▸ Fix and test it', live: true, shut: false, open: 0, lines: ['Planning | 2 to-dos · 1 done | ', 'Editing | cart.mjs | +1 −1', 'Testing | bun test | '] },
    ]);
    // when each step started from the turn's start and how long it took (the model's line has neither), and the head of
    // the part under way
    expect(await p.js(`[...document.querySelectorAll('.ch7')[0].querySelectorAll('.l7')].map((l) => l.querySelector('.at').textContent + ' ' + l.querySelector('.du').textContent)`)).toEqual([' ', '0:02 0.0 s', '0:03 0.0 s', '0:04 2.5 s']);
    expect(await p.js(`(() => { const h = document.querySelector('.ch7.live .hd7'); return [h.querySelector('.nw7 .vb').textContent, h.querySelector('.nw7 .tg').textContent, h.querySelector('.oc').textContent]; })()`)).toEqual(['Testing', 'bun test', '4 calls · 12 thinking']);
    // A line opens in place: the file as read; a change with its line numbers and Copy inside its box.
    await p.click('[data-r7="r1"]');
    expect(await p.js(`document.querySelector('.ch7 .det7 .out').innerText`)).toBe('export const total = (x) =>\n  Math.floor(x * 100) / 100;');
    await p.click('[data-r7="e1"]');
    expect(await p.js(`(() => { const d = document.querySelector('.ch7.live .det7'); return [[...d.querySelectorAll('.diff > div')].map((r) => r.className + ' ' + r.querySelector('.n').textContent), Boolean(d.querySelector('.cpw > .diff + .cp7'))]; })()`)).toEqual([['del 2', 'add 2'], true]);
    // A finished part folds by its title.
    await p.click('[data-o7="p:p1"]');
    expect((await p.js(PARTS))[0]).toMatchObject({ shut: true, open: 1 });
    await p.js(`document.querySelector('[data-k="e1"]').__kept = 1`);
    // The next state: the test run done, the next reply thinking. What was open or folded stays; the new line slides in.
    await p.say(at(8, { thinking: 'Two of them fail on the totals.', thinkStart: Date.now() - 1500 }));
    const now = await p.js(PARTS);
    expect(now[0]).toMatchObject({ shut: true, open: 1 });
    expect(now[1].lines).toEqual(['Planning | 2 to-dos · 1 done | ', 'Editing | cart.mjs | +1 −1', 'Testing | bun test | ✗ 1', 'Thinking | ' + now[1].lines[3].split(' | ')[1] + ' | ']);
    expect(now[1].lines[3]).toMatch(/^Thinking \| \d+ tokens/);
    expect(now[1].open).toBe(1);
    expect(await p.js(`[document.querySelector('[data-k="e1"]').__kept, document.querySelector('[data-k="b1"]').classList.contains('enter7'), document.querySelector('[data-k="e1"]').classList.contains('enter7')]`)).toEqual([1, true, false]);
    // Unfolded again by its title; nothing went to the app: no keys, no actions.
    await p.click('[data-o7="p:p1"]');
    expect((await p.js(PARTS))[0].shut).toBe(false);
    expect(p.got()).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// A reply done (27 Oct 2026, the owner's picks): a web search shows its query and its sources ("show lines during web
// search, sources"), an answer that pastes a whole file folds to its first lines, Copy is only inside a box ("ONLY KEEP
// IT INSIDE OF THE CODE BOX"), and the end line counts tool calls, not the model's replies.
test.skipIf(needs('chrome', findChrome))('in a real browser: a web search with its sources, a pasted file folded, Copy inside boxes, and the end line in tool calls', async () => {
  const p = await openPage();
  try {
    const t0 = Date.now() - 60_000;
    const sources = Array.from({ length: 6 }, (_, i) => ({ title: `Bun 1.3 notes, part ${i + 1}`, url: `https://www.site${i + 1}.example/bun`, age: i ? null : '2 days ago' }));
    const file = '```html\n' + Array.from({ length: 40 }, (_, i) => `<p>line ${i + 1}</p>`).join('\n') + '\n```';
    const raw = [
      { key: 'u2', type: 'user', text: 'what is new in bun 1.3? and make me a page', cards: [] },
      { key: 'w1', rail: true, type: 'tool', label: 'WebSearch', arg: '"bun 1.3"', view: { kind: 'websearch', count: 6, service: 'Anthropic', query: 'bun 1.3', sources }, at: t0 + 1000, ms: 1200 },
      { key: 'r1', rail: true, type: 'tool', label: 'Read', arg: 'index.html', view: { kind: 'read', lines: 2, total: 2, content: '<p>a</p>\n<p>b</p>' }, at: t0 + 3000, ms: 4 },
      { key: 'a2', rail: true, type: 'text', text: `Here it is:\n\n${file}` },
      { key: 'd2', rail: true, type: 'done', reason: 'done', past: 'Baked', secs: 9, at: t0 + 9000, steps: 1, calls: 2 },
    ];
    await p.say({ ...base, ...turnState(raw, false) });
    expect((await p.js(PARTS))[0].lines).toEqual(['Web search | “bun 1.3” | 6 sources', 'Reading | index.html | ']);
    // the times from the turn's start, as its end line gives it (as they read while it worked)
    expect(await p.js(`[...document.querySelectorAll('.l7 .at')].map((e) => e.textContent)`)).toEqual(['0:01', '0:03']);
    const srcs = () => p.js(`[...document.querySelectorAll('.src7')].map((a) => a.querySelector('.host').textContent + ' ' + a.getAttribute('href'))`);
    expect(await srcs()).toEqual([1, 2, 3, 4].map((i) => `site${i}.example https://www.site${i}.example/bun`));
    expect(await p.js(`document.querySelector('.src7 .age').textContent`)).toBe('2 days ago');
    expect(await p.js(`document.querySelector('.srcmore').textContent`)).toBe('+ 2 more sources');
    await p.click('.srcmore');
    expect((await srcs()).length).toBe(6);
    expect(await p.js(`document.querySelector('.srcmore').textContent`)).toBe('Show fewer');
    // the pasted file: folded to its first lines, opened by its button; Copy in its code box and nowhere beside the message
    const reply = () => p.js(`(() => { const r = document.querySelector('.reply7'); return { open: r.classList.contains('open'), button: r.querySelector('.more7').textContent, h: Math.round(r.querySelector('.rb').getBoundingClientRect().height) }; })()`);
    const shut = await reply();
    expect(shut).toMatchObject({ open: false, button: 'Show all · 44 lines' });
    await p.click('[data-fold7]');
    const open = await reply();
    expect(open).toMatchObject({ open: true, button: 'Show less' });
    expect(open.h).toBeGreaterThan(shut.h * 2);
    expect(await p.js(`[...document.querySelectorAll('.cp7')].map((b) => b.parentElement.firstElementChild.tagName)`)).toEqual(['PRE']);
    // the end line: the reply's tool calls, not its replies
    const end = await p.js(`[...document.querySelectorAll('#items .endline')].at(-1).textContent`);
    expect(end).toContain('2 tool calls');
    expect(end).not.toContain('step');
    expect(p.got()).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// The thinking as it streams (18 Oct 2026, the owner, with three pictures: "fix the thinking too, it moves the whole
// page"; 27 Oct 2026, "NOW EVERUTHING LOOKS CUT OFF"): what streams grows with its text up to five whole lines, its newest
// at the bottom, and nothing above it moves.
test.skipIf(needs('chrome', findChrome))('in a real browser: what streams is five whole lines at most, its newest in, and nothing above it moves', async () => {
  const p = await openPage();
  try {
    const turnStart = Date.now();
    const at = async (thinking) => {
      await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 50, thinking } });
      return p.js(`(() => { const t = document.querySelector('.ch7.live .tail7'), inner = t.firstElementChild; const r = t.getBoundingClientRect(), last = inner.getBoundingClientRect(), lh = parseFloat(getComputedStyle(t).lineHeight); const you = document.querySelector('.you, .user, [data-key="u1"]'); return { h: Math.round(r.height), lines: r.height / lh, hidden: (last.height - r.height) / lh, lastIn: last.bottom <= r.bottom + 1, head: Math.round(document.querySelector('.ch7.live .hd7').getBoundingClientRect().top), status: document.getElementById('status').hidden, you: you ? Math.round(you.getBoundingClientRect().top) : null }; })()`);
    };
    const short = await at('The user wants the totals.');
    const long = await at(Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the thinking, about the totals and the rounding in checkout.`).join('\n'));
    const longer = await at(Array.from({ length: 60 }, (_, i) => `Step ${i + 1}: and more.`).join('\n'));
    expect(short.lines).toBeCloseTo(1, 1);
    for (const r of [long, longer]) {
      expect(r.lines).toBeCloseTo(5, 1);
      expect(Math.abs(r.hidden - Math.round(r.hidden))).toBeLessThan(0.05); // the lines cut off above are whole lines
      expect(r.h).toBe(long.h);
      expect(r.head).toBe(short.head);
      expect(r.you).toBe(short.you);
      expect(r.lastIn).toBe(true);
      expect(r.status).toBe(true); // no status line under the conversation while it works with nothing waiting
    }
    expect(await p.js(`document.querySelector('.ch7.live .tail7').textContent.includes('Step 60: and more.')`)).toBe(true);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// The thinking, then the answer as it comes (18 Oct 2026, the owner: "put thinking in a box, i can expand and collapse
// too?"; 27 Oct 2026, the timeline): the line under way says Thinking with its time bar, a press hides what streams and
// that holds for the next reply; the answer as it comes takes the same place, the line then says Writing.
test.skipIf(needs('chrome', findChrome))('in a real browser: the thinking, then the answer as it comes, under the line under way, hidden by a press and kept so for the next reply', async () => {
  const p = await openPage();
  try {
    const box = () => p.js(`(() => { const part = document.querySelector('.ch7.live'); if (!part) return null; const l = part.querySelector('[data-tail7]'), t = part.querySelector('.tail7'); return { tag: l.querySelector('.tg').textContent, bar: Boolean(l.querySelector('.bar7')), said: l.querySelector('.bv')?.textContent ?? null, tail: t ? t.textContent : null, mono: Boolean(t?.classList.contains('w')), h: Math.round(part.getBoundingClientRect().height) }; })()`);
    const lines = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the thinking.`).join('\n');
    let turnStart = Date.now();
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 50, thinking: lines(3), thinkTokens: 20, thinkStart: Date.now() - 4000 } });
    const open = await box();
    expect(open).toMatchObject({ tag: 'Thinking', bar: true, said: expect.stringMatching(/^20 tokens · \d+\/s$/), mono: false });
    expect(open.tail).toContain('Line 3 of the thinking.');
    await p.click('[data-tail7]');
    const shut = await box();
    expect(shut).toMatchObject({ tag: 'Thinking', bar: true, tail: null });
    expect(shut.h).toBeLessThan(open.h);
    // Hidden, the part stays one height as the thinking grows.
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 90, thinking: lines(40) } });
    expect(await box()).toMatchObject({ tail: null, h: shut.h });
    // The next reply starts hidden too; a press shows it again.
    turnStart += 60_000;
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 5, thinking: 'A new thought.' } });
    expect(await box()).toMatchObject({ tag: 'Thinking', tail: null });
    await p.click('[data-tail7]');
    expect((await box()).tail).toContain('A new thought.');
    // The answer as it comes, the thought still there until the reply ends: Writing, its words counted, in the same place.
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 9, thinking: 'A new thought.', text: 'Here it is.', textStart: Date.now() } });
    expect(await box()).toMatchObject({ tag: 'Writing', bar: true, said: '3 words', mono: true, tail: 'Here it is.' });
    const css = Array.from({ length: 60 }, (_, i) => `.part-${i + 1} { padding: ${i}px; }`).join('\n');
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 900, text: css } });
    expect(await p.js(`(() => { const t = document.querySelector('.ch7.live .tail7'), last = t.firstElementChild.getBoundingClientRect(); return t.textContent.includes('.part-60 { padding: 59px; }') && last.bottom <= t.getBoundingClientRect().bottom + 1; })()`)).toBe(true);
    await p.click('[data-tail7]');
    expect(await box()).toMatchObject({ tag: 'Writing', tail: null });
    expect(p.got()).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);
