// What a description of a change is written from (src/tools/edit.mjs,
// changedLines): only the lines that really differ.
import { test, expect } from 'bun:test';
import { changedLines, diffLines } from '../src/tools/edit.mjs';

const file = (median, min, max) => ['export function median(values) {', '  const s = sorted(values);', '  const mid = Math.floor(s.length / 2);', median, '}', '', ...Array.from({ length: 220 }, (_, i) => `// line ${i + 1} of nine other functions`), 'export function summary(values) {', '  return {', `    min: ${min},`, `    max: ${max},`, '  };', '}', ''].join('\n');

test('a fix in two places far apart is three lines, not a rewrite', () => {
  const before = file('  return s[mid];', 'max', 'min');
  const after = file('  if (s.length % 2 === 1) return s[mid];\n  return (s[mid - 1] + s[mid]) / 2;', 'min', 'max');
  // the block shown on screen runs from the first changed line to the last
  const shown = diffLines(before, after);
  expect(shown.removals).toBeGreaterThan(220);
  expect(shown.additions).toBe(shown.removals + 1);
  // what really differs
  expect(changedLines(before, after)).toEqual([
    { type: '-', text: '  return s[mid];' },
    { type: '+', text: '  if (s.length % 2 === 1) return s[mid];' },
    { type: '+', text: '  return (s[mid - 1] + s[mid]) / 2;' },
    { type: '-', text: '    min: max,' },
    { type: '-', text: '    max: min,' },
    { type: '+', text: '    min: min,' },
    { type: '+', text: '    max: max,' },
  ]);
});

test('an added line, a removed line, no change, and a file too large to compare line by line', () => {
  expect(changedLines('a\nb\nc\n', 'a\nb\nnew\nc\n')).toEqual([{ type: '+', text: 'new' }]);
  expect(changedLines('a\nb\nc\n', 'a\nc\n')).toEqual([{ type: '-', text: 'b' }]);
  expect(changedLines('same\n', 'same\n')).toEqual([]);
  expect(changedLines('', 'first line\n')).toEqual([{ type: '+', text: 'first line' }]);
  const big = changedLines('x\n1\n2\n3\ny', 'x\n4\n5\ny', 1);
  expect(big.map((l) => l.type).join('')).toBe('---++'); // everything between the shared start and end
});
