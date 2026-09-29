// The effort you pick is still in use after the app is closed and started again
// (asked for on 28 Sep 2026: "switch to high, close it, come back hours later").
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { startFakeServer } from './fake-server.mjs';
import { setup, quit } from './app-setup.mjs';

test('High saved in /effort is still in use after closing and starting again', async () => {
  const { cwd, env, base } = setup();
  const fake = await startFakeServer([{ text: 'Hi again.' }]);
  const args = ['--url', fake.url, '--no-flows'];
  await runInPty({ cwd, env, args, steps: [
    { wait: '? for shortcuts' }, { type: '/effort' }, { key: 'enter' }, { wait: 'moves a row' }, { sleep: 200 },
    { key: 'right' }, { sleep: 100 }, { key: 'enter' }, { wait: 'Effort is high' }, ...quit,
  ] });
  const saved = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  expect([saved.thinking, saved.effort]).toEqual([true, 'high']);
  // a second start, as if hours later
  const b = await runInPty({ cwd, env, args, steps: [
    { wait: '? for shortcuts' }, { type: '/effort' }, { key: 'enter' }, { wait: 'moves a row' }, { sleep: 300 }, { snapshot: 'menu' }, { key: 'esc' }, { sleep: 200 },
    { type: 'hi' }, { key: 'enter' }, { wait: 'Hi again.' }, ...quit,
  ] });
  await fake.close();
  expect(b.snapshots.menu).toMatch(/❯ Effort\s+◀ High\s+▶\s+thinks first/); // opens on the level in use, nothing unsaved (no •)
  expect(fake.requests.find((q) => q.stream && q.tools).chat_template_kwargs).toEqual({ enable_thinking: true, reasoning_effort: 'high' });
}, 60_000);
