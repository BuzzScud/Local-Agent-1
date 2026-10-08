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
import { openTerm } from './term.mjs';
import { checkScreen } from './screen-checks.mjs';
import { needs } from './needs.mjs';

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
    // In case it was a slip of the name: what does run on this Mac is said too.
    expect(other.stderr).toContain('If you meant a session on this Mac, these run here: demo-project-1, demo-project-2. coding sessions lists them.');

    // Opened again in a smaller window: the whole screen is drawn again at its size, the typed text still there.
    const b = await runInPty({ cwd, env, cols: 100, rows: 30, args: ['attach', 'demo-project-1'], steps: [
      { wait: 'hello there' }, { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'open' },
      { key: 'ctrlC' }, { sleep: 300 }, { key: 'ctrlC' }, { sleep: 200 }, { key: 'ctrlC' },
      { wait: 'Continue this conversation with' },
    ] });
    expect(b.snapshots.open).toContain('Welcome');
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
    // As saveSession writes it: the title first, the folder among the last keys.
    writeFileSync(f, JSON.stringify({ title, messages: [], cwd, id, updated: new Date(at).toISOString() }));
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
  // Left to the caller to check (the door does, with a time limit): the folder that is gone comes too.
  expect(recentFolders({ dir, exists: null }).map((f) => f.title)).toEqual(['gone', 'the menu', 'the bench', 'a question']);
  // Only the first and last bytes of a conversation are read, never the whole of it: one whose
  // middle is not even JSON (and 3 MB long) is read all the same, quotes in its title included.
  mkdirSync(join(dir, 'big'), { recursive: true });
  writeFileSync(join(dir, 'big', 'z.json'), `{"title":"the \\"big\\" one","messages":[${'x'.repeat(3_000_000)}],"cwd":${JSON.stringify(join(repo, 'docs'))},"id":"z","updated":"2026-10-03T11:00:00.000Z"}`);
  utimesSync(join(dir, 'big', 'z.json'), (t + 5000) / 1000, (t + 5000) / 1000);
  const t0 = performance.now();
  expect(recentFolders({ dir })[0]).toEqual({ folder: join(repo, 'docs'), title: 'the "big" one', updated: '2026-10-03T11:00:00.000Z', convs: 1 });
  expect(performance.now() - t0).toBeLessThan(500);
  // A throwaway run is told by its folder's name: its file is never opened (this one cannot be read as one).
  mkdirSync(join(dir, 'private-var-folders-x-T-agentic-e2e-1-demo-project'), { recursive: true });
  writeFileSync(join(dir, 'private-var-folders-x-T-agentic-e2e-1-demo-project', 'a.json'), 'not a conversation');
  expect(recentFolders({ dir }).length).toBe(4);
  // And what the app itself saves is what this reads (the two are written apart: store.mjs).
  const { saveSession } = await import('../src/app/store.mjs');
  saveSession(join(repo, 'terminal'), 'made-by-the-app', { title: 'saved by the app', messages: [{ role: 'user', content: 'hi' }] });
  expect(recentFolders().map((f) => [f.folder, f.title])).toEqual([[join(repo, 'terminal'), 'saved by the app']]);
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
  // It says it was opened by the door: it shows the session, and the size stays the other window's until it is used.
  expect(text).toContain('export AGENTIC_DOOR_WINDOW=1\n');
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

// ---- 3 Oct 2026, the first try between two real Macs: the other Mac took connections and said nothing for minutes ----

