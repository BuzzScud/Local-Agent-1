import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGaps } from './gaps.mjs';

const T = (hh, mm) => Date.UTC(2026, 8, 28, hh, mm);

test('finds a hole of three minutes', () => {
  assert.deepEqual(findGaps([T(10, 0), T(10, 1), T(10, 5)]), [{ from: T(10, 2), to: T(10, 4), missing: 3 }]);
});
