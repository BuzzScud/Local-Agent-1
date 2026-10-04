// End-to-end, the real app in a pseudo-terminal: a command the model runs in the background
// (tools/jobs.mjs) ends after its reply, and the model is told and carries on by itself (the
// owner's pick, 3 Oct 2026, as Claude Code does); /jobs lists the background commands.
import { test, expect } from 'bun:test';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('a background job that ends after the reply wakes the model; /jobs lists it', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'sleep 3; echo all-tests-passed', description: 'Run the tests', background: true } } },
    { text: 'Started the tests in the background.' },
    { text: 'The background tests passed.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--mode', 'bypass'], steps: [
    { wait: '? for shortcuts' }, { type: 'Run the tests in the background.' }, { key: 'enter' },
    { wait: 'Started the tests in the background.' }, { sleep: 200 }, { snapshot: 'started' },
    { wait: 'The background tests passed.', ms: 20_000 }, { sleep: 300 }, { snapshot: 'woke' },
    { type: '/jobs' }, { key: 'enter' }, { wait: 'Background commands' }, { sleep: 200 }, { snapshot: 'jobs' },
    ...quit,
  ] });
  await fake.close();
  if (process.env.AGENTIC_SNAPSHOTS) (await import('node:fs')).writeFileSync(process.env.AGENTIC_SNAPSHOTS, JSON.stringify(r.snapshots, null, 1));
  expect(r.snapshots.started).toContain('Running in the background as job1');
  const woke = r.snapshots.woke;
  expect(woke).toMatch(/job1 ended, exit code 0 after \d+ s: sleep 3; echo all-tests-passed/);
  expect(woke).toContain('↻ job1 ended: the model carries on');
  const chats = fake.requests.filter((q) => q.stream && q.messages);
  const wake = chats.at(-1).messages.filter((m) => m.role === 'user').at(-1).content;
  expect(wake).toContain('From Agentic Coder, not the user: background job job1 (sleep 3; echo all-tests-passed) ended by itself: exit code 0');
  expect(wake).toContain('all-tests-passed');
  expect(r.snapshots.jobs).toMatch(/Background commands \(0 running; they end when this window closes\)/);
  expect(r.snapshots.jobs).toMatch(/job1 · ended, exit code 0 after \d+ s · sleep 3; echo all-tests-passed/);
}, T);
