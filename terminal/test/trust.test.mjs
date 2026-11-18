// Folder trust (src/app/trust.mjs): remembered once, covering the folder
// and everything inside it, in the Agentic Coder home's trust.json.
import { test, expect } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-trust-home-'));
const { isTrusted, saveTrust, trustedRoot } = await import('../src/app/trust.mjs');

test('nothing is trusted until saved; a yes covers the folder and its children', () => {
  const a = mkdtempSync(join(tmpdir(), 'agentic-trust-a-'));
  expect(isTrusted(a)).toBe(false);
  saveTrust(a);
  expect(isTrusted(a)).toBe(true);
  expect(isTrusted(join(a, 'deep', 'inside'))).toBe(true);
  // tmpdir is a link on macOS (/var → /private/var): both spellings match.
  expect(trustedRoot(join(a, 'deep'))).toBe(realpathSync(a));
  // A sibling whose name only starts the same is not covered.
  expect(isTrusted(`${a}x`)).toBe(false);
  expect(isTrusted(tmpdir())).toBe(false);
});

// The audit of 18 Nov 2026: an unreadable trust.json was read as {} and the next yes wrote {} plus that one folder over
// every folder you had trusted. Now it is left as it is (a copy kept aside), and a save is written whole.
test('an unreadable trust.json is never written over: the yes holds for this start only, a copy is kept; written whole after', async () => {
  const { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } = await import('node:fs');
  const { forgetTrust } = await import('../src/app/trust.mjs');
  const { backupsDir } = await import('../src/app/store.mjs');
  const file = join(process.env.AGENTIC_HOME, 'trust.json');
  const was = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const broken = '{ "/Users/me/project-a": "2026-10-01T00:00:00.000Z", oops }';
  writeFileSync(file, broken);
  const dir = backupsDir('trust');
  const copies = () => (existsSync(dir) ? readdirSync(dir).length : 0);
  const before = copies();
  const b = mkdtempSync(join(tmpdir(), 'agentic-trust-b-'));
  expect(saveTrust(b)).toBe(false);
  expect(saveTrust(b)).toBe(false);
  expect(forgetTrust('/Users/me/project-a')).toBe(false);
  expect(readFileSync(file, 'utf8')).toBe(broken); // as it was
  expect(isTrusted(b)).toBe(false); // nothing counts while it cannot be read: the safety check asks
  expect(copies()).toBe(before + 1); // one copy of this version, not one a save
  rmSync(file);
  expect(saveTrust(b)).toBe(true);
  expect(isTrusted(b)).toBe(true);
  expect(readdirSync(process.env.AGENTIC_HOME).filter((f) => f.startsWith('trust.json.'))).toEqual([]); // no file left beside it
  expect(forgetTrust(b)).toBe(true);
  expect(isTrusted(b)).toBe(false);
  if (was !== null) writeFileSync(file, was);
});
