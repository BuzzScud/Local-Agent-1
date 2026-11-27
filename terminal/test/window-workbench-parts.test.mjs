// The workbench's newer parts in the window's real page (27 Nov 2026; workbench-ai.js, -lang.js, -tests.js, -debug.js,
// -web.js, their server sides workbench-run.mjs and workbench-debug.mjs, and bridge-wb.mjs's answers): the real window
// server on a small project, a stand-in app that also answers the workbench's questions, and a headless Chrome driven
// over the DevTools protocol, as window-workbench.test.mjs does. What must hold: the agent's steps light up and open the
// file it edits; a reply's changes come up for review with the file as it was, and Undo asks the app; Fix, Explain and
// the commit message reach the app; a definition and a rename reach across files; the tests are found, run and marked;
// a breakpoint stops a real node program with its variables; a page of the folder previews under its own key.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runWindow } from '../src/window/server.mjs';
import { findChrome } from '../src/flows/layoutcheck.mjs';
import { needs } from './needs.mjs';

// The stand-in app: the state file as its redraws, the window's keys and acts noted, and the workbench's questions
// answered as bridge-wb.mjs would (the file before the reply, an undo, a commit message).
const STAND_IN = `
import net from 'node:net';
import { readFileSync, appendFileSync, statSync } from 'node:fs';
const note = (m) => appendFileSync(process.env.AUDIT_LOG, JSON.stringify(m) + '\\n');
const s = net.connect(process.env.AGENTIC_WINDOW_SOCK);
let seen = 0, inbox = '';
const say = () => { try { const at = statSync(process.env.AUDIT_STATE).mtimeMs; if (at === seen) return; seen = at; s.write(JSON.stringify({ t: 'state', now: Date.now(), ...JSON.parse(readFileSync(process.env.AUDIT_STATE, 'utf8')) }) + '\\n'); } catch {} };
s.on('connect', () => { s.write(JSON.stringify({ t: 'hi', key: process.env.AGENTIC_WINDOW_KEY }) + '\\n'); say(); setInterval(say, 30); });
s.on('data', (d) => {
  inbox += d; let i;
  while ((i = inbox.indexOf('\\n')) >= 0) {
    const m = JSON.parse(inbox.slice(0, i)); inbox = inbox.slice(i + 1);
    note({ from: 'act', ...m });
    const back = (o) => s.write(JSON.stringify({ t: 'wbx-ai', id: m.id, ...o }) + '\\n');
    if (m.do === 'wb-before') back({ text: 'export const TAX = 0.2;\\n\\nexport function applyDiscount(price, percent) {\\n  return price - price * (percent / 100);\\n}\\n' });
    if (m.do === 'wb-undo') back({ ok: true });
    if (m.do === 'wb-ask') back({ text: 'Clamp discounted prices at zero' });
  }
});
process.stdin.setRawMode?.(true);
process.stdin.on('data', (d) => note({ from: 'keys', data: String(d) }));
`;
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });

