// Several Claude API keys in the window (App.jsx; the list itself: claude-keys.mjs). /key lists them, /key use <name>
// switches (asking: just this window, or every window), /key add <name> opens /usage's last row to paste one (it is
// checked with Anthropic before it is kept, which costs nothing), /key name and /key remove. The window's account box
// (window/ui.html) runs these. A switch changes the key the window's connection sends, in place: the conversation, the
// model and the prompt cache's place stay, and the next request goes with the new key.
// Every window: the key saved for the Claude API changes, and each open window on it takes it within 2 s (followKey,
// from app-watch.mjs's look at settings.json); a window that picked a key of its own keeps it.
// self.remoteRef.current: keyIn, the id of the key this window's connection sends; ownKey, set when it is this
// window's alone; pendingKey, the key the question is about.
import { readKey, keyEnd, setEndpoint, endpointOf } from '../../../models/index.mjs';
import { checkKey, accountOfTag, keyTag } from '../agent/claude-usage.mjs';
import { keysOf, findKey, addKey, renameKey, dropKey, saveKeyForAll, savedKeyId, keyWord, noteTag, cleanName, keyRows, newKeyProblem } from './claude-keys.mjs';
import { IDLE } from './app-common.mjs';
import { loadSettings } from './store.mjs';

const HELP = '/key lists your Claude API keys · /key use <name or number> switches · /key add <name> adds one · /key name <new name> names the one in use (/key name <number> <new name>, another) · /key remove <name or number>';

