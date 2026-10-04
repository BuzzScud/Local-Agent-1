// The loop board: the loops of one coding window, drawn as the Cards (loops-draw.mjs). /loops shows
// it in the coding window itself (App.jsx, loops-view.jsx); `coding loops` shows it in another
// terminal, where it reads what that window wrote (loops.mjs: <home>/loops/<pid>/) five times a second
// and sends its keys back as small files, so closing it changes nothing: the loops belong to their
// window and go on. The keys are the same in both (handleKey): typing always goes in the box, and
// the commands are ctrl keys (4 Oct 2026, the owner's pick after letters ate what they typed).
import { statSync } from 'node:fs';
import { HOME } from '../../../models/index.mjs';
import { listBoards, readState, readRun, sendCommand, runFile, rulesOf, fieldsOf, guessKind, unclearOf, isLoopCommand, KINDS, LOOP_MODES, STEPS_WORD, PRESET, hm, readEvery, readRuns, readStopAt } from './loops.mjs';
import { drawBoard, ansiRow, setupChoices, SETUP_EXAMPLES } from './loops-draw.mjs';
import { canResize, resizeSeq } from './agents-window.mjs';
import { pickOnTerminal } from './pick.mjs';

const BOARD_SIZE = [124, 38];
// inApp: the board is the coding window's own screen (esc goes back to the chat).
export const newUi = ({ inApp = false } = {}) => ({ sel: 0, view: 'main', watch: null, chat: { text: '', as: 'note' }, toast: null, confirm: null, stamp: null, form: null, setup: null, inApp });
export const say = (ui, text, style = 'accent') => { ui.toast = { text, style, until: Date.now() + 3200 }; };
const over = (l) => l.state === 'done' || l.state === 'stopped';
const stampOf = () => `${Date.now()}-${Math.round(Math.random() * 1e6)}`;

// The keys in a chunk of terminal input, by name: a ctrl key is ^ and its letter.
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
    else if (c < ' ') keys.push(`^${String.fromCharCode(c.charCodeAt(0) + 64)}`);
    else keys.push(c);
  }
  return keys;
}

// What the window said back to something sent from the board: a line at the bottom, and the loop it made picked.
export function showReply(ui, loops, r) {
  if (r == null) return;
  const text = typeof r === 'object' ? r.text : r;
  if (!text) return;
  if (typeof r === 'object' && r.made) { const i = loops.findIndex((l) => l.id === r.made); if (i >= 0) ui.sel = i; }
  say(ui, text, (typeof r === 'object' && r.warn) || /^(Only|A loop needs|A web loop)/.test(text) ? 'warn' : 'accent');
}

// ---- the form: every rule of a new loop or of one loop (^O) ----
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
// l: a loop's rules to change; fields: a new loop's rules so far (the setup's ^O).
export function openForm(ui, l = null, { mode = 'ask', fields = null } = {}) {
  const f = l ? fieldsOf(l) : { message: '', kind: null, every: 'own pace', runs: 'no limit', stopAt: 'none', cap: 'none', steps: STEPS_WORD, mode, askFirst: false, ...(fields ?? {}) };
  ui.form = { id: l?.id ?? null, again: Boolean(l && (l.state === 'done' || l.state === 'stopped')), name: l?.name ?? null, fields: f, row: 0, fresh: !l && !fields?.message, error: null, field: null, kindSet: Boolean(l || fields?.kind) };
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
    ui.stamp = stampOf();
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
  else if (k === '^U') { v[row] = ''; f.fresh = false; }
  else if (k.length === 1 && k >= ' ') {
    // The first key on a row that holds a word (none, own pace) replaces it; on the message it adds.
    v[row] = f.fresh && row !== 'message' && !/^\d/.test(String(v[row])) ? k : `${v[row]}${k}`;
    f.fresh = false;
  } else return;
  f.error = null;
  if (row === 'message' && !f.kindSet) { v.kind = null; tidy(); }
}