test('the door never waits on its folders: a list is answered without them when they cannot be read in time; a folder that does not answer is not there', async () => {
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-k', mac: 'server-1', folders: () => new Promise(() => {}), foldersMs: 300, startEnv: { ...process.env, AGENTIC_SESSIONS: 'on' } });
  try {
    const t0 = Date.now();
    const list = await askDoor(door.address().port, { key: 'acd-k', op: 'list', v: 2 });
    expect(list.kind).toBe(S.F.LIST);
    expect(list.body).toMatchObject({ v: 2, mac: 'server-1', sessions: [], folders: [], last: null });
    expect(Date.now() - t0).toBeLessThan(3000);
    // "The last conversation" with folders that never come: said, not waited for.
    const last = await askDoor(door.address().port, { key: 'acd-k', op: 'new', last: true, v: 2 });
    expect(last.body.text).toContain('No conversation was had on server-1 yet');
  } finally { door.close(); }
  // The real list, in the test home: a conversation in a folder that is there, one in a folder that is gone.
  const sess = join(process.env.AGENTIC_HOME, 'sessions');
  const conv = (slug, cwd, title) => { mkdirSync(join(sess, slug), { recursive: true }); writeFileSync(join(sess, slug, 'a.json'), JSON.stringify({ title, messages: [], cwd, id: 'a', updated: new Date().toISOString() })); };
  conv('door-models', join(import.meta.dir, '..', '..', 'models'), 'there');
  conv('door-gone', join(import.meta.dir, '..', '..', 'no-such-folder'), 'gone');
  const got = await D.doorFolders(20);
  expect(got.some((f) => f.title === 'there')).toBe(true);
  expect(got.some((f) => f.title === 'gone')).toBe(false);
});

test('a Mac that takes the connection and then says nothing: the window says to look at its screen, and gives the terminal back', async () => {
  expect(D.reachProblem(Object.assign(new Error('timeout'), { code: 'SILENT' }), 'server-1')).toContain('server-1 took the connection but did not answer. Look at its screen');
  expect(D.reachProblem(new Error('timeout'), 'server-1')).toContain('did not answer. Is it awake');
  const server = net.createServer((sock) => { sock.on('data', () => {}); sock.on('error', () => {}); }); // hears, never answers
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const input = new PassThrough();
  const output = new PassThrough();
  output.columns = 90; output.rows = 28;
  let shown = '';
  output.on('data', (c) => { shown += c; });
  try {
    const code = await S.viewSession({
      name: 'a new session on server-1', where: 'server-1', input, output,
      connect: () => net.connect({ host: '127.0.0.1', port: server.address().port }),
      hello: { key: 'k', v: 2, op: 'new' }, again: (n) => ({ key: 'k', v: 2, op: 'attach', name: n, again: true }),
      silent: D.SILENT('server-1'), firstMs: 300,
    });
    expect(code).toBe(1);
    expect(shown).toContain('server-1 took the connection but did not answer');
  } finally { server.close(); }
}, 15_000);

// ---- /jumptomac (3 Oct 2026): the window goes to another Mac's sessions and comes back ----

