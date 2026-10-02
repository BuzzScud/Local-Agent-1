import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTotals } from './totals.mjs';

test('sums a morning trade', () => {
  assert.deepEqual(dailyTotals([{ at: '2026-06-02T14:00:00Z', qty: 2, price: 5 }]), { '2026-06-02': 10 });
});