// ---- the setup: a new loop a step at a time (^N, /loops with no loop yet, an unclear /loop line) ----
// What each run does → how often → when it stops → a read-back; enter there sends the form's `add`.
// text and unclear: a /loop line the rules could not read well (loops.mjs unclearOf), asked about first.
export function openSetup(ui, { mode = 'ask', text = '', unclear = null } = {}) {
  ui.setup = { step: unclear ? 'unclear' : 'task', text, ex: -1, unclear, pick: 0, custom: '', error: null, name: '', words: {}, fields: { message: '', kind: null, every: 'own pace', runs: 'no limit', stopAt: 'none', cap: 'none', steps: STEPS_WORD, mode, askFirst: false } };
  ui.view = 'setup';
}
// every: a time the words gave ("… every 7m"), offered first.
function toOften(su, message, kind, every = null) {
  su.fields.message = message;
  su.fields.kind = kind;
  su.name = rulesOf({ message, kind, every: 'own pace' }).rules?.name ?? message; // the name the loop will have
  su.step = 'often'; su.custom = ''; su.error = null; su.unclear = null;
  const i = every ? setupChoices('often', kind).findIndex((c) => c.every === every) : -1;
  su.pick = Math.max(0, i);
  if (every && i < 0) su.custom = every;
}
function setupKey(b, k) {
  const { ui } = b;
  const su = ui.setup;
  const back = () => { ui.setup = null; ui.view = 'main'; };
  if (k === 'esc') return back();
  if (k === '^O') { openForm(ui, null, { mode: su.fields.mode, fields: { ...su.fields, message: su.fields.message || su.text } }); ui.setup = null; return; }
  if (su.step === 'task') {
    if (k === 'enter') {
      const t = su.text.trim();
      if (!t) { su.error = 'Type what each run should do first.'; return; }
      const u = unclearOf(t);
      if (u) { su.unclear = u; su.pick = 0; su.step = 'unclear'; su.error = null; return; }
      // A time in the words ("… every 10 minutes") is taken out and offered as the pace.
      const m = /[\s,]+every\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|mins?|minutes?|h|hrs?|hours?)\s*[.!]?$/i.exec(t);
      const every = m ? `${m[1]}${m[2][0].toLowerCase()}` : null;
      return toOften(su, m ? t.slice(0, m.index).trim() : t, guessKind(t), every);
    }
    if (k === 'tab') { su.ex = (su.ex + 1) % SETUP_EXAMPLES.length; su.text = SETUP_EXAMPLES[su.ex]; }
    else if (k === 'backspace') su.text = [...su.text].slice(0, -1).join('');
    else if (k === '^U') su.text = '';
    else if (k.length === 1 && k >= ' ') su.text += k;
    else return;
    su.error = null;
    return;
  }
  if (su.step === 'unclear') {
    const n = su.unclear.options.length;
    const pick = () => {
      const o = su.unclear.options[su.pick];
      if (o.act === 'again') { su.step = 'task'; su.text = ''; su.unclear = null; return; }
      if (o.act === 'use') return toOften(su, PRESET[o.kind] ?? su.text.trim(), o.kind, o.every);
      return toOften(su, su.text.trim(), guessKind(su.text));
    };
    if (k === 'up') su.pick = (su.pick + n - 1) % n;
    else if (k === 'down') su.pick = (su.pick + 1) % n;
    else if (/^[1-9]$/.test(k) && Number(k) <= n) { su.pick = Number(k) - 1; pick(); }
    else if (k === 'enter') pick();
    else if (k === 'left' || k === 'backspace') { su.step = 'task'; su.unclear = null; }
    return;
  }
  if (su.step === 'often' || su.step === 'stop') {
    const often = su.step === 'often';
    const cs = setupChoices(su.step, su.fields.kind);
    if (k === 'up') { su.pick = (su.pick + cs.length - 1) % cs.length; return; }
    if (k === 'down') { su.pick = (su.pick + 1) % cs.length; return; }
    if (k === 'left' || (k === 'backspace' && !su.custom)) { if (often) { su.step = 'task'; su.text = su.fields.message; } else { su.step = 'often'; su.pick = 0; } su.custom = ''; su.error = null; return; }
    if (k === 'backspace') { su.custom = [...su.custom].slice(0, -1).join(''); return; }
    if (k === '^U') { su.custom = ''; su.error = null; return; }
    if (k === 'enter') {
      if (often) {
        if (su.custom) {
          const r = readEvery(su.custom, { kind: su.fields.kind });
          if (r.error) { su.error = r.error; return; }
          su.fields.every = su.custom.trim();
          su.words.every = r.until ? 'until the tests pass' : r.every ? `every ${su.custom.trim().replace(/^every\s+/i, '')}` : 'at its own pace';
        } else { const c = cs[su.pick]; su.fields.every = c.every; su.words.every = c.w; }
        su.step = 'stop'; su.pick = 0; su.custom = ''; su.error = null;
        return;
      }
      if (su.custom) {
        const t = su.custom.trim();
        if (/^\d+$/.test(t)) { const r = readRuns(t); if (r.error) { su.error = r.error; return; } su.fields.runs = t; su.fields.stopAt = 'none'; su.words.stop = `after ${t} run${t === '1' ? '' : 's'}`; }
        else { const r = readStopAt(t); if (r.error) { su.error = r.error; return; } su.fields.runs = 'no limit'; su.fields.stopAt = t; su.words.stop = /^\d+(\.\d+)?\s*[hm]/i.test(t) ? `in ${t}` : `at ${t}`; }
      } else { const c = cs[su.pick]; su.fields.runs = c.runs; su.fields.stopAt = c.stopAt; su.words.stop = c.w === 'in 2 hours' ? `in 2 hours (${c.note.replace(/^at /, '')})` : c.w; }
      su.step = 'ready'; su.custom = ''; su.error = null;
      return;
    }
    if (k.length === 1 && k >= ' ') { su.custom += k; su.error = null; }
    return;
  }
  if (su.step === 'ready') {
    if (k === 'enter') {
      ui.stamp = stampOf();
      b.send({ op: 'add', fields: { ...su.fields }, stamp: ui.stamp });
      say(ui, 'Making the loop…', 'dim');
      back();
    } else if (k === 'left' || k === 'backspace') { su.step = 'stop'; su.pick = 0; }
  }
}