export function claudeKeysPart(self) {
  const rr = () => self.remoteRef.current;
  const onClaude = () => Boolean(rr().conn) && self.model.remote?.kind === 'claude' && endpointOf(rr().conn.url)?.kind === 'claude';
  const busy = () => self.S.current.live !== IDLE || self.agent.busy || self.S.current.starting;
  const note = (text, tone = 'dim') => self.push({ type: 'note', text, tone });
  const list = () => keysOf(self.settings);
  // The list as saved, into this window's settings at once (other windows take it within 2 s: saved-services.mjs).
  const synced = () => { self.settings.claudeKeys = loadSettings().claudeKeys; };
  const inUse = () => (onClaude() ? rr().keyIn ?? savedKeyId(self.settings) : savedKeyId(self.settings));
  const orgWord = (e) => { const org = accountOfTag(e?.tag); return org ? ` · account …${org.slice(-4)}` : ''; };
  const named = (e) => `${keyWord(e)}${e.name ? ` (••••${e.end})` : ''}`;

  // The connection sends the key `id` from now on. Answers whether it did.
  const swapTo = (id) => {
    const key = readKey(id);
    if (!key) { note(`${keyWord(list().find((e) => e.id === id))} is not in the Keychain any more: /key add puts it back.`, 'warn'); return false; }
    const url = rr().conn.url;
    setEndpoint(url, { ...endpointOf(url), key });
    rr().keyIn = id;
    self.settings.remote = { ...self.settings.remote, key: true, keyId: id, keyEnd: keyEnd(key) };
    noteTag(id, key);
    synced();
    return true;
  };

  // A switch, once its question is answered: the key is checked with Anthropic (free), then sent from the next
  // request. scope: 'window' or 'all'.
  const switchKey = async (e, scope) => {
    if (!onClaude()) { self.settings.remotes = saveKeyForAll(e).remotes; note(`${named(e)} is the Claude API key from the next connect, in every window.`); return; }
    if (busy()) { note('Agentic Coder is in the middle of a reply. Let it finish (or press esc), then switch keys.', 'warn'); return; }
    const key = readKey(e.id);
    if (!key) { note(`${keyWord(e)} is not in the Keychain any more: /key add puts it back.`, 'warn'); return; }
    const res = await checkKey({ url: rr().conn.url, key });
    if (!res.ok) { note(`Still on ${named(list().find((x) => x.id === inUse()) ?? { end: '' })}: ${res.error} for ${keyWord(e)}.`, 'error'); return; }
    if (busy()) { note('A reply started meanwhile: nothing switched. /key use switches when it is done.', 'warn'); return; }
    const was = list().find((x) => x.id === inUse());
    if (!swapTo(e.id)) return;
    rr().ownKey = scope === 'window' ? e.id : null;
    if (scope === 'all') {
      const next = saveKeyForAll(e);
      self.settings.remotes = next.remotes;
    }
    const acct = res.org ? ` · account …${res.org.slice(-4)}` : '';
    note(scope === 'all' ? `Now on ${named(e)}${acct}, in every window: the others switch within 2 seconds (one that picked a key of its own keeps it).`
      : `Now on ${named(e)}${acct}, in this window only${was ? `: the others stay on ${keyWord(was)}` : ''}.`);
  };

  const ask = (e) => { rr().pendingKey = e; self.openChoice('key-scope'); };

  // What the question shows (app-model.mjs choiceOf asks here for 'key-scope' and 'key-remove').
  const keyChoice = (id) => {
    const e = rr().pendingKey ?? {};
    const was = list().find((x) => x.id === inUse());
    if (id === 'key-remove') return { ask: true, title: `Remove ${named(e)}?`, blurb: 'It goes from the list and from the Keychain. The dollars it spent stay counted.', what: 'the key', current: null, escWord: 'keep it', options: [
      { id: 'keep', label: 'Keep it', recommended: true, note: 'nothing changes' },
      { id: 'remove', label: 'Remove it', note: 'from the list and the Keychain' },
    ] };
    return { ask: true, title: `Use ${named(e)}${orgWord(e)} in which windows?`, blurb: '', what: 'the key', current: null, escWord: 'not now', options: [
      { id: 'window', label: 'Just this window', recommended: true, note: `this window sends it from its next request; the others stay on ${was ? keyWord(was) : 'their key'}` },
      { id: 'all', label: 'Every window', note: 'saved for the Claude API: every open window switches within 2 seconds, and the next ones start on it' },
      { id: 'later', label: 'Not now', note: `stays on ${was ? keyWord(was) : 'the key in use'}; /key use ${e.name || e.end} switches later` },
    ] };
  };
  const applyKeyChoice = (id, value) => {
    const e = rr().pendingKey;
    rr().pendingKey = null;
    if (!e) return;
    if (id === 'key-remove') {
      if (value !== 'remove') { note(`Kept ${named(e)}.`); return; }
      const r = dropKey(e.id, { inUse: inUse() });
      if (r.error) { note(r.error, 'warn'); return; }
      synced();
      note(`Removed ${named(e)} from the list and the Keychain.`);
      return;
    }
    if (value !== 'window' && value !== 'all') { note(`Stays on ${keyWord(list().find((x) => x.id === inUse()))}. /key use ${e.name || e.end} switches later.`); return; }
    switchKey(e, value).catch((err) => note(`The key did not switch: ${err.message}`, 'error'));
  };

  // /usage's last row, when you press enter on a pasted key (app-usage.mjs saveUsageEdit sends 'newkey' here):
  // the key is checked with Anthropic, then kept, then the question asks where to use it.
  const addPasted = async (value, name) => {
    const k = String(value ?? '').trim();
    const bad = newKeyProblem(k);
    if (bad) return bad;
    const url = rr().conn?.url;
    note(`Checking ${name ? `the key for ${name}` : 'the new key'} with Anthropic (it costs nothing)…`);
    const res = url ? await checkKey({ url, key: k }) : { ok: true, org: null };
    if (!res.ok) { note(`Not added: ${res.error}. /key add${name ? ` ${name}` : ''} to paste it again.`, 'error'); return null; }
    const r = addKey(k, name);
    if (r.error) { note(`Not added: ${r.error}`, 'warn'); return null; }
    synced();
    note(`Added ${named(r.key)}${res.org ? ` · account …${res.org.slice(-4)}` : ''}. It is kept in the Keychain.`);
    if (onClaude()) ask(r.key);
    return null;
  };

  // /key and its words.
  const keyCommand = (arg = '') => {
    const words = arg.trim().split(/\s+/).filter(Boolean);
    const [verb, ...rest] = words;
    const v = (verb ?? '').toLowerCase();
    if (/sk-ant-/.test(arg)) { note('A key typed in a command stays in the prompt history: nothing was saved. /key add <name> opens a row that hides it as you paste.', 'warn'); return; }
    if (!v || v === 'list') {
      const ks = list();
      if (!ks.length) { note(`No Claude API key saved yet. /key add <name> adds one${onClaude() ? '' : ' (on the Claude API: /remote claude first)'}.`); return; }
      const rows = keyRows(ks, { inUse: inUse() });
      self.push({ type: 'panel', title: 'API keys · Claude API', pad: 18, rows: rows.map((r) => [`${r.inUse ? '✓' : ' '} ${r.n} ${r.name || 'no name'}`, `••••${r.end || '????'}${r.orgEnd ? ` · account …${r.orgEnd}` : ' · account not known yet'}${r.inUse ? ' · in use here' : ''}`]) });
      note(HELP);
      return;
    }
    if (v === 'add' || v === 'new') {
      if (!onClaude()) { note('/key add works on the Claude API: /remote claude first (or /remote key to change its one key).'); return; }
      const name = cleanName(rest.join(' '));
      if (name && list().some((e) => e.name.toLowerCase() === name.toLowerCase())) { note(`A key is already named ${name}: /key add <another name>.`, 'warn'); return; }
      self.setPicker({ kind: 'usage', asking: false, editing: { id: 'newkey', name, value: '', cursor: 0 } });
      return;
    }
    if (v === 'name' || v === 'rename') {
      const ks = list();
      // Another key is named by its number in the list or its id (the window's box sends the id); any other first word
      // is the name's own ("/key name Work account" names the key in use "Work account").
      let e = rest.length > 1 && /^(\d+|claude(-\d+)?|default)$/i.test(rest[0]) ? findKey(ks, rest[0], { prefix: false }) : null;
      const nameWords = e ? rest.slice(1) : rest;
      e ??= ks.find((x) => x.id === inUse());
      if (!e) { note('No key in use to name: /key name <key> <new name>.', 'warn'); return; }
      // "-" takes the name out (the window's account box sends it for an emptied name).
      const r = renameKey(e.id, nameWords.join(' ') === '-' ? '' : nameWords.join(' '));
      if (r.error) { note(r.error, 'warn'); return; }
      synced();
      note(r.key.name ? `••••${r.key.end} is named ${r.key.name} now, in every window.` : `••••${r.key.end} has no name now.`);
      return;
    }
    if (v === 'remove' || v === 'delete') {
      const e = findKey(list(), rest.join(' '));
      if (!e) { note(`No key ${rest.join(' ') || ''} in the list: /key lists them.`.replace('  ', ' '), 'warn'); return; }
      if (e.id === inUse() || e.id === savedKeyId(self.settings)) { note(`${named(e)} is in use: switch to another key first (/key use).`, 'warn'); return; }
      rr().pendingKey = e;
      self.openChoice('key-remove');
      return;
    }
    const e = findKey(list(), (v === 'use' || v === 'switch' ? rest : words).join(' '));
    if (!e) { note(`No key ${(v === 'use' ? rest : words).join(' ')} in the list. ${HELP}`, 'warn'); return; }
    // On it already, and for every window too (a key of this window's own can still be made every window's).
    if (e.id === inUse() && (!onClaude() || (rr().keyIn === e.id && (!rr().ownKey || savedKeyId(self.settings) === e.id)))) { note(`Already on ${named(e)}${orgWord(e)}.`); return; }
    if (!onClaude()) { switchKey(e, 'all'); return; }
    ask(e);
  };

  // Every couple of seconds (app-watch.mjs, after the look at settings.json): the key another window saved for every
  // window is this window's too, unless this one picked its own. Not while it is busy: the next look, when it is done.
  const followKey = () => {
    if (!onClaude()) return;
    const own = rr().ownKey;
    if (own) {
      if (self.settings.remote?.keyId !== own) self.settings.remote = { ...self.settings.remote, keyId: own, keyEnd: list().find((e) => e.id === own)?.end ?? self.settings.remote?.keyEnd };
      return;
    }
    const saved = savedKeyId(self.settings);
    if (!saved || !rr().keyIn || saved === rr().keyIn || busy()) return;
    const e = list().find((x) => x.id === saved) ?? { id: saved, name: '', end: self.settings.remotes?.claude?.keyEnd ?? '' };
    if (swapTo(saved)) note(`Another window switched every window to ${named(e)}${orgWord(e)}: this window sends it from its next request.`);
  };

  // For the account box and the footer: the keys with their accounts and months, and the one in use's entry.
  const keysNow = ({ byOrg = {}, pending = false, key = null } = {}) => {
    const ks = list();
    const id = inUse();
    const e = ks.find((x) => x.id === id) ?? null;
    // The key in use, kept from before the list had marks: its mark from the key the connection sends (no Keychain read).
    if (e && key && e.tag !== keyTag(key)) { try { noteTag(e.id, key); synced(); } catch {} }
    return { rows: keyRows(list(), { inUse: id, byOrg, pending }), name: e?.name || '', own: Boolean(rr().ownKey) };
  };

  return { keyCommand, keyChoice, applyKeyChoice, addPasted, followKey, keysNow };
}
