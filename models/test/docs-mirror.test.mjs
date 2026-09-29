// The docs mirror (docs/tools/sync-docs.mjs): the repo is public, so only
// Agentic Coder's page groups ever leave "cli docs"; the owner's own folders
// beside them (memory-about-you, gemma-docs, morning briefs) and loose files
// at its top stay on the Mac.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { published, PAGE_GROUPS, DOCS_NAMES } from '../../docs/tools/to-docs.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('only files inside the six page groups are published', () => {
  expect(DOCS_NAMES[0]).toBe('cli docs');
  expect(PAGE_GROUPS).toEqual(['diagrams', 'reports', 'tests', 'design rounds', 'other', 'older versions']);
  for (const f of ['diagrams/a.html', 'tests/agentic-coder-test-record.html', 'design rounds/b.html', 'older versions/c.html']) expect(published(f)).toBe(true);
  for (const f of ['memory-about-you/index.md', 'memory-about-you/facts/x.md', 'gemma-docs/g.html', 'gemma-docs/test/t.html', 'morning briefs/morning-brief.html', 'my-claude-md-and-agents-md-v2.html', 'tests', 'diagrams']) expect(published(f)).toBe(false);
});

test('bun run docs copies the page groups and never the owner\'s folders (a dry run: nothing is changed)', () => {
  const docs = mkdtempSync(join(tmpdir(), 'agentic-mirror-'));
  const put = (f, text = '<title>x</title>') => { mkdirSync(dirname(join(docs, f)), { recursive: true }); writeFileSync(join(docs, f), text); };
  put('diagrams/zz-mirror-test-diagram.html'); put('tests/zz-mirror-test-run.html');
  put('memory-about-you/index.md', '# private'); put('memory-about-you/facts/a-rule.md', 'private');
  put('gemma-docs/g.html'); put('morning briefs/morning-brief.html'); put('loose-page.html');
  const r = spawnSync(process.execPath, [join(repo, 'docs', 'tools', 'sync-docs.mjs'), '--dry', '--force'], { cwd: repo, env: { ...process.env, AGENTIC_DOCS: docs }, encoding: 'utf8' });
  expect(r.status).toBe(0);
  const add = /^would add \(\d+\): (.*)$/m.exec(r.stdout)?.[1] ?? '';
  expect(add.split(', ').sort()).toEqual(['diagrams/zz-mirror-test-diagram.html', 'tests/zz-mirror-test-run.html']);
  expect(r.stdout).toMatch(/^kept on this Mac, never copied \(4\): /m);
  for (const secret of ['memory-about-you/index.md', 'a-rule.md', 'gemma-docs/g.html', 'morning-brief.html']) expect(add).not.toContain(secret);
});