// ---- the box: what enter does with the words typed ----
function send(b, l) {
  const { state, ui } = b;
  const text = ui.chat.text.trim();
  const as = ui.chat.as ?? 'note';
  if (!text) { if (as !== 'note' && l && !over(l)) say(ui, 'Type what it should do differently first, then enter', 'dim'); return; }
  ui.chat.text = '';
  ui.chat.as = 'note';
  // A /loop line: an unclear one is asked about in the setup; the rest goes to the window as typed.
  if (/^\/loops?\b/i.test(text)) {
    const rest = text.replace(/^\/loops?\s*/i, '');
    if (!rest) { openSetup(ui, { mode: state.mode ?? 'ask' }); return; }
    const u = !isLoopCommand(rest) && unclearOf(rest);
    if (u) { openSetup(ui, { mode: state.mode ?? 'ask', text: rest, unclear: u }); return; }
    ui.stamp = stampOf();
    b.send({ op: 'typed', text, id: l?.id ?? null, stamp: ui.stamp });
    say(ui, isLoopCommand(rest) ? 'Sent' : 'Making the loop…', 'dim');
    return;
  }
  if (!l) { ui.chat.text = text; say(ui, 'No loop yet: ^N makes one, or type /loop 5m <message>', 'warn'); return; }
  const q = l.current?.needs;
  if (q) {
    // A question: a number picks one of its choices, other words are the answer.
    if (q.kind === 'question') {
      const num = /^[1-9]$/.test(text);
      const opt = num ? q.options?.[Number(text) - 1] : null;
      if (num && !opt) { ui.chat.text = text; say(ui, `It gave ${q.options?.length || 'no'} choices`, 'dim'); return; }
      b.send({ op: 'answer', id: l.id, choice: 'yes', text: opt ?? text });
      say(ui, opt ? `${l.name}: you picked “${opt}”` : `Answered ${l.name}`);
      return;
    }
    // A step to allow: y, a (always) or n; anything else goes to it as a note, and it still asks.
    const choice = /^(y|yes)$/i.test(text) ? 'yes' : /^(a|always)$/i.test(text) ? 'always' : /^(n|no)$/i.test(text) ? 'no' : null;
    if (choice === 'always' && !q.always) { ui.chat.text = text; say(ui, 'This one is asked every time: y or n', 'dim'); return; }
    if (choice) {
      b.send({ op: 'answer', id: l.id, choice });
      say(ui, choice === 'no' ? `${l.name}: you said no` : choice === 'always' ? `${l.name}: yes, and it will not ask this again` : `${l.name}: yes`);
      return;
    }
  } else if (l.ready && !l.current && /^(y|yes|go|n|no|skip)$/i.test(text)) {
    // Ask first: y starts the waiting run, n leaves this one out.
    const go = /^(y|yes|go)$/i.test(text);
    b.send({ op: go ? 'go' : 'skip', id: l.id });
    say(ui, go ? `${l.name}: run ${l.ready.n} starts` : `${l.name}: run ${l.ready.n} left out`);
    return;
  }
  if (as !== 'note' && !over(l)) {
    ui.stamp = stampOf();
    b.send({ op: 'redo', id: l.id, text, putBack: as === 'redo', stamp: ui.stamp });
    say(ui, `${l.name}: starting over…`, 'dim');
    return;
  }
  ui.stamp = stampOf();
  b.send({ op: 'typed', text, id: l.id, stamp: ui.stamp });
  say(ui, q ? 'Sent as a note: it still asks, so type y, a or n' : 'Sent', 'dim');
}

