import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from './format.mjs';
import { buildReport } from './report.mjs';

test('formatMoney adds commas and two decimals', () => {
  assert.equal(formatMoney(1234.5), '$1,234.50');
});

test('buildReport lists each row and the total', () => {
  const out = buildReport([{ name: 'rent', amount: 1200 }, { name: 'food', amount: 300.5 }]);
  assert.equal(out, 'Total in $\nrent: $1,200.00\nfood: $300.50\nTotal: $1,500.50');
});

test('symbol option reaches the rows and the header', () => {
  assert.equal(formatMoney(1234.5, { symbol: '€' }), '€1,234.50');
  assert.equal(buildReport([{ name: 'a', amount: 1 }], { symbol: '€' }), 'Total in €\na: €1.00\nTotal: €1.00');
});
