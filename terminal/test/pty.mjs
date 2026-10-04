// Runs the real Agentic Coder app in a pseudo-terminal, types keys into it, and
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

export const KEYS = { tab: '\t', enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', shiftTab: '\x1b[Z', ctrlC: '\x03', ctrlL: '\x0c', ctrlO: '\x0f', ctrlP: '\x10', ctrlR: '\x12', ctrlT: '\x14', backspace: '\x7f' };

// AGENTIC_NO_OPEN: the app never opens a browser tab from a test (/help, /weights, /docs).
// AGENTIC_HUB_PORT=0: its hub takes any free port, never the real hub's 8757.
// AGENTIC_MEMORY: what the memory holds about you is kept beside the test's
// own files, never in the real ~/.agentic; and nothing is saved on its own
// unless the test asks for it (AGENTIC_MEMORY_SAVE). AGENTIC_TIPS=off: the line under the prompt box
// says "? for shortcuts" from the start, not a tip picked at random.
// AGENTIC_NEWS=off: the start page has no What's new, which would change with every commit.
// A key the terminal itself acts on while the app is not yet reading keys (ctrl+t, ctrl+c, ctrl+z…):
// not enter, tab or esc and its sequences, which wait in line like any letter.
const isControl = (k) => typeof k === 'string' && k.length === 1 && k.charCodeAt(0) < 32 && !'\t\r\n\x1b'.includes(k);

// The last lines of a screen that hold something, for a failure's message.
const screenEnd = (text, n = 10) => text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-n).map((l) => `  | ${l.slice(0, 150)}`).join('\n');

export async function runInPty({ args = [], cwd, cols = 155, rows = 43, steps = [], env = {}, timeoutMs = 30_000, bin = process.env.AGENTIC_BIN }) {
  const out = join(cwd, '..', `pty-${Date.now()}.log`);
  const exe = bin ? `'${bin}'` : `bun ${join(root, 'src/cli.jsx')}`;
  const cmd = `stty cols ${cols} rows ${rows}; exec ${exe} ${args.map((a) => `'${a}'`).join(' ')}`;
  // script(1) needs a real pipe on stdin (Node's default is a socket, and on
  // macOS a FIFO counts as one too), so keys go FIFO → cat → pipe → script.
  const fifo = `${out}.in`;
  execFileSync('mkfifo', [fifo]);
  const q = (x) => `'${x.replace(/'/g, `'\\''`)}'`;
  const child = spawn('/bin/zsh', ['-c', `cat ${q(fifo)} | script -q -t 0 ${q(out)} /bin/zsh -c ${q(cmd)} > /dev/null 2>&1`], { detached: true, cwd, env: { ...process.env, TERM: 'xterm-256color', AGENTIC_NO_OPEN: '1', AGENTIC_HUB_PORT: '0', AGENTIC_FETCH_EVERY: '0', AGENTIC_MEMORY: join(cwd, '..', 'memory-about-you'), AGENTIC_MEMORY_SAVE: 'off', AGENTIC_CLAUDE_NOTES: 'off', AGENTIC_TIPS: 'off', AGENTIC_NEWS: 'off', ...env }, stdio: 'ignore' });
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
    // What was on the screen instead, so a failure in a busy run explains itself.
    throw new Error(`timed out waiting for "${text}"; the screen ended with:\n${screenEnd(await screenText(read(), cols, rows))}`);
  };
  // A control key (ctrl+t, ctrl+c…) sent before the app reads keys itself is taken by the terminal, not
  // the app: the app draws its first screen a moment before it switches the terminal over, and on a busy
  // Mac a test that saw the screen pressed ctrl+t inside that moment; macOS printed its own status line
  // ("load: 3.32 cmd: bun … running") and the key was gone (3 Oct 2026). So the first control key waits
  // until the app's terminal is in the mode where keys go to the app (5 s at most, then it is sent anyway).
  let reads = false;
  let tty = null;
  const appTty = () => {
    try {
      const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,tty=,command='], { encoding: 'utf8' }).split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), tty: m[3] }));
      const under = new Set([child.pid]);
      for (let grew = true; grew;) { grew = false; for (const r of rows) if (under.has(r.ppid) && !under.has(r.pid)) { under.add(r.pid); grew = true; } }
      const t = rows.find((r) => under.has(r.pid) && r.tty !== '??')?.tty;
      return t ? `/dev/${t}` : null;
    } catch { return null; }
  };
  const readsKeys = async () => {
    const t0 = Date.now();
    while (!reads && Date.now() - t0 < 5000) {
      tty ??= appTty();
      try { if (tty && /(^|\s)-icanon\b/.test(execFileSync('stty', ['-f', tty, '-a'], { encoding: 'utf8' }))) { reads = true; break; } } catch { tty = null; }
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const snapshots = {};
  const terms = {};
  let code;
  try {
    for (const s of steps) {
      // Wait until a text is no longer on the screen (a spinner or "Starting" gone).
      if (s.waitGone) { const t0 = Date.now(); while ((await screenText(read(), cols, rows)).includes(s.waitGone)) { if (Date.now() - t0 > (s.ms ?? 15_000)) throw new Error(`timed out waiting for "${s.waitGone}" to go; the screen ended with:\n${screenEnd(await screenText(read(), cols, rows))}`); await new Promise((r) => setTimeout(r, 200)); } }
      if (s.wait) await waitFor(s.wait, s.ms);
      // has: the snapshot is taken at a moment the screen holds every one of these texts. The app clears and
      // redraws the screen now and then, and a snapshot taken in the middle of that holds half a screen
      // (3 Oct 2026: /btw's panel, read 150 ms after its answer came, was gone from one run in six on a busy Mac).
      if (s.snapshot) {
        let raw = read();
        let text = await screenText(raw, cols, rows);
        if (s.has) {
          const t0 = Date.now();
          while (!s.has.every((x) => text.includes(x)) && Date.now() - t0 < (s.ms ?? 5000)) { await new Promise((r) => setTimeout(r, 60)); raw = read(); text = await screenText(raw, cols, rows); }
        }
        snapshots[s.snapshot] = text;
        terms[s.snapshot] = await emulate(raw, cols, rows);
      }
      if (s.sleep) await new Promise((r) => setTimeout(r, s.sleep));
      // a check while the app runs, given the screen so far; write sends keys (or what a terminal would answer) worked out from that screen
      if (s.fn) await s.fn({ text: await screenText(read(), cols, rows), raw: read, screen: () => emulate(read(), cols, rows), write: stdin.write });
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
      if (s.key) { const k = KEYS[s.key] ?? s.key; if (isControl(k)) await readsKeys(); stdin.write(k); }
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
