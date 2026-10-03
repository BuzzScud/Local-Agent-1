// /mcp: your MCP servers in one picker, on the pieces of /web's and /remote's form (web-form.mjs,
// remote-form.mjs: rows, ◀ ▶ choices, a text row edited in place, • for a change not saved yet).
// Four views:
//   list     each server: connected or not, where it runs, its tools; + Add a server
//   form     one server: Name, Runs (a command here · an address), then that kind's rows, Test, Save
//   tools    one server's tools: on or off, and "reads", your own mark (the server's own label is
//            shown beside it and never trusted)
//   project  a project's own servers (.agentic/mcp.json), before they may start
// This file is the picker's state and words; the servers are kept by mcp-store.mjs and run by
// tools/mcp.mjs, and App.jsx does the saving and the keys.
import { keyEnd, validKey, keyStore } from '../../../models/index.mjs';
import { SERVER_NAME } from '../agent/mcp.mjs';
import { serverOf, commandLine, commandWords } from './mcp-store.mjs';
import { whereOf } from '../tools/mcp.mjs';

export const RUNS = ['command', 'address'];
const RUN_WORDS = { command: 'a command here', address: 'an address' };
export const SIGNINS = ['none', 'key', 'oauth'];
const SIGNIN_WORDS = { none: 'no key', key: 'a key in a header', oauth: 'sign in (browser)' };
const CLAUDE_WORDS = { here: 'through this Mac', connector: 'Anthropic’s connector' };

// The rows of the form, by how the server runs.
const ROWS = {
  command: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'runs', label: 'Runs', type: 'choice' },
    { id: 'command', label: 'Command', type: 'text' },
    { id: 'keyEnv', label: 'Key goes in', type: 'text' },
    { id: 'key', label: 'Key', type: 'secret' },
    { id: 'sandbox', label: 'Sandbox', type: 'choice' },
    { id: 'net', label: 'Internet', type: 'choice' },
    { id: 'local', label: 'Local services', type: 'text' },
    { id: 'test', label: 'Test', type: 'action' },
    { id: 'save', label: 'Save', type: 'action' },
  ],
  address: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'runs', label: 'Runs', type: 'choice' },
    { id: 'url', label: 'Address', type: 'text' },
    { id: 'auth', label: 'Sign in', type: 'choice' },
    { id: 'key', label: 'Key', type: 'secret' },
    { id: 'claude', label: 'On Claude', type: 'choice' },
    { id: 'test', label: 'Test', type: 'action' },
    { id: 'save', label: 'Save', type: 'action' },
  ],
};
// extras: the Level 1 rows (sign-in in the browser, Anthropic's connector) are offered.
export const formRows = (form) => ROWS[form.values.runs].filter((r) => (r.id !== 'key' || form.values.runs === 'command' || form.values.auth === 'key') && (r.id !== 'claude' || form.extras));
const CHOICES = (form) => ({ runs: RUNS, sandbox: [true, false], net: [false, true], auth: form.extras ? SIGNINS : SIGNINS.filter((s) => s !== 'oauth'), claude: ['here', 'connector'] });

const DEFAULTS = { name: '', runs: 'command', command: '', keyEnv: '', sandbox: true, net: false, local: '', url: '', auth: 'none', claude: 'here' };
const localText = (local) => (local === 'any' ? 'any' : (local ?? []).join(', '));
// A typed "Local services": ports of services already running on this Mac ("5432, 6379"), "any", or nothing.
export function parseLocal(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (!t || t === 'none') return [];
  if (t === 'any' || t === 'all') return 'any';
  const ports = t.split(/[\s,]+/).map((p) => Number(p.replace(/^(127\.0\.0\.1|localhost):/, '')));
  return ports.every((p) => Number.isInteger(p) && p > 0 && p < 65536) ? [...new Set(ports)] : null;
}

// ---- the list -----------------------------------------------------------------------------------