test.skipIf(!S.canHost())('/jumptomac: the host sends the window that typed last, and only one that can jump; that window leaves the session running and says where to go', async () => {
  const home = process.env.AGENTIC_HOME;
  const h = await plainHost('jump-1', ['/bin/sh', '-c', 'stty raw -echo; exec cat'], home);
  const rec = h.record();
  const open = (hello) => new Promise((res) => {
    const s = net.connect(rec.socket);
    const got = [];
    const read = S.frameReader((kind, body) => got.push([kind, S.json(body)]));
    s.on('data', (c) => read(c));
    s.on('error', () => {});
    s.on('connect', () => { s.write(S.frame(S.F.HELLO, { cols: 80, rows: 24, ...hello })); res({ s, got }); });
  });
  try {
    // With no window open there is nobody to send.
    expect(await S.askJump('jump-1', 'server-1')).toEqual({ ok: false, text: 'no window is open on this session' });
    const a = await open({ jumps: true });
    const old = await open({}); // an app from before /jumptomac
    await until(() => h.record()?.viewers === 2, 5000);
    // The older window typed last: it cannot jump, and is not sent anything.
    old.s.write(S.frame(S.F.INPUT, 'x'));
    await new Promise((r) => setTimeout(r, 200));
    const no = await S.askJump('jump-1', 'server-1');
    expect(no.ok).toBe(false);
    expect(no.text).toContain('older Agentic Coder');
    // The one that can: it typed last, it is told the Mac; the other hears nothing of it.
    a.s.write(S.frame(S.F.INPUT, 'y'));
    await new Promise((r) => setTimeout(r, 200));
    expect(await S.askJump('jump-1', 'server-1')).toEqual({ ok: true, text: '' });
    expect(await until(() => a.got.some(([k]) => k === S.F.JUMP), 3000)).toBe(true);
    expect(a.got.find(([k]) => k === S.F.JUMP)[1]).toEqual({ mac: 'server-1' });
    expect(old.got.some(([k]) => k === S.F.JUMP)).toBe(false);
    a.s.destroy(); old.s.destroy();
    // No session of that name: said.
    expect((await S.askJump('nope-9', 'server-1')).ok).toBe(false);

    // The app's own window: sent away, it leaves (the session it started keeps running) and answers the Mac.
    const input = new PassThrough();
    const output = new PassThrough();
    output.columns = 90; output.rows = 28;
    const view = S.viewSession({ connect: S.localConnect(rec), name: 'jump-1', owner: true, jumps: true, input, output });
    await until(() => h.record()?.viewers === 1, 5000);
    input.write('typed here\n');
    await new Promise((r) => setTimeout(r, 300));
    expect((await S.askJump('jump-1', 'server-1')).ok).toBe(true);
    expect(await view).toEqual({ jump: 'server-1', name: 'jump-1' });
    expect(await until(() => h.record()?.viewers === 0, 5000)).toBe(true);
    await new Promise((r) => setTimeout(r, 500));
    expect(h.record()?.name).toBe('jump-1'); // still running: the window it started in left, it did not close
  } finally { h.stop(); }
}, 40_000);

