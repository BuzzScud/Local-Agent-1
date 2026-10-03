// The door: another Mac opening this Mac's background sessions (sessions.mjs).
//
// `coding door on` keeps a small listener running on this Mac (a login item, so
// it comes back after a restart). It listens only on this Mac's Tailscale
// address, never on the home network or the internet, and lets in only a
// window that gives its key (made here, readable by you only; Tailscale
// already encrypts the way between the Macs). Through it the other Mac can list
// the sessions here, open one, or start a new one. Every frame after the key is
// passed to the session's host unchanged, so a window there works like one here.
//
// On the other Mac, `coding attach <this Mac's name>` asks for the key once and
// keeps it in the Keychain (agentic-coder-remote, account door-<name>).
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { HOME, lanAddresses, readKey, saveKey, removeKey } from '../../../models/index.mjs';
import { F, frame, frameReader, json, listBackground, readRecord, startHost, selfCommand, validName, describe, viewSession, sessionsOn, canHost, OLD_BUN } from './sessions.mjs';

const home = () => process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME ?? HOME;
export const DOOR_PORT = 7790;
export const DOOR_LABEL = 'com.agentic-coder.door';
const KEY_FILE = () => join(home(), 'door.key');
const STATE_FILE = () => join(home(), 'door.json');
const PLIST = () => join(homedir(), 'Library', 'LaunchAgents', `${DOOR_LABEL}.plist`);
export const keyIdFor = (host) => `door-${String(host).toLowerCase()}`;

// The key, one line, readable by you only; made once and kept.
export function doorKey({ fresh = false } = {}) {
  const file = KEY_FILE();
  if (!fresh && existsSync(file)) {
    const k = readFileSync(file, 'utf8').split('\n')[0].trim();
    if (k) return k;
  }
  const key = `acd-${randomBytes(24).toString('base64url')}`;
  mkdirSync(home(), { recursive: true });
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}
const same = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
};

