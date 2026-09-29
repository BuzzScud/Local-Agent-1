import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundTo } from './round.mjs';

test('rounds half up', () => { assert.equal(roundTo(1.005, 2), 1.01); });
