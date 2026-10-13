// Loops (/loop, 3 Oct 2026, the owner's ask): a message Agentic Coder sends again by itself, every
// so often or until its job is done. Their picks:
//   - a loop belongs to the window it was made in and stops when that window closes;
//   - each run is a fresh conversation, told how the last run ended;
//   - a run that would ask is paused ("needs you") and the other loops go on;
//   - runs work right in the folder; they wait while the model is off (nothing loads by itself);
//   - a loop ends when a run says its job is done, or after 24 hours ($5 on a paid service);
//   - a fixing loop's "done" is checked: the app runs the tests itself and ends it only if they pass (9 Oct);
//   - a debugging run keeps a half-fix when fewer tests fail and none fails newly (agent.mjs).
// The window keeps the loops (Loops below) and starts `coding -p --loop-events` for each run
// (startRun, loop-run.mjs). What it knows is written to <home>/loops/<pid>/ for the board
// (`coding loops`, loops-board.mjs), which sends its keys back as small files in cmd/.
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { HOME } from '../../../models/index.mjs';
import { selfCommand } from './sessions.mjs';
import { libraryOf, saveLoop, removeLoop, trustLoop } from './loop-files.mjs';
import { MAX_HOURS, MAX_USD, RETRY_SECS, SELF_SECS, confirmWords, describe, everyWord, isLoopCommand, limitWhy, loopCommand, loopNote, minSecs, pageWords, parseLoop, readEnding, rulesOf, sessionOf, stuckWhy, summaryOf, unconfirmedWords } from './loops-words.mjs';
export { KINDS, LOOP_HELP, LOOP_MODES, PRESET, SELF_SECS, STEPS_WORD, checkWords, describe, everyWord, fieldsOf, guessKind, hm, isLoopCommand, kindWord, limitWhy, limitWords, loopCommand, loopNote, modeName, money, pageWords, parseLoop, readCap, readCheck, readEnding, readEvery, readRuns, readSentence, readSteps, readStopAt, rulesOf, sessionOf, spokenEvery, stuckWhy, summaryOf, unclearOf } from './loops-words.mjs';

// ---- the files the board reads -------------------------------------------------------------------
export const loopsDir = (home = HOME) => join(home, 'loops');
export const dirOf = (home, pid) => join(loopsDir(home), String(pid));
const stateFile = (home, pid) => join(dirOf(home, pid), 'state.json');
const cmdDir = (home, pid) => join(dirOf(home, pid), 'cmd');
export const runFile = (home, pid, id, n) => join(dirOf(home, pid), `run-${id}-${n}.jsonl`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const tilde = (p) => (p && p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);

// The windows that have loops now, oldest first; a folder whose window is gone is removed.
export function listBoards(home = HOME) {
  let names = [];
  try { names = readdirSync(loopsDir(home)); } catch { return []; }
  const out = [];
  for (const name of names) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!alive(pid)) { try { rmSync(dirOf(home, pid), { recursive: true, force: true }); } catch {} continue; }
    const s = readState(home, pid);
    if (s) out.push(s);
  }
  return out.sort((a, b) => (a.started ?? 0) - (b.started ?? 0));
}
export function readState(home, pid) { try { return JSON.parse(readFileSync(stateFile(home, pid), 'utf8')); } catch { return null; } }
export function readRun(home, pid, id, n) {
  let text = '';
  try { text = readFileSync(runFile(home, pid, id, n), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* a line half written */ } }
  return out;
}
let cmdSeq = 0;
// A key pressed on the board, for the window to act on at its next look (half a second at most).
export function sendCommand(home, pid, cmd) {
  const dir = cmdDir(home, pid);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = `${Date.now()}-${process.pid}-${++cmdSeq}`;
    writeFileSync(join(dir, `${name}.tmp`), JSON.stringify(cmd), { mode: 0o600 });
    renameSync(join(dir, `${name}.tmp`), join(dir, `${name}.json`));
    return true;
  } catch { return false; }
}