export const readState = () => { try { return JSON.parse(readFileSync(STATE_FILE(), 'utf8')); } catch { return {}; } };
const saveState = (s) => { mkdirSync(home(), { recursive: true }); writeFileSync(STATE_FILE(), `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 }); };
export const tailscaleAddress = (ifaces) => lanAddresses(ifaces).find((a) => a.where === 'Tailscale')?.address ?? null;
// The name the other Mac reaches this one by: Tailscale's name for it (which is
// often not the Mac's own name), else the Mac's own.
export function tailscaleName() {
  for (const bin of ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale']) {
    const r = spawnSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) continue;
    try { const n = JSON.parse(r.stdout)?.Self?.DNSName?.split('.')[0]; if (n) return n; } catch {}
  }
  return hostname().split('.')[0].toLowerCase();
}
// What the other Mac is shown of a session (not its socket, process or prompt).
const shown = (s) => ({ name: s.name, folder: s.folder, started: s.started, viewers: s.viewers });

// ---- this Mac's side: the listener --------------------------------------------------------------------

// Wrong keys from one address: after 5 in a minute it is refused for a minute.
export function limiter({ tries = 5, windowMs = 60_000, now = () => Date.now() } = {}) {
  const bad = new Map();
  return {
    blocked(addr) { const b = bad.get(addr); return Boolean(b && b.until > now()); },
    wrong(addr) {
      const t = now();
      const b = bad.get(addr) ?? { times: [], until: 0 };
      b.times = [...b.times.filter((x) => t - x < windowMs), t];
      if (b.times.length >= tries) { b.until = t + windowMs; b.times = []; }
      bad.set(addr, b);
    },
  };
}

// Listens until stopped. host: the address to listen on (Tailscale's; a test
// gives 127.0.0.1). key: what a window must give. startEnv: the environment a
// session started from here gets (the PATH saved by `coding door on`).
export function openDoor({ host, port = DOOR_PORT, key = doorKey(), startEnv = process.env, log = () => {} }) {
  const limit = limiter();
  const server = net.createServer((sock) => {
    const from = sock.remoteAddress ?? '?';
    if (limit.blocked(from)) { sock.destroy(); return; }
    let state = 'hello';
    let piped = null;
    // Keys typed while a session starts wait for it.
    const waiting = [];
    // A window that says nothing within 10 s is let go.
    const quiet = setTimeout(() => sock.destroy(), 10_000);
    const say = (text) => { sock.end(frame(F.NOTE, { text })); };
    const read = frameReader((kind, body) => {
      if (state === 'piped') { piped.write(frame(kind, body)); return; }
      if (state === 'busy') { if (waiting.length < 1000) waiting.push(frame(kind, body)); return; }
      if (kind !== F.HELLO) { sock.destroy(); return; }
      state = 'busy';
      clearTimeout(quiet);
      const h = json(body);
      if (!same(h.key ?? '', key)) {
        limit.wrong(from);
        log(`wrong key from ${from}`);
        // A moment before the answer, so keys cannot be tried quickly.
        setTimeout(() => say('wrong key'), 1000);
        return;
      }
      if (h.op === 'list') { sock.end(frame(F.LIST, { sessions: listBackground().map(shown) })); return; }
      const join = (rec) => {
        if (sock.destroyed) return; // the window left while its session started
        log(`${from} opened ${rec.name}`);
        piped = net.connect(rec.socket);
        piped.on('connect', () => {
          state = 'piped';
          sock.write(frame(F.NAMED, { name: rec.name }));
          // The window's own hello, without its key; a window from another Mac never owns the session.
          piped.write(frame(F.HELLO, { cols: h.cols, rows: h.rows, fresh: Boolean(h.fresh), owner: false, via: 'door' }));
          for (const f of waiting.splice(0)) piped.write(f);
        });
        piped.on('data', (c) => sock.write(c));
        piped.on('close', () => sock.end());
        piped.on('error', () => sock.destroy());
        sock.on('close', () => piped.destroy());
      };
      if (h.op === 'attach') {
        const rec = validName(h.name) ? readRecord(h.name) : null;
        if (!rec || !listBackground().some((s) => s.name === rec.name)) { say(`No session called ${h.name ?? ''} here. coding sessions <this Mac> lists them.`); return; }
        join(rec);
        return;
      }
      if (h.op === 'new') {
        if (!sessionsOn(startEnv)) { say('That Mac cannot keep sessions yet: its Bun is too old (run bun upgrade there).'); return; }
        startHost({ folder: homedir(), args: [], cols: h.cols, rows: h.rows, env: startEnv })
          .then((rec) => { h.fresh = true; join(rec); })
          .catch((e) => say(`the session did not start: ${e.message}`));
        return;
      }
      say('the door does not know that');
    });
    sock.on('data', (c) => { try { read(c); } catch { sock.destroy(); } });
    sock.on('error', () => {});
    sock.on('close', () => clearTimeout(quiet));
  });
  return new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, host, () => res(server));
  });
}

// `coding door run` (what the login item starts): waits for Tailscale's address,
// then listens on it; if the address goes (Tailscale off), it waits again. When
// the app is rebuilt (an update) it stops, and launchd starts the new one.
export async function runDoor({ port = readState().port ?? DOOR_PORT } = {}) {
  const st = readState();
  const startEnv = { ...process.env, ...(st.path ? { PATH: st.path } : {}), ...(st.lang ? { LANG: st.lang } : {}), TERM: 'xterm-256color' };
  const log = (t) => process.stdout.write(`${new Date().toISOString()} ${t}\n`);
  const built = () => { try { return statSync(process.execPath).mtimeMs; } catch { return 0; } };
  const at0 = built();
  const wait = () => new Promise((r) => setTimeout(r, 15_000));
  const updated = () => { if (built() === at0) return false; log('the app was updated; starting again'); return true; };
  for (;;) {
    if (updated()) process.exit(0);
    const at = tailscaleAddress();
    if (!at) { await wait(); continue; }
    let server;
    try { server = await openDoor({ host: at, port, startEnv, log }); } catch (e) { log(`could not listen on ${at}:${port}: ${e.message}`); await wait(); continue; }
    log(`open on ${at}:${port}`);
    while (tailscaleAddress() === at && built() === at0) await wait();
    server.close();
    if (updated()) process.exit(0);
    log(`Tailscale address ${at} gone; closing`);
  }
}

// The login item: launchd starts `coding door run` at login and again if it stops.
function plistText(cmd) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const logs = join(home(), 'logs', 'door.log');
  const env = process.env.AGENTIC_HOME ? `\n  <key>EnvironmentVariables</key>\n  <dict><key>AGENTIC_HOME</key><string>${esc(process.env.AGENTIC_HOME)}</string></dict>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${DOOR_LABEL}</string>
  <key>ProgramArguments</key>
  <array>${cmd.map((c) => `<string>${esc(c)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>${esc(logs)}</string>
  <key>StandardErrorPath</key><string>${esc(logs)}</string>${env}
</dict>
</plist>
`;
}
const launchctl = (...a) => spawnSync('/bin/launchctl', a, { encoding: 'utf8', timeout: 15_000 });
const loaded = () => launchctl('print', `gui/${process.getuid()}/${DOOR_LABEL}`).status === 0;
// The listener's command: the installed app (it is rebuilt in place by the
// launcher), or bun with cli.jsx while developing.
function doorCommand() {
  const app = join(homedir(), '.agentic-coder', 'app', 'agentic-coder');
  const self = selfCommand();
  return [...(self.length === 1 && existsSync(app) ? [app] : self), 'door', 'run'];
}

// `coding door [on|off|new-key]`. say(text) prints a line. Answers the exit code.
export async function doorCli(args, { say = (t) => process.stdout.write(`${t}\n`) } = {}) {
  const what = args[0] ?? 'status';
  const at = tailscaleAddress();
  const st = readState();
  const port = Number(args[args.indexOf('--port') + 1]) || st.port || DOOR_PORT;
  const how = () => {
    say(`  On your other Mac:  coding attach ${tailscaleName()}`);
    say(`  It asks once for this key (keep it to yourself):  ${doorKey()}`);
  };
  if (what === 'on') {
    if (!canHost()) { say(`coding door: ${OLD_BUN()}; then coding door on again.`); return 1; }
    if (!at) say('! Tailscale is not on here yet; the door opens as soon as it is.');
    doorKey();
    saveState({ ...st, on: true, port, path: process.env.PATH, lang: process.env.LANG });
    mkdirSync(join(home(), 'logs'), { recursive: true });
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    if (loaded()) launchctl('bootout', `gui/${process.getuid()}/${DOOR_LABEL}`);
    writeFileSync(PLIST(), plistText(doorCommand()));
    const r = launchctl('bootstrap', `gui/${process.getuid()}`, PLIST());
    if (r.status !== 0 && !loaded()) { say(`coding door: macOS did not start it: ${(r.stderr || r.stdout).trim()}`); return 1; }
    say(`The door is open${at ? ` on ${at}, port ${port}` : ''}: only your Tailscale devices can reach it, and only with the key.`);
    how();
    say('  It starts again by itself after a restart. coding door off closes it.');
    return 0;
  }
  if (what === 'off') {
    if (loaded()) launchctl('bootout', `gui/${process.getuid()}/${DOOR_LABEL}`);
    try { unlinkSync(PLIST()); } catch {}
    saveState({ ...st, on: false });
    say('The door is closed. Sessions here keep running; only this Mac can open them.');
    return 0;
  }
  if (what === 'new-key') {
    doorKey({ fresh: true });
    say('A new key: the old one no longer opens the door.');
    how();
    return 0;
  }
  if (what === 'status') {
    const on = loaded();
    say(on ? `The door is open${at ? ` on ${at}, port ${port}` : ' (waiting for Tailscale)'}.` : 'The door is closed. coding door on opens it for your other Macs (over Tailscale, with a key).');
    if (on) how();
    return 0;
  }
  say('coding door: on · off · new-key (with nothing: whether it is open)');
  return 2;
}

// ---- the other Mac's side: going through the door -------------------------------------------------------

// One question through the door, then the answer frame: { kind, body }.
function ask({ host, port, hello, timeoutMs = 8000 }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const t = setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, timeoutMs);
    sock.on('connect', () => sock.write(frame(F.HELLO, hello)));
    const read = frameReader((kind, body) => { clearTimeout(t); sock.destroy(); resolve({ kind, body: json(body) }); });
    sock.on('data', (c) => { try { read(c); } catch (e) { reject(e); } });
    sock.on('error', (e) => { clearTimeout(t); reject(e); });
    sock.on('close', () => { clearTimeout(t); reject(new Error('closed')); });
  });
}

