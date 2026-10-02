import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueBy, topN } from './collections.mjs';

test('uniqueBy keeps the first of each key', () => {
  assert.deepEqual(uniqueBy([{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }], 'id'), [{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
});
test('topN takes the highest', () => {
  assert.deepEqual(topN([{ value: 1 }, { value: 5 }, { value: 3 }], 2), [{ value: 5 }, { value: 3 }]);
});
