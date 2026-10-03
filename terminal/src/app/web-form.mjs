// /web: one form, like /remote's, for what the model may do on the web.
// Rows: Search (Off · Brave Search · Tavily), API key (the search service's,
// kept in the Keychain), Read pages (On · Off), then Test and Save. Editing a
// text row works as in /remote (remote-form.mjs: startEdit, editField,
// pasteField, commitEdit). On the Claude API neither setting is used: Claude
// searches and reads with Anthropic's own web tools, billed to its key.
import { keyEnd, validKey, keyStore } from '../../../models/index.mjs';
import { SEARCH_PROVIDERS, PROVIDER_NAMES, PROVIDER_KEYS, searchWeb, searchKey, searchKeyId } from '../tools/web.mjs';

export const WEB_ROWS = [
  { id: 'search', label: 'Search', type: 'choice' },
  { id: 'key', label: 'API key', type: 'secret' },
  { id: 'fetch', label: 'Read pages', type: 'choice' },
  { id: 'claude', label: 'Claude API', type: 'choice' },
  { id: 'test', label: 'Test', type: 'action' },
  { id: 'save', label: 'Save', type: 'action' },
];
const DEFAULT_WEB = { search: 'off', fetch: true, claude: true, keys: {} };
const CHOICES = { search: ['off', ...SEARCH_PROVIDERS], fetch: [true, false], claude: [true, false] };
const WORDS = {
  search: (v) => (v === 'off' ? 'Off' : PROVIDER_NAMES[v] ?? v),
  fetch: (v) => (v ? 'On' : 'Off'),
  claude: (v) => (v ? 'Its own web tools' : 'Off'),
};
export { searchKey, searchKeyId };
// What settings.json keeps ("web"), with the defaults filled in.
export const webSettings = (saved) => ({ ...DEFAULT_WEB, ...(saved ?? {}), keys: { ...(saved?.keys ?? {}) } });

// The form as it opens. key: null = the saved key stays; '' = none; a string = a new one, saved with Save.
export function openWebForm(saved, { claude = false } = {}) {
  const values = webSettings(saved);
  return { kind: 'web', index: 0, values, saved: { ...values, keys: { ...values.keys } }, key: null, editing: null, test: null, error: null, claude };
}

// ←→ on a choice row, clamped at the ends. Another search service: its own key (a typed one is dropped).
export function moveWebRow(form, id, dir) {
  const steps = CHOICES[id];
  if (!steps) return form;
  const at = Math.max(0, steps.indexOf(form.values[id]));
  const v = steps[Math.max(0, Math.min(steps.length - 1, at + dir))];
  if (v === form.values[id]) return form;
  return { ...form, values: { ...form.values, [id]: v }, ...(id === 'search' ? { key: null, test: null } : {}), error: null };
}

// What a row shows between ◀ ▶ (or after its label).
export function showWebValue(form, id) {
  const v = form.values;
  if (WORDS[id]) return WORDS[id](v[id]);
  if (id === 'key') {
    if (v.search === 'off') return '—';
    if (form.key === '') return 'none';
    if (form.key) return `${'•'.repeat(8)}${keyEnd(form.key)}`;
    const k = v.keys[v.search];
    return k ? `${'•'.repeat(8)}${k.end ?? ''}` : 'none';
  }
  if (id === 'test') return form.test?.running ? 'searching…' : form.test ? (form.test.ok ? '✔ it works' : '✗ it does not') : 'enter to check';
  if (id === 'save') return 'enter to save';
  return '';
}

// The line after a row.
export function webRowNote(form, id) {
  const v = form.values;
  const t = form.test && !form.test.running ? form.test : null;
  const store = keyStore() === 'keychain' ? 'Keychain' : 'private key file';
  const claude = form.claude && v.claude ? ' · on the Claude API now: Claude uses its own instead' : '';
  switch (id) {
    case 'search': return v.search === 'off' ? `the model cannot search the web; it can still read a page${claude}` : `${v.search === 'brave' ? 'Brave’s own web index' : 'a search made for AI agents'} · your searches go to ${PROVIDER_NAMES[v.search]}${claude}`;
    case 'key': return v.search === 'off' ? 'pick a search service first' : `from ${PROVIDER_KEYS[v.search]} · enter to type or paste · kept in the ${store}${form.key !== null ? ' · • not saved yet' : ''}`;
    case 'fetch': return v.fetch ? `the model may read a web page you or a search names; each site asks you first${claude}` : 'no web page is read';
    case 'claude': return v.claude ? 'with /remote on the Claude API: Claude searches and reads pages on Anthropic’s side, billed to its key, without asking here' : 'with /remote on the Claude API: no web search or pages at all';
    case 'test': return form.test?.running ? `searching ${PROVIDER_NAMES[v.search] ?? ''} with the key…` : t ? t.steps.map((s) => `${s.ok ? '✔' : '✗'} ${s.text}`).join(' · ') : v.search === 'off' ? 'nothing to check with Search off' : 'one search, with the key as it is now';
    case 'save': return 'keeps all of it, for every folder';
    default: return '';
  }
}

// The problem that stops a save, or null.
export function webWarning(form) {
  if (form.key && !validKey(form.key)) return { tone: 'error', text: 'The API key has a space or a line break in it: paste it again.' };
  const v = form.values;
  const has = form.key === null ? Boolean(v.keys[v.search]) : Boolean(form.key);
  if (v.search !== 'off' && !has) return { tone: 'warn', text: `${PROVIDER_NAMES[v.search]} needs an API key: add it on the API key row.` };
  return null;
}

// The values as settings.json keeps them (the key itself goes to the Keychain).
export function toWebSettings(form) {
  const v = form.values;
  const keys = { ...v.keys };
  if (v.search !== 'off' && form.key !== null) {
    if (form.key) keys[v.search] = { end: keyEnd(form.key) };
    else delete keys[v.search];
  }
  return { search: v.search, fetch: Boolean(v.fetch), claude: Boolean(v.claude), keys };
}

// Test: one search with the key as it is now (typed, or the saved one), before anything is saved.
export async function testWebForm(form, { signal, timeoutMs = 10_000 } = {}) {
  const v = form.values;
  if (v.search === 'off') return { ok: true, steps: [{ ok: true, text: 'Search is off: nothing to check' }] };
  const key = form.key !== null ? form.key || null : v.keys[v.search] ? searchKey(v.search) : null;
  if (!key) return { ok: false, steps: [{ ok: false, text: v.keys[v.search] && form.key === null ? 'the saved key is not in the Keychain: enter it again' : 'no API key yet' }] };
  try {
    const t0 = Date.now();
    const found = await searchWeb('Agentic Coder terminal coding agent', { provider: v.search, key, count: 3, signal, timeoutMs });
    return { ok: true, steps: [{ ok: true, text: `the key works` }, { ok: true, text: `${found.length} result${found.length === 1 ? '' : 's'} in ${((Date.now() - t0) / 1000).toFixed(1)} s${found[0] ? `, first: ${found[0].title.slice(0, 50)}` : ''}` }] };
  } catch (e) {
    return { ok: false, steps: [{ ok: false, text: e.message }] };
  }
}
