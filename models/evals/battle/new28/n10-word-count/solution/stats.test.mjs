import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textStats } from './stats.mjs';

test('chars and lines', () => { assert.deepEqual(textStats('ab\ncd'), { chars: 5, lines: 2, words: 2 }); });
test('words', () => { assert.equal(textStats('  a  b\tc ').words, 3); assert.equal(textStats('').words, 0); });
