// End-to-end, the real app in a pseudo-terminal (see app.test.mjs): a helper
// (the Agent tool) when the model decides (/effort's Who decides: Model). While it
// works one line shows its steps as they come; after, one step in the
// conversation, and ctrl+o shows its steps and its report.
import { test, expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

test('a helper while it works and after: its steps on one line, then one step; ctrl+o shows its steps and report', async () => {
  const { cwd, env, base } = setup();
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ limits: { way: 'model' } }));
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'find the export code', prompt: 'Find where the CSV export is written; report file and line.', kind: 'explore' } } },
    { tool: { name: 'List', args: { path: '.' } } },
    { text: 'The export is in export.mjs.' },
    { text: 'The helper found it: export.mjs.' },
  ], { delayMs: 25 });
  const r = await runInPty({ cwd, env, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'where is the export written? use a helper' }, { key: 'enter' },
    { wait: 'find the export code · 1 step · List(.)' }, { snapshot: 'working' },
    { wait: 'The helper found it: export.mjs.' }, { sleep: 300 }, { snapshot: 'done' },
    { key: 'ctrlO' }, { wait: 'The export is in export.mjs.' }, { sleep: 300 }, { snapshot: 'expanded' }, { key: 'ctrlO' }, ...quit,
  ] });
  await fake.close();
  expect(r.snapshots.done).toMatch(/Explore\s+find the export code · 1 step · \d/);
  expect(r.snapshots.expanded).toContain('⏺ List(.)');
  expect(fake.requests.filter((q) => q.stream)[1].messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['Find where the CSV export is written; report file and line.']);
}, T);
