import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from './money.mjs';

test('dollars with cents', () => assert.equal(formatMoney(1234.5), '$1,234.50'));
test('euros', () => assert.equal(formatMoney(1234.5, { currency: 'EUR' }), '€1,234.50'));