// What a key does. b: { state, ui, send(cmd), quit() }. Every printable key is text for the box;
// the commands are ctrl keys, and a question that needs a yes is answered by typing it.
export function handleKey(b, k) {
  const { state, ui } = b;
  if (ui.view === 'form') return formKey(b, k);
  if (ui.view === 'setup') return setupKey(b, k);
  if (ui.view === 'confirm') {
    // Only y does it: enter does nothing here (4 Oct 2026: a stop came from an s typed and an enter).
    const c = ui.confirm;
    if (k === 'y') { ui.view = c.back; ui.confirm = null; c.yes(); }
    else if (k === 'n' || k === 'esc') { ui.view = c.back; ui.confirm = null; }
    return;
  }
  const watching = ui.view === 'watch';
  const l = watching ? state.loops.find((x) => x.id === ui.watch.id) : state.loops[ui.sel];
  if (k === 'esc') {
    // The box first, then the run you watch, then the board itself.
    if (ui.chat.text || ui.chat.as !== 'note') { ui.chat.text = ''; ui.chat.as = 'note'; return; }
    if (watching) { ui.view = 'main'; ui.watch = null; return; }
    return b.quit();
  }
  if (k === 'enter') return send(b, l);
  if (k === 'backspace') { ui.chat.text = [...ui.chat.text].slice(0, -1).join(''); return; }
  if (k === '^U') { ui.chat.text = ''; return; }
  if (k === '^N') { openSetup(ui, { mode: state.mode ?? 'ask' }); return; }
  if (watching && ['up', 'down', 'left', 'right'].includes(k)) {
    const runs = [...l.runs, ...(l.current ? [l.current] : [])].map((r) => r.n);
    const at = ui.watch.n ? runs.indexOf(ui.watch.n) : runs.length - 1;
    if (k === 'up') ui.watch.scroll = (ui.watch.scroll ?? 0) + 3;
    else if (k === 'down') ui.watch.scroll = Math.max(0, (ui.watch.scroll ?? 0) - 3);
    else if (k === 'left' && at > 0) { ui.watch.n = runs[at - 1]; ui.watch.scroll = 0; }
    else if (k === 'right' && at >= 0) { ui.watch.n = at + 1 >= runs.length - 1 ? null : runs[at + 1]; ui.watch.scroll = 0; }
    return;
  }
  if (['up', 'down', 'left', 'right', 'tab', 'shiftTab'].includes(k)) {
    const n = state.loops.length;
    if (!n || k === 'tab' || k === 'shiftTab') return;
    ui.sel = (ui.sel + (k === 'up' || k === 'left' ? n - 1 : 1)) % n;
    ui.chat.as = 'note';
    return;
  }
  if (k.length === 1 && k >= ' ') { ui.chat.text += k; return; }
  if (!l) { if (/^\^[A-Z]$/.test(k)) say(ui, 'No loop yet: ^N makes one', 'dim'); return; }
  if (k === '^R') { if (l.current) say(ui, `${l.name} is already running`, 'dim'); else if (over(l)) say(ui, `${l.name} has ended: type a note and enter starts it again`, 'dim'); else if (!state.model.on) say(ui, `${state.model.why || 'The model is off'}: /start in the coding window first`, 'warn'); else { b.send({ op: 'run', id: l.id }); say(ui, `${l.name}: running now`); } return; }
  if (k === '^P') { if (over(l)) { say(ui, `${l.name} has ended`, 'dim'); return; } b.send({ op: 'pause', id: l.id }); say(ui, l.state === 'paused' || l.pauseAfter ? `${l.name}: going again` : l.current ? `${l.name}: pauses after this run` : `${l.name}: paused · ^P goes on`); return; }
  if (k === '^S') {
    if (over(l)) { say(ui, `${l.name} has already ended`, 'dim'); return; }
    ui.confirm = { text: `Stop "${l.name}"? Its runs so far stay.`, back: ui.view, yes: () => { b.send({ op: 'stop', id: l.id }); say(ui, `${l.name}: stopped · type a note to start it again`); } };
    ui.view = 'confirm';
    return;
  }
  // ^O: the loop's rules in the form (one that ended can start again from there).
  if (k === '^O') { openForm(ui, l); return; }
  // ^X: the box starts the run over with your words; again keeps its changes, again a plain note.
  if (k === '^X') {
    if (over(l)) { say(ui, `${l.name} has ended: type a note and enter starts it again`, 'dim'); return; }
    const ways = ['note', 'redo', 'redoKeep'];
    ui.chat.as = ways[(ways.indexOf(ui.chat.as ?? 'note') + 1) % 3];
    say(ui, ui.chat.as === 'redo' ? 'Type what to do differently, then enter: the run starts over and its changes go back · ^X again keeps them' : ui.chat.as === 'redoKeep' ? 'Starting over keeps its changes · ^X again: a plain note' : 'A plain note again', 'dim');
    return;
  }
  // ^B: put back what a run changed (the run you are watching, else the last one that kept a copy).
  if (k === '^B') {
    const n = watching ? (ui.watch.n ?? l.current?.n ?? l.runs.at(-1)?.n) : null;
    if (l.current && (!n || n === l.current.n)) { say(ui, `${l.name} is running: wait for run ${l.current.n} to end, or ^X to start it over`, 'dim'); return; }
    const r = n ? l.runs.find((x) => x.n === n) : [...l.runs].reverse().find((x) => x.point != null && !x.undone);
    if (!r) { say(ui, `${l.name} has no run to put back`, 'dim'); return; }
    if (r.undone) { say(ui, `Run ${r.n} was already put back`, 'dim'); return; }
    if (r.point == null) { say(ui, `Run ${r.n} kept no copy to put back`, 'dim'); return; }
    const files = (r.files ?? []).filter((f) => f.by !== 'other').map((f) => f.path);
    const what = files.length ? `${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}` : 'nothing it changed is known';
    ui.confirm = { text: `Put back what run ${r.n} changed? ${what}. A file changed since stays as it is.`, back: ui.view, yes: () => { ui.stamp = stampOf(); b.send({ op: 'undo', id: l.id, n: r.n, stamp: ui.stamp }); say(ui, `Putting back run ${r.n}…`, 'dim'); } };
    ui.view = 'confirm';
    return;
  }
  // ^G: one run full size, the one under way or the last; it stays on the screen when the next starts.
  if (k === '^G') {
    if (watching) { ui.view = 'main'; ui.watch = null; return; }
    ui.watch = { id: l.id, n: l.current?.n ?? l.runs.at(-1)?.n ?? null, scroll: 0 };
    ui.view = 'watch';
  }
}

