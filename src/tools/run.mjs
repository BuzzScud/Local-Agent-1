// Run tool: one shell command in the project folder, output capped so it
// cannot flood a small context window.
import { spawn } from 'node:child_process';

export function runCommand(command, { cwd, timeoutMs = 120_000, maxLines = 60, signal } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Its own process group, so stopping it stops everything it started
    // (npm → node → test workers), not just the shell.
    const child = spawn(command, { cwd, shell: '/bin/zsh', detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' } });
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
      const lines = out.replace(/\n$/, '').split('\n');
      const cut = lines.length > maxLines;
      resolve({
        code,
        timedOut,
        ms: Date.now() - started,
        lines: cut ? [...lines.slice(0, maxLines / 2), `… ${lines.length - maxLines} lines cut …`, ...lines.slice(-maxLines / 2)] : lines,
      });
    };
    child.on('close', (code) => finish(code));
    child.on('error', (e) => { out += String(e.message ?? e); finish(1); });
  });
}
