// Terminal behaviour that the model's speed shapes: the system prompt keeps a
// shared start (so the models part can save the warm-up), and how much of a
// file a try rewrites.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemPrompt, SESSION_MARK, projectNotes } from '../src/agent/prompt.mjs';
import { WHOLE_FILE_MAX, SHOW_WHOLE_MAX, isWholeFile } from '../src/flows/units.mjs';

test('the instructions start the same in every project and on every day (so the warm-up can be saved)', () => {
  const a = systemPrompt({ cwd: '/tmp/a', git: 'main, clean', date: new Date('2026-09-25'), tests: 'node --test' });
  const b = systemPrompt({ cwd: '/tmp/b', git: 'none', date: new Date('2027-01-02'), tests: null, notes: 'Use tabs.' });
  const shared = (s) => s.slice(0, s.indexOf(SESSION_MARK));
  expect(shared(a).length).toBeGreaterThan(1000);
  expect(shared(a)).toBe(shared(b));
  expect(a.slice(a.indexOf(SESSION_MARK))).toContain('Today: 2026-09-25');
  expect(b.slice(b.indexOf(SESSION_MARK))).toContain('Use tabs.');
});

test('a private .bonsai/notes.md is read alongside AGENTS.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bonsai-notes-'));
  writeFileSync(join(dir, 'AGENTS.md'), 'Run the tests with npm test.');
  mkdirSync(join(dir, '.bonsai'), { recursive: true });
  writeFileSync(join(dir, '.bonsai', 'notes.md'), 'The deploy password lives in 1Password.');
  const n = projectNotes(dir);
  expect(n.files.some((p) => p.endsWith('AGENTS.md'))).toBe(true);
  expect(n.files.some((p) => p.endsWith('.bonsai/notes.md'))).toBe(true);
  expect(n.text).toContain('npm test');
  expect(n.text).toContain('1Password');
});

test('tries rewrite one function past 80 lines; the model reads whole files up to 300', () => {
  expect(WHOLE_FILE_MAX).toBe(80);
  expect(SHOW_WHOLE_MAX).toBe(300);
});

test('a whole-file reply is recognised when one function was asked for', () => {
  const file = 'import x from "y";\n\nexport function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n\nexport function c() {\n  return 3;\n}\n';
  expect(isWholeFile('export function b() {\n  return 22;\n}\n', file, 'b', 'js')).toBe(false);
  expect(isWholeFile(file.replace('return 2', 'return 22'), file, 'b', 'js')).toBe(true);
  // a new function that calls an existing one is not the whole file
  expect(isWholeFile('export function d() {\n  return a() + 1;\n}\n', file, null, 'js')).toBe(false);
  // a file with one other function: defining it again means the whole file
  const two = 'export function a() {\n  return 1;\n}\n\nexport function b() {\n  return 2;\n}\n';
  expect(isWholeFile(two.replace('return 2', 'return 5'), two, 'b', 'js')).toBe(true);
});
