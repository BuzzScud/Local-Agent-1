import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCsvLine } from './csv.mjs';

test('plain fields', () => { assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']); });
test('a quoted field may hold a comma', () => { assert.deepEqual(splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']); });
test('two quotes inside quotes are one quote', () => { assert.deepEqual(splitCsvLine('"say ""hi""",x'), ['say "hi"', 'x']); });
