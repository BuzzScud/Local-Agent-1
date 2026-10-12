// Agentic Coder in its own window (terminal/src/window/, 12 Oct 2026): the pretend terminal's screen (vt.mjs), the
// conversation as the window draws it (view.mjs), when `coding` opens the window, the app's side of the line
// (bridge.mjs) and the window server end to end with a stand-in app (server.mjs): its key, the state passed on,
// keys passed back, the app's end.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { VtScreen } from '../src/window/vt.mjs';
import { viewItem, ansiRows, cellRows, xterm } from '../src/window/view.mjs';
import { windowWanted, runWindow } from '../src/window/server.mjs';
import { makeBridge } from '../src/window/bridge.mjs';
import { printedOf } from '../src/app/screen.jsx';

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

test("the app's side: each redraw as data, only what changed, and the window's clicks back as actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-bridge-'));
  const path = join(dir, 'b.sock');
  const lines = [];
  let conn = null;
  const srv = net.createServer((s) => { conn = s; let buf = ''; s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } }); });
  await new Promise((r) => srv.listen(path, r));
  const bridge = makeBridge(path);
  const toggled = [];
  const self = { toggleGroup: (id) => toggled.push(id), setMode: () => {}, resumeSession: () => {} };
  const app = { items: [{ key: 'u1', type: 'user', text: 'hi', cards: [] }, { key: 'x1', rail: true, type: 'text', text: 'hello back' }], live: { phase: 'idle' }, input: { value: '/he', cursor: 3 }, menu: { kind: 'slash', index: 0, items: [{ label: '/help', desc: 'Help' }] }, mode: 'auto', modelName: 'Stand-in', width: 100, columns: 100, rows: 30, stepsView: { steps: 'grouped', open: new Set() } };
  bridge.publish(app, self);
  for (let i = 0; i < 40 && !lines.length; i++) await Bun.sleep(25);
  expect(lines[0]).toMatchObject({ t: 'state', mode: 'auto', modelName: 'Stand-in', input: { value: '/he', cursor: 3 }, menu: { index: 0, items: [{ label: '/help', desc: 'Help' }] } });
  // the keys are the printed ones (the grouping names a reply after its item: x1:t)
  expect(lines[0].order).toEqual(['u1', 'x1:t']);
  expect(Object.keys(lines[0].items)).toEqual(['u1', 'x1:t']);
  bridge.publish({ ...app, input: { value: '/hel', cursor: 4 } }, self);
  for (let i = 0; i < 40 && lines.length < 2; i++) await Bun.sleep(25);
  expect(lines[1].items).toEqual({});
  expect(lines[1].order).toBeUndefined();
  conn.write(`${JSON.stringify({ t: 'act', do: 'toggle', id: 'row-1' })}\n`);
  for (let i = 0; i < 40 && !toggled.length; i++) await Bun.sleep(25);
  expect(toggled).toEqual(['row-1']);
  bridge.close();
  srv.close();
});

test('the window server: its page only with its key, the state passed on, keys passed back, and the end of the app', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'window-server-'));
  // The stand-in app: says one state over the bridge, prints what it is typed, and ends at q.
  const stand = join(dir, 'stand-in.mjs');
  writeFileSync(stand, `
    import net from 'node:net';
    const s = net.connect(process.env.AGENTIC_WINDOW_SOCK);
    s.on('connect', () => s.write(JSON.stringify({ t: 'state', now: Date.now(), order: ['a'], items: { a: { t: 'text', key: 'a', text: 'hi from the app' } }, mode: 'plan', modelName: 'Stand-in', input: { value: '', cursor: 0 }, live: { phase: 'idle' } }) + '\\n'));
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
  ws.send(JSON.stringify({ t: 'keys', data: 'q' }));
  expect(await done).toBe(3);
  for (let i = 0; i < 40 && !got.some((m) => m.t === 'exit'); i++) await Bun.sleep(25);
  expect(got.at(-1)).toMatchObject({ t: 'exit', code: 3 });
  ws.close();
});
