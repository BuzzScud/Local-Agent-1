// Your services stay saved (12 Oct 2026, saved-services.mjs, store.mjs, runtime/remote.mjs keyStore). The owner kept
// typing in their other service's address and their Claude key: a window wrote back the services it read when it
// opened (a model's context, its own settings, a model picked, the /remote form), so one saved in another window
// since was lost; a copy of the app with a home of its own wrote its keys over theirs in the Keychain; nothing put
// back what was lost. Here: each save on the file as it is, two windows and eight processes saving together, the
// backups, a window following another's saves and writing back one it lost, the repair at a window's start, the
// key store of a copy, and a preview's services; then two real windows.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runInPty } from './pty.mjs';
import { T, setup, quit } from './app-setup.mjs';
import { fakeOllama } from './fake-ollama.mjs';

const { HOME } = await import('../../models/index.mjs');
const { loadSettings, saveSettings, saveService, saveUse, readCopies, backupsDir, KEEP_COPIES } = await import('../src/app/store.mjs');
const { openForm, savePlan } = await import('../src/app/remote-form.mjs');
const { followSaved, savedWatch, repairServices, repairNow, seedCopy } = await import('../src/app/saved-services.mjs');
const { writeProfiles } = await import('../src/app/profiles.mjs');

const FILE = join(HOME, 'settings.json');
const SVC = { source: 'openai', address: 'http://10.0.0.20:60009', port: null, connect: 'http', kind: 'openai', model: 'Qwen3.6:35B-A3B', context: 0, key: false, keyEnd: '', keyId: 'openai' };
const CLAUDE = { source: 'claude', address: '', port: null, connect: 'https', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: 'ab12', keyId: 'claude' };
const write = (s) => writeFileSync(FILE, JSON.stringify(s));
const file = () => JSON.parse(readFileSync(FILE, 'utf8'));

beforeEach(() => {
  rmSync(join(HOME, 'backups'), { recursive: true, force: true });
  rmSync(join(HOME, 'profiles.json'), { force: true });
  write({ remote: { ...SVC, use: true }, remotes: { openai: SVC } });
});

test('a window opened before the Claude API was saved elsewhere keeps it when it saves its own change (each path the old code lost it on)', () => {
  // A model's context (/effort on a service) and a model's own settings: one service changed, on the file as it is.
  for (const change of [(p) => ({ ...p, contexts: { 'gemma4:e4b': 32768 } }), (p) => ({ ...p, tuned: { 'gemma4:e4b': { level: 'high' } } })]) {
    write({ remote: { ...SVC, use: true }, remotes: { openai: SVC } });
    const windowA = loadSettings();
    saveSettings({ remotes: { ...loadSettings().remotes, claude: CLAUDE } }); // window B connects the Claude API
    saveService('openai', change);
    expect(Object.keys(file().remotes).sort()).toEqual(['claude', 'openai']);
    expect(file().remotes.openai).toEqual(change(SVC));
    expect(file().remote).toEqual(change({ ...SVC, use: true }));
    expect(windowA.remotes.claude).toBeUndefined(); // what window A had read: the old code wrote this back
  }
  // Another model picked on the service (this window's pick for the next start).
  saveService('openai', (p) => ({ ...p, model: 'gemma4:e4b' }), { remote: { ...SVC, model: 'gemma4:e4b', use: true } });
  expect(file().remotes.claude).toEqual(CLAUDE);
  expect(file().remotes.openai.model).toBe('gemma4:e4b');
  // On and off: the service as the file has it now (an address saved since stays), this window's model.
  saveSettings({ remotes: { ...file().remotes, openai: { ...file().remotes.openai, address: 'http://10.0.0.21:60009' } } });
  saveUse({ ...SVC, model: 'gemma4:e4b' }, false, { model: 'qwen' });
  expect(file().remote).toMatchObject({ address: 'http://10.0.0.21:60009', model: 'gemma4:e4b', use: false });
  expect(file().model).toBe('qwen');
});

