// /remote: one form for where the model runs. Its first row, Run on, picks
// This Mac · Claude API · My other computer · Another service, and only that
// one's rows show (the ones seldom changed behind More). Each service keeps
// its own set-up and its own key, so flipping Run on loses nothing. Connect
// checks the rows as they are (the tunnel, the address, the key, one word
// back) and only when that works saves them and switches; Save only keeps
// them. An OpenAI-compatible server with several models and none named opens
// the list (a coder highlighted); enter picks one and the check runs again.
// ←→ moves a choice row; enter (or typing) on a text row edits it in place.
// A key never leaves the Keychain except to go in a request's header.
import { DEFAULT_REMOTE, REMOTE_SOURCES, sourceOf, keyIdOf, SERVE_PORT, CLAUDE_HOST, DEFAULT_CLAUDE_MODEL, CLAUDE_CTX, CLAUDE_MODELS, claudeName, claudeKeyProblem, parseAddress, remoteProblem, remoteRisk, remoteLabel, directUrl, openTunnel, probe, pickRemoteModel, readKey, keyEnd, validKey, keyStore, ollamaCtxOf, ollamaCatalog } from '../../../models/index.mjs';
import { groupsOf, suggestModel } from './remote-models.mjs';
import { readTryouts } from './tryouts.mjs';
import { MEMORY_TO } from '../agent/opening.mjs';

export const SOURCES = ['here', ...REMOTE_SOURCES];
export const CONTEXTS = [0, 8192, 16384, 32768, 65536, 131072, 262144];
const ROW = {
  source: { id: 'source', label: 'Run on', type: 'choice' },
  address: { id: 'address', label: 'Address', type: 'text' },
  connect: { id: 'connect', label: 'Reach by', type: 'choice' },
  key: { id: 'key', label: 'API key', type: 'secret' },
  kind: { id: 'kind', label: 'Server', type: 'choice' },
  model: { id: 'model', label: 'Model', type: 'text' },
  port: { id: 'port', label: 'Port', type: 'text' },
  context: { id: 'context', label: 'Context', type: 'choice' },
  // What the memory sends to a model on another machine (settings.json "memoryToRemote", opening.mjs):
  // one choice for every service, so it is the form's, not a service's.
  memory: { id: 'memory', label: 'Memory sent', type: 'choice' },
  more: { id: 'more', label: 'More', type: 'toggle' },
  go: { id: 'go', label: 'Connect', type: 'action' },
  keep: { id: 'keep', label: 'Save only', type: 'action' },
};
// Each service's rows: the ones most people fill in, then the ones behind More.
const LAYOUT = {
  claude: { main: ['key', 'model'], more: ['address', 'context', 'memory'] },
  machine: { main: ['address', 'connect', 'key'], more: ['port', 'kind', 'model', 'context', 'memory'] },
  openai: { main: ['address', 'key', 'model'], more: ['connect', 'port', 'context', 'memory'] },
};
const CHOICES = { connect: ['http', 'https', 'ssh'], kind: ['llama', 'openai'], context: CONTEXTS };
const WORDS = {
  source: (v) => ({ here: 'This Mac', claude: 'Claude API', machine: 'My other computer', openai: 'Another service' })[v] ?? v,
  connect: (v) => ({ http: 'Home network (http)', https: 'Internet (https)', ssh: 'SSH tunnel' })[v] ?? v,
  kind: (v) => ({ llama: 'llama.cpp', openai: 'OpenAI-compatible', claude: 'Claude API' })[v] ?? v,
  context: (v) => (v ? `${Math.round(v / 1024)}k` : 'from server'),
  memory: (v) => ({ mine: 'only to my own Macs', all: 'to every service', none: 'none' })[v] ?? v,
};
const memoryOf = (settings) => (MEMORY_TO.includes(settings?.memoryToRemote) ? settings.memoryToRemote : 'mine');
export const kindWord = (k) => WORDS.kind(k);
export const sourceWord = (s) => WORDS.source(s);

// A service's set-up before anything is typed.
const FRESH = {
  claude: { ...DEFAULT_REMOTE, source: 'claude', kind: 'claude', connect: 'https', model: DEFAULT_CLAUDE_MODEL },
  machine: { ...DEFAULT_REMOTE, source: 'machine', kind: 'llama', connect: 'http' },
  openai: { ...DEFAULT_REMOTE, source: 'openai', kind: 'openai', connect: 'https' },
};
const strip = ({ use, ...rest }) => rest;

