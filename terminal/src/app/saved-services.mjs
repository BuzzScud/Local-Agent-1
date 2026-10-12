// Your services stay saved (12 Oct 2026, the owner: "i want to ensure my data is saved. i keep having to add the
// other service address and the claude api in every time we fix or change something"). Three causes were found:
// a window kept the services it read when it opened and wrote them all back with any change (store.mjs now saves
// one service at a time, on the file as it is); a copy of the app with a home of its own (a test, a preview) wrote
// its keys over yours in the Keychain and started with no services (runtime/remote.mjs keyStore, readsYours); and
// nothing put back what was lost. This file is the window's side of it:
//   followSaved     an open window takes what another window saved, every couple of seconds (App.jsx)
//   repairServices  at a window's start, a service that settings.json lost but profiles.json still uses, or whose
//                   key is still kept, comes back from the newest backup (store.mjs keepCopy), else from the profile
//   seedCopy        a copy with a home of its own starts with your services (its keys are read from yours)
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, REAL_HOME, isRealHome, REMOTE_SOURCES, DEFAULT_CLAUDE_MODEL, sourceOf, keyIdOf, keyEnd, readKey } from '../../../models/index.mjs';
import { loadSettings, saveSettings, readCopies, SETTINGS_FILE, writeWhole } from './store.mjs';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const WORD = { claude: 'Claude API', openai: 'other service', machine: 'other computer' };

// What a window follows of the file, and what it keeps of the service it uses: the model it runs and whether it is on.
const FOLLOWED = ['remotes', 'memoryToRemote', 'remoteCleanAt'];
export function followSaved(mine, file = loadSettings()) {
  let changed = false;
  for (const k of FOLLOWED) {
    if (same(mine[k], file[k])) continue;
    if (file[k] === undefined) delete mine[k]; else mine[k] = file[k];
    changed = true;
  }
  const r = mine.remote;
  const saved = r ? file.remotes?.[sourceOf(r)] : null;
  if (saved) {
    const next = { ...r, ...saved, model: r.model || saved.model, use: r.use };
    if (!same(next, r)) { mine.remote = next; changed = true; }
  }
  return changed;
}

// The window's watch on settings.json, called every couple of seconds (App.jsx): when the file changed, a service
// this window knows and the file no longer has is written back (nothing removes a service on purpose: it was lost,
// say to a window still on a version from before this), then followSaved. Answers the lines to show, or [].
export function savedWatch(mine, { file = SETTINGS_FILE } = {}) {
  const read = () => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
  let seen = read();
  return () => {
    const text = read();
    if (text === seen) return [];
    seen = text;
    const said = [];
    const lost = REMOTE_SOURCES.filter((s) => mine.remotes?.[s] && !loadSettings().remotes?.[s]);
    if (lost.length) {
      saveSettings((now) => ({ remotes: { ...Object.fromEntries(lost.map((s) => [s, mine.remotes[s]])), ...(now.remotes ?? {}) } }));
      seen = read();
      for (const s of lost) said.push(`Kept the ${WORD[s]} set-up${mine.remotes[s].address ? ` (${mine.remotes[s].address})` : ''}: another window had saved settings without it.`);
    }
    followSaved(mine);
    return said;
  };
}

