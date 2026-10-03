// Background sessions (src/app/sessions.mjs) and the door between Macs (src/app/door.mjs):
// the frames, the names, the modes a joining window is told, the door's key and its list,
// and end to end in a pseudo-terminal: ctrl+b, coding sessions, coding attach, two windows
// at once, closing the window a session started in, and a window through the door.
import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { runInPty } from './pty.mjs';
import { T, setup } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';

// A throwaway home before the models part is imported (it reads AGENTIC_HOME once).
const unitHome = mkdtempSync(join(tmpdir(), 'agentic-sessions-'));
process.env.AGENTIC_HOME = join(unitHome, 'home');
const S = await import('../src/app/sessions.mjs');
const D = await import('../src/app/door.mjs');
const { HOME } = await import('../../models/index.mjs');
const cli = join(import.meta.dir, '..', 'src', 'cli.jsx');
const CTRL_B = '\x02';

test('the tests run in a throwaway home', () => {
  expect(HOME.startsWith(unitHome)).toBe(true);
  expect(S.BG_DIR().startsWith(unitHome)).toBe(true);
});

test('frames come out whole however the bytes are cut, and a giant one is refused', () => {
  const got = [];
  const read = S.frameReader((kind, body) => got.push([kind, Buffer.from(body).toString()]));
  const all = Buffer.concat([S.frame(S.F.HELLO, { cols: 80 }), S.frame(S.F.INPUT, 'abc'), S.frame(S.F.LEAVE)]);
  for (let i = 0; i < all.length; i += 3) read(all.subarray(i, i + 3));
  expect(got).toEqual([[S.F.HELLO, '{"cols":80}'], [S.F.INPUT, 'abc'], [S.F.LEAVE, '{}']]);
  const huge = Buffer.alloc(5);
  huge[0] = S.F.OUTPUT;
  huge.writeUInt32BE(64 * 1024 * 1024, 1);
  expect(() => S.frameReader(() => {})(huge)).toThrow();
});

test('a window that joins is told the modes the app has on, even ones cut in two by a read', () => {
  const m = S.modeTracker();
  m.see(Buffer.from('hi \x1b[?2004h \x1b[?100'));
  m.see(Buffer.from('6h\x1b[?25l text \x1b[?1000h\x1b[?1000l'));
  expect(m.replay()).toBe('\x1b[?2004h\x1b[?1006h\x1b[?25l\x1b[?1000l');
  expect(m.altScreen()).toBeFalsy();
  m.see(Buffer.from('\x1b[?1049h'));
  expect(m.altScreen()).toBe(true);
});

test('names: the folder and a number, home for the home folder, only safe letters', () => {
  expect(S.newName('/x/Agentic Coder')).toBe('agentic-coder-1');
  expect(S.newName(process.env.HOME)).toBe('home-1');
  expect(S.newName('/x/___')).toBe('session-1');
  expect(S.validName('agentic-coder-1')).toBe(true);
  expect(S.validName('../etc')).toBe(false);
  expect(S.readRecord('../../x')).toBe(null);
});

test('a session line: name, folder, age, who is watching; another Mac\'s home shown as ~', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  expect(S.describe({ name: 'a-1', folder: '/Users/someone/p', started: '2026-10-03T11:30:00Z', viewers: 0 }, now, { mac: false })).toBe('a-1 · ~/p · 30 min · in the background');
  expect(S.describe({ name: 'a-1', folder: '/tmp/p', started: '2026-10-03T09:00:00Z', viewers: 2 }, now)).toBe('a-1 · /tmp/p · 3 h · 2 windows open');
});

test('the door: wrong keys are slowed and then refused for a minute', () => {
  let t = 0;
  const l = D.limiter({ now: () => t });
  for (let i = 0; i < 4; i++) l.wrong('a');
  expect(l.blocked('a')).toBe(false);
  l.wrong('a');
  expect(l.blocked('a')).toBe(true);
  expect(l.blocked('b')).toBe(false);
  t = 61_000;
  expect(l.blocked('a')).toBe(false);
});

// One question to a door: the frame it answers.
function askDoor(port, hello) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.on('connect', () => sock.write(S.frame(S.F.HELLO, hello)));
    const read = S.frameReader((kind, body) => { sock.destroy(); resolve({ kind, body: S.json(body) }); });
    sock.on('data', read);
    sock.on('error', reject);
  });
}

