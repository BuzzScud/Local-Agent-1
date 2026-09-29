import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classicPivots, camarilla } from './levels.mjs';

test('classic pivots', () => {
  const v = classicPivots(110, 100, 105);
  assert.equal(v.p, 105);
  assert.equal(v.r1, 110);
  assert.equal(v.s1, 100);
});

test('camarilla levels', () => {
  assert.deepEqual(camarilla(110, 100, 105), { h1: 105.92, h2: 106.83, h3: 107.75, h4: 110.5, l1: 104.08, l2: 103.17, l3: 102.25, l4: 99.5 });
});
