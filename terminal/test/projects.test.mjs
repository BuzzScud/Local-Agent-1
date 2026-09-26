// Going into a project named from the home folder (src/agent/projects.mjs).
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjects, projectsNamed } from '../src/agent/projects.mjs';

function home() {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-home-'));
  const project = (rel) => { mkdirSync(join(root, rel), { recursive: true }); writeFileSync(join(root, rel, 'package.json'), '{}'); };
  project('Desktop/MAIN2026');
  project('Desktop/MAIN2026/desks/chart'); // part of MAIN2026, not a project of its own
  project('Desktop/bonsai-code');
  project('Library/Caches/tool'); // never searched
  project('.hidden/app'); // never searched
  mkdirSync(join(root, 'Desktop/SEP/notes'), { recursive: true });
  return root;
}

test('projects are found a few levels down, not inside another project or the Mac\'s folders', () => {
  const root = home();
  expect(findProjects(root).map((p) => p.slice(root.length + 1)).sort()).toEqual(['Desktop/MAIN2026', 'Desktop/bonsai-code']);
});

test('a request names a project by its folder name or a path into it', () => {
  const root = home();
  const projects = findProjects(root);
  const named = (t) => projectsNamed(t, projects, root).map((p) => p.slice(root.length + 1));
  expect(named('fix the chart bug in MAIN2026')).toEqual(['Desktop/MAIN2026']);
  expect(named('why is bonsai code slow to start?')).toEqual(['Desktop/bonsai-code']);
  expect(named('look at Desktop/MAIN2026/desks/chart/index.html')).toEqual(['Desktop/MAIN2026']);
  expect(named('fix the bug')).toEqual([]);
});

test('a folder named with an everyday word counts only when pointed at', () => {
  const root = home();
  mkdirSync(join(root, 'Desktop/MATH/prime'), { recursive: true });
  writeFileSync(join(root, 'Desktop/MATH/prime/main.py'), 'print(2)\n');
  const projects = findProjects(root);
  const named = (t) => projectsNamed(t, projects, root).map((p) => p.slice(root.length + 1));
  expect(named('what is a prime number?')).toEqual([]);
  expect(named('fix the bug in prime')).toEqual(['Desktop/MATH/prime']);
  expect(named('open the prime folder')).toEqual(['Desktop/MATH/prime']);
});

test('in the home folder Bonsai answers from what it knows; in a project it does not get that note', async () => {
  const { systemPrompt, isHomeFolder, SESSION_MARK } = await import('../src/agent/prompt.mjs');
  const { homedir } = await import('node:os');
  expect(isHomeFolder(homedir())).toBe(true);
  expect(isHomeFolder(join(homedir(), 'Desktop'))).toBe(true);
  expect(isHomeFolder(join(homedir(), 'Desktop', 'MAIN2026'))).toBe(false);
  const at = (cwd) => systemPrompt({ cwd, git: 'test', tests: null });
  expect(at(homedir()).slice(at(homedir()).indexOf(SESSION_MARK))).toContain("Here: the user's home folder, not a project.");
  expect(at(home())).not.toContain("the user's home folder, not a project");
});