// Each service's saved set-up (settings.json "remotes"), or null when it has none.
// A remote saved before the Run on row (only in "remote") is its service's.
export function remotesOf(settings) {
  const saved = settings?.remotes ?? {};
  const out = {};
  for (const s of REMOTE_SOURCES) out[s] = saved[s] ? { ...FRESH[s], ...strip(saved[s]), source: s } : null;
  const r = settings?.remote;
  if (r && (r.address || r.key || r.kind === 'claude')) {
    const s = sourceOf(r);
    out[s] ??= { ...FRESH[s], ...strip(r), source: s };
  }
  return out;
}

// Whether a saved service can be switched to as it is (/remote claude, /model):
// an address, or for the Claude API a key (its own, or ANTHROPIC_API_KEY).
export const readyRemote = (r) => Boolean(r) && !remoteProblem(r) && (r.kind !== 'claude' || Boolean(r.key || process.env.ANTHROPIC_API_KEY));

// The saved services as /model rows, the one in use marked by the caller. Another
// service is named by its model (it has many), its address going to the row's note.
export function remoteChoices(settings) {
  const all = remotesOf(settings);
  return REMOTE_SOURCES.filter((s) => readyRemote(all[s])).map((s) => {
    const r = all[s];
    return { id: `remote-${s}`, remoteRow: true, source: s, kind: r.kind, profile: r, name: `${WORDS.source(s)} · ${s === 'claude' ? claudeName(r.model || DEFAULT_CLAUDE_MODEL) : s === 'openai' && r.model ? r.model : remoteLabel(r)}` };
  });
}
export const remoteRowDesc = (x) => (x.source === 'claude' ? 'Anthropic · billed to your key' : x.source === 'openai' ? `${x.profile?.model ? `${remoteLabel(x.profile)} · ` : ''}OpenAI-compatible service` : `${WORDS.kind(x.kind)} · another computer`);

// The form as it opens: on the service in use (This Mac when no remote is),
// or on `source`. keys: null = the saved key stays; '' = none; a string = a
// new one, saved with Connect or Save only.
export function openForm(settings, { on = false, source = null } = {}) {
  const saved = remotesOf(settings);
  const inUse = on ? sourceOf(settings?.remote) : 'here';
  return {
    kind: 'remote', source: source ?? inUse, inUse, index: 0, more: false,
    profiles: Object.fromEntries(REMOTE_SOURCES.map((s) => [s, { ...(saved[s] ?? FRESH[s]) }])),
    saved: Object.fromEntries(REMOTE_SOURCES.map((s) => [s, saved[s]])),
    keys: Object.fromEntries(REMOTE_SOURCES.map((s) => [s, null])),
    editing: null, test: null, error: null, tried: false,
    memory: memoryOf(settings), savedMemory: memoryOf(settings),
  };
}

const cur = (form) => form.profiles[form.source] ?? null;
const withValues = (form, patch, more = {}) => ({ ...form, profiles: { ...form.profiles, [form.source]: { ...cur(form), ...patch } }, error: null, ...more });

// The rows shown now: Run on, its service's rows (More's when open), Connect, Save only.
export function rowsOf(form) {
  if (form.source === 'here') return [ROW.source, { ...ROW.go, label: 'Switch' }];
  const l = LAYOUT[form.source];
  return [ROW.source, ...l.main.map((id) => ROW[id]), ROW.more, ...(form.more ? l.more.map((id) => ROW[id]) : []), ROW.go, ROW.keep];
}

// The models the Model row steps through: the Claude list (and any other the key
// listed), or what an OpenAI-compatible server listed when it was checked.
export function modelChoices(form) {
  const v = cur(form);
  if (!v) return [];
  const listed = form.test?.models ?? [];
  if (v.kind !== 'claude') return listed;
  return [...new Set([...CLAUDE_MODELS.map((m) => m.id), v.model || DEFAULT_CLAUDE_MODEL, ...listed])];
}

