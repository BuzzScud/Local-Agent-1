// The memory learns after a task (src/agent/lessons.mjs). By default it ASKS
// first (settings.json "memorySave": "ask"; "auto" saves on its own, as below):
//   - a little after a task ends, in the background, on the side slot; the
//     moment you send a message the save stops and waits for the next pause;
//   - when the window closes, a second look: every turn of the conversation
//     is read again, slowly, by a small process of its own (`coding
//     memory-save <job>`) after the window is gone (the user's pick, 30 Sep
//     2026, in place of the night review). Asking first, what it would save
//     is kept (a .pending file) and asked about at the next start in that
//     folder; saving on its own, it saves and leaves a line for the next start.
// AGENTIC_MEMORY_SAVE=off turns saving on its own off ("update memory" still
// works); "memory": false in settings.json turns the whole memory off.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { HOME, ModelServer, LINGER_SECS, stopIdleServers, modelById, MODELS, DEFAULT_MODEL, Embedder, embedderReady, readRecord } from '../../../models/index.mjs';
import { saveLessons, seedMemory, worthSaving, saveLine, proposeSave, applySave, shownOf, rememberDeclined } from '../agent/lessons.mjs';
import { memoryDirs, countDay, readFacts } from '../agent/facts.mjs';

const normText = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const memoryOn = (settings = {}) => settings.memory !== false && (process.env.AGENTIC_NO_MEMORY ?? process.env.BONSAI_NO_MEMORY) !== '1';
// How a save is made: 'ask' (the default, the user's pick on 28 Sep 2026),
// 'auto' (saves unasked) or 'off'. AGENTIC_MEMORY_SAVE wins over settings.json.
export function saveModeOf(settings = {}) {
  const env = process.env.AGENTIC_MEMORY_SAVE ?? process.env.BONSAI_MEMORY_SAVE;
  return env === 'on' || env === 'auto' ? 'auto' : env === 'ask' ? 'ask' : env === 'off' ? 'off' : (settings.memorySave ?? 'ask');
}
const savingOn = () => (process.env.AGENTIC_MEMORY_SAVE ?? process.env.BONSAI_MEMORY_SAVE) !== 'off';
const JOBS = () => join((process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? HOME, 'memory-jobs');
export const WAIT_MS = 10_000; // a pause this long after a task starts a save

// The conversation as the save reads it: what was said, without tool output.
const slim = (messages) => messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).slice(-40).map((m) => ({ role: m.role, content: m.content.slice(0, 1200) }));
// How this program starts itself again: the one-file app, or bun with the source.
const self = () => ((process.env.AGENTIC_BIN ?? process.env.BONSAI_BIN) ? [(process.env.AGENTIC_BIN ?? process.env.BONSAI_BIN)] : /(^|\/)bun$/.test(process.execPath) ? [process.execPath, process.argv[1]] : [process.execPath]);

export class AutoSave {
  // say(text): one dim line on the screen. sessions: where this folder's
  // earlier conversations are, for the first-use reading.
  constructor({ agent, ask = null, say = () => {}, waitMs = WAIT_MS, sessionsDir = null }) {
    Object.assign(this, { agent, ask, say, waitMs, sessionsDir, timer: null, abort: null, running: null });
  }

  get on() { return Boolean(this.agent.memory) && savingOn(); }
  // Mid-conversation saves need the side slot; without one (a shared or a
  // given server) the save waits for the window to close.
  get canRunNow() { return this.on && this.agent.slots?.side !== undefined && !this.agent.busy && !this.running; }

  schedule(ms = this.waitMs) {
    clearTimeout(this.timer);
    if (!this.on || !worthSaving(this.agent.lessons)) return;
    this.timer = setTimeout(() => { this.now().catch(() => {}); }, ms);
    this.timer.unref?.();
  }

  // You sent a message: the save steps aside. What it had not saved stays
  // for the next pause.
  cancel() {
    clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
  }

  now() {
    if (!this.canRunNow || !worthSaving(this.agent.lessons)) return Promise.resolve(null);
    const ac = new AbortController();
    this.abort = ac;
    const a = this.agent;
    this.running = saveLessons({ url: a.url, model: a.model, slot: a.slots.side, cwd: a.cwd, home: a.memory.home, lessons: a.lessons, messages: a.messages, signal: ac.signal, embedder: a.memory.embedder, confirm: this.ask })
      .then((out) => { if (out?.skipped) this.say('Not saved · /update memory saves what matters at any time'); const line = saveLine(out); if (line) this.say(line); return out; })
      .catch(() => null)
      .finally(() => { this.running = null; if (this.abort === ac) this.abort = null; });
    return this.running;
  }

