// Background sessions (src/app/sessions.mjs) and the door between Macs (src/app/door.mjs):
// the frames, the names, the modes a joining window is told, the door's key and its list,
// and end to end in a pseudo-terminal: ctrl+b, coding sessions, coding attach, two windows
// at once, closing the window a session started in, and a window through the door.
import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';

// A throwaway home before the models part is imported (it reads AGENTIC_HOME once).
const unitHome = mkdtempSync(join(tmpdir(), 'agentic-sessions-'));
process.env.AGENTIC_HOME = join(unitHome, 'home');
const S = await import('../src/app/sessions.mjs');
const D = await import('../src/app/door.mjs');
const { HOME, ENGINE, MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');
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
  // This Mac is "server-1" to the other one, which the door knows as "mac-mini"; a window it
  // would open here is noted, not opened.
  const windows = [];
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-test-key', mac: 'server-1', peerName: () => 'mac-mini', show: (name, size) => windows.push({ name, ...size }) });
  const port = String(door.address().port);
  // AGENTIC_REMOTE_KEY stands in for the key the Keychain would keep.
  const viaDoor = { ...env, AGENTIC_REMOTE_KEY: 'acd-test-key', AGENTIC_REMOTE_KEYSTORE: 'file' };
  try {
    const started = coding(['--bg', '--url', fake.url], { cwd, env });
    expect(started.stdout).toContain('Started in the background: demo-project-1');
    expect(await until(() => coding(['sessions'], { cwd, env }).stdout.includes('demo-project-1'))).toBe(true);

    const listed = await codingAsync(['sessions', '127.0.0.1', '--port', port], { cwd, env: viaDoor });
    expect(listed.stdout).toContain('demo-project-1 · ');

    // By its name, as on a real pair of Macs (the name led to this Mac for the test).
    const named = await codingAsync(['sessions', 'server-1', '--port', port], { cwd, env: { ...viaDoor, AGENTIC_DOOR_AT: 'server-1=127.0.0.1' } });
    expect(named.stdout).toContain('demo-project-1 · ');

    const wrong = await codingAsync(['sessions', '127.0.0.1', '--port', port], { cwd, env: { ...viaDoor, AGENTIC_REMOTE_KEY: 'acd-nope' } });
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain('does not open');

    const r = await runInPty({ cwd, env: viaDoor, cols: 110, rows: 32, args: ['attach', '127.0.0.1', 'demo-project-1', '--port', port], steps: [
      { wait: '? for shortcuts', ms: 30_000 }, { type: 'over the door' }, { wait: '⇄ on server-1' }, { sleep: 300 }, { snapshot: 'open' }, { key: CTRL_B },
      { wait: 'Still running in the background: demo-project-1' },
    ] });
    expect(r.snapshots.open).toContain('over the door');
    // Lower right, which Mac the keys go to; the session's list names who is in it.
    expect(r.snapshots.open).toContain('⇄ on server-1');
    // It had no window on this Mac (coding --bg), so one was opened here, at the other window's size.
    expect(windows).toEqual([{ name: 'demo-project-1', cols: 110, rows: 32 }]);
    expect(r.text).toContain('coding attach 127.0.0.1 demo-project-1');
    expect(r.code).toBe(0);
    expect(records(env)).toEqual(['demo-project-1.json']);

    // The first time, with no key kept: the key typed (not shown), the menu, then typing in the
    // session. Every step reads the keyboard after the one before, so none may leave it deaf.
    const first = { ...env, AGENTIC_REMOTE_KEY: '', AGENTIC_REMOTE_KEYSTORE: 'file' };
    const k = await runInPty({ cwd, env: first, cols: 110, rows: 32, args: ['attach', '127.0.0.1', '--port', port], steps: [
      { wait: "The key for 127.0.0.1's door" }, { type: 'acd-test-key' }, { key: 'enter' },
      { wait: 'New session in… (type a folder)' }, { snapshot: 'menu' }, { key: 'enter' },
      { wait: '? for shortcuts', ms: 30_000 }, { type: 'typed after the menus' }, { sleep: 500 }, { snapshot: 'typed' }, { key: CTRL_B },
      { wait: 'Still running in the background: demo-project-1' },
    ] });
    expect(k.snapshots.menu).not.toContain('acd-test-key'); // the key is never shown
    expect(k.snapshots.menu).toContain('demo-project-1 · ');
    // What runs there, a rule, then what can be started there.
    expect(k.snapshots.menu).toMatch(/1\. demo-project-1 · [\s\S]*?\n\s+─{20,}\n\s+2\. New session in ~ \(home\)\n\s+3\. New session in… \(type a folder\)/);
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

// ---- 3 Oct 2026, the audit's gaps: a stalled window, wrong keys together, a folder for a new session, a lost link ----

test('the door: wrong keys sent together on connections opened first are not all looked at', async () => {
  const seen = [];
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-right', log: (t) => seen.push(t) });
  const port = door.address().port;
  try {
    const socks = [];
    for (let i = 0; i < 30; i++) { const s = net.connect({ host: '127.0.0.1', port }); await new Promise((r) => s.on('connect', r)); s.on('error', () => {}); socks.push(s); }
    for (const [i, s] of socks.entries()) s.write(S.frame(S.F.HELLO, { key: `acd-guess-${i}`, op: 'list' }));
    await new Promise((r) => setTimeout(r, 1500));
    // Five were looked at; the address was then refused and the other 25 never compared.
    expect(seen.filter((t) => t.startsWith('wrong key')).length).toBe(5);
    for (const s of socks) s.destroy();
  } finally { door.close(); }
});

test('the folders conversations were had in, latest first: none that is gone or a throwaway one', async () => {
  const dir = join(unitHome, 'convs');
  const repo = join(import.meta.dir, '..', '..');
  const conv = (slug, id, cwd, title, at) => {
    mkdirSync(join(dir, slug), { recursive: true });
    const f = join(dir, slug, `${id}.json`);
    writeFileSync(f, JSON.stringify({ id, cwd, title, updated: new Date(at).toISOString(), messages: [] }));
    utimesSync(f, at / 1000, at / 1000);
  };
  const t = Date.parse('2026-10-03T10:00:00Z');
  conv('terminal', 'a', join(repo, 'terminal'), 'older in terminal', t - 9000);
  conv('terminal', 'b', join(repo, 'terminal'), 'the menu', t - 1000);
  conv('models', 'a', join(repo, 'models'), 'the bench', t - 5000);
  conv('home', 'a', homedir(), 'a question', t - 7000);
  conv('gone', 'a', join(repo, 'no-such-folder'), 'gone', t - 100);
  conv('tmp', 'a', unitHome, 'a test project', t - 50);
  const { recentFolders } = await import('../src/app/store.mjs');
  expect(recentFolders({ dir }).map((f) => [f.folder, f.title, f.convs])).toEqual([
    [join(repo, 'terminal'), 'the menu', 2], [join(repo, 'models'), 'the bench', 1], [homedir(), 'a question', 1],
  ]);
  expect(recentFolders({ dir, max: 1 }).length).toBe(1);
  expect(recentFolders({ dir: join(unitHome, 'nothing-here') })).toEqual([]);
});

test('the rows that start a session on the other Mac: its folders, its home, a typed one, its last conversation; an older door only its home', () => {
  const folders = [{ path: '~/Desktop/a' }, { path: '~' }, { path: '~/b' }, { path: '~/c' }, { path: '~/d' }, { path: '~/e' }];
  const rows = D.newRows({ host: 'server-1', v: 2, folders, last: { path: '~/Desktop/a', title: 'fix the tests' } });
  expect(rows.map((r) => r.text)).toEqual([
    'New session in ~/Desktop/a', 'New session in ~/b', 'New session in ~/c', 'New session in ~/d',
    'New session in ~ (home)', 'New session in… (type a folder)', 'Continue the last conversation there (~/Desktop/a · fix the tests)',
  ]);
  expect(rows[0].hello).toEqual({ op: 'new', folder: '~/Desktop/a' });
  expect(rows[4].hello).toEqual({ op: 'new', folder: '~' });
  expect(rows[5].type).toBe(true);
  expect(rows[6].hello).toEqual({ op: 'new', last: true });
  expect(D.newRows({ host: 'server-1', v: 2 }).map((r) => r.text)).toEqual(['New session in ~ (home)', 'New session in… (type a folder)']);
  expect(D.newRows({ host: 'server-1', v: 1, folders })).toEqual([{ text: 'Start a new session on server-1', hello: { op: 'new' } }]);
});

test('the window opened on this Mac for a session another Mac works in: its size, then coding attach', () => {
  const text = D.windowFileText(['/Users/x/.agentic-coder/app/agentic-coder'], 'demo-1', { cols: 120, rows: 40 }, '');
  expect(text.startsWith('#!/bin/sh\n')).toBe(true);
  expect(text).toContain("printf '\\033[8;%d;%dt' 40 120\n");
  expect(text.trimEnd().endsWith("exec '/Users/x/.agentic-coder/app/agentic-coder' attach 'demo-1'")).toBe(true);
  // No size known: none set. A test home comes along.
  expect(D.windowFileText(['/a/b'], 'demo-1', {}, "/tmp/it's")).not.toContain('printf');
  expect(D.windowFileText(['/a/b'], 'demo-1', {}, "/tmp/it's")).toContain("export AGENTIC_HOME='/tmp/it'\\''s'");
});

// A session whose program is not the app: `cmd` in a host of its own, in the throwaway home.
async function plainHost(name, cmd, home) {
  const spec = { name, folder: unitHome, cmd, cols: 100, rows: 30 };
  const p = spawn('bun', [cli, 'session-host'], { cwd: unitHome, stdio: 'ignore', env: { ...process.env, AGENTIC_HOME: home, AGENTIC_HOST_SPEC: JSON.stringify(spec) } });
  const file = join(home, 'background', `${name}.json`);
  const ok = await until(() => { try { const r = JSON.parse(readFileSync(file, 'utf8')); return r.socket && existsSync(r.socket); } catch { return false; } });
  if (!ok) { p.kill('SIGKILL'); throw new Error('the host did not start'); }
  return { stop: () => p.kill('SIGKILL'), record: () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } } };
}