test('the /remote form writes what it changed, field by field, over the file as it is now', () => {
  const windowA = loadSettings();
  const form = openForm(windowA, { on: true });
  // Meanwhile another window saved the Claude API and moved the service to a new address.
  saveSettings({ remotes: { openai: { ...SVC, address: 'http://10.0.0.21:60009', contexts: { 'qwen3.5:9b-q8_0': 32768 } }, claude: CLAUDE } });
  // This window's form changes only the service's model, then Save only.
  form.profiles.openai = { ...form.profiles.openai, model: 'gemma4:e4b' };
  const plan = savePlan(form, loadSettings(), { connect: false });
  expect(plan.remotes.claude).toEqual(CLAUDE);
  expect(plan.remotes.openai).toMatchObject({ address: 'http://10.0.0.21:60009', model: 'gemma4:e4b', contexts: { 'qwen3.5:9b-q8_0': 32768 } });
  // The form's shown service unchanged: the file's copy stands as it is.
  const still = savePlan(openForm(windowA, { on: true }), loadSettings(), { connect: false });
  expect(still.remotes.openai.address).toBe('http://10.0.0.21:60009');
  // A remote saved in the older shape only ("remote" alone) is still kept in its service's place.
  const old = savePlan(openForm({ remote: { ...SVC, use: false } }), { remote: { ...SVC, use: false } }, { connect: false });
  expect(old.remotes.openai).toMatchObject({ address: SVC.address, model: SVC.model });
});

test('eight processes saving at once lose nothing (the lock), and the file is never half written', async () => {
  const store = JSON.stringify(join(import.meta.dir, '..', 'src', 'app', 'store.mjs'));
  const runs = Array.from({ length: 8 }, (_, i) => new Promise((resolve) => {
    const script = `const { saveSettings } = await import(${store});
      for (let j = 1; j <= 25; j++) saveSettings((now) => ({ remotes: { ...(now.remotes ?? {}), ['p${i}']: { n: j } } }));`;
    const c = spawn('bun', ['-e', script], { env: process.env, stdio: 'ignore' });
    c.on('exit', resolve);
  }));
  await Promise.all(runs);
  const r = file().remotes;
  for (let i = 0; i < 8; i++) expect(r[`p${i}`]).toEqual({ n: 25 });
  expect(r.openai).toEqual(SVC);
  expect(readdirSync(HOME).filter((f) => f.startsWith('settings.json.'))).toEqual([]); // no lock or part file left
}, 60_000);

test('a copy of the file before each change of your services is kept, the newest 20; other changes keep none', () => {
  saveSettings({ lastMode: 'bypass' });
  expect(existsSync(backupsDir('settings'))).toBe(false);
  for (let i = 0; i < 25; i++) saveService('openai', (p) => ({ ...p, model: `m${i}` }));
  const copies = readCopies('settings');
  expect(copies).toHaveLength(KEEP_COPIES);
  expect(copies[0].data.remotes.openai.model).toBe('m23'); // the newest copy: the file before the last change
  // profiles.json too, when it changes.
  writeProfiles({ profiles: { Main: { server: { source: 'openai' }, model: 'a' } }, uses: {} });
  writeProfiles({ profiles: { Main: { server: { source: 'openai' }, model: 'b' } }, uses: {} });
  writeProfiles({ profiles: { Main: { server: { source: 'openai' }, model: 'b' } }, uses: {} });
  expect(readCopies('profiles').map((c) => c.data.profiles.Main.model)).toEqual(['a']);
});

test('an open window takes what another window saved, keeping its own model and on/off; one the file lost is written back', () => {
  const mine = loadSettings();
  mine.remote = { ...mine.remote, model: 'gemma4:e4b' };
  const tick = savedWatch(mine);
  expect(tick()).toEqual([]); // nothing changed
  saveSettings({ remotes: { openai: { ...SVC, address: 'http://10.0.0.21:60009' }, claude: CLAUDE }, memoryToRemote: 'all' });
  expect(tick()).toEqual([]);
  expect(mine.remotes.claude).toEqual(CLAUDE);
  expect(mine.memoryToRemote).toBe('all');
  expect(mine.remote).toMatchObject({ address: 'http://10.0.0.21:60009', model: 'gemma4:e4b', use: true });
  // A window on a version from before this writes the services as it read them: the Claude API is gone.
  write({ ...file(), remotes: { openai: file().remotes.openai } });
  expect(tick()).toEqual(['Kept the Claude API set-up: another window had saved settings without it.']);
  expect(file().remotes.claude).toEqual(CLAUDE);
  expect(followSaved({ remote: { ...SVC, use: false } }, file())).toBe(true);
});

