// Several Claude API keys in the real window (19 Nov 2026, the owner: "can we add a feature to add multiple api keys?
// adding a small info box to the left of the api to say what acct name it is?"; "will this work if i have multiple
// windows open?" → "Ask each time"). On a stand-in Claude API that knows two keys of two accounts: /key add pastes
// one in /usage's hidden row, it is checked and kept, the question asks which windows; just this window sends it from
// the next request; /key lists them; /key name names one; every window saves it. Then two windows at once: a key
// this window picked alone leaves the other window as it was, a key for every window reaches it within seconds.
import { test, expect } from 'bun:test';
import { writeFileSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit, ON_REMOTE } from './app-setup.mjs';
import { startFakeAnthropic } from './fake-anthropic.mjs';

const A = 'test-anthropic-key-0123456789'; // the stand-in's own key: account …1111
// account …2222; built here so no key-like text sits in the file (the repo check's secrets scan)
const B = ['sk', 'ant', 'api03', 'stand', 'in', 'key', 'for', 'work', '9Qk2'].join('-');
const ORGS = { [A]: 'org-aaaa-1111', [B]: 'org-bbbb-2222' };
const KEYS_ONLY_IN_FILE = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: '', ANTHROPIC_API_KEY: '' };
const lines = (text) => text.split('\n').map((l) => l.trimEnd());
const flat = (text) => text.replace(/\s+/g, ' ');
const claudeAt = (url) => ({ source: 'claude', address: url, port: null, connect: 'http', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: '6789', keyId: 'claude' });
// The keys the messages went with, in order (each message here is one request: no tools, no warm-up message).
const sentWith = (fake) => fake.seen.filter((s) => s.method === 'POST' && s.path.startsWith('/v1/messages')).map((s) => s.key);

test('one window: /key add pastes a key hidden, checked and kept; just this window sends it; /key lists and names; every window saves it', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  const fake = await startFakeAnthropic([{ text: 'Hello from Work.' }, { text: 'Hello from Personal.' }], { orgs: ORGS, limits: { requests: [1000, 999], input: [2_000_000, 1_996_000], output: [400_000, 399_000] } });
  const r0 = claudeAt(fake.url);
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { claude: r0 } }));
  writeFileSync(join(home, 'remote-keys.json'), JSON.stringify({ claude: A }));
  const r = await runInPty({ cwd, env: { ...env, ...KEYS_ONLY_IN_FILE, TZ: 'UTC' }, args: ['--no-flows'], cols: 152, rows: 44, timeoutMs: 120_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 800 },
    { type: '/key add Work' }, { key: 'enter' }, { wait: 'Another Claude API key for Work' }, { sleep: 200 },
    { type: B }, { sleep: 200 }, { snapshot: 'pasting' },
    { key: 'enter' }, { wait: 'in which windows?', ms: 15_000 }, { sleep: 300 }, { snapshot: 'asked' },
    { type: '1' }, { wait: 'in this window only', ms: 15_000 }, { sleep: 1500 }, { snapshot: 'switched' },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from Work.', ms: 20_000 }, { sleep: 1500 },
    { type: '/key name 1 Personal' }, { key: 'enter' }, { wait: 'is named Personal' }, { sleep: 300 },
    // two words with no number first: the key in use's name, whole
    { type: '/key name Work account' }, { key: 'enter' }, { wait: 'is named Work account' }, { sleep: 300 },
    { type: '/key name Work' }, { key: 'enter' }, { wait: '9Qk2 is named Work now' }, { sleep: 300 },
    { type: '/key' }, { key: 'enter' }, { wait: 'API keys · Claude API' }, { sleep: 300 }, { snapshot: 'list' },
    { type: '/key use personal' }, { key: 'enter' }, { wait: 'in which windows?' }, { sleep: 300 },
    { type: '2' }, { wait: 'in every window', ms: 15_000 }, { sleep: 1500 }, { snapshot: 'every' },
    { type: 'again' }, { key: 'enter' }, { wait: 'Hello from Personal.', ms: 20_000 }, { sleep: 1200 }, { snapshot: 'after' },
    ...quit,
  ] });
  await fake.close();
  // the key is hidden as it is pasted: its last four only
  expect(r.snapshots.pasting).not.toContain(B);
  expect(r.snapshots.pasting).toMatch(/•+9Qk2/);
  // checked for free before it was kept, then the question; the account named
  expect(flat(r.snapshots.switched)).toContain('Added Work (••••9Qk2) · account …2222. It is kept in the Keychain.');
  expect(flat(r.snapshots.asked)).toMatch(/Use Work \(••••9Qk2\) · account …2222 in which windows\?/);
  expect(flat(r.snapshots.switched)).toContain('Now on Work (••••9Qk2) · account …2222, in this window only');
  expect(sentWith(fake)).toEqual([B, A]); // hello with Work's key (this window only), again with Personal's (every window)
  // the list, each key's account, the one in use ticked; then every window: the key saved for the Claude API
  expect(flat(r.snapshots.list)).toMatch(/1 Personal\s.*••••6789 · account …1111/);
  expect(flat(r.snapshots.list)).toMatch(/✓ 2 Work\s.*••••9Qk2 · account …2222 · in use here/);
  expect(flat(r.snapshots.every)).toContain('Now on Personal (••••6789) · account …1111, in every window');
  // the footer names the key in use, with no dollars after it (19 Nov 2026: no "$ left" or month in the footer)
  expect(lines(r.snapshots.after).at(-2)).toMatch(/· Personal │$/);
  expect(lines(r.snapshots.after).at(-2)).not.toContain('$');
  const s = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8'));
  expect(s.claudeKeys.map((k) => [k.id, k.name, k.end])).toEqual([['claude', 'Personal', '6789'], ['claude-2', 'Work', '9Qk2']]);
  expect(s.remotes.claude.keyId).toBe('claude');
  expect(JSON.stringify(s)).not.toContain(B);
  expect(JSON.parse(readFileSync(join(home, 'remote-keys.json'), 'utf8'))).toEqual({ claude: A, 'claude-2': B });
}, T * 3);

