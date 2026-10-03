// The /agents screen (agents-tree.mjs): every state of a whole pretend run drawn at the window
// sizes it meets, each frame exactly the window, and the parts that must be there.
import { test, expect } from 'bun:test';
import { AgentsRun } from '../src/agent/agents-run.mjs';
import { demoDriver } from '../src/agent/agents-demo.mjs';
import { drawTree, agentsLine, rowWidth } from '../src/app/agents-tree.mjs';
import { growTo, resizeSeq, canResize } from '../src/app/agents-window.mjs';

const text = (rows) => rows.map((r) => r.map((p) => p.t).join('')).join('\n');
const SIZES = [[112, 58], [150, 54], [90, 45], [100, 39], [80, 23]];

test('a whole run, every state at five sizes: each frame is exactly the window; the tree, the rail, the log and the status line are there', async () => {
  const run = new AgentsRun({ request: 'build a Kepler solver: where an orbit is at time t', driver: demoDriver({ beat: 1 }) });
  const seen = { frames: 0, gate: null, miss: null };
  run.on('state', (s) => {
    for (const [cols, rows] of SIZES) {
      const out = drawTree(s, { cols, rows, now: Date.now() });
      seen.frames++;
      expect(out).toHaveLength(rows);
      for (const r of out) expect(rowWidth(r)).toBe(cols);
      const t = text(out);
      expect(t).toContain('stage [');
      if (rows >= 38) {
        expect(t).toContain('main session');
        expect(t).toContain('hand off to helpers');
        if (cols >= 88) expect(t).toContain('SECOND OPINION');
        else expect(t).not.toContain('SECOND OPINION');
      } else expect(t).toContain('2nd opinion ·');
      if (s.gate && !seen.gate && s.gate.kind === 'plan' && cols === 112) seen.gate = t;
      if (s.stage === 2 && s.nodes[1] === 'miss' && cols === 112 && !seen.miss) seen.miss = t;
    }
    if (s.gate && !s.gate.seen) { s.gate.seen = true; setTimeout(() => run.answer(0), 0); }
  });
  const end = await run.start();
  expect(seen.frames).toBeGreaterThan(500);
  // the plan's question box, over the log: its options and the second opinion's advice
  expect(seen.gate).toContain('▶ Approve the plan');
  expect(seen.gate).toContain('The second opinion says: the plan has no e = 0 case');
  expect(seen.gate).toContain('› 1. Yes, build it');
  // a miss: the green bar orange with what failed, the rail lit after a miss
  expect(seen.miss).toContain('green    ████████████  ✗ ArithmeticError: |E − …'); // cut to the loop's box
  expect(seen.miss).toContain('tries 2');
  const final = text(drawTree(end, { cols: 112, rows: 58, now: Date.now() }));
  expect(final).toContain('GO ·');
  expect(final).toContain('rollback: /rewind · nothing committed');
  expect(final).toContain('code-reviewer');
  expect(final).toContain('esc gives the window back');
  // the chat's one line while it runs behind it
  expect(text([agentsLine({ ...end, verdict: null, stage: 2, item: 2, items: end.items, active: [1], gate: null }, 0)])).toContain('/agents · Build · task 3/7 · GREEN · /agents opens it');
});

test('the window: grows to 112 × 59 keeping a bigger side, only in Terminal or iTerm2, never in tmux or over SSH', () => {
  expect(growTo({ columns: 80, rows: 24 })).toEqual([112, 59]);
  expect(growTo({ columns: 150, rows: 55 })).toEqual([150, 59]);
  expect(growTo({ columns: 120, rows: 60 })).toBeNull();
  expect(resizeSeq(112, 59)).toBe('\x1b[8;59;112t');
  const tty = { isTTY: true };
  expect(canResize({ TERM_PROGRAM: 'Apple_Terminal' }, tty)).toBe(true);
  expect(canResize({ TERM_PROGRAM: 'iTerm.app' }, tty)).toBe(true);
  expect(canResize({ TERM_PROGRAM: 'vscode' }, tty)).toBe(false);
  expect(canResize({ TERM_PROGRAM: 'Apple_Terminal', TMUX: '/tmp/t' }, tty)).toBe(false);
  expect(canResize({ TERM_PROGRAM: 'Apple_Terminal', SSH_TTY: '/dev/ttys1' }, tty)).toBe(false);
  expect(canResize({ TERM_PROGRAM: 'Apple_Terminal', AGENTIC_AGENTS_RESIZE: 'off' }, tty)).toBe(false);
  expect(canResize({ TERM_PROGRAM: 'Apple_Terminal' }, { isTTY: false })).toBe(false);
});
