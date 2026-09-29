import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeDay } from './trash.mjs';

test('a removed day is no longer in the days', () => {
  const store = { days: { '2026-09-28': [1, 2] }, trash: {} };
  removeDay(store, '2026-09-28', Date.now());
  assert.equal(store.days['2026-09-28'], undefined);
});
