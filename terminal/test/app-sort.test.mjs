// End-to-end, the real app in a pseudo-terminal with the focused paths on:
// step 2 on the screen. A lone word brings a question with answers to pick,
// the pick is sorted and the line under it says where it went, and a short
// line after that carries on with the conversation.
import { test, expect } from 'bun:test';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('a question with answers to pick, the line that says where the request went, and a follow-up', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { text: '{"clear": false, "question": "What do you want to do with the API?", "options": ["Explain how the API works", "Fix a broken API endpoint", "Add a new API endpoint"]}' },
    { text: 'It exports toCsv and main.' },
    { text: 'I cannot reach the Desktop from this folder.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'api' }, { key: 'enter' },
    { wait: 'What do you want to do with the API?' }, { sleep: 200 }, { snapshot: 'asking' }, { type: '1' },
    { wait: 'It exports toCsv and main.' }, { sleep: 200 }, { snapshot: 'sorted' },
    { type: 'can you add it to my desktop?' }, { key: 'enter' },
    { wait: 'I cannot reach the Desktop from this folder.' }, { sleep: 200 }, { snapshot: 'followed' }, ...quit,
  ] });
  await fake.close();
  if (process.env.BONSAI_SNAPSHOTS) (await import('node:fs')).writeFileSync(process.env.BONSAI_SNAPSHOTS, JSON.stringify(r.snapshots, null, 1));
  expect(r.snapshots.asking).toContain('Bonsai asks');
  expect(r.snapshots.asking).toMatch(/1\. Explain how the API works[\s│]+2\. Fix a broken API endpoint[\s│]+3\. Add a new API endpoint[\s│]+4\. Type an answer[\s│]+5\. Stop here/);
  // The pick is shown as your answer, then sorted: explaining is a question.
  expect(r.text).toContain('You: Explain how the API works');
  expect(r.snapshots.sorted).toMatch(/⎿\s+Sorted as: question · step by step/);
  // The short line after it is not asked about and not sorted on its own.
  expect(r.snapshots.followed).toMatch(/> can you add it to my desktop\?\s+⎿\s+Sorted as: follow-up · continues the conversation/);
  expect(r.snapshots.followed).not.toMatch(/Bonsai asks/);
  // Three calls wrote text: the question, the answer, the follow-up's answer.
  expect(fake.remaining()).toBe(0);
}, T);

test('thanks get the quick reply and no line', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'You’re welcome.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
    { wait: 'Welcome to Bonsai Code' }, { type: 'its perfect , thank you' }, { key: 'enter' },
    { wait: 'You’re welcome.' }, { sleep: 200 }, { snapshot: 'thanks' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.thanks).toContain('> its perfect , thank you');
  expect(r.snapshots.thanks).not.toContain('Sorted as');
  expect(r.snapshots.thanks).not.toContain('Bonsai asks');
}, T);
