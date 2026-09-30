// This repo's AGENTS.md stays short enough for a small model (30 Sep 2026): Agentic Coder reads it
// at the start of every session here, before the first message, and it had grown one feature note
// at a time from 5,400 to 8,000 characters in two days. The rules stay in AGENTS.md; how things
// work and why goes in AGENTS-DETAILS.md, which Claude Code reads through CLAUDE.md and Agentic
// Coder never does.
import { test, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectNotes } from '../src/agent/prompt.mjs';

const root = join(import.meta.dir, '..', '..');
const read = (n) => readFileSync(join(root, n), 'utf8');
const LIMIT = 4000;

test('AGENTS.md stays short enough for a small model', () => {
  const n = read('AGENTS.md').length;
  expect(n > LIMIT ? `AGENTS.md is ${n.toLocaleString('en-US')} characters; the limit is ${LIMIT.toLocaleString('en-US')}, so a small model reads it quickly. Put a new feature's notes in AGENTS-DETAILS.md; keep only a rule here.` : null).toBeNull();
});

test('AGENTS.md keeps its headings, so a cut drops whole sections and names them', () => {
  const heads = read('AGENTS.md').split('\n').filter((l) => /^## /.test(l)).map((l) => l.slice(3));
  for (const h of ['Commands', 'Hard rules', 'Where things go']) expect(heads).toContain(h);
});

test('the background is in AGENTS-DETAILS.md: Claude Code reads both, Agentic Coder only AGENTS.md', () => {
  expect(existsSync(join(root, 'AGENTS-DETAILS.md'))).toBe(true);
  expect(read('AGENTS.md')).toContain('AGENTS-DETAILS.md');
  expect(read('CLAUDE.md').trim().split('\n')).toEqual(['@AGENTS.md', '@AGENTS-DETAILS.md']);
  const { text, sources } = projectNotes(root, undefined, { memory: false, home: root });
  expect(sources.map((s) => [s.name.split('/').pop(), s.status])).toEqual([['AGENTS.md', 'whole']]);
  expect(text).not.toContain('# Details behind AGENTS.md');
});
