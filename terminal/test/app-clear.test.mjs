// /clear, end-to-end in a pseudo-terminal: like Claude Code's, it erases the
// old conversation everywhere — the window, the terminal's scrollback, what
// the model is sent next — and draws the start page again. Before, the old
// messages stayed on the screen above a "new conversation" line.
import { test, expect } from 'bun:test';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('/clear wipes the screen and the scrollback, shows the start page again, and the next message starts with nothing of the old one', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([{ text: 'The answer is PINEAPPLE-42.' }, { text: 'Hello, SECOND-REPLY here.' }]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'what is two plus two' }, { key: 'enter' },
    { wait: 'PINEAPPLE-42' }, { sleep: 800 }, { snapshot: 'before' },
    { type: '/clear' }, { key: 'enter' }, { sleep: 1200 }, { snapshot: 'cleared' },
    { type: 'hello again' }, { key: 'enter' }, { wait: 'SECOND-REPLY' }, { sleep: 500 },
    ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.before).toContain('what is two plus two');
  // The whole buffer, scrollback included: nothing of the old conversation, only its title in the
  // start page's Recent activity (where /resume brings it back).
  const cleared = r.snapshots.cleared;
  for (const gone of ['PINEAPPLE-42', 'new conversation']) expect(cleared).not.toContain(gone);
  expect(cleared.split('\n').filter((l) => l.includes('what is two plus two'))).toEqual([expect.stringMatching(/│  \d+m ago +what is two plus two/)]);
  expect(cleared.match(/Recent activity/g)).toHaveLength(1);
  expect(cleared).toContain('? for shortcuts');
  const term = r.terms.cleared;
  expect(term.buffer.active.length).toBe(term.rows); // no scrollback left
  // The model is sent only the new message.
  const chats = fake.requests.filter((q) => q.stream && q.messages?.some((m) => m.role === 'user' && String(m.content).includes('hello again')));
  expect(chats.length).toBeGreaterThan(0);
  const sent = JSON.stringify(chats.at(-1).messages.filter((m) => m.role !== 'system'));
  expect(sent).not.toContain('two plus two');
  expect(sent).not.toContain('PINEAPPLE');
}, T);
