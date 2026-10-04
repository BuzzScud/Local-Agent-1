// The loop board (`coding loops`, opened in its own Terminal window by /loop and /loops): the
// loops of one coding window, drawn as the Tree (loops-draw.mjs). It reads what that window wrote
// (loops.mjs: <home>/loops/<pid>/) five times a second and sends its keys back as small files, so
// closing the board changes nothing: the loops belong to their window and go on.
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HOME } from '../../../models/index.mjs';
import { listBoards, readState, readRun, sendCommand, runFile, dirOf, rulesOf, fieldsOf, guessKind, KINDS, LOOP_MODES, STEPS_WORD, hm } from './loops.mjs';
import { drawBoard, ansiRow, askingOf, readyOf } from './loops-draw.mjs';
import { appCommand } from './sessions.mjs';
import { canResize, resizeSeq } from './agents-window.mjs';
import { pickOnTerminal } from './pick.mjs';

const BOARD_SIZE = [124, 38];
export const newUi = () => ({ sel: 0, view: 'main', watch: null, chat: { on: false, text: '', as: 'note' }, toast: null, confirm: null, stamp: null, form: null });
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

// ---- the form: a new loop (+) or a loop's rules (e) ----
// Its rows, in order: what each run does, then its rules. A row with choices steps through them
// with ←→; one you can type in takes letters and digits too (the first key replaces a word).
export const FORM_ROWS = ['message', 'kind', 'every', 'runs', 'stopAt', 'cap', 'mode', 'steps', 'askFirst'];
const TYPED = new Set(['message', 'every', 'runs', 'stopAt', 'cap', 'steps']);
// The choices of a row, given what the form says now.
export function choicesOf(row, f, now = Date.now()) {
  if (row === 'kind') return KINDS;
  if (row === 'every') return (f.kind ?? guessKind(f.message ?? '')) === 'debug' ? ['until done', 'own pace', '1m', '5m', '10m', '30m', '1h'] : ['own pace', '1m', '2m', '5m', '10m', '30m', '1h', '2h', '1d'];
  if (row === 'runs') return ['no limit', '1', '2', '3', '5', '10', '20', '50'];
  if (row === 'stopAt') {
    // The next half hour at least 15 minutes away, then 1, 2, 4 and 8 hours after it.
    const t = new Date(now + 15 * 60_000);
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() <= 30 ? 30 : 60);
    return ['none', ...[0, 1, 2, 4, 8].map((h) => hm(t.getTime() + h * 3_600_000))];
  }
  if (row === 'cap') return ['none', '$0.25', '$0.50', '$1.00', '$2.00', '$5.00'];
  if (row === 'mode') return f.mode === 'bypass' ? [...LOOP_MODES, 'bypass'] : LOOP_MODES;
  if (row === 'steps') return [STEPS_WORD, '10', '20', '40', '80', '120'];
  if (row === 'askFirst') return [false, true];
  return null;
}
export function openForm(ui, l = null, { mode = 'ask' } = {}) {
  const fields = l ? fieldsOf(l) : { message: '', kind: null, every: 'own pace', runs: 'no limit', stopAt: 'none', cap: 'none', steps: STEPS_WORD, mode, askFirst: false };
  ui.form = { id: l?.id ?? null, again: Boolean(l && (l.state === 'done' || l.state === 'stopped')), name: l?.name ?? null, fields, row: 0, fresh: !l, error: null, field: null, kindSet: Boolean(l) };
  ui.view = 'form';
}
function formKey(b, k) {
  const { ui } = b;
  const f = ui.form;
  const row = FORM_ROWS[f.row];
  const v = f.fields;
  const kindNow = () => v.kind ?? guessKind(v.message);
  // A kind that cannot run until done leaves that pace; a fixing loop with its own pace runs until done.
  const tidy = () => { if (kindNow() !== 'debug' && v.every === 'until done') v.every = 'own pace'; };
  if (k === 'esc') { ui.form = null; ui.view = 'main'; return; }
  if (k === 'up' || k === 'shiftTab') { f.row = (f.row + FORM_ROWS.length - 1) % FORM_ROWS.length; f.fresh = true; return; }
  if (k === 'down' || k === 'tab') { f.row = (f.row + 1) % FORM_ROWS.length; f.fresh = true; return; }
  if (k === 'enter') {
    const read = rulesOf({ ...v, kind: kindNow() });
    if (read.error) { f.error = read.error; f.field = read.field; const i = FORM_ROWS.indexOf(read.field); if (i >= 0) { f.row = i; f.fresh = true; } return; }
    ui.stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    b.send({ op: f.id ? 'edit' : 'add', id: f.id, again: f.again, fields: { ...v, kind: kindNow() }, stamp: ui.stamp });
    say(ui, f.id ? (f.again ? 'Starting it again…' : 'Saving…') : 'Making the loop…', 'dim');
    ui.form = null;
    ui.view = 'main';
    return;
  }
  const choices = choicesOf(row, { ...v, kind: kindNow() });
  if ((k === 'left' || k === 'right' || (k === ' ' && !TYPED.has(row))) && choices) {
    const cur = row === 'kind' ? kindNow() : v[row];
    const at = choices.findIndex((c) => String(c).toLowerCase() === String(cur).toLowerCase());
    const next = choices[at < 0 ? 0 : (at + (k === 'left' ? choices.length - 1 : 1)) % choices.length];
    v[row] = next;
    if (row === 'kind') { f.kindSet = true; if (next === 'debug' && v.every === 'own pace') v.every = 'until done'; tidy(); }
    f.fresh = true; // typing next replaces the choice
    f.error = null;
    return;
  }
  if (!TYPED.has(row)) return;
  if (k === 'backspace') { v[row] = [...String(v[row])].slice(0, -1).join(''); f.fresh = false; }
  else if (k === 'ctrlU') { v[row] = ''; f.fresh = false; }
  else if (k.length === 1 && k >= ' ') {
    // The first key on a row that holds a word (none, own pace) replaces it; on the message it adds.
    v[row] = f.fresh && row !== 'message' && !/^\d/.test(String(v[row])) ? k : `${v[row]}${k}`;
    f.fresh = false;
  } else return;
  f.error = null;
  if (row === 'message' && !f.kindSet) { v.kind = null; tidy(); }
}

