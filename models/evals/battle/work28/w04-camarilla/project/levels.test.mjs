import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classicPivots } from './levels.mjs';

test('classic pivots', () => {
  const v = classicPivots(110, 100, 105);
  assert.equal(v.p, 105);
  assert.equal(v.r1, 110);
  assert.equal(v.s1, 100);
});
