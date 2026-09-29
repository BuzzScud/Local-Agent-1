import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradingDate } from './session.mjs';

test('before 6 PM New York it is the same day', () => {
  assert.equal(tradingDate('2026-09-28T21:30:00Z'), '2026-09-28'); // 5:30 PM, summer time
  assert.equal(tradingDate('2026-12-01T22:30:00Z'), '2026-12-01'); // 5:30 PM, winter time
});

test('from 6 PM New York it is the next day', () => {
  assert.equal(tradingDate('2026-09-28T22:30:00Z'), '2026-09-29'); // 6:30 PM Monday
  assert.equal(tradingDate('2026-09-29T02:00:00Z'), '2026-09-29'); // 10 PM Monday
  assert.equal(tradingDate('2026-12-01T23:30:00Z'), '2026-12-02'); // 6:30 PM, winter time
});
