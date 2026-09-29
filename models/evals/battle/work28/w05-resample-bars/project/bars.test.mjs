import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastClose, between } from './bars.mjs';

const bars = [{ t: 0, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: 60000, o: 1.5, h: 3, l: 1, c: 2.5, v: 5 }];

test('last close and a window', () => {
  assert.equal(lastClose(bars), 2.5);
  assert.equal(between(bars, 60000, 120000).length, 1);
});