// A run's lines, read again only when its file has grown: linesOf(loop, n) for drawBoard.
export function runReader(home, pid) {
  const cache = new Map();
  return (l, n) => {
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
}

// `coding loops [pid]`: the board in a terminal of its own, until esc or ctrl+c. Answers the exit code.
export async function runBoard({ home = HOME, pid = null, input = process.stdin, output = process.stderr, env = process.env } = {}) {
  const out = process.stdout;
  if (!input.isTTY || !out.isTTY) { output.write('coding loops needs a terminal.\n'); return 2; }
  if (!pid) {
    const boards = listBoards(home);
    if (!boards.length) { output.write('No coding window has a loop now. In a coding window, type: /loop 10m <message>   (or /loop test 5m, /loop debug, /loop web 30m <what to read>; /loops shows them there)\n'); return 0; }
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
  const linesOf = runReader(home, pid);
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
    const b = { get state() { return state; }, ui, send: (cmd) => sendCommand(home, pid, cmd), quit: () => leave(0, 'The loop board is closed. The loops go on in their window; /loops there shows them.') };
    const onReadable = () => {
      let c;
      while (!done && (c = input.read()) !== null) {
        for (const k of keysOf(String(c))) { if (k === '^C') return leave(0, 'The loop board is closed. The loops go on in their window.'); handleKey(b, k); if (done) return; }
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
      if (ui.stamp && state.reply?.stamp === ui.stamp) { ui.stamp = null; showReply(ui, state.loops, state.reply); }
    }, 200));
    timers.push(setInterval(() => paint(), 125));
    process.once('SIGTERM', () => leave(143));
    process.once('SIGHUP', () => leave(129));
    paint(true);
  });
}
