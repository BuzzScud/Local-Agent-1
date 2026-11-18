// Search takes the model's JavaScript patterns in a git project too (18 Nov 2026, the audit: git grep -E knows
// no \d, \w, \s, so "MAX_\w+ = " said "No matches"), a pattern that starts with "-", and a walk of a huge folder
// stops and says so.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { searchFiles, listFiles } from '../src/tools/fs.mjs';

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'agentic-search-'));
  writeFileSync(join(d, 'a.mjs'), 'export const MAX_STEPS = 40;\nconst x = 12;\n-- a dashed line\nplain words here\n');
  spawnSync('git', ['init', '-q'], { cwd: d });
  return d;
}

test('JavaScript shorthands find lines in a git project, as in a plain folder', () => {
  const d = repo();
  expect(searchFiles(d, { pattern: 'MAX_\\w+ = ' }).total).toBe(1);
  expect(searchFiles(d, { pattern: '= \\d+;' }).total).toBe(2);
  expect(searchFiles(d, { pattern: 'plain\\swords' }).total).toBe(1);
  expect(searchFiles(d, { pattern: '\\bx\\b' }).total).toBe(1);
  expect(searchFiles(d, { pattern: '(?i)max_steps' }).total).toBe(1);
});

test('a pattern that starts with a dash is a pattern, not a flag', () => {
  const d = repo();
  const r = searchFiles(d, { pattern: '-- a dashed' });
  expect(r.error).toBeUndefined();
  expect(r.total).toBe(1);
});

test('a walk of a very big folder stops and says so', async () => {
  const d = mkdtempSync(join(tmpdir(), 'agentic-walk-'));
  mkdirSync(join(d, 'x'));
  for (let i = 0; i < 40; i++) writeFileSync(join(d, 'x', `f${i}.txt`), 'hello\n');
  const fs = await import('../src/tools/fs.mjs');
  expect(fs.WALK_FILES).toBeGreaterThan(1000);
  // the walk itself is unchanged for a small folder
  expect(listFiles(d, { pattern: '*.txt' }).total).toBe(40);
  expect(searchFiles(d, { pattern: 'hello' }).total).toBe(40);
});

test('a command the model runs gets no keys; its output is kept to its ends, decoded whole', async () => {
  const { withoutSecrets, secretName, keepEnds, runCommand } = await import('../src/tools/run.mjs');
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_ADMIN_KEY', 'AGENTIC_REMOTE_KEY', 'AGENTIC_SEARCH_KEY', 'AGENTIC_MCP_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'NPM_TOKEN', 'DB_PASSWORD'])
    expect([k, secretName(k)]).toEqual([k, true]);
  for (const k of ['PATH', 'HOME', 'SSH_AUTH_SOCK', 'LANG', 'TMPDIR', 'AGENTIC_HOME', 'KEYCHAIN_PATH', 'MONKEY'])
    expect([k, secretName(k)]).toEqual([k, false]);
  expect(withoutSecrets({ PATH: '/bin', ANTHROPIC_API_KEY: 'x' })).toEqual({ PATH: '/bin' });
  process.env.AUDIT_TEST_TOKEN = 'sekret-123';
  const d = mkdtempSync(join(tmpdir(), 'agentic-env-'));
  const fenced = await runCommand('echo "[$AUDIT_TEST_TOKEN]"', { cwd: d, sandbox: { readOnly: [] } });
  expect(fenced.lines.join('\n')).toContain('[]');
  const typed = await runCommand('echo "[$AUDIT_TEST_TOKEN]"', { cwd: d, sandbox: false });
  expect(typed.lines.join('\n')).toContain('[sekret-123]');
  delete process.env.AUDIT_TEST_TOKEN;
  // the ends
  const k = keepEnds(10);
  for (let i = 0; i < 100; i++) k.add('abcdefghij');
  const t = k.text();
  expect(t.startsWith('abcdefghij\n… ')).toBe(true);
  expect(t.endsWith('\nabcdefghij')).toBe(true);
  expect(t).toContain('980 characters of output left out');
  // a character split across two chunks is one character
  const big = await runCommand(`printf '%s' "$(printf 'é%.0s' $(seq 1 5000))"`, { cwd: d, sandbox: false });
  expect(big.lines.join('').includes('�')).toBe(false);
});

test('an Edit worked out before the question is not written over a file saved meanwhile; links and guessed paths', async () => {
  const { prepare, execute, resolvePath } = await import('../src/agent/tools.mjs');
  const { symlinkSync } = await import('node:fs');
  const d = mkdtempSync(join(tmpdir(), 'agentic-stale-'));
  writeFileSync(join(d, 'a.txt'), 'one\ntwo\n');
  const env = { cwd: d };
  const args = { path: 'a.txt', old_text: 'two', new_text: 'TWO' };
  const prepared = prepare('Edit', args, env);
  expect(prepared.after).toBe('one\nTWO\n');
  // the owner saves the file in their editor while the question waits
  writeFileSync(join(d, 'a.txt'), 'one\ntwo\nthree (mine)\n');
  const r = await execute('Edit', args, prepared, env);
  expect(r.error).toBe(true);
  expect((await import('node:fs')).readFileSync(join(d, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree (mine)\n');
  // unchanged: written, whole
  const p2 = prepare('Edit', { path: 'a.txt', old_text: 'three (mine)', new_text: 'three' }, env);
  const r2 = await execute('Edit', { path: 'a.txt', old_text: 'three (mine)', new_text: 'three' }, p2, env);
  expect(r2.error).toBeUndefined();
  expect((await import('node:fs')).readFileSync(join(d, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  // a new file under a folder that links outside the project is outside
  const out = mkdtempSync(join(tmpdir(), 'agentic-out-'));
  symlinkSync(out, join(d, 'linked'));
  expect(resolvePath(d, 'linked/new.txt').inside).toBe(false);
  // a full path somewhere else is not moved onto the project's file of the same name for a write
  writeFileSync(join(d, 'README.md'), '# mine\n');
  expect(resolvePath(d, '/nowhere-x/README.md', { write: true }).inside).toBe(false);
  // a retyped project path still is (one letter off in the project's own name)
  const name = d.split('/').pop();
  const typo = `/Users/someone/${name.slice(0, -1)}X/README.md`;
  expect(resolvePath(d, typo, { write: true }).abs).toBe(join(d, 'README.md'));
});

test('Edit: "already done" only when old_text is truly gone; Windows line endings are kept', async () => {
  const { findEdit } = await import('../src/agent/tools.mjs');
  // old_text with spaces where the file has a tab, and new_text happens to appear elsewhere: a real edit, not "done"
  const file = 'function a() {\n\treturn 1;\n}\nfunction b() {\n  return null;\n}\n';
  const m = findEdit(file, 'function a() {\n  return 1;\n}', 'function a() {\n  return null;\n}');
  expect([m.ok, m.done]).toEqual([true, undefined]);
  expect(m.after).not.toContain('return 1;');
  // truly done
  expect(findEdit('x = 2;\n', 'x = 1;', 'x = 2;').done).toBe(true);
  // CRLF
  const crlf = 'one\r\ntwo\r\nthree\r\n';
  const e1 = findEdit(crlf, 'two', 'TWO\nTWO-B');
  expect(e1.after).toBe('one\r\nTWO\r\nTWO-B\r\nthree\r\n');
  const e2 = findEdit(crlf, 'two  \nthree', 'deux\ntrois');
  expect(e2.ok).toBe(true);
  expect(e2.after.replace(/\r\n/g, '').includes('\n')).toBe(false);
});
