// hearth fit check (models/evals/tools/hearth-fit-check.mjs, the Arena → hearth fit check): its place in the Arena and its
// results page from a made-up run (the real one needs the owner's hearth key and hearth's 27b).
import { test, expect } from 'bun:test';
import { RUN_TESTS } from '../evals/run-tests.mjs';
import { fitPage } from '../evals/tools/hearth-fit-check-page.mjs';

const run = (task, over) => ({ task, secs: 120, killed: false, idleAfter: 1, workSecs: 100, steps: 6, side: 1, sideWords: 1, offHearth: [], taken: 0, failed: 0, thinkShare: 0.3, ok: true, why: 'right', ...over });
const tasks = [{ id: 'quick', name: 'A quick question', prompt: 'What does <checkout> return?' }, { id: 'fix', name: 'A small fix with a test', prompt: 'Clamp it.' }];
const summary = {
  name: 'hearth fit check', model: 'hearth@poseidon', code: 'abc1234', beforeCode: '0a019d4', tasks, thinking: true, effort: 'high', profiles: true,
  checks: 6, of: 6, passed: 6, pass: true, stopped: false, label: 'This run', sub: '21 Nov 12:30 · abc1234', page: 'tests/agentic-coder-hearth-fit-2026-11-21-1230.html',
  arms: { before: [run('quick', { killed: true, idleAfter: null, offHearth: ['claude-opus-5-5 (a side job)'] }), run('fix', { ok: false, why: 'suite fails' })], after: [run('quick'), run('fix')] },
};
const rows = ['ends', 'hearth', 'jobs', 'work', 'quick', 'time'].map((id) => ({ id, name: id, ok: true, detail: 'ok', secs: 0 }));

test('the hearth fit check is in the Arena, a check of no model with its own line in the record', () => {
  expect(RUN_TESTS.find((t) => t.id === 'hearth-fit')).toMatchObject({ name: 'hearth fit check', script: 'models/evals/tools/hearth-fit-check.mjs', total: 6, model: false, record: { kind: 'other', name: '^hearth fit check$' } });
});

test('its page has each task on both sides with the direction beside each measure, and says nothing it was not given', () => {
  const html = fitPage({ summary, rows, prev: null, raw: ['models/evals/results/hearth-fit-x'] });
  expect(html).toContain('<title>hearth fit check · hearth@poseidon</title>');
  for (const k of ['Each task', 'A quick question', 'A small fix with a test', 'Waiting after its last request', 'lower is better', 'Requests that left hearth', 'claude-opus-5-5 (a side job)', 'never ended', 'stopped at its limit', 'suite fails', 'Main (0a019d4)', 'This code (abc1234)']) expect(html).toContain(k);
  expect(html).toContain('&lt;checkout&gt;');
  expect(html).not.toContain('<checkout>');
});