test.skipIf(!S.canHost())('/jumptomac in the app: a Mac reached for the first time asks to be saved, the window shows its sessions, opens one, and ctrl+b there comes back to the session it left; alone, a box of the saved Macs opens on it and enter goes there', async () => {
  const { cwd, env, base } = sessionsEnv();
  const fake = await startFakeServer([]);
  const before = process.env.AGENTIC_HOME;
  process.env.AGENTIC_HOME = env.AGENTIC_HOME;
  // "server-1" is this Mac; a session already runs there, in another folder, with no window.
  const other = join(base, 'other');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(env.AGENTIC_HOME, 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString(), [other]: new Date().toISOString() }));
  const windows = [];
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-test-key', mac: 'server-1', peerName: () => 'mac-mini', show: (name) => windows.push(name) });
  // What Tailscale says here, standing in for the real one: server-1 online.
  const tsFile = join(base, 'tailscale-status.json');
  writeFileSync(tsFile, JSON.stringify({ Self: { DNSName: 'mac-mini.example.ts.net.', OS: 'macOS' }, Peer: { a: { DNSName: 'server-1.example.ts.net.', HostName: 'Server 1', OS: 'macOS', Online: true } } }));
  const jumper = { ...env, AGENTIC_REMOTE_KEY: 'acd-test-key', AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_DOOR_AT: `server-1=127.0.0.1:${door.address().port}`, AGENTIC_TAILSCALE_STATUS: tsFile };
  try {
    expect(coding(['--bg', '--url', fake.url], { cwd: other, env }).stdout).toContain('Started in the background: other-1');
    expect(await until(() => records(env).includes('other-1.json'))).toBe(true);
    const r = await runInPty({ cwd, env: jumper, cols: 120, rows: 34, timeoutMs: 110_000, args: ['--url', fake.url], steps: [
      { wait: '? for shortcuts', ms: 30_000 },
      { type: '/jumptomac server-1' }, { key: 'enter' },
      // The first time: kept for /jumptomac's box? enter says yes.
      { wait: 'Keep it in /jumptomac', ms: 20_000 }, { sleep: 300 }, { snapshot: 'save' }, { key: 'enter' },
      { wait: 'Sessions on server-1', ms: 20_000 }, { sleep: 300 }, { snapshot: 'menu' }, { key: 'enter' },
      { wait: '⇄ on server-1', ms: 30_000 }, { type: 'typed on the other Mac' }, { sleep: 500 }, { snapshot: 'there' },
      // ctrl+b there: that session keeps running, and the window is back in the one it left.
      { key: CTRL_B }, { wait: 'This session keeps running here', ms: 20_000 }, { waitGone: 'typed on the other Mac', ms: 10_000 },
      { type: 'back home' }, { sleep: 500 }, { snapshot: 'back' },
      { key: 'ctrlC' }, { sleep: 300 },
      // Alone: the box, on the saved Mac; enter goes there (no question now), esc at its menu comes straight back.
      { type: '/jumptomac' }, { key: 'enter' }, { wait: 'Jump to a Mac', ms: 20_000 }, { wait: 'Tailscale sees', ms: 10_000 }, { sleep: 300 }, { snapshot: 'box' },
      { key: 'enter' }, { wait: 'Sessions on server-1', ms: 20_000 }, { sleep: 200 }, { snapshot: 'menu2' }, { key: 'esc' },
      { wait: '? for shortcuts', ms: 20_000 }, { sleep: 800 }, { snapshot: 'again' },
      ...quit, { wait: 'Continue this conversation with', ms: 20_000 },
    ] });
    expect(r.snapshots.save).toContain("server-1 answered. Keep it in /jumptomac's list?");
    expect(r.snapshots.save).toContain('Save server-1: /jumptomac lists it from now on');
    expect(r.snapshots.menu).toMatch(/1\. other-1 · /);
    expect(r.snapshots.menu).toMatch(/2\. demo-project-1 · /);
    // On a clear window: from the line that says where it goes, nothing of the app's last frame
    // under or beside the menu (what came before it is the window's scrollback).
    const cleared = r.snapshots.menu.slice(r.snapshots.menu.lastIndexOf('Jumping to server-1. demo-project-1 keeps running; ctrl+b there comes back to it.'));
    expect(cleared.startsWith('Jumping to server-1.')).toBe(true);
    expect(cleared).toContain('Sessions on server-1');
    expect(cleared).not.toMatch(/[╭╰╯│]|for shortcuts|model off/);
    expect(r.snapshots.there).toContain('typed on the other Mac');
    expect(r.snapshots.there).toContain('/other');
    expect(r.snapshots.back).toContain('back home');
    expect(r.snapshots.back).not.toContain('⇄ on server-1');
    expect(r.snapshots.back).toContain('Jumping to server-1. This session keeps running here; ctrl+b there comes back to it.');
    expect(r.snapshots.box).toMatch(/❯ server-1\s+● online · saved · used last/);
    expect(r.snapshots.box).toContain('+ Add a Mac');
    expect(r.snapshots.box).toContain('from mac-mini');
    expect(r.snapshots.box).toContain('Tailscale sees 1 other Mac here: server-1');
    expect(r.snapshots.menu2).not.toContain('Keep it in /jumptomac'); // saved: no question the second time
    expect(r.snapshots.again).toContain('demo-project');
    expect(r.code).toBe(0);
    // The one it jumped to still runs there; the one it came back to and quit is gone; the Mac is remembered.
    expect(await until(() => records(env).join() === 'other-1.json')).toBe(true);
    expect(JSON.parse(readFileSync(join(env.AGENTIC_HOME, 'settings.json'), 'utf8'))).toMatchObject({ lastMac: 'server-1', macs: ['server-1'] });
    expect(windows).toEqual(['other-1']);
  } finally {
    door.close();
    process.env.AGENTIC_HOME = before;
    await fake.close();
  }
}, 150_000);

// ---- the size a session is drawn at (4 Oct 2026, the owner's pick: "the one I'm using") ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('keys someone typed, against what a terminal sends by itself', () => {
  for (const k of ['a', '\x1b[A', '\r', '\x1b[<0;10;5M', '\x1b[<64;10;5M', '\x1b[<32;10;5M', '\x1b[12;5Rx']) expect([k, S.typedBySomeone(k)]).toEqual([k, true]);
  // The answer to a cursor question, focus in and out, the mouse moving with no button held.
  for (const k of ['\x1b[12;5R', '\x1b[I', '\x1b[O', '\x1b[<35;10;5M', '\x1b[I\x1b[3;1R']) expect([k, S.typedBySomeone(k)]).toEqual([k, false]);
});

