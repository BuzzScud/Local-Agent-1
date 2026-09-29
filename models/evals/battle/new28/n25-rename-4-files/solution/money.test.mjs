import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotal } from './money.mjs';
import { invoiceTotal } from './invoice.mjs';

test('computeTotal', () => { assert.equal(computeTotal([{ price: 2, qty: 3 }]), 6); });
test('invoiceTotal', () => { assert.equal(invoiceTotal({ lines: [{ price: 2, qty: 1 }], shipping: 5 }), 7); });
