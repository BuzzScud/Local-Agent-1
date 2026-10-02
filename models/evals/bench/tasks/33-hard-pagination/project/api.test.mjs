import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './api.mjs';

test('items have an id and a name only', () => {
  const { items } = handle();
  assert.deepEqual(items[0], { id: 1, name: 'item 1' });
});
