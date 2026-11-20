// hearth door check (models/evals/tools/hearth-door-check.mjs, the Arena → hearth door check): its place in the Arena
// and its results page from a made-up run (the real one needs the owner's hearth key and hearth's 27b).
import { test, expect } from 'bun:test';
import { RUN_TESTS } from '../evals/run-tests.mjs';
import { hearthPage } from '../evals/tools/hearth-door-check-page.mjs';

const arm = (over) => ({ secs: 300, workSecs: 280, waitSecs: 20, steps: 12, side: 3, sideWords: 0, sideThinking: 3, stepsThought: 0, taken: 2, wrote: 14000, think: 11500, thinkShare: 0.82, done: false, errors: [], ...over });
const summary = {
  name: 'hearth door check', model: 'hearth@poseidon', code: 'abc1234', beforeCode: '32c1420', task: 'Make applyDiscount <never> go below 0.', checks: 5, of: 5, passed: 5, pass: true, stopped: false,
  arms: { before: arm(), after: arm({ secs: 210, workSecs: 200, sideWords: 3, sideThinking: 0, stepsThought: 12, taken: 0, thinkShare: 0.6, done: true }) }, label: 'This run', sub: '20 Nov 16:00 · abc1234', page: 'tests/agentic-coder-hearth-door-2026-11-20-1600.html',
};
const rows = ['taken', 'side', 'think', 'done', 'time'].map((id) => ({ id, name: id, ok: true, detail: 'ok', secs: 0 }));

test('the hearth door check is in the Arena, a check of no model with its own line in the record', () => {
  expect(RUN_TESTS.find((t) => t.id === 'hearth')).toMatchObject({ name: 'hearth door check', script: 'models/evals/tools/hearth-door-check.mjs', total: 5, model: false, record: { kind: 'other', name: '^hearth door check$' } });
});

test('its page has both sides with the direction beside each measure, and says nothing it was not given', () => {
  const html = hearthPage({ summary, rows, prev: null, raw: ['models/evals/results/hearth-door-x'] });
  expect(html).toContain('<title>hearth door check · hearth@poseidon</title>');
  for (const k of ['Side by side', 'Steps taken over by a newer job', 'lower is better', 'Side jobs that came back with words', 'higher is better', 'Thinking in what the 27b wrote', '82%', '60%', 'Before (32c1420)', 'After (abc1234)']) expect(html).toContain(k);
  expect(html).toContain('&lt;never&gt;');
  expect(html).not.toContain('<never>');
});
