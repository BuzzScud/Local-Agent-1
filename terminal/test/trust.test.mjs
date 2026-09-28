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