test.skipIf(!S.canHost())('the app is drawn for the window used last (opened, typed in, resized); the window the door opened by itself only shows until it is used; a resize that ends where it began draws it all again', async () => {
  const home = process.env.AGENTIC_HOME;
  // A program that prints its terminal's size at the start and at each change.
  const show = "const p = () => process.stdout.write('[' + process.stdout.rows + ' ' + process.stdout.columns + ']'); p(); process.stdout.on('resize', p); setInterval(() => {}, 1000);";
  const h = await plainHost('size-1', [process.execPath, '-e', show], home);
  const rec = h.record();
  const open = (hello) => new Promise((res) => {
    const s = net.connect(rec.socket);
    const w = { s, out: '', drawn: [] };
    const read = S.frameReader((kind, body) => {
      if (kind === S.F.OUTPUT) w.out += Buffer.from(body).toString('latin1');
      else if (kind === S.F.DRAWN) w.drawn.push(S.json(body));
    });
    s.on('data', (c) => read(c));
    s.on('error', () => {});
    s.on('connect', () => { s.write(S.frame(S.F.HELLO, hello)); res(w); });
  });
  const sizes = (w) => [...w.out.matchAll(/\[(\d+) (\d+)\]/g)].map((m) => `${m[2]}×${m[1]}`);
  const now = (w) => sizes(w).at(-1);
  try {
    const a = await open({ cols: 120, rows: 40 });
    const aOpened = Date.now();
    expect(await until(() => now(a) === '120×40', 5000)).toBe(true);
    expect(await until(() => a.drawn.length > 0, 3000)).toBe(true);
    expect(a.drawn.at(-1)).toEqual({ cols: 120, rows: 40, yours: true });
    // The window the door opens by itself: smaller, and settling on a size as it opens. The app stays drawn for a
    // (before 4 Oct it shrank to the smallest window), and that window is told the size, to cut its lines.
    const m = await open({ cols: 80, rows: 24, mirror: true });
    m.s.write(S.frame(S.F.SIZE, { cols: 78, rows: 22 }));
    expect(await until(() => m.drawn.length > 0, 3000)).toBe(true);
    await sleep(400);
    expect(now(a)).toBe('120×40');
    expect(m.drawn.at(-1)).toEqual({ cols: 120, rows: 40, yours: false });
    // A window back after a lost link, or one that only watches (huge, as a watch-only window opens): not used yet.
    const w = await open({ cols: 400, rows: 200, via: 'door', again: true });
    await sleep(400);
    expect(now(a)).toBe('120×40');
    w.s.destroy();
    // What its terminal sends by itself (a cursor answer, focus) is not someone using it.
    m.s.write(S.frame(S.F.INPUT, '\x1b[5;1R\x1b[I'));
    await sleep(400);
    expect(now(a)).toBe('120×40');
    // Typed in: drawn for it, and every window is told.
    m.s.write(S.frame(S.F.INPUT, 'x'));
    expect(await until(() => now(a) === '78×22', 5000)).toBe(true);
    expect(await until(() => a.drawn.at(-1)?.cols === 78 && m.drawn.at(-1)?.cols === 78, 3000)).toBe(true);
    expect([a.drawn.at(-1).yours, m.drawn.at(-1).yours]).toEqual([false, true]);
    // a resized (well after it opened): drawn for a again, at its new size.
    await sleep(Math.max(0, 2200 - (Date.now() - aOpened)));
    a.s.write(S.frame(S.F.SIZE, { cols: 150, rows: 50 }));
    expect(await until(() => now(a) === '150×50', 5000)).toBe(true);
    // Resized and ended where it began: the whole screen again (one row less and back).
    const n = sizes(a).length;
    a.s.write(S.frame(S.F.SIZE, { cols: 150, rows: 50 }));
    expect(await until(() => sizes(a).length >= n + 2, 5000)).toBe(true);
    expect(sizes(a).slice(n)).toEqual(['150×49', '150×50']);
    // a leaves: drawn for the one used before it.
    a.s.write(S.frame(S.F.LEAVE));
    expect(await until(() => now(m) === '78×22', 5000)).toBe(true);
    m.s.destroy();
  } finally { h.stop(); }
}, 40_000);

