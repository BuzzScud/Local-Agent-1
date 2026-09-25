// Read tool: returns a file's text with line numbers, the way the model sees it.
import { readFileSync } from 'node:fs';

export function readFile(path, { offset = 1, limit = 2000 } = {}) {
  const text = readFileSync(path, 'utf8');
  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  const slice = all.slice(offset - 1, offset - 1 + limit);
  const numbered = slice.map((line, i) => `${String(offset + i).padStart(5)}\t${line}`).join('\n');
  return { text, numbered, lineCount: all.length, shown: slice.length };
}
