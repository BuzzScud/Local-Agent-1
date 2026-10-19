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
    expect(await p.js(`document.querySelector('#live .said').textContent`)).toContain('The rounding happens in roundCents.');
    // The answer done: it comes as an item, the live part goes.
    await p.say({ ...base, order: [...base.order, 'a2'], items: { a2: { t: 'text', key: 'a2', text: 'The rounding happens in roundCents.' } } });
    expect(await p.js(`[document.querySelectorAll('#items .reply').length, document.getElementById('live').textContent]`)).toEqual([2, '']);
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

// The task row under way (18 Oct 2026, the owner: "when i click on the dropdown or the boxes to expand or collapse, it
// doesnt work"): it looked clickable and a click did nothing. Its parts open and close in the page, and nothing goes
// to the app.
test.skipIf(needs('chrome', findChrome))('in a real browser: the task row under way opens and closes, its parts done so far and the part under way', async () => {
  const p = await openPage();
  try {
    const step = (k, words) => ({ k, words });
    const held = {
      t: 'live', first: true,
      run: { label: 'EXPLORING', color: '#5fafff', last: 'Read the server and its tests', rows: [
        { id: 'r-server', words: 'Read the server', said: true, facts: { steps: 2 }, steps: [step('read', 'server.mjs'), step('read', 'routes.mjs')] },
        { id: 'r-tests', words: 'Read its tests', said: true, facts: { steps: 1 }, steps: [step('read', 'server.test.mjs')] },
      ] },
      now: { label: 'EDITING', color: '#d7af00', words: 'Fixing the rounding', steps: [step('read', 'cart.mjs'), step('edit', 'cart.mjs')], n: 2 },
    };
    const turnStart = Date.now();
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 3 }, held });
    const live = () => p.js(`(() => { const rows = [...document.querySelectorAll('#live .trow')]; return rows.map((r) => ({ open: Boolean(r.querySelector('.task .chev.open')), rows: [...r.querySelectorAll('.rowx')].map((x) => x.querySelector('.w').textContent), steps: r.querySelectorAll('.step').length })); })()`);
    // At first: the parts done so far closed, the part under way open with its steps.
    expect(await live()).toEqual([{ open: false, rows: [], steps: 0 }, { open: true, rows: [], steps: 2 }]);
    // The part under way closes and opens.
    await p.click('#live .trow .task', 1);
    expect(await live()).toEqual([{ open: false, rows: [], steps: 0 }, { open: false, rows: [], steps: 0 }]);
    await p.click('#live .trow .task', 1);
    expect((await live())[1]).toEqual({ open: true, rows: [], steps: 2 });
    // The parts done so far open, and a row of them opens its steps.
    await p.click('#live .trow .task', 0);
    expect((await live())[0]).toEqual({ open: true, rows: ['Read the server', 'Read its tests'], steps: 0 });
    await p.click('#live .rowx', 0);
    expect((await live())[0].steps).toBe(2);
    // The next state of the same reply keeps what was opened.
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 9 }, held: { ...held, now: { ...held.now, steps: [...held.now.steps, step('ran', 'npm test')], n: 3 } } });
    expect(await live()).toEqual([{ open: true, rows: ['Read the server', 'Read its tests'], steps: 2 }, { open: true, rows: [], steps: 3 }]);
    await p.click('#live .trow .task', 0);
    expect((await live())[0]).toEqual({ open: false, rows: [], steps: 0 });
    // Nothing went to the app: no keys, no actions.
    expect(p.got()).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// The thinking as it streams (18 Oct 2026, the owner, with three pictures: "fix the thinking too, it moves the whole
