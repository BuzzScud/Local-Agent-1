import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from './money.mjs';

test('formatMoney adds commas and two decimals', () => {
  assert.equal(formatMoney(1234.5), '$1,234.50');
  assert.equal(formatMoney(0), '$0.00');
});
