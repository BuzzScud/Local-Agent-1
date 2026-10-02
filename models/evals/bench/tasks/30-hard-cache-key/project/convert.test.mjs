import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert } from './convert.mjs';

test('converts USD to EUR', () => {
  assert.equal(convert(100, 'USD', 'EUR'), 90);
});
