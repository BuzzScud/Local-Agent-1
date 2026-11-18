// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here: one gate for everything that starts a turn
// or swaps the conversation (app-run.mjs canStartTurn; the audit of 18 Nov 2026): /resume, a ! line and /update memory
// wait while a reply works; every message typed meanwhile waits in line and goes in order (it was one slot); a ! line
// stops with esc, and a message typed while it runs goes after it; a second quit while the first works does nothing.
import { test, expect } from 'bun:test';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const lastUser = (req) => [...(req.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
const said = (c) => (typeof c === 'string' ? c : JSON.stringify(c));

test('while a reply works, /resume, ! and /update memory wait; two messages typed meanwhile both go, in order', async () => {
  const { cwd, env } = setup();
  // about 8 s of answer: time to type everything below while it is still being written
  const slow = `Slow answer begins. ${'and it goes on '.repeat(50)}Slow answer ends.`;
  const fake = await startFakeServer([{ text: slow }, { text: 'Second answer.' }, { text: 'Third answer.' }], { delayMs: 60 });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], timeoutMs: 75_000, steps: [
    { wait: '? for shortcuts' },
    { type: 'start the slow one' }, { key: 'enter' }, { wait: 'Slow answer begins.' },
    { type: '/resume' }, { key: 'enter' }, { wait: 'Wait for Agentic Coder to finish' }, { snapshot: 'resume' }, { sleep: 300 },
    { type: '!echo $((40+2))xyz' }, { key: 'enter' }, { sleep: 400 },
    { type: '/update memory' }, { key: 'enter' }, { sleep: 400 },
    { type: 'second message' }, { key: 'enter' }, { sleep: 200 },
    { type: 'third message' }, { key: 'enter' },
    { wait: '⏵ Queued: third message' }, { snapshot: 'queued', has: ['⏵ Queued: second message', '⏵ Queued: third message'] },
    { wait: 'Third answer.', ms: 40_000 }, { waitGone: 'esc to interrupt' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.resume).not.toContain('Resume a conversation'); // no picker opened under the reply
  expect(r.snapshots.queued).toContain('⏵ Queued: second message');
  expect(r.snapshots.queued).toContain('⏵ Queued: third message');
  expect(r.text).not.toContain('42xyz'); // the ! line never ran
  // what the model was sent, in order: the slow one, then each message typed meanwhile; never "update memory"
  const sent = fake.requests.filter((q) => q.stream).map((q) => said(lastUser(q)));
  expect(sent.some((c) => /update memory/.test(c))).toBe(false);
  const second = sent.findIndex((c) => c.includes('second message'));
  const third = sent.findIndex((c) => c.includes('third message'));
  expect(second).toBeGreaterThan(0);
  expect(third).toBeGreaterThan(second);
  expect(r.text).toContain('Second answer.');
  expect(r.text).toContain('Third answer.');
}, 90_000);

test('a ! line stops with esc, and a message typed while it runs goes once it has stopped', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'Answer after the shell.' }]);
  let stopAt = 0, stoppedAt = 0;
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '!sleep 30' }, { key: 'enter' }, { wait: 'esc to interrupt' },
    { type: 'hello after' }, { key: 'enter' }, { wait: '⏵ Queued: hello after' }, { snapshot: 'queued' },
    { fn: () => { stopAt = Date.now(); } }, { key: 'esc' },
    { wait: 'Stopped: ! sleep 30', ms: 8000 }, { fn: () => { stoppedAt = Date.now(); } },
    { wait: 'Answer after the shell.', ms: 20_000 }, { waitGone: 'esc to interrupt' },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.queued).toContain('⏵ Queued: hello after');
  expect(stoppedAt - stopAt).toBeLessThan(6000); // not the 30 s of the sleep (nor the 120 s limit)
  expect(fake.requests.some((q) => q.stream && said(lastUser(q)).includes('hello after'))).toBe(true);
}, T);

test('a second quit while the first one works does nothing: your SessionEnd hooks run once', async () => {
  const { cwd, env } = setup();
  const log = join(cwd, '..', 'session-end.log');
  mkdirSync(env.AGENTIC_HOME, { recursive: true });
  writeFileSync(join(env.AGENTIC_HOME, 'hooks.json'), JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: `echo started >> '${log}'; sleep 1` }] }] } }));
  const fake = await startFakeServer([]);
  await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 },
    // ctrl+d on an empty prompt quits; twice, as a key held a moment too long
    { key: '\x04' }, { sleep: 150 }, { key: '\x04' }, { sleep: 150 }, { key: '\x04' },
  ] });
  await fake.close();
  expect(existsSync(log)).toBe(true);
  expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['started']); // twice before: one for each quit
}, T);

test('a saved conversation without its messages is said and not opened: the window keeps its own and goes on', async () => {
  const { cwd, env } = setup();
  const dir = join(env.AGENTIC_HOME, 'sessions', cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(-100));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '2026-11-18T10-00-00-000Z.json'), JSON.stringify({ title: 'a file with no messages', items: [], cwd, id: '2026-11-18T10-00-00-000Z', updated: '2026-11-18T10:00:00.000Z' }));
  const fake = await startFakeServer([{ text: 'Still here.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: '/resume' }, { key: 'enter' }, { wait: 'Resume a conversation' }, { sleep: 200 }, { key: 'enter' },
    { wait: 'Could not open that conversation: its file holds no messages' },
    { type: 'are you there?' }, { key: 'enter' }, { wait: 'Still here.', ms: 20_000 }, { waitGone: 'esc to interrupt' },
    ...quit,
  ] });
  await fake.close();
  expect(r.text).not.toContain('resumed: a file with no messages');
  expect(r.text).toContain('Still here.');
}, T);