test('a window narrower than the app is drawn cuts its lines at its edge; on another Mac its size goes once it holds still; leaving puts the wrapping back', async () => {
  const sizes = [];
  let conn = null;
  const server = net.createServer((sock) => {
    conn = sock;
    const read = S.frameReader((kind, body) => {
      if (kind === S.F.HELLO) {
        sock.write(S.frame(S.F.NAMED, { name: 'demo-1', v: 2, beats: true, mac: 'server-1' }));
        sock.write(S.frame(S.F.DRAWN, { cols: 120, rows: 40 }));
      } else if (kind === S.F.SIZE) sizes.push(S.json(body));
    });
    sock.on('data', (c) => read(c));
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const input = new PassThrough();
  const output = new PassThrough();
  output.columns = 100; output.rows = 30;
  let shown = '';
  output.on('data', (c) => { shown += c; });
  const count = (seq) => shown.split(seq).length - 1;
  try {
    const view = S.viewSession({
      name: 'demo-1', where: 'server-1', input, output,
      connect: () => net.connect({ host: '127.0.0.1', port: server.address().port }),
      hello: { key: 'k', v: 2, op: 'attach', name: 'demo-1' }, again: (n) => ({ key: 'k', v: 2, op: 'attach', name: n, again: true }),
    });
    // 100 columns, drawn at 120: cut.
    expect(await until(() => count('\x1b[?7l') === 1, 5000)).toBe(true);
    // Dragged wider: the wrapping back the moment it is wide enough; one size sent, the last, once it holds still.
    for (const c of [110, 125, 130]) { output.columns = c; output.emit('resize'); await sleep(20); }
    expect(count('\x1b[?7h')).toBe(1);
    expect(sizes).toEqual([]);
    expect(await until(() => sizes.length === 1, 3000)).toBe(true);
    await sleep(250);
    expect(sizes).toEqual([{ cols: 130, rows: 30 }]);
    // Drawn wider again (another window used): cut again. Drawn for this window (mid-drag it can be narrower): not cut.
    conn.write(S.frame(S.F.DRAWN, { cols: 160, rows: 50 }));
    expect(await until(() => count('\x1b[?7l') === 2, 3000)).toBe(true);
    conn.write(S.frame(S.F.DRAWN, { cols: 160, rows: 50, yours: true }));
    expect(await until(() => count('\x1b[?7h') === 2, 3000)).toBe(true);
    // The session ends: the window wraps again, as before it opened.
    conn.end(S.frame(S.F.ENDED, { code: 0 }));
    expect(await view).toBe(0);
    expect(count('\x1b[?7h')).toBe(3);
  } finally { server.close(); }
}, 15_000);

test.skipIf(!S.canHost() || needs('python3'))('through the door the app is drawn for the window used: growing it and ending a drag where it began each end in one clean screen; the window opened by the door cuts its lines, and takes over once typed in', async () => {
  const { cwd, env } = sessionsEnv();
  const fake = await startFakeServer([{ text: 'The project is a small Node.js script that reads trades.json and prints it as CSV, with two tests in export.test.mjs and no dependencies beyond Node itself.' }], { delayMs: 2 });
  const before = process.env.AGENTIC_HOME;
  process.env.AGENTIC_HOME = env.AGENTIC_HOME;
  const door = await D.openDoor({ host: '127.0.0.1', port: 0, key: 'acd-test-key', mac: 'server-1', peerName: () => 'mac-mini', show: () => {} });
  const port = String(door.address().port);
  const viaDoor = { ...env, AGENTIC_REMOTE_KEY: 'acd-test-key', AGENTIC_REMOTE_KEYSTORE: 'file' };
  // drawn: the width the app is drawn at, when this window is not it (where the start page's middle line falls).
  const clean = async (t, what, { anchored = true, drawn = t.cols } = {}) => {
    const bad = checkScreen(await t.lines(), { cols: drawn, rows: t.rows, anchored, scrollback: await t.lines({ all: true }) }).filter((c) => !c.ok);
    expect([what, bad.map((c) => `${c.what} ${c.detail}`)]).toEqual([what, []]);
  };
  const settle = async (t, c, r) => { t.resize(c, r); await sleep(300); await t.idle(500, 6000); };
  let a = null;
  let b = null;
  try {
    expect(coding(['--bg', '--url', fake.url], { cwd, env }).stdout).toContain('Started in the background: demo-project-1');
    expect(await until(() => records(env).includes('demo-project-1.json'))).toBe(true);
    // The window on the other Mac, through the door.
    a = openTerm({ cwd, env: viaDoor, cols: 120, rows: 36, args: ['attach', '127.0.0.1', 'demo-project-1', '--port', port] });
    await a.waitFor('? for shortcuts', 30_000);
    await a.type('hi'); a.key('enter'); await a.waitFor('no dependencies'); await a.idle(500);
    // The window the door opens by itself, smaller. a stays drawn whole (before 4 Oct: shrunk to 90×28).
    b = openTerm({ cwd, env: { ...env, AGENTIC_DOOR_WINDOW: '1' }, cols: 90, rows: 28, args: ['attach', 'demo-project-1'] });
    await b.waitFor('no dependencies', 30_000); await b.idle(500); await a.idle(500);
    // And a watch-only window through the door (as one Claude Code session opens to follow yours): huge, never typing.
    const watcher = net.connect({ host: '127.0.0.1', port: Number(port) });
    watcher.on('error', () => {});
    watcher.on('data', () => {});
    watcher.on('connect', () => watcher.write(S.frame(S.F.HELLO, { key: 'acd-test-key', v: 2, op: 'attach', name: 'demo-project-1', cols: 400, rows: 200, again: true, jumps: false })));
    await sleep(800); await a.idle(500);
    await clean(a, 'a, after the door window and a watcher opened');
    // The window in use is drawn for: never narrower than the drawing, so it never cuts its lines (a cut screen
    // can look whole, so this is the check that the size stayed its own).
    const cuts = () => a.raw().toString('latin1').split('\x1b[?7l').length - 1;
    expect(cuts()).toBe(0);
    // Its lines are cut at its edge, not wrapped onto the next.
    await clean(b, 'b, smaller than the drawing', { anchored: false, drawn: 120 });
    // a made bigger: drawn at its new size.
    await settle(a, 150, 44);
    await clean(a, 'a grown to 150×44');
    await b.idle(300);
    await clean(b, 'b, while a is 150×44', { anchored: false, drawn: 150 });
    // A drag that ends where it began: drawn whole again, once.
    const at = a.raw().length;
    for (const [c, r] of [[140, 40], [130, 38], [150, 44]]) { a.resize(c, r); await sleep(20); }
    await sleep(300); await a.idle(500, 6000);
    await clean(a, 'a after a drag back to 150×44');
    expect(a.raw().subarray(at).toString('latin1').split('\x1b[3J').length - 1).toBe(1);
    expect(cuts()).toBe(0);
    // Typed in the door's window: drawn for it now; a keeps the room to spare.
    await b.type('x');
    await sleep(300); await b.idle(500, 6000); await a.idle(300);
    await clean(b, 'b after typing in it');
    await clean(a, 'a, bigger than the drawing', { anchored: false, drawn: 90 });
    watcher.destroy();
  } finally {
    await a?.close();
    await b?.close();
    door.close();
    process.env.AGENTIC_HOME = before;
    await fake.close();
  }
}, 120_000);
