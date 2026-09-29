import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStalled } from './stall.mjs';

test('a tick 10 seconds ago is fine, 16 seconds ago is a stall', () => {
  const now = 1_000_000;
  assert.equal(isStalled(now - 10_000, now, true), false);
  assert.equal(isStalled(now - 16_000, now, true), true);
});

test('never stalled while the market is closed', () => {
  assert.equal(isStalled(0, 10_000_000, false), false);
});