// ---- one run, as a process -----------------------------------------------------------------------
// spec: { folder, prompt, mode, url, slots, local, flows, allow, owner, steps, rewind, resume }. Answers { send, kill, on, pid }.
// resume: a transcript file (AGENTIC_TRANSCRIPT's) whose conversation the run carries on (the web's follow-ups).
export function startRun(spec, { self = selfCommand(), env = process.env } = {}) {
  const args = ['-p', '--loop-events', '--mode', spec.mode ?? 'ask', ...(spec.url ? ['--url', spec.url, ...(spec.slots > 1 ? ['--slots', String(spec.slots)] : [])] : spec.local ? ['--local'] : []), ...(spec.flows === false ? ['--no-flows'] : [])];
  const child = spawn(self[0], [...self.slice(1), ...args], {
    cwd: spec.folder, stdio: ['pipe', 'pipe', 'pipe'],
    // The memory is read, never saved to, by a run nobody watches; what it costs counts under its window.
    env: { ...env, AGENTIC_LOOP_SPEC: JSON.stringify({ prompt: spec.prompt, allow: spec.allow ?? [], steps: spec.steps ?? null, rewind: spec.rewind ?? null, ...(spec.resume ? { resume: spec.resume } : {}), ...(spec.check ? { check: spec.check } : {}), ...(spec.confirm ? { confirm: true } : {}), ...(spec.testsFirst === false ? { testsFirst: false } : {}) }), AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_SPEND_PID: String(spec.owner ?? process.pid), AGENTIC_OPEN: 'off' },
  });
  const fns = [];
  let carry = '', err = '', ended = false;
  const emit = (ev) => { if (ev.t === 'end') { if (ended) return; ended = true; } for (const f of fns) f(ev); };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    carry += d;
    for (let i = carry.indexOf('\n'); i >= 0; i = carry.indexOf('\n')) { const line = carry.slice(0, i); carry = carry.slice(i + 1); if (line[0] !== '{') continue; try { emit(JSON.parse(line)); } catch { /* not a line of ours */ } }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  child.on('error', (e) => emit({ t: 'end', reason: 'error', final: `The run could not start: ${e.message}` }));
  // A run that ends without saying so (a crash, the model gone): its last words on stderr say why.
  // Said once its output has closed, so a last line still on its way is read first; a run whose
  // output stays open after it exits (something it started still holds it) is ended 2 s later.
  const gone = (code) => emit({ t: 'end', reason: 'error', final: err.trim().split('\n').filter((l) => l.trim() && !l.startsWith('·')).slice(-1)[0] ?? `the run ended (code ${code})` });
  child.on('close', (code) => gone(code));
  child.on('exit', (code) => setTimeout(() => gone(code), 2000).unref?.());
  child.stdin.on('error', () => {});
  return {
    pid: child.pid,
    on(fn) { fns.push(fn); },
    send(msg) { try { child.stdin.write(`${JSON.stringify(msg)}\n`); } catch { /* it has ended */ } },
    // wait: you stopped it (or start it over), so it is given 10 s to keep its copy for undo and say
    // its last word; the window closing gives it 1.5 s.
    kill({ wait = false } = {}) { try { child.stdin.write('{"t":"stop"}\n'); } catch {} setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, wait ? 10_000 : 1500).unref?.(); },
  };
}

// Whether a folder has tests to run, from its top level only (the setup says so beside each folder):
// a package.json with a test script, a test folder, a *.test.* or *_test.* file, or pytest's files.
export function hasTests(folder) {
  let names = [];
  try { names = readdirSync(folder); } catch { return false; }
  if (names.some((n) => /^(tests?|__tests__|spec)$/.test(n) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(n) || /^test_.*\.py$|_test\.(py|go)$/.test(n) || /^(pytest\.ini|conftest\.py)$/.test(n))) return true;
  if (!names.includes('package.json')) return false;
  try { return Boolean(JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).scripts?.test); } catch { return false; }
}

// ---- the window's side ---------------------------------------------------------------------------
// status() → { on, why, name, where, limit, mode, url, slots, local }: whether a run can start now
// (the model loaded, the window not answering), how many may run at once, and how a run reaches
// the model. spend() → what this window has spent on a paid service, in dollars.
export class Loops {
  // rewind(session) → the copies of one loop's runs (rewind.mjs), for undo.
  // places() → the folders a new loop may work in besides this window's (your recent projects); wake() turns the
  // model on, for a loop started while it is off (9 Oct 2026, the owner's pick: Start turns it on).
  constructor({ home = HOME, pid = process.pid, folder = process.cwd(), name = basename(process.cwd()), status = () => ({ on: true, limit: 1 }), spend = () => 0, start = startRun, now = () => Date.now(), onChange = () => {}, maxHours = MAX_HOURS, maxUsd = MAX_USD, rewind = null, places = () => [], wake = null } = {}) {
    Object.assign(this, { home, pid, folder, name, status, spend, start, now, onChange, maxHours, maxUsd, places, wake });
    this.rewind = rewind ?? (async (session) => { const { Rewind } = await import('./rewind.mjs'); return new Rewind({ home, session }); });
    this.loops = [];
    this.log = [];
    this.nextId = 1;
    this.started = now();
    this.handles = new Map(); // loop id → the run's process
    this.dirty = false;
    this.closed = false;
    this.last = { on: true, why: '' };
  }
  loop(id) { return this.loops.find((l) => l.id === id) ?? null; }
  get open() { return this.loops.filter((l) => !['done', 'stopped'].includes(l.state)); }
  get needsYou() { return this.loops.filter((l) => l.current?.needs); }
  // The debugging loops that stopped getting closer and wait for you (stuckWhy).
  get stuck() { return this.loops.filter((l) => l.stuck && !l.current); }
  // The loops whose next run waits for your go (Ask first).
  get ready() { return this.loops.filter((l) => l.ready && !l.current); }
  // The oldest question waiting.
  get asking() { return [...this.needsYou].sort((a, b) => a.current.needs.since - b.current.needs.since)[0] ?? null; }
  say(l, kind, text, more = {}) { this.log.push({ at: this.now(), id: l?.id ?? null, kind, text, ...more }); if (this.log.length > 300) this.log.shift(); }
  changed() { this.dirty = true; this.onChange(); }
  line(l, run, kind, text, more = {}) { try { mkdirSync(dirOf(this.home, this.pid), { recursive: true, mode: 0o700 }); appendFileSync(runFile(this.home, this.pid, l.id, run.n), `${JSON.stringify({ at: this.now() - run.startedAt, kind, text, ...more })}\n`); } catch { /* the board shows less */ } run.lines = (run.lines ?? 0) + 1; }

