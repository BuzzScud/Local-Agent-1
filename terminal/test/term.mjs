// A terminal window for the screen tests that can be resized while the app
// runs: the app runs in a real pty (test/pty-shim.py), and its output feeds a
// headless terminal that is resized at exactly the same point, reflowing what
// is already on screen the way Terminal does.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import xterm from '@xterm/headless';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Terminal } = xterm;
export const KEYS = { tab: '\t', enter: '\r', esc: '\x1b', up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D', shiftTab: '\x1b[Z', ctrlC: '\x03', ctrlL: '\x0c', ctrlO: '\x0f', backspace: '\x7f' };
const MARK = /\x00\x01RESIZE (\d+) (\d+)\x01\x00/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function openTerm({ cwd, cols = 155, rows = 43, args = [], env = {}, bin = process.env.AGENTIC_BIN }) {
  const argv = bin ? [bin, ...args] : ['bun', join(root, 'src/cli.jsx'), ...args];
  const child = spawn('python3', [join(root, 'test/pty-shim.py'), String(cols), String(rows), ...argv], { cwd, env: { ...process.env, TERM: 'xterm-256color', TERM_PROGRAM: 'Apple_Terminal', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_CLAUDE_NOTES: 'off', AGENTIC_TIPS: 'off', AGENTIC_BOT_WALK: 'off', AGENTIC_FETCH_EVERY: '0', ...env }, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
  const term = new Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true });
  let pending = Buffer.alloc(0);
  let raw = Buffer.alloc(0);
  let chain = Promise.resolve();
  let exited = false;
  const feed = (b) => { chain = chain.then(() => new Promise((res) => term.write(b, res))); };
  child.stdout.on('data', (d) => {
    raw = Buffer.concat([raw, d]);
    pending = Buffer.concat([pending, d]);
    for (;;) {
      const s = pending.toString('latin1');
      const m = MARK.exec(s);
      if (!m) {
        // Keep a possible half marker for the next chunk.
        const cut = s.lastIndexOf('\x00\x01');
        const keep = cut >= 0 && s.length - cut < 24 ? s.length - cut : 0;
        if (pending.length > keep) feed(pending.subarray(0, pending.length - keep));
        pending = pending.subarray(pending.length - keep);
        break;
      }
      feed(pending.subarray(0, m.index));
      const [c, r] = [Number(m[1]), Number(m[2])];
      chain = chain.then(() => term.resize(c, r));
      pending = pending.subarray(m.index + m[0].length);
    }
  });
  const done = new Promise((res) => child.on('exit', () => { exited = true; res(); }));
  const settle = () => chain;
  const lines = async ({ all = false } = {}) => {
    await settle();
    const b = term.buffer.active;
    const from = all ? 0 : b.viewportY;
    const to = all ? b.length : b.viewportY + term.rows;
    const out = [];
    for (let i = from; i < to; i++) { const l = b.getLine(i); out.push({ text: l?.translateToString(true) ?? '', wrapped: !!l?.isWrapped }); }
    return out;
  };
  const screen = async () => (await lines()).map((l) => l.text).join('\n');
  const t = {
    term, child, get exited() { return exited; }, raw: () => raw,
    get cols() { return term.cols; }, get rows() { return term.rows; },
    lines, screen, settle,
    type: async (s, gap = 6) => { for (const ch of s) { const b = Buffer.from(ch); child.stdin.write(`W ${b.length}\n`); child.stdin.write(b); await sleep(gap); } },
    key: (k) => { const b = Buffer.from(KEYS[k] ?? k); child.stdin.write(`W ${b.length}\n`); child.stdin.write(b); },
    resize: (c, r) => { child.stdin.write(`R ${c} ${r}\n`); },
    waitFor: async (what, ms = 15_000) => {
      const t0 = Date.now();
      const hit = (s) => (typeof what === 'string' ? s.includes(what) : what.test(s));
      while (Date.now() - t0 < ms) { if (hit(await screen())) return; await sleep(80); }
      throw new Error(`timed out waiting for ${what}\n${await screen()}`);
    },
    waitGone: async (what, ms = 15_000) => {
      const t0 = Date.now();
      const hit = (s) => (typeof what === 'string' ? s.includes(what) : what.test(s));
      while (Date.now() - t0 < ms) { if (!hit(await screen())) return; await sleep(80); }
      throw new Error(`timed out waiting for ${what} to go`);
    },
    // Output has stopped changing for `quiet` ms.
    idle: async (quiet = 400, ms = 10_000) => {
      const t0 = Date.now();
      let n = raw.length;
      let since = Date.now();
      while (Date.now() - t0 < ms) { await sleep(50); if (raw.length !== n) { n = raw.length; since = Date.now(); } else if (Date.now() - since >= quiet) return; }
    },
    close: async () => {
      try { child.stdin.end(); } catch {}
      await Promise.race([done, sleep(3000)]);
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      await settle();
    },
  };
  return t;
}