// status: tools/mcp.mjs status(); project: mcp-store.mjs readProject (or null).
export function openMcpList({ status = [], project = null, extras = false, index = 0, note = null } = {}) {
  return { kind: 'mcp', view: 'list', index: Math.min(index, status.length), status, project, extras, note, confirm: null };
}
// The rows: each server, then "+ Add a server", then the project's line when its file waits for an answer.
export function listRows(pk) {
  const rows = pk.status.map((s) => ({ id: `server:${s.name}`, server: s }));
  rows.push({ id: 'add' });
  if (pk.project?.servers.length && pk.project.answer !== 'yes') rows.push({ id: 'project' });
  return rows;
}
const STATE_WORDS = { connected: 'connected', starting: 'starting…', failed: 'not running', off: 'off', signin: 'sign in: s' };
// One server's line: [dot, state, where, tools].
export function serverLine(s) {
  const tools = s.state !== 'connected' ? (s.error ?? '') : `${s.off ? `${s.tools - s.off} of ${s.tools} tools on` : `${s.tools} tool${s.tools === 1 ? '' : 's'}`}${s.reads ? ` · ${s.reads} read${s.reads === 1 ? 's' : ''}` : ''}${s.changes ? ' · changed its tools' : ''}`;
  return { dot: s.state === 'connected' ? '●' : s.state === 'starting' ? '◐' : '○', state: STATE_WORDS[s.state] ?? s.state, where: `${s.where}${s.from === 'project' ? ' · this project’s' : ''}`, tools };
}
export const projectLine = (p) => `${p.servers.length} server${p.servers.length === 1 ? '' : 's'} of this project (${p.servers.map((s) => s.name).join(', ')}) ${p.answer === 'never' ? 'will not be started: you said never' : p.changed ? 'changed since you allowed them: not started' : 'not started yet'} · enter to look`;

// ---- the form -----------------------------------------------------------------------------------

// A new server, or one being changed (server: as mcp-store.mjs serverOf gives it).
export function openMcpForm(pk, server = null) {
  const values = server ? { ...DEFAULTS, name: server.name, runs: server.runs, command: server.runs === 'command' ? commandLine(server) : '', keyEnv: server.keyEnv ?? '', sandbox: server.sandbox !== false, net: server.net === true, local: localText(server.local), url: server.url ?? '', auth: server.auth ?? 'none', claude: server.claude ?? 'here' } : { ...DEFAULTS };
  return { ...pk, view: 'form', index: 0, values, saved: server ? { ...values } : null, was: server?.name ?? null, server, key: null, editing: null, test: null, error: null, confirm: null };
}
export function moveMcpRow(form, id, dir) {
  const steps = CHOICES(form)[id];
  if (!steps) return form;
  const at = Math.max(0, steps.indexOf(form.values[id]));
  const v = steps[Math.max(0, Math.min(steps.length - 1, at + dir))];
  if (v === form.values[id]) return form;
  const next = { ...form, values: { ...form.values, [id]: v }, test: null, error: null };
  // Another way of running: the cursor stays on the row, the rows under it change.
  return id === 'runs' ? { ...next, key: null } : next;
}
export const startMcpEdit = (form, id) => ({ ...form, editing: { id, value: id === 'key' ? '' : String(form.values[id] ?? ''), cursor: id === 'key' ? 0 : String(form.values[id] ?? '').length }, error: null });
export function commitMcpEdit(form) {
  const e = form.editing;
  if (!e) return form;
  const text = e.value.trim();
  if (e.id === 'key') return { ...form, key: text, editing: null, test: null, error: null };
  return { ...form, values: { ...form.values, [e.id]: text }, editing: null, test: null, error: null };
}
export const mcpRowChanged = (form, id) => (id === 'key' ? form.key !== null : !form.saved ? form.values[id] !== DEFAULTS[id] : form.values[id] !== form.saved[id]);

