// Several Claude API keys by name (19 Nov 2026, the owner: "can we add a feature to add multiple api keys? adding a
// small info box to the left of the api to say what acct name it is?"; then "will this work if i have multiple windows
// open?", "Ask each time"). Here the list's own parts (claude-keys.mjs): the key from before names, a key added (checked
// first, never twice, never an Admin key), found by number, name, its start or its last four, named, removed (never
// the one in use), saved for every window; the /remote form keeps the other keys; the window follows the list; each
// row's account and month; and the free check of a key against a stand-in Claude API.
import { test, expect, beforeEach } from 'bun:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { startFakeAnthropic } from './fake-anthropic.mjs';

process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
delete process.env.AGENTIC_REMOTE_KEY;
const { HOME, readKey } = await import('../../models/index.mjs');
const { keysOf, findKey, addKey, renameKey, dropKey, saveKeyForAll, savedKeyId, keyRows, newKeyProblem, noteTag } = await import('../src/app/claude-keys.mjs');
const { loadSettings } = await import('../src/app/store.mjs');
const { openForm, savePlan } = await import('../src/app/remote-form.mjs');
const { followSaved } = await import('../src/app/saved-services.mjs');
const { keyTag, noteAccount, checkKey, monthByOrg } = await import('../src/agent/claude-usage.mjs');
const { recordSpend } = await import('../src/agent/spend.mjs');

const FILE = join(HOME, 'settings.json');
// Stand-in keys in the real shape, built here so no key-like text sits in the file (the repo check's secrets scan).
const sk = (...rest) => ['sk', 'ant', ...rest].join('-');
const A = sk('api03', 'stand', 'in', 'key', 'for', 'account', 'a', 'AAAA'), B = sk('api03', 'stand', 'in', 'key', 'for', 'account', 'b', 'BBBB'), C = sk('api03', 'stand', 'in', 'key', 'for', 'account', 'c', 'CCCC');
const CLAUDE = { source: 'claude', address: '', port: null, connect: 'https', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: 'AAAA', keyId: 'claude' };
const file = () => JSON.parse(readFileSync(FILE, 'utf8'));
const keyFile = () => JSON.parse(readFileSync(join(HOME, 'remote-keys.json'), 'utf8'));

beforeEach(() => {
  rmSync(join(HOME, 'usage'), { recursive: true, force: true });
  rmSync(join(HOME, 'spend'), { recursive: true, force: true });
  writeFileSync(join(HOME, 'remote-keys.json'), JSON.stringify({ claude: A }));
  writeFileSync(FILE, JSON.stringify({ remote: { ...CLAUDE, use: true }, remotes: { claude: CLAUDE } }));
});

test('the key from before keys had names is the list’s first, unnamed; a pasted key is checked before anything is kept', () => {
  expect(keysOf(loadSettings())).toEqual([{ id: 'claude', name: '', end: 'AAAA', tag: null }]);
  expect(savedKeyId(loadSettings())).toBe('claude');
  expect(keysOf({})).toEqual([]);
  expect(newKeyProblem('')).toBe('Paste the key.');
  expect(newKeyProblem(`${sk('api03')} with a space`)).toMatch(/space or a line break/);
  expect(newKeyProblem(sk('admin01', 'xyz', '0123456789'))).toMatch(/Admin key/);
  expect(newKeyProblem('apikey_01ABC')).toMatch(/key’s ID/);
  expect(newKeyProblem('sk-proj-0123456789')).toMatch(/starts with sk-ant-/);
  expect(newKeyProblem(B)).toBeNull();
});

test('a key added: under its own id in the key store, named, its mark not the key; never twice, never a name twice', () => {
  const r = addKey(B, '  Work  ');
  expect(r.key).toEqual({ id: 'claude-2', name: 'Work', end: 'BBBB', tag: keyTag(B) });
  expect(readKey('claude-2')).toBe(B);
  expect(readKey('claude')).toBe(A); // the first key is untouched
  expect(file().claudeKeys).toEqual([{ id: 'claude', name: '', end: 'AAAA', tag: null }, r.key]);
  expect(readFileSync(FILE, 'utf8')).not.toContain(B); // settings.json never holds a key
  expect(addKey(B, 'Again').error).toBe('That key is already in the list as Work.');
  expect(addKey(A, '').error).toBe('That key is already in the list as the key ••••AAAA.'); // the old key, found by reading it
  expect(addKey(C, 'work').error).toBe('A key is already named work: pick another name.');
  expect(addKey(C, 'Side').key.id).toBe('claude-3');
  expect(keysOf(loadSettings()).map((k) => k.id)).toEqual(['claude', 'claude-2', 'claude-3']);
});

test('a key found by its number, name, the start of its name, its last four or its id; /key name’s first word only when exact', () => {
  addKey(B, 'Work'); addKey(C, 'Workshop');
  const list = keysOf(loadSettings());
  expect(findKey(list, '1').id).toBe('claude');
  expect(findKey(list, '3').id).toBe('claude-3');
  expect(findKey(list, 'WORK').id).toBe('claude-2'); // a whole name before a start
  expect(findKey(list, 'works').id).toBe('claude-3');
  expect(findKey(list, 'aaaa').id).toBe('claude');
  expect(findKey(list, '••••BBBB').id).toBe('claude-2');
  expect(findKey(list, 'claude-3').id).toBe('claude-3');
  expect(findKey(list, 'nothing')).toBeNull();
  expect(findKey(list, 'wor', { prefix: false })).toBeNull();
  expect(findKey(list, '')).toBeNull();
});