  // /loop <text>: a new loop in this window's folder, in the mode it is in now.
  // parsed: parseLoop's answer, or rulesOf's rules (the form), which also carry the loop's own limits.
  add(parsed, { folder = this.folder, mode = 'ask' } = {}) {
    const t = this.now();
    const l = { id: this.nextId++, kind: parsed.kind, name: parsed.name, message: parsed.message, every: parsed.every, until: parsed.until, folder, mode: parsed.mode ?? mode, state: 'waiting', nextAt: t + 1000, endsAt: t + this.maxHours * 3_600_000, created: t, runs: [], current: null, note: null, queued: false, pauseAfter: false, allowed: [], doneWhy: null, gap: null, stuck: null,
      maxRuns: parsed.maxRuns ?? null, stopAt: parsed.stopAt ?? null, usdCap: parsed.usdCap ?? null, steps: parsed.steps ?? null, askFirst: Boolean(parsed.askFirst), counted: 0, spent: 0, ready: null, go: false, lastNote: null, picture: parsed.picture ?? null, check: parsed.check ?? null };
    this.loops.push(l);
    this.say(l, 'new', parsed.message);
    this.changed();
    return l;
  }

  // Twice a second: the board's keys, then every loop that is due.
  tick() {
    if (this.closed) return;
    this.readCommands();
    const t = this.now();
    const st = this.status() ?? { on: true };
    // The window's own spending and its loops' runs (each run says its cost when it ends).
    const usd = (Number(this.spend()) || 0) + this.loops.reduce((n, l) => n + (l.spent ?? 0), 0);
    const hold = usd >= this.maxUsd ? `this window has spent $${usd.toFixed(2)} on its service: its loops wait` : !st.on ? (st.why || 'the model is off') : '';
    const running = () => this.loops.filter((l) => l.current && !l.current.needs).length;
    for (const l of [...this.loops].sort((a, b) => a.nextAt - b.nextAt)) {
      if (l.current || ['paused', 'done', 'stopped', 'redoing'].includes(l.state)) continue;
      if (t >= l.endsAt) { this.end(l, 'done', `ran for ${this.maxHours} hours`); continue; }
      const limit = limitWhy(l, t);
      if (limit) { this.end(l, 'done', limit); continue; }
      if (hold) { if (l.state !== 'off' || l.offWhy !== hold) { l.state = 'off'; l.offWhy = hold; this.changed(); } continue; }
      if (l.state === 'off') { l.state = 'waiting'; l.offWhy = null; this.changed(); }
      if (t < l.nextAt) continue;
      // Ask first: a run that is due waits for your go (y on the board, /loop <n> go), and says so once.
      if (l.askFirst && !l.go) {
        if (!l.ready) { l.ready = { n: (l.runs.at(-1)?.n ?? 0) + 1, since: t }; this.say(l, 'ready', `run ${l.ready.n} is ready and waits for your go`); this.changed(); }
        continue;
      }
      // One run at a time on this Mac's model (more on a service): a loop that is due waits its turn.
      if (running() >= Math.max(1, st.limit ?? 1)) { if (!l.queued) { l.queued = true; this.changed(); } continue; }
      l.queued = false;
      this.begin(l, st);
    }
    if (this.dirty) this.save();
  }

  begin(l, st = this.status() ?? {}) {
    const t = this.now();
    const run = { n: (l.runs.at(-1)?.n ?? 0) + 1, startedAt: t, endedAt: null, ok: null, summary: null, needs: null, lines: 0 };
    l.current = run;
    l.state = 'running';
    l.go = false;
    l.ready = null;
    const note = loopNote(l, run.n, { now: t });
    this.line(l, run, 'user', l.message);
    this.line(l, run, 'loopnote', note);
    let prompt = `${l.message}\n\n${note}`;
    if (l.note) {
      this.line(l, run, 'you', l.note);
      prompt = `${l.message}\n\n(A note from the user for this run: ${l.note})\n\n${note}`;
      l.note = null;
      if (l.lastNote && !l.lastNote.read) l.lastNote.read = { start: run.n };
    }
    this.say(l, 'start', `run ${run.n}`, { n: run.n });
    let h;
    try { h = this.start({ folder: l.folder, prompt, mode: l.mode, url: st.url ?? null, slots: st.slots ?? 1, local: Boolean(st.local), flows: st.flows, allow: l.allowed, owner: this.pid, steps: l.steps, rewind: sessionOf(this.pid, l.id), check: l.check ? { ...l.check, after: Boolean(l.until) } : null, confirm: l.kind === 'debug' && !l.check, testsFirst: !(l.runs.at(-1)?.failing != null) }); }
    catch (e) { this.finish(l, run, { reason: 'error', final: `The run could not start: ${e.message}` }); return; }
    this.handles.set(l.id, h);
    h.on((ev) => this.onEvent(l, run, ev));
    this.changed();
  }