test('at a window\'s start: a service lost from settings.json but used by a profile, or with its key kept, comes back; a key\'s end is set right', () => {
  const profiles = { profiles: { Main: { server: { kind: 'claude', source: 'claude', keyId: 'claude' }, model: 'claude-opus-5-5' }, Fast: { server: { kind: 'openai', source: 'openai', address: SVC.address, connect: 'http', keyId: 'openai' }, model: 'llama3.2:3b' } } };
  const keys = { claude: 'test-claude-key-000000ab12' };
  const keyOf = (id) => keys[id] ?? null;
  // From the newest backup that has it (contexts and all), else from the profile.
  const backup = [{ data: { remotes: { openai: { ...SVC, contexts: { 'gemma4:e4b': 32768 } } } } }];
  const a = repairServices({ settings: { remotes: {} }, profiles, copies: backup, keyOf });
  expect(a.patch.remotes.openai.contexts).toEqual({ 'gemma4:e4b': 32768 });
  expect(a.patch.remotes.claude).toMatchObject({ kind: 'claude', key: true, keyEnd: 'ab12', model: 'claude-opus-5-5' });
  expect(a.said).toEqual([
    'Brought back the Claude API set-up: settings.json had lost it; taken from your profiles.',
    `Brought back the other service set-up (${SVC.address}): settings.json had lost it; taken from its last backup.`,
  ]);
  // The Claude key alone (no profile): enough to bring it back. A service with neither: left out.
  const b = repairServices({ settings: { remotes: {} }, profiles: null, keyOf });
  expect(Object.keys(b.patch.remotes)).toEqual(['claude']);
  // Their own case on 12 Oct: settings.json named a key's end that was not the key kept's.
  const c = repairServices({ settings: { remote: { ...CLAUDE, keyEnd: 'cd34', use: true }, remotes: { claude: { ...CLAUDE, keyEnd: 'cd34' } } }, keyOf });
  expect(c.patch.remotes.claude.keyEnd).toBe('ab12');
  expect(c.patch.remote).toMatchObject({ keyEnd: 'ab12', use: true });
  expect(c.said).toEqual([]);
  // A key named but not kept: said, nothing changed.
  const d = repairServices({ settings: { remotes: { claude: CLAUDE } }, keyOf: () => null });
  expect(d.patch).toBe(null);
  expect(d.said).toEqual(['The Claude API key is not kept any more: /remote claude to type it once.']);
  // On the real files (this test's home): profiles.json and a backup.
  writeProfiles(profiles);
  write({ remotes: {} });
  saveSettings({ remotes: { openai: SVC } }); // a backup of the file before (empty), then the service
  write({ remotes: {} }); // lost
  process.env.AGENTIC_SERVICES_REPAIR = 'on';
  try { expect(repairNow()).toContain('Brought back the other service set-up (http://10.0.0.20:60009): settings.json had lost it; taken from your profiles.'); }
  finally { process.env.AGENTIC_SERVICES_REPAIR = 'off'; }
  expect(file().remotes.openai).toMatchObject({ address: SVC.address, model: 'llama3.2:3b' });
});

