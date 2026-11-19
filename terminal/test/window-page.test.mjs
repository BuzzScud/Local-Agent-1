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
import { meterOf, modelNowOf, effortWords, askBoxOf } from '../src/window/bridge.mjs';
import { askState, askKey } from '../src/app/app-ask.mjs';
import { askedQuestions } from '../src/agent/questions.mjs';
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
  // Another window asked for (+ New, ⌘N, a chat's ↗) is written down here, never opened.
  const opened = [];
  const done = runWindow({ folder, open: false, command: [process.execPath, standIn], env: { ...process.env, AUDIT_LOG: log, AUDIT_STATE: stateFile }, onUrl: (u) => { url = u; }, say: () => {}, another: (at, more) => opened.push([at, more]) });
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
  return { say, js, click, type, press, on, got, errors, close, folder, opened };
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
    // More than one chat at a time (19 Nov 2026): a chat's ↗ opens it in a window of its own, this one keeps its own
    // (no resume here), and the side bar closes; + New opens a new chat in another window, not /clear here.
    const resumesBefore = p.got().filter((m) => m.do === 'resume').length;
    await p.click('#side [data-newwin]', 1);
    for (let i = 0; i < 40 && !p.opened.length; i++) await Bun.sleep(50);
    expect(p.opened).toEqual([[p.folder, ['--resume', 'conv-tax']]]);
    expect(p.got().filter((m) => m.do === 'resume').length).toBe(resumesBefore);
    expect(await p.js(`document.getElementById('side').classList.contains('open')`)).toBe(false);
    await p.click('[data-act="newwin"]');
    for (let i = 0; i < 40 && p.opened.length < 2; i++) await Bun.sleep(50);
    expect(p.opened[1]).toEqual([p.folder, []]);
    expect(p.got().filter((m) => m.from === 'keys').map((m) => m.data).join('')).not.toContain('/clear');
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
    // Reduce motion: the caret holds still, and the spinner is one still mark (Claude Code's ✻ since 19 Nov 2026).
    expect(await p.js(`getComputedStyle(document.querySelector('.caret')).animationName`)).toBe('blink');
    await p.on('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await p.say({ ...base, input: { value: 'hi', cursor: 2 }, live: { phase: 'working', turnStart: Date.now(), tokens: 3, text: '' } });
    expect(await p.js(`getComputedStyle(document.querySelector('.caret')).animationName`)).toBe('none');
    const marks = [];
    for (let i = 0; i < 4; i++) { marks.push(await p.js(`document.querySelector('.ac')?.textContent.slice(0, 1)`)); await Bun.sleep(300); }
    expect(new Set(marks)).toEqual(new Set(['✻']));
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

// The bottom of the window (19 Nov 2026, the owner: "clean up the bottom area … hide all of the buttons in the bypass button
// and if we want to change the mode, its a pop up menu"; their pick "A · Claude Code"): the prompt in a box with no paste
// hint and an arrow for Send, one row under it with the mode as its only button, and a pop-up that picks a mode by a
// click, a number or the arrows and enter. shift+tab still goes to the app, which cycles all but Bypass.
test.skipIf(needs('chrome', findChrome))('in a real browser: the box and one row under it; the mode button opens a pop-up that picks by click, number and arrows', async () => {
  const p = await openPage();
  try {
    await p.say({ ...base, mode: 'bypass' });
    const row = () => p.js(`(() => { const r = document.querySelector('.modes'); return { text: r.textContent, buttons: r.querySelectorAll('button').length, mode: r.querySelector('.modeb').className }; })()`);
    expect(await row()).toEqual({ text: '⏵⏵ bypass permissions on ▾(shift+tab to cycle)Stand-in·project', buttons: 1, mode: 'modeb bypass' });
    expect(await p.js(`[document.getElementById('prompt').textContent, document.querySelector('.send').title]`)).toEqual(['❯Ask anything', 'Send ⏎']);
    const modes = () => p.got().filter((m) => m.from === 'socket' && m.do === 'mode').map((m) => m.mode);
    const pop = () => p.js(`(() => { const m = document.getElementById('mpop'); return m ? [...m.querySelectorAll('.it')].map((i) => i.querySelector('.l').textContent + (i.querySelector('.c').textContent ? ' ✓' : '') + (i.classList.contains('cur') ? ' <' : '')) : null; })()`);
    // a click opens it over the button, the mode now ticked and the keys' place on it; a number picks and closes it
    await p.click('[data-act="modes"]');
    expect(await pop()).toEqual(['Manual', 'Accept edits', 'Plan', 'Auto', 'Bypass permissions ✓ <']);
    expect(await p.js(`(() => { const m = document.getElementById('mpop').getBoundingClientRect(), b = document.querySelector('.modeb').getBoundingClientRect(); return m.bottom <= b.top && m.left >= 0 && m.top >= 0; })()`)).toBe(true);
    await p.press('2', 50);
    expect([modes(), await pop()]).toEqual([['edits'], null]);
    // the arrows and enter
    await p.say({ ...base, mode: 'edits' });
    await p.click('[data-act="modes"]');
    expect((await pop())[1]).toBe('Accept edits ✓ <');
    await p.press('ArrowDown', 40);
    await p.press('ArrowDown', 40);
    expect((await pop())[3]).toBe('Auto <');
    await p.press('Enter', 13);
    expect(modes()).toEqual(['edits', 'auto']);
    // a click on a mode; esc and a click outside close it with nothing sent; picking the mode it is in sends nothing
    await p.click('[data-act="modes"]');
    await p.click('#mpop [data-mode="plan"]');
    expect(modes()).toEqual(['edits', 'auto', 'plan']);
    await p.click('[data-act="modes"]');
    await p.press('Escape', 27);
    expect(await pop()).toBe(null);
    await p.click('[data-act="modes"]');
    await p.click('#items');
    expect(await pop()).toBe(null);
    await p.click('[data-act="modes"]');
    await p.click('#mpop [data-mode="edits"]');
    expect(modes()).toEqual(['edits', 'auto', 'plan']);
    // none of those keys reached the app; with the pop-up shut shift+tab does
    expect(p.got().filter((m) => m.from === 'keys')).toEqual([]);
    await p.press('Tab', 9, true);
    expect(p.got().filter((m) => m.from === 'keys').map((m) => m.data)).toEqual(['\x1b[Z']);
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

// The Usage card on the Claude API (19 Nov 2026, the owner): a Change API key button runs /remote key, which opens
// the form of the service in use typing in its key row.
test.skipIf(needs('chrome', findChrome))('in a real browser: the Usage card’s Change API key runs /remote key', async () => {
  const p = await openPage();
  try {
    const usage = { spent: 27.68, cap: null, resetsOn: Date.UTC(2026, 11, 1), month: 'November', today: 15.28, window: 0.55, last14: Array(14).fill(0), modelName: 'Opus 5.5' };
    await p.say({ ...base, usage });
    await p.click('[data-act="usage"]');
    expect(await p.js(`[...document.querySelectorAll('#ucard button')].map((b) => b.textContent)`)).toEqual(['Open /usage', 'Change API key']);
    await p.click('#ucard [data-run="/remote key"]');
    expect(p.got().filter((m) => m.from === 'keys').map((m) => m.data).join('')).toContain('/remote key\r');
    expect(await p.js(`Boolean(document.getElementById('ucard'))`)).toBe(false); // the card closes
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

// The model's questions in the window (19 Nov 2026, the owner: "i also cant select the answer correctly"): four questions
// showed as one "Type something…" row, and a click counted its arrows from row 0, not from the row the box was on.
test.skipIf(needs('chrome', findChrome))('in a real browser: the model\'s questions show a tab each with their choices, and a click picks the choice clicked from the row the box is on', async () => {
  const p = await openPage();
  try {
    const questions = askedQuestions({
      question: 'What bothers you most?', options: [{ label: 'Hard to follow', about: 'Steps blur together' }, { label: 'Too cluttered' }, { label: 'Changes hard to read' }],
      more: [{ header: 'Look', question: 'What feel?', options: ['Calm', 'Dense'] }, { header: 'Parts', question: 'Which parts?', options: ['Top bar', 'Prompt'], several: true }],
    });
    const req = { name: 'Ask', args: { questions } };
    let box = askState(req);
    for (let i = 0; i < 2; i++) box = askKey(req, box, '', { downArrow: true }).box; // the keyboard left it on row 2
    const ask = (b) => ({ ...base, perm: { name: 'Ask', options: [], selected: 0, box: askBoxOf(b) } });
    await p.say(ask(box));
    const keysSent = () => p.got().filter((m) => m.from === 'keys').map((m) => m.data).join('');
    expect(await p.js(`[...document.querySelectorAll('.atab')].map((e) => e.textContent)`)).toEqual(['Question 1', 'Look', 'Parts', 'Submit']);
    expect(await p.js(`document.querySelector('.perm .q').textContent`)).toBe('What bothers you most?');
    expect(await p.js(`[...document.querySelectorAll('.aopt .lb')].map((e) => e.textContent)`)).toEqual(['Hard to follow', 'Too cluttered', 'Changes hard to read']);
    expect(await p.js(`document.querySelector('.aopt .ab').textContent`)).toBe('Steps blur together');
    expect(await p.js(`document.querySelector('.aopt.on').dataset.aopt`)).toBe('2');
    // A click on the first choice: up twice from row 2, then Enter
    await p.click('[data-aopt="0"]');
    expect(keysSent()).toBe('\x1b[A\x1b[A\r');
    // The box on the third question (several may be ticked): a click ticks, a tab goes to its question
    box = { ...box, at: 2 };
    await p.say(ask(box));
    expect(await p.js(`[...document.querySelectorAll('.aopt .mk')].map((e) => e.textContent)`)).toEqual(['☐', '☐', '✎']);
    await p.click('[data-aopt="1"]');
    expect(keysSent()).toBe('\x1b[A\x1b[A\r\x1b[B ');
    await p.click('[data-atab="0"]');
    expect(keysSent()).toBe('\x1b[A\x1b[A\r\x1b[B \x1b[Z\x1b[Z');
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
// Each part as drawn (19 Nov 2026, Claude Code's lines): its head (▸ a to-do, ⏺ the model's line), under way or folded, its
// lines (the tool's name or the model's words | (what it was on) | how it went, after ⎿), what is open. The step under way
// is the spinner line, read on its own (LIVE).
const PARTS = `[...document.querySelectorAll('#items .ch7')].map((el) => { const h = el.querySelector('.hd7:not(.none)'); return { title: h ? (h.querySelector('.pl7') ? '▸ ' : '⏺ ') + h.querySelector('.ti').firstChild.textContent.trim() : '', live: el.classList.contains('live'), shut: el.classList.contains('shut'), lines: [...el.querySelectorAll('.tl7 > .s7 > .l7:not(.live)')].map((l) => { const sub = l.nextElementSibling?.classList.contains('sub7') ? l.nextElementSibling.querySelector('.v').textContent : ''; return [l.querySelector('.nm, .sy').textContent, l.querySelector('.ar')?.textContent ?? '', sub].join(' | '); }), thoughts: el.querySelector('.th7')?.textContent ?? null, open: el.querySelectorAll('.det7').length }; })`;
const LIVE = `(() => { const l = document.querySelector('.ch7.live .l7.live'); return l ? [l.querySelector('.vb').textContent, l.querySelector('.ar')?.textContent ?? '', l.querySelector('.mt').textContent] : null; })()`;

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
    // the plan named each part; the model's line stays as its first line; a finished thought is hidden behind one line;
    // the part under way ends with the step under way
    expect(await p.js(PARTS)).toEqual([
      { title: '▸ Find the bug', live: false, shut: false, open: 0, thoughts: '∴ 1 thought hidden · show thinking', lines: ['Looking at the cart first. |  | ', 'Update Todos |  | 2 to-dos · 0 done', 'Read | (cart.mjs) | '] },
      { title: '▸ Fix and test it', live: true, shut: false, open: 0, thoughts: null, lines: ['Update Todos |  | 2 to-dos · 1 done', 'Update | (cart.mjs) | +1 −1'] },
    ]);
    // when each step started from the turn's start and how long it took, in its tip (the model's line has neither), and
    // the spinner line: what it does now, for how long, the turn's counts
    expect(await p.js(`[...document.querySelectorAll('.ch7')[0].querySelectorAll('.tl7 .l7')].map((l) => l.title)`)).toEqual(['', '0:02 · 0.0 s', '0:03 · 0.0 s']);
    const live = await p.js(LIVE);
    expect(live.slice(0, 2)).toEqual(['Testing…', 'bun test']);
    expect(live[2]).toMatch(/^\(\d+\.\d s · 4 calls · 12 thinking · 1m 0\ds in all · esc to interrupt\)$/);
    // the thought shows on a press of its line, kept for the next state, and hides again
    await p.click('[data-thinks7]');
    expect((await p.js(PARTS))[0]).toMatchObject({ thoughts: '∴ 1 thought · hide thinking', lines: ['Looking at the cart first. |  | ', 'Update Todos |  | 2 to-dos · 0 done', 'Read | (cart.mjs) | ', 'Thought for 2.5 s | It floors. | '] });
    await p.click('[data-thinks7]');
    expect((await p.js(PARTS))[0].lines).toHaveLength(3);
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
    expect(now[1].lines).toEqual(['Update Todos |  | 2 to-dos · 1 done', 'Update | (cart.mjs) | +1 −1', 'Bash | (bun test) | ✗ 1 failed · 0.9 s']);
    expect(await p.js(LIVE)).toEqual(['Thinking…', '', expect.stringMatching(/^\(\d+\.\d s · ↓ 0 tokens · 5 calls · 12 thinking · /)]);
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
    expect((await p.js(PARTS))[0].lines).toEqual(['Web Search | (“bun 1.3”) | 6 sources', 'Read | (index.html) | ']);
    // the times from the turn's start, as its end line gives it (as they read while it worked)
    expect(await p.js(`[...document.querySelectorAll('.l7')].map((e) => e.title)`)).toEqual(['0:01 · 1.2 s', '0:03 · 0.0 s']);
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
      return p.js(`(() => { const t = document.querySelector('.ch7.live .tail7'), inner = t.firstElementChild; const r = t.getBoundingClientRect(), last = inner.getBoundingClientRect(), lh = parseFloat(getComputedStyle(t).lineHeight); const you = document.querySelector('.you, .user, [data-key="u1"]'); return { h: Math.round(r.height), lines: r.height / lh, hidden: (last.height - r.height) / lh, lastIn: last.bottom <= r.bottom + 1, head: Math.round(document.querySelector('.ch7.live .l7.live').getBoundingClientRect().top), status: document.getElementById('status').hidden, you: you ? Math.round(you.getBoundingClientRect().top) : null }; })()`);
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
    const box = () => p.js(`(() => { const part = document.querySelector('.ch7.live'); if (!part) return null; const l = part.querySelector('[data-tail7]'), t = part.querySelector('.tail7'); return { tag: l.querySelector('.vb').textContent, said: l.querySelector('.mt').textContent.split(' · ').slice(1, 3).join(' · '), tail: t ? t.textContent : null, mono: Boolean(t?.classList.contains('w')), h: Math.round(part.getBoundingClientRect().height) }; })()`);
    const lines = (n) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the thinking.`).join('\n');
    let turnStart = Date.now();
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 50, thinking: lines(3), thinkTokens: 20, thinkStart: Date.now() - 4000 } });
    const open = await box();
    expect(open).toMatchObject({ tag: 'Thinking…', said: expect.stringMatching(/^↓ 20 tokens · \d+\/s$/), mono: false });
    expect(open.tail).toContain('Line 3 of the thinking.');
    await p.click('[data-tail7]');
    const shut = await box();
    expect(shut).toMatchObject({ tag: 'Thinking…', tail: null });
    expect(shut.h).toBeLessThan(open.h);
    // Hidden, the part stays one height as the thinking grows.
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 90, thinking: lines(40) } });
    expect(await box()).toMatchObject({ tail: null, h: shut.h });
    // The next reply starts hidden too; a press shows it again.
    turnStart += 60_000;
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 5, thinking: 'A new thought.' } });
    expect(await box()).toMatchObject({ tag: 'Thinking…', tail: null });
    await p.click('[data-tail7]');
    expect((await box()).tail).toContain('A new thought.');
    // The answer as it comes, the thought still there until the reply ends: Writing, its words counted, in the same place.
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 9, thinking: 'A new thought.', text: 'Here it is.', textStart: Date.now() } });
    expect(await box()).toMatchObject({ tag: 'Writing…', said: expect.stringMatching(/^3 words · /), mono: true, tail: 'Here it is.' });
    const css = Array.from({ length: 60 }, (_, i) => `.part-${i + 1} { padding: ${i}px; }`).join('\n');
    await p.say({ ...base, live: { phase: 'working', turnStart, tokens: 900, text: css } });
    expect(await p.js(`(() => { const t = document.querySelector('.ch7.live .tail7'), last = t.firstElementChild.getBoundingClientRect(); return t.textContent.includes('.part-60 { padding: 59px; }') && last.bottom <= t.getBoundingClientRect().bottom + 1; })()`)).toBe(true);
    await p.click('[data-tail7]');
    expect(await box()).toMatchObject({ tag: 'Writing…', tail: null });
    expect(p.got()).toEqual([]);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

// A picture you attach shows in the window (19 Nov 2026, the owner: "when i attach a screenshot or image, it shows in
// the agentic coder"): the prompt's tray draws each picture as itself over the box (the window server serves only the
// files the app named), a click shows it full size and esc closes it, a sent message shows its pictures, and ⌘V of a
// copied screenshot goes to the app as ctrl+v (its own key for the clipboard's picture) while text still pastes as text.
test.skipIf(needs('chrome', findChrome))('in a real browser: an attached picture shows over the box and in the sent message, opens full size, and ⌘V of a picture goes as ctrl+v', async () => {
  const p = await openPage();
  try {
    // a real PNG, 2×2 red, and one the app never named
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
    const shot = join(p.folder, 'Screenshot 2026-11-19 at 9.41.07 AM.png'), other = join(p.folder, 'secret.png');
    writeFileSync(shot, png); writeFileSync(other, png);
    const tray = [{ n: 1, token: '[Image #1]', kind: 'image', name: 'Screenshot 9.41 AM', size: '2×2 · 75 B', file: shot }, { n: 2, token: '[PDF #2]', kind: 'pdf', name: 'invoice.pdf', size: 'PDF · 1 page · 9 KB', file: null }];
    await p.say({ ...base, input: { value: 'what is wrong here? [Image #1] [PDF #2] ', cursor: 40 }, tray });
    for (let i = 0; i < 40 && !(await p.js(`document.querySelector('#tray .pic img')?.complete && document.querySelector('#tray .pic img').naturalWidth > 0`)); i++) await Bun.sleep(50);
    expect(await p.js(`[...document.querySelectorAll('#tray .tcard')].map((c) => c.textContent)`)).toEqual(['[Image #1]Screenshot 9.41 AM2×2 · 75 B', 'PDF[PDF #2]invoice.pdfPDF · 1 page · 9 KB']);
    expect(await p.js(`document.querySelector('#tray .pic img').naturalWidth`)).toBe(2);
    // only what the app named is served
    expect(await p.js(`fetch('/pic?t=' + T + '&f=' + encodeURIComponent(${JSON.stringify(other)})).then((r) => r.status)`)).toBe(404);
    expect(await p.js(`fetch('/pic?f=' + encodeURIComponent(${JSON.stringify(shot)})).then((r) => r.status)`)).toBe(403);
    // typing draws the box again, never the tray's pictures
    await p.js(`window.__img = document.querySelector('#tray .pic img')`);
    await p.say({ ...base, input: { value: 'what is wrong here? [Image #1] [PDF #2] x', cursor: 41 }, tray });
    expect(await p.js(`document.querySelector('#tray .pic img') === window.__img`)).toBe(true);
    // a click: full size; esc closes it and nothing goes to the app
    const keysBefore = p.got().filter((m) => m.from === 'keys').length;
    await p.click('#tray .pic');
    expect(await p.js(`Boolean(document.querySelector('#picfull img'))`)).toBe(true);
    await p.press('Escape', 27);
    expect(await p.js(`Boolean(document.getElementById('picfull'))`)).toBe(false);
    expect(p.got().filter((m) => m.from === 'keys').length).toBe(keysBefore);
    // ⌘V of a copied screenshot: ctrl+v to the app; text: as text
    await p.js(`(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' })); dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await p.js(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'hello'); dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await Bun.sleep(300);
    const typed = p.got().filter((m) => m.from === 'keys').map((m) => m.data).join('');
    expect(typed).toContain('\x16');
    expect(typed).toContain('\x1b[200~hello\x1b[201~');
    expect(typed).not.toContain('image.png');
    // sent: the message shows its picture; the box's tray is gone
    const u2 = { t: 'user', key: 'u2', text: 'what is wrong here? [Image #1]', cards: ['▣ [Image #1] Screenshot 9.41 AM · 2×2 · 75 B'], pics: [{ n: 1, file: shot, name: 'shot.png' }] };
    await p.say({ ...base, order: [...base.order, 'u2'], items: { u2 }, input: { value: '', cursor: 0 }, tray: [] });
    for (let i = 0; i < 40 && !(await p.js(`document.querySelector('.you .pics .pic img')?.naturalWidth > 0`)); i++) await Bun.sleep(50);
    expect(await p.js(`document.querySelector('.you .pics .pic img').naturalWidth`)).toBe(2);
    expect(await p.js(`document.querySelectorAll('#tray').length`)).toBe(0);
    // nothing makes the window scroll sideways
    expect(await p.js(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);
