import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transition } from './status.mjs';

test('transition is a function', () => {
  assert.equal(typeof transition, 'function');
});