// In plain words, why the door could not be reached.
export function reachProblem(e, host) {
  if (e.code === 'ECONNREFUSED') return `${host} answered, but its door is closed. On ${host}, run: coding door on`;
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return `No Mac called ${host} was found. Is Tailscale on here? (tailscale status lists the names)`;
  if (e.message === 'timeout' || e.code === 'ETIMEDOUT' || e.code === 'EHOSTUNREACH') return `${host} did not answer. Is it awake, with Tailscale on?`;
  return `Could not reach ${host}: ${e.message}`;
}

// A key typed without showing it. Read with 'readable' and read(), never paused (pick.mjs says why).
async function typeKey(prompt, { input = process.stdin, output = process.stderr } = {}) {
  output.write(prompt);
  if (!input.isTTY) return null;
  input.setRawMode(true);
  return new Promise((resolve) => {
    let k = '';
    let over = false;
    const on = () => {
      let c;
      while (!over && (c = input.read()) !== null) {
        for (const ch of Buffer.from(c).toString('utf8')) {
          if (ch === '\r' || ch === '\n') { done(k.trim()); return; }
          if (ch === '\x03' || ch === '\x1b') { done(null); return; }
          if (ch === '\x7f') { k = k.slice(0, -1); continue; }
          if (ch >= ' ') k += ch;
        }
      }
    };
    const done = (v) => { over = true; input.off('readable', on); input.setRawMode(false); output.write('\n'); resolve(v || null); };
    input.on('readable', on);
  });
}

