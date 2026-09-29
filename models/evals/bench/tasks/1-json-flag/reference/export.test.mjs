import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, main } from './export.mjs';

const rows = [
  { symbol: 'NQ', side: 'buy', qty: 1, price: 24812.5 },
  { symbol: 'ES', side: 'sell', qty: 2, price: 6690.25 },
];

test('toCsv writes a header row and one line per trade', () => {
  assert.equal(toCsv(rows), 'symbol,side,qty,price\nNQ,buy,1,24812.5\nES,sell,2,6690.25');
});

test('main reads the trades file', () => {
  assert.match(main(['trades.json']), /^symbol,side,qty,price\n/);
});

test('--json prints the rows as JSON', () => {
  assert.equal(JSON.parse(main(['--json', 'trades.json'])).length, 3);
});
