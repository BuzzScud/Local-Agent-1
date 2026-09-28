// End-to-end, the real app in a pseudo-terminal: while a focused path writes
// a try ("writing… N tokens" under it), the Musing… line counts those tokens
// too, like Claude Code's. Before, it sat at "↓ 0 tokens" the whole time.
import { test, expect } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('the Musing line counts the tokens a try is writing', async () => {
  const { cwd, env } = setup();
  const file = join(cwd, 'export.mjs');
  const good = readFileSync(file, 'utf8');
  writeFileSync(file, good.replace("join(','), ...lines].join('\\n')", "join(';'), ...lines].join('\\n')"));
  const fixed = good.match(/export function toCsv[\s\S]*?\n}\n/)[0];
  // JSON questions (which function) are answered at once; the fix is written
  // slowly, so the screen can be read while it is being written.
  const fake = await startFakeServer([{ text: `\`\`\`js\n${fixed}\`\`\`` }],
    { delayMs: 60, chunk: 4, route: (json) => (json.response_format ? { text: '{"function": "toCsv"}' } : null) });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url], steps: [
    { wait: '? for shortcuts' }, { type: 'fix the failing test' }, { key: 'enter' },
    { wait: 'writing… ' }, { sleep: 600 }, { snapshot: 'writing' },
    { sleep: 2500 }, ...quit,
  ] });
  await fake.close();
  const row = r.snapshots.writing.split('\n').find((l) => /… \(\d+s · ↓/.test(l));
  expect(row).toBeDefined();
  const shown = Number(row.match(/↓ (\d+) tokens/)?.[1] ?? 0);
  const writing = Number(r.snapshots.writing.match(/writing… (\d+) tokens/)?.[1] ?? 0);
  expect(writing).toBeGreaterThan(0);
  expect(shown).toBeGreaterThanOrEqual(writing);
}, T);
