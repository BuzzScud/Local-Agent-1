// Runs the real `bonsai` app in a pseudo-terminal, types keys into it, and
// reads the screen back through a headless terminal emulator — the way you
// would see it in Terminal.
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, openSync, writeSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import xterm from '@xterm/headless';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Terminal } = xterm;

export const KEYS = { tab: '\t', enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', shiftTab: '\x1b[Z', ctrlC: '\x03', ctrlL: '\x0c', ctrlO: '\x0f', backspace: '\x7f' };

// BONSAI_NO_OPEN: the app never opens a browser tab from a test (/help, /weights, /docs).
export async function runInPty({ args = [], cwd, cols = 155, rows = 43, steps = [], env = {}, timeoutMs = 30_000, bin = process.env.BONSAI_BIN }) {
  const out = join(cwd, '..', `pty-${Date.now()}.log`);
  const exe = bin ? `'${bin}'` : `bun ${join(root, 'src/cli.jsx')}`;
  const cmd = `stty cols ${cols} rows ${rows}; exec ${exe} ${args.map((a) => `'${a}'`).join(' ')}`;
  // script(1) needs a real pipe on stdin (Node's default is a socket, and on
  // macOS a FIFO counts as one too), so keys go FIFO → cat → pipe → script.
  const fifo = `${out}.in`;
  execFileSync('mkfifo', [fifo]);
  const q = (x) => `'${x.replace(/'/g, `'\\''`)}'`;
  const child = spawn('/bin/zsh', ['-c', `cat ${q(fifo)} | script -q -t 0 ${q(out)} /bin/zsh -c ${q(cmd)} > /dev/null 2>&1`], { detached: true, cwd, env: { ...process.env, TERM: 'xterm-256color', BONSAI_NO_OPEN: '1', ...env }, stdio: 'ignore' });
  const fd = openSync(fifo, 'w');
  const stdin = { write: (s) => { try { writeSync(fd, s); } catch {} } };
  const done = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  // The app runs under cat | script in its own process group; stopping only
  // the outer shell left the app (and a model server) running.
  const killAll = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const killer = setTimeout(killAll, timeoutMs);
  const read = () => { try { return readFileSync(out, 'latin1'); } catch { return ''; } };
  const waitFor = async (text, ms = 15_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await screenText(read(), cols, rows).then((s) => s.includes(text))) return true; await new Promise((r) => setTimeout(r, 100)); }
    throw new Error(`timed out waiting for "${text}"`);
  };
  const snapshots = {};
  const terms = {};
  let code;
  try {
    for (const s of steps) {
      // Wait until a text is no longer on the screen (a spinner or "Starting" gone).
      if (s.waitGone) { const t0 = Date.now(); while ((await screenText(read(), cols, rows)).includes(s.waitGone)) { if (Date.now() - t0 > (s.ms ?? 15_000)) throw new Error(`timed out waiting for "${s.waitGone}" to go`); await new Promise((r) => setTimeout(r, 200)); } }
      if (s.wait) await waitFor(s.wait, s.ms);
      if (s.snapshot) { snapshots[s.snapshot] = await screenText(read(), cols, rows); terms[s.snapshot] = await emulate(read(), cols, rows); }
      if (s.sleep) await new Promise((r) => setTimeout(r, s.sleep));
      if (s.fn) await s.fn({ text: await screenText(read(), cols, rows) }); // a check while the app runs, given the screen so far
      if (s.autoYes) {
        // Answer "Yes" to every question until the turn ends (the prompt box comes back).
        const t0 = Date.now();
        let asked = 0;
        let idle = 0;
        while (Date.now() - t0 < (s.ms ?? 600_000)) {
          const scr = await screenText(read(), cols, rows);
          const tail = scr.trimEnd().split('\n').slice(-12).join('\n');
          if (/Do you want to|Use this test to decide|Rename \S+ to \S+: \d+ use/.test(tail)) { if (s.snapshotFirstAsk && !asked) { snapshots.asking = scr; terms.asking = await emulate(read(), cols, rows); } asked++; stdin.write('\r'); await new Promise((r) => setTimeout(r, 1500)); continue; }
          // Done when the prompt box is back and nothing is working (no spinner).
          if (/\? for shortcuts/.test(tail) && !/esc to (stop|interrupt)/.test(tail)) { idle++; if (idle >= 3) break; } else idle = 0;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (s.type) for (const ch of s.type) { stdin.write(ch); await new Promise((r) => setTimeout(r, 8)); }
      if (s.key) stdin.write(KEYS[s.key] ?? s.key);
    }
  } finally {
    // The fifo closes first: cat sees its end and lets the pipeline finish,
    // so an app that quit on its own reports its real exit code here.
    try { closeSync(fd); } catch {}
    code = await Promise.race([done, new Promise((r) => setTimeout(() => r('timeout'), 8000))]);
    clearTimeout(killer);
    if (code === 'timeout') killAll();
    rmSync(fifo, { force: true });
  }
  const raw = read();
  rmSync(out, { force: true });
  // code: the app's own exit code, or 'timeout' when it had to be killed.
  return { raw, snapshots, terms, code, text: await screenText(raw, cols, rows), term: await emulate(raw, cols, rows) };
}

export function emulate(raw, cols, rows) {
  return new Promise((resolve) => {
    const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
    term.write(Buffer.from(raw, 'latin1'), () => resolve(term));
  });
}

export async function screenText(raw, cols, rows) {
  const term = await emulate(raw, cols, rows);
  const b = term.buffer.active;
  const lines = [];
  for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
  return lines.join('\n');
}
