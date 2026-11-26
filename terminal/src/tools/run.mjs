// Run tool: one shell command in the project folder, output capped so it
// cannot flood a small context window. Commands run inside the macOS
// sandbox (sandbox.mjs): they cannot read your home folder or write outside
// `cwd`. Pass sandbox: false for a command you typed yourself (! in the app),
// sandbox: { readOnly: [...] } for more folders it may read, or sandbox: { open: true }
// in Bypass permissions (any folder and the internet; sandbox.mjs).
import { spawn, execFileSync } from 'node:child_process';
import { sandboxAvailable, sandboxed, fenceHint, SHELL } from './sandbox.mjs';
import { prepareLooks } from './proclook.mjs';

// The lines of a test run with its passing tests folded into one line (squeeze: a model on another
// machine, 3 Oct 2026): node --test writes TAP when its output is not a terminal, five lines a passing
// test, so a long run filled the output with them and the failures were cut. Failing tests, what the
// tests printed and the totals stay whole. Fewer than SQUEEZE_FROM passing lines: as it was.
export const SQUEEZE_FROM = 8;
const PASSED = /^\s*(?:✔|✓|√|\(pass\)\s)|^\s*ok \d+ - (?!.*#\s*(?:SKIP|TODO)\b)|\sPASSED\b/;
export function squeezeTests(lines) {
  if (lines.filter((l) => PASSED.test(l)).length < SQUEEZE_FROM) return lines;
  const out = [];
  let folded = 0;
  let mark = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!PASSED.test(l)) { out.push(l); continue; }
    folded++;
    const tap = /^(\s*)ok \d+ - (.*)$/.exec(l);
    if (tap) {
      // Its "# Subtest:" line before it, and its YAML block after it (---, the lines under it, ...).
      if (out.length && out.at(-1).trim() === `# Subtest: ${tap[2].trim()}`) out.pop();
      if (/^\s*---\s*$/.test(lines[i + 1] ?? '')) { i++; while (i + 1 < lines.length && !/^\s*\.\.\.\s*$/.test(lines[i])) i++; }
    }
    if (mark < 0) { mark = out.length; out.push(''); }
  }
  out[mark] = `(${folded} passing ${folded === 1 ? 'test' : 'tests'} not shown)`;
  return out;
}

// The names of keys, tokens and passwords in an environment; SSH_AUTH_SOCK (git over ssh) is a socket, not a key.
const SECRET_NAME = /(?:^|_)(?:API_?KEY|KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASSWD|CREDENTIALS?|PRIVATE)(?:_|$)|^ANTHROPIC_|^AGENTIC_.*KEY/i;
const KEEP_NAMES = new Set(['SSH_AUTH_SOCK', 'GPG_AGENT_INFO', 'KEYCHAIN_PATH']);
export const secretName = (name) => SECRET_NAME.test(name) && !KEEP_NAMES.has(name);
export function withoutSecrets(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!secretName(k)) out[k] = v;
  return out;
}

// The shell a command runs in, in its own process group, so stopping it stops everything it
// started (npm → node → test workers), not just the shell. Also the background jobs' (jobs.mjs).
// Each command carries a mark of its own in its environment (COMMAND_MARK), and so does every program
// it starts, even one that left its process group: see signalCommand.
let commands = 0;
const COMMAND_MARK = 'AGENTIC_COMMAND';
// look: the stand-ins for the ps and top a fenced command names (looksFor, proclook.mjs), first on its PATH; removed when
// the command's shell has gone.
export function startShell(command, { cwd, sandbox = {}, look = null } = {}) {
  const mark = `${process.pid}-${++commands}`;
  // A command the model runs gets no keys (18 Nov 2026, the audit: every command had the whole environment, the
  // Claude and service keys included, and "echo $ANTHROPIC_API_KEY" put one in the conversation). One you type
  // yourself (sandbox: false, "!" in the app) keeps everything, as your shell does.
  const env = { ...(sandbox === false ? process.env : withoutSecrets(process.env)), FORCE_COLOR: '0', NO_COLOR: '1', CI: '1', [COMMAND_MARK]: mark };
  delete env.AGENTIC_RESTART_FILE; // where /update leaves its restart: the app's alone
  const fenced = sandbox !== false && sandboxAvailable();
  if (fenced && look) env.PATH = `${look.path}:${env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'}`;
  const child = fenced
    ? spawn(...sandboxed(command, cwd, sandbox), { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env })
    : spawn(command, { cwd, shell: SHELL, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  if (look) { child.once('close', look.done); child.once('error', look.done); }
  return { child, fenced, mark };
}
// The ps and top a command names, run by the app for it when it runs inside the sandbox, where macOS never starts them
// (proclook.mjs). null for a command run as you are (sandbox: false) or with no ps or top in it.
export const looksFor = (command, sandbox = {}) => (sandbox !== false && sandboxAvailable() ? prepareLooks(command).catch(() => null) : Promise.resolve(null));
// A signal to the command's whole process group (the shell alone when there is none).
function signalGroup(child, sig) { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } }

// This user's programs that carry a command's mark, and what they started: [pid]. A program in a terminal
// of its own (script, a test's pseudo-terminal) or one started with setsid is outside the command's group,
// and stopping the group missed it (18 Oct 2026: a test run cut off at the 2-minute limit left the apps
// and stand-in model servers of its tests running). ps -E shows the environment of every program but
// Apple's own, which are reached as children. The app runs outside the sandbox, where ps can start.
export function markedProcesses(mark, { rows = psRows } = {}) {
  if (!mark) return [];
  const tag = ` ${COMMAND_MARK}=${mark}`;
  const all = rows();
  const out = [];
  for (const r of all) {
    const i = r.text.indexOf(tag);
    if (i >= 0 && /^(\s|$)/.test(r.text.slice(i + tag.length, i + tag.length + 1)) && r.pid !== process.pid) out.push(r.pid);
  }
  for (let i = 0; i < out.length; i++) for (const r of all) if (r.ppid === out[i] && r.pid !== process.pid && !out.includes(r.pid)) out.push(r.pid);
  return out;
}
function psRows() {
  try {
    return execFileSync('ps', ['-E', '-o', 'pid=,ppid=,command=', '-u', String(process.getuid())], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5000 })
      .split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), text: m[3] }));
  } catch { return []; }
}
// A command stopped before its end (its time limit, esc, a job stopped): its group and every program with its
// mark. `seen` keeps the ones found at the first signal, for the second (they may have left their parents by then).
export function signalCommand(child, mark, sig, seen = []) {
  for (const pid of markedProcesses(mark)) if (!seen.includes(pid)) seen.push(pid);
  signalGroup(child, sig);
  for (const pid of seen) { try { process.kill(pid, sig); } catch {} }
}

