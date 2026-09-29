import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundToTick } from './ticks.mjs';

test('quarter-point ticks', () => {
  assert.equal(roundToTick('NQ', 18123.4), 18123.5);
  assert.equal(roundToTick('ES', 5000.1), 5000);
});

test('prices come out clean', () => {
  assert.equal(roundToTick('GC', 2345.67), 2345.7);
  assert.equal(roundToTick('CL', 71.234), 71.23);
});