  onEvent(l, run, ev) {
    if (this.closed) return;
    // The last word of a run that was stopped: its copy for undo, and a start over that waited for it.
    if (l.current !== run) { if (ev.t === 'end') this.lateEnd(l, run, ev); return; }
    if (ev.t === 'tool') { const failed = ev.test && ev.failed !== undefined ? Boolean(ev.failed) : Boolean(ev.error); this.line(l, run, failed ? 'fail' : 'tool', `${ev.label}(${ev.arg ?? ''})`, { test: Boolean(ev.test) }); if (ev.test && ev.failed !== undefined) run.tests = { ok: !failed }; }
    else if (ev.t === 'note') this.line(l, run, 'note', ev.text);
    // A note you typed reached the model with a step's result (loop-run.mjs heard).
    else if (ev.t === 'heard') {
      this.line(l, run, 'heard', ev.text, { after: ev.after ?? null });
      this.say(l, 'heard', ev.after ? `read your note after ${ev.after}` : 'read your note');
      if (l.lastNote && !l.lastNote.read) l.lastNote.read = { after: ev.after ?? null, n: run.n };
    }
    else if (ev.t === 'text') this.line(l, run, 'text', ev.text);
    // The page check (cli.jsx): before the run, and for a loop that fixes until done, again after it.
    else if (ev.t === 'page') {
      run.page = { ...(run.page ?? {}), [ev.when === 'after' ? 'left' : 'found']: ev.skipped ? null : ev.count };
      this.line(l, run, 'page', pageWords(ev));
    }
    // A fixing loop's run said LOOP DONE: the app's own run of the tests (loop-run.mjs confirmDone).
    else if (ev.t === 'confirm') {
      if (ev.when === 'after') run.confirm = { command: ev.command ?? null, ok: Boolean(ev.ok), failed: ev.failed ?? null, failing: ev.failing ?? [], timedOut: Boolean(ev.timedOut), skipped: ev.skipped ?? null };
      this.line(l, run, 'check', confirmWords(ev));
    }
    else if (ev.t === 'ask') {
      run.needs = { id: ev.id, kind: ev.kind, name: ev.name, text: ev.text, options: ev.options ?? [], always: ev.always ?? null, sig: ev.sig ?? null, since: this.now() };
      l.state = 'needs';
      this.line(l, run, 'ask', ev.text);
      this.say(l, 'ask', ev.text);
    } else if (ev.t === 'end') { this.finish(l, run, ev); return; }
    this.changed();
  }

  finish(l, run, ev) {
    if (l.current !== run) return;
    this.handles.delete(l.id);
    const end = readEnding(ev.final);
    run.endedAt = this.now();
    // A run is ok (the app's blue) when it finished and the tests it ran last passed; a stop or a miss is red.
    const tests = ev.tests ?? run.tests ?? null;
    run.ok = ev.reason === 'done' && (tests ? tests.ok : true);
    // It said LOOP DONE and the app's own run of the tests did not pass: not done, and the next run is told.
    const c = run.confirm;
    const unconfirmed = ev.reason === 'done' && end.done && c && !c.skipped && !c.ok ? { command: c.command, failed: c.failed, failing: c.failing, timedOut: c.timedOut } : null;
    run.summary = run.redo ? 'stopped to start over' : run.stopped ? 'stopped by you' : unconfirmed ? unconfirmedWords(unconfirmed) : summaryOf(end.said, ev.reason);
    run.said = end.said.slice(0, 600);
    run.needs = null;
    // A note that came as the answer was given is the run's next message (loop-run.mjs more): read, with no step after it.
    if (l.lastNote && !l.lastNote.read && l.lastNote.n === run.n && !run.redo && !run.stopped) l.lastNote.read = { late: true, n: run.n };
    const usd = Number(ev.usd) || 0;
    l.spent = (l.spent ?? 0) + usd;
    if (!run.redo) l.counted = (l.counted ?? 0) + 1;
    l.runs.push({ n: run.n, startedAt: run.startedAt, endedAt: run.endedAt, ok: run.ok, summary: run.summary, said: run.said, lines: run.lines, reason: ev.reason, failing: Number.isFinite(tests?.count) ? tests.count : null, page: run.page ?? null, usd, point: ev.point ?? null, until: ev.until ?? ev.point ?? null, files: ev.files ?? [], redo: run.redo ?? null, unconfirmed });
    if (l.runs.length > 60) l.runs.shift();
    l.current = null;
    this.say(l, 'end', run.summary, { ok: run.ok, n: run.n, ms: run.endedAt - run.startedAt });
    if (l.state === 'stopped') { this.changed(); return; }
    // Stopped to start over: it waits for the run's copy (lateEnd), puts its changes back if you said so, then runs again.
    if (run.redo) { l.state = 'redoing'; this.redoWait(l, l.runs.at(-1)); this.changed(); return; }
    // The job is done: the run said so, or a debugging loop's tests pass.
    const checked = c && !c.skipped && c.ok ? ` and ${c.command} passes` : '';
    if (ev.reason === 'done' && ((end.done && !unconfirmed) || (l.until && tests?.ok && !l.check))) { this.end(l, 'done', end.done ? `the run said its job is done${checked}` : `the tests pass after ${run.n} run${run.n === 1 ? '' : 's'}`); return; }
    const limit = limitWhy(l, this.now());
    if (limit) { this.end(l, 'done', limit); return; }
    l.gap = end.nextSecs;
    l.nextAt = run.endedAt + (l.every ?? (l.until ? RETRY_SECS : end.nextSecs ?? SELF_SECS)) * 1000;
    // Not getting closer: it waits for you rather than trying the same thing again.
    const stuck = stuckWhy(l);
    if (stuck) { l.pauseAfter = false; l.state = 'paused'; l.stuck = stuck; this.say(l, 'stuck', stuck); }
    else if (l.pauseAfter) { l.pauseAfter = false; l.state = 'paused'; this.say(l, 'state', 'paused'); }
    else l.state = 'waiting';
    this.changed();
  }
  end(l, state, why) { l.state = state; l.doneWhy = why; l.queued = false; l.stuck = null; l.ready = null; l.go = false; this.say(l, 'state', state === 'done' ? `the loop ends: ${why}` : why); this.changed(); }

