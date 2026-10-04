// End-to-end, the real app in a pseudo-terminal: /hooks' form adds a hook of your own (When, For,
// Command), Test runs it once, Save keeps it in hooks.json, and the next Bash the model sends is
// stopped by it with its words (agent/user-hooks.mjs; the owner's pick, 3 Oct 2026).
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('/hooks: add a hook in the form, test it, save it; it stops the next command', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Bash', args: { command: 'ls', description: 'List files' } } },
    { text: 'Your hook stopped the command, so I did not run it.' },
  ]);
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--way', 'model', '--mode', 'bypass'], steps: [
    { wait: '? for shortcuts' }, { type: '/hooks' }, { key: 'enter' }, { wait: '+ Add a hook' }, { sleep: 200 }, { snapshot: 'list' },
    { key: 'enter' }, { wait: 'Add a hook' }, { sleep: 150 },
    { key: 'down' }, { sleep: 150 }, { type: 'Bash' }, { sleep: 300 }, { key: 'enter' }, { sleep: 150 },
    { key: 'down' }, { sleep: 150 }, { type: 'echo "no commands today" >&2; exit 2' }, { sleep: 300 }, { key: 'enter' }, { sleep: 150 },
    { key: 'down' }, { sleep: 150 }, { key: 'down' }, { sleep: 150 }, { key: 'enter' }, { wait: 'it would stop the step' }, { sleep: 150 }, { snapshot: 'form' },
    { key: 'down' }, { sleep: 150 }, { key: 'enter' }, { wait: 'Saved.' }, { sleep: 200 }, { snapshot: 'saved' },
    { key: 'esc' }, { sleep: 200 },
    { type: 'List the files here.' }, { key: 'enter' },
    { wait: 'Your hook stopped the command' }, { sleep: 300 }, { snapshot: 'stopped' },
    ...quit,
  ] });
  await fake.close();
  if (process.env.AGENTIC_SNAPSHOTS) (await import('node:fs')).writeFileSync(process.env.AGENTIC_SNAPSHOTS, JSON.stringify(r.snapshots, null, 1));
  expect(r.snapshots.list).toMatch(/Hooks · \d+ of \d+ on while the model decides · 0 of yours/);
  expect(r.snapshots.list).toContain("Your hooks · ~/.agentic-coder/hooks.json, in Claude Code's layout");
  expect(r.snapshots.form).toMatch(/When\s+◀ Before a step/);
  expect(r.snapshots.form).toMatch(/For\s+Bash/);
  expect(r.snapshots.form).toMatch(/✔ exit 2 in \d+ ms: it would stop the step, saying: no commands today/);
  expect(r.snapshots.saved).toContain('Saved. Before a step (Bash), it runs: echo "no commands today" >&2; exit 2');
  expect(r.snapshots.saved).toMatch(/● on\s+Before a step · Bash\s+echo "no commands today"/);
  expect(JSON.parse(readFileSync(join(env.AGENTIC_HOME, 'hooks.json'), 'utf8'))).toEqual({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "no commands today" >&2; exit 2' }] }] } });
  expect(r.snapshots.stopped).toContain('your hook: no commands today');
  const told = fake.requests.filter((q) => q.stream && q.messages).at(-1).messages.at(-1).content;
  expect(told).toBe("A hook of the user's stopped this Bash: no commands today. Do something else, or ask the user.");
}, T);
