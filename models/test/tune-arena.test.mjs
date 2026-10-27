// /tune's Test in the Arena (27 Oct 2026): a run takes a tuned model's own rows as its settings
// (run-tests.mjs cleanSettings), and the set "tune" is three short Practice 28 tasks (store.mjs TUNE_TESTS).
// The runner and a real run: terminal/test/arena-remote.test.mjs.
import { test, expect } from 'bun:test';
import { cleanSettings } from '../evals/run-tests.mjs';
import { TUNE_TESTS, practiceList } from '../evals/battle/store.mjs';

test('the Arena takes a tuned model’s rows for a run, and its Tune check is three short Practice 28 tasks', () => {
  expect(cleanSettings({ temperature: 0.6, presence: 'own', topP: 'own', topK: 20, repeatPenalty: 1.05, thinkTime: 1800, replyTokens: 8192, steps: 120, context: 65536, notes: 'never here', preset: 'coding' }))
    .toEqual({ temperature: 0.6, presence: 'own', topP: 'own', topK: 20, repeatPenalty: 1.05, thinkTime: 1800, replyTokens: 8192, steps: 120, context: 65536 });
  expect(cleanSettings({ temperature: 'own; rm -rf' })).toBe(null);
  const ids = practiceList().map((p) => p.id);
  for (const id of TUNE_TESTS) expect(ids).toContain(id);
  expect(TUNE_TESTS).toHaveLength(3);
});