// What a row shows.
export function showMcpValue(form, id) {
  const v = form.values;
  switch (id) {
    case 'runs': return RUN_WORDS[v.runs];
    case 'sandbox': return v.sandbox ? 'on' : 'off';
    case 'net': return v.sandbox ? (v.net ? 'on' : 'off') : '—';
    case 'local': return v.sandbox ? v.local || 'none' : '—';
    case 'auth': return SIGNIN_WORDS[v.auth];
    case 'claude': return CLAUDE_WORDS[v.claude];
    case 'keyEnv': return v.keyEnv || 'no key';
    case 'key': {
      if (form.key === '') return 'none';
      if (form.key) return `${'•'.repeat(8)}${keyEnd(form.key)}`;
      return form.server?.hasKey ? `${'•'.repeat(8)}${form.server.keyEnd ?? ''}` : 'none';
    }
    case 'test': return form.test?.running ? (form.test.step ? 'signing in…' : 'starting it…') : form.test ? (form.test.ok ? '✔ it works' : '✗ it does not') : 'enter to check';
    case 'save': return 'enter to save';
    default: return String(v[id] ?? '') || '—';
  }
}
// The line after a row.
export function mcpRowNote(form, id) {
  const v = form.values;
  const store = keyStore() === 'keychain' ? 'Keychain' : 'private key file';
  switch (id) {
    case 'name': return v.name ? `its tools: mcp__${v.name}__…` : 'letters, digits and hyphens: github, shop-db';
    case 'runs': return v.runs === 'address' ? 'a service, or a server on another machine' : 'a program on this Mac';
    case 'command': return 'as you would type it: npx -y some-server · started in the project folder';
    case 'url': return 'https://…/mcp · both MCP versions are tried';
    case 'keyEnv': return v.keyEnv ? 'the environment variable its key goes in' : 'the variable a key goes in: GITHUB_TOKEN';
    case 'key': return v.runs === 'command' && !v.keyEnv ? 'name the variable it goes in first' : `enter to type or paste · kept in the ${store}${form.key !== null ? ' · • not saved yet' : ''}`;
    case 'sandbox': return v.sandbox ? 'macOS keeps it in the project' : 'it runs with all your permissions';
    case 'net': return !v.sandbox ? '' : v.net ? 'it may reach any site' : 'no internet';
    case 'local': return !v.sandbox ? '' : parseLocal(v.local) === 'any' ? 'every service running on this Mac' : parseLocal(v.local)?.length ? 'only these ports of this Mac' : 'ports it may reach here: 5432 · any';
    case 'auth': return v.auth === 'oauth' ? 'a browser page once; the token is kept' : v.auth === 'key' ? `Authorization: Bearer … · kept in the ${store}` : 'it needs no key';
    case 'claude': return v.claude === 'connector' ? 'Claude calls it from Anthropic’s side: no question here' : 'the same on every model';
    case 'test': return form.test?.step ?? (v.runs === 'address' && v.auth === 'oauth' ? 'signs in, then lists its tools' : 'starts it once and lists its tools');
    case 'save': return form.was ? 'keeps the changes, for every folder' : 'for every folder (mcp.json)';
    default: return '';
  }
}
// What Test found, in lines.
export function testLines(test) {
  if (!test || test.running) return [];
  if (!test.ok) return [{ ok: false, text: test.error }];
  const head = `${test.info?.name ? `${test.info.name} ` : ''}started in ${(test.ms / 1000).toFixed(1)} s · speaks ${test.version ?? '2025-11-25'}${test.era === 'legacy' ? ' (the older way, fine)' : ''} · ${test.tools.length} tool${test.tools.length === 1 ? '' : 's'}${test.fenced ? ' · in its sandbox' : ''}`;
  return [{ ok: true, text: head }, ...test.tools.slice(0, 8).map((t) => ({ tool: t })), ...(test.tools.length > 8 ? [{ more: test.tools.length - 8 }] : []), { note: 'What a tool says about itself is shown, never trusted; you mark yours after Save.' }];
}

