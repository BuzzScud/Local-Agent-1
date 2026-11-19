// The window server (12 Oct 2026, the owner's picks: Agentic Coder in its own Mac window, Tauri, doing everything
// the terminal does, in the terminal's place). `coding` in a terminal starts it: it runs the real app in a pretend
// terminal (as the keeper does, sessions.mjs), takes what the app draws as data (bridge.mjs, over a socket only
// this user can open), and serves the window's page (ui.html) on this Mac only, at an address with a key nobody
// else has. The window (terminal/app/window/, a Tauri shell) opens that page. Keys and clicks come back the same
// way. Closing the window ends the app as closing its terminal did (it saves first); the app ending closes it.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, chmodSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import UI_PAGE from './ui.html' with { type: 'text' };
import STEPS_JS from './steps-page.js' with { type: 'text' };
import STEPS_CSS from './steps-page.css' with { type: 'text' };

// The page with its timeline (steps-page.js and .css, 27 Oct 2026) put in where it says, so each file stays small.
const UI = UI_PAGE.replace('<!--steps-page-->', () => `<style>\n${STEPS_CSS}</style>\n<script>\n${STEPS_JS}</script>`);
import { VtScreen } from './vt.mjs';
import { cellRows, xterm } from './view.mjs';
import { selfCommand } from '../app/sessions.mjs';
import { listSessions } from '../app/store.mjs';
import { rigPixels, trimmed } from '../ui/bot-rig.mjs';
import { HOME } from '../../../models/index.mjs';