  // At a start: what the last window's second look would save is asked
  // about first, then (first use here) what is already written is read.
  async atStart() {
    try { await this.askPending(); } catch { /* asked again at the next start */ }
    return this.seed();
  }

  // The proposals kept since a window here closed (asking first): Save
  // writes them, Skip drops them for good (never offered again), and when
  // the moment is wrong (you are typing) they wait for the next start.
  async askPending() {
    if (!this.agent.memory || !this.ask) return 0;
    let n = 0;
    for (const p of pendingFor(this.agent.cwd)) {
      // Saved meanwhile (by another window, or by hand): not asked about again.
      const dirs = memoryDirs(p.cwd, (p.home ?? this.agent.memory.home) ?? undefined);
      const facts = [...readFacts(dirs.you), ...readFacts(dirs.project)];
      const have = new Set(facts.map((f) => normText(f.text)));
      const ids = new Set(facts.map((f) => f.id));
      p.adds = p.adds.filter((a) => !have.has(normText(a.text)));
      p.drops = p.drops.filter((d) => ids.has(d.id));
      if (!p.adds.length && !p.drops.length) { rmSync(p.file, { force: true }); continue; }
      const ok = await this.ask({ ...shownOf(p), title: 'Learned last time, read again when the window closed', again: true });
      if (ok === 'later') break;
      rmSync(p.file, { force: true });
      const home = p.home ?? this.agent.memory.home;
      countDay(memoryDirs(p.cwd, home ?? undefined), { asked: 1, yes: ok ? 1 : 0, no: ok ? 0 : 1 });
      if (ok) {
        const out = applySave({ cwd: p.cwd, home, adds: p.adds, drops: p.drops }, { why: 'review at quit' });
        const line = saveLine(out);
        if (line) this.say(line);
        n += out.added.length;
      } else {
        rememberDeclined(memoryDirs(p.cwd, home ?? undefined), p.adds.map((a) => a.text));
        this.say('Not saved · it will not be offered again');
      }
    }
    return n;
  }

  // First use in this project: what is already written is read once.
  seed() {
    if (!this.canRunNow) return Promise.resolve(null);
    const ac = new AbortController();
    this.abort = ac;
    const a = this.agent;
    let record = [];
    try { record = readRecord().filter((r) => r.kind === 'bug' || r.kind === 'tasks'); } catch { /* no record yet */ }
    this.running = seedMemory({ url: a.url, model: a.model, slot: a.slots.side, cwd: a.cwd, home: a.memory.home, sessionsDir: this.sessionsDir, record, signal: ac.signal, embedder: a.memory.embedder, confirm: this.ask })
      .then((out) => { if (out?.added?.length) this.say(`Memory: ${out.added.length} fact${out.added.length === 1 ? '' : 's'} from what was done here before · /memory shows them`); return out; })
      .catch(() => null)
      .finally(() => { this.running = null; if (this.abort === ac) this.abort = null; });
    return this.running;
  }

  // The window closes: what is unsaved goes to a process of its own.
  // stopAfter: this window started the model, so it is stopped once the save
  // is done (as quitting did before). Answers true when a save was handed over.
  leave({ stopAfter = false } = {}) {
    this.cancel();
    const a = this.agent;
    // The second look reads every turn again, saved or not (practice turns never).
    if (!this.on || !worthSaving(a.lessons, { again: true }) || !a.url || /:0$/.test(a.url)) return false;
    try {
      mkdirSync(JOBS(), { recursive: true });
      const file = join(JOBS(), `${Date.now()}-${process.pid}.json`);
      // ask: with the window gone there is no one to ask, so what it would
      // save is kept for the next start (askPending).
      writeFileSync(file, JSON.stringify({ cwd: a.cwd, home: a.memory.home ?? null, url: a.url, model: a.model.id, slot: a.slots?.side ?? null, ctx: a.ctx, stopAfter, review: true, ask: Boolean(this.ask), lessons: a.lessons.filter((l) => !l.practice), messages: slim(a.messages) }));
      const [cmd, ...args] = self();
      spawn(cmd, [...args, 'memory-save', file], { detached: true, stdio: 'ignore', env: { ...process.env, AGENTIC_NO_UPDATE: '1' } }).unref();
      return true;
    } catch { return false; }
  }
}

