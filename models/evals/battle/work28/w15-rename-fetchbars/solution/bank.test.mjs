import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBars } from './bars.mjs';
import { closes } from './chart.mjs';
import { countBars } from './bank.mjs';

test('loadBars gives the stored bars', () => {
  assert.equal(loadBars('NQ', '2026-09-28').length, 2);
  assert.deepEqual(loadBars('CL', '2026-09-28'), []);
});

test('closes and counts', () => {
  assert.deepEqual(closes('NQ', '2026-09-28'), [18000, 18010.25]);
  assert.deepEqual(countBars(['NQ', 'ES'], '2026-09-28'), { NQ: 2, ES: 1 });
});
