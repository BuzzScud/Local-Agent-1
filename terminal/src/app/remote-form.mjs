// /remote: one form, like /effort's panel, for a model on another machine.
// Rows: Use (This Mac · Remote), Connect (http · https · SSH tunnel),
// Address, Port, API key, Server (llama.cpp · OpenAI-compatible), Model,
// Context, then Test and Save. ←→ moves a choice row; enter (or typing) on a
// text row edits it in place; Test checks the values as they are now, before
// anything is saved; Save keeps them and switches when Use changed. The key
// never leaves the Keychain except to go in a request's header.
import { DEFAULT_REMOTE, CONNECTS, REMOTE_KINDS, SERVE_PORT, parseAddress, remoteProblem, remoteRisk, directUrl, openTunnel, probe, readKey, keyEnd, validKey, keyStore } from '../../../models/index.mjs';

export const CONTEXTS = [0, 8192, 16384, 32768, 65536, 131072, 262144];
export const REMOTE_ROWS = [
  { id: 'use', label: 'Use', type: 'choice' },
  { id: 'connect', label: 'Connect', type: 'choice' },
  { id: 'address', label: 'Address', type: 'text' },
  { id: 'port', label: 'Port', type: 'text' },
  { id: 'key', label: 'API key', type: 'secret' },
  { id: 'kind', label: 'Server', type: 'choice' },
  { id: 'model', label: 'Model', type: 'text' },
  { id: 'context', label: 'Context', type: 'choice' },
  { id: 'test', label: 'Test', type: 'action' },
  { id: 'save', label: 'Save', type: 'action' },
];
const CHOICES = { use: [false, true], connect: CONNECTS, kind: REMOTE_KINDS, context: CONTEXTS };
const WORDS = {
  use: (v) => (v ? 'Remote' : 'This Mac'),
  connect: (v) => ({ http: 'http', https: 'https', ssh: 'SSH tunnel' })[v] ?? v,
  kind: (v) => ({ llama: 'llama.cpp', openai: 'OpenAI-compatible' })[v] ?? v,
  context: (v) => (v ? `${Math.round(v / 1024)}k` : 'from server'),
};
export const kindWord = (k) => WORDS.kind(k);

// The form as it opens: what settings.json keeps ("remote"). key: null =
// the saved key stays; '' = none; a string = a new one, saved with Save.
export function openForm(saved) {
  const values = { ...DEFAULT_REMOTE, ...(saved ?? {}) };
  return { kind: 'remote', index: 0, values, saved: { ...values }, key: null, editing: null, test: null, error: null };
}

// ←→ on a choice row (clamped at the ends, as in /effort); on the Model row
// after a Test, through the models the server listed.
export function moveRow(form, id, dir) {
  if (id === 'model') {
    const list = form.test?.models ?? [];
    if (!list.length) return form;
    const at = list.indexOf(form.values.model);
    const next = list[Math.max(0, Math.min(list.length - 1, at < 0 ? (dir > 0 ? 0 : list.length - 1) : at + dir))];
    return { ...form, values: { ...form.values, model: next }, error: null };
  }
  const steps = CHOICES[id];
  if (!steps) return form;
  const at = Math.max(0, steps.indexOf(form.values[id]));
  const v = steps[Math.max(0, Math.min(steps.length - 1, at + dir))];
  return { ...form, values: { ...form.values, [id]: v }, error: null, ...(id === 'use' || id === 'context' ? {} : { test: null }) };
}

// What a row shows between ◀ ▶ (or after its label).
export function showValue(form, id) {
  const v = form.values;
  if (WORDS[id]) return WORDS[id](v[id]);
  if (id === 'address') return v.address || 'not set';
  if (id === 'port') return v.port ? String(v.port) : v.connect === 'ssh' || (v.kind === 'llama' && !parseAddress(v.address)?.scheme) ? `${SERVE_PORT}` : 'the address’s own';
  if (id === 'key') {
    if (form.key === '') return 'none';
    if (form.key) return `${'•'.repeat(8)}${keyEnd(form.key)}`;
    return v.key ? `${'•'.repeat(8)}${v.keyEnd ?? ''}` : 'none';
  }
  if (id === 'model') return v.model || (v.kind === 'llama' ? 'the one it runs' : 'not set');
  if (id === 'test') return form.test?.running ? 'checking…' : form.test ? (form.test.ok ? '✔ it works' : '✗ it does not') : 'enter to check';
  if (id === 'save') return 'enter to save';
  return '';
}

