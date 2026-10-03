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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync, renameSync, lstatSync, openSync, closeSync } from 'node:fs';
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
// the door's list of sessions), NAMED (JSON: the session the door opened). PING (window) and
// PONG (its answer) are the check-in of a window on another Mac: a link that stalled says
// nothing, so each side learns it from the silence (door.mjs).
// JUMP (/jumptomac): from the app to its own host, on a connection of its own with no hello: send the
// window that typed last to another Mac (JSON: mac); and from the host to that window.
export const F = { HELLO: 1, INPUT: 2, SIZE: 3, LEAVE: 4, END: 5, PING: 6, JUMP: 7, OUTPUT: 10, ENDED: 11, NOTE: 12, LIST: 13, NAMED: 14, PONG: 15 };
// What a window and a door say they speak (v in their hello, list and named). 2: the check-in,
// a folder for a new session, opening the same session again after a lost link. One without it
// is an app from before 3 Oct 2026: it is served as before.
export const PROTO = 2;
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
export function appCommand(args, env = process.env, self = selfCommand()) {
  if (env.AGENTIC_LAUNCHER && existsSync(env.AGENTIC_LAUNCHER)) return [env.AGENTIC_LAUNCHER, ...args];
  const launcher = join(homedir(), '.local', 'bin', 'coding');
  if (process.execPath === join(homedir(), '.agentic-coder', 'app', 'agentic-coder') && existsSync(launcher)) return [launcher, ...args];
  return [...self, ...args];
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
  let typedLast = null; // the window whose keys came last: the one a /jumptomac was typed in

  const rec = { name, pid: process.pid, folder, started: new Date().toISOString(), socket, viewers: 0, local: 0, args: spec.args ?? [] };
  let gone = false; // the record is removed: nothing writes it again
  let first = true;
  // local: the windows on this Mac. shared: this Mac's name and the other Macs with a window
  // open (through the door), which the app shows lower right so a window there says where it types.
  const who = () => {
    const away = [...viewers].filter((v) => v.via === 'door');
    return { viewers: viewers.size, local: viewers.size - away.length, shared: away.length ? { mac: away[0].mac || 'this Mac', with: [...new Set(away.map((v) => v.from).filter(Boolean))] } : undefined };
  };
  const note = () => {
    if (gone) return;
    // The first write replaces the name's reservation; later ones keep what the app noted (its folder).
    try { writeRecord(first ? rec : { ...rec, ...readRecord(name), ...who(), pid: process.pid, socket, starting: undefined }); first = false; } catch {}
  };
  // One line per thing that happened, in ~/.agentic-coder/logs/sessions.log (startHost points this process's output there).
  const log = (text) => { try { process.stdout.write(`${new Date().toISOString()} ${name} ${text}\n`); } catch {} };

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
    const v = { sock, cols: 0, rows: 0, owner: false, hello: false, left: false, via: '', from: '', mac: '', jumps: false };
    const drop = () => { if (viewers.delete(v)) { note(); fit(); log(`a window left${v.from ? ` (${v.from})` : ''}; ${viewers.size} open`); } };
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
        // A window on another Mac: the door says so, with that Mac's name and this one's.
        if (h.via === 'door') { v.via = 'door'; v.from = String(h.from ?? '').slice(0, 80); v.mac = String(h.mac ?? '').slice(0, 80); }
        v.jumps = Boolean(h.jumps); // the window can leave for another Mac and come back (/jumptomac)
        viewers.add(v);
        note();
        log(`a window joined${v.from ? ` from ${v.from}` : ''}${v.owner ? ' (the one it started in)' : ''}; ${viewers.size} open`);
        // The modes the app has on, then the screen at this window's size.
        const m = modes.replay();
        if (m) sock.write(frame(F.OUTPUT, m));
        fit({ redraw: drawn > 0 && !h.fresh });
        return;
      }
      // The app itself (it gives no hello): the window it was typed in goes to another Mac.
      if (kind === F.JUMP && !v.hello) {
        const to = typedLast && viewers.has(typedLast) ? typedLast : [...viewers].find((x) => x.owner) ?? [...viewers][0];
        const mac = String(json(body).mac ?? '').slice(0, 80);
        if (!to) sock.end(frame(F.NOTE, { ok: false, text: 'no window is open on this session' }));
        else if (!to.jumps) sock.end(frame(F.NOTE, { ok: false, text: 'the window you typed in runs an older Agentic Coder; open a new one (coding) and try again' }));
        else { to.sock.write(frame(F.JUMP, { mac })); log(`a window was sent to ${mac}`); sock.end(frame(F.NOTE, { ok: true })); }
        return;
      }
      if (!v.hello) return;
      if (kind === F.INPUT) {
        typedLast = v;
        let keys = Buffer.from(body).toString('latin1');
        // Every window answers the app's cursor question; only the first answer goes in.
        keys = keys.replace(/\x1b\[\d+;\d+R/g, (m) => (asks > 0 ? (asks--, m) : ''));
        if (keys) { try { proc.terminal.write(Buffer.from(keys, 'latin1')); } catch {} }
      } else if (kind === F.SIZE) {
        const s = json(body);
        v.cols = Number(s.cols) || v.cols;
        v.rows = Number(s.rows) || v.rows;
        fit();
      } else if (kind === F.PING) {
        sock.write(frame(F.PONG));
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
  log(`started in ${tilde(folder)}`);

  const code = await proc.exited;
  ended = true;
  log(`ended (code ${code ?? 0})`);
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
// self: this program's own command (a test whose door runs inside the test gives the app's).
export async function startHost({ folder, args = [], cols, rows, env = process.env, self = selfCommand() }) {
  const name = reserveName(folder);
  const spec = { name, folder, args, cmd: appCommand(args, env, self), cols, rows };
  let child;
  try {
    // What the host says (and anything that goes wrong in it) is kept, where before it was lost.
    let out = 'ignore';
    try { mkdirSync(join(home(), 'logs'), { recursive: true }); out = openSync(join(home(), 'logs', 'sessions.log'), 'a'); } catch {}
    child = spawn(self[0], [...self.slice(1), 'session-host'], {
      cwd: folder, detached: true, stdio: ['ignore', out, out],
      env: { ...env, AGENTIC_HOST_SPEC: JSON.stringify(spec) },
    });
    if (out !== 'ignore') { try { closeSync(out); } catch {} }
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
//
// again(name): given for a window on another Mac (door.mjs): the hello that opens the same
// session again. With it the window checks in every beatMs, and a link that is lost (this Mac
// slept, the network dropped, the other Mac's door restarted) is tried again every retryMs until
// it is back; the last line of the window says so meanwhile, and ctrl+b, ctrl+c or esc stops.
// silent: what to say when the other Mac takes the connection and then says nothing for firstMs
// (a session can take a while to start there; a door that is held up says nothing at all).
// jumps: this window can be sent to another Mac (/jumptomac): it then leaves the session running
// and answers { jump: <mac>, name } instead of a code; the caller shows that Mac and comes back.
export function viewSession({ connect, name: named, owner = false, fresh = false, where = '', input = process.stdin, output = process.stdout, hello = {}, again = null, beatMs = 10_000, retryMs = 2000, silent = '', firstMs = 20_000, jumps = false }) {
  let name = named;
  return new Promise((resolve) => {
    const modes = modeTracker();
    let sock = null;
    let done = false;
    let started = false; // a session was on this screen
    let wired = false; // the keyboard, the resize and the signals are listened to
    let opened = false; // the door named the session: it can be opened again
    let beats = false; // the other side answers check-ins
    let heard = 0; // when it last said anything
    let lostAt = 0; // when the link was lost; 0 while it is up
    let retry = null;
    const raw = input.isTTY;
    // The last line of the window, over what the app drew there; the app draws everything again when the link is back.
    const status = (text) => { try { output.write(`\x1b7\x1b[999;1H\x1b[2K${text}\x1b8`); } catch {} };
    // closed: the window is gone, so nothing is written to it.
    const finish = (code, line, { closed = false, value = undefined } = {}) => {
      if (done) return;
      done = true;
      clearInterval(beat);
      clearTimeout(retry);
      input.off('readable', onReadable);
      output.off?.('resize', onResize);
      for (const s of ['SIGHUP', 'SIGTERM']) process.off(s, onClose);
      if (raw) { try { input.setRawMode(false); } catch {} }
      try {
        if (lostAt && !closed) status('');
        // What the app had on is turned off again, so this terminal types and scrolls as before.
        if (started && !closed) output.write(`${RESET_MODES}${modes.altScreen() ? '\x1b[?1049l' : ''}`);
        // Under everything the app drew (the cursor sits inside its prompt box), on a line of its own.
        if (line && !closed) output.write(`${started ? '\x1b[999B\r\n' : ''}${line}\n`);
      } catch {}
      // The last frame (LEAVE, END) reaches the host before this process ends.
      const go = () => resolve(value ?? code);
      if (!sock || sock.destroyed) return go();
      sock.once('close', go);
      try { sock.end(); } catch {}
      setTimeout(() => { try { sock.destroy(); } catch {} go(); }, 500);
    };
    const send = (kind, body) => { try { sock.write(frame(kind, body)); } catch {} };
    const reopen = () => (where ? `coding attach ${where} ${name}` : `coding attach ${name}`);
    const onKeys = (chunk) => {
      const keys = Buffer.from(chunk);
      // While the link is down nothing typed can arrive; ctrl+b, ctrl+c or esc stops the waiting.
      if (lostAt) {
        if (keys.length === 1 && [DETACH_KEY.charCodeAt(0), 3, 27].includes(keys[0])) finish(0, `\x1b[2m  Stopped waiting. If ${where} is only out of reach, ${name} still runs there: ${reopen()}\x1b[0m`);
        return;
      }
      // ctrl+b alone: this window goes, the app keeps running.
      if (keys.length === 1 && keys[0] === DETACH_KEY.charCodeAt(0)) {
        send(F.LEAVE);
        finish(0, `\x1b[2m  Still running in the background: ${name}. Open it again with: ${reopen()}\x1b[0m`);
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
    const onResize = () => { if (!lostAt) send(F.SIZE, { cols: output.columns, rows: output.rows }); };
    // The window closed: the one it started in ends the session (as closing a
    // window always did); one that attached only leaves.
    const onClose = () => { for (const s of ['SIGHUP', 'SIGTERM']) process.off(s, onClose); if (!lostAt) send(owner ? F.END : F.LEAVE); finish(0, '', { closed: true }); };
    // The link is gone: said on the last line, and tried again until it is back.
    const lost = () => {
      if (done) return;
      if (!lostAt) lostAt = Date.now();
      const secs = Math.round((Date.now() - lostAt) / 1000);
      status(`\x1b[33m  Connection to ${where} lost, reconnecting…${secs >= 2 ? ` (${secs} s)` : ''}\x1b[0m\x1b[2m · ${DETACH_LABEL} to stop\x1b[0m`);
      clearTimeout(retry);
      retry = setTimeout(() => open({ ...again(name), cols: output.columns, rows: output.rows, ...(jumps ? { jumps: true } : {}) }), retryMs);
    };
    // One connection. Whatever an older one still says is not listened to.
    function open(first) {
      if (done) return;
      const mine = connect();
      sock = mine;
      let up = false;
      let quiet = null;
      // A Mac that is asleep takes no connection and refuses none: 5 s is enough to know.
      const slow = again ? setTimeout(() => { if (!up) mine.destroy(); }, Math.max(5000, retryMs)) : null;
      const gone = (line) => {
        clearTimeout(slow);
        clearTimeout(quiet);
        if (done || sock !== mine) return;
        // A session the door named can be opened again; before that there is nothing to come back to.
        if (again && opened) lost();
        else finish(started ? 0 : 1, line);
      };
      mine.on('connect', () => {
        up = true;
        clearTimeout(slow);
        heard = Date.now();
        // Connected, and then nothing at all: said (the first time), or tried again (after a lost link).
        if (again) quiet = setTimeout(() => { if (done || sock !== mine) return; if (opened) mine.destroy(); else finish(1, `  ${silent || `${where} is not answering.`}`); }, firstMs);
        quiet?.unref?.();
        send(F.HELLO, first);
        if (wired) return;
        wired = true;
        started = true;
        if (raw) input.setRawMode(true);
        input.on('readable', onReadable);
        output.on?.('resize', onResize);
        for (const s of ['SIGHUP', 'SIGTERM']) process.on(s, onClose);
      });
      const read = frameReader((kind, body) => {
        if (sock !== mine) return;
        clearTimeout(quiet);
        if (kind === F.OUTPUT) { modes.see(body); output.write(body); }
        else if (kind === F.NAMED) {
          const n = json(body);
          name = n.name || name;
          opened = true;
          beats = Boolean(n.beats);
          // Back after a lost link: the line goes, and the app draws the window again (the host's nudge).
          if (lostAt) { lostAt = 0; status(''); }
        } else if (kind === F.JUMP && jumps) {
          // /jumptomac, typed here: this window leaves (the session keeps running) for another Mac.
          send(F.LEAVE);
          finish(0, '', { value: { jump: String(json(body).mac ?? ''), name } });
        } else if (kind === F.ENDED) finish(json(body).code ?? 0);
        else if (kind === F.NOTE) {
          const n = json(body);
          const text = n.text ?? 'The session could not be opened.';
          // Gone while the link was down: it ended there (quit, or that Mac restarted).
          if (lostAt && (n.gone || /^No session called/.test(text))) finish(0, `\x1b[2m  ${name} ended on ${where} while the link was down.\x1b[0m`);
          else finish(1, `  ${text}`);
        }
      });
      mine.on('data', (chunk) => { heard = Date.now(); try { read(chunk); } catch { if (sock === mine) finish(1, '  The session sent something odd; this window left it.'); } });
      mine.on('error', (e) => gone(`  Could not open ${name}: ${e.message}`));
      mine.on('close', () => gone(started && up ? '\x1b[2m  The session closed.\x1b[0m' : `  Could not open ${name}.`));
    }
    // The check-in: a word every beatMs, and a link that has said nothing for two and a half of
    // them is taken for lost (a Mac that slept wakes to exactly that).
    const beat = again ? setInterval(() => {
      if (done || lostAt || !sock || sock.connecting) return;
      if (beats && Date.now() - heard > beatMs * 2.5) { sock.destroy(); return; }
      send(F.PING);
    }, beatMs) : null;
    open({ ...hello, cols: output.columns, rows: output.rows, owner, fresh, ...(jumps ? { jumps: true } : {}) });
  });
}

export const localConnect = (rec) => () => net.connect(rec.socket);

// `coding` in a terminal: the app goes into a new session and this window shows it.
// view: how the window shows it (cli.jsx gives one that can jump to another Mac, door.mjs).
export async function hostThisWindow({ folder, args, view = viewSession }) {
  let rec;
  try {
    rec = await startHost({ folder, args, cols: process.stdout.columns, rows: process.stdout.rows });
  } catch {
    return null; // the caller runs the app in the window itself, as before
  }
  return view({ connect: localConnect(rec), name: rec.name, owner: true, fresh: true });
}

// The app, asking its own host to send the window it was typed in to another Mac (/jumptomac).
// name: the session it runs in (AGENTIC_IN_HOST). Answers { ok, text }.
export function askJump(name, mac, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const rec = readRecord(name);
    if (!rec?.socket) { resolve({ ok: false, text: 'this session has no host' }); return; }
    const sock = net.connect(rec.socket);
    const done = (r) => { clearTimeout(t); try { sock.destroy(); } catch {} resolve(r); };
    const t = setTimeout(() => done({ ok: false, text: 'the host did not answer' }), timeoutMs);
    const read = frameReader((kind, body) => { if (kind === F.NOTE) done({ ok: Boolean(json(body).ok), text: json(body).text ?? '' }); });
    sock.on('connect', () => sock.write(frame(F.JUMP, { mac })));
    sock.on('data', (c) => { try { read(c); } catch { done({ ok: false, text: 'the host answered something odd' }); } });
    sock.on('error', (e) => done({ ok: false, text: e.message }));
  });
}
