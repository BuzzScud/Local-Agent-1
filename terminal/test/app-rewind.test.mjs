// End-to-end: /rewind in the real app, in a real pseudo-terminal, with the
// scripted model. A message whose model writes a file and runs a command,
// then esc twice on an empty prompt: the files go back, the conversation is
// cut back to before the message, and the message waits in the prompt.
import { test, expect } from 'bun:test';
import { existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit, quitTyped } from './app-setup.mjs';

const MSG = 'make the hello files';
// The latest message of yours in a request (automatic notes included).
const lastUser = (q) => String([...q.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
// A message is over once /rewind has saved it (its list in the test's home).
const saved = (env, n) => ({ fn: async () => {
  const dir = join(env.AGENTIC_HOME, 'rewind', 'sessions');
  const count = () => { try { return readdirSync(dir).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).points).length; } catch { return 0; } };
  const t0 = Date.now();
  while (count() < n) { if (Date.now() - t0 > 20_000) throw new Error(`message ${n} was never saved for /rewind`); await new Promise((r) => setTimeout(r, 100)); }
} });
// After a change the app checks it with the project's tests, asking first.
const check = (env, n) => [{ wait: 'Check the change with the project' }, { sleep: 200 }, { key: 'enter' }, saved(env, n), { sleep: 300 }];
const makeBoth = [
  { tool: { name: 'Write', args: { path: 'hello.txt', content: 'hi\n' } } },
  { tool: { name: 'Bash', args: { command: 'echo made > by-command.txt' } } },
  { text: 'Made hello.txt, and the command made by-command.txt.' },
];

test('esc twice: pick a message, put its files and the conversation back; the message waits in the prompt', async () => {
  const { cwd, env } = setup();
  let again = false;
  const fake = await startFakeServer(makeBoth, { route: (q) => (lastUser(q).includes('and a second message') ? { text: 'Second answer.' } : again && lastUser(q).includes(MSG) ? { text: 'Sent again.' } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows', '--mode', 'edits'], steps: [
    { wait: '? for shortcuts' }, { type: MSG }, { key: 'enter' },
    { wait: 'Go ahead?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Do you want to proceed?' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'by-command.txt.' }, ...check(env, 1),
    // You change a file of your own meanwhile: it is not the model's, it stays.
    { fn: () => writeFileSync(join(cwd, 'mine.txt'), 'mine\n') },
    { type: 'and a second message' }, { key: 'enter' }, { wait: 'Second answer.' }, saved(env, 2),
    { sleep: 300 }, { key: 'esc' }, { sleep: 150 }, { key: 'esc' },
    { wait: 'Put the files the model changed' }, { sleep: 200 }, { snapshot: 'list' },
    { key: 'down' }, { sleep: 150 }, { key: 'enter' }, { wait: 'Files and conversation' }, { sleep: 200 }, { snapshot: 'choose' },
    { key: 'enter' }, { wait: 'rewound to before' }, { sleep: 300 }, { snapshot: 'after' },
    // The message is back in the prompt: enter sends it again.
    { fn: () => { again = true; } }, { key: 'enter' }, { wait: 'Sent again.' }, { waitGone: 'esc to interrupt' },
    ...quit,
  ] });
  await fake.close();
  // The list: newest first, what each changed.
  expect(r.snapshots.list).toMatch(/❯ and a second message\s+no file changes · just now/);
  expect(r.snapshots.list).toMatch(/make the hello files\s+2 files · just now/);
  // The choice, and what it would do.
  expect(r.snapshots.choose).toContain('Rewind to before "make the hello files"');
  expect(r.snapshots.choose).toMatch(/1\. Files and conversation/);
  expect(r.snapshots.choose).toMatch(/2\. Files only/);
  expect(r.snapshots.choose).toMatch(/3\. Conversation only/);
  expect(r.snapshots.choose).toContain('Files that go back: by-command.txt, hello.txt');
  expect(r.snapshots.after).toContain('Put back 2 files to before "make the hello files": by-command.txt, hello.txt');
  expect(r.snapshots.after).toMatch(/> make the hello files/);
  expect(existsSync(join(cwd, 'hello.txt'))).toBe(false);
  expect(existsSync(join(cwd, 'by-command.txt'))).toBe(false);
  expect(readFileSync(join(cwd, 'mine.txt'), 'utf8')).toBe('mine\n');
  // Sent again, the model sees the conversation from before that message only.
  const last = fake.requests.filter((q) => q.stream && q.tools).at(-1);
  const users = last.messages.filter((m) => m.role === 'user').map((m) => m.content);
  expect(users.filter((c) => c.includes(MSG))).toHaveLength(1);
  expect(users.some((c) => c.includes('and a second message'))).toBe(false);
  expect(last.messages.some((m) => String(m.content ?? '').includes('Second answer.'))).toBe(false);
}, T);