test('the door: the key is checked, the list shows no socket, process or prompt, a missing session is said', async () => {
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-right' });
  const port = door.address().port;
  try {
    const wrong = await askDoor(port, { key: 'acd-wrong', op: 'list' });
    expect(wrong).toEqual({ kind: S.F.NOTE, body: { text: 'wrong key' } });
    const list = await askDoor(port, { key: 'acd-right', op: 'list' });
    expect(list.kind).toBe(S.F.LIST);
    expect(list.body.sessions).toEqual([]);
    const none = await askDoor(port, { key: 'acd-right', op: 'attach', name: 'nope-1' });
    expect(none.kind).toBe(S.F.NOTE);
    expect(none.body.text).toContain('No session called nope-1');
  } finally { door.close(); }
});

test('why the door could not be reached, in plain words', () => {
  expect(D.reachProblem({ code: 'ECONNREFUSED' }, 'mac-2')).toContain('On mac-2, run: coding door on');
  expect(D.reachProblem({ code: 'ENOTFOUND' }, 'mac-2')).toContain('Is Tailscale on');
  expect(D.reachProblem(new Error('timeout'), 'mac-2')).toContain('did not answer');
});

// ---- end to end: needs a Bun with a pretend terminal (1.3.5 and later) ----------------------------------

const homes = [];
// Every session a test left running is stopped.
afterEach(() => {
  for (const h of homes.splice(0)) {
    let files = [];
    try { files = readdirSync(join(h, 'background')).filter((f) => f.endsWith('.json')); } catch {}
    for (const f of files) { try { process.kill(JSON.parse(readFileSync(join(h, 'background', f), 'utf8')).pid, 'SIGKILL'); } catch {} }
  }
});
function sessionsEnv() {
  const { cwd, env, base } = setup();
  homes.push(env.AGENTIC_HOME);
  // What runInPty gives the app it starts, for one started here (coding --bg) too.
  const quiet = { AGENTIC_NO_OPEN: '1', AGENTIC_FETCH_EVERY: '0', AGENTIC_CLAUDE_NOTES: 'off', AGENTIC_TIPS: 'off', TERM: 'xterm-256color' };
  return { cwd, base, env: { ...env, ...quiet, AGENTIC_SESSIONS: 'on', AGENTIC_MEMORY_SAVE: 'off' } };
}
const coding = (args, { cwd, env }) => spawnSync('bun', [cli, ...args], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20_000 });
// The same without stopping this process: the door the test runs must answer meanwhile.
function codingAsync(args, { cwd, env }) {
  return new Promise((resolve) => {
    const p = spawn('bun', [cli, ...args], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    const t = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
}
const records = (env) => { try { return readdirSync(join(env.AGENTIC_HOME, 'background')).filter((f) => f.endsWith('.json')); } catch { return []; } };
async function until(fn, ms = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}

test.skipIf(!S.canHost())('ctrl+b leaves the app running; coding sessions lists it; coding attach <name> opens that one with what was typed; quitting there ends only it', async () => {
  const { cwd, env } = sessionsEnv();
  const fake = await startFakeServer([]);
  try {
    const a = await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, { type: 'hello there' }, { sleep: 400 }, { key: CTRL_B },
      { wait: 'Still running in the background: demo-project-1' },
    ] });
    expect(a.code).toBe(0);
    expect(a.text).toContain('coding attach demo-project-1');
    // On a line of its own, under the prompt box, not over its edge.
    expect(a.text.split('\n').find((l) => l.includes('Still running in the background'))).not.toMatch(/[─╯╰]/);
    expect(records(env)).toEqual(['demo-project-1.json']);

    // A second one, so coding attach must open the one named.
    expect(coding(['--bg', '--url', fake.url], { cwd, env }).stdout).toContain('Started in the background: demo-project-2');
    const listed = coding(['sessions'], { cwd, env });
    expect(listed.stdout).toContain('demo-project-1 · ');
    expect(listed.stdout).toContain('demo-project-2 · ');
    expect(listed.stdout).toContain('in the background');
    // A name that is no session here is taken for another Mac's.
    const other = await codingAsync(['attach', 'demo-project-9'], { cwd, env: { ...env, AGENTIC_REMOTE_KEY: 'acd-x', AGENTIC_REMOTE_KEYSTORE: 'file' } });
    expect(other.status).toBe(1);
    expect(other.stderr).toContain('demo-project-9');

    // Opened again in a smaller window: the whole screen is drawn again at its size, the typed text still there.
    const b = await runInPty({ cwd, env, cols: 100, rows: 30, args: ['attach', 'demo-project-1'], steps: [
      { wait: 'hello there' }, { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'open' },
      { key: 'ctrlC' }, { sleep: 300 }, { key: 'ctrlC' }, { sleep: 200 }, { key: 'ctrlC' },
      { wait: 'Continue this conversation with' },
    ] });
    expect(b.snapshots.open).toContain('Agentic Coder v');
    expect(b.code).toBe(0);
    // demo-project-1 ended; demo-project-2 still runs.
    expect(await until(() => records(env).join() === 'demo-project-2.json')).toBe(true);
    const after = coding(['sessions'], { cwd, env }).stdout;
    expect(after).toContain('demo-project-2 · ');
    expect(after).not.toContain('demo-project-1');
  } finally { await fake.close(); }
}, 90_000);

