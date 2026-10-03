// The loop board (`coding loops`, opened in its own Terminal window by /loop and /loops): the
// loops of one coding window, drawn as the Tree (loops-draw.mjs). It reads what that window wrote
// (loops.mjs: <home>/loops/<pid>/) five times a second and sends its keys back as small files, so
// closing the board changes nothing: the loops belong to their window and go on.
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../../../models/index.mjs';
import { listBoards, readState, readRun, sendCommand, runFile, dirOf, everyWord } from './loops.mjs';
import { drawBoard, ansiRow, askingOf } from './loops-draw.mjs';
import { appCommand } from './sessions.mjs';
import { canResize, resizeSeq } from './agents-window.mjs';
import { pickOnTerminal } from './pick.mjs';

const BOARD_SIZE = [124, 38];
const EVERY = [60, 120, 300, 600, 1800, 3600];
export const newUi = () => ({ sel: 0, view: 'main', watch: null, chat: { on: false, text: '' }, toast: null, confirm: null, stamp: null });
const say = (ui, text, style = 'accent') => { ui.toast = { text, style, until: Date.now() + 3200 }; };
const over = (l) => l.state === 'done' || l.state === 'stopped';

// The keys in a chunk of terminal input, by name.
export function keysOf(s) {
  const keys = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\x1b') {
      const m = /^\x1b(\[|O)([A-DZ])/.exec(s.slice(i));
      if (m) { keys.push({ A: 'up', B: 'down', C: 'right', D: 'left', Z: 'shiftTab' }[m[2]]); i += 2; continue; }
      const other = /^\x1b\[[\d;?<]*[A-Za-z~]/.exec(s.slice(i));
      if (other) { i += other[0].length - 1; continue; }
      keys.push('esc');
    } else if (c === '\r' || c === '\n') keys.push('enter');
    else if (c === '\t') keys.push('tab');
    else if (c === '\x7f' || c === '\b') keys.push('backspace');
    else if (c === '\x03') keys.push('ctrlC');
    else if (c === '\x15') keys.push('ctrlU');
    else if (c >= ' ') keys.push(c);
  }
  return keys;
}