async function openWorkbench() {
  const folder = join(realpathSync(mkdtempSync(join(tmpdir(), 'wbx-parts-'))), 'shop');
  for (const d of ['src', 'test', 'page']) mkdirSync(join(folder, d), { recursive: true });
  writeFileSync(join(folder, 'src', 'price.mjs'), 'export const TAX = 0.2;\n\nexport function applyDiscount(price, percent) {\n  return price - price * (percent / 100);\n}\n');
  writeFileSync(join(folder, 'src', 'cart.mjs'), "import { applyDiscount } from './price.mjs';\nexport const cart = (n) => applyDiscount(n, 10);\n");
  writeFileSync(join(folder, 'src', 'prog.mjs'), 'function add(a, b) {\n  const sum = a + b;\n  return sum;\n}\nlet total = 0;\nfor (const n of [1, 2, 3]) total = add(total, n);\nconsole.log("total", total);\n');
  writeFileSync(join(folder, 'test', 'price.test.mjs'), "import { test, expect } from 'bun:test';\nimport { applyDiscount } from '../src/price.mjs';\n\ntest('ten percent off', () => {\n  expect(applyDiscount(100, 10)).toBe(90);\n});\n\ntest('half price', () => {\n  expect(applyDiscount(10, 50)).toBe(4);\n});\n");
  writeFileSync(join(folder, 'page', 'index.html'), '<!doctype html><link rel="stylesheet" href="style.css"><h1>Shop</h1>\n');
  writeFileSync(join(folder, 'page', 'style.css'), 'h1 { color: teal; }\n');
  writeFileSync(join(folder, 'bunfig.toml'), '');
  writeFileSync(join(folder, 'package.json'), '{ "name": "shop", "type": "module" }\n');
  git(folder, 'init', '-q', '-b', 'main'); git(folder, 'add', '-A'); git(folder, 'commit', '-q', '-m', 'the shop');
  writeFileSync(join(folder, 'src', 'price.mjs'), 'export const TAX = 0.2;\n\nexport function applyDiscount(price, percent) {\n  return Math.max(0, price - price * (percent / 100));\n}\n');
  const work = mkdtempSync(join(tmpdir(), 'wbx-parts-run-'));
  const log = join(work, 'got.jsonl'), stateFile = join(work, 'state.json'), standIn = join(work, 'stand-in.mjs');
  writeFileSync(log, ''); writeFileSync(standIn, STAND_IN);
  const items = { u1: { t: 'user', key: 'u1', text: 'never a negative price', cards: [] }, a1: { t: 'text', key: 'a1', text: 'Done.' } };
  const base = { order: Object.keys(items), items, mode: 'ask', modelName: 'Stand-in', cwdShort: '~/shop', input: { value: '', cursor: 0 }, placeholder: 'Ask anything', live: { phase: 'idle' }, wbTurn: { n: 3, files: [] } };
  const setState = (o) => writeFileSync(stateFile, JSON.stringify({ ...base, ...o }));
  setState({});
  let url = null;
  const done = runWindow({ folder, open: false, command: [process.execPath, standIn], env: { ...process.env, AUDIT_LOG: log, AUDIT_STATE: stateFile }, onUrl: (u) => { url = u; }, say: () => {}, another: () => {} });
  for (let i = 0; i < 200 && !url; i++) await Bun.sleep(25);
  const chrome = Bun.spawn([findChrome(), '--headless', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--in-process-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wbx-parts-chrome-'))}`, '--remote-debugging-port=0', 'about:blank'], { stdout: 'ignore', stderr: 'pipe' });
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
  await on('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await on('Page.navigate', { url });
  const js = async (expression) => { const r = await on('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const until = async (expression, ms = 10_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(expression).catch(() => false)) return true; await Bun.sleep(60); } return false; };
  const click = async (sel, text = null) => {
    const at = await js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})]${text ? `.filter((x) => x.textContent.includes(${JSON.stringify(text)}))` : ''}[0]; if (!e) return null; e.scrollIntoView?.({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!at) throw new Error(`nothing at ${sel} ${text ?? ''}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await on('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await Bun.sleep(200);
  };
  const type = async (text) => { for (const ch of text) { await on('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch }); await on('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); } await Bun.sleep(150); };
  const press = async (key, code, modifiers = 0) => { await on('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, modifiers }); await on('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers }); await Bun.sleep(150); };
  const got = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const typed = () => got().filter((m) => m.from === 'keys').map((m) => m.data).join('');
  const acts = () => got().filter((m) => m.from === 'act');
  const close = async () => { ws.close(); chrome.kill(); process.emit('SIGTERM'); await Promise.race([done, Bun.sleep(4000)]); };
  await until(`Boolean(window.WB)`);
  await until(`window.WB.state().editor`, 20_000);
  return { folder, url, js, until, click, type, press, typed, acts, setState, errors, close };
}

test.skipIf(needs('chrome', findChrome))('in a real browser: the agent\'s steps light up and open its file; its reply comes up for review with Keep and Undo; Fix, Explain and the commit message reach the app', async () => {
  const p = await openWorkbench();
  try {
    // it works: a file read lights up in the tree, the file it edits opens beside you with its new line marked
    await p.js(`window.WB.setView('files')`);
    await p.until(`document.querySelectorAll('.wbx-side-b .wbx-row').length >= 3`);
    await p.click('.wbx-side-b .wbx-row', 'src');
    await p.until(`[...document.querySelectorAll('.wbx-side-b .wbx-row')].some((e) => e.textContent.includes('cart.mjs'))`);
    p.setState({ live: { phase: 'working' }, wbTurn: null, steps: { s1: { k: 'read', arg: '"src/cart.mjs"' }, s2: { k: 'diff', path: 'src/price.mjs', hunk: [['-', 4, null, '  return price'], ['+', null, 4, '  return Math.max(0, …)']] } } });
    expect(await p.until(`window.WB.state().tabs.flat().includes('f:src/price.mjs') && document.querySelectorAll('.wbx-side-b .wbx-live').length === 2`)).toBe(true);
    expect(await p.until(`document.querySelectorAll('.wbx-ed .wbx-ai-line').length === 1`)).toBe(true);
    expect(await p.js(`document.querySelector('.wbx-foot').textContent.includes('Agentic Coder is working')`)).toBe(true);
    // the reply ends with its copies kept: a line over the editor, and the Review tab with the file as it was
    p.setState({ live: { phase: 'idle' }, wbTurn: { n: 4, files: [{ path: 'src/price.mjs', status: 'changed', undone: false }] } });
    expect(await p.until(`document.querySelector('.wbx-notice')?.textContent.includes('Agentic Coder changed 1 file.')`)).toBe(true);
    expect(await p.js(`document.querySelectorAll('.wbx-side-b .wbx-live').length`)).toBe(0);
    await p.click('.wbx-notice button', 'Review');
    expect(await p.until(`Boolean(document.querySelector('.wbx-rv .monaco-diff-editor')) && window.monaco.editor.getModels().some((m) => m.uri.scheme === 'wbx-rv-before' && m.getValue().includes('return price - price'))`, 15_000)).toBe(true);
    expect(p.acts().find((a) => a.do === 'wb-before')).toMatchObject({ n: 4, path: 'src/price.mjs' });
    await p.click('.wbx-rv-f .wbx-ib[title^="Undo"]');
    expect(await p.until(`document.querySelector('.wbx-rv-f .wbx-chip')?.textContent === 'undone'`)).toBe(true);
    expect(p.acts().find((a) => a.do === 'wb-undo')).toMatchObject({ n: 4, path: 'src/price.mjs' });
    expect(await p.js(`Boolean(document.querySelector('.wbx-notice')) && !document.querySelector('.wbx-notice').hidden`)).toBe(false);
    // Explain on a line of the editor, and Fix it on a problem: into the prompt, for you to send
    await p.js(`(() => { const e = window.monaco.editor.getEditors().find((x) => x.getModel()?.uri.path === '/src/price.mjs'); e.setPosition({ lineNumber: 4, column: 3 }); return e.getAction('wb.ai.explain').run(); })()`);
    await Bun.sleep(400);
    expect(p.typed()).toMatch(/Explain what this code does and why:[\r\n]+src\/price\.mjs:4/);
    // the commit message, written by the model from the real change
    await p.js(`window.WB.setView('git')`);
    await p.click('.wbx-ai-git button', 'Write the message');
    expect(await p.until(`document.querySelector('.wbx-commit textarea')?.value === 'Clamp discounted prices at zero'`)).toBe(true);
    expect(p.acts().find((a) => a.do === 'wb-ask').patch).toContain('Math.max(0,');
    // the panel's head (the owner: "improve the terminal design"): its tabs on one line, Test output and Debug console only
    // once they hold something, Send to chat an icon, and the whole height and back
    // the terminal's own button on the activity bar (the owner: "can you add the terminal here?"): it opens the terminal
    await p.click('.wbx-act button[aria-label^="Terminal"]');
    expect(await p.until(`Boolean(document.querySelector('.wbx-term .xterm'))`, 15_000)).toBe(true);
    expect(await p.js(`document.querySelector('.wbx-act button[aria-label^="Terminal"]').className`)).toBe('on');
    expect(await p.js(`[...document.querySelectorAll('.wbx-ptab')].map((t) => [t.textContent, Math.round(t.getBoundingClientRect().height)])`)).toEqual([['Problems', 34], ['Terminal', 34]]);
    expect(await p.js(`Boolean(document.querySelector('.wbx-pacts .wbx-ib[title^="Send to Agentic Coder"]'))`)).toBe(true);
    await p.click('.wbx-pacts .wbx-ib[title^="The panel the whole"]');
    expect(await p.js(`document.querySelector('.wbx-groups').hidden && document.querySelector('.wbx-panel').getBoundingClientRect().height > 600`)).toBe(true);
    await p.click('.wbx-pacts .wbx-ib[title^="Give the files"]');
    expect(await p.js(`!document.querySelector('.wbx-groups').hidden`)).toBe(true);
    await p.click('.wbx-act button[aria-label^="Terminal"]'); // and puts it away
    expect((await p.js(`window.WB.state()`)).panel).toBe(null);
    expect(p.errors).toEqual([]);
  } finally { await p.close(); }
}, 90_000);

test.skipIf(needs('chrome', findChrome))('in a real browser: a definition and a rename reach across files; the tests are found, run and marked; a breakpoint stops a real node program; a page previews under its own key', async () => {
  const p = await openWorkbench();
  try {
    // language smarts: every code file in the language service, F12 from cart.mjs lands in price.mjs
    expect(await p.until(`window.WB.part('lang').state().state === 'on' && window.WB.part('lang').state().count === 4`, 20_000)).toBe(true);
    await p.js(`window.WB.openFile('src/cart.mjs', { line: 2 })`);
    await p.until(`window.monaco.editor.getEditors().some((x) => x.getModel()?.uri.path === '/src/cart.mjs')`);
    await p.js(`(() => { const e = window.monaco.editor.getEditors().find((x) => x.getModel()?.uri.path === '/src/cart.mjs'); e.setPosition({ lineNumber: 2, column: 30 }); e.focus(); e.trigger('test', 'editor.action.revealDefinition', null); })()`);
    expect(await p.until(`window.monaco.editor.getEditors().some((e) => e.hasTextFocus?.() !== undefined && e.getModel()?.uri.path === '/src/price.mjs' && e.getSelection().startLineNumber === 3)`, 15_000)).toBe(true);
    // a rename in price.mjs reaches cart.mjs, closed now: it opens, not saved
    await p.js(`window.WB.commands().find((c) => c.title === 'View: Close All Editors').run()`);
    await p.until(`window.WB.state().tabs.flat().length === 0`);
    await p.js(`window.WB.openFile('src/price.mjs', { line: 3, col: 20 })`);
    await p.until(`window.monaco.editor.getEditors().some((x) => x.getModel()?.uri.path === '/src/price.mjs')`);
    await p.js(`(() => { const e = window.monaco.editor.getEditors().find((x) => x.getModel()?.uri.path === '/src/price.mjs'); e.setPosition({ lineNumber: 3, column: 20 }); e.focus(); e.trigger('test', 'editor.action.rename', null); })()`);
    expect(await p.until(`Boolean(document.querySelector('.rename-box input'))`, 10_000)).toBe(true);
    await p.js(`(() => { const i = document.querySelector('.rename-box input'); i.value = 'cutPrice'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await p.press('Enter', 13);
    expect(await p.until(`window.WB.state().dirty.includes('src/cart.mjs') && window.monaco.editor.getModels().find((m) => m.uri.path === '/src/cart.mjs').getValue().includes('cutPrice(n, 10)')`, 15_000)).toBe(true);
    expect(await p.js(`document.querySelector('.wbx-notice')?.textContent ?? ''`)).toContain('reached 2 more files');
    expect(readFileSync(join(p.folder, 'src', 'cart.mjs'), 'utf8')).toContain('applyDiscount'); // not saved until you say
    await p.click('.wbx-notice button', 'Save all');
    expect(await p.until(`window.WB.state().dirty.length === 0`)).toBe(true);
    expect(readFileSync(join(p.folder, 'src', 'cart.mjs'), 'utf8')).toContain('cutPrice(n, 10)');
    // tests: found by reading the file; one run of the file; one passes, one fails, each marked beside its line
    writeFileSync(join(p.folder, 'test', 'price.test.mjs'), readFileSync(join(p.folder, 'test', 'price.test.mjs'), 'utf8').replaceAll('applyDiscount', 'cutPrice'));
    await p.js(`window.WB.setView('tests')`);
    expect(await p.until(`document.querySelector('.wbx-side-b .wbx-note')?.textContent.startsWith('bun · 2 tests in 1 file')`, 15_000)).toBe(true);
    await p.js(`document.querySelector('.wbx-side-b .wbx-row .wbx-ib[title="Run this file"]').click()`); // shown on hover
    expect(await p.until(`(() => { const s = window.WB.part('tests').state(); return s.summary && s.summary.pass === 1 && s.summary.fail === 1; })()`, 40_000)).toBe(true);
    expect(await p.js(`[...document.querySelectorAll('.wbx-side-b .wbx-tdot')].map((e) => e.className.split(' ')[1])`)).toEqual(['fail', 'pass', 'fail']);
    expect(await p.js(`document.querySelector('.wbx-panel pre.wbx-out').textContent`)).toContain('1 passed, 1 failed');
    await p.js(`window.WB.openFile('test/price.test.mjs')`);
    expect(await p.until(`document.querySelectorAll('.wbx-ed .wbx-tglyph-pass').length === 1 && document.querySelectorAll('.wbx-ed .wbx-tglyph-fail').length === 1`)).toBe(true);
    // the debugger: a breakpoint on line 2 of a real node program, its variables, an expression, and the end
    await p.js(`window.WB.part('debug').toggleBp('src/prog.mjs', 2)`);
    await p.js(`window.WB.part('debug').start('src/prog.mjs')`);
    expect(await p.until(`window.WB.part('debug').state().run?.paused?.frames?.[0]?.line === 2`, 20_000)).toBe(true);
    expect(await p.until(`[...document.querySelectorAll('.wbx-var .k')].some((e) => e.textContent === 'a') && [...document.querySelectorAll('.wbx-var')].some((e) => e.textContent.includes('b') && e.textContent.includes('1'))`, 10_000)).toBe(true);
    expect(await p.until(`document.querySelectorAll('.wbx-ed .wbx-here').length === 1 && document.querySelectorAll('.wbx-ed .wbx-bp').length === 1`)).toBe(true);
    await p.js(`window.WB.part('debug').evaluate('a + b * 100')`);
    expect(await p.until(`document.querySelector('.wbx-con-out')?.textContent.includes('100')`)).toBe(true);
    await p.js(`window.WB.part('debug').toggleBp('src/prog.mjs', 2)`);
    await p.js(`window.WB.part('debug').cmd('resume')`);
    expect(await p.until(`!window.WB.part('debug').state().run && document.querySelector('.wbx-con-out').textContent.includes('total 6')`, 15_000)).toBe(true);
    // the preview: a page of the folder under its own key, never the window's; its own links work
    await p.js(`window.WB.part('web').open('page/index.html', { file: 'page/index.html' })`);
    expect(await p.until(`(document.querySelector('.wbx-web-frame')?.src ?? '').includes('/wb/site/')`)).toBe(true);
    const src = await p.js(`document.querySelector('.wbx-web-frame').src`);
    expect(src.includes(new URL(p.url).searchParams.get('t'))).toBe(false);
    expect(await p.js(`document.querySelector('.wbx-web-frame').getAttribute('sandbox')`)).not.toContain('allow-same-origin');
    const css = await fetch(src.replace('index.html', 'style.css').replace(/\?.*$/, ''));
    expect([css.status, await css.text()]).toEqual([200, 'h1 { color: teal; }\n']);
    expect((await fetch(src.replace(/\/wb\/site\/[^/]+\//, '/wb/site/nope/'))).status).toBe(403);
    expect(p.errors).toEqual([]);
    expect(p.typed()).toBe('');
  } finally { await p.close(); }
}, 150_000);
