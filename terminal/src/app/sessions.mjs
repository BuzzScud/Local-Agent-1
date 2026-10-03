// Background sessions, like Claude Code's `claude --bg` and `claude attach`.
//
// A `coding` window does not run the app itself. It starts a keeper (the
// session host, `coding session-host`): a process with no window that runs the
// app in a pretend terminal (Bun's built-in PTY). The window only shows what
// the app draws and sends it your keys. So:
//   - ctrl+b in the window leaves the app running with no window ("sent to the
//     background"); `coding attach` opens it again;
//   - several windows can show one session at once (this Mac's, and another
//     Mac's through the door, door.mjs). The app is drawn at the smallest of
//     their sizes, and what any of them types reaches it;
//   - closing the window it was started in ends it, as before; closing one
//     that attached only leaves.
// AGENTIC_SESSIONS=off (the tests), a Bun without a PTY, or no terminal: the
// app runs in the window itself, as before.
//
// Each session is <name>.json (who, where, since when) and a socket in
// ~/.agentic-coder/background, a folder only you can open. Windows talk to the
// host in frames: one byte for the kind, four for the length, then the bytes.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync, renameSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { HOME } from '../../../models/index.mjs';

const home = () => process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME ?? HOME;
export const BG_DIR = () => join(home(), 'background');
export const DETACH_KEY = '\x02'; // ctrl+b, as in Claude Code
export const DETACH_LABEL = 'ctrl+b';

// The frames. Window → host: HELLO (JSON: size, owner), INPUT (keys), SIZE
// (JSON), LEAVE (this window goes, the app stays), END (the window it started
// in closed: the app ends). Host → window: OUTPUT (what the app drew), ENDED
// (JSON: the app quit, its exit code), NOTE (JSON: a line to show), LIST (JSON:
// the door's list of sessions), NAMED (JSON: the session the door opened).
export const F = { HELLO: 1, INPUT: 2, SIZE: 3, LEAVE: 4, END: 5, OUTPUT: 10, ENDED: 11, NOTE: 12, LIST: 13, NAMED: 14 };
const MAX_FRAME = 8 * 1024 * 1024;

export function frame(kind, body = {}) {
  const b = typeof body === 'string' ? Buffer.from(body, 'utf8') : body instanceof Uint8Array ? Buffer.from(body) : Buffer.from(JSON.stringify(body));
  const h = Buffer.alloc(5);
  h[0] = kind;
  h.writeUInt32BE(b.length, 1);
  return Buffer.concat([h, b]);
}

// Feed it the bytes as they come; it calls onFrame(kind, body) for each whole
// frame. A frame over 8 MB is not ours: it throws.
export function frameReader(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    while (buf.length >= 5) {
      const n = buf.readUInt32BE(1);
      if (n > MAX_FRAME) throw new Error('frame too big');
      if (buf.length < 5 + n) break;
      const kind = buf[0];
      const body = buf.subarray(5, 5 + n);
      buf = buf.subarray(5 + n);
      onFrame(kind, body);
    }
  };
}
export const json = (body) => { try { return JSON.parse(Buffer.from(body).toString('utf8')); } catch { return {}; } };

