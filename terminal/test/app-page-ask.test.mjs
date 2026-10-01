// End-to-end, the real app in a pseudo-terminal: a page saved for a request stops the turn and
// asks you to look at it first (agent.mjs askPage); "Looks good" ends it, and the model is not
// called again to check its own work.
import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';

const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice</title></head><body><h1>Invoice INV-2026-0087</h1><button id="download">Download</button></body></html>';

test('a saved page asks "is it right?" before any check; Looks good ends the turn there', async () => {
  const { cwd, env } = setup();
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'invoice.html', content: PAGE } } },
    { tool: { name: 'Bash', args: { command: 'ls -l invoice.html' } } }, // its own check: never asked for
    { text: 'never sent' },
  ]);
  const r = await runInPty({ cwd, env: { ...env, AGENTIC_MEMORY_SAVE: 'off' }, args: ['--url', fake.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { type: 'Build a self-contained HTML file for an invoice snapshot' }, { key: 'enter' },
    { wait: 'Do you want to' }, { type: '1' }, // the Write's own permission
    { wait: 'Have a look' }, { sleep: 200 }, { snapshot: 'asking' }, { type: '1' },
    { wait: 'nothing more was checked' }, { sleep: 300 }, { snapshot: 'done' }, ...quit,
  ] });
  await fake.close();
  if ((process.env.AGENTIC_SNAPSHOTS ?? process.env.BONSAI_SNAPSHOTS)) (await import('node:fs')).writeFileSync((process.env.AGENTIC_SNAPSHOTS ?? process.env.BONSAI_SNAPSHOTS), JSON.stringify(r.snapshots, null, 1));
  expect(existsSync(join(cwd, 'invoice.html'))).toBe(true);
  expect(r.snapshots.asking).toContain('invoice.html is saved. Have a look: is it right?');
  expect(r.snapshots.asking).toMatch(/1\. Looks good[\s│]+2\. Type an answer[\s│]+3\. Stop here/);
  expect(r.snapshots.done).toContain('Saved invoice.html. You looked at it and said it looks good, so nothing more was checked.');
  expect(fake.requests.length).toBe(1);
}, T);
