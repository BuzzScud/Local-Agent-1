// Agentic Coder working on itself (agent/self.mjs): the copy kept of one of its own files before
// a change, and which of a turn's changed files are the app's own code (so the window restarts on
// them once the tests pass, agent-work.mjs).
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appCodeChanged, keepOwnCopy, selfBackupDir } from '../src/agent/self.mjs';

const repoLike = () => {
  const repo = mkdtempSync(join(tmpdir(), 'self-repo-'));
  mkdirSync(join(repo, 'terminal', 'src'), { recursive: true });
  writeFileSync(join(repo, 'terminal', 'src', 'cli.jsx'), '');
  return repo;
};

test('appCodeChanged: the app\'s own code among a turn\'s files, as repo paths; docs, tests and files outside stay out', () => {
  const repo = repoLike();
  const files = ['terminal/src/agent/agent.mjs', 'terminal/test/self.test.mjs', 'docs/reports/a.html', 'README.md', '../elsewhere/x.mjs', 'models/evals/record.mjs'];
  expect(appCodeChanged(repo, files, repo)).toEqual(['terminal/src/agent/agent.mjs', 'models/evals/record.mjs']);
  // From a folder inside the repo the paths are still the repo's.
  expect(appCodeChanged(join(repo, 'terminal'), ['src/app/App.jsx', '../docs/x.html'], repo)).toEqual(['terminal/src/app/App.jsx']);
  // Another project: nothing of it is the app's code, even a terminal/src of its own.
  const other = mkdtempSync(join(tmpdir(), 'self-other-'));
  expect(appCodeChanged(other, ['terminal/src/cli.jsx'], repo)).toEqual([]);
  expect(appCodeChanged(repo, ['terminal/src/cli.jsx'], null)).toEqual([]);
});

test('keepOwnCopy: the file as it was goes under memory-backups/self/<day>/; a new file has nothing to copy', () => {
  process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'self-home-'));
  const file = join(process.env.AGENTIC_HOME, 'settings.json');
  writeFileSync(file, '{"a":1}');
  const now = new Date('2026-10-08T14:03:05Z');
  const to = keepOwnCopy(file, { now });
  expect(to).toBe(join(selfBackupDir(), '2026-10-08', '140305-settings.json'));
  expect(readFileSync(to, 'utf8')).toBe('{"a":1}');
  expect(keepOwnCopy(join(process.env.AGENTIC_HOME, 'missing.json'), { now })).toBeNull();
  expect(existsSync(selfBackupDir())).toBe(true);
  expect(readdirSync(selfBackupDir())).toEqual(['2026-10-08']);
});
