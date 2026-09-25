// Run tool: one shell command in the project folder, output capped so it
// cannot flood a small context window.
import { spawn } from 'node:child_process';

export function runCommand(command, { cwd, timeoutMs = 120_000, maxLines = 60, signal } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, { cwd, shell: '/bin/zsh', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' } });
    let timedOut = false;
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort, { once: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const lines = out.replace(/\n$/, '').split('\n');
      const cut = lines.length > maxLines;
      resolve({
        code,
        timedOut,
        ms: Date.now() - started,
        lines: cut ? [...lines.slice(0, maxLines / 2), `… ${lines.length - maxLines} lines cut …`, ...lines.slice(-maxLines / 2)] : lines,
      });
    });
  });
}