// The list Connect (or enter on the Model row) opens: the names the server
// listed, a coder highlighted when none is named yet. enter takes that one
// and Connect checks it; esc puts the form back with the list still on the row.
// On an Ollama service (the check read its list, form.test.catalog) the list is
// in /model's groups, each with what it can do, its size and its try-out, the
// copies of one model on one row (←→ picks the copy), and the suggestion is the
// one most likely to run the agent well (suggestModel), not the first name that
// sounds like a coder.
export function openModelPick(form, models = null, { tried = readTryouts(cur(form)?.address) } = {}) {
  const catalog = form.test?.catalog ?? null;
  if (catalog?.models?.length > 1) {
    const g = groupsOf(catalog.models);
    const groups = [
      { text: 'Loaded on the service', note: 'answers at once', list: g.loaded },
      { text: 'Can run the agent', note: 'loads when you connect', list: g.agent },
      { text: 'Chat only', note: 'no tools, so no file reads, edits or commands', list: g.chatOnly },
      { text: 'Helpers', note: 'pictures, search, small jobs: /subagents gives them a job', list: g.helpers },
    ].filter((x) => x.list.length).map((x) => ({ ...x, ids: x.list.map((m) => m.id) }));
    const ids = groups.flatMap((x) => x.ids);
    const v = cur(form)?.model;
    const head = v ? (ids.includes(v) ? v : g.loaded.concat(g.agent, g.chatOnly, g.helpers).find((m) => m.copies.includes(v))?.id) : null;
    const suggested = suggestModel(catalog.models, tried) ?? ids[0];
    const at = head ?? suggested;
    const entries = Object.fromEntries([...g.loaded, ...g.agent, ...g.chatOnly, ...g.helpers].map((m) => [m.id, m]));
    // Which copy each row stands for (a saved model that is a copy: that one).
    const copy = head && head !== v ? { [head]: v } : {};
    const rows = rowsOf(form);
    return { ...form, pick: { models: ids, index: Math.max(0, ids.indexOf(at)), suggested, groups, entries, copy, tried, total: catalog.models.length }, index: Math.max(0, rows.findIndex((r) => r.id === 'model')) };
  }
  const ids = (models?.length ? models : modelChoices(form)).filter(Boolean);
  if (ids.length < 2) return form;
  const v = cur(form)?.model;
  const suggested = (v && ids.includes(v) ? v : pickRemoteModel(ids)) || ids[0];
  const index = Math.max(0, ids.indexOf(suggested));
  const rows = rowsOf(form);
  return { ...form, pick: { models: ids, index, suggested }, index: Math.max(0, rows.findIndex((r) => r.id === 'model')) };
}
export function movePick(form, dir) {
  if (!form.pick) return form;
  const n = form.pick.models.length;
  return { ...form, pick: { ...form.pick, index: (form.pick.index + n + dir) % n } };
}
// ←→ on a row that stands for several copies (laguna-xs-2.1 :latest · :bf16 · :q8_0): the next one.
export function moveCopy(form, dir) {
  const p = form.pick;
  const id = p?.models[p.index];
  const m = p?.entries?.[id];
  if (!m?.copies?.length) return form;
  const all = [id, ...m.copies];
  const now = Math.max(0, all.indexOf(p.copy?.[id] ?? id));
  return { ...form, pick: { ...p, copy: { ...p.copy, [id]: all[(now + all.length + dir) % all.length] } } };
}
// The name the highlighted row stands for (its copy, when one was picked).
export const pickedName = (p, i = p?.index) => { const id = p?.models[i]; return p?.copy?.[id] ?? id; };
export function commitPick(form) {
  const name = pickedName(form.pick);
  if (!name) return form;
  return { ...withValues(form, { model: name }), pick: null };
}
export function closePick(form) {
  return form.pick ? { ...form, pick: null } : form;
}

// ←→ on a choice row, clamped at the ends as in /effort. Run on moves to another
// service (its rows as it left them); More opens (→) and folds (←); the Model
// row walks modelChoices.
export function moveRow(form, id, dir) {
  if (id === 'source') {
    const next = SOURCES[Math.max(0, Math.min(SOURCES.length - 1, SOURCES.indexOf(form.source) + dir))];
    return next === form.source ? form : { ...form, source: next, index: 0, more: false, test: null, error: null, tried: false, pick: null };
  }
  if (id === 'more') return { ...form, more: dir > 0 };
  if (id === 'memory') return { ...form, memory: MEMORY_TO[Math.max(0, Math.min(MEMORY_TO.length - 1, MEMORY_TO.indexOf(form.memory ?? 'mine') + dir))] };
  const v = cur(form);
  if (!v) return form;
  const steps = id === 'model' ? modelChoices(form) : CHOICES[id];
  if (!steps?.length) return form;
  const at = steps.indexOf(id === 'model' && v.kind === 'claude' ? v.model || DEFAULT_CLAUDE_MODEL : v[id]);
  const next = steps[Math.max(0, Math.min(steps.length - 1, at < 0 ? (dir > 0 ? 0 : steps.length - 1) : at + dir))];
  return withValues(form, { [id]: next }, id === 'context' || id === 'model' ? {} : { test: null });
}