// The line after a row: what it means, or what the last Test found.
export function rowNote(form, id) {
  const v = form.values;
  const t = form.test && !form.test.running ? form.test : null;
  switch (id) {
    case 'use': return v.use ? 'your prompts, code and the files it reads go to the remote' : 'the model loads on this Mac';
    case 'connect': return v.connect === 'ssh' ? 'through ssh: nothing open to the network, uses your ssh keys' : v.connect === 'https' ? 'encrypted: across the internet, or a hosted API' : 'a home network or Tailscale';
    case 'address': return v.connect === 'ssh' ? 'user@host, or a name from ~/.ssh/config' : 'an IP or a name · a whole http(s):// address works too';
    case 'port': return v.connect === 'ssh' ? 'the model’s port on that machine (coding serve: 8080)' : 'blank: 8080 for llama.cpp, else the address’s own';
    case 'key': return `enter to type or paste · kept in the ${keyStore() === 'keychain' ? 'Keychain' : 'private key file'}${form.key !== null ? ' · • not saved yet' : ''}`;
    case 'kind': return v.kind === 'llama' ? 'coding serve, or a llama-server you started' : 'vLLM, Ollama, LM Studio, OpenRouter, OpenAI…';
    case 'model': return t?.models?.length ? `←→ picks one of the ${t.models.length} it has` : v.kind === 'llama' ? 'blank: whatever it runs' : 'the name the server wants (Test lists them)';
    case 'context': return t?.ctx ? `the server says ${Math.round(t.ctx / 1024)}k` : 'the server’s own, else 32k';
    case 'test': return form.test?.running ? 'reaching it, checking the key, asking for one word…' : t ? t.steps.map((s) => `${s.ok ? '✔' : '✗'} ${s.text}`).join(' · ') : 'reaches it, checks the key, asks for one word';
    case 'save': return v.use !== form.saved.use ? (v.use ? 'keeps all of it and switches to the remote' : 'keeps all of it and goes back to this Mac') : 'keeps all of it';
    default: return '';
  }
}

// The values as settings.json keeps them (the key itself goes to the Keychain).
export function toProfile(form) {
  const v = form.values;
  const hasKey = form.key === null ? Boolean(v.key) : Boolean(form.key);
  return {
    use: Boolean(v.use), address: String(v.address ?? '').trim(), port: v.port ?? null, connect: v.connect, kind: v.kind,
    model: String(v.model ?? '').trim(), context: v.context ?? 0, key: hasKey, keyEnd: form.key === null ? (hasKey ? v.keyEnd ?? '' : '') : keyEnd(form.key),
  };
}

// The warning under the form: the problem that stops a save, else the risk worth knowing.
export function formWarning(form) {
  const r = toProfile(form);
  if (form.key && !validKey(form.key)) return { tone: 'error', text: 'The API key has a space or a line break in it: paste it again.' };
  if (r.use || r.address) { const p = remoteProblem(r); if (p && (r.use || form.test)) return { tone: r.use ? 'error' : 'warn', text: `Not ready: ${p}.` }; }
  const risk = remoteRisk(r);
  return risk ? { tone: 'warn', text: `⚠ ${risk}.` } : null;
}

// Whether the saved remote and the new one reach a different place (or with another key).
export function connectionChanged(before, after, keyChanged) {
  const b = { ...DEFAULT_REMOTE, ...(before ?? {}) };
  return keyChanged || ['address', 'port', 'connect', 'kind', 'model', 'context'].some((k) => (b[k] ?? null) !== (after[k] ?? null));
}

// ---- editing a text row in place ----------------------------------------------------------------

// Enter or a typed letter on a text row: the key starts empty (a new one
// replaces the old); the others start with what is there.
export function startEdit(form, id, typed = '') {
  const text = id === 'key' ? '' : id === 'port' ? (form.values.port ? String(form.values.port) : '') : String(form.values[id] ?? '');
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

// Enter while editing: the row takes the text. A whole address with its own
// scheme sets Connect to match (http:// or https://).
export function commitEdit(form) {
  const e = form.editing;
  if (!e) return form;
  const values = { ...form.values };
  let key = form.key;
  const text = e.value.trim();
  if (e.id === 'key') key = text;
  else if (e.id === 'port') values.port = text ? Number(text) : null;
  else values[e.id] = text;
  if (e.id === 'address' && values.connect !== 'ssh') {
    const a = parseAddress(text);
    if (a?.scheme) values.connect = a.scheme;
  }
  return { ...form, values, key, editing: null, test: e.id === 'model' ? form.test : null, error: null };
}

// ---- the Test row ------------------------------------------------------------------------------

// Checks the form's values as they are, before any save: the tunnel (opened
// for the check and closed after), the address, the key, the model, one word.
export async function testForm(form, { signal, ssh = 'ssh', timeoutMs = 10_000 } = {}) {
  const r = toProfile(form);
  const problem = remoteProblem(r);
  if (problem) return { ok: false, steps: [{ ok: false, text: problem }], models: [] };
  const key = form.key !== null ? form.key || null : r.key ? readKey() : null;
  if (r.key && !key) return { ok: false, steps: [{ ok: false, text: 'the saved key is not in the Keychain: enter it again' }], models: [] };
  let tunnel = null;
  try {
    let url;
    if (r.connect === 'ssh') {
      tunnel = await openTunnel({ dest: r.address, remotePort: r.port ?? SERVE_PORT, ssh });
      url = tunnel.url;
    } else url = directUrl(r);
    const res = await probe({ url, kind: r.kind, key, model: r.model, reply: true, signal, timeoutMs });
    if (tunnel) res.steps.unshift({ ok: true, text: 'ssh tunnel open' });
    return res;
  } catch (e) {
    return { ok: false, steps: [{ ok: false, text: e.message }], models: [] };
  } finally { tunnel?.stop(); }
}
