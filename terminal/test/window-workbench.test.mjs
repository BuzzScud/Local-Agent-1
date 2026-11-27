// The workbench in the window's real page (26 Nov 2026; terminal/src/window/workbench.js, workbench-host.js, workbench.mjs):
// the real page from the real window server on a small project, a stand-in app behind it, and a headless Chrome clicked
// and typed into over the DevTools protocol, as window-page.test.mjs does. What must hold: the window opens as it did,
// with the activity bar beside the conversation; Files, Search and Source control answer from the folder; a file opens
// in VS Code's editor part in tabs and side by side; the palette goes to a file and runs a command; a key typed in the
// editor, a pane or the terminal never reaches the app; a save writes the file and a broken one shows under Problems;
// a file something else changed shows in its tab; the terminal pane runs a real command in the folder; and with no
// editor part to load, a file opens in a plain box and saves.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runWindow } from '../src/window/server.mjs';
import { findChrome } from '../src/flows/layoutcheck.mjs';
import { needs } from './needs.mjs';

const STAND_IN = `
import net from 'node:net';
import { readFileSync, appendFileSync, statSync } from 'node:fs';
const note = (m) => appendFileSync(process.env.AUDIT_LOG, JSON.stringify(m) + '\\n');
const s = net.connect(process.env.AGENTIC_WINDOW_SOCK);
let seen = 0;
const say = () => { try { const at = statSync(process.env.AUDIT_STATE).mtimeMs; if (at === seen) return; seen = at; s.write(JSON.stringify({ t: 'state', now: Date.now(), ...JSON.parse(readFileSync(process.env.AUDIT_STATE, 'utf8')) }) + '\\n'); } catch {} };
s.on('connect', () => { s.write(JSON.stringify({ t: 'hi', key: process.env.AGENTIC_WINDOW_KEY }) + '\\n'); say(); setInterval(say, 30); });
s.on('data', () => {});
process.stdin.setRawMode?.(true);
process.stdin.on('data', (d) => note({ from: 'keys', data: String(d) }));
`;
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
const META = 4, SHIFT = 8, CTRL = 2;

// A small shop in git with one change waiting, the real window server on it, and a Chrome on the window's page.
async function openWorkbench() {
  const folder = join(realpathSync(mkdtempSync(join(tmpdir(), 'wbx-page-'))), 'shop');
  mkdirSync(join(folder, 'src'), { recursive: true });
  writeFileSync(join(folder, 'src', 'price.mjs'), 'export const TAX = 0.2;\n\nexport function applyDiscount(price, percent) {\n  return price - price * (percent / 100);\n}\n');
  writeFileSync(join(folder, 'src', 'cart.mjs'), "import { applyDiscount } from './price.mjs';\nexport const cart = (n) => applyDiscount(n, 10);\n");
  writeFileSync(join(folder, 'README.md'), '# Shop\n\nPrices and a cart.\n');
  git(folder, 'init', '-q', '-b', 'main'); git(folder, 'add', '-A'); git(folder, 'commit', '-q', '-m', 'the shop');
  writeFileSync(join(folder, 'src', 'price.mjs'), 'export const TAX = 0.2;\n\nexport function applyDiscount(price, percent) {\n  return Math.max(0, price - price * (percent / 100));\n}\n');
  const work = mkdtempSync(join(tmpdir(), 'wbx-page-run-'));
  const log = join(work, 'got.jsonl'), stateFile = join(work, 'state.json'), standIn = join(work, 'stand-in.mjs');
  writeFileSync(log, ''); writeFileSync(standIn, STAND_IN);
  const items = { u1: { t: 'user', key: 'u1', text: 'never a negative price', cards: [] }, a1: { t: 'text', key: 'a1', text: 'Done.' } };
  writeFileSync(stateFile, JSON.stringify({ order: Object.keys(items), items, mode: 'ask', modelName: 'Stand-in', cwdShort: '~/shop', input: { value: '', cursor: 0 }, placeholder: 'Ask anything', live: { phase: 'idle' }, files: [], todos: [], stats: {} }));
  let url = null;
  const done = runWindow({ folder, open: false, command: [process.execPath, standIn], env: { ...process.env, AUDIT_LOG: log, AUDIT_STATE: stateFile }, onUrl: (u) => { url = u; }, say: () => {}, another: () => {} });
  for (let i = 0; i < 200 && !url; i++) await Bun.sleep(25);
  const chrome = Bun.spawn([findChrome(), '--headless', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--in-process-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wbx-page-chrome-'))}`, '--remote-debugging-port=0', 'about:blank'], { stderr: 'pipe', stdout: 'ignore' });
  let devtools = null;
  const reader = chrome.stderr.getReader();
  for (let text = ''; !devtools;) { const { value, done: end } = await reader.read(); if (end) break; text += new TextDecoder().decode(value); devtools = /DevTools listening on (ws:\S+)/.exec(text)?.[1] ?? null; }
  const ws = new WebSocket(devtools);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const waiting = new Map(), errors = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); };
  const call = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++seq; waiting.set(id, (m) => (m.error ? bad(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const on = (m, p) => call(m, p, sessionId);
  await on('Runtime.enable');
  await on('Emulation.setDeviceMetricsOverride', { width: 1500, height: 860, deviceScaleFactor: 1, mobile: false });
  await on('Page.navigate', { url });
  const js = async (expression) => { const r = await on('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expression, ms = 10_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expression).catch(() => false)) return true; await Bun.sleep(60); } return false; };
  const click = async (sel, text = null) => {
    const at = await js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})]${text ? `.filter((x) => x.textContent.includes(${JSON.stringify(text)}))` : ''}[0]; if (!e) return null; e.scrollIntoView?.({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2 }; })()`);
    if (!at) throw new Error(`nothing at ${sel} ${text ?? ''}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await on('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await Bun.sleep(200);
  };
  const type = async (text) => { for (const ch of text) { await on('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch }); await on('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); } await Bun.sleep(150); };
  const press = async (key, code, modifiers = 0, text) => { await on('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, modifiers, ...(text ? { text } : {}) }); await on('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers }); await Bun.sleep(200); };
  const typed = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.from === 'keys').map((m) => m.data).join('');
  const state = async () => JSON.parse(await js(`JSON.stringify(window.WB.state())`));
  const close = async () => { ws.close(); chrome.kill(); process.emit('SIGTERM'); await Promise.race([done, Bun.sleep(4000)]); };
  await until(`Boolean(window.WB)`);
  return { folder, js, until, click, type, press, typed, state, errors, close };
}

