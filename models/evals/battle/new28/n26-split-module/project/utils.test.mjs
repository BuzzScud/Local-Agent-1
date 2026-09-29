import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, titleCase, clamp, roundTo } from './utils.mjs';

test('text', () => { assert.equal(slugify(' Hi There '), 'hi-there'); assert.equal(titleCase('a b'), 'A B'); });
test('numbers', () => { assert.equal(clamp(5, 0, 3), 3); assert.equal(roundTo(1.234, 1), 1.2); });