// The problem that stops a save (or a test), or null.
export function mcpWarning(form) {
  const v = form.values;
  if (!v.name) return { tone: 'warn', text: 'Give it a name: github, shop-db.' };
  if (!SERVER_NAME.test(v.name)) return { tone: 'error', text: 'A name is letters, digits and hyphens, at most 32: github, shop-db.' };
  if (form.names?.includes(v.name) && v.name !== form.was) return { tone: 'error', text: `There is a server called ${v.name} already: pick another name.` };
  if (v.runs === 'command') {
    if (!commandWords(v.command).length) return { tone: 'warn', text: 'Type the command that starts it: npx -y some-server' };
    if (v.keyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.keyEnv)) return { tone: 'error', text: 'The variable a key goes in is one word, like GITHUB_TOKEN.' };
    if (v.sandbox && parseLocal(v.local) === null) return { tone: 'error', text: 'Local services: port numbers (5432, 6379), "any", or nothing.' };
    if (form.key && !v.keyEnv) return { tone: 'error', text: 'Name the variable the key goes in (the Key goes in row).' };
  } else {
    let u = null;
    try { u = new URL(v.url); } catch { /* said below */ }
    if (!u || !/^https?:$/.test(u.protocol)) return { tone: v.url ? 'error' : 'warn', text: 'Type its address: https://…/mcp' };
    if (v.claude === 'connector' && u.protocol !== 'https:') return { tone: 'error', text: 'Anthropic’s connector reaches https addresses on the public internet only.' };
  }
  if (form.key && !validKey(form.key)) return { tone: 'error', text: 'The key has a space or a line break in it: paste it again.' };
  return null;
}

// The server as the store keeps it, from the form (its key goes to the Keychain apart).
export function formServer(form, { cwd = null } = {}) {
  const v = form.values;
  const old = form.server ?? {};
  // key: null = the kept key stays; '' = none; a string = a new one (App.jsx puts it in the Keychain).
  const key = form.key === null ? (old.hasKey && form.was ? { end: old.keyEnd ?? '' } : undefined) : form.key ? { end: keyEnd(form.key) } : undefined;
  const raw = v.runs === 'command'
    ? { command: v.command, env: old.runs === 'command' ? old.env : undefined, read: old.runs === 'command' ? old.read : undefined, keyEnv: v.keyEnv || undefined, sandbox: v.sandbox, net: v.sandbox && v.net, local: v.sandbox ? parseLocal(v.local) ?? [] : [] }
    : { url: v.url, auth: v.auth, claude: v.claude, header: old.header };
  const s = serverOf(v.name, { ...raw, on: old.on, timeout: old.timeout, key, tools: form.was === v.name ? old.marks : undefined }, { from: 'you', cwd });
  return s;
}
export const savedNote = (s) => `MCP server ${s.name} saved: ${whereOf(s)}. Its tools join at your next message.`;

// ---- a server's tools ---------------------------------------------------------------------------

// tools: tools/mcp.mjs toolsOf (name, description, print, says); marks: { off, reads } as saved.
export function openMcpTools(pk, server, tools) {
  return { ...pk, view: 'tools', server, tools, marks: { off: [...(server.marks?.off ?? [])], reads: { ...(server.marks?.reads ?? {}) } }, toolIndex: 0, open: false, confirm: null };
}
export const toolState = (pk, t) => ({ on: !pk.marks.off.includes(t.name), reads: pk.marks.reads[t.name] === t.print, changed: Boolean(pk.marks.reads[t.name]) && pk.marks.reads[t.name] !== t.print });
// space: on or off. r: your "reads" mark, for the tool as it is now.
export function toggleTool(pk, what) {
  const t = pk.tools[pk.toolIndex];
  if (!t) return pk;
  const marks = { off: [...pk.marks.off], reads: { ...pk.marks.reads } };
  if (what === 'on') marks.off = marks.off.includes(t.name) ? marks.off.filter((n) => n !== t.name) : [...marks.off, t.name];
  else if (marks.reads[t.name] === t.print) delete marks.reads[t.name]; else marks.reads[t.name] = t.print;
  return { ...pk, marks };
}
// The rows that fit: the tools around the cursor.
export function toolWindow(pk, room) {
  const n = pk.tools.length;
  const size = Math.max(3, Math.min(n, room));
  const start = Math.max(0, Math.min(pk.toolIndex - Math.floor(size / 2), n - size));
  return { start, shown: pk.tools.slice(start, start + size), above: start, below: Math.max(0, n - start - size) };
}
export function toolNote(pk, t) {
  if (!t) return '';
  const st = toolState(pk, t);
  if (st.changed) return 'It changed since you marked it as reading: the mark no longer holds. r marks it again.';
  if (!st.on) return 'Off: the model never sees it.';
  return st.reads ? 'You marked it as reading: Auto runs it, plan mode allows it, explore helpers get it.' : 'It asks before its first use; plan mode refuses it.';
}
