
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outline } from '../src/tools/outline.mjs';

test('outline finds functions with their line ranges', () => {
  const parts = outline('export function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n', 'x.mjs');
  assert.deepEqual(parts.map((p) => p.name), ['a', 'b']);
  assert.equal(parts[0].line, 1);
});
