// Loops (/loop, 3 Oct 2026, the owner's ask): a message Agentic Coder sends again by itself, every
// so often or until its job is done. Their picks:
//   - a loop belongs to the window it was made in and stops when that window closes;
//   - each run is a fresh conversation, told how the last run ended;
//   - a run that would ask is paused ("needs you") and the other loops go on;
//   - runs work right in the folder; they wait while the model is off (nothing loads by itself);
//   - a loop ends when a run says its job is done, or after 24 hours ($5 on a paid service);
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

export const KINDS = ['debug', 'test', 'web', 'task'];
const UNIT = { s: 1, m: 60, h: 3600, d: 86_400 };
// The shortest gap between two runs of a loop (a test sets AGENTIC_LOOP_MIN_SECS).
const minSecs = (env = process.env) => Math.max(1, Number(env.AGENTIC_LOOP_MIN_SECS) || 60);
export const SELF_SECS = 600; // no time given: ten minutes, unless a run says NEXT RUN IN <n> MIN
const RETRY_SECS = 15; // a debugging loop tries again this long after a miss
const MAX_HOURS = 24;
const MAX_USD = 5;
export const PRESET = {
  debug: 'Some tests in this folder fail. Find why and fix the code until every test passes.',
  test: 'Run the tests. Say which fail and why. This is only a question: change no file.',
};
const guessKind = (message) => (/\b(fix|debug|bug|bugs|broken)\b/i.test(message) ? 'debug'
  : /https?:\/\/|\b(web|page|pages|site|sites|url|release|releases|browse|news)\b/i.test(message) ? 'web'
  : /\b(test|tests|check|lint|build)\b/i.test(message) ? 'test' : 'task');
const PRESET_NAME = { debug: 'Fix the failing tests', test: 'Run the tests' };
const nameOf = (message) => { const t = String(message).replace(/\s+/g, ' ').trim().split(/[.:!?](?:\s|$)/)[0]; return t.length > 28 ? `${t.slice(0, 27)}…` : t; };
export const everyWord = (secs) => (!secs ? '' : secs % 86_400 === 0 ? `${secs / 86_400}d` : secs % 3600 === 0 ? `${secs / 3600}h` : secs % 60 === 0 ? `${secs / 60}m` : `${secs}s`);

// A time as people write it: 10m, 10 min, 10 minutes, 1.5h, 2 hours, 30 seconds, every hour.
const UNIT_WORD = String.raw`(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)`;
const LEAD_TIME = new RegExp(String.raw`^(?:every\s+)?(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))\b[,:]?\s*`, 'i');
const TAIL_TIME = new RegExp(String.raw`[\s,]+every\s+(?:(\d+(?:\.\d+)?)\s*${UNIT_WORD}|(?:an?\s+)?(second|minute|hour|day))\s*[.!]?$`, 'i');
const secsOf = (m) => Math.round(Number(m[1] ?? 1) * UNIT[(m[2] ?? m[3])[0].toLowerCase()]);

// What follows /loop: [debug|test|web] [10m] [message] [every 10 minutes]. The time comes first or
// last ("every …"), in short or long words. A kind alone uses its ready-made message; a debugging
// loop with no time runs until its tests pass; any other loop with no time paces itself.
export function parseLoop(text, { min = minSecs() } = {}) {
  let rest = String(text ?? '').trim();
  let kind = null;
  let m = /^(debug|tests?|web)\b\s*/i.exec(rest);
  if (m) { kind = m[1].toLowerCase().replace(/^tests$/, 'test'); rest = rest.slice(m[0].length); }
  let every = null;
  m = LEAD_TIME.exec(rest) ?? TAIL_TIME.exec(rest);
  if (m) { every = secsOf(m); rest = `${rest.slice(0, m.index)}${rest.slice(m.index + m[0].length)}`; }
  let message = rest.trim();
  let name = null;
  if (!message) {
    if (kind && PRESET[kind]) { message = PRESET[kind]; name = PRESET_NAME[kind]; }
    else return { error: kind === 'web' ? 'A web loop needs to know what to look at: /loop web 30m read the Bun release page and tell me when there is a new version' : 'A loop needs a message: /loop 10m check the tests and say what fails' };
  }
  kind ??= guessKind(message);
  let note = '';
  if (every !== null && every < min) { note = ` (the shortest gap is ${everyWord(min)})`; every = min; }
  return { kind, every, until: kind === 'debug' && every === null, message, name: name ?? nameOf(message), note };
}