  // ---- what you can do to a loop (the board's keys, /loop in the window) ----
  answer(id, choice, text = null) {
    const l = this.loop(id);
    const n = l?.current?.needs;
    if (!n) return false;
    const h = this.handles.get(id);
    if (choice === 'always' && n.sig && !l.allowed.includes(n.sig)) l.allowed.push(n.sig);
    const said = text != null ? String(text) : choice === 'always' ? `Yes, always${n.always ? ` (${n.always})` : ''}` : choice === 'yes' ? 'Yes' : 'No';
    this.line(l, l.current, 'answer', said);
    this.say(l, 'answer', said);
    l.current.needs = null;
    l.state = 'running';
    h?.send({ t: 'answer', id: n.id, choice, ...(text != null ? { text: String(text) } : {}) });
    this.changed();
    return true;
  }
  // A note to a loop: its run reads it with its next step's result (loop-run.mjs); between runs, the next run starts with it.
  steer(id, text) {
    const l = this.loop(id);
    const note = String(text ?? '').trim();
    if (!l || !note) return null;
    this.say(l, 'you', note);
    // The last note, for the board: sent, then read after a step or at the start of a run.
    l.lastNote = { text: note, at: this.now(), n: l.current?.n ?? null, read: null };
    // A loop that ended starts again with the note (its rules as they were, its counts from nothing).
    if (['done', 'stopped'].includes(l.state)) {
      this.edit(id, {}, { again: true });
      l.note = note;
      this.changed();
      return `${l.name} starts again, with your note`;
    }
    if (l.current) {
      this.line(l, l.current, 'you', note);
      this.handles.get(id)?.send({ t: 'note', text: note });
      this.changed();
      return `Sent to ${l.name}: it reads it at its next step`;
    }
    l.note = l.note ? `${l.note}\n${note}` : note;
    // A loop that waits because it was stuck runs again now, with your note.
    if (l.stuck) { l.stuck = null; l.state = 'waiting'; l.nextAt = this.now(); this.changed(); return `${l.name} runs again now, with your note`; }
    this.changed();
    return `${l.name} starts its next run with your note`;
  }
  // What was typed in the board's chat box: /loop makes a loop, an open question gets it as its
  // answer, anything else is a note to the picked loop. Answers a line to show.
  typed(text, selId, { mode = 'ask' } = {}) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const m = /^\/loops?\b\s*(.*)$/is.exec(t);
    if (m && isLoopCommand(m[1])) { const r = this.command(m[1]); return r.then ? r.then((u) => (u.error ? { text: u.error, warn: true } : u.text)) : r.error ? { text: r.error, warn: true } : r.text; }
    if (m) {
      const p = parseLoop(m[1]);
      if (p.error) return p.error;
      const l = this.add(p, { mode: this.status()?.mode ?? mode });
      return { made: l.id, text: `Loop ${l.id} started: ${describe(l, this.now())}${p.note}` };
    }
    if (t.startsWith('/')) return 'Only /loop is a command here. Anything else is a note to the picked loop.';
    const l = this.loop(selId);
    if (l?.current?.needs?.kind === 'question') { this.answer(l.id, 'yes', t); return `Answered ${l.name}`; }
    return this.steer(selId, t);
  }
  runNow(id) {
    const l = this.loop(id);
    if (!l || l.current || ['done', 'stopped'].includes(l.state)) return false;
    if (l.state === 'paused') l.state = 'waiting';
    l.stuck = null;
    l.nextAt = this.now();
    this.changed();
    this.tick();
    return true;
  }
  pause(id) {
    const l = this.loop(id);
    if (!l || ['done', 'stopped'].includes(l.state)) return false;
    if (l.state === 'paused' || l.pauseAfter) { l.pauseAfter = false; l.stuck = null; if (l.state === 'paused') { l.state = 'waiting'; l.nextAt = Math.max(l.nextAt, this.now() + 1000); } this.say(l, 'state', 'going again'); }
    else if (!l.current) { l.state = 'paused'; this.say(l, 'state', 'paused'); }
    else { l.pauseAfter = true; this.say(l, 'state', 'pauses after this run'); }
    this.changed();
    return true;
  }
  stop(id) {
    const l = this.loop(id);
    if (!l || ['done', 'stopped'].includes(l.state)) return false;
    const run = l.current;
    l.state = 'stopped';
    l.doneWhy = 'stopped by you';
    l.queued = false;
    l.stuck = null;
    l.ready = null;
    this.say(l, 'state', 'stopped by you');
    if (run) { run.stopped = true; this.line(l, run, 'note', 'Stopped by you.'); this.handles.get(id)?.kill({ wait: true }); this.finish(l, run, { reason: 'interrupted', final: '' }); }
    this.changed();
    return true;
  }
  setEvery(id, secs) {
    const l = this.loop(id);
    if (!l || l.until || ['done', 'stopped'].includes(l.state)) return false;
    l.every = Math.max(minSecs(), Math.round(secs));
    if (!l.current) l.nextAt = Math.max(this.now() + 1000, (l.runs.at(-1)?.endedAt ?? this.now()) + l.every * 1000);
    this.changed();
    return true;
  }

  // Ask first: y on the board lets the waiting run start; n leaves this one out (a loop with no
  // time of its own, or one that runs until done, pauses instead).
  go(id) {
    const l = this.loop(id);
    if (!l?.ready) return false;
    l.ready = null;
    l.go = true;
    l.nextAt = Math.min(l.nextAt, this.now());
    this.say(l, 'state', 'you said go');
    this.changed();
    this.tick();
    return true;
  }
  notNow(id) {
    const l = this.loop(id);
    if (!l?.ready) return false;
    const n = l.ready.n;
    l.ready = null;
    if (l.every) { l.nextAt = this.now() + l.every * 1000; this.say(l, 'state', `run ${n} left out: the next one in ${everyWord(l.every)}`); }
    else { l.state = 'paused'; this.say(l, 'state', `run ${n} left out: paused`); }
    this.changed();
    return true;
  }

  // The form (e on the board) or /loop <n> <rule>: new rules for a loop. again: a loop that ended
  // starts again with them (its runs so far stay; its run count and spending start from nothing).
  edit(id, rules, { again = false } = {}) {
    const l = this.loop(id);
    if (!l) return { error: 'No such loop here' };
    const ended = ['done', 'stopped'].includes(l.state);
    if (ended && !again) return { error: `${l.name} has ended: save it with "start again"` };
    const was = { every: l.every, until: l.until };
    // Its name stays unless its message changed.
    if ('message' in rules && rules.message !== l.message && rules.name) l.name = rules.name;
    for (const k of ['message', 'kind', 'every', 'until', 'maxRuns', 'stopAt', 'usdCap', 'steps', 'mode', 'askFirst', 'check']) if (k in rules) l[k] = rules[k];
    const t = this.now();
    if (ended) {
      Object.assign(l, { state: 'waiting', nextAt: t + 1000, endsAt: t + this.maxHours * 3_600_000, doneWhy: null, counted: 0, spent: 0, stuck: null, ready: null, go: false, pauseAfter: false });
      this.say(l, 'state', 'started again');
    } else {
      if (!l.askFirst) l.ready = null;
      // A new pace counts from the last run's end.
      if ((was.every !== l.every || was.until !== l.until) && !l.current) l.nextAt = Math.max(t + 1000, (l.runs.at(-1)?.endedAt ?? t) + (l.every ?? (l.until ? RETRY_SECS : l.gap ?? SELF_SECS)) * 1000);
      this.say(l, 'state', 'its rules changed');
    }
    this.changed();
    return { text: `${l.name}: ${ended ? 'starts again' : 'saved'} · ${describe(l, t)}` };
  }

  // Stop the run under way and start it over with your note (^X on the board). putBack: what it
  // changed goes back first (undo), else the new run starts from where it left the files.
  // Between runs: the last run's changes go back if you said so, and a run starts now with the note.
  redo(id, note, { putBack = true } = {}) {
    const l = this.loop(id);
    const text = String(note ?? '').trim();
    if (!l || ['done', 'stopped'].includes(l.state)) return { error: l ? `${l.name} has ended` : 'No such loop here' };
    if (l.state === 'redoing') return { error: `${l.name} is already starting over` };
    this.say(l, 'you', text ? `start over: ${text}` : 'start over');
    if (text) l.lastNote = { text, at: this.now(), n: null, read: null };
    const run = l.current;
    if (run) {
      run.redo = { note: text || null, putBack: Boolean(putBack) };
      this.line(l, run, 'note', putBack ? 'Stopped by you, to start over; its changes go back.' : 'Stopped by you, to start over from here.');
      this.handles.get(id)?.kill({ wait: true });
      this.finish(l, run, { reason: 'interrupted', final: '' });
      return { text: `${l.name}: stopping run ${run.n} to start over${putBack ? ', its changes put back first' : ''}` };
    }
    const last = [...l.runs].reverse().find((r) => !r.undone);
    l.state = 'redoing';
    l.stuck = null;
    l.ready = null;
    this.redoNext(l, { note: text || null, putBack: Boolean(putBack) && Boolean(last) }, last);
    this.changed();
    return { text: `${l.name}: starting over now${putBack && last ? `, run ${last.n}'s changes put back first` : ''}` };
  }
  // A run stopped to start over: wait (10 s at most) for its last word, which carries its copy.
  redoWait(l, rec) {
    rec.waiting = true;
    setTimeout(() => { if (rec.waiting) { rec.waiting = false; this.redoNext(l, rec.redo, null, 'the run ended before its copy was kept: its changes stay'); } }, 10_000).unref?.();
  }
  lateEnd(l, run, ev) {
    const rec = l.runs.find((r) => r.n === run.n);
    if (!rec) return;
    if (ev.point != null && rec.point == null) { rec.point = ev.point; rec.until = ev.until ?? ev.point; rec.files = ev.files ?? []; }
    if (ev.usd) { rec.usd = (rec.usd ?? 0) + Number(ev.usd); l.spent = (l.spent ?? 0) + Number(ev.usd); }
    if (rec.waiting) { rec.waiting = false; this.redoNext(l, rec.redo, rec); }
    this.changed();
  }
  async redoNext(l, redo, rec, why = null) {
    let said = why;
    if (redo?.putBack && rec && rec.point != null && !rec.undone) { const r = await this.undo(l.id, rec.n, { during: true }); said = r.error ?? r.text; }
    if (this.closed || l.state !== 'redoing') return;
    if (said) this.say(l, 'undo', said);
    if (redo?.note) l.note = l.note ? `${l.note}\n${redo.note}` : redo.note;
    l.state = 'waiting';
    l.go = true; // starting over is your go
    l.nextAt = this.now();
    this.changed();
    this.tick();
  }

  // Put back what run n changed (^B on the board, /loop <n> undo): the files its edits and commands
  // changed, from the copy kept before it ran (rewind.mjs, that run only). A file changed since (by
  // you, another run, another loop) is left alone and named.
  async undo(id, n = null, { during = false } = {}) {
    const l = this.loop(id);
    if (!l) return { error: 'No such loop here' };
    if (l.current && !during) return { error: `${l.name} is running: wait for run ${l.current.n} to end, or start it over (^X)` };
    const rec = n ? l.runs.find((r) => r.n === n) : [...l.runs].reverse().find((r) => r.point != null && !r.undone);
    if (!rec) return { error: n ? `${l.name} has no run ${n}` : `${l.name} has no run to put back` };
    if (rec.undone) return { error: `Run ${rec.n} was already put back` };
    if (rec.point == null) return { error: `Run ${rec.n} kept no copy to put back` };
    let r = null;
    try { const rw = await this.rewind(sessionOf(this.pid, l.id)); r = await rw.restore(rec.point, { until: rec.until ?? rec.point }); } catch (e) { return { error: `Run ${rec.n} could not be put back: ${e.message}` }; }
    if (!r) return { error: `Run ${rec.n}'s copy is gone` };
    rec.undone = { at: this.now(), put: r.put.map((f) => f.rel), skip: r.skip.map((f) => ({ rel: f.rel, why: f.why })), failed: r.failed.map((f) => ({ rel: f.rel, why: f.why })) };
    const names = (list) => (list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`);
    const text = r.put.length ? `Put back run ${rec.n}: ${names(r.put.map((f) => f.rel))}` : `Run ${rec.n} had nothing of its own to put back`;
    const left = [...r.skip, ...r.failed].map((f) => f.rel);
    const said = `${text}${left.length ? ` · left alone: ${names(left)} (changed since)` : ''}`;
    if (!during) this.say(l, 'undo', said);
    this.changed();
    return { text: said };
  }

  // /loop <n> <rule> (the window, and the board's chat box): one rule of loop n changed, or one thing
  // done to it. Answers { text } or { error }, or a promise of one (undo).
  command(text) {
    const c = loopCommand(text, { now: this.now() });
    if (c.error) return c;
    const l = this.loop(c.id);
    if (!l) return { error: `No loop ${c.id} here. /loop lists them.` };
    if (c.op === 'rule') {
      const ended = ['done', 'stopped'].includes(l.state);
      if (ended) return { error: `${l.name} has ended: /loop ${l.id} again starts it again` };
      if (c.rules.until && l.kind !== 'debug') return { error: 'Only a loop that fixes tests runs until done: give a time, or own pace' };
      const e = this.edit(l.id, c.rules);
      return e.error ? e : { text: `${e.text}${c.note ?? ''}` };
    }
    if (c.op === 'again') return this.edit(l.id, {}, { again: true });
    if (c.op === 'go') return this.go(l.id) ? { text: `${l.name}: run ${l.runs.length + 1} starts` } : { error: `${l.name} is not waiting for a go` };
    if (c.op === 'skip') return this.notNow(l.id) ? { text: `${l.name}: that run is left out` } : { error: `${l.name} is not waiting for a go` };
    if (c.op === 'undo') return this.undo(l.id, c.n ?? null);
    if (c.op === 'redo') return this.redo(l.id, c.text, { putBack: !c.keep });
    if (c.op === 'note') { const r = this.steer(l.id, c.text); return r ? { text: r } : { error: 'A note needs words' }; }
    if (c.op === 'stop') return this.stop(l.id) ? { text: `Stopped: ${l.name}` } : { error: `${l.name} has already ended` };
    if (c.op === 'pause') return this.pause(l.id) ? { text: `${l.name}: paused, or going again` } : { error: `${l.name} has ended` };
    if (c.op === 'run') return this.runNow(l.id) ? { text: `${l.name}: running now` } : { error: `${l.name} cannot run now` };
    return { error: 'Not a loop command' };
  }

  // ---- the board ----
  // One thing the board sent (a key, a typed line, the form): done here, and what to say back, or
  // a promise of it (undo). The board in another terminal sends it as a file (readCommands); the loop
  // screen in this window calls it directly.
  apply(c) {
    // The form or the setup: a new loop (add) or new rules (edit); both checked here again, as typed.
    if (c.op === 'add' || c.op === 'edit') {
      const read = rulesOf(c.fields ?? {}, { now: this.now() });
      if (read.error) return { text: read.error, warn: true };
      if (c.op === 'add') {
        // Its folder: this window's or one of the places offered (a path from the board is never taken as it is).
        const folder = c.fields?.folder ? this.placesNow().find((x) => x.path === c.fields.folder)?.path : this.folder;
        if (!folder) return { text: 'That folder is not one of the places offered here', warn: true };
        // Save and start: kept first, so a name already taken stops it before anything runs.
        const kept = c.save ? this.keep(c.save) : null;
        if (kept?.warn) return kept;
        // A project's loop you did not save: Start was your yes to that very file.
        if (c.trust) { const e = this.libraryNow().find((x) => x.file === c.trust && x.from === 'project'); if (e) { try { trustLoop(this.home, e.file, readFileSync(e.file, 'utf8')); this.libraryKept = null; } catch {} } }
        const l = this.add(read.rules, { mode: read.rules.mode, folder });
        const woke = c.wake && !this.status()?.on ? this.wakeUp() : null;
        return { made: l.id, text: `Loop ${l.id} started: ${describe(l, this.now())}${read.note}${kept ? ` · ${kept.text}` : ''}${woke ? ` · ${woke}` : ''}` };
      }
      const e = this.edit(c.id, read.rules, { again: Boolean(c.again) });
      return e.error ? { text: e.error, warn: true } : `${e.text}${read.note}`;
    }
    if (c.op === 'save') return this.keep(c.save ?? {});
    if (c.op === 'remove') { const r = removeLoop(String(c.file ?? ''), { home: this.home, folders: this.placesNow() }); this.libraryKept = null; return r.error ? { text: r.error, warn: true } : { text: `Removed “${c.name ?? 'that loop'}”` }; }
    if (c.op === 'wake') return this.wakeUp() ?? { text: 'The model cannot be turned on from here: /start in the coding window', warn: true };
    if (c.op === 'undo') return this.undo(c.id, c.n ?? null).then((u) => ({ text: u.error ?? u.text, warn: Boolean(u.error) }));
    if (c.op === 'redo') { const d = this.redo(c.id, c.text, { putBack: c.putBack !== false }); return d.error ? { text: d.error, warn: true } : d.text; }
    if (c.op === 'go') this.go(c.id);
    else if (c.op === 'skip') this.notNow(c.id);
    else if (c.op === 'answer') this.answer(c.id, c.choice, c.text ?? null);
    else if (c.op === 'typed') return this.typed(c.text, c.id);
    else if (c.op === 'run') this.runNow(c.id);
    else if (c.op === 'pause') this.pause(c.id);
    else if (c.op === 'stop') this.stop(c.id);
    else if (c.op === 'every') this.setEvery(c.id, c.secs);
    return null;
  }
  // The folders a loop may work in: this window's first, then the places offered, each once.
  // Read again at most every 30 s: the window's list reads its saved conversations.
  placesNow() {
    const t = this.now();
    if (this.placesKept && t - this.placesKept.at < 30_000) return this.placesKept.list;
    const out = [{ path: this.folder, shown: tilde(this.folder), tests: hasTests(this.folder) }];
    let more = [];
    try { more = this.places() ?? []; } catch {}
    for (const f of more) if (f && !out.some((x) => x.path === f)) out.push({ path: f, shown: tilde(f), tests: hasTests(f) });
    this.placesKept = { at: t, list: out };
    return out;
  }
  // The loops that can be loaded (loop-files.mjs): the ready-made ones, yours, and the places' own.
  // Read again at most every 5 s, and at once after a save.
  libraryNow() {
    const t = this.now();
    if (this.libraryKept && t - this.libraryKept.at < 5000) return this.libraryKept.list;
    let list = [];
    try { list = libraryOf({ home: this.home, folders: this.placesNow() }); } catch {}
    this.libraryKept = { at: t, list };
    return list;
  }
  // Keeps a loop to load again: s = { name, about, message (with its {fill-ins}), fills, picture, fields, where, folder, replace }.
  keep(s) {
    const folder = s.where === 'project' ? this.placesNow().find((x) => x.path === s.folder)?.path : null;
    if (s.where === 'project' && !folder) return { text: 'That project is not one of the places offered here', warn: true };
    const { folder: _, ...fields } = s.fields ?? {};
    const r = saveLoop({ name: s.name, about: s.about, message: s.message, fills: s.fills, picture: s.picture, fields }, { home: this.home, where: s.where, folder, replace: s.replace ?? null });
    this.libraryKept = null;
    if (r.error) return { text: r.error, warn: true };
    return { text: `kept as “${String(s.name).trim()}” ${s.where === 'project' ? `in ${tilde(folder).split('/').pop()}` : 'for you'}: /loop loads it`, kept: r.file };
  }
  // The model on, for a loop (the window's own /start); a line to say, or null where it cannot.
  wakeUp() {
    if (!this.wake) return null;
    try { return this.wake() || 'turning the model on: the first run starts once it is loaded'; } catch { return null; }
  }
  readCommands() {
    let files = [];
    try { files = readdirSync(cmdDir(this.home, this.pid)).filter((f) => f.endsWith('.json')).sort(); } catch { return; }
    for (const f of files) {
      const p = join(cmdDir(this.home, this.pid), f);
      let c = null;
      try { c = JSON.parse(readFileSync(p, 'utf8')); } catch {}
      try { rmSync(p, { force: true }); } catch {}
      if (!c) continue;
      const r = this.apply(c);
      // What the window says back, for the board's own line (said: the command's stamp).
      const reply = (u) => { this.reply = { at: this.now(), stamp: c.stamp ?? null, text: typeof u === 'object' ? u.text : u, made: typeof u === 'object' ? u.made ?? null : null, warn: typeof u === 'object' && Boolean(u.warn) }; this.changed(); };
      if (r?.then) r.then(reply);
      else if (r) reply(r);
    }
  }
  snapshot() {
    const st = this.last = this.status() ?? this.last;
    return {
      v: 1, pid: this.pid, name: this.name, folder: tilde(this.folder), started: this.started, updated: this.now(), places: this.placesNow(), library: this.libraryNow(),
      model: { name: st.name ?? 'the model', on: Boolean(st.on), why: st.why ?? '', where: st.where ?? 'this Mac', limit: Math.max(1, st.limit ?? 1), wake: Boolean(this.wake) && !st.on && !/answering|loading/.test(st.why ?? '') }, mode: st.mode ?? 'ask',
      maxHours: this.maxHours, reply: this.reply ?? null,
      loops: this.loops.map((l) => ({ ...l, folder: tilde(l.folder), runs: l.runs.slice(-30), current: l.current ? { n: l.current.n, startedAt: l.current.startedAt, needs: l.current.needs, lines: l.current.lines, tests: l.current.tests ?? null } : null })),
      log: this.log.slice(-120),
    };
  }
  save() {
    this.dirty = false;
    try {
      mkdirSync(dirOf(this.home, this.pid), { recursive: true, mode: 0o700 });
      const tmp = `${stateFile(this.home, this.pid)}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.snapshot()), { mode: 0o600 });
      renameSync(tmp, stateFile(this.home, this.pid));
    } catch { /* the board shows the last one it read */ }
  }
  // The window closes: every loop ends with it, a run under way is stopped, and the files go.
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.handles.values()) h.kill();
    this.handles.clear();
    try { rmSync(dirOf(this.home, this.pid), { recursive: true, force: true }); } catch {}
  }
}