// What a row shows between ◀ ▶ (or after its label).
export function showValue(form, id) {
  if (id === 'source') return WORDS.source(form.source);
  if (id === 'more') return form.more ? '▾' : '▸';
  if (id === 'go') return form.test?.running ? 'checking…' : form.source === 'here' ? (form.inUse === 'here' ? 'in use now' : 'enter to switch') : form.test?.needModel ? 'pick a model' : form.test && !form.test.ok ? '✗ it did not work' : 'enter to connect';
  if (id === 'keep') return 'enter to save';
  if (id === 'memory') return WORDS.memory(form.memory ?? 'mine');
  const v = cur(form);
  const claude = v.kind === 'claude';
  if (WORDS[id]) return WORDS[id](v[id]);
  if (id === 'address') return v.address || (claude ? CLAUDE_HOST : 'not set');
  if (id === 'port') return v.port ? String(v.port) : claude && !parseAddress(v.address)?.scheme ? '443' : v.connect === 'ssh' || (v.kind === 'llama' && !parseAddress(v.address)?.scheme) ? `${SERVE_PORT}` : 'the address’s own';
  if (id === 'key') {
    const k = form.keys[form.source];
    if (k === '') return 'none';
    if (k) return `${'•'.repeat(8)}${keyEnd(k)}`;
    if (v.key) return `${'•'.repeat(8)}${v.keyEnd ?? ''}`;
    return claude && process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'none';
  }
  if (id === 'model') return claude ? claudeName(v.model || DEFAULT_CLAUDE_MODEL) : v.model || (v.kind === 'llama' ? 'the one it runs' : 'not set');
  return '';
}

