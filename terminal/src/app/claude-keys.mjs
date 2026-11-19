// Several Claude API keys (19 Nov 2026, the owner: "can we add a feature to add multiple api keys? adding a small info
// box to the left of the api to say what acct name it is?"). Each key is kept in the Keychain under its own id
// (claude, claude-<n>…); settings.json keeps the list, "claudeKeys": [{ id, name, end, tag }] (name: yours; end: the
// key's last four; tag: claude-usage.mjs keyTag, a one-way mark that finds the account Anthropic named for it, never
// the key). The key in use for the next connect is the Claude API's saved keyId (remotes.claude), as before; a window
// may use another of its own ("Just this window", app-claude-keys.mjs). The list as it was before keys had names is
// the one saved key, unnamed (keysOf).
import { readKey, saveKey, removeKey, keyEnd, validKey, claudeKeyProblem, sourceOf } from '../../../models/index.mjs';
import { keyTag, accountOfTag } from '../agent/claude-usage.mjs';
import { loadSettings, saveSettings } from './store.mjs';

const NAME_MAX = 40;
export const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// The list: the saved one, with the Claude API's saved key in it when it is not (a key from before 19 Nov 2026).
export function keysOf(settings) {
  const list = Array.isArray(settings?.claudeKeys) ? settings.claudeKeys.filter((k) => k && typeof k.id === 'string').map((k) => ({ id: k.id, name: cleanName(k.name), end: String(k.end ?? ''), tag: k.tag ?? null })) : [];
  const saved = settings?.remotes?.claude ?? (settings?.remote && sourceOf(settings.remote) === 'claude' ? settings.remote : null);
  const id = saved?.key ? saved.keyId || 'claude' : null;
  if (id && !list.some((k) => k.id === id)) list.unshift({ id, name: '', end: saved.keyEnd ?? '', tag: null });
  return list;
}
// The saved key for the next connect, every window's (null: none).
export const savedKeyId = (settings) => { const r = settings?.remotes?.claude; return r?.key ? r.keyId || 'claude' : null; };
export const keyWord = (k) => (k?.name ? k.name : `the key ••••${k?.end || '????'}`);

// A key named by what you typed: its number in the list (1, 2…), its name, its id, or its last four.
// prefix: a name's start finds it too (/key use wo), not for /key name's first word, which may be the new name.
export function findKey(list, word, { prefix = true } = {}) {
  const w = String(word ?? '').trim().toLowerCase();
  if (!w) return null;
  if (/^\d+$/.test(w) && list[Number(w) - 1]) return list[Number(w) - 1];
  return list.find((k) => k.name.toLowerCase() === w) ?? list.find((k) => k.id.toLowerCase() === w) ?? list.find((k) => k.end && k.end.toLowerCase() === w.replace(/^[•.…]+/, ''))
    ?? (prefix ? list.find((k) => k.name && k.name.toLowerCase().startsWith(w)) : null) ?? null;
}

// The list saved under the settings' lock, from the file as it is (another window may have added one since).
function changeKeys(change) {
  let out = null;
  saveSettings((now) => { out = change(keysOf(now), now); return out.patch ?? { claudeKeys: out.list }; });
  return out;
}

// A key added: checked as a Claude key, kept in the Keychain under a new id, put in the list with its name. A key
// already in the list is not added twice. Answers { key: the entry } or { error } in plain words.
// What is wrong with a pasted key before anything is asked or kept, in plain words, or null.
export function newKeyProblem(key) {
  const k = String(key ?? '').trim();
  if (!k) return 'Paste the key.';
  if (!validKey(k)) return 'The key has a space or a line break in it: paste it again.';
  if (/^sk-ant-admin/.test(k)) return 'That is an Admin key (sk-ant-admin…): it reads the bill, it cannot run the model. /usage, then k, keeps it.';
  const bad = claudeKeyProblem(k);
  return bad ? `${bad[0].toUpperCase()}${bad.slice(1)}.` : null;
}

