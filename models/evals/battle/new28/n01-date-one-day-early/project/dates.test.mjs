import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDay } from './dates.mjs';

test('shows the day as written', () => {
  assert.equal(formatDay('2026-09-29'), '9/29/2026');
  assert.equal(formatDay('2026-01-01'), '1/1/2026');
});