// The list of the other Mac's sessions, asking for its key the first time (and
// again when the one kept no longer opens it). Answers { sessions, key } or
// throws an Error whose message is meant for the person.
export async function remoteList({ host, port = DOOR_PORT, askKey = typeKey }) {
  const id = keyIdFor(host);
  let key = readKey(id);
  for (let tries = 0; tries < 3; tries++) {
    if (!key) {
      key = await askKey(`The key for ${host}'s door (on ${host}: coding door on shows it): `);
      if (!key) throw new Error('No key given; nothing was opened.');
    }
    let r;
    try { r = await ask({ host, port, hello: { key, op: 'list' } }); } catch (e) { throw new Error(reachProblem(e, host)); }
    if (r.kind === F.LIST) {
      if (readKey(id) !== key) { try { saveKey(key, id, `Agentic Coder door (${host})`); } catch {} }
      return { sessions: r.body.sessions ?? [], key };
    }
    if (r.body?.text === 'wrong key') {
      if (readKey(id) === key) removeKey(id);
      process.stderr.write(`That key does not open ${host}'s door.\n`);
      key = null;
      continue;
    }
    throw new Error(r.body?.text ?? `${host} answered something odd`);
  }
  throw new Error('Three wrong keys; nothing was opened.');
}

// `coding attach <host> [name]` and `coding sessions <host>`: through the door.
export async function attachRemote({ host, name, port = DOOR_PORT, pick, listOnly = false, say = (t) => process.stdout.write(`${t}\n`) }) {
  const { sessions, key } = await remoteList({ host, port });
  if (listOnly) {
    if (!sessions.length) say(`Nothing is running on ${host}. coding attach ${host} starts a session there.`);
    for (const s of sessions) say(`  ${describe(s, Date.now(), { mac: false })}`);
    return 0;
  }
  let op = 'attach';
  let want = name;
  if (!want) {
    const rows = [...sessions.map((s) => describe(s, Date.now(), { mac: false })), `Start a new session on ${host}`];
    const i = await pick(rows, `Sessions on ${host}`);
    if (i === null) return 0;
    if (i === sessions.length) op = 'new';
    else want = sessions[i].name;
  }
  return viewSession({
    name: want ?? `a new session on ${host}`, where: host,
    connect: () => net.connect({ host, port }),
    hello: { key, op, name: want },
  });
}
