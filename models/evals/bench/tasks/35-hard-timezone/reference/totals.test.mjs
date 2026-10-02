import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTotals } from './totals.mjs';

test('sums a morning trade', () => {
  assert.deepEqual(dailyTotals([{ at: '2026-06-02T14:00:00Z', qty: 2, price: 5 }]), { '2026-06-02': 10 });
});
test('an evening trade stays on its New York day', () => {
  assert.deepEqual(dailyTotals([{ at: '2026-06-02T23:30:00-04:00', qty: 1, price: 3 }]), { '2026-06-02': 3 });
});
