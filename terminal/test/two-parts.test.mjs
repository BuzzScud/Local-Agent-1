// The two parts meet at one file each way: the terminal imports only
// models/index.mjs, and the models part imports only terminal/index.mjs.
// (Starting a script of the other part, or copying its folder as a practice
// project, is not an import and is left alone.)
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const repo = join(import.meta.dir, '..', '..');
const SKIP = new Set(['node_modules', 'results', 'tasks', 'fixture-fix', 'fixture-rename', 'ui-walk']);
function codeFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) codeFiles(join(dir, e.name), out); }
    else if (/\.(mjs|js|jsx)$/.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}
// Every line that imports, by `from`, by import() or through a built path,
// and names a file of the other part that is not its one entry.
function strays(part, other) {
  const names = new RegExp(`${other}/[\\w./-]+`, 'g');
  const found = [];
  for (const file of codeFiles(join(repo, part))) {
    if (file === import.meta.path) continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (!/\bimport\b|\bfrom\s+['"]/.test(line)) return;
      for (const path of line.match(names) ?? []) if (path !== `${other}/index.mjs`) found.push(`${relative(repo, file)}:${i + 1} ${path}`);
    });
  }
  return found;
}

test('the terminal imports the models part through models/index.mjs only', () => {
  expect(strays('terminal', 'models')).toEqual([]);
});

test('the models part imports the terminal through terminal/index.mjs only', () => {
  expect(strays('models', 'terminal')).toEqual([]);
});

test('the check sees a stray import when there is one: static, import() and a built path', () => {
  const line = /\bimport\b|\bfrom\s+['"]/;
  for (const s of ["import { Agent } from '../../terminal/src/agent/agent.mjs';", "const m = await import('../../terminal/src/flows/llm.mjs');", 'const m = await import(`${R}/terminal/src/headless.mjs`);', "await import(${src('terminal/src/agent/prompt.mjs')});"]) {
    expect(line.test(s)).toBe(true);
    expect(s.match(/terminal\/[\w./-]+/g).filter((p) => p !== 'terminal/index.mjs').length).toBe(1);
  }
});
