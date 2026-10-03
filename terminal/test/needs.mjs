// What a test needs from this Mac beyond Bun and node (3 Oct 2026, the fix plan's Part 5b): a tool that
// is missing turns the tests that need it into named skips, not failures; a tool that is here is always
// used, never skipped. Each skip prints one line, "(skipped: no pytest)", which run-suite.mjs counts by
// its reason for the run's last line and the test record.
//   test.skipIf(needs('pytest'))('…', …)
//   test.skipIf(needs('chrome', findChrome))('…', …)       the file's own way to find it
//   test.skipIf(needs('pictures', media.mediaTool))('…', …) the file's own build of the picture helper
//   needs('pytest') is asked once for each test it guards: each skipped test prints its own line.
// AGENTIC_TEST_HIDE=pytest,chrome,… hides a tool that is here (needs.test.mjs checks the skips that way).
// The models part's tests cannot import this file (the two parts meet at one file each way), so the
// tests' preload (test-env.mjs) also puts it on globalThis: globalThis.needs('pytest').
import { spawnSync } from 'node:child_process';

export const REASONS = {
  python3: 'no python3',
  pytest: 'no pytest',
  chrome: 'no Chrome',
  pictures: 'no picture helper',
  playwright: 'no Playwright',
  sandbox: 'no macOS sandbox',
};
const CHECKS = {
  python3: () => spawnSync('python3', ['-c', 'pass'], { timeout: 20_000 }).status === 0,
  pytest: () => spawnSync('python3', ['-m', 'pytest', '--version'], { timeout: 60_000 }).status === 0,
  // The file's own finder: a path, or nothing.
  chrome: (find) => Boolean(find?.()),
  // The file's own build (media.mjs mediaTool): it throws when the helper cannot be built here.
  pictures: (build) => { try { return Boolean(build?.()); } catch { return false; } },
  // The file's own finder again: a folder that holds Playwright; whether sandbox-exec works here.
  playwright: (find) => Boolean(find?.()),
  sandbox: (find) => Boolean(find?.()),
};
const known = new Map();
export const hiddenTools = (env = process.env) => String(env.AGENTIC_TEST_HIDE ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// The reason to skip (a string, so test.skipIf skips), or false when the tool is here.
export function needs(tool, probe, { quiet = false } = {}) {
  const why = REASONS[tool];
  if (!why) throw new Error(`needs(): no tool called "${tool}" (${Object.keys(REASONS).join(', ')})`);
  let here = hiddenTools().includes(tool) ? false : known.get(tool);
  if (here === undefined) { try { here = Boolean(CHECKS[tool](probe)); } catch { here = false; } known.set(tool, here); }
  if (here) return false;
  if (!quiet) process.stdout.write(`(skipped: ${why})\n`);
  return why;
}