test.skipIf(!S.canHost())('two windows on one session: what one types shows in both, and the app is drawn at the smaller size', async () => {
  const { cwd, env } = sessionsEnv();
  const fake = await startFakeServer([]);
  let typed;
  const bTyped = new Promise((r) => { typed = r; });
  let b = null;
  try {
    const a = await runInPty({ cwd, env, cols: 150, rows: 45, args: ['--url', fake.url], steps: [
      { wait: '? for shortcuts', ms: 30_000 },
      { fn: () => {
        b = runInPty({ cwd, env, cols: 100, rows: 30, args: ['attach', 'demo-project-1'], steps: [
          { wait: '? for shortcuts' }, { type: 'from window b' }, { sleep: 600 }, { snapshot: 'b' }, { fn: () => typed() },
          { wait: 'Continue this conversation with', ms: 20_000 },
        ] });
      } },
      { fn: () => bTyped },
      { sleep: 500 }, { snapshot: 'a' },
      { key: 'ctrlC' }, { sleep: 300 }, { key: 'ctrlC' }, { sleep: 200 }, { key: 'ctrlC' },
      { wait: 'Continue this conversation with' },
    ], timeoutMs: 60_000 });
    const rb = await b;
    expect(rb.snapshots.b).toContain('from window b');
    expect(a.snapshots.a).toContain('from window b');
    // The prompt box's edges, in the bigger window: no wider than the smaller one.
    const edges = a.snapshots.a.split('\n').filter((l) => /[╭╰]─/.test(l));
    expect(edges.length).toBeGreaterThan(0);
    for (const l of edges) expect(l.trimEnd().length).toBeLessThanOrEqual(100);
    expect(a.code).toBe(0);
    expect(rb.code).toBe(0);
    expect(await until(() => records(env).length === 0)).toBe(true);
  } finally { await fake.close(); }
}, 90_000);

test.skipIf(!S.canHost())('closing the window a session started in ends it, as closing a window always did', async () => {
  const { cwd, env } = sessionsEnv();
  const fake = await startFakeServer([]);
  try {
    let host = null;
    await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
      { wait: '? for shortcuts', ms: 30_000 },
      { fn: () => {
        host = JSON.parse(readFileSync(join(env.AGENTIC_HOME, 'background', 'demo-project-1.json'), 'utf8')).pid;
        // The window's own program: the one started with these words that the host did not start
        // (from the code or the built app; the shell lines around it quote them, so they do not match).
        const app = spawnSync('pgrep', ['-P', String(host)], { encoding: 'utf8' }).stdout.trim().split('\n');
        const all = spawnSync('pgrep', ['-f', '--', `--url ${fake.url}`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
        const win = all.filter((p) => !app.includes(p));
        expect(win.length).toBe(1);
        process.kill(Number(win[0]), 'SIGHUP');
      } },
      { sleep: 500 },
    ] });
    expect(host).not.toBe(null);
    expect(await until(() => records(env).length === 0, 20_000)).toBe(true);
    expect(await until(() => { try { process.kill(host, 0); return false; } catch { return true; } })).toBe(true);
  } finally { await fake.close(); }
}, 90_000);

