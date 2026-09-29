import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBars } from './bars.mjs';
import { closes } from './chart.mjs';
import { countBars } from './bank.mjs';

test('fetchBars gives the stored bars', () => {
  assert.equal(fetchBars('NQ', '2026-09-28').length, 2);
  assert.deepEqual(fetchBars('CL', '2026-09-28'), []);
});

test('closes and counts', () => {
  assert.deepEqual(closes('NQ', '2026-09-28'), [18000, 18010.25]);
  assert.deepEqual(countBars(['NQ', 'ES'], '2026-09-28'), { NQ: 2, ES: 1 });
});
