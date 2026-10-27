// The notes page clicked through in a real browser, as the prompt describes it (27 Oct 2026). The words-only
// checks in check.sh passed Bonsai 2 9B's page, whose Save closed the box and never added the note; this one
// opens the page in headless Chrome over its debugging connection and uses it with real clicks, typing and
// keys: the button, the box in the middle with the page dimmed, Cancel, Save (the card at the top with its
// title, first line and today's date), Escape, the notes again after reopening, dark mode, no script errors.
// Nothing is installed: the Mac's Chrome, or the one Playwright keeps (AGENTIC_CHROME names another).
//   node click-check.mjs <notes.html>   one PASS or FAIL line per check, then the result; exit 1 on a FAIL.
// No Chrome here: says so and exits 0 (the words-only checks still ran).
// clickCheck(file) → { checks: [{ name, ok, more }], passed, total } or { skipped }; the Bonsai check
// (models/evals/tools/bonsai-check.mjs) scores its pages with it.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Where a headless Chrome is: as terminal/src/flows/layoutcheck.mjs findChrome (a check stands alone).
export function findChrome() {
  if (process.env.AGENTIC_CHROME) return existsSync(process.env.AGENTIC_CHROME) ? process.env.AGENTIC_CHROME : null;
  for (const a of ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser']) if (existsSync(`/Applications/${a}.app/Contents/MacOS/${a}`)) return `/Applications/${a}.app/Contents/MacOS/${a}`;
  for (const c of [join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')]) {
    let dirs = [];
    try { dirs = readdirSync(c).filter((d) => /^chromium/.test(d)).sort().reverse(); } catch { continue; }
    for (const d of dirs) for (const rel of ['chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) if (existsSync(join(c, d, rel))) return join(c, d, rel);
  }
  for (const dir of (process.env.PATH ?? '').split(':')) for (const n of ['google-chrome', 'chromium', 'chromium-browser']) if (dir && existsSync(join(dir, n))) return join(dir, n);
  return null;
}

// Chrome with its debugging connection, one tab: { s(method, params), events, close() }.
async function openTab(chrome, profile) {
  const proc = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--allow-file-access-from-files',
    `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', ...(platform() === 'linux' ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const kill = () => { try { proc.kill('SIGKILL'); } catch {} };
  const wsUrl = await new Promise((ok) => {
    let err = '';
    const t = setTimeout(() => ok(null), 15_000);
    proc.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) { clearTimeout(t); ok(m[1]); } });
    proc.on('close', () => { clearTimeout(t); ok(null); });
  });
  if (!wsUrl) { kill(); return null; }
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('no connection to Chrome')); });
  let seq = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.method) { events.push(m); return; }
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w.no(new Error(m.error.message)); else w.ok(m.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, { ok, no }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return { s: (method, params) => send(method, params, sessionId), events, close() { try { ws.close(); } catch {} kill(); } };
}

// Runs in the page: what the checks look for. Kept to plain JS so it runs in any Chrome.
const IN_PAGE = String.raw`window.__nc = {
  shown(el) { if (!el) return false; var r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05; },
  named(re, sel) { return [].slice.call(document.querySelectorAll(sel || 'button, [role=button], input[type=button], input[type=submit], a')).filter(function (el) { return __nc.shown(el) && re.test((el.innerText || el.value || el.getAttribute('aria-label') || '').trim()); })[0] || null; },
  box(kind) { return [].slice.call(document.querySelectorAll(kind === 'text' ? 'textarea' : 'input')).filter(function (el) { var t = (el.getAttribute('type') || 'text').toLowerCase(); return __nc.shown(el) && (kind === 'text' || t === 'text'); })[0] || null; },
  centre(el) { if (!el) return null; el.scrollIntoView({ block: 'center' }); var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; },
  dimmed() { return [].slice.call(document.querySelectorAll('*')).concat([document.querySelector('dialog[open]')]).some(function (el) {
    if (!el) return false; var s = getComputedStyle(el), bd = el.matches && el.matches('dialog[open]') ? getComputedStyle(el, '::backdrop') : null;
    if (bd && /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0?\.\d+\)/.test(bd.backgroundColor)) return true;
    var r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && (s.position === 'fixed' || s.position === 'absolute') && r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 && /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0?\.\d+\)/.test(s.backgroundColor); }); },
  text() { return document.body.innerText; },
  bg() { return getComputedStyle(document.body).backgroundColor; }
};`;

export async function clickCheck(file, { chrome = findChrome() } = {}) {
  if (!chrome) return { skipped: 'no headless Chrome on this machine' };
  const page = pathToFileURL(resolve(file)).href;
  const profile = mkdtempSync(join(tmpdir(), 'notes-click-check-'));
  const tab = await openTab(chrome, profile);
  if (!tab) { rmSync(profile, { recursive: true, force: true }); return { skipped: 'Chrome did not start' }; }
  const { s } = tab;
  const checks = [];
  const check = (name, ok, more = '') => checks.push({ name, ok: Boolean(ok), more });
  const js = async (expr) => (await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  const load = async () => { for (let i = 0; i < 40; i++) { await sleep(100); if (await js('document.readyState') === 'complete') break; } await js(IN_PAGE); await sleep(200); };
  const clickAt = async (p) => {
    if (!p) throw new Error('nothing to click');
    for (const type of ['mousePressed', 'mouseReleased']) await s('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(300);
  };
  const press = async (key, code, keyCode) => { for (const type of ['keyDown', 'keyUp']) await s('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode }); await sleep(300); };
  const type = async (where, text) => { await clickAt(await js(`__nc.centre(__nc.box('${where}'))`)); await s('Input.insertText', { text }); };
  const modalOpen = () => js("__nc.shown(__nc.box('text'))");
  const openNew = () => js('__nc.centre(__nc.named(/new note/i))').then(clickAt);
  const add = async (title, text) => {
    await openNew();
    await type('line', title);
    await type('text', text);
    await clickAt(await js('__nc.centre(__nc.named(/^save$/i))'));
  };
  try {
    await s('Runtime.enable');
    await s('Log.enable'); // the browser's own errors too (a form box it cannot focus to say what is missing)
    await s('Page.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await s('Page.navigate', { url: page });
    await load();
    check('"+ New note" button shows', await js('!!__nc.named(/new note/i)'));
    await openNew();
    check('modal opens with a text box', await modalOpen());
    check('page behind is dimmed', await js('__nc.dimmed()'));
    const box = await js("__nc.centre(__nc.box('text'))");
    check('modal is in the middle', box && Math.abs(box.x - 640) < 120, box ? `text box centre x=${Math.round(box.x)}` : 'no text box');
    await clickAt(await js('__nc.centre(__nc.named(/^cancel$/i))'));
    check('Cancel closes the modal', !(await modalOpen()));
    await add('First note', 'Line one of the first\nsecond line hidden');
    check('Save closes the modal', !(await modalOpen()));
    let body = await js('__nc.text()');
    check('card shows the title', body.includes('First note'));
    check('card shows the first line', body.includes('Line one of the first'));
    check('card hides the later lines', !body.includes('second line hidden'));
    const d = new Date();
    const bits = [String(d.getDate()), d.toLocaleDateString('en-US', { month: 'short' }), String(d.getFullYear())];
    check("card shows today's date", bits.filter((b) => body.includes(b)).length >= 2, `looked for ${bits.join(' / ')}`);
    await add('Second note', 'Newest one');
    body = await js('__nc.text()');
    check('newest card is at the top', body.indexOf('Second note') >= 0 && body.indexOf('First note') >= 0 && body.indexOf('Second note') < body.indexOf('First note'));
    await openNew();
    await type('line', 'Escaped note');
    await press('Escape', 'Escape', 27);
    check('Escape closes the modal', !(await modalOpen()));
    check('Escape does not save', !(await js('__nc.text()')).includes('Escaped note'));
    await s('Page.reload');
    await load();
    body = await js('__nc.text()');
    check('notes still there after reopening', body.includes('First note') && body.includes('Second note'));
    const light = await js('__nc.bg()');
    await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(300);
    const dark = await js('__nc.bg()');
    check('follows dark mode', light !== dark, `${light} → ${dark}`);
  } catch (e) {
    check('click-through finished', false, String(e.message).split('\n')[0]);
  } finally {
    const errors = tab.events.filter((m) => m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error'))
      .map((m) => (m.method === 'Runtime.exceptionThrown' ? m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text : m.method === 'Log.entryAdded' ? m.params.entry.text : m.params.args?.map((a) => a.value ?? a.description).join(' ')) ?? 'error');
    check('no JavaScript errors', errors.length === 0, errors.slice(0, 3).map((x) => String(x).split('\n')[0]).join(' | '));
    tab.close();
    rmSync(profile, { recursive: true, force: true });
  }
  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file || !existsSync(file)) { console.log(`no page at ${file ?? '(none named)'}`); process.exit(1); }
  const r = await clickCheck(file);
  if (r.skipped) { console.log(`the click-through did not run: ${r.skipped}`); process.exit(0); }
  for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.more ? ` (${c.more})` : ''}`);
  const failed = r.checks.filter((c) => !c.ok);
  console.log(failed.length ? `the page fails ${failed.length} of ${r.total} click-through checks: ${failed.map((c) => c.name).join(', ')}` : `${r.total} of ${r.total} click-through checks pass`);
  process.exit(failed.length ? 1 : 0);
}