// Is this Bun able to hold an app in a pretend terminal? (Bun 1.3.5 and later.)
export const canHost = () => typeof globalThis.Bun?.Terminal === 'function';
export const sessionsOn = (env = process.env) => (env.AGENTIC_SESSIONS ?? 'on') !== 'off' && canHost();
// What to do when this app's Bun cannot (the app is built with the Bun the launcher finds).
export const OLD_BUN = () => `this app runs on Bun ${globalThis.Bun?.version ?? '?'}, which cannot keep sessions in the background (1.3.5 or later can). Run: bun upgrade, then bun run install-cli in the agentic-coder folder`;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const tilde = (p) => (p && p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

function bgDir() {
  const dir = BG_DIR();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch {}
  return dir;
}
const recordOf = (name) => join(BG_DIR(), `${name}.json`);
// A socket's path must stay under 104 bytes on macOS; a long home (a test's)
// puts it in a private folder under /tmp instead.
export function socketFor(name) {
  const p = join(BG_DIR(), `${name}.sock`);
  if (Buffer.byteLength(p) <= 100) return p;
  const dir = join('/tmp', `agentic-coder-${process.getuid?.() ?? 'u'}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.uid !== process.getuid?.()) throw new Error(`${dir} is not yours`);
  chmodSync(dir, 0o700);
  return join(dir, `${createHash('sha256').update(p).digest('hex').slice(0, 16)}.sock`);
}

export const validName = (n) => typeof n === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(n);
// The folder's name and a number: agentic-coder-1, agentic-coder-2, home-1.
export function newName(folder) {
  const raw = folder === homedir() ? 'home' : basename(folder);
  const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'session';
  listBackground(); // tidies away the records of hosts that are gone
  for (let n = 1; ; n++) if (!existsSync(recordOf(`${base}-${n}`))) return `${base}-${n}`;
}
// The same, kept for one session: its record is made at once, so two windows
// started together in one folder never get the same name.
function reserveName(folder) {
  bgDir();
  for (let tries = 0; tries < 50; tries++) {
    const name = newName(folder);
    try {
      writeFileSync(recordOf(name), `${JSON.stringify({ name, pid: process.pid, folder, started: new Date().toISOString(), starting: true })}\n`, { mode: 0o600, flag: 'wx' });
      return name;
    } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  throw new Error('no free session name');
}

function writeRecord(rec) {
  const file = recordOf(rec.name);
  const tmp = `${file}.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
export function readRecord(name) {
  if (!validName(name)) return null;
  try { return JSON.parse(readFileSync(recordOf(name), 'utf8')); } catch { return null; }
}
// The app noting the folder it ended up in (the "Where to start" menu).
export function noteFolder(name, folder) {
  const rec = readRecord(name);
  if (rec) { try { writeRecord({ ...rec, folder }); } catch {} }
}

// The sessions running on this Mac, oldest first. A record whose host is gone
// (a crash, a restart of the Mac) is tidied away.
export function listBackground() {
  let files = [];
  try { files = readdirSync(BG_DIR()).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    let rec = null;
    try { rec = JSON.parse(readFileSync(join(BG_DIR(), f), 'utf8')); } catch {}
    if (!rec?.name || !validName(rec.name)) continue;
    if (!alive(rec.pid)) { forget(rec); continue; }
    if (rec.starting) continue; // its host is not up yet
    out.push(rec);
  }
  return out.sort((a, b) => String(a.started).localeCompare(String(b.started)));
}
function forget(rec) {
  try { unlinkSync(recordOf(rec.name)); } catch {}
  if (rec.socket) { try { unlinkSync(rec.socket); } catch {} }
}

// One line about a session, for the lists: name · folder · since · who is watching.
// mac: false for another Mac's session (its folder is shown as it sent it, its home as ~).
export function describe(s, now = Date.now(), { mac = true } = {}) {
  const mins = Math.max(0, Math.round((now - Date.parse(s.started)) / 60_000));
  const age = mins < 1 ? 'just started' : mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
  const watching = s.viewers ? `${s.viewers} window${s.viewers === 1 ? '' : 's'} open` : 'in the background';
  const folder = mac ? tilde(s.folder) : String(s.folder ?? '').replace(/^\/Users\/[^/]+/, '~');
  return `${s.name} · ${folder} · ${age} · ${watching}`;
}

// ---- the host -----------------------------------------------------------------------------------

// What the host runs in its pretend terminal: the `coding` launcher when this
// is the installed app (so /update can restart it there), else this same
// program (bun cli.jsx while developing).
export function appCommand(args, env = process.env) {
  if (env.AGENTIC_LAUNCHER && existsSync(env.AGENTIC_LAUNCHER)) return [env.AGENTIC_LAUNCHER, ...args];
  const launcher = join(homedir(), '.local', 'bin', 'coding');
  if (process.execPath === join(homedir(), '.agentic-coder', 'app', 'agentic-coder') && existsSync(launcher)) return [launcher, ...args];
  return [...selfCommand(), ...args];
}
// This program: the built app, or bun with cli.jsx.
export function selfCommand() {
  const script = process.argv[1];
  return script && /\.(jsx|mjs|js)$/.test(script) && !script.startsWith('/$bunfs') ? [process.execPath, script] : [process.execPath];
}

// Modes the app turns on in the terminal (mouse, pasting, focus, the cursor,
// the other screen). A window that joins later is told them, or its mouse and
// paste would not reach the app; a window that leaves turns them off again.
const MODES = new Set(['25', '47', '1000', '1002', '1003', '1004', '1005', '1006', '1015', '1047', '1049', '2004']);
export const RESET_MODES = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?2004l\x1b[?25h\x1b[0m';
export function modeTracker() {
  const on = new Map();
  let carry = '';
  return {
    see(bytes) {
      const text = carry + Buffer.from(bytes).toString('latin1');
      for (const m of text.matchAll(/\x1b\[\?([\d;]+)([hl])/g)) for (const n of m[1].split(';')) if (MODES.has(n)) on.set(n, m[2] === 'h');
      // A sequence cut in two by the read is finished by the next one.
      const cut = text.match(/\x1b(\[\??[\d;]*)?$/);
      carry = cut ? cut[0] : '';
    },
    replay() { return [...on].map(([n, v]) => `\x1b[?${n}${v ? 'h' : 'l'}`).join(''); },
    altScreen() { return on.get('1049') || on.get('1047') || on.get('47'); },
  };
}

// The host itself (`coding session-host`, started by startHost). spec: { name,
// folder, cmd, cols, rows }; env: the app's environment. It runs until the app
// quits.
export async function runHost(spec, env = process.env) {
  const { name, folder, cmd } = spec;
  if (!validName(name)) throw new Error(`not a session name: ${name}`);
  bgDir();
  const socket = socketFor(name);
  try { unlinkSync(socket); } catch {}
  const viewers = new Set();
  const modes = modeTracker();
  let cols = spec.cols || 120;
  let rows = spec.rows || 40;
  let drawn = 0; // bytes the app has drawn so far
  let asks = 0; // cursor-position questions the app asked and no window answered yet
  let ended = false;

  const rec = { name, pid: process.pid, folder, started: new Date().toISOString(), socket, viewers: 0, args: spec.args ?? [] };
  let gone = false; // the record is removed: nothing writes it again
  let first = true;
  const note = () => {
    if (gone) return;
    // The first write replaces the name's reservation; later ones keep what the app noted (its folder).
    try { writeRecord(first ? rec : { ...rec, ...readRecord(name), viewers: viewers.size, pid: process.pid, socket, starting: undefined }); first = false; } catch {}
  };

  const childEnv = { ...env, AGENTIC_IN_HOST: name, TERM: env.TERM || 'xterm-256color' };
  for (const k of ['AGENTIC_HOST_SPEC', 'AGENTIC_RESTART_FILE', 'BONSAI_RESTART_FILE']) delete childEnv[k];
  const proc = Bun.spawn(cmd, {
    cwd: folder, env: childEnv,
    terminal: {
      cols, rows,
      data(_t, bytes) {
        drawn += bytes.length;
        modes.see(bytes);
        // The app asking where the cursor is: one answer is wanted, however many windows show it.
        const asked = (Buffer.from(bytes).toString('latin1').match(/\x1b\[6n/g) ?? []).length;
        if (asked) asks += asked;
        const out = frame(F.OUTPUT, bytes);
        // A window too slow to take the screen (16 MB behind) is let go rather than kept in memory.
        for (const v of viewers) { if (v.sock.writableLength > 16 * 1024 * 1024) v.sock.destroy(); else v.sock.write(out); }
      },
    },
  });

  // The pretend terminal is the smallest of the windows (so nothing is cut off
  // in any of them); with none open it keeps its last size.
  const fit = ({ redraw = false } = {}) => {
    const sized = [...viewers].filter((v) => v.cols && v.rows);
    if (!sized.length) return;
    const c = Math.max(20, Math.min(...sized.map((v) => v.cols)));
    const r = Math.max(5, Math.min(...sized.map((v) => v.rows)));
    if (c !== cols || r !== rows) { cols = c; rows = r; try { proc.terminal.resize(cols, rows); } catch {} return; }
    // The same size, but a window that just joined needs the whole screen: one
    // row less and back again makes the app clear and print everything again.
    if (redraw && !ended) {
      try { proc.terminal.resize(cols, Math.max(5, rows - 1)); } catch {}
      setTimeout(() => { try { proc.terminal.resize(cols, rows); } catch {} }, 40);
    }
  };

  const server = net.createServer((sock) => {
    const v = { sock, cols: 0, rows: 0, owner: false, hello: false, left: false };
    const drop = () => { if (viewers.delete(v)) { note(); fit(); } };
    // The window it started in gone without a word (killed, crashed): the
    // session ends, as the app did with its window before.
    const lost = () => { const owned = v.owner && !v.left; drop(); if (owned) end(); };
    const read = frameReader((kind, body) => {
      if (kind === F.HELLO && !v.hello) {
        const h = json(body);
        v.hello = true;
        v.owner = Boolean(h.owner);
        v.cols = Number(h.cols) || 0;
        v.rows = Number(h.rows) || 0;
        viewers.add(v);
        note();
        // The modes the app has on, then the screen at this window's size.
        const m = modes.replay();
        if (m) sock.write(frame(F.OUTPUT, m));
        fit({ redraw: drawn > 0 && !h.fresh });
        return;
      }
      if (!v.hello) return;
      if (kind === F.INPUT) {
        let keys = Buffer.from(body).toString('latin1');
        // Every window answers the app's cursor question; only the first answer goes in.
        keys = keys.replace(/\x1b\[\d+;\d+R/g, (m) => (asks > 0 ? (asks--, m) : ''));
        if (keys) { try { proc.terminal.write(Buffer.from(keys, 'latin1')); } catch {} }
      } else if (kind === F.SIZE) {
        const s = json(body);
        v.cols = Number(s.cols) || v.cols;
        v.rows = Number(s.rows) || v.rows;
        fit();
      } else if (kind === F.LEAVE) {
        v.left = true;
        drop();
        sock.end();
      } else if (kind === F.END) {
        drop();
        sock.end();
        end();
      }
    });
    sock.on('data', (chunk) => { try { read(chunk); } catch { sock.destroy(); } });
    sock.on('close', lost);
    sock.on('error', () => {});
  });

  // Ending: the terminal closes, so the app hears a hang-up, as when its
  // window closed before; it saves the conversation and quits. Anything still
  // there after 10 s is stopped.
  function end() {
    if (ended) return;
    ended = true;
    try { proc.terminal.close(); } catch {}
    setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} try { proc.kill('SIGKILL'); } catch {} }, 10_000).unref();
  }
  process.on('SIGTERM', end);
  process.on('SIGHUP', end);
  process.on('SIGINT', end);

  await new Promise((res, rej) => { server.once('error', rej); server.listen(socket, res); });
  try { chmodSync(socket, 0o600); } catch {}
  note();

  const code = await proc.exited;
  ended = true;
  const bye = frame(F.ENDED, { code: code ?? 0 });
  for (const v of viewers) { try { v.sock.end(bye); } catch {} }
  server.close();
  gone = true;
  forget(rec);
  // A moment for the last frames to leave.
  await new Promise((r) => setTimeout(r, 100));
  return code;
}

// Starts a host with no window and waits until it answers. Answers its record.
export async function startHost({ folder, args = [], cols, rows, env = process.env }) {
  const name = reserveName(folder);
  const spec = { name, folder, args, cmd: appCommand(args, env), cols, rows };
  let child;
  try {
    child = spawn(selfCommand()[0], [...selfCommand().slice(1), 'session-host'], {
      cwd: folder, detached: true, stdio: 'ignore',
      env: { ...env, AGENTIC_HOST_SPEC: JSON.stringify(spec) },
    });
    child.unref();
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const rec = readRecord(name);
      if (rec?.pid === child.pid && rec.socket && existsSync(rec.socket)) return rec;
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 30));
    }
  } catch {}
  // Not started: the name is given back, and a host that hangs is stopped.
  try { child?.kill('SIGKILL'); } catch {}
  forget({ name, socket: readRecord(name)?.socket });
  throw new Error('the session did not start');
}

// ---- the window -----------------------------------------------------------------------------------

// Shows a session in this terminal until it ends or you press ctrl+b. connect():
// a socket (to this Mac's host, or through the door). owner: the window it was
// started in (closing it ends the session). Answers the exit code to leave with.
export function viewSession({ connect, name: named, owner = false, fresh = false, where = '', input = process.stdin, output = process.stdout, hello = {} }) {
  let name = named;
  return new Promise((resolve) => {
    const sock = connect();
    const modes = modeTracker();
    let done = false;
    let started = false;
    const raw = input.isTTY;
    // closed: the window is gone, so nothing is written to it.
    const finish = (code, line, { closed = false } = {}) => {
      if (done) return;
      done = true;
      input.off('readable', onReadable);
      output.off?.('resize', onResize);
      for (const s of ['SIGHUP', 'SIGTERM']) process.off(s, onClose);
      if (raw) { try { input.setRawMode(false); } catch {} }
      try {
        // What the app had on is turned off again, so this terminal types and scrolls as before.
        if (started && !closed) output.write(`${RESET_MODES}${modes.altScreen() ? '\x1b[?1049l' : ''}`);
        if (line && !closed) output.write(`${started ? '\r\n' : ''}${line}\n`);
      } catch {}
      // The last frame (LEAVE, END) reaches the host before this process ends.
      const go = () => resolve(code);
      if (sock.destroyed) return go();
      sock.once('close', go);
      try { sock.end(); } catch {}
      setTimeout(() => { try { sock.destroy(); } catch {} go(); }, 500);
    };
    const send = (kind, body) => { try { sock.write(frame(kind, body)); } catch {} };
    const onKeys = (chunk) => {
      const keys = Buffer.from(chunk);
      // ctrl+b alone: this window goes, the app keeps running.
      if (keys.length === 1 && keys[0] === DETACH_KEY.charCodeAt(0)) {
        send(F.LEAVE);
        const again = where ? `coding attach ${where} ${name}` : `coding attach ${name}`;
        finish(0, `\x1b[2m  Still running in the background: ${name}. Open it again with: ${again}\x1b[0m`);
        return;
      }
      send(F.INPUT, keys);
    };
    // Keys are read with 'readable' and read(), never 'data' and pause(), like the menus
    // before it (pick.mjs: under Bun 1.4.2 a pause can leave the next reader with no keys).
    const onReadable = () => {
      let chunk;
      while (!done && (chunk = input.read()) !== null) onKeys(chunk);
    };
    const onResize = () => send(F.SIZE, { cols: output.columns, rows: output.rows });
    // The window closed: the one it started in ends the session (as closing a
    // window always did); one that attached only leaves.
    const onClose = () => { for (const s of ['SIGHUP', 'SIGTERM']) process.off(s, onClose); send(owner ? F.END : F.LEAVE); finish(0, '', { closed: true }); };
    sock.on('connect', () => {
      started = true;
      send(F.HELLO, { ...hello, cols: output.columns, rows: output.rows, owner, fresh });
      if (raw) input.setRawMode(true);
      input.on('readable', onReadable);
      output.on?.('resize', onResize);
      for (const s of ['SIGHUP', 'SIGTERM']) process.on(s, onClose);
    });
    const read = frameReader((kind, body) => {
      if (kind === F.OUTPUT) { modes.see(body); output.write(body); }
      else if (kind === F.NAMED) name = json(body).name || name;
      else if (kind === F.ENDED) finish(json(body).code ?? 0);
      else if (kind === F.NOTE) finish(1, `  ${json(body).text ?? 'The session could not be opened.'}`);
    });
    sock.on('data', (chunk) => { try { read(chunk); } catch { finish(1, '  The session sent something odd; this window left it.'); } });
    sock.on('error', (e) => finish(1, `  Could not open ${name}: ${e.message}`));
    sock.on('close', () => finish(started ? 0 : 1, started ? '\x1b[2m  The session closed.\x1b[0m' : `  Could not open ${name}.`));
  });
}

export const localConnect = (rec) => () => net.connect(rec.socket);

// `coding` in a terminal: the app goes into a new session and this window shows it.
export async function hostThisWindow({ folder, args }) {
  let rec;
  try {
    rec = await startHost({ folder, args, cols: process.stdout.columns, rows: process.stdout.rows });
  } catch {
    return null; // the caller runs the app in the window itself, as before
  }
  return viewSession({ connect: localConnect(rec), name: rec.name, owner: true, fresh: true });
}