test('a copy of the app with a home of its own keeps its keys to itself and reads yours; your own home keeps the Keychain', () => {
  const remote = JSON.stringify(join(import.meta.dir, '..', '..', 'models', 'runtime', 'remote.mjs'));
  const script = `const m = await import(${remote}); console.log(JSON.stringify({ store: m.keyStore(), reads: m.readsYours() }));`;
  const { NODE_ENV, AGENTIC_REMOTE_KEYSTORE, AGENTIC_HOME, ...plain } = process.env;
  const run = (env) => JSON.parse(spawnSync('bun', ['-e', script], { encoding: 'utf8', env }).stdout.trim());
  const copy = mkdtempSync(join(tmpdir(), 'agentic-copy-'));
  const mac = process.platform === 'darwin';
  expect(run({ ...plain, AGENTIC_HOME: copy })).toEqual({ store: 'file', reads: mac });
  expect(run({ ...plain, AGENTIC_HOME: copy, NODE_ENV: 'test' })).toEqual({ store: 'file', reads: false }); // a test never reads yours
  expect(run({ ...plain, AGENTIC_HOME: copy, AGENTIC_YOUR_KEYS: 'off' })).toEqual({ store: 'file', reads: false });
  expect(run({ ...plain, AGENTIC_HOME: copy, AGENTIC_REMOTE_KEYSTORE: 'file' })).toEqual({ store: 'file', reads: false });
  // Your own home (a pretend one): the Keychain on a Mac, as before.
  const you = mkdtempSync(join(tmpdir(), 'agentic-you-'));
  expect(run({ ...plain, HOME: you, AGENTIC_HOME: join(you, '.agentic-coder') })).toEqual({ store: mac ? 'keychain' : 'file', reads: false });
  expect(run({ ...plain, HOME: you })).toEqual({ store: mac ? 'keychain' : 'file', reads: false });
});

test('a preview\'s home starts with your services and profiles, once; never in a test run, nor over its own settings', () => {
  const yours = mkdtempSync(join(tmpdir(), 'agentic-yours-'));
  writeFileSync(join(yours, 'settings.json'), JSON.stringify({ remote: { ...CLAUDE, use: true }, remotes: { claude: CLAUDE, openai: SVC }, memoryToRemote: 'mine', lastMode: 'bypass', bot: false }));
  writeFileSync(join(yours, 'profiles.json'), JSON.stringify({ profiles: { Main: { model: 'claude-opus-5-5' } }, uses: {} }));
  const copy = join(mkdtempSync(join(tmpdir(), 'agentic-copy-')), 'home');
  expect(seedCopy({ home: copy, from: yours })).toBe(false); // a test run
  const was = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  try {
    expect(seedCopy({ home: copy, from: yours })).toBe(true);
    expect(JSON.parse(readFileSync(join(copy, 'settings.json'), 'utf8'))).toEqual({ remote: { ...CLAUDE, use: true }, remotes: { claude: CLAUDE, openai: SVC }, memoryToRemote: 'mine' });
    expect(JSON.parse(readFileSync(join(copy, 'profiles.json'), 'utf8')).profiles.Main.model).toBe('claude-opus-5-5');
    expect(seedCopy({ home: copy, from: yours })).toBe(false); // its own settings now
    process.env.AGENTIC_SEED = 'off';
    expect(seedCopy({ home: join(copy, 'other'), from: yours })).toBe(false);
  } finally { process.env.NODE_ENV = was; delete process.env.AGENTIC_SEED; }
});

// Two real windows: the service saved in this one, the Claude API saved by "another window" (the test) after it
// opened. Before 12 Oct, Save only in /remote wrote back the services this window had read, and the Claude API
// was gone; then a window on an older version drops it, and this one writes it back.
const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const right = (n) => Array.from({ length: n }, () => [{ key: 'right' }, { sleep: 90 }]).flat();
test('the real window: Save only in /remote keeps the Claude API saved elsewhere since it opened; one dropped by another window comes back', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  const home = join(base, 'home');
  const settingsOf = () => JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
  const service = { ...SVC, address: svc.url, model: 'coder:30b' };
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote: { ...service, use: false }, remotes: { openai: service } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, AGENTIC_MODEL_AT_START: 'off' }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: '? for shortcuts' }, { sleep: 600 },
    { fn: () => { const s = settingsOf(); writeFileSync(join(home, 'settings.json'), JSON.stringify({ ...s, remotes: { ...s.remotes, claude: CLAUDE } })); } },
    { sleep: 2600 },
    { type: '/remote' }, { key: 'enter' }, { wait: 'Remote model' }, { sleep: 200 }, ...right(3), { key: 'up' }, { sleep: 120 }, { key: 'right' }, { sleep: 120 },
    { key: 'enter' }, { wait: 'now?' }, { sleep: 200 }, { key: 'esc' }, { wait: 'Left saved' }, { sleep: 300 },
    { fn: () => { const s = settingsOf(); writeFileSync(join(home, 'settings.json'), JSON.stringify({ ...s, remotes: { openai: s.remotes.openai } })); } },
    { wait: 'Kept the Claude API set-up', ms: 8000 }, { sleep: 300 }, { snapshot: 'kept' },
    ...quit,
  ] });
  await svc.close();
  const s = settingsOf();
  expect(Object.keys(s.remotes).sort()).toEqual(['claude', 'openai']);
  expect(s.remotes.claude).toEqual(CLAUDE);
  expect(s.remotes.openai.address).toBe(svc.url);
  expect(r.snapshots.kept.replace(/\s+/g, ' ')).toContain('Kept the Claude API set-up: another window had saved settings without it.');
}, T);