// settings: settings.json as it is; profiles: profiles.json ({ profiles }); copies: store.mjs readCopies('settings'),
// the newest first; keyOf(id): the key kept under that id, or null. Answers { patch, said }: what to save (null when
// nothing) and a line for each thing done or found.
export function repairServices({ settings = {}, profiles = null, copies = [], keyOf = () => null, claudeModel = DEFAULT_CLAUDE_MODEL }) {
  const remotes = { ...(settings.remotes ?? {}) };
  const said = [];
  let changed = false;
  const used = Object.values(profiles?.profiles ?? {}).filter((p) => p?.server?.source);
  for (const s of REMOTE_SOURCES) {
    if (remotes[s]) continue;
    const profile = used.find((p) => p.server.source === s);
    const key = keyOf(s);
    // Still used by a profile, or its key still kept: lost, not removed. (A Claude key alone is enough to use it.)
    if (!profile && !(key && s === 'claude')) continue;
    const backup = copies.find((c) => c.data?.remotes?.[s])?.data.remotes[s];
    let back = backup ?? null;
    if (!back && profile) {
      const k = keyOf(profile.server.keyId ?? s);
      back = { source: s, address: profile.server.address ?? '', port: profile.server.port ?? null, connect: profile.server.connect ?? (s === 'claude' ? 'https' : 'http'), kind: profile.server.kind, model: profile.model ?? '', context: 0, key: Boolean(k), keyEnd: keyEnd(k), keyId: profile.server.keyId ?? s };
    }
    if (!back) back = { source: 'claude', address: '', port: null, connect: 'https', kind: 'claude', model: claudeModel, context: 0, key: true, keyEnd: keyEnd(key), keyId: 'claude' };
    remotes[s] = back;
    changed = true;
    said.push(`Brought back the ${WORD[s]} set-up${back.address ? ` (${back.address})` : ''}: settings.json had lost it${backup ? '; taken from its last backup' : profile ? '; taken from your profiles' : '; its key was still kept'}.`);
  }
  // A key's end that is not the key kept (the footer and /remote show it): the key kept is the one used.
  for (const [s, r] of Object.entries(remotes)) {
    if (!r?.key) continue;
    const k = keyOf(keyIdOf(r));
    if (!k) { said.push(`The ${WORD[s] ?? s} key is not kept any more: /remote ${s === 'openai' ? 'service' : s === 'machine' ? 'computer' : s} to type it once.`); continue; }
    if (keyEnd(k) && keyEnd(k) !== r.keyEnd) { remotes[s] = { ...r, keyEnd: keyEnd(k) }; changed = true; }
  }
  if (!changed) return { patch: null, said };
  const patch = { remotes };
  const r = settings.remote;
  if (r && remotes[sourceOf(r)] && !same(remotes[sourceOf(r)].keyEnd, r.keyEnd)) patch.remote = { ...r, keyEnd: remotes[sourceOf(r)].keyEnd };
  return { patch, said };
}

// The repair at a window's start, on the real files: saves what it brought back. Answers the lines to show.
// AGENTIC_SERVICES_REPAIR=off leaves it out (the tests: test-env.mjs).
export function repairNow() {
  if (process.env.AGENTIC_SERVICES_REPAIR === 'off') return [];
  let profiles = null;
  try { profiles = JSON.parse(readFileSync(join(HOME, 'profiles.json'), 'utf8')); } catch {}
  // AGENTIC_REMOTE_KEY stands in for every key: it says nothing of the keys kept.
  const keyOf = process.env.AGENTIC_REMOTE_KEY ? () => null : (id) => readKey(id);
  let said = [];
  saveSettings((now) => {
    const res = repairServices({ settings: now, profiles, copies: readCopies('settings'), keyOf });
    said = process.env.AGENTIC_REMOTE_KEY ? res.said.filter((l) => !l.includes('key is not kept')) : res.said;
    return res.patch ?? {};
  });
  return said;
}

// A copy of the app with a home of its own (a preview, a worktree's try-out; not a test) starts with your services:
// what settings.json says of them and profiles.json, copied once, when its home has no settings yet. Its keys are
// read from yours when it needs them (runtime/remote.mjs readsYours), never copied to a file. AGENTIC_SEED=off: none.
// Answers whether it copied.
const SEEDED = ['remote', 'remotes', 'memoryToRemote', 'remoteCleanAt'];
export function seedCopy({ home = HOME, from = REAL_HOME } = {}) {
  if (isRealHome(home) || process.env.NODE_ENV === 'test' || process.env.AGENTIC_SEED === 'off') return false;
  const mine = join(home, 'settings.json');
  if (existsSync(mine)) return false;
  let yours;
  try { yours = JSON.parse(readFileSync(join(from, 'settings.json'), 'utf8')); } catch { return false; }
  const copy = Object.fromEntries(SEEDED.filter((k) => yours[k] !== undefined).map((k) => [k, yours[k]]));
  if (!Object.keys(copy).length) return false;
  mkdirSync(home, { recursive: true });
  writeWhole(mine, `${JSON.stringify(copy, null, 2)}\n`);
  if (!existsSync(join(home, 'profiles.json')) && existsSync(join(from, 'profiles.json'))) copyFileSync(join(from, 'profiles.json'), join(home, 'profiles.json'));
  return true;
}
