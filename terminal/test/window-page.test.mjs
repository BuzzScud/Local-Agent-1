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
    expect(await p.js(`document.querySelector('#live .writing').textContent`)).toContain('The rounding happens in roundCents.');
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