// The two parts the tests above call directly, through the real window (12 Oct 2026, found by planting: taking either
// call out of App.jsx or cli.jsx failed no test). At the start, a service settings.json lost but profiles.json uses
// comes back and is said; a preview's home (not yours, no settings yet) starts with your services, read from a pretend
// home here (HOME), with the real Keychain never read (AGENTIC_YOUR_KEYS=off).
test('the real window: at its start a service settings.json lost comes back and is said', async () => {
  const { cwd, env, base } = setup();
  const svc = await fakeOllama();
  const home = join(base, 'home');
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ remotes: {} }));
  const server = { kind: 'openai', source: 'openai', address: svc.url, port: null, connect: 'http', keyId: 'openai' };
  writeFileSync(join(home, 'profiles.json'), JSON.stringify({ profiles: { Fast: { server, model: 'coder:30b', backup: null, spillAfter: 0 } }, uses: { 'ai:side': 'Fast' } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, AGENTIC_MODEL_AT_START: 'off', AGENTIC_SERVICES_REPAIR: 'on' }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: '? for shortcuts' }, { wait: 'Brought back the other service set-up', ms: 10_000 }, { sleep: 300 }, { snapshot: 'start' },
    ...quit,
  ] });
  await svc.close();
  expect(r.snapshots.start.replace(/\s+/g, ' ')).toContain(`Brought back the other service set-up (${svc.url}): settings.json had lost it; taken from your profiles.`);
  expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).remotes.openai).toMatchObject({ address: svc.url, model: 'coder:30b' });
}, T);

test('the real window: a preview\'s home starts with your services and profiles, and says so', async () => {
  const { cwd, env, base } = setup();
  const you = join(base, 'you');
  mkdirSync(join(you, '.agentic-coder'), { recursive: true });
  const service = { ...SVC, address: 'http://10.0.0.20:60009' };
  writeFileSync(join(you, '.agentic-coder', 'settings.json'), JSON.stringify({ remote: { ...service, use: false }, remotes: { openai: service, claude: CLAUDE }, lastMode: 'bypass' }));
  writeFileSync(join(you, '.agentic-coder', 'profiles.json'), JSON.stringify({ profiles: {}, uses: {} }));
  const r = await runInPty({ cwd, env: { ...env, HOME: you, NODE_ENV: '', AGENTIC_YOUR_KEYS: 'off', AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '', AGENTIC_MODEL_AT_START: 'off' }, args: ['--no-flows'], timeoutMs: 60_000, steps: [
    { wait: '? for shortcuts' }, { wait: 'This copy has a home of its own', ms: 10_000 }, { sleep: 300 }, { snapshot: 'start' },
    ...quit,
  ] });
  const seeded = JSON.parse(readFileSync(join(base, 'home', 'settings.json'), 'utf8'));
  expect(r.snapshots.start.replace(/\s+/g, ' ')).toContain('This copy has a home of its own and started with your services; it reads your keys from the Keychain and never writes there.');
  expect(seeded.remotes).toEqual({ openai: service, claude: CLAUDE });
  expect(seeded.lastMode).not.toBe('bypass'); // only the services come over
  expect(existsSync(join(base, 'home', 'profiles.json'))).toBe(true);
}, T);
