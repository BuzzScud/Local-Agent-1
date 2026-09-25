import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, truncate } from './strings.mjs';

test('slugify', () => assert.equal(slugify(' Hello, World! '), 'hello-world'));
test('truncate', () => assert.equal(truncate('abcdef', 4), 'abc…'));