test.skipIf(!S.canHost())('through the door: another window lists and opens a session with the key, and ctrl+b leaves it running', async () => {
  const { cwd, env } = sessionsEnv();
  const fake = await startFakeServer([]);
  // The door runs in this test, over the sessions of the app's home.
  const before = process.env.AGENTIC_HOME;
  process.env.AGENTIC_HOME = env.AGENTIC_HOME;
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-test-key' });
  const port = String(door.address().port);
  // AGENTIC_REMOTE_KEY stands in for the key the Keychain would keep.
  const viaDoor = { ...env, AGENTIC_REMOTE_KEY: 'acd-test-key', AGENTIC_REMOTE_KEYSTORE: 'file' };
  try {
    const started = coding(['--bg', '--url', fake.url], { cwd, env });
    expect(started.stdout).toContain('Started in the background: demo-project-1');
    expect(await until(() => coding(['sessions'], { cwd, env }).stdout.includes('demo-project-1'))).toBe(true);

    const listed = await codingAsync(['sessions', '127.0.0.1', '--port', port], { cwd, env: viaDoor });
    expect(listed.stdout).toContain('demo-project-1 · ');

    const wrong = await codingAsync(['sessions', '127.0.0.1', '--port', port], { cwd, env: { ...viaDoor, AGENTIC_REMOTE_KEY: 'acd-nope' } });
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain('does not open');

    const r = await runInPty({ cwd, env: viaDoor, cols: 110, rows: 32, args: ['attach', '127.0.0.1', 'demo-project-1', '--port', port], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, { type: 'over the door' }, { sleep: 500 }, { snapshot: 'open' }, { key: CTRL_B },
      { wait: 'Still running in the background: demo-project-1' },
    ] });
    expect(r.snapshots.open).toContain('over the door');
    expect(r.text).toContain('coding attach 127.0.0.1 demo-project-1');
    expect(r.code).toBe(0);
    expect(records(env)).toEqual(['demo-project-1.json']);

    // The first time, with no key kept: the key typed (not shown), the menu, then typing in the
    // session. Every step reads the keyboard after the one before, so none may leave it deaf.
    const first = { ...env, AGENTIC_REMOTE_KEY: '', AGENTIC_REMOTE_KEYSTORE: 'file' };
    const k = await runInPty({ cwd, env: first, cols: 110, rows: 32, args: ['attach', '127.0.0.1', '--port', port], steps: [
      { wait: "The key for 127.0.0.1's door" }, { type: 'acd-test-key' }, { key: 'enter' },
      { wait: 'Start a new session on 127.0.0.1' }, { snapshot: 'menu' }, { key: 'enter' },
      { wait: '? for shortcuts', ms: 30_000 }, { type: 'typed after the menus' }, { sleep: 500 }, { snapshot: 'typed' }, { key: CTRL_B },
      { wait: 'Still running in the background: demo-project-1' },
    ] });
    expect(k.snapshots.menu).not.toContain('acd-test-key'); // the key is never shown
    expect(k.snapshots.menu).toContain('demo-project-1 · ');
    expect(k.snapshots.typed).toContain('typed after the menus');
    expect(k.code).toBe(0);
    // Kept for next time (here in the test home's file; the Keychain on a Mac).
    expect(JSON.parse(readFileSync(join(env.AGENTIC_HOME, 'remote-keys.json'), 'utf8'))).toEqual({ 'door-127.0.0.1': 'acd-test-key' });
  } finally {
    door.close();
    process.env.AGENTIC_HOME = before;
    await fake.close();
  }
}, 90_000);

test('the door after a restart: the login item opens Terminal on a script that starts it from there', () => {
  const text = D.startFileText(['/Users/x/.agentic-coder/app/agentic-coder'], "/tmp/it's home");
  expect(text.startsWith('#!/bin/sh\n')).toBe(true);
  expect(text).toContain("'/Users/x/.agentic-coder/app/agentic-coder' door start");
  expect(text).toContain("export AGENTIC_HOME='/tmp/it'\\''s home'");
  expect(D.startFileText(['/a/b'], '').includes('AGENTIC_HOME')).toBe(false); // no test home: none set
  // No door recorded, or a pid that is not a door: not running.
  expect(D.doorRunning({})).toBe(false);
  expect(D.doorRunning({ pid: process.pid })).toBe(false);
});
