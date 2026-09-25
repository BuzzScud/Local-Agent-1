import { test } from 'node:test';
import assert from 'node:assert/strict';
import { push } from './queue.mjs';
import { MAX_ITEMS } from './limits.mjs';

test('push adds', () => assert.deepEqual(push([], 1), [1]));
test('full queue throws', () => assert.throws(() => push(Array(MAX_ITEMS).fill(0), 1), /full/));