test('/rewind, files only: the conversation stays, the model is told with the next message; a file you changed since is left alone', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'a.txt', content: 'a\n' } } },
    { tool: { name: 'Write', args: { path: 'b.txt', content: 'b\n' } } },
    { text: 'Wrote a.txt and b.txt.' },
  ], { route: (q) => (lastUser(q).endsWith('ok?') ? { text: 'Noted.' } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows', '--mode', 'edits'], steps: [
    { wait: '? for shortcuts' }, { type: 'write a and b' }, { key: 'enter' }, { wait: 'Go ahead?' }, { sleep: 200 }, { key: 'enter' }, { wait: 'Wrote a.txt and b.txt.' }, ...check(env, 1),
    { fn: () => writeFileSync(join(cwd, 'b.txt'), 'b, edited by hand\n') },
    { type: '/rewind' }, { sleep: 200 }, { key: 'enter' }, { wait: 'Put the files the model changed' }, { sleep: 150 },
    { key: 'enter' }, { wait: 'Files only' }, { sleep: 200 }, { snapshot: 'choose' },
    { type: '2' }, { wait: 'Put back 1 file' }, { sleep: 300 }, { snapshot: 'after' },
    { type: 'ok?' }, { key: 'enter' }, { wait: 'Noted.' }, { waitGone: 'esc to interrupt' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.choose).toContain('Files that go back: a.txt');
  expect(r.snapshots.choose).toContain('Left alone: b.txt (changed since, by you or another session)');
  expect(r.snapshots.after).toContain('Left alone: b.txt (changed since, by you or another session)');
  expect(r.snapshots.after).not.toContain('rewound to before');
  expect(existsSync(join(cwd, 'a.txt'))).toBe(false);
  expect(readFileSync(join(cwd, 'b.txt'), 'utf8')).toBe('b, edited by hand\n');
  const last = fake.requests.filter((q) => q.stream && q.tools).at(-1);
  const users = last.messages.filter((m) => m.role === 'user').map((m) => m.content);
  expect(users.some((c) => c.includes('write a and b'))).toBe(true); // the conversation stayed
  expect(users.at(-1)).toContain('[The user put these files back to how they were before their message "write a and b": a.txt.');
  expect(users.at(-1)).toContain('ok?');
}, T);

test('esc twice with nothing sent yet says so; with text in the prompt it still clears the prompt', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 200 }, { key: 'esc' }, { sleep: 150 }, { key: 'esc' }, { wait: 'Nothing to rewind yet' },
    { type: 'draft' }, { sleep: 150 }, { key: 'esc' }, { sleep: 150 }, { key: 'esc' }, { sleep: 300 }, { snapshot: 'cleared' },
    ...quitTyped,
  ] });
  await fake.close();
  expect(r.text).toContain('Nothing to rewind yet: once you send a message, /rewind (or esc twice) can put things back to before it.');
  expect(r.snapshots.cleared).not.toMatch(/> draft/);
  expect(r.snapshots.cleared).not.toContain('Put the files the model changed');
}, T);
