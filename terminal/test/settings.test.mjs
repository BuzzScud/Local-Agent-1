// Settings, layered (src/app/store.mjs): a trusted folder's
// .agentic/settings.json sets mode and effort over the global file;
// anything else in it is ignored, and an untrusted folder sets nothing.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-settings-home-'));
const { loadSettings } = await import('../src/app/store.mjs');
const { saveTrust } = await import('../src/app/trust.mjs');

function project(fileBody) {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-settings-'));
  mkdirSync(join(cwd, '.agentic'), { recursive: true });
  writeFileSync(join(cwd, '.agentic', 'settings.json'), fileBody);
  return cwd;
}

test('a trusted folder sets mode and effort; junk keys (layout is gone) and bad values are ignored', () => {
  const cwd = project(JSON.stringify({ mode: 'edits', effort: 'high', layout: 'live', model: 'other', rm: '-rf' }));
  expect(loadSettings(cwd).fromFolder).toBeUndefined(); // not trusted yet
  saveTrust(cwd);
  const s = loadSettings(cwd);
  expect(s.mode).toBe('edits');
  expect(s.effort).toBe('high');
  expect(s.thinking).toBe(true);
  expect(s.layout).toBeUndefined(); // one layout now, like Claude Code: the key is ignored
  expect(s.model).toBe('qwen'); // a folder cannot switch the model (the default, Qwen, stays)
  expect(s.rm).toBeUndefined();
  const bad = project(JSON.stringify({ mode: 'anything-goes' }));
  saveTrust(bad);
  const b = loadSettings(bad);
  expect(b.mode).not.toBe('anything-goes');
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

// The audit of 18 Nov 2026: a settings.json that did not parse was read as the defaults, and the next save (the window's
// first, its lastMode) wrote the defaults over it: every service, key end and limit gone. Now it is left as it is.
test('a settings.json that cannot be read is never written over: a copy is kept once, the save holds for the window only', async () => {
  const { saveSettings, settingsProblem, onSettingsRefused, backupsDir, SETTINGS_FILE } = await import('../src/app/store.mjs');
  const broken = '{ "remote": { "url": "http://10.0.0.5:11434" }, "limits": { "steps": 40 }, oops }\n';
  writeFileSync(SETTINGS_FILE, broken);
  const told = [];
  onSettingsRefused((t) => told.push(t));
  try {
    const dir = backupsDir('settings');
    const copies = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0);
    const before = copies();
    const next = saveSettings({ lastMode: 'edits' });
    expect(next.lastMode).toBe('edits'); // this window's own copy has it
    expect(readFileSync(SETTINGS_FILE, 'utf8')).toBe(broken); // the file is as it was
    saveSettings({ meters: true });
    saveSettings((now) => ({ remotes: { ...(now.remotes ?? {}), x: { url: 'http://x' } } }));
    expect(readFileSync(SETTINGS_FILE, 'utf8')).toBe(broken);
    // one copy of this version, not one a save, and one note
    expect(copies()).toBe(before + 1);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/cannot be read .* saves nothing to it: fix or delete it/);
    expect(settingsProblem()).toMatch(/A copy is kept in /);
    // fixed by hand: saves go on as before
    writeFileSync(SETTINGS_FILE, '{ "meters": false }\n');
    expect(settingsProblem()).toBeNull();
    saveSettings({ meters: true });
    expect(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')).meters).toBe(true);
  } finally { onSettingsRefused(null); rmSync(SETTINGS_FILE, { force: true }); }
});

test('the App tool never reaches past settings.json: __proto__, constructor and prototype are refused, a broken file is said', async () => {
  const { appBridge } = await import('../src/app/app-self.mjs');
  const { SETTINGS_FILE } = await import('../src/app/store.mjs');
  const app = appBridge({});
  try {
    for (const key of ['__proto__.polluted', 'constructor.prototype.polluted', 'a.__proto__.mode', '__proto__.mode']) {
      const r = await app.setting(key, 'yes');
      expect(r.error).toMatch(/not a setting/);
    }
    expect({}.polluted).toBeUndefined();
    expect((await app.setting('__proto__')).error).toMatch(/not a setting/);
    expect((await app.setting('mode', 'bypass')).error).toMatch(/use \/mode/);
    expect((await app.setting('meters', 'true')).value).toBe(true);
    expect((await app.setting('meters')).value).toBe(true);
    writeFileSync(SETTINGS_FILE, '{ nope');
    expect((await app.setting('meters', 'false')).error).toMatch(/cannot be read/);
    expect(readFileSync(SETTINGS_FILE, 'utf8')).toBe('{ nope');
  } finally { rmSync(SETTINGS_FILE, { force: true }); }
});