// The line after a row: what it means, or what the last check found.
export function rowNote(form, id) {
  const t = form.test && !form.test.running ? form.test : null;
  if (id === 'source') return ({ here: 'the model loads on this Mac · nothing leaves it', claude: 'Anthropic’s models · billed to your API key', machine: 'running coding serve or a llama-server', openai: 'OpenRouter, OpenAI, Ollama, LM Studio, vLLM…' })[form.source];
  if (id === 'go') {
    // While it runs: what was found so far, what it waits for, and for how long (a model loading
    // on a service can take minutes, and a line that never changes reads as stuck).
    if (form.test?.running) {
      const r = form.test;
      if (!r.waiting) return 'reaching it, checking the key, asking for one word…';
      return `${(r.steps ?? []).map((x) => `✔ ${x.text}`).join(' · ')}${r.steps?.length ? ' · ' : ''}${r.waiting}… ${r.secs ?? 0} s · esc stops`;
    }
    if (t) return t.steps.map((s) => `${s.ok ? '✔' : '✗'} ${s.text}`).join(' · ');
    if (form.source === 'here') return form.inUse === 'here' ? 'this window runs here already' : 'back to the model here · the remotes stay saved';
    return form.source === 'claude' ? 'checks the key and asks for one word (a fraction of a cent), then switches' : 'checks it answers, then saves and switches';
  }
  if (id === 'keep') return form.inUse === form.source ? 'keeps it · Connect uses it now' : `keeps it · this window stays on ${form.inUse === 'here' ? 'this Mac' : WORDS.source(form.inUse)}`;
  if (id === 'memory') return ({ mine: 'facts about you go whole only to coding serve on your own computer; any other service gets the project’s', all: 'every service gets every fact, about you too', none: 'no memory goes with the first step of a conversation' })[form.memory ?? 'mine'];
  const v = cur(form);
  const claude = v.kind === 'claude';
  const ssh = v.connect === 'ssh' && !claude;
  const store = keyStore() === 'keychain' ? 'Keychain' : 'private key file';
  switch (id) {
    case 'more': {
      if (form.more) return 'enter folds them away';
      const fresh = FRESH[form.source];
      const set = LAYOUT[form.source].more.filter((r) => (r === 'memory' ? (form.memory ?? 'mine') !== 'mine' : r === 'model' && v.kind === 'llama' ? v.model : v[r] !== fresh[r]));
      return set.length ? set.map((r) => `${ROW[r].label.toLowerCase()} ${showValue(form, r)}`).join(' · ') : LAYOUT[form.source].more.map((r) => ROW[r].label.toLowerCase()).join(', ');
    }
    case 'address': return claude ? `blank: ${CLAUDE_HOST} · a proxy’s address works too` : ssh ? 'user@host, or a name from ~/.ssh/config' : form.source === 'openai' ? 'the whole address, https:// and its path included' : 'its IP or name (a Tailscale name works too)';
    case 'connect': return ssh ? 'through ssh: nothing open to the network' : v.connect === 'https' ? 'encrypted, across the internet' : 'plain http: a home network or Tailscale';
    case 'key': {
      const pending = form.keys[form.source] !== null ? ' · • not saved yet' : '';
      if (claude) return `sk-ant-… from console.anthropic.com → API keys · kept in the ${store}${process.env.ANTHROPIC_API_KEY ? ' · blank: ANTHROPIC_API_KEY' : ''}${pending}`;
      return `${form.source === 'machine' ? 'the one coding serve printed' : 'the service’s key'} · kept in the ${store}${pending}`;
    }
    case 'kind': return v.kind === 'llama' ? 'coding serve, or a llama-server you started' : 'Ollama, LM Studio, vLLM… on that computer';
    case 'model': {
      if (claude) return CLAUDE_MODELS.find((m) => m.id === (v.model || DEFAULT_CLAUDE_MODEL))?.note ?? 'from your key’s list of models';
      if (t?.models?.length) return `enter opens the list · ←→ picks one of the ${t.models.length} it has`;
      return v.kind === 'llama' ? 'blank: whatever it runs' : 'the name the service wants (Connect lists them)';
    }
    case 'port': return claude ? 'blank: https’s own' : ssh ? 'the model’s port on that computer (coding serve: 8080)' : v.kind === 'llama' ? 'blank: 8080, coding serve’s' : 'blank: the address’s own';
    case 'context': return claude ? `the model’s own, at most ${Math.round(CLAUDE_CTX / 1000)}k: each step sends the chat again` : t?.ctx ? `the server says ${Math.round(t.ctx / 1024)}k` : 'the server’s own, else 32k';
    default: return '';
  }
}

// Whether a row differs from what is saved (the • after it).
export function rowChanged(form, id) {
  if (form.source === 'here' || !(id in ROW) || ['source', 'more', 'go', 'keep'].includes(id)) return false;
  if (id === 'memory') return (form.memory ?? 'mine') !== (form.savedMemory ?? 'mine');
  if (id === 'key') return form.keys[form.source] !== null;
  const before = form.saved[form.source] ?? FRESH[form.source];
  return (cur(form)[id] ?? null) !== (before[id] ?? null);
}

// A service's set-up as settings.json keeps it (the key itself goes to the Keychain).
// contexts: an Ollama service's context by model, set in /effort, kept as it was.
export function toProfile(form, source = form.source) {
  const v = form.profiles[source];
  const k = form.keys[source];
  const hasKey = k === null ? Boolean(v.key) : Boolean(k);
  return {
    source, address: String(v.address ?? '').trim(), port: v.port ?? null,
    connect: v.kind === 'claude' && v.connect === 'ssh' ? 'https' : v.connect, kind: v.kind,
    model: String(v.model ?? '').trim(), context: v.context ?? 0,
    key: hasKey, keyEnd: k === null ? (hasKey ? v.keyEnd ?? '' : '') : keyEnd(k),
    keyId: k || !hasKey ? source : keyIdOf(v),
    ...(v.contexts ? { contexts: v.contexts } : {}),
  };
}

// The warning under the form: a key that cannot be sent (on Anthropic's own
// address, a Claude key's ID pasted for the key stops Connect; another kind of
// key is worth a word); after a Connect, the problem that stopped it.
export function formWarning(form) {
  if (form.source === 'here') return null;
  const k = form.keys[form.source];
  if (k && !validKey(k)) return { tone: 'error', text: 'The API key has a space or a line break in it: paste it again.' };
  const bad = form.source === 'claude' && !cur(form).address ? claudeKeyProblem(k) : null;
  if (bad) return { tone: /^apikey_/i.test(k) ? 'error' : 'warn', text: `${bad[0].toUpperCase()}${bad.slice(1)}.` };
  const r = toProfile(form);
  const p = remoteProblem(r);
  if (p && form.tried) return { tone: 'error', text: `Not ready: ${p}.` };
  const risk = r.address ? remoteRisk(r) : null;
  return risk ? { tone: 'warn', text: `⚠ ${risk}.` } : null;
}

