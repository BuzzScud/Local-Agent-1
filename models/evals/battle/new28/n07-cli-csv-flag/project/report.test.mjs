import { test } from 'node:test';
import assert from 'node:assert/strict';
import { table } from './report.mjs';

test('a text table', () => { assert.equal(table([{ name: 'ann', score: 3 }]), 'ann  3'); });