// What a key does. b: { state, ui, send(cmd), quit() }. A letter is a command, except while the
// chat box is typed in: then every key is text until enter or esc.
export function handleKey(b, k) {
  const { state, ui } = b;
  if (ui.view === 'confirm') {
    const c = ui.confirm;
    if (k === 'y' || k === 'enter') { ui.view = c.back; ui.confirm = null; c.yes(); }
    else if (k === 'n' || k === 'esc') { ui.view = c.back; ui.confirm = null; }
    return;
  }
  const l = ui.view === 'watch' ? state.loops.find((x) => x.id === ui.watch.id) : state.loops[ui.sel];
  if (ui.chat.on) {
    if (k === 'esc') ui.chat.on = false;
    else if (k === 'enter') {
      const text = ui.chat.text.trim();
      ui.chat.on = false;
      if (!text) return;
      ui.chat.text = '';
      ui.stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      b.send({ op: 'typed', text, id: l?.id ?? null, stamp: ui.stamp });
      say(ui, /^\/loops?\b/i.test(text) ? 'Making the loop…' : 'Sent', 'dim');
    } else if (k === 'backspace') ui.chat.text = [...ui.chat.text].slice(0, -1).join('');
    else if (k === 'ctrlU') ui.chat.text = '';
    else if (k.length >= 1 && k >= ' ' && !['up', 'down', 'left', 'right', 'tab', 'shiftTab', 'esc', 'enter'].includes(k)) ui.chat.text += k;
    return;
  }
  if (k === 't' || k === 'i') { ui.chat.on = true; return; }
  if (k === '/') { ui.chat.on = true; if (!ui.chat.text) ui.chat.text = '/'; return; }
  // "+" makes a loop the way the app does: /loop, typed in the chat box.
  if (k === '+' || k === '=') { ui.chat.on = true; ui.chat.text = '/loop '; return; }
  if (k === 'q' && ui.view !== 'watch') return b.quit();
  // A question waits: y / a / n answer the oldest one, whichever loop is picked (the line above the chat box names it).
  const asking = askingOf(state);
  if (asking && ['y', 'a', 'n'].includes(k)) {
    const q = asking.current.needs;
    if (k === 'a' && !q.always) { say(ui, 'This one is asked every time: y or n', 'dim'); return; }
    b.send({ op: 'answer', id: asking.id, choice: { y: 'yes', a: 'always', n: 'no' }[k], ...(q.kind === 'question' && k === 'y' ? { text: 'yes' } : {}) });
    say(ui, k === 'n' ? `${asking.name}: you said no` : k === 'a' ? `${asking.name}: yes, and it will not ask this again` : `${asking.name}: yes`);
    return;
  }
  if (!l) return;
  if (k === 'r') { if (l.current) say(ui, `${l.name} is already running`, 'dim'); else if (over(l)) say(ui, `${l.name} has ended`, 'dim'); else if (!state.model.on) say(ui, `${state.model.why || 'The model is off'}: /start in the coding window first`, 'warn'); else { b.send({ op: 'run', id: l.id }); say(ui, `${l.name}: running now`); } return; }
  if (k === 'p') { if (over(l)) { say(ui, `${l.name} has ended`, 'dim'); return; } b.send({ op: 'pause', id: l.id }); say(ui, l.state === 'paused' || l.pauseAfter ? `${l.name}: going again` : l.current ? `${l.name}: pauses after this run` : `${l.name}: paused`); return; }
  if (k === 's') {
    if (over(l)) { say(ui, `${l.name} has already ended`, 'dim'); return; }
    ui.confirm = { text: `Stop "${l.name}"? Its runs so far stay on the board.`, back: ui.view, yes: () => { b.send({ op: 'stop', id: l.id }); say(ui, `${l.name}: stopped`); } };
    ui.view = 'confirm';
    return;
  }
  if (k === 'e') {
    if (l.until) { say(ui, 'A loop that runs until its job is done has no "every"', 'dim'); return; }
    if (over(l)) { say(ui, `${l.name} has ended`, 'dim'); return; }
    const next = EVERY[(EVERY.findIndex((x) => x >= (l.every ?? 0)) + 1) % EVERY.length];
    b.send({ op: 'every', id: l.id, secs: next });
    say(ui, `${l.name}: every ${everyWord(next)} from now on`);
    return;
  }
  if (ui.view === 'watch') {
    const runs = [...l.runs, ...(l.current ? [l.current] : [])].map((r) => r.n);
    const at = ui.watch.n ? runs.indexOf(ui.watch.n) : runs.length - 1;
    if (k === 'esc' || k === 'q' || k === 'enter') { ui.view = 'main'; ui.watch = null; }
    else if (k === 'up') ui.watch.scroll = (ui.watch.scroll ?? 0) + 3;
    else if (k === 'down') ui.watch.scroll = Math.max(0, (ui.watch.scroll ?? 0) - 3);
    else if (k === 'left' && at > 0) { ui.watch.n = runs[at - 1]; ui.watch.scroll = 0; }
    else if (k === 'right' && at >= 0) { ui.watch.n = at + 1 >= runs.length - 1 ? null : runs[at + 1]; ui.watch.scroll = 0; }
    return;
  }
  if (k === 'enter') { ui.watch = { id: l.id, n: null, scroll: 0 }; ui.view = 'watch'; return; }
  const n = state.loops.length;
  if (k === 'left' || k === 'up') ui.sel = (ui.sel + n - 1) % n;
  else if (k === 'right' || k === 'down') ui.sel = (ui.sel + 1) % n;
}

