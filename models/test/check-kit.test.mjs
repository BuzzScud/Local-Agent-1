// What the Arena's model checks share (models/evals/tools/check-kit.mjs): the run before this one
// for the page's Before column, the command line, and a run folder's name.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previousRun, options, stampOf, short, toolsOf } from '../evals/tools/check-kit.mjs';

test('the run before: the newest finished one on the same model, never a stopped one or a later one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-kit-'));
  const run = (name, summary, rows = [{ id: name }]) => { const d = join(dir, name); mkdirSync(d); writeFileSync(join(d, 'summary.json'), JSON.stringify(summary)); writeFileSync(join(d, 'rows.json'), JSON.stringify(rows)); return d; };
  run('web-check-a', { model: 'qwen', finished: '2026-10-01' });
  run('web-check-b', { model: 'qwen', finished: '2026-10-02' });
  run('web-check-c', { model: 'qwen', finished: '2026-10-02T12', stopped: true });
  run('web-check-d', { model: 'gemma', finished: '2026-10-02T13' });
  run('sort-check-e', { model: 'qwen', finished: '2026-10-02T14' });
  const now = { model: 'qwen', finished: '2026-10-03' };
  const out = run('web-check-f', now);
  run('web-check-g', { model: 'qwen', finished: '2026-10-04' }); // after this one
  expect(previousRun(out, now, 'web-check-')?.rows).toEqual([{ id: 'web-check-b' }]);
  expect(previousRun(out, now, 'web-check-', { sameModel: false })?.rows).toEqual([{ id: 'web-check-d' }]);
  expect(previousRun(out, now, 'door-check-')).toBe(null);
});

test('the command line, a run folder\'s name, and the steps coding -p printed', () => {
  const { opt, has } = options(['--model', 'qwen', '--no-record']);
  expect([opt('model', 'x'), opt('out', 'dflt'), has('no-record'), has('rebuild')]).toEqual(['qwen', 'dflt', true, false]);
  expect(stampOf(new Date(2026, 9, 3, 9, 5))).toBe('2026-10-03-0905');
  expect(short('  a\n  b  ', 3)).toBe('a b');
  expect(toolsOf('· a note\n⏺ Read(a.mjs)\n✗ Bash(npm test)')).toEqual(['Read(a.mjs)', 'Bash(npm test)']);
});
