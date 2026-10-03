// End-to-end, the real app in a pseudo-terminal (see app.test.mjs): /agents demo, the run engine on
// its pretend driver (no model), in a 112 × 59 window. The tree takes the window; the interview and
// the plan's one yes are answered with 1; esc shows the chat with one live line and esc opens the
// tree again; at GO the window goes back to the chat with the run's summary.
import { test, expect } from 'bun:test';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('/agents demo: the agent tree takes the window, asks its questions, builds test-first, and gives the window back at GO', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, cols: 112, rows: 59, env: { ...env, AGENTIC_AGENTS_DEMO_MS: '40', AGENTIC_AGENTS_RESIZE: 'off' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/agents demo' }, { key: 'enter' },
    { wait: 'SECOND OPINION' },
    { wait: 'Question 1 of 3' }, { sleep: 150 }, { snapshot: 'question' }, { type: '1' },
    { wait: 'Question 2 of 3' }, { type: '1' },
    { wait: 'Question 3 of 3' }, { type: '1' },
    { wait: 'Approve the plan', ms: 20_000 }, { sleep: 150 }, { snapshot: 'plan' }, { type: '1' },
    { wait: 'BUILD · task', ms: 20_000 }, { sleep: 200 }, { snapshot: 'build' },
    { key: 'esc' }, { wait: '/agents opens it' }, { sleep: 150 }, { snapshot: 'chat' },
    { key: 'esc' }, { wait: 'SECOND OPINION' },
    { wait: 'GO ·', ms: 45_000 }, { snapshot: 'go' },
    { waitGone: 'SECOND OPINION', ms: 15_000 }, { wait: '/agents GO' }, { sleep: 150 }, { snapshot: 'after' },
    ...quit,
  ], timeoutMs: 120_000 });
  await fake.close();
  // the interview: its question over the log, the answers, "type it" last
  expect(r.snapshots.question).toContain('AGENTIC CODER · /agents');
  expect(r.snapshots.question).toContain('? Question 1 of 3');
  expect(r.snapshots.question).toContain('What does it take in?');
  expect(r.snapshots.question).toContain('› 1. a, e, i, Ω, ω, M0 and a time t');
  expect(r.snapshots.question).toContain('3. Something else (type it)');
  // the plan's one yes, with the second opinion's advice
  expect(r.snapshots.plan).toContain('▶ Approve the plan');
  expect(r.snapshots.plan).toContain('The second opinion says: the plan has no e = 0 case');
  // building: the tree, the helpers, the log and the status line
  for (const part of ['main session', 'BUILD · task', 'hand off to helpers', 'explorer', 'worker', 'checker', 'session log', 'stage [Build']) expect(r.snapshots.build).toContain(part);
  // esc: the chat, with the run's one line above the prompt box
  expect(r.snapshots.chat).toContain('/agents · Build');
  expect(r.snapshots.chat).toContain('? for shortcuts');
  expect(r.snapshots.chat).not.toContain('SECOND OPINION');
  // GO, then the window is the chat's again, with what the run did
  expect(r.snapshots.go).toContain('rollback: /rewind · nothing committed');
  expect(r.snapshots.after).toContain('/agents GO');
  expect(r.snapshots.after).toContain('7 tasks done · a pretend run: nothing was written');
  expect(r.snapshots.after).not.toContain('SECOND OPINION');
  expect(r.code).toBe(0);
}, T * 2);