const APP_NAME = 'Agentic Coder Window.app';
// What /pic answers a picture as (media.mjs isImage's kinds the window's browser draws).
const PIC_TYPE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp' };
// The window's program: AGENTIC_WINDOW_APP, else the one `bun run window` installs, else a build of it here.
export function windowApp(env = process.env) {
  const tries = [env.AGENTIC_WINDOW_APP, join(HOME, 'app', APP_NAME, 'Contents', 'MacOS', 'agentic-coder-window'), join(HOME, 'build', 'window-target', 'release', 'agentic-coder-window')];
  return tries.find((p) => p && existsSync(p)) ?? null;
}
// A key compared in the same time whatever it holds (18 Nov 2026: `!==` stops at the first letter that differs).
export const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
// A window that reads its page's address (with the key) from AGENTIC_WINDOW_URL, which no other account sees, instead
// of --url, which `ps` shows to every account on the Mac: build.sh marks it in its Info.plist (AgenticURLFromEnv) when
// main.rs reads it. An older window still gets --url.
export function urlFromEnv(exe) {
  try { return /<key>AgenticURLFromEnv<\/key>\s*<true\/>/.test(readFileSync(join(exe, '..', '..', 'Info.plist'), 'utf8')); } catch { return false; }
}
// `coding` in a terminal opens the window, unless: --terminal, -p, --bg, AGENTIC_WINDOW=off, over SSH or in tmux
// (no window to open there), not a Mac, the tests, or no window built.
export function windowWanted(opts = {}, env = process.env) {
  if (opts.terminal || opts.print || opts.bg) return false;
  if (/^(off|0|no|false|terminal)$/i.test(String(env.AGENTIC_WINDOW ?? ''))) return false;
  if (env.SSH_CONNECTION || env.SSH_TTY || env.TMUX || env.NODE_ENV === 'test') return false;
  if (process.platform !== 'darwin') return false;
  return Boolean(windowApp(env));
}
// `coding` in a terminal (14 Oct 2026, the owner's pick: the window lets Terminal go): the window starts as
// `coding window` in a session of its own (detached), so closing that Terminal leaves it open. What it prints
// goes to ~/.agentic-coder/logs/window.log. Returns the command it started.
export function openWindowFree({ folder = process.cwd(), args = [], env = process.env, run = spawn } = {}) {
  const cmd = [...selfCommand(), 'window', '--folder', folder, ...args.filter((a) => a !== '--terminal')];
  const logs = join(HOME, 'logs');
  let out = 'ignore';
  try { mkdirSync(logs, { recursive: true }); out = openSync(join(logs, 'window.log'), 'a'); } catch {}
  const child = run(cmd[0], cmd.slice(1), { cwd: folder, env, detached: true, stdio: ['ignore', out, out] });
  child.unref?.();
  if (typeof out === 'number') try { closeSync(out); } catch {}
  return cmd;
}
// What runs in the pretend terminal: the installed `coding` (so /update restarts it there), else this program.
function appCommand(args, env) {
  if (env.AGENTIC_LAUNCHER && existsSync(env.AGENTIC_LAUNCHER)) return [env.AGENTIC_LAUNCHER, ...args];
  const launcher = join(homedir(), '.local', 'bin', 'coding');
  if (process.execPath === join(homedir(), '.agentic-coder', 'app', 'agentic-coder') && existsSync(launcher)) return [launcher, ...args];
  return [...selfCommand(), ...args];
}
// Files dropped on the window (main.rs hands the page their paths): typed as Terminal types a drop, each path
// with its spaces and marks escaped by \ and a space after, so the app makes each one a chip (app/attach.mjs).
export const dropText = (paths) => paths.filter((p) => typeof p === 'string' && p).map((p) => `${p.replace(/[\s!"#$&'()*,;<>?[\\\]^`{|}~=]/g, '\\$&')} `).join('');
// Another window, a program of its own (19 Nov 2026, the owner: "open more than 1 chat and use more than
// 1 agentic coder at a time"): `coding window --folder <at>` started detached, so this window closing leaves it open.
function openAnother(at, args, env) {
  const [cmd, ...rest] = appCommand(['window', '--folder', at, ...args], env);
  const child = spawn(cmd, rest, { cwd: at, env: { ...env, AGENTIC_WINDOW_DETACH: '1' }, detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // a program that cannot start must not take this window down with it
  child.unref();
}
// A saved conversation's id as the Chats list gives it: letters, digits, . _ -, never a leading - (not an option).
const chatId = (id) => typeof id === 'string' && /^[A-Za-z0-9._][A-Za-z0-9._-]{0,159}$/.test(id);
const tilde = (p) => String(p ?? '').replace(homedir(), '~');
const clamp = (n, a, b) => Math.max(a, Math.min(b, Math.round(Number(n) || a)));
const bot = (pose) => trimmed(rigPixels(pose)).px.map((row) => row.map((c) => (c == null ? null : xterm(c))));
const BOT = { ready: bot({ size: 'full', state: 'ready' }), work: bot({ size: 'full', state: 'ready', arms: 'type', armPhase: 0.5, eyes: 'half', look: { x: 0, y: 1 } }), happy: bot({ size: 'full', state: 'ready', arms: 'up', eyes: 'happy' }) };

// One window on one folder. Resolves with the app's exit code once both are gone.
export async function runWindow({ folder = process.cwd(), args = [], env = process.env, open = true, port = 0, cols = 140, rows = 44, onUrl = null, say = (t) => process.stdout.write(t), command = null, another = (at, more) => openAnother(at, more, env) } = {}) {
  const key = randomBytes(18).toString('hex');
  const dir = join(HOME, 'window');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sockPath = join(dir, `${process.pid}.sock`);
  try { rmSync(sockPath, { force: true }); } catch {}

  // What the app said last, whole, for a window that opens or reloads now.
  const st = { items: {}, order: [], steps: {}, last: null };
  const clients = new Set();
  const sendAll = (m) => { const s = JSON.stringify(m); for (const ws of clients) ws.send(s); };

  // The app's side (bridge.mjs): one line of JSON per state; a new connection is the app started again (/update).
  // Only a connection whose first line is this window's key is the app (14 Oct 2026): a test's copy of the app that
  // had the socket in its environment connected too, and the window dropped the conversation for that copy's drawing.
  const appKey = randomBytes(18).toString('hex');
  let appSock = null;
  const onLine = (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.t === 'state') {
      Object.assign(st.items, m.items);
      if (m.order) { st.order = m.order; const keep = new Set(m.order); for (const k of Object.keys(st.items)) if (!keep.has(k)) delete st.items[k]; }
      // the timeline's steps (bridge.mjs stepsOf): kept for a page that opens later, the newest 4,000
      if (m.steps) { Object.assign(st.steps, m.steps); const ks = Object.keys(st.steps); if (ks.length > 4000) for (const k of ks.slice(0, ks.length - 4000)) delete st.steps[k]; }
      const { items, order, steps, ...rest } = m;
      st.last = rest;
    }
    sendAll(m);
  };
  const bridge = Bun.listen({
    unix: sockPath,
    socket: {
      open(s) { s.data = { inbox: '', app: false }; },
      data(s, d) {
        s.data.inbox += Buffer.from(d).toString('utf8');
        let i;
        while ((i = s.data.inbox.indexOf('\n')) >= 0) {
          const l = s.data.inbox.slice(0, i); s.data.inbox = s.data.inbox.slice(i + 1);
          if (s.data.app) { if (s === appSock) onLine(l); continue; }
          let m; try { m = JSON.parse(l); } catch { m = null; }
          if (m?.t !== 'hi' || !sameKey(m.key, appKey)) { s.end(); return; }
          s.data.app = true; appSock = s; st.items = {}; st.order = []; st.steps = {}; st.last = null; sendAll({ t: 'reset' });
        }
      },
      close(s) { if (s === appSock) appSock = null; },
    },
  });
  try { chmodSync(sockPath, 0o600); } catch {}

  // The app, in a pretend terminal; what it draws is also kept as a screen (vt.mjs) for what the window has no view of.
  let proc = null;
  const vt = new VtScreen(cols, rows, { reply: (s) => { try { proc?.terminal?.write(s); } catch {} } });
  let screenTimer = null;
  const pushScreen = () => {
    if (screenTimer || ![...clients].some((ws) => ws.data.screen)) return;
    screenTimer = setTimeout(() => {
      screenTimer = null;
      const m = JSON.stringify({ t: 'screen', rows: cellRows(vt.cells()), cols: vt.cols, nrows: vt.rows, cursor: { x: vt.x, y: vt.y, on: vt.cursorOn } });
      for (const ws of clients) if (ws.data.screen) ws.send(m);
    }, 50);
  };
  const childEnv = { ...env, AGENTIC_WINDOW_SOCK: sockPath, AGENTIC_WINDOW_KEY: appKey, AGENTIC_WINDOW_CHILD: '1', AGENTIC_SESSIONS: 'off', TERM: env.TERM && env.TERM !== 'dumb' ? env.TERM : 'xterm-256color' };
  delete childEnv.AGENTIC_IN_HOST;
  // command: what runs in the pretend terminal instead of the app (the tests' stand-in).
  proc = Bun.spawn(command ?? appCommand(args.filter((a) => a !== '--terminal'), env), {
    cwd: folder, env: childEnv,
    terminal: { cols, rows, data(_t, bytes) { vt.write(bytes); pushScreen(); } },
  });

  // The window's page and its line to the app: this Mac only, and only with the key.
  const server = Bun.serve({
    hostname: '127.0.0.1', port,
    fetch(req, srv) {
      const u = new URL(req.url);
      if (!sameKey(u.searchParams.get('t'), key)) return new Response('Not here.', { status: 403 });
      if (u.pathname === '/ws') return srv.upgrade(req, { data: { screen: false } }) ? undefined : new Response('Not here.', { status: 400 });
      if (u.pathname === '/') return new Response(UI, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      if (u.pathname === '/sessions') { let list = []; try { list = listSessions(folder).slice(0, 200); } catch {} return Response.json(list); }
      if (u.pathname === '/pic') {
        // A picture in the prompt's tray or in a message you sent (bridge.mjs trayOf, view.mjs picsOf): only a file the
        // app named there, never any other path.
        const f = u.searchParams.get('f') ?? '';
        const named = (st.last?.tray ?? []).some((x) => x.file === f) || Object.values(st.items).some((v) => v?.pics?.some((p) => p.file === f));
        if (!named || !existsSync(f)) return new Response('Not here.', { status: 404 });
        return new Response(Bun.file(f), { headers: { 'content-type': PIC_TYPE[extname(f).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' } });
      }
      if (u.pathname === '/reveal') { execFile('open', [folder]); return Response.json({ ok: true }); }
      if (u.pathname === '/other-folder') {
        // A folder picked in the Mac's own dialog, then a window of its own on it.
        return new Promise((resolve) => execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Open Agentic Coder in which folder?")'], (err, out) => {
          const at = String(out ?? '').trim();
          if (err || !at) return resolve(Response.json({ ok: false }));
          another(at, []);
          resolve(Response.json({ ok: true, folder: tilde(at) }));
        }));
      }
      if (u.pathname === '/new-window') {
        // Another window on this folder, beside this one: a new conversation, or a saved one (?resume=<id>).
        const id = u.searchParams.get('resume');
        if (id != null && !chatId(id)) return Response.json({ ok: false }, { status: 400 });
        try { another(folder, id ? ['--resume', id] : []); } catch { return Response.json({ ok: false }, { status: 500 }); }
        return Response.json({ ok: true, folder: tilde(folder) });
      }
      return new Response('Not here.', { status: 404 });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ t: 'hello', state: st.last ? { ...st.last, items: st.items, order: st.order, steps: st.steps } : null, folder: tilde(folder), cols: vt.cols, rows: vt.rows, bot: BOT }));
      },
      message(ws, raw) {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.t === 'keys' && typeof m.data === 'string') proc.terminal.write(m.data);
        else if (m.t === 'paste' && typeof m.text === 'string') proc.terminal.write(`\x1b[200~${m.text}\x1b[201~`);
        else if (m.t === 'drop' && Array.isArray(m.paths) && dropText(m.paths)) proc.terminal.write(`\x1b[200~${dropText(m.paths)}\x1b[201~`);
        else if (m.t === 'resize') { const c = clamp(m.cols, 80, 320), r = clamp(m.rows, 24, 140); if (c !== vt.cols || r !== vt.rows) { proc.terminal.resize(c, r); vt.resize(c, r); } }
        else if (m.t === 'act') appSock?.write(`${JSON.stringify(m)}\n`);
        else if (m.t === 'screen') { ws.data.screen = Boolean(m.on); if (m.on) pushScreen(); }
      },
      close(ws) { clients.delete(ws); },
    },
  });
  const url = `http://127.0.0.1:${server.port}/?t=${key}`;
  onUrl?.(url);

  // The window itself. Closing it ends the app as closing its terminal did: it saves, then ends.
  let win = null;
  if (open) {
    const exe = windowApp(env);
    const title = ['--title', `Agentic Coder — ${tilde(folder)}`];
    if (exe) win = urlFromEnv(exe) ? Bun.spawn([exe, ...title], { env: { ...process.env, AGENTIC_WINDOW_URL: url }, stdio: ['ignore', 'ignore', 'ignore'] }) : Bun.spawn([exe, '--url', url, ...title], { stdio: ['ignore', 'ignore', 'ignore'] });
    else execFile('open', [url]);
    say(`Agentic Coder is open in its own window (${tilde(folder)}). Closing it quits. \`coding --terminal\` runs it here instead.\n`);
  }
  let closing = false;
  const endApp = () => {
    if (closing) return; closing = true;
    try { proc.terminal.close(); } catch {}
    setTimeout(() => { try { proc.kill('SIGHUP'); } catch {} }, 300).unref?.();
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 8000).unref?.();
  };
  win?.exited.then(endApp);
  const stopAll = () => { endApp(); };
  process.on('SIGINT', stopAll); process.on('SIGTERM', stopAll); process.on('SIGHUP', stopAll);

  const code = await proc.exited;
  sendAll({ t: 'exit', code });
  await Bun.sleep(150);
  try { win?.kill(); } catch {}
  server.stop(true);
  try { bridge.stop(true); } catch {}
  try { rmSync(sockPath, { force: true }); } catch {}
  return code ?? 0;
}