// Opens the board of window `pid` in a new Terminal window. false where it cannot (not a Mac, a
// test, no Terminal): the caller then says how to open it by hand.
export function openBoardWindow(pid, { home = HOME, env = process.env } = {}) {
  if (process.platform !== 'darwin' || env.AGENTIC_NO_OPEN || env.AGENTIC_OPEN === 'off') return false;
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const file = join(dirOf(home, pid), 'board.command');
  try {
    const cmd = appCommand(['loops', String(pid)], env);
    writeFileSync(file, `#!/bin/sh\n# Opened by Agentic Coder: the loop board of one coding window (/loops). q closes the board;\n# the loops belong to their window and go on.\n${env.AGENTIC_HOME ? `export AGENTIC_HOME=${q(env.AGENTIC_HOME)}\n` : ''}exec ${cmd.map(q).join(' ')}\n`, { mode: 0o700 });
    chmodSync(file, 0o700);
    spawn('/usr/bin/open', ['-a', 'Terminal', file], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch { return false; }
}

// `coding loops [pid]`: the board, until q. Answers the exit code.
export async function runBoard({ home = HOME, pid = null, input = process.stdin, output = process.stderr, env = process.env } = {}) {
  const out = process.stdout;
  if (!input.isTTY || !out.isTTY) { output.write('coding loops needs a terminal.\n'); return 2; }
  if (!pid) {
    const boards = listBoards(home);
    if (!boards.length) { output.write('No coding window has a loop now. In a coding window, type: /loop 10m <message>   (or /loop test 5m, /loop debug, /loop web 30m <what to read>)\n'); return 0; }
    if (boards.length === 1) pid = boards[0].pid;
    else {
      output.write('Which window\'s loops?\n\n');
      const i = await pickOnTerminal(boards.map((s) => `${s.name} · ${s.folder} · ${s.loops.length} loop${s.loops.length === 1 ? '' : 's'}`));
      if (i === null) return 0;
      pid = boards[i].pid;
    }
  }
  let state = readState(home, pid);
  if (!state) { output.write(`No coding window ${pid} has loops (it may have closed: its loops ended with it).\n`); return 1; }
  const ui = newUi();
  // A run's lines, read again only when its file has grown.
  const cache = new Map();
  const linesOf = (l, n) => {
    if (!n) return [];
    const file = runFile(home, pid, l.id, n);
    let size = -1;
    try { size = statSync(file).size; } catch { return []; }
    const key = `${l.id}-${n}`;
    const had = cache.get(key);
    if (had && had.size === size) return had.lines;
    const lines = readRun(home, pid, l.id, n);
    cache.set(key, { size, lines });
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return lines;
  };
  let lastFrame = [];
  const paint = (force = false) => {
    const cols = out.columns || BOARD_SIZE[0], rows = out.rows || BOARD_SIZE[1];
    const frame = drawBoard(state, ui, { cols, rows, now: Date.now(), linesOf }).map(ansiRow);
    let buf = '';
    for (let y = 0; y < frame.length; y++) if (force || frame[y] !== lastFrame[y]) buf += `\x1b[${y + 1};1H${frame[y]}`;
    lastFrame = frame;
    if (buf) out.write(buf);
  };
  return await new Promise((resolve) => {
    let done = false;
    const timers = [];
    const leave = (code, last = '') => {
      if (done) return;
      done = true;
      for (const t of timers) clearInterval(t);
      input.off('readable', onReadable);
      out.off('resize', onResize);
      out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
      input.setRawMode(false);
      if (last) out.write(`${last}\n`);
      resolve(code);
    };
    const b = { get state() { return state; }, ui, send: (cmd) => sendCommand(home, pid, cmd), quit: () => leave(0, 'The loop board is closed. The loops go on in their window; /loops there opens the board again.') };
    const onReadable = () => {
      let c;
      while (!done && (c = input.read()) !== null) {
        for (const k of keysOf(String(c))) { if (k === 'ctrlC') return leave(0, 'The loop board is closed. The loops go on in their window.'); handleKey(b, k); if (done) return; }
        paint();
      }
    };
    const onResize = () => { out.write('\x1b[2J'); paint(true); };
    // The board grows to 124 × 38 where the terminal follows that (as /agents does), keeping a bigger window.
    if (canResize(env, out) && ((out.columns ?? 0) < BOARD_SIZE[0] || (out.rows ?? 0) < BOARD_SIZE[1])) out.write(resizeSeq(Math.max(out.columns ?? 0, BOARD_SIZE[0]), Math.max(out.rows ?? 0, BOARD_SIZE[1])));
    out.write('\x1b[?1049h\x1b[?25l\x1b[2J');
    input.setRawMode(true);
    input.on('readable', onReadable);
    out.on('resize', onResize);
    timers.push(setInterval(() => {
      const next = readState(home, pid);
      // The window closed: its loops ended with it.
      if (!next) return leave(0, 'That coding window closed, and its loops ended with it.');
      state = next;
      if (ui.sel >= state.loops.length) ui.sel = Math.max(0, state.loops.length - 1);
      // What the window said back to the last thing typed here.
      if (ui.stamp && state.reply?.stamp === ui.stamp) {
        ui.stamp = null;
        if (state.reply.made) { const i = state.loops.findIndex((l) => l.id === state.reply.made); if (i >= 0) ui.sel = i; }
        say(ui, state.reply.text, /^(Only|A loop needs|A web loop)/.test(state.reply.text) ? 'warn' : 'accent');
      }
    }, 200));
    timers.push(setInterval(() => paint(), 125));
    process.once('SIGTERM', () => leave(143));
    process.once('SIGHUP', () => leave(129));
    paint(true);
  });
}