test('named, the name taken out, another key’s name refused; removed from the list and the key store, never the one in use', () => {
  addKey(B, 'Work');
  expect(renameKey('claude', 'Personal').key).toMatchObject({ id: 'claude', name: 'Personal' });
  expect(renameKey('claude', 'work').error).toBe('A key is already named work: pick another name.');
  expect(renameKey('claude-2', '').key.name).toBe('');
  expect(renameKey('claude-9', 'x').error).toBe('That key is not in the list any more.');
  expect(dropKey('claude').error).toBe('Personal is in use: switch to another key first (/key use).'); // the one saved for every window
  expect(dropKey('claude-2', { inUse: 'claude-2' }).error).toMatch(/is in use/); // the one this window sends
  expect(dropKey('claude-2').key.id).toBe('claude-2');
  expect(keysOf(loadSettings()).map((k) => k.id)).toEqual(['claude']);
  expect(keyFile()).toEqual({ claude: A });
});

test('saved for every window: the Claude API’s key and the one in use for the next start; the window follows the list', () => {
  const work = addKey(B, 'Work').key;
  const mine = loadSettings();
  const next = saveKeyForAll(work);
  expect(next.remotes.claude).toMatchObject({ key: true, keyId: 'claude-2', keyEnd: 'BBBB' });
  expect(next.remote).toMatchObject({ keyId: 'claude-2', keyEnd: 'BBBB', use: true });
  renameKey('claude-2', 'Work account');
  // another window takes the key saved for every window and the list's names (saved-services.mjs, every 2 s)
  mine.claudeKeys = [];
  expect(followSaved(mine)).toBe(true);
  expect(mine.remote.keyId).toBe('claude-2');
  expect(keysOf(mine).map((k) => k.name)).toEqual(['', 'Work account']);
});

test('/remote’s key row on the Claude API replaces the key in use under its own id, and no other key of the list is lost', () => {
  addKey(B, 'Work');
  saveKeyForAll(keysOf(loadSettings())[1]); // Work is in use
  const settings = loadSettings();
  const form = openForm(settings, { on: true, source: 'claude' });
  form.keys.claude = C;
  const plan = savePlan(form, settings, { connect: true });
  expect(plan.keys).toEqual([{ op: 'save', id: 'claude-2', key: C, source: 'claude' }]);
  expect(plan.remotes.claude).toMatchObject({ keyId: 'claude-2', keyEnd: 'CCCC' });
  // a key from before 19 Nov 2026 under an old id is moved to the service's own, as before
  const old = { ...CLAUDE, keyId: 'default' };
  const s2 = { remote: { ...old, use: true }, remotes: { claude: old } };
  const f2 = openForm(s2, { on: true, source: 'claude' });
  f2.keys.claude = C;
  expect(savePlan(f2, s2, { connect: true }).keys).toEqual([{ op: 'save', id: 'claude', key: C, source: 'claude' }, { op: 'remove', id: 'default' }]);
});

test('each row: its account once Anthropic named it, this Mac’s month for that account, the one in use; a key read once gets its mark', () => {
  addKey(B, 'Work');
  noteTag('claude', A); // the first key, from before marks, marked from the key the connection sends
  expect(keysOf(loadSettings())[0].tag).toBe(keyTag(A));
  noteAccount({ 'anthropic-organization-id': 'org-aaaa-1111' }, A);
  noteAccount({ 'anthropic-organization-id': 'org-bbbb-2222' }, B);
  const claude = { remote: true, kind: 'claude', label: 'api.anthropic.com', price: { in: 4, out: 20 } };
  recordSpend(claude, { prompt_tokens: 1_000_000, completion_tokens: 0, org: 'org-aaaa-1111' }, { pid: 41 }); // $4
  recordSpend(claude, { prompt_tokens: 250_000, completion_tokens: 0, org: 'org-bbbb-2222' }, { pid: 42 }); // $1
  const byOrg = monthByOrg();
  expect(byOrg['org-aaaa-1111']).toBeCloseTo(4, 6);
  expect(byOrg['org-bbbb-2222']).toBeCloseTo(1, 6);
  const rows = keyRows(keysOf(loadSettings()), { inUse: 'claude-2', byOrg, pending: false });
  expect(rows).toEqual([
    { n: 1, id: 'claude', name: '', end: 'AAAA', orgEnd: '1111', month: expect.closeTo(4, 6), inUse: false, checking: false },
    { n: 2, id: 'claude-2', name: 'Work', end: 'BBBB', orgEnd: '2222', month: expect.closeTo(1, 6), inUse: true, checking: false },
  ]);
  addKey(C, 'Side');
  expect(keyRows(keysOf(loadSettings()), { inUse: 'claude-3', pending: true })[2]).toMatchObject({ orgEnd: null, month: null, checking: true });
});

test('a key checked with Anthropic for free: its account learned, a refused key said plainly, no message sent', async () => {
  const fake = await startFakeAnthropic([], { orgs: { [A]: 'org-aaaa-1111' } });
  try {
    expect(await checkKey({ url: fake.url, key: A })).toEqual({ ok: true, org: 'org-aaaa-1111' });
    expect(await checkKey({ url: fake.url, key: sk('api03', 'a', 'key', 'it', 'does', 'not', 'know', 'ZZZZ') })).toEqual({ ok: false, error: 'Anthropic did not accept that key' });
    expect(fake.seen.filter((s) => s.path.startsWith('/v1/messages'))).toHaveLength(0);
  } finally { await fake.close(); }
});
