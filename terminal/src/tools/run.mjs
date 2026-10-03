// Run tool: one shell command in the project folder, output capped so it
// cannot flood a small context window. Commands run inside the macOS
// sandbox (sandbox.mjs): they cannot read your home folder or write outside
// `cwd`. Pass sandbox: false for a command you typed yourself (! in the app),
// or sandbox: { readOnly: [...] } for more folders it may read.
import { spawn } from 'node:child_process';
import { sandboxAvailable, sandboxed, fenceHint } from './sandbox.mjs';

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

export function runCommand(command, { cwd, timeoutMs = 120_000, maxLines = 60, signal, sandbox = {}, squeeze = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Its own process group, so stopping it stops everything it started
    // (npm → node → test workers), not just the shell.
    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' };
    delete env.AGENTIC_RESTART_FILE; // where /update leaves its restart: the app's alone
    const fenced = sandbox !== false && sandboxAvailable();
    const child = fenced
      ? spawn(...sandboxed(command, cwd, sandbox), { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env })
      : spawn(command, { cwd, shell: '/bin/zsh', detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let timedOut = false;
    let done = false;
    let force = null;
    const stopAll = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} } };
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
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(force);
      signal?.removeEventListener('abort', onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      if (fenced) out += fenceHint(out); // also when a pipe hid the error code
      const all = out.replace(/\n$/, '').split('\n');
      const lines = squeeze ? squeezeTests(all) : all;
      const cut = lines.length > maxLines;
      resolve({
        code,
        timedOut,
        fenced,
        ms: Date.now() - started,
        lines: cut ? [...lines.slice(0, maxLines / 2), `… ${lines.length - maxLines} lines cut …`, ...lines.slice(-maxLines / 2)] : lines,
      });
    };
    child.on('close', (code) => finish(code));
    child.on('error', (e) => { out += String(e.message ?? e); finish(1); });
  });
}
