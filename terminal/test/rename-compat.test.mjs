// The rename from Bonsai Code to Agentic Coder: the old names still work (a BONSAI_*
// switch, the old state-folder switch), the new name wins when both are set, and the
// places that used to know only the old name know both now. (An old .bonsai/ project
// folder is covered where it is read: memory.test, facts.test, settings.test.)
import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { msEnv } from '../src/app/update.mjs';
import { memoryOn } from '../src/app/autosave.mjs';
import { plistText, install } from '../src/app/review.mjs';

// Sets some names for one call and puts them back afterwards.
const withEnv = (vars, fn) => {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const put = (o) => { for (const [k, v] of Object.entries(o)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  try { put(vars); return fn(); } finally { put(was); }
};

test('a BONSAI_* switch still works, and its AGENTIC_* twin wins when both are set', () => {
  withEnv({ AGENTIC_NO_MEMORY: undefined, BONSAI_NO_MEMORY: '1' }, () => expect(memoryOn({})).toBe(false));
  withEnv({ AGENTIC_NO_MEMORY: '1', BONSAI_NO_MEMORY: undefined }, () => expect(memoryOn({})).toBe(false));
  withEnv({ AGENTIC_NO_MEMORY: '0', BONSAI_NO_MEMORY: '1' }, () => expect(memoryOn({})).toBe(true));
  withEnv({ AGENTIC_NO_MEMORY: undefined, BONSAI_NO_MEMORY: undefined }, () => expect(memoryOn({})).toBe(true));
});

test('the update timers answer to both names (they knew only the old ones)', () => {
  withEnv({ AGENTIC_UPDATE_EVERY: '123', BONSAI_UPDATE_EVERY: undefined }, () => expect(msEnv('UPDATE_EVERY', 20000)).toBe(123));
  withEnv({ AGENTIC_UPDATE_EVERY: undefined, BONSAI_UPDATE_EVERY: '456' }, () => expect(msEnv('UPDATE_EVERY', 20000)).toBe(456));
  withEnv({ AGENTIC_UPDATE_EVERY: '123', BONSAI_UPDATE_EVERY: '456' }, () => expect(msEnv('UPDATE_EVERY', 20000)).toBe(123));
  withEnv({ AGENTIC_UPDATE_EVERY: undefined, BONSAI_UPDATE_EVERY: undefined }, () => expect(msEnv('UPDATE_EVERY', 20000)).toBe(20000));
  withEnv({ AGENTIC_FETCH_EVERY: '0', BONSAI_FETCH_EVERY: undefined }, () => expect(msEnv('FETCH_EVERY', 300000)).toBe(0)); // 0 = never
});

// The state folder is read when registry.mjs loads, so each try is its own process.
const homeWith = (env) => {
  const clean = { ...process.env }; delete clean.AGENTIC_HOME; delete clean.BONSAI_HOME;
  const script = `const { HOME } = await import(${JSON.stringify(join(import.meta.dir, '..', '..', 'models', 'registry.mjs'))}); console.log(HOME);`;
  const r = spawnSync('bun', ['-e', script], { encoding: 'utf8', env: { ...clean, ...env }, timeout: 20_000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
};

test('the state folder: AGENTIC_HOME wins, and the old BONSAI_HOME still works', () => {
  expect(homeWith({ BONSAI_HOME: '/tmp/old-home' })).toBe('/tmp/old-home');
  expect(homeWith({ AGENTIC_HOME: '/tmp/new-home', BONSAI_HOME: '/tmp/old-home' })).toBe('/tmp/new-home');
});

test('the nightly review is scheduled under the new job name and the new switch, for the app that is really installed', () => {
  const p = plistText('/Users/me/.agentic-coder/app/agentic-coder');
  expect(p).toContain('<key>Label</key><string>com.agentic-coder.memory-review</string>');
  expect(p).toContain('<key>AGENTIC_NO_UPDATE</key>');
  expect(p.toLowerCase()).not.toContain('bonsai');
  // With no app there, it says so in the new name and touches nothing (no scheduler call).
  expect(() => install({ bin: '/nonexistent/agentic-coder' })).toThrow('the Agentic Coder app is not installed');
});
