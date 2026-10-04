// Background commands (Bash with background: true; 3 Oct 2026, the owner's pick, as Claude Code
// has them): a dev server, a watcher or a long test run keeps going while the model works on.
// Each gets an id (job1, job2…); the Jobs tool reads what it printed since the model last looked,
// or stops it. One that ends by itself is said to the model: with its next step while a reply
// runs, or as a message of its own once the reply is over (agent.mjs jobEnded). Jobs stop when
// the window closes (stopAll, and the exit hook below for a quit that skips it).
import { startShell, signalGroup } from './run.mjs';
import { fenceHint } from './sandbox.mjs';

// Running at once, at most: a fifth is refused with the list.
export const MAX_RUNNING = 4;
// What a job keeps of its output, in characters (the newest; what fell off is counted).
const KEEP_CHARS = 200_000;
// The lines one look shows at most: the first and last halves of what is new.
const LOOK_LINES = 80;
// How long a start waits for its first lines (and for a command that ends at once).
const FIRST_MS = 1500;

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export const took = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

// The lines of text, the first and last halves when there are more than max.
export function capLines(text, max = LOOK_LINES) {
  const lines = text.replace(ANSI, '').replace(/\r(?!\n)/g, '\n').replace(/\n$/, '').split('\n');
  if (!text) return [];
  return lines.length > max ? [...lines.slice(0, max / 2), `… ${lines.length - max} lines not shown …`, ...lines.slice(-max / 2)] : lines;
}

const live = new Set(); // every Jobs with something running, for the exit hook
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  // A quit that never called stopAll (a crash, process.exit) still takes its jobs with it.
  process.on('exit', () => { for (const jobs of live) jobs.stopAll({ now: true }); });
}

export class Jobs {
  // onEnd(job): a job ended (by itself, or stopped: job.stopped says by whom).
  constructor({ onEnd = null, firstMs = FIRST_MS } = {}) {
    this.onEnd = onEnd;
    this.firstMs = firstMs;
    this.all = [];
    this.n = 0;
  }

  running() { return this.all.filter((j) => !j.ended); }

  // id as the model writes it: "job2", "2", 2, "Job 2".
  get(id) {
    const n = Number(String(id ?? '').replace(/^\s*job\s*/i, ''));
    return Number.isInteger(n) ? this.all.find((j) => j.n === n) ?? null : null;
  }

  // Starts command in the background: { job } or { error }. Resolves once its first lines are
  // in (FIRST_MS), or when it ended before that.
  async start(command, { cwd, sandbox = {}, description = '', firstMs = this.firstMs } = {}) {
    const busy = this.running();
    if (busy.length >= MAX_RUNNING) return { error: `${busy.length} background jobs are running already, the most there may be: ${busy.map((j) => j.id).join(', ')}. Stop one with Jobs (its id and "stop": true) first, or run this one without background.` };
    const { child, fenced } = startShell(command, { cwd, sandbox });
    const n = ++this.n;
    const job = { n, id: `job${n}`, command, description, cwd, pid: child.pid, started: Date.now(), ended: null, code: null, out: '', seen: 0, dropped: 0, stopped: null, fenced, child };
    this.all.push(job);
    live.add(this);
    hookExit();
    const take = (d) => {
      job.out += d;
      if (job.out.length > KEEP_CHARS) {
        const cut = job.out.length - KEEP_CHARS;
        job.out = job.out.slice(cut);
        job.seen = Math.max(0, job.seen - cut);
        job.dropped += cut;
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const ended = new Promise((resolve) => {
      const end = (code) => {
        if (job.ended) return;
        job.ended = Date.now();
        job.code = code;
        clearTimeout(job.force);
        if (fenced) job.out += fenceHint(job.out, { open: Boolean(sandbox?.open), command });
        if (!this.running().length) live.delete(this);
        resolve();
        this.onEnd?.(job);
      };
      child.on('close', (code, sig) => end(code ?? (sig ? 128 : null)));
      child.on('error', (e) => { job.out += String(e.message ?? e); end(1); });
    });
    await Promise.race([ended, new Promise((r) => setTimeout(r, firstMs).unref?.())]);
    return { job };
  }

  // What job printed since the last look (and marks it seen): { lines, dropped }.
  look(job, max = LOOK_LINES) {
    const fresh = job.out.slice(job.seen);
    job.seen = job.out.length;
    const dropped = job.dropped - (job.droppedSeen ?? 0);
    job.droppedSeen = job.dropped;
    return { lines: capLines(fresh, max), dropped };
  }

  // The last lines job printed (marks them seen).
  tail(job, max = 20) {
    job.seen = job.out.length;
    return capLines(job.out, max * 2).slice(-max);
  }

  // Stops job and everything it started: SIGTERM, then SIGKILL after 2 s. by: who stopped it
  // ('model', 'you', 'quit'), kept so its end is not told to the model as news.
  stop(job, by = 'model') {
    if (job.ended) return false;
    job.stopped = by;
    signalGroup(job.child, 'SIGTERM');
    job.force = setTimeout(() => signalGroup(job.child, 'SIGKILL'), 2000);
    job.force.unref?.();
    return true;
  }

  stopAll({ now = false, by = 'quit' } = {}) {
    for (const job of this.running()) {
      job.stopped = by;
      signalGroup(job.child, now ? 'SIGKILL' : 'SIGTERM');
      if (!now) { job.force = setTimeout(() => signalGroup(job.child, 'SIGKILL'), 2000); job.force.unref?.(); }
    }
  }

  // One line about job: "job1 · running 2 min 5 s · npm run dev".
  line(job, now = Date.now()) {
    const state = !job.ended ? `running ${took(now - job.started)}`
      : job.stopped ? `stopped after ${took(job.ended - job.started)}`
        : `ended, exit code ${job.code ?? '?'} after ${took(job.ended - job.started)}`;
    return `${job.id} · ${state} · ${job.command}`;
  }
}