// `coding memory-save <job>`: the save handed over by a window that closed.
// It keeps the model loaded while it works, leaves what it saved for the
// next start to show, and never prints: nobody is watching.
export async function runJob(file) {
  const job = JSON.parse(readFileSync(file, 'utf8'));
  const model = modelById(job.model) ?? MODELS[DEFAULT_MODEL];
  let server = null;
  let url = job.url;
  try {
    // The model this window left loaded: using it keeps it from being stopped.
    const s = new ModelServer(model);
    const st = await s.start({ ctx: job.ctx ?? 16384, lingerSecs: LINGER_SECS });
    server = s;
    url = s.url;
    if (st.slots < 2) job.slot = null;
  } catch { /* a server given by hand (--url) is used as it is */ }
  let out = null;
  let embedder = null;
  try {
    embedder = embedderReady() ? new Embedder() : null;
    out = await keepOrSave({ file, job, url, model, embedder });
  } finally {
    rmSync(file, { force: true });
    await embedder?.stop({ keep: true }).catch(() => {});
    await server?.stop({ keep: true }).catch(() => {});
    if (job.stopAfter) { try { stopIdleServers(); } catch { /* it stops on its own later */ } }
  }
  return out;
}

// The save a closed window handed over: the second look (job.review) or a
// plain save of the unsaved turns (an older job). Asking first (job.ask),
// what it would change is kept in a .pending file beside the job for the
// next start; otherwise it is saved and a .done line is left.
export async function keepOrSave({ file, job, url, model, embedder = null, why = 'save on quit' }) {
  const home = job.home ?? undefined;
  const p = await proposeSave({ url, model, slot: job.slot ?? undefined, cwd: job.cwd, home, lessons: job.lessons, messages: job.messages, embedder, review: Boolean(job.review) });
  if (job.ask) {
    if (p.adds.length || p.drops.length) writeFileSync(file.replace(/\.json$/, '.pending'), JSON.stringify({ at: new Date().toISOString(), cwd: job.cwd, home: job.home ?? null, adds: p.adds, drops: p.drops, secs: p.secs }));
    return { added: [], replaced: [], retired: [], refused: p.refused, kept: p.adds.length + p.drops.length, secs: p.secs };
  }
  const out = p.none ? { added: [], replaced: [], retired: [], refused: [] } : applySave({ cwd: job.cwd, home, adds: p.adds, drops: p.drops }, { why });
  writeFileSync(file.replace(/\.json$/, '.done'), JSON.stringify({ at: new Date().toISOString(), cwd: job.cwd, line: saveLine(out), added: out.added.length, replaced: out.replaced.length, retired: out.retired.length, secs: p.secs }));
  return { ...out, secs: p.secs };
}

// What a closed window's second look would save here, kept for the next
// start (asking first). One older than two weeks is let go.
const PENDING_DAYS = 14;
export function pendingFor(cwd) {
  const out = [];
  try {
    for (const f of readdirSync(JOBS()).filter((x) => x.endsWith('.pending')).sort()) {
      const file = join(JOBS(), f);
      let p;
      try { p = JSON.parse(readFileSync(file, 'utf8')); } catch { rmSync(file, { force: true }); continue; }
      if (Date.now() - Date.parse(p.at) > PENDING_DAYS * 86_400_000) { rmSync(file, { force: true }); continue; }
      if (p.cwd === cwd && (p.adds?.length || p.drops?.length)) out.push({ ...p, adds: p.adds ?? [], drops: p.drops ?? [], file });
    }
  } catch { /* nothing kept */ }
  return out;
}

// What the saves on quit did since the last start in this folder, once.
export function sinceLastTime(cwd) {
  const lines = [];
  try {
    for (const f of readdirSync(JOBS())) {
      const p = join(JOBS(), f);
      if (f.endsWith('.done')) {
        const d = JSON.parse(readFileSync(p, 'utf8'));
        if (d.cwd !== cwd) continue;
        if (d.line) lines.push(d.line.replace(/^Memory:/, 'Memory, saved when you last quit:'));
        rmSync(p, { force: true });
      } else if (f.endsWith('.json') && Date.now() - statSync(p).mtimeMs > 24 * 3600_000) rmSync(p, { force: true }); // a save that never ran
    }
  } catch { /* nothing handed over yet */ }
  return lines;
}
export const jobsDir = JOBS;