// Whether the saved remote and the new one reach a different place (or with another key).
export function connectionChanged(before, after, keyChanged) {
  const b = { ...DEFAULT_REMOTE, ...(before ?? {}) };
  return keyChanged || sourceOf(b) !== sourceOf(after) || ['address', 'port', 'connect', 'kind', 'model', 'context'].some((k) => (b[k] ?? null) !== (after[k] ?? null));
}

// What Connect or Save only writes. remotes: every service saved before or
// changed in the form (and the one shown). remote, the one in use next: on
// Connect the one shown (This Mac: the last remote, off); on Save only, with
// no remote on, the one just saved (so /remote on finds it), else the one in
// use, with its rows as now. keys: what goes in or out of the Keychain.
export function savePlan(form, settings, { connect = false } = {}) {
  const remotes = { ...(settings?.remotes ?? {}) };
  const keys = [];
  for (const s of REMOTE_SOURCES) {
    const k = form.keys[s];
    const changed = k !== null || LAYOUT[s].main.concat(LAYOUT[s].more).some((id) => id !== 'memory' && (form.profiles[s][id] ?? null) !== ((form.saved[s] ?? FRESH[s])[id] ?? null));
    if (!changed && !form.saved[s] && s !== form.source) continue;
    remotes[s] = toProfile(form, s);
    const old = form.saved[s];
    if (k) {
      keys.push({ op: 'save', id: s, key: k, source: s });
      if (old?.key && keyIdOf(old) !== s) keys.push({ op: 'remove', id: keyIdOf(old) });
    } else if (k === '' && old?.key) keys.push({ op: 'remove', id: keyIdOf(old) });
  }
  const before = settings?.remote ?? null;
  const was = before ? sourceOf(before) : null;
  let remote;
  if (connect) remote = form.source === 'here' ? (before ? { ...before, ...(remotes[was] ?? {}), use: false } : null) : { ...remotes[form.source], use: true };
  else if (!before?.use && form.source !== 'here') remote = { ...remotes[form.source], use: false };
  else remote = before && remotes[was] ? { ...remotes[was], use: Boolean(before.use) } : before;
  // memoryToRemote: only when the Memory sent row changed it.
  return { remotes, remote, keys, ...((form.memory ?? 'mine') !== (form.savedMemory ?? 'mine') ? { memoryToRemote: form.memory } : {}) };
}

// ---- editing a text row in place ----------------------------------------------------------------
// /web edits its rows with these too: its form keeps one set of values and one key.

// Enter or a typed letter on a text row: the key starts empty (a new one
// replaces the old); the others start with what is there.
export function startEdit(form, id, typed = '') {
  const v = form.profiles ? cur(form) : form.values;
  const text = id === 'key' ? '' : id === 'port' ? (v.port ? String(v.port) : '') : String(v[id] ?? '');
  const value = text + typed;
  return { ...form, editing: { id, value, cursor: value.length }, error: null };
}

// One key while editing: letters go in at the cursor, ←→ home end move,
// backspace and delete remove, ctrl+u clears. A paste arrives as many letters.
export function editField(e, ch, key) {
  const { value: v, cursor: c } = e;
  if (key.leftArrow) return { ...e, cursor: Math.max(0, c - 1) };
  if (key.rightArrow) return { ...e, cursor: Math.min(v.length, c + 1) };
  if (key.home || (key.ctrl && ch === 'a')) return { ...e, cursor: 0 };
  if (key.end || (key.ctrl && ch === 'e')) return { ...e, cursor: v.length };
  if (key.ctrl && ch === 'u') return { ...e, value: v.slice(c), cursor: 0 };
  if (key.backspace || key.delete) return c > 0 ? { ...e, value: v.slice(0, c - 1) + v.slice(c), cursor: c - 1 } : e;
  if (key.ctrl || key.meta || key.escape || key.tab || key.return || key.upArrow || key.downArrow || !ch) return e;
  return pasteField(e, ch);
}

