import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeDay, restoreDay, purgeTrash } from './trash.mjs';

test('a removed day is no longer in the days', () => {
  const store = { days: { '2026-09-28': [1, 2] }, trash: {} };
  removeDay(store, '2026-09-28', Date.now());
  assert.equal(store.days['2026-09-28'], undefined);
});

test('the trash keeps a day for 30 days', () => {
  const DAY = 864e5;
  const store = { days: { d: [1] }, trash: {} };
  removeDay(store, 'd', 0);
  purgeTrash(store, 30 * DAY);
  restoreDay(store, 'd');
  assert.deepEqual(store.days.d, [1]);
});
