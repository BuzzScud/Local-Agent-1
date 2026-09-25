import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, median, summary, percentile } from './stats.mjs';

test('mean', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
});

test('median of an even count is the mean of the two middle values', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});

test('percentile', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
});

test('summary', () => {
  assert.deepEqual(summary([4, 1, 3, 2]), { n: 4, mean: 2.5, median: 2.5, min: 1, max: 4 });
});