// The lines a run's message ends with: which run this is, how the last one ended, and the two
// words a run can end the loop or set its own pace with.
export function loopNote(loop, n, { now = Date.now() } = {}) {
  const last = loop.runs.at(-1);
  const at = (t) => new Date(t).toTimeString().slice(0, 5);
  const parts = [`Run ${n} of a loop that ${loop.until ? 'runs until its job is done' : loop.every ? `runs every ${everyWord(loop.every)}` : 'paces itself'}; each run is a fresh conversation.`];
  if (last) parts.push(`The last run, at ${at(last.startedAt)}, ended: ${String(last.said || last.summary || 'with nothing said').replace(/\s+/g, ' ').slice(0, 400)}`);
  parts.push('If the whole job is finished for good and no further run is needed, end your answer with the line: LOOP DONE');
  if (!loop.every && !loop.until) parts.push('You may set when the next run starts by ending with the line: NEXT RUN IN <minutes> MIN');
  return `(${parts.join(' ')})`;
}
// What a run's last words say about the loop: done for good, and when to run next.
export function readEnding(text) {
  const t = String(text ?? '');
  const next = /^\W*NEXT RUN IN (\d+(?:\.\d+)?)\s*MIN/im.exec(t);
  return { done: /^\W*LOOP DONE\W*$/im.test(t), nextSecs: next ? Math.min(3600, Math.max(60, Math.round(Number(next[1]) * 60))) : null, said: t.replace(/^\W*(LOOP DONE|NEXT RUN IN [\d.]+\s*MIN\w*)\W*$/gim, '').trim() };
}
// One line about how a run ended, for the board.
export function summaryOf(said, reason) {
  const t = String(said ?? '').replace(/[*`#>]/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = t.find((l) => /[a-z]/i.test(l)) ?? '';
  const one = line.length > 90 ? `${line.slice(0, 89)}…` : line;
  if (reason === 'done') return one || 'done, nothing said';
  const why = { interrupted: 'stopped', declined: 'you said no', error: 'it failed', steps: 'out of steps', stuck: 'stuck' }[reason] ?? `stopped (${reason})`;
  return one ? `${why}: ${one}` : why;
}

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
// spec: { folder, prompt, mode, url, slots, local, flows, allow, owner }. Answers { send, kill, on, pid }.
export function startRun(spec, { self = selfCommand(), env = process.env } = {}) {
  const args = ['-p', '--loop-events', '--mode', spec.mode ?? 'ask', ...(spec.url ? ['--url', spec.url, ...(spec.slots > 1 ? ['--slots', String(spec.slots)] : [])] : spec.local ? ['--local'] : []), ...(spec.flows === false ? ['--no-flows'] : [])];
  const child = spawn(self[0], [...self.slice(1), ...args], {
    cwd: spec.folder, stdio: ['pipe', 'pipe', 'pipe'],
    // The memory is read, never saved to, by a run nobody watches; what it costs counts under its window.
    env: { ...env, AGENTIC_LOOP_SPEC: JSON.stringify({ prompt: spec.prompt, allow: spec.allow ?? [] }), AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_SPEND_PID: String(spec.owner ?? process.pid), AGENTIC_OPEN: 'off' },
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
    kill() { try { child.stdin.write('{"t":"stop"}\n'); } catch {} setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 1500).unref?.(); },
  };
}

// ---- the window's side ---------------------------------------------------------------------------
// status() → { on, why, name, where, limit, mode, url, slots, local }: whether a run can start now
// (the model loaded, the window not answering), how many may run at once, and how a run reaches
// the model. spend() → what this window has spent on a paid service, in dollars.
export class Loops {
  constructor({ home = HOME, pid = process.pid, folder = process.cwd(), name = basename(process.cwd()), status = () => ({ on: true, limit: 1 }), spend = () => 0, start = startRun, now = () => Date.now(), onChange = () => {}, maxHours = MAX_HOURS, maxUsd = MAX_USD } = {}) {
    Object.assign(this, { home, pid, folder, name, status, spend, start, now, onChange, maxHours, maxUsd });
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
  // The oldest question waiting.
  get asking() { return [...this.needsYou].sort((a, b) => a.current.needs.since - b.current.needs.since)[0] ?? null; }
  say(l, kind, text, more = {}) { this.log.push({ at: this.now(), id: l?.id ?? null, kind, text, ...more }); if (this.log.length > 300) this.log.shift(); }
  changed() { this.dirty = true; this.onChange(); }
  line(l, run, kind, text, more = {}) { try { mkdirSync(dirOf(this.home, this.pid), { recursive: true, mode: 0o700 }); appendFileSync(runFile(this.home, this.pid, l.id, run.n), `${JSON.stringify({ at: this.now() - run.startedAt, kind, text, ...more })}\n`); } catch { /* the board shows less */ } run.lines = (run.lines ?? 0) + 1; }

  // /loop <text>: a new loop in this window's folder, in the mode it is in now.
  add(parsed, { folder = this.folder, mode = 'ask' } = {}) {
    const t = this.now();
    const l = { id: this.nextId++, kind: parsed.kind, name: parsed.name, message: parsed.message, every: parsed.every, until: parsed.until, folder, mode, state: 'waiting', nextAt: t + 1000, endsAt: t + this.maxHours * 3_600_000, created: t, runs: [], current: null, note: null, queued: false, pauseAfter: false, allowed: [], doneWhy: null, gap: null };
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
    const usd = Number(this.spend()) || 0;
    const hold = usd >= this.maxUsd ? `this window has spent $${usd.toFixed(2)} on its service: its loops wait` : !st.on ? (st.why || 'the model is off') : '';
    const running = () => this.loops.filter((l) => l.current && !l.current.needs).length;
    for (const l of [...this.loops].sort((a, b) => a.nextAt - b.nextAt)) {
      if (l.current || ['paused', 'done', 'stopped'].includes(l.state)) continue;
      if (t >= l.endsAt) { this.end(l, 'done', `ran for ${this.maxHours} hours`); continue; }
      if (hold) { if (l.state !== 'off' || l.offWhy !== hold) { l.state = 'off'; l.offWhy = hold; this.changed(); } continue; }
      if (l.state === 'off') { l.state = 'waiting'; l.offWhy = null; this.changed(); }
      if (t < l.nextAt) continue;
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
    const note = loopNote(l, run.n, { now: t });
    this.line(l, run, 'user', l.message);
    this.line(l, run, 'loopnote', note);
    let prompt = `${l.message}\n\n${note}`;
    if (l.note) { this.line(l, run, 'you', l.note); prompt = `${l.message}\n\n(A note from the user for this run: ${l.note})\n\n${note}`; l.note = null; }
    this.say(l, 'start', `run ${run.n}`, { n: run.n });
    let h;
    try { h = this.start({ folder: l.folder, prompt, mode: l.mode, url: st.url ?? null, slots: st.slots ?? 1, local: Boolean(st.local), flows: st.flows, allow: l.allowed, owner: this.pid }); }
    catch (e) { this.finish(l, run, { reason: 'error', final: `The run could not start: ${e.message}` }); return; }
    this.handles.set(l.id, h);
    h.on((ev) => this.onEvent(l, run, ev));
    this.changed();
  }

  onEvent(l, run, ev) {
    if (this.closed || l.current !== run) return;
    if (ev.t === 'tool') { const failed = ev.test && ev.failed !== undefined ? Boolean(ev.failed) : Boolean(ev.error); this.line(l, run, failed ? 'fail' : 'tool', `${ev.label}(${ev.arg ?? ''})`, { test: Boolean(ev.test) }); if (ev.test && ev.failed !== undefined) run.tests = { ok: !failed }; }
    else if (ev.t === 'note') this.line(l, run, 'note', ev.text);
    else if (ev.t === 'text') this.line(l, run, 'text', ev.text);
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
    // A run is green when it finished and the tests it ran last passed; a stop or a miss is red.
    const tests = ev.tests ?? run.tests ?? null;
    run.ok = ev.reason === 'done' && (tests ? tests.ok : true);
    run.summary = run.stopped ? 'stopped by you' : summaryOf(end.said, ev.reason);
    run.said = end.said.slice(0, 600);
    run.needs = null;
    l.runs.push({ n: run.n, startedAt: run.startedAt, endedAt: run.endedAt, ok: run.ok, summary: run.summary, said: run.said, lines: run.lines });
    if (l.runs.length > 60) l.runs.shift();
    l.current = null;
    this.say(l, 'end', run.summary, { ok: run.ok, n: run.n, ms: run.endedAt - run.startedAt });
    if (l.state === 'stopped') { this.changed(); return; }
    // The job is done: the run said so, or a debugging loop's tests pass.
    if (ev.reason === 'done' && (end.done || (l.until && tests?.ok))) { this.end(l, 'done', end.done ? 'the run said its job is done' : `the tests pass after ${run.n} run${run.n === 1 ? '' : 's'}`); return; }
    l.gap = end.nextSecs;
    l.nextAt = run.endedAt + (l.every ?? (l.until ? RETRY_SECS : end.nextSecs ?? SELF_SECS)) * 1000;
    if (l.pauseAfter) { l.pauseAfter = false; l.state = 'paused'; this.say(l, 'state', 'paused'); }
    else l.state = 'waiting';
    this.changed();
  }
  end(l, state, why) { l.state = state; l.doneWhy = why; l.queued = false; this.say(l, 'state', state === 'done' ? `the loop ends: ${why}` : why); this.changed(); }

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
  // A note to a loop: its run reads it when the model's turn ends; between runs, the next run starts with it.
  steer(id, text) {
    const l = this.loop(id);
    const note = String(text ?? '').trim();
    if (!l || !note) return null;
    this.say(l, 'you', note);
    if (['done', 'stopped'].includes(l.state)) { this.changed(); return `${l.name} has ended: nothing will read the note`; }
    if (l.current) {
      this.line(l, l.current, 'you', note);
      this.handles.get(id)?.send({ t: 'note', text: note });
      this.changed();
      return `Sent to ${l.name}: it reads it when its turn ends`;
    }
    l.note = l.note ? `${l.note}\n${note}` : note;
    this.changed();
    return `${l.name} starts its next run with your note`;
  }
  // What was typed in the board's chat box: /loop makes a loop, an open question gets it as its
  // answer, anything else is a note to the picked loop. Answers a line to show.
  typed(text, selId, { mode = 'ask' } = {}) {
    const t = String(text ?? '').trim();
    if (!t) return null;
    const m = /^\/loops?\b\s*(.*)$/is.exec(t);
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
    l.nextAt = this.now();
    this.changed();
    this.tick();
    return true;
  }
  pause(id) {
    const l = this.loop(id);
    if (!l || ['done', 'stopped'].includes(l.state)) return false;
    if (l.state === 'paused' || l.pauseAfter) { l.pauseAfter = false; if (l.state === 'paused') { l.state = 'waiting'; l.nextAt = Math.max(l.nextAt, this.now() + 1000); } this.say(l, 'state', 'going again'); }
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
    this.say(l, 'state', 'stopped by you');
    if (run) { run.stopped = true; this.line(l, run, 'note', 'Stopped by you.'); this.handles.get(id)?.kill(); this.finish(l, run, { reason: 'interrupted', final: '' }); }
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

  // ---- the board ----
  readCommands() {
    let files = [];
    try { files = readdirSync(cmdDir(this.home, this.pid)).filter((f) => f.endsWith('.json')).sort(); } catch { return; }
    for (const f of files) {
      const p = join(cmdDir(this.home, this.pid), f);
      let c = null;
      try { c = JSON.parse(readFileSync(p, 'utf8')); } catch {}
      try { rmSync(p, { force: true }); } catch {}
      if (!c) continue;
      let r = null;
      if (c.op === 'answer') this.answer(c.id, c.choice, c.text ?? null);
      else if (c.op === 'typed') r = this.typed(c.text, c.id);
      else if (c.op === 'run') this.runNow(c.id);
      else if (c.op === 'pause') this.pause(c.id);
      else if (c.op === 'stop') this.stop(c.id);
      else if (c.op === 'every') this.setEvery(c.id, c.secs);
      // What the window says back, for the board's own line (said: the command's stamp).
      if (r) { this.reply = { at: this.now(), stamp: c.stamp ?? null, text: typeof r === 'object' ? r.text : r, made: typeof r === 'object' ? r.made : null }; this.changed(); }
    }
  }
  snapshot() {
    const st = this.last = this.status() ?? this.last;
    return {
      v: 1, pid: this.pid, name: this.name, folder: tilde(this.folder), started: this.started, updated: this.now(),
      model: { name: st.name ?? 'the model', on: Boolean(st.on), why: st.why ?? '', where: st.where ?? 'this Mac', limit: Math.max(1, st.limit ?? 1) },
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

// One line about a loop, for the window's own notes (/loop alone lists them).
export function describe(l, now = Date.now()) {
  const pace = l.until ? 'until its job is done' : l.every ? `every ${everyWord(l.every)}` : 'at its own pace';
  const left = Math.max(0, Math.round((l.nextAt - now) / 1000));
  const state = l.current?.needs ? 'needs you' : l.current ? `running (run ${l.current.n})` : l.state === 'paused' ? 'paused' : l.state === 'off' ? `waits: ${l.offWhy ?? 'the model is off'}` : l.state === 'done' ? `ended: ${l.doneWhy}` : l.state === 'stopped' ? 'stopped' : l.queued ? 'next in line' : `next run in ${left < 90 ? `${left}s` : `${Math.round(left / 60)}m`}`;
  return `${l.kind} · ${pace} · ${state}`;
}
