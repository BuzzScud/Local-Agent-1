import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageCount, pageSlice, clampPage } from './pages.mjs';

test('exact pages', () => assert.equal(pageCount(50, 10), 5));
test('a partly full last page still counts', () => assert.equal(pageCount(51, 10), 6));
test('slice', () => assert.deepEqual(pageSlice([1, 2, 3, 4, 5], 2, 2), [3, 4]));
test('clamp to the last page', () => assert.equal(clampPage(9, 51, 10), 6));