// The first and last OUT_KEEP characters of a stream, with a line for what was left out between them.
const OUT_KEEP = 2_500_000;
export function keepEnds(keep = OUT_KEEP) {
  let head = '';
  let tail = '';
  let dropped = 0;
  return {
    add(d) {
      const t = String(d);
      if (head.length < keep) { const room = keep - head.length; head += t.slice(0, room); if (t.length <= room) return; tail += t.slice(room); }
      else tail += t;
      if (tail.length > keep * 2) { dropped += tail.length - keep; tail = tail.slice(-keep); }
    },
    text() {
      if (tail.length > keep) { dropped += tail.length - keep; tail = tail.slice(-keep); }
      return dropped ? `${head}\n… ${dropped.toLocaleString('en-US')} characters of output left out …\n${tail}` : head + tail;
    },
  };
}

export async function runCommand(command, { cwd, timeoutMs = 120_000, maxLines = 60, signal, sandbox = {}, squeeze = false } = {}) {
  const look = await looksFor(command, sandbox);
  return new Promise((resolve) => {
    const started = Date.now();
    const { child, fenced, mark } = startShell(command, { cwd, sandbox, look });
    let timedOut = false;
    let done = false;
    let force = null;
    const seen = [];
    const stopAll = (sig) => signalCommand(child, mark, sig, seen);
    const stop = () => {
      stopAll('SIGTERM');
      // Whatever ignores SIGTERM is killed; a process that left the group and
      // still holds the output open no longer holds up the answer.
      force ??= setTimeout(() => { stopAll('SIGKILL'); setTimeout(() => finish(null), 1000).unref(); }, 2000);
      force.unref?.();
    };
    const onAbort = () => stop();
    if (signal?.aborted) queueMicrotask(stop);
    signal?.addEventListener('abort', onAbort, { once: true });
    // What it printed, kept to its first and last OUT_KEEP characters (18 Nov 2026, the audit: a command that printed
    // a gigabyte kept all of it in memory beside the model); decoded as UTF-8 across chunks, so a character split
    // between two chunks is not two broken ones.
    const kept = keepEnds();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => kept.add(d));
    child.stderr.on('data', (d) => kept.add(d));
    let out = '';
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(force);
      signal?.removeEventListener('abort', onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      out = kept.text();
      if (fenced) out += fenceHint(out, { open: Boolean(sandbox?.open), self: Boolean(sandbox?.self), command }); // also when a pipe hid the error code
      const all = out.replace(/\n$/, '').split('\n');
      const lines = squeeze ? squeezeTests(all) : all;
      const cut = lines.length > maxLines;
      resolve({
        code,
        timedOut,
        fenced,
        ms: Date.now() - started,
        lines: cut ? [...lines.slice(0, maxLines / 2), `… ${lines.length - maxLines} lines cut …`, ...lines.slice(-maxLines / 2)] : lines,
        // What was cut is kept whole (up to 5 MB) for whoever wants to save it (agent/scripts.mjs saveOutput).
        ...(cut && out.length <= 5e6 ? { whole: out } : {}),
      });
    };
    child.on('close', (code) => finish(code));
    child.on('error', (e) => { kept.add(String(e.message ?? e)); finish(1); });
  });
}
