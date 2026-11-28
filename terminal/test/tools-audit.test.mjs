// The tools audit of 28 Nov 2026: a test for each fix. The Database and Browser holes were tried for real first (a scratch
// PostgreSQL 16 lost its table to "commit; drop table t"; file://localhost/etc/passwd passed as a file in the project).
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { oneStatement } from '../src/tools/database.mjs';
import { decide } from '../src/agent/permissions.mjs';
import { findEdit } from '../src/agent/tools-edit.mjs';
import { Jobs } from '../src/tools/jobs.mjs';
import { sandboxProfile, sandboxAvailable, SANDBOX_EXEC } from '../src/tools/sandbox.mjs';
import { needs } from './needs.mjs';

const project = () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'tools-audit-')));
  writeFileSync(join(cwd, 'index.html'), '<p>hi</p>\n');
  writeFileSync(join(cwd, 'app.db'), '');
  return cwd;
};
const ctx = (cwd) => ({ mode: 'ask', cwd, inside: true, rules: {}, allowedPrefixes: new Set() });

test('the Database tool runs one read: a ; between statements, or a change, is refused', () => {
  for (const sql of ['commit; drop table t', 'select 1; delete from t', 'drop table t', 'update t set x = 1', 'select 1 /* unclosed', "select 'open", 'select a$x$ from q; commit; drop table t; select 1 as b$x$']) expect({ sql, ok: !oneStatement(sql).error }).toEqual({ sql, ok: false });
  expect(oneStatement('select 1 as a;  ').sql).toBe('select 1 as a');
  expect(oneStatement("select ';' as semi, $$x;y$$ as d, $tag$a;b$tag$ -- c; comment\n").error).toBeUndefined();
  expect(oneStatement('/* ; */ select "a;b" from t').error).toBeUndefined();
  expect(oneStatement('WITH x AS (SELECT 1) SELECT * FROM x').error).toBeUndefined();
  expect(oneStatement('explain select 1').error).toBeUndefined();
});

test('the Database tool is let in by the file it opens, database before path, links followed', () => {
  const cwd = project();
  mkdirSync(join(cwd, 'out'));
  const away = realpathSync(mkdtempSync(join(tmpdir(), 'tools-audit-away-')));
  writeFileSync(join(away, 'other.db'), '');
  symlinkSync(away, join(cwd, 'link-out'));
  expect(decide('Database', { action: 'tables', database: 'app.db' }, ctx(cwd)).decision).toBe('allow');
  // path inside, database outside: the tool opens database.
  expect(decide('Database', { action: 'tables', path: 'app.db', database: join(away, 'other.db') }, ctx(cwd)).decision).toBe('deny');
  expect(decide('Database', { action: 'tables', database: 'link-out/other.db' }, ctx(cwd)).decision).toBe('deny');
  expect(decide('LSP', { operation: 'symbols', path: 'index.html' }, ctx(cwd)).decision).toBe('allow');
});

test('the Browser reads a file URL as the browser does: localhost and %2e%2e are not in the project', () => {
  const cwd = project();
  for (const url of ['file:///etc/passwd', 'file://localhost/etc/passwd', `file://${cwd}/%2e%2e/%2e%2e/%2e%2e/etc/passwd`]) expect({ url, d: decide('Browser', { action: 'open', url }, ctx(cwd)).decision }).toEqual({ url, d: 'deny' });
  expect(decide('Browser', { action: 'open', url: 'index.html' }, ctx(cwd)).decision).toBe('allow');
  expect(decide('Browser', { action: 'open', url: `file://${cwd}/index.html` }, ctx(cwd)).decision).toBe('allow');
});

test('Edit takes a near copy of old_text before it calls an edit "already in the file"', () => {
  const text = 'function f() {\n  const total = price * count;\n  return total;\n}\nfunction g() {\n  return total;\n}\n';
  // One wrong letter in old_text, and new_text a line g already has: it said done and changed nothing.
  const m = findEdit(text, '  const totl = price * count;\n  return total;', '  return total;');
  expect(m.ok).toBe(true);
  expect(m.how).toBe('fuzzy');
  expect(m.after).toBe('function f() {\n  return total;\n}\nfunction g() {\n  return total;\n}\n');
  // A change already made is still done.
  const again = findEdit(m.after, '  const total = price * count;\n  return total;', '  return total;');
  expect(again.done).toBe(true);
});

test('a background job keeps letters whole when one is cut between two pieces of output', async () => {
  const jobs = new Jobs({ firstMs: 50 });
  const cwd = project();
  // "é" is two bytes; the printf writes the first byte, waits, then the second.
  const { job } = await jobs.start(`printf 'caf\\303'; sleep 0.3; printf '\\251\\n'`, { cwd, sandbox: false });
  for (let i = 0; i < 60 && !job.ended; i++) await new Promise((r) => setTimeout(r, 50));
  expect(job.out).toContain('café');
  expect(job.out).not.toContain('�');
});

test.skipIf(needs('sandbox', sandboxAvailable))('the plain sandbox keeps ~/.npmrc and the cloud keys shut, as Bypass does', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tools-audit-home-')));
  mkdirSync(join(home, 'proj'));
  mkdirSync(join(home, '.aws'));
  writeFileSync(join(home, '.npmrc'), '//registry.npmjs.org/:_authToken=FAKE\n');
  writeFileSync(join(home, '.aws', 'credentials'), 'aws_secret=FAKE\n');
  for (const open of [false, true]) {
    const prof = sandboxProfile(join(home, 'proj'), { home, open });
    for (const f of ['.npmrc', '.aws/credentials']) {
      const r = spawnSync(SANDBOX_EXEC, ['-p', prof, '/bin/sh', '-c', `cat ${JSON.stringify(join(home, f))}`], { encoding: 'utf8' });
      expect({ open, f, read: r.status === 0 && r.stdout.includes('FAKE') }).toEqual({ open, f, read: false });
    }
  }
  // Work in the project still goes on.
  const r = spawnSync(SANDBOX_EXEC, ['-p', sandboxProfile(join(home, 'proj'), { home }), '/bin/sh', '-c', 'echo x > made.txt && cat made.txt'], { cwd: join(home, 'proj'), encoding: 'utf8' });
  expect(r.stdout.trim()).toBe('x');
});
