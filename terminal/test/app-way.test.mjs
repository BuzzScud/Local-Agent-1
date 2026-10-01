// End-to-end, the real app in a pseudo-terminal with `--way model`: the model decides (agent/way.mjs).
// What you see: no line saying how the request was sorted, nothing read before the model's first
// word, both files read in one reply, the answer; /effort shows Who decides on Model, and /hooks
// lists the app's checks, off.
import { test, expect } from 'bun:test';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('--way model: no sorting line, the model reads two files in one reply, /effort and /hooks say so', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tools: [{ name: 'Read', args: { path: 'export.mjs' } }, { name: 'Read', args: { path: 'export.test.mjs' } }] },
    { text: 'toCsv in export.mjs makes the CSV: a header row, then one line per trade. main() calls it; the tests check both.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--way', 'model'], steps: [
    { wait: '? for shortcuts' }, { type: "Which function makes the CSV in this project? Don't change any files." }, { key: 'enter' },
    { wait: 'toCsv in export.mjs makes the CSV' }, { sleep: 300 }, { snapshot: 'answer' },
    { type: '/effort' }, { key: 'enter' }, { wait: 'Reset all' }, { sleep: 200 }, { snapshot: 'effort' }, { key: 'esc' }, { sleep: 300 },
    { type: '/hooks' }, { key: 'enter' }, { wait: 'Hooks ·' }, { sleep: 200 }, { snapshot: 'hooks' },
    ...quit,
  ] });
  await fake.close();
  if (process.env.AGENTIC_SNAPSHOTS) (await import('node:fs')).writeFileSync(process.env.AGENTIC_SNAPSHOTS, JSON.stringify(r.snapshots, null, 1));
  const a = r.snapshots.answer;
  expect(a).not.toContain('┊'); // the line under the request that says how it was sorted
  expect(a).not.toContain('Sorted as');
  expect(a).toMatch(/Read\s+export\.mjs/);
  expect(a).toMatch(/Read\s+export\.test\.mjs/);
  expect(a).not.toContain('Read first'); // nothing read ahead
  // One request for the reads, one for the answer: nothing sorted it first.
  const chats = fake.requests.filter((q) => q.stream && q.messages);
  expect(chats.length).toBe(2);
  expect(chats[0].messages.map((m) => m.role)).toEqual(['system', 'user']);
  expect(r.snapshots.effort).toMatch(/Who decides\s+◀ Model\s+▶\s+it sorts, looks and saves for itself, like Claude Code/);
  expect(r.snapshots.hooks).toMatch(/Hooks · 0 of 12 on while the model decides/);
  expect(r.snapshots.hooks).toMatch(/1\s+off\s+Empty reply/);
}, T);