// page"): the last 400 characters of it were 2 lines one moment and 12 the next, so everything around it jumped.
test.skipIf(needs('chrome', findChrome))('in a real browser: the thinking as it streams keeps one height, shows its newest line, and nothing around it moves', async () => {
  const p = await openPage();
  try {
    const turnStart = Date.now();
    const at = async (thinking) => {
      await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 50, thinking } });
      return p.js(`(() => { const t = document.querySelector('#live .thinking'); const r = t.getBoundingClientRect(), last = t.firstElementChild.getBoundingClientRect(); const you = [...document.querySelectorAll('.you, .user, [data-key="u1"]')][0]; return { h: Math.round(r.height), bottom: Math.round(r.bottom), live: Math.round(document.getElementById('live').getBoundingClientRect().height), lastIn: last.bottom <= r.bottom + 1, status: Math.round(document.getElementById('status').getBoundingClientRect().top), scroll: document.getElementById('convo').scrollTop, you: you ? Math.round(you.getBoundingClientRect().top) : null }; })()`);
    };
    const short = await at('The user wants the totals.');
    const long = await at(Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the thinking, about the totals and the rounding in checkout.`).join('\n'));
    const longer = await at(Array.from({ length: 60 }, (_, i) => `Step ${i + 1}: and more.`).join('\n'));
    for (const r of [long, longer]) {
      expect(r.h).toBe(short.h);
      expect(r.live).toBe(short.live);
      expect(r.status).toBe(short.status);
      expect(r.you).toBe(short.you);
      expect(r.lastIn).toBe(true);
    }
    expect(await p.js(`document.querySelector('#live .thinking').textContent.includes('Step 60: and more.')`)).toBe(true);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// The thinking in a box (18 Oct 2026, the owner: "put thinking in a box, i can expand and collapse too?"): a header as a
// task row's; open at first with the newest lines, a click closes it to one row with the newest line, and that holds for
// the next reply too. Nothing goes to the app.
test.skipIf(needs('chrome', findChrome))('in a real browser: the thinking, then the answer as it comes, is a box that opens and closes, one row closed whatever its length, kept for the next reply', async () => {
  const p = await openPage();
  try {
    const box = () => p.js(`(() => { const b = document.querySelector('#live .trow.think'); if (!b) return null; return { tag: b.querySelector('.tag').textContent, words: b.querySelector('.w').textContent, open: b.querySelector('.chev').classList.contains('open'), body: Boolean(b.querySelector('.thinking')), h: Math.round(b.getBoundingClientRect().height) }; })()`);
    const lines = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the thinking.`).join('\n');
    let turnStart = Date.now();
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 50, thinking: lines(3) } });
    const open = await box();
    expect(open).toMatchObject({ tag: 'THINKING', open: true, body: true });
    await p.click('#live .trow.think .task', 0);
    const shut = await box();
    expect(shut).toMatchObject({ open: false, body: false, words: 'Line 3 of the thinking.' });
    expect(shut.h).toBeLessThan(open.h);
    // Closed, it stays one row as the thinking grows, its newest line in the header.
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 90, thinking: lines(40) } });
    expect(await box()).toMatchObject({ open: false, words: 'Line 40 of the thinking.', h: shut.h });
    // The next reply starts closed too.
    turnStart += 60_000;
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 5, thinking: 'A new thought.' } });
    expect(await box()).toMatchObject({ open: false, words: 'A new thought.' });
    await p.click('#live .trow.think .task', 0);
    expect(await box()).toMatchObject({ open: true, body: true, h: open.h });
    // The answer as it comes takes its place, in the same box ("thinking isnt in a box … like, what the agent is doing":
    // a reply streaming its CSS line by line ran down the page): one height however long it gets, its newest line in.
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 9, thinking: 'A new thought.', text: 'Here it is.' } });
    expect(await box()).toMatchObject({ tag: 'ANSWERING', open: true, body: true, h: open.h });
    const css = Array.from({ length: 60 }, (_, i) => `.part-${i + 1} { padding: ${i}px; }`).join('\n');
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 900, text: css } });
    expect(await box()).toMatchObject({ tag: 'ANSWERING', h: open.h });
    expect(await p.js(`(() => { const t = document.querySelector('#live .said'), last = t.firstElementChild.getBoundingClientRect(); return t.textContent.includes('.part-60 { padding: 59px; }') && last.bottom <= t.getBoundingClientRect().bottom + 1; })()`)).toBe(true);
    await p.click('#live .trow.think .task', 0);
    expect(await box()).toMatchObject({ tag: 'ANSWERING', open: false, words: '.part-60 { padding: 59px; }', h: shut.h });
    expect(p.got()).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);