test.skipIf(!S.canHost())('a window through the door that stops checking in is let go: no longer counted, no longer what the session is sized to; an older window (no check-in) is kept', async () => {
  const home = process.env.AGENTIC_HOME;
  const h = await plainHost('quiet-1', ['/bin/sh', '-c', 'sleep 60'], home);
  const said = [];
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-k', mac: 'server-1', peerName: () => 'mac-mini', show: () => {}, staleMs: 700, log: (t) => said.push(t) });
  const port = door.address().port;
  const open = (hello) => new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const got = [];
    const read = S.frameReader((kind, body) => got.push([kind, S.json(body)]));
    s.on('data', (c) => read(c));
    s.on('error', () => {});
    s.on('connect', () => { s.write(S.frame(S.F.HELLO, { key: 'acd-k', op: 'attach', name: 'quiet-1', cols: 60, rows: 20, ...hello })); res({ s, got }); });
  });
  try {
    // Checks in (v 2), then says nothing: gone within the limit, and the record forgets it.
    const a = await open({ v: 2 });
    expect(await until(() => a.got.some(([k]) => k === S.F.NAMED), 5000)).toBe(true);
    expect(a.got.find(([k]) => k === S.F.NAMED)[1]).toEqual({ name: 'quiet-1', v: 2, beats: true, mac: 'server-1' });
    expect(await until(() => h.record()?.viewers === 1, 5000)).toBe(true);
    expect(h.record().shared).toEqual({ mac: 'server-1', with: ['mac-mini'] });
    expect(h.record().local).toBe(0);
    expect(await until(() => a.s.destroyed || a.s.readableEnded, 5000)).toBe(true);
    expect(await until(() => h.record()?.viewers === 0, 5000)).toBe(true);
    expect(h.record().shared).toBeUndefined();
    expect(said.some((t) => t.includes('went quiet'))).toBe(true);
    // One that keeps checking in stays, and each check-in is answered.
    const b = await open({ v: 2 });
    const beat = setInterval(() => b.s.write(S.frame(S.F.PING)), 150);
    await new Promise((r) => setTimeout(r, 1600));
    clearInterval(beat);
    expect(b.s.destroyed).toBe(false);
    expect(b.got.filter(([k]) => k === S.F.PONG).length).toBeGreaterThan(5);
    b.s.destroy();
    // An app from before the check-in says no v: it is never let go for being quiet.
    const c = await open({});
    await new Promise((r) => setTimeout(r, 1600));
    expect(c.s.destroyed).toBe(false);
    c.s.destroy();
  } finally { door.close(); h.stop(); }
}, 40_000);