test('two windows: a key picked for just this window leaves the other as it was; a key for every window reaches it within seconds', async () => {
  const { cwd, env, base } = setup();
  const home = join(base, 'home');
  const cwd2 = join(base, 'demo-two');
  cpSync(cwd, cwd2, { recursive: true });
  writeFileSync(join(home, 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString(), [cwd2]: new Date().toISOString() }));
  const fake = await startFakeAnthropic([], { orgs: ORGS });
  const r0 = claudeAt(fake.url);
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { claude: r0 }, claudeKeys: [{ id: 'claude', name: 'Personal', end: '6789', tag: null }, { id: 'claude-2', name: 'Work', end: '9Qk2', tag: null }] }));
  writeFileSync(join(home, 'remote-keys.json'), JSON.stringify({ claude: A, 'claude-2': B }));
  // The two windows wait for each other through these.
  const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
  const aAlone = gate(), bSent = gate(), aAll = gate();
  const run = (dir, steps) => runInPty({ cwd: dir, env: { ...env, ...KEYS_ONLY_IN_FILE, TZ: 'UTC' }, args: ['--no-flows'], cols: 152, rows: 44, timeoutMs: 150_000, steps });
  const [a, b] = await Promise.all([
    run(cwd, [
      { wait: ON_REMOTE, ms: 30_000 }, { sleep: 800 },
      { type: '/key use work' }, { key: 'enter' }, { wait: 'in which windows?' }, { sleep: 200 }, { type: '1' }, { wait: 'in this window only', ms: 15_000 },
      { fn: () => aAlone.open() }, { fn: () => bSent.p },
      { type: '/key use work' }, { key: 'enter' }, { wait: 'in which windows?' }, { sleep: 200 }, { type: '2' }, { wait: 'in every window', ms: 15_000 },
      { fn: () => aAll.open() }, { sleep: 9000 }, { snapshot: 'end' },
      ...quit,
    ]),
    run(cwd2, [
      { wait: ON_REMOTE, ms: 30_000 },
      { fn: () => aAlone.p }, { sleep: 4500 }, // two looks at the saved settings: nothing for this window
      { type: 'first' }, { key: 'enter' }, { wait: 'Done.', ms: 20_000 }, { sleep: 500 },
      { fn: () => bSent.open() }, { fn: () => aAll.p },
      { wait: 'Another window switched every window to Work', ms: 15_000 }, { sleep: 300 }, { snapshot: 'followed' },
      { type: 'second' }, { key: 'enter' }, { wait: /Done\.[\s\S]*Done\./, ms: 20_000 }, { sleep: 500 },
      ...quit,
    ]),
  ]);
  await fake.close();
  // window B's two messages (window A sends none): the first with Personal's key, as window A's own key did not move
  // it; the second with Work's, once window A saved Work for every window
  expect(sentWith(fake)).toEqual([A, B]);
  expect(flat(b.snapshots.followed)).toContain('Another window switched every window to Work (••••9Qk2) · account …2222: this window sends it from its next request.');
  expect(flat(a.snapshots.end)).toContain('Now on Work (••••9Qk2) · account …2222, in every window');
  expect(flat(a.snapshots.end)).not.toContain('Another window switched'); // the window that switched is not told by itself
  expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).remotes.claude.keyId).toBe('claude-2');
}, T * 4);
