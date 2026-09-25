import { test } from 'node:test';
import assert from 'node:assert/strict';
import { title } from './index.mjs';
test('title', () => assert.equal(title, 'Harbour'));
