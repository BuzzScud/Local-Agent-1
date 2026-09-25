import { test } from 'node:test';
import assert from 'node:assert/strict';
import { push } from './queue.mjs';
import { ITEM_LIMIT } from './limits.mjs';

test('push adds', () => assert.deepEqual(push([], 1), [1]));
test('full queue throws', () => assert.throws(() => push(Array(ITEM_LIMIT).fill(0), 1), /full/));
