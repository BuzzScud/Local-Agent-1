// /permissions shows its Screen row without building the media helper (19 Oct 2026, the UI sweep): screenAccess() asks
// the helper, and the first ask builds it with the Swift compiler, so the first /permissions on a new copy, or after
// media-tool.swift changed, held the whole app for seconds. screenAccessKnown() answers null while the helper is not
// built, and builds nothing. A home of its own, so no other test's build counts.
import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-screen-known-'));
delete process.env.AGENTIC_SCREEN_FAKE;
const media = await import('../src/tools/media.mjs');
const screen = await import('../src/tools/screen.mjs');

test('with the helper not built, the Screen row is "not checked yet" at once, and nothing is built', () => {
  expect(media.mediaToolBuilt()).toBe(false);
  const t0 = performance.now();
  expect(screen.screenAccessKnown()).toBeNull();
  expect(performance.now() - t0).toBeLessThan(200);
  const tools = join(process.env.AGENTIC_HOME, 'tools');
  expect(existsSync(tools) ? readdirSync(tools) : []).toEqual([]);
});