export function addKey(key, name = '') {
  const k = String(key ?? '').trim();
  const problem = newKeyProblem(k);
  if (problem) return { error: problem };
  const tag = keyTag(k);
  const listNow = keysOf(loadSettings());
  const twin = listNow.find((e) => e.tag === tag || (e.end === keyEnd(k) && readKey(e.id) === k));
  if (twin) return { error: `That key is already in the list as ${keyWord(twin)}.`, key: twin };
  const nm = cleanName(name);
  if (nm && listNow.some((e) => e.name.toLowerCase() === nm.toLowerCase())) return { error: `A key is already named ${nm}: pick another name.` };
  const ids = new Set(listNow.map((e) => e.id));
  let n = 2;
  while (ids.has(`claude-${n}`)) n++;
  const entry = { id: listNow.length ? `claude-${n}` : 'claude', name: nm, end: keyEnd(k), tag };
  try { saveKey(k, entry.id, `Agentic Coder · Claude API${nm ? ` · ${nm}` : ''}`); } catch (e) { return { error: `The key could not be kept: ${e.message}.` }; }
  changeKeys((list) => ({ list: [...list.filter((e) => e.id !== entry.id), entry] }));
  return { key: entry };
}

// A key's name changed ('' takes it out). Answers { key } or { error }.
export function renameKey(id, name) {
  const nm = cleanName(name);
  let res = null;
  changeKeys((list) => {
    if (!list.some((e) => e.id === id)) { res = { error: 'That key is not in the list any more.' }; return { patch: {} }; }
    if (nm && list.some((e) => e.id !== id && e.name.toLowerCase() === nm.toLowerCase())) { res = { error: `A key is already named ${nm}: pick another name.` }; return { patch: {} }; }
    const next = list.map((e) => (e.id === id ? { ...e, name: nm } : e));
    res = { key: next.find((e) => e.id === id) };
    return { list: next };
  });
  return res;
}

// A key taken out of the list and the Keychain. Not one in use here (inUse) nor the one saved for every window.
export function dropKey(id, { inUse = null } = {}) {
  let res = null;
  changeKeys((list, now) => {
    const e = list.find((x) => x.id === id);
    if (!e) { res = { error: 'That key is not in the list any more.' }; return { patch: {} }; }
    if (id === inUse || id === savedKeyId(now)) { res = { error: `${keyWord(e)[0].toUpperCase()}${keyWord(e).slice(1)} is in use: switch to another key first (/key use).` }; return { patch: {} }; }
    res = { key: e };
    return { list: list.filter((x) => x.id !== id) };
  });
  if (res.key) removeKey(id);
  return res;
}

// The saved key for every window (the next connect, and every open window within 2 s: app-claude-keys.mjs followKey).
export function saveKeyForAll(entry) {
  return saveSettings((now) => {
    const claude = now.remotes?.claude;
    const put = (r) => ({ ...r, key: true, keyId: entry.id, keyEnd: entry.end });
    return {
      ...(claude ? { remotes: { ...now.remotes, claude: put(claude) } } : {}),
      ...(now.remote && sourceOf(now.remote) === 'claude' ? { remote: put(now.remote) } : {}),
    };
  });
}

// A key's mark, noted the first time the key is read (a key from before the list had marks).
export function noteTag(id, key) {
  const tag = keyTag(key);
  if (!tag) return;
  const now = keysOf(loadSettings());
  const e = now.find((x) => x.id === id);
  if (e && e.tag === tag && e.end === keyEnd(key)) return;
  changeKeys((list) => ({ list: list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? { ...x, tag, end: keyEnd(key) } : x)) : [...list, { id, name: '', end: keyEnd(key), tag }] }));
}

// The rows to show: each key, its account (the end of the ID Anthropic gives it), this Mac's dollars this month
// for that account (byOrg: claude-usage.mjs monthByOrg), and which one is in use here.
export function keyRows(list, { inUse = null, byOrg = {}, pending = false } = {}) {
  return list.map((k, i) => {
    const org = accountOfTag(k.tag);
    const on = k.id === inUse;
    return { n: i + 1, id: k.id, name: k.name, end: k.end, orgEnd: org ? org.slice(-4) : null, month: org ? byOrg[org] ?? 0 : null, inUse: on, checking: on && pending };
  });
}
