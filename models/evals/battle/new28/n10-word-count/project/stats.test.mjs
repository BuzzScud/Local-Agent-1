import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textStats } from './stats.mjs';

test('chars and lines', () => { assert.deepEqual(textStats('ab\ncd'), { chars: 5, lines: 2 }); });
