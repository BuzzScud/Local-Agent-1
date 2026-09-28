// Run tool: one shell command in the project folder, output capped so it
// cannot flood a small context window. Commands run inside the macOS
// sandbox (sandbox.mjs): they cannot read your home folder or write outside
// `cwd`. Pass sandbox: false for a command you typed yourself (! in the app),
// or sandbox: { readOnly: [...] } for more folders it may read.
import { spawn } from 'node:child_process';
import { sandboxAvailable, sandboxed, fenceHint } from './sandbox.mjs';

export function runCommand(command, { cwd, timeoutMs = 120_000, maxLines = 60, signal, sandbox = {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Its own process group, so stopping it stops everything it started
    // (npm → node → test workers), not just the shell.
    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' };
    delete env.AGENTIC_RESTART_FILE; // where /update leaves its restart: the app's alone
    delete env.BONSAI_RESTART_FILE; // (its old name, set by an older launcher)
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
      const lines = out.replace(/\n$/, '').split('\n');
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