// What a key does. b: { state, ui, send(cmd), quit() }. A letter is a command, except while the
// chat box is typed in: then every key is text until enter or esc.
export function handleKey(b, k) {
  const { state, ui } = b;
  if (ui.view === 'form') return formKey(b, k);
  if (ui.view === 'confirm') {
    const c = ui.confirm;
    if (k === 'y' || k === 'enter') { ui.view = c.back; ui.confirm = null; c.yes(); }
    else if (k === 'n' || k === 'esc') { ui.view = c.back; ui.confirm = null; }
    return;
  }
  const l = ui.view === 'watch' ? state.loops.find((x) => x.id === ui.watch.id) : state.loops[ui.sel];
  if (ui.chat.on) {
    // tab: a note it reads at its next step → start the run over with it, its changes put back →
    // start over keeping them → a note again. A loop with nothing to start over keeps the note.
    if (k === 'tab' || k === 'shiftTab') { if (l && !over(l) && !/^\//.test(ui.chat.text)) { const ways = ['note', 'redo', 'redoKeep']; ui.chat.as = ways[(ways.indexOf(ui.chat.as ?? 'note') + (k === 'tab' ? 1 : 2)) % 3]; } return; }
    if (k === 'esc') { ui.chat.on = false; ui.chat.as = 'note'; }
    else if (k === 'enter') {
      const text = ui.chat.text.trim();
      const as = ui.chat.as ?? 'note';
      ui.chat.on = false;
      ui.chat.as = 'note';
      if (as !== 'note' && l && !/^\//.test(text)) {
        ui.chat.text = '';
        ui.stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        b.send({ op: 'redo', id: l.id, text, putBack: as === 'redo', stamp: ui.stamp });
        say(ui, `${l.name}: starting over…`, 'dim');
        return;
      }
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
  if (k === 't' || k === 'i') { ui.chat.on = true; ui.chat.as = 'note'; return; }
  if (k === '/') { ui.chat.on = true; ui.chat.as = 'note'; if (!ui.chat.text) ui.chat.text = '/'; return; }
  // "+" opens the form for a new loop (a /loop line typed in the chat box still makes one).
  if (k === '+' || k === '=') { openForm(ui, null, { mode: state.mode ?? 'ask' }); return; }
  if (k === 'q' && ui.view !== 'watch') return b.quit();
  // A question waits: y / a / n answer the oldest one, whichever loop is picked (the line above the chat box names it).
  const asking = askingOf(state);
  // Its choices, when it gave some: 1–9 picks one.
  if (asking && /^[1-9]$/.test(k) && asking.current.needs.kind === 'question') {
    const opt = asking.current.needs.options?.[Number(k) - 1];
    if (!opt) { say(ui, `It gave ${asking.current.needs.options?.length || 'no'} choices`, 'dim'); return; }
    b.send({ op: 'answer', id: asking.id, choice: 'yes', text: opt });
    say(ui, `${asking.name}: you picked “${opt}”`);
    return;
  }
  // Ask first: a run waits for your go. y starts it, n leaves this one out.
  const ready = !asking && readyOf(state);
  if (ready && (k === 'y' || k === 'n')) {
    b.send({ op: k === 'y' ? 'go' : 'skip', id: ready.id });
    say(ui, k === 'y' ? `${ready.name}: run ${ready.ready.n} starts` : `${ready.name}: run ${ready.ready.n} left out`);
    return;
  }
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
  // e: the loop's rules in the form (one that ended can start again from there).
  if (k === 'e') { openForm(ui, l); return; }
  // x: start the run over with a note (the chat box, set to start over; tab there keeps its changes).
  if (k === 'x') {
    if (over(l)) { say(ui, `${l.name} has ended: e starts it again`, 'dim'); return; }
    ui.chat.on = true;
    ui.chat.as = 'redo';
    return;
  }
  // u: put back what a run changed (the run you are watching, else the last one that kept a copy).
  if (k === 'u') {
    const n = ui.view === 'watch' ? (ui.watch.n ?? l.current?.n ?? l.runs.at(-1)?.n) : null;
    if (l.current && (!n || n === l.current.n)) { say(ui, `${l.name} is running: wait for run ${l.current.n} to end, or x to start it over`, 'dim'); return; }
    const r = n ? l.runs.find((x) => x.n === n) : [...l.runs].reverse().find((x) => x.point != null && !x.undone);
    if (!r) { say(ui, `${l.name} has no run to put back`, 'dim'); return; }
    if (r.undone) { say(ui, `Run ${r.n} was already put back`, 'dim'); return; }
    if (r.point == null) { say(ui, `Run ${r.n} kept no copy to put back`, 'dim'); return; }
    const files = (r.files ?? []).filter((f) => f.by !== 'other').map((f) => f.path);
    const what = files.length ? `${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}` : 'nothing it changed is known';
    ui.confirm = { text: `Put back what run ${r.n} changed? ${what}. A file changed since stays as it is.`, back: ui.view, yes: () => { ui.stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`; b.send({ op: 'undo', id: l.id, n: r.n, stamp: ui.stamp }); say(ui, `Putting back run ${r.n}…`, 'dim'); } };
    ui.view = 'confirm';
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
  // enter: the run under way, or the last one; it stays on the screen when the next one starts (→ goes to it).
  if (k === 'enter') { ui.watch = { id: l.id, n: l.current?.n ?? l.runs.at(-1)?.n ?? null, scroll: 0 }; ui.view = 'watch'; return; }
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
        say(ui, state.reply.text, state.reply.warn || /^(Only|A loop needs|A web loop)/.test(state.reply.text) ? 'warn' : 'accent');
      }
    }, 200));
    timers.push(setInterval(() => paint(), 125));
    process.once('SIGTERM', () => leave(143));
    process.once('SIGHUP', () => leave(129));
    paint(true);
  });
}