test('a window whose link goes quiet opens the same session again by itself, and says so meanwhile; a session that ended meanwhile is said', async () => {
  // A door of the test's own: it names the session and answers check-ins until told to go quiet.
  let quietNow = false;
  let hellos = [];
  let gone = false;
  const server = net.createServer((sock) => {
    const read = S.frameReader((kind, body) => {
      if (kind === S.F.HELLO) {
        const h = S.json(body);
        hellos.push(h);
        if (gone) { sock.end(S.frame(S.F.NOTE, { text: 'No session called demo-1 here.', gone: true })); return; }
        sock.write(S.frame(S.F.NAMED, { name: 'demo-1', v: 2, beats: true, mac: 'server-1' }));
        sock.write(S.frame(S.F.OUTPUT, `screen ${hellos.length}`));
      } else if (kind === S.F.PING && !quietNow) sock.write(S.frame(S.F.PONG));
    });
    sock.on('data', (c) => read(c));
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const input = new PassThrough();
  const output = new PassThrough();
  output.columns = 90; output.rows = 28;
  let shown = '';
  output.on('data', (c) => { shown += c; });
  try {
    const view = S.viewSession({
      name: 'a new session on server-1', where: 'server-1', input, output,
      connect: () => net.connect({ host: '127.0.0.1', port }),
      hello: { key: 'k', v: 2, op: 'new', folder: '~/x' },
      again: (n) => ({ key: 'k', v: 2, op: 'attach', name: n, again: true }),
      beatMs: 120, retryMs: 150,
    });
    expect(await until(() => shown.includes('screen 1'), 5000)).toBe(true);
    expect(hellos[0]).toMatchObject({ op: 'new', folder: '~/x', cols: 90, rows: 28 });
    // The link stalls: nothing closes, nothing answers. The window notices, says so, and opens demo-1 again.
    quietNow = true;
    expect(await until(() => shown.includes('Connection to server-1 lost, reconnecting'), 5000)).toBe(true);
    quietNow = false;
    expect(await until(() => shown.includes('screen 2'), 5000)).toBe(true);
    expect(hellos[1]).toMatchObject({ op: 'attach', name: 'demo-1', again: true, key: 'k' });
    // The session ends on the other Mac while the link is down: said, and the window is given back.
    gone = true;
    quietNow = true;
    expect(await view).toBe(0);
    expect(shown).toContain('demo-1 ended on server-1 while the link was down');
  } finally { server.close(); }
}, 30_000);

test.skipIf(!S.canHost())('through the door, a new session in a folder typed there: it starts in that folder, a window for it opens on that Mac, and a lost link comes back by itself', async () => {
  const { cwd, env } = sessionsEnv();
  const fake = await startFakeServer([]);
  const before = process.env.AGENTIC_HOME;
  process.env.AGENTIC_HOME = env.AGENTIC_HOME;
  const windows = [];
  // A session started through the door gets what the door's Mac has: here a stand-in model, off
  // until /start (as shipped), the test home and its own memory folder, like an app the tests drive.
  mkdirSync(join(env.AGENTIC_HOME, 'engine', ENGINE.tag), { recursive: true });
  mkdirSync(join(env.AGENTIC_HOME, 'models'), { recursive: true });
  symlinkSync(join(import.meta.dir, 'fake-llama-server.mjs'), join(env.AGENTIC_HOME, 'engine', ENGINE.tag, 'llama-server'));
  writeFileSync(join(env.AGENTIC_HOME, 'models', MODELS[DEFAULT_MODEL].file), 'stand-in');
  const startEnv = { ...process.env, ...env, AGENTIC_MODEL_AT_START: 'off', AGENTIC_MEMORY: join(cwd, '..', 'memory-about-you'), AGENTIC_NO_OPEN: '1', AGENTIC_HUB_PORT: '0', AGENTIC_FETCH_EVERY: '0', AGENTIC_CLAUDE_NOTES: 'off', AGENTIC_TIPS: 'off', TERM: 'xterm-256color' };
  // The door runs inside this test, so the app it starts is named: the code's own.
  const opts = { host: '127.0.0.1', key: 'acd-test-key', mac: 'server-1', peerName: () => 'mac-mini', show: (name, size) => windows.push({ name, ...size }), startEnv, start: (o) => S.startHost({ ...o, self: ['bun', cli] }) };
  let door = await D.openDoor({ ...opts, port: 0 });
  const port = door.address().port;
  const links = new Set();
  const track = (d) => d.on('connection', (s) => { links.add(s); s.on('close', () => links.delete(s)); });
  track(door);
  const viaDoor = { ...env, AGENTIC_REMOTE_KEY: 'acd-test-key', AGENTIC_REMOTE_KEYSTORE: 'file' };
  try {
    // A folder that is not there is said, and nothing starts.
    const none = await runInPty({ cwd, env: viaDoor, cols: 110, rows: 32, args: ['attach', '127.0.0.1', '--port', String(port)], steps: [
      { wait: 'New session in… (type a folder)' }, { key: '2' }, { wait: 'Folder on 127.0.0.1' }, { type: '~/no-such-folder-here' }, { key: 'enter' },
      { wait: 'No folder ~/no-such-folder-here on server-1' },
    ] });
    expect(none.code).toBe(1);
    expect(records(env)).toEqual([]);

    const r = await runInPty({ cwd, env: viaDoor, cols: 110, rows: 32, timeoutMs: 80_000, args: ['attach', '127.0.0.1', '--port', String(port)], steps: [
      { wait: 'New session in… (type a folder)' }, { key: '2' }, { wait: 'Folder on 127.0.0.1' }, { snapshot: 'ask' }, { type: cwd }, { key: 'enter' },
      { wait: '⇄ on server-1', ms: 40_000 }, { type: 'typed from afar' }, { sleep: 500 }, { snapshot: 'open' },
      // The link drops (the door stops, its connections cut): said on the last line, tried again.
      { fn: async () => { for (const s of links) s.destroy(); await new Promise((res) => door.close(res)); } },
      { wait: 'Connection to 127.0.0.1 lost, reconnecting' }, { snapshot: 'lost' },
      // The door is back: the window opens the same session again, with what was typed still there.
      { fn: async () => { door = await D.openDoor({ ...opts, port }); track(door); } },
      { waitGone: 'reconnecting', ms: 20_000 }, { wait: 'typed from afar' }, { wait: '⇄ on server-1' }, { type: ' and back' }, { sleep: 500 }, { snapshot: 'back' },
      ...quit, { sleep: 200 }, { key: 'ctrlC' },
      { wait: 'Continue this conversation with', ms: 20_000 },
    ] });
    expect(r.snapshots.ask).toContain('Folder on 127.0.0.1 (~ is its home):');
    expect(r.snapshots.open).toContain('typed from afar');
    expect(r.snapshots.open).toContain('demo-project');
    expect(r.snapshots.lost).toContain('ctrl+b to stop');
    expect(r.snapshots.back).toContain('typed from afar and back');
    expect(r.snapshots.back).not.toContain('reconnecting');
    // One session, started in the folder typed; a window for it was opened on that Mac, once
    // (not again when the same window came back), at the other window's size.
    expect(windows).toEqual([{ name: 'demo-project-1', cols: 110, rows: 32 }]);
    expect(r.code).toBe(0);
    expect(await until(() => records(env).length === 0)).toBe(true);
    // The keeper's log says what happened, where before nothing was kept.
    const logged = readFileSync(join(env.AGENTIC_HOME, 'logs', 'sessions.log'), 'utf8');
    expect(logged).toContain('demo-project-1 started in');
    expect(logged).toContain('a window joined from mac-mini');
    expect(logged).toContain('demo-project-1 ended (code 0)');
  } finally {
    door.close();
    process.env.AGENTIC_HOME = before;
    await fake.close();
  }
}, 150_000);
