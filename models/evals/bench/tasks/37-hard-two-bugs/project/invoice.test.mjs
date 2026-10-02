import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotal } from './invoice.mjs';
import { round2 } from './money.mjs';

test('an empty invoice is 0', () => {
  assert.equal(invoiceTotal([]), 0);
});
test('round2 keeps two places', () => {
  assert.equal(round2(1.2), 1.2);
});
