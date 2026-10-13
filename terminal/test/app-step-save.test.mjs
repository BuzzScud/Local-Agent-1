// End-to-end, the real app in a pseudo-terminal (see app.test.mjs). Here: the conversation is saved as it goes
// (app-run.mjs stepSave, 13 Oct 2026), not only when a reply ends: while the reply after a step is still being
// written, the conversation's file already holds the step, so a crash or a closed window loses nothing done.
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

// The newest conversation file in the home's sessions folder, read as it is on disk now.
function savedNow(home) {
  const dir = join(home, 'sessions');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).flatMap((d) => readdirSync(join(dir, d)).filter((f) => f.endsWith('.json')).map((f) => join(dir, d, f)));
  return files.length ? JSON.parse(readFileSync(files.sort().at(-1), 'utf8')) : null;
}

test('a step is saved before the reply after it has ended: its tool result is on disk while the answer is still being written', async () => {
  const { base, cwd, env } = setup();
  const home = join(base, 'home');
  const answer = `export.mjs writes one line per trade. ${'It reads trades.json and prints a line for each. '.repeat(30)}That is all.`;
  const fake = await startFakeServer([{ tool: { name: 'List', args: { path: '.' } } }, { text: answer }], { delayMs: 15 });
  let during = null;
  await runInPty({ cwd, env: { ...env, AGENTIC_STEP_SAVE_MS: '0' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' },
    { type: 'what is in this folder?' }, { key: 'enter' },
    { wait: 'export.mjs writes one line per trade' },
    // the answer is still coming (about 3 s of it): what the file holds now
    { fn: () => { during = savedNow(home); } },
    { wait: 'That is all.', ms: 20_000 }, { waitGone: 'esc to interrupt' },
    ...quit,
  ] });
  await fake.close();
  expect(during).not.toBeNull();
  expect(during.title).toBe('what is in this folder?');
  // the request, then the steps so far (the app's own reading ahead, then the model's List and its result), and no answer yet
  expect(during.messages[1]).toMatchObject({ role: 'user' });
  expect(during.messages.at(-1).role).toBe('tool');
  expect(during.messages.at(-1).content).toContain('export.mjs');
  expect(during.messages.some((m) => m.role === 'assistant' && m.tool_calls?.some((c) => c.function?.name === 'List'))).toBe(true);
  expect(JSON.stringify(during.messages)).not.toContain('That is all.');
  // once the reply ends, the whole of it, as before
  const after = savedNow(home);
  expect(after.messages.at(-1)).toMatchObject({ role: 'assistant', content: answer });
}, T);
