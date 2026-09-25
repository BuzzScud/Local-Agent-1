import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mean, median, range } from './stats.mjs';

test('mean', () => assert.equal(mean([1, 2, 3, 4]), 2.5));
test('median of an odd count', () => assert.equal(median([3, 1, 2]), 2));
test('median of an even count', () => assert.equal(median([4, 1, 3, 2]), 2.5));
test('range', () => assert.equal(range([5, 1, 9]), 8));