// A paste (or typed letters): one line; a key loses every space and break in it.
export function pasteField(e, text) {
  let t = String(text).replace(/\r\n?|\n/g, e.id === 'key' ? '' : ' ');
  if (e.id === 'key') t = t.replace(/\s+/g, '');
  if (e.id === 'port') t = t.replace(/\D+/g, '');
  const value = e.value.slice(0, e.cursor) + t + e.value.slice(e.cursor);
  return { ...e, value, cursor: e.cursor + t.length };
}

// Enter while editing: the row takes the text and the cursor goes to the next
// row (to Connect when the form was opened to ask for this one row). A whole
// address with its own scheme sets Reach by to match (http:// or https://).
export function commitEdit(form) {
  const e = form.editing;
  if (!e) return form;
  const values = { ...(form.profiles ? cur(form) : form.values) };
  const text = e.value.trim();
  if (e.id === 'port') values.port = text ? Number(text) : null;
  else if (e.id !== 'key') values[e.id] = text;
  if (e.id === 'address' && values.connect !== 'ssh') {
    const a = parseAddress(text);
    if (a?.scheme) values.connect = a.scheme;
  }
  // /web: the row takes it, the cursor stays.
  if (!form.profiles) return { ...form, values, key: e.id === 'key' ? text : form.key, editing: null, test: null, error: null };
  const keys = e.id === 'key' ? { ...form.keys, [form.source]: text } : form.keys;
  const next = { ...form, profiles: { ...form.profiles, [form.source]: values }, keys, editing: null, test: e.id === 'model' ? form.test : null, error: null };
  const rows = rowsOf(next);
  const index = next.ask === e.id ? rows.findIndex((r) => r.id === 'go') : Math.min(rows.length - 1, next.index + 1);
  return { ...next, index, ask: null };
}

// ---- checking (Connect) ------------------------------------------------------------------------

// Checks the shown service's rows as they are, before any save: the tunnel
// (opened for the check and closed after), the address, the key, the model, one word.
// autoPick: the CLI names a coder when several are listed; the form passes false
// so Connect can open the list instead of guessing.
// onStep: what the check found so far and what it waits for (probe), for the form's line.
export async function testForm(form, { signal, ssh = 'ssh', timeoutMs = 10_000, autoPick = true, onStep = null, replyMs = null } = {}) {
  const r = toProfile(form);
  const problem = remoteProblem(r);
  if (problem) return { ok: false, steps: [{ ok: false, text: problem }], models: [] };
  const k = form.keys[form.source];
  const key = k !== null ? k || null : r.key ? readKey(keyIdOf(r)) : null;
  if (r.key && !key) return { ok: false, steps: [{ ok: false, text: `the saved key is not in the ${keyStore() === 'keychain' ? 'Keychain' : 'key file'}: enter it again` }], models: [] };
  let tunnel = null;
  try {
    let url;
    if (r.connect === 'ssh' && r.kind !== 'claude') {
      tunnel = await openTunnel({ dest: r.address, remotePort: r.port ?? SERVE_PORT, ssh });
      url = tunnel.url;
    } else url = directUrl(r);
    const res = await probe({ url, kind: r.kind, key, model: r.kind === 'claude' ? r.model || DEFAULT_CLAUDE_MODEL : r.model, numCtx: r.kind === 'openai' ? ollamaCtxOf(r, r.model) : null, reply: true, autoPick, signal, timeoutMs, onStep, replyMs });
    // An Ollama service with several models: its whole list, so the list Connect opens says what each can do.
    if (r.kind === 'openai' && res.models?.length > 1) res.catalog = await ollamaCatalog({ url, key, signal, timeoutMs }).catch(() => null);
    if (tunnel) res.steps.unshift({ ok: true, text: 'ssh tunnel open' });
    return res;
  } catch (e) {
    return { ok: false, steps: [{ ok: false, text: e.message }], models: [] };
  } finally { tunnel?.stop(); }
}

// A check's findings on the form; an OpenAI-compatible server with none named: the one it picked.
export function withTest(form, res, id) {
  const v = cur(form);
  const name = res.model || (res.models?.length === 1 ? res.models[0] : '');
  const fill = v && !v.model && v.kind === 'openai' && name;
  return { ...(fill ? withValues(form, { model: name }) : form), test: { ...res, id } };
}