test.skipIf(needs('chrome', findChrome))('in a real browser: the window opens as it did with the activity bar; Files, tabs side by side, Search, Source control and the palette work on the folder', async () => {
  const p = await openWorkbench();
  try {
    // as before: the conversation has the window, and the workbench is only its bar at the left edge
    expect(await p.state()).toMatchObject({ view: null, panel: null, main: false });
    expect(await p.js(`document.getElementById('body').getBoundingClientRect().width > 1300 && document.querySelector('.wbx-act').getBoundingClientRect().width < 60`)).toBe(true);
    expect(await p.js(`document.getElementById('convo').textContent.includes('never a negative price')`)).toBe(true);
    // Files: the folder's own entries, folders first; a file opens in the editor part, coloured, as a tab
    await p.click('.wbx-act button');
    expect(await p.until(`document.querySelectorAll('.wbx-side-b .wbx-row').length === 2`)).toBe(true);
    expect(await p.js(`[...document.querySelectorAll('.wbx-side-b .wbx-row .nm')].map((e) => e.textContent)`)).toEqual(['src', 'README.md']);
    await p.click('.wbx-side-b .wbx-row', 'src');
    expect(await p.until(`document.querySelectorAll('.wbx-side-b .wbx-row').length === 4`)).toBe(true);
    expect(await p.js(`document.querySelector('.wbx-side-b .wbx-row .tag.changed')?.textContent`)).toBe('•'); // src holds a change
    await p.click('.wbx-side-b .wbx-row', 'price.mjs');
    expect(await p.until(`window.WB.state().editor && Boolean(document.querySelector('.wbx-ed .monaco-editor'))`, 20_000)).toBe(true);
    expect(await p.until(`document.querySelectorAll('.wbx-ed .view-line span[class*="mtk"]').length > 4`)).toBe(true);
    // with a file open the editor has the room and the conversation a column on the right
    expect(await p.js(`(() => { const b = document.getElementById('body').getBoundingClientRect(), m = document.querySelector('.wbx-main').getBoundingClientRect(); return b.width < 720 && m.width > 400 && b.left >= m.right - 2; })()`)).toBe(true);
    await p.click('.wbx-side-b .wbx-row', 'cart.mjs');
    await p.press('\\', 220, META);
    expect((await p.state()).tabs).toEqual([['f:src/price.mjs', 'f:src/cart.mjs'], ['f:src/cart.mjs']]);
    // Search: every file, the match marked; a click opens the file at that line
    await p.press('f', 70, META | SHIFT);
    await p.until(`Boolean(document.querySelector('.wbx-form input'))`);
    await p.type('applyDiscount');
    expect(await p.until(`document.querySelectorAll('.wbx-res .wbx-hit mark').length === 3`)).toBe(true);
    expect(await p.js(`document.querySelector('.wbx-res .wbx-note').textContent`)).toBe('3 results in 2 files');
    await p.click('.wbx-res .wbx-row', 'export function');
    expect(await p.until(`window.monaco.editor.getEditors().some((e) => e.getModel()?.uri.path === '/src/price.mjs' && e.getSelection().startLineNumber === 3 && e.getSelection().startColumn === 17)`)).toBe(true);
    // Source control: the branch, the one change, and its two sides in the diff view
    await p.press('g', 71, CTRL | SHIFT);
    expect(await p.until(`document.querySelectorAll('.wbx-side-b .wbx-row').length === 1 && Boolean(document.querySelector('.wbx-commit'))`)).toBe(true);
    expect(await p.js(`document.querySelector('.wbx-branch').innerText.replace(/\\s+/g, ' ').trim()`)).toBe('main on this computer only');
    await p.click('.wbx-side-b .wbx-row', 'price.mjs');
    expect(await p.until(`Boolean(document.querySelector('.wbx-ed .monaco-diff-editor')) && window.monaco.editor.getModels().some((m) => m.uri.scheme === 'wbx-before' && m.getValue().includes('return price - price'))`)).toBe(true);
    // the palette: a file by a few letters, then a command by its name
    await p.press('p', 80, META);
    await p.until(`Boolean(document.querySelector('.wbx-pal input'))`);
    await p.type('readme');
    expect(await p.js(`document.querySelector('.wbx-pal .it.on .nm').textContent`)).toBe('README.md');
    await p.press('Enter', 13);
    expect(await p.until(`window.WB.state().tabs.flat().includes('f:README.md')`)).toBe(true);
    await p.press('p', 80, META | SHIFT);
    await p.type('close the side');
    await p.press('Enter', 13);
    expect((await p.state()).view).toBe(null);
    // none of it was typed at the app, and nothing threw
    expect(p.typed()).toBe('');
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 90_000);

test.skipIf(needs('chrome', findChrome))('in a real browser: a save writes the file and a broken one shows under Problems; a tab follows the disk; a close with changes asks; the commit box keeps its cursor; the terminal runs in the folder', async () => {
  const p = await openWorkbench();
  try {
    await p.js(`window.WB.openFile('src/cart.mjs')`);
    expect(await p.until(`window.WB.state().editor && window.monaco.editor.getModels().some((m) => m.uri.path === '/src/cart.mjs')`, 20_000)).toBe(true);
    // typed in the editor: it is the file's, never the app's; ⌘S writes it and the check says where it broke
    await p.click('.wbx-ed .monaco-editor .view-lines');
    await p.press('End', 35, META);
    await p.type('const broken = (1 + ;');
    expect((await p.state()).dirty).toEqual(['src/cart.mjs']);
    expect(await p.js(`Boolean(document.querySelector('.wbx-tab.on .dot'))`)).toBe(true);
    await p.press('s', 83, META);
    expect(await p.until(`window.WB.state().dirty.length === 0`)).toBe(true);
    expect(readFileSync(join(p.folder, 'src', 'cart.mjs'), 'utf8')).toContain('const broken = (1 + ;');
    await p.press('m', 77, META | SHIFT);
    expect(await p.until(`document.querySelectorAll('.wbx-plist .wbx-row').length === 2`)).toBe(true);
    expect(await p.js(`document.querySelector('.wbx-plist').innerText`)).toMatch(/cart\.mjs[\s\S]*line 3/);
    expect(await p.js(`document.querySelector('.wbx-act .wbx-badge.bad')?.textContent`)).toBe('1');
    // a file the model (or anything else) changes shows in its open tab; with your own changes in it, a bar asks instead
    await p.js(`window.WB.openFile('README.md')`);
    await p.until(`window.monaco.editor.getModels().some((m) => m.uri.path === '/README.md')`);
    writeFileSync(join(p.folder, 'README.md'), '# Shop\n\nChanged by the model.\n');
    expect(await p.until(`window.monaco.editor.getModels().find((m) => m.uri.path === '/README.md').getValue().includes('Changed by the model')`)).toBe(true);
    expect((await p.state()).dirty).toEqual([]);
    await p.js(`(() => { const m = window.monaco.editor.getModels().find((x) => x.uri.path === '/README.md'); m.setValue(m.getValue() + 'mine\\n'); })()`);
    await Bun.sleep(1300);
    writeFileSync(join(p.folder, 'README.md'), '# Shop\n\nChanged again on disk.\n');
    expect(await p.until(`(document.querySelector('.wbx-bar:not([hidden])')?.innerText ?? '').includes('changed on disk')`)).toBe(true);
    expect(await p.js(`window.monaco.editor.getModels().find((m) => m.uri.path === '/README.md').getValue().includes('mine')`)).toBe(true);
    // closing a tab with changes asks in a bar; Cancel keeps it
    await p.click('.wbx-group.focus .wbx-tab.on .x');
    expect(await p.js(`document.querySelector('.wbx-group.focus .wbx-bar').innerText`)).toMatch(/not saved[\s\S]*Save[\s\S]*Don't save[\s\S]*Cancel/);
    await p.click('.wbx-group.focus .wbx-bar .wbx-btn', 'Don\'t save');
    expect((await p.state()).tabs.flat()).not.toContain('f:README.md');
    // the commit box keeps its cursor while files change under the pane, and commits
    await p.press('g', 71, CTRL | SHIFT);
    await p.until(`Boolean(document.querySelector('.wbx-commit textarea'))`);
    await p.click('.wbx-commit textarea');
    await p.type('never ');
    writeFileSync(join(p.folder, 'notes.txt'), 'a file appears while you type\n');
    await p.until(`document.querySelector('.wbx-side-b').innerText.includes('notes.txt')`);
    await p.type('below zero');
    expect(await p.js(`document.querySelector('.wbx-commit textarea').value`)).toBe('never below zero');
    await p.click('.wbx-commit .wbx-btn');
    expect(await p.until(`(document.querySelector('.wbx-say')?.innerText ?? '').includes('Committed')`)).toBe(true);
    expect(git(p.folder, 'log', '--format=%s', '-1').stdout.trim()).toBe('never below zero');
    // the terminal pane: a real shell in the folder (judged by what it wrote: a headless browser draws its rows late)
    await p.press('`', 192, CTRL);
    expect(await p.until(`Boolean(document.querySelector('.wbx-term .xterm'))`, 15_000)).toBe(true);
    await Bun.sleep(900);
    await p.type('echo made > by-the-terminal.txt');
    await p.press('Enter', 13, 0, '\r');
    for (let i = 0; i < 80 && !existsSync(join(p.folder, 'by-the-terminal.txt')); i++) await Bun.sleep(100);
    expect(existsSync(join(p.folder, 'by-the-terminal.txt'))).toBe(true);
    expect(p.typed()).toBe('');
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 120_000);

test.skipIf(needs('chrome', findChrome))('in a real browser: with no editor part to load, a file opens in a plain box, saves, and the rest works the same', async () => {
  const p = await openWorkbench();
  try {
    // a second workbench on the same page, on a made-up host that has no editor part and no terminal
    await p.js(`(() => {
      const files = { 'a.txt': 'one\\ntwo\\n', 'b/c.txt': 'see\\n' };
      window.saved = [];
      const host = { name: 'plain', can: { git: false },
        tree: async (path) => ({ entries: path ? [{ name: 'c.txt', path: 'b/c.txt', dir: false }] : [{ name: 'b', path: 'b', dir: true }, { name: 'a.txt', path: 'a.txt', dir: false }] }),
        files: async () => ({ files: Object.keys(files) }), read: async (path) => (path in files ? { text: files[path], stamp: 's1' } : { error: path + ' is not there.', gone: true }),
        save: async (path, text) => { files[path] = text; window.saved.push([path, text]); return { ok: true, stamp: 's2', problems: [] }; },
        search: async () => ({ hits: [], total: 0, files: 0 }), monaco: async () => null };
      const box = document.createElement('div'); box.id = 'plainwb'; box.style.cssText = 'position:fixed;inset:60px 20px 20px 20px;z-index:50;background:var(--win)'; document.body.append(box);
      window.WB2 = window.Workbench.mount(box, host);
      window.WB2.setView('files');
      window.WB = window.WB2; // the page asks its workbench whose a key is: this one's, for this test
    })()`);
    expect(await p.until(`document.querySelectorAll('#plainwb .wbx-side-b .wbx-row').length === 2`)).toBe(true);
    expect(await p.js(`document.querySelectorAll('#plainwb .wbx-act button').length`)).toBe(3); // no Source control without git
    await p.click('#plainwb .wbx-side-b .wbx-row', 'a.txt');
    expect(await p.until(`document.querySelector('#plainwb .wbx-ed textarea:not([hidden])')?.value === 'one\\ntwo\\n'`)).toBe(true);
    await p.click('#plainwb .wbx-ed textarea');
    await p.type('zero ');
    expect((await p.js(`JSON.stringify(window.WB2.state())`))).toContain('"dirty":["a.txt"]');
    await p.press('s', 83, META);
    expect(await p.until(`window.saved.length === 1`)).toBe(true);
    expect(await p.js(`window.saved[0][1].includes('zero ')`)).toBe(true);
    expect(await p.js(`JSON.parse(JSON.stringify(window.WB2.state())).dirty.length`)).toBe(0);
    expect(await p.js(`[...document.querySelectorAll('#plainwb *')].filter((e) => e.childNodes.length === 1 && e.textContent === 'null').length`)).toBe(0);
    expect(p.typed()).toBe('');
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);

test.skipIf(needs('chrome', findChrome))('in a real browser: what the page that holds a workbench can add: a start screen, panels of its own, marks on files being worked on, a line over the editor, buttons in Source control, and a narrow place', async () => {
  const p = await openWorkbench();
  try {
    await p.js(`(() => {
      const files = { 'a.txt': 'one\\n', 'b/c.txt': 'see\\n' };
      window.asked = [];
      const host = { name: 'held', can: { write: false, git: true },
        tree: async (path) => ({ entries: path ? [{ name: 'c.txt', path: 'b/c.txt', dir: false }] : [{ name: 'b', path: 'b', dir: true }, { name: 'a.txt', path: 'a.txt', dir: false }] }),
        files: async () => ({ files: Object.keys(files) }), read: async (path) => ({ text: files[path] ?? '', stamp: 's1' }),
        git: async () => ({ repo: true, branch: 'main', since: 'the start', say: 'Someone else commits here.', asks: [['Ask for a push', () => window.asked.push('push')]], files: [{ path: 'a.txt', code: 'M', status: 'changed', staged: false }] }),
        diff: async () => ({ before: 'zero\\n', after: 'one\\n' }), search: async () => ({ hits: [], total: 0, files: 0 }), monaco: async () => null,
        panels: [{ id: 'extra', title: 'Extra', mount: (box) => { box.textContent = 'the page\\'s own panel'; window.extraUp = (window.extraUp ?? 0) + 1; return { dispose: () => { window.extraGone = true; } }; } }] };
      const make = (id, opts) => { const box = document.createElement('div'); box.id = id; box.style.cssText = 'position:fixed;inset:60px 20px 20px 20px;z-index:50;background:var(--win)'; document.body.append(box); return window.Workbench.mount(box, host, opts); };
      window.WB3 = make('heldwb', { welcome: 'Open a file to begin.' });
      window.WB3.setView('files');
      window.WB = window.WB3;
    })()`);
    // the start screen where the editor would be: the folder's name, the words given, the ways in, and what changed
    expect(await p.until(`document.querySelector('#heldwb .wbx-welcome:not([hidden]) .wbx-wl-h')?.textContent === 'held'`)).toBe(true);
    expect(await p.js(`document.querySelector('#heldwb .wbx-wl-say').textContent`)).toBe('Open a file to begin.');
    expect(await p.until(`[...document.querySelectorAll('#heldwb .wbx-wl .wbx-row .nm')].some((e) => e.textContent === 'a.txt')`)).toBe(true);
    expect(await p.js(`[...document.querySelectorAll('#heldwb .wbx-wl .wbx-row .nm')].map((e) => e.textContent).slice(0, 2).join('|')`)).toBe('Go to file|Find in files');
    // a file someone else is working on gets a mark, and a closed folder that holds one; they go when the work is done
    await p.js(`window.WB3.touch(['a.txt', 'b/c.txt'], 'the model')`);
    expect(await p.until(`document.querySelectorAll('#heldwb .wbx-side-b .wbx-live').length === 2`)).toBe(true);
    expect(await p.js(`document.querySelector('#heldwb .wbx-side-b .wbx-live').title`)).toBe('the model is working on this now');
    await p.js(`window.WB3.settle()`);
    expect(await p.until(`document.querySelectorAll('#heldwb .wbx-live').length === 0`)).toBe(true);
    // a line over the editor (on the start screen too), its button, and its close
    await p.js(`window.WB3.notice({ text: 'the model changed 1 file', actions: [['Review', () => window.asked.push('review')]] })`);
    expect(await p.js(`document.querySelector('#heldwb .wbx-welcome .wbx-notice .t')?.textContent`)).toBe('the model changed 1 file');
    await p.click('#heldwb .wbx-welcome .wbx-notice .wbx-btn', 'Review');
    await p.click('#heldwb .wbx-side-b .wbx-row', 'a.txt');
    expect(await p.until(`document.querySelector('#heldwb .wbx-main > .wbx-notice:not([hidden]) .t')?.textContent === 'the model changed 1 file'`)).toBe(true);
    expect(await p.js(`document.querySelector('#heldwb .wbx-welcome').hidden`)).toBe(true);
    await p.js(`window.WB3.notice(null)`);
    expect(await p.js(`document.querySelector('#heldwb .wbx-main > .wbx-notice').hidden`)).toBe(true);
    // the page's own panel beside Problems, drawn once and kept, and by name in the palette's list
    await p.js(`window.WB3.togglePanel('extra')`);
    expect(await p.until(`document.querySelector('#heldwb .wbx-extra:not([hidden])')?.textContent === "the page's own panel"`)).toBe(true);
    expect(await p.js(`[...document.querySelectorAll('#heldwb .wbx-ptab')].map((e) => e.textContent).join('|')`)).toBe('Problems|Extra');
    await p.js(`window.WB3.togglePanel('problems'); window.WB3.togglePanel('extra')`);
    expect(await p.js(`window.extraUp`)).toBe(1);
    expect(await p.js(`window.WB3.commands().some((c) => c.title === 'View: Extra')`)).toBe(true);
    // Source control: the page's own buttons where a commit box would be
    await p.js(`window.WB3.setView('git')`);
    expect(await p.until(`document.querySelector('#heldwb .wbx-asks .wbx-btn')?.textContent === 'Ask for a push'`)).toBe(true);
    await p.click('#heldwb .wbx-asks .wbx-btn');
    expect(await p.js(`window.asked.join('|')`)).toBe('review|push');
    await p.js(`window.WB3.dispose()`);
    expect(await p.js(`window.extraGone`)).toBe(true);
    // a narrow place: the side pane takes it whole, and opening a file puts the pane away
    await p.js(`(() => { document.getElementById('heldwb').remove(); const host = { name: 'narrow', can: { git: false }, tree: async () => ({ entries: [{ name: 'a.txt', path: 'a.txt', dir: false }] }), files: async () => ({ files: ['a.txt'] }), read: async () => ({ text: 'one\\n', stamp: 's1' }), search: async () => ({ hits: [], total: 0, files: 0 }), monaco: async () => null };
      const box = document.createElement('div'); box.id = 'narrowwb'; box.style.cssText = 'position:fixed;left:20px;top:60px;width:380px;height:600px;z-index:50;background:var(--win)'; document.body.append(box);
      window.WB4 = window.Workbench.mount(box, host, { welcome: true, narrow: true }); window.WB4.setView('files'); window.WB = window.WB4; })()`);
    expect(await p.until(`document.querySelectorAll('#narrowwb .wbx-side-b .wbx-row').length === 1`)).toBe(true);
    expect(await p.js(`getComputedStyle(document.querySelector('#narrowwb .wbx-welcome')).display`)).toBe('none');
    expect(await p.js(`document.querySelector('#narrowwb .wbx-side').getBoundingClientRect().width > 300`)).toBe(true);
    await p.click('#narrowwb .wbx-side-b .wbx-row', 'a.txt');
    expect(await p.until(`document.querySelector('#narrowwb .wbx-side').hidden && document.querySelector('#narrowwb .wbx-ed textarea:not([hidden])')?.value === 'one\\n'`)).toBe(true);
    expect(await p.js(`[...document.querySelectorAll('#heldwb *, #narrowwb *')].filter((e) => e.childNodes.length === 1 && e.textContent === 'null').length`)).toBe(0);
    expect(p.typed()).toBe('');
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 60_000);
