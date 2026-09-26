// Settings, layered (src/app/store.mjs): a trusted folder's
// .bonsai/settings.json sets mode, effort and layout over the global file;
// anything else in it is ignored, and an untrusted folder sets nothing.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BONSAI_HOME ??= mkdtempSync(join(tmpdir(), 'bonsai-settings-home-'));
const { loadSettings } = await import('../src/app/store.mjs');
const { saveTrust } = await import('../src/app/trust.mjs');

function project(fileBody) {
  const cwd = mkdtempSync(join(tmpdir(), 'bonsai-settings-'));
  mkdirSync(join(cwd, '.bonsai'), { recursive: true });
  writeFileSync(join(cwd, '.bonsai', 'settings.json'), fileBody);
  return cwd;
}

test('a trusted folder sets mode, effort and layout; junk keys and bad values are ignored', () => {
  const cwd = project(JSON.stringify({ mode: 'edits', effort: 'high', layout: 'live', model: 'other', rm: '-rf' }));
  expect(loadSettings(cwd).fromFolder).toBeUndefined(); // not trusted yet
  saveTrust(cwd);
  const s = loadSettings(cwd);
  expect(s.mode).toBe('edits');
  expect(s.effort).toBe('high');
  expect(s.thinking).toBe(true);
  expect(s.layout).toBe('live');
  expect(s.model).toBe('27b'); // a folder cannot switch the model
  expect(s.rm).toBeUndefined();
  const bad = project(JSON.stringify({ mode: 'anything-goes', layout: 'huge' }));
  saveTrust(bad);
  const b = loadSettings(bad);
  expect(b.mode).not.toBe('anything-goes');
  expect(b.layout).not.toBe('huge');
});

test('effort low in a folder file means no thinking (and the old name off still works)', () => {
  for (const name of ['low', 'off']) {
    const cwd = project(JSON.stringify({ effort: name }));
    saveTrust(cwd);
    const s = loadSettings(cwd);
    expect(s.thinking).toBe(false);
    expect(s.effort).toBeUndefined();
  }
});
