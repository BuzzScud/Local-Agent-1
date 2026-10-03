// Where your MCP servers are kept (3 Oct 2026), and what you said about them.
//   ~/.agentic-coder/mcp.json            your servers, for every folder (the /mcp form saves it)
//   <project>/.agentic/mcp.json          a project's own servers: never started before you said
//                                        yes to them, and asked about again when the file changes
//   ~/.agentic-coder/mcp-state.json      your answers and marks, in the app's own folder so a
//                                        project cannot arrive with them: a project's yes (with
//                                        the file's fingerprint), your marks on its tools, the
//                                        fingerprint each "always allow" was given for, and
//                                        which protocol era a server spoke last time
// A key is never in these files: the Keychain holds it (models/runtime/remote.mjs), under
// mcp-<server>, and a server started as a program gets it in the environment variable you name.
//
// One server in a file, either way of writing it (ours, or the mcpServers block a server's own
// instructions give):
//   "postgres": { "command": "uvx postgres-mcp --access-mode=restricted", "keyEnv": "DATABASE_URI",
//                 "sandbox": true, "net": false, "local": [5432] }
//   "github":   { "url": "https://…/mcp", "auth": "key" }           auth: none · key · oauth
//   "files":    { "command": "npx", "args": ["-y", "some-server", "."], "env": { "MODE": "ro" } }
// ("read": ["~/code/my-server"] lets a sandboxed program read a folder outside the project: its own.)
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readKey, saveKey, removeKey, keyEnd } from '../../../models/index.mjs';
import { realFolder } from './trust.mjs';
import { SERVER_NAME } from '../agent/mcp.mjs';

// Read when used, not at import, so tests can point it at their own home.
const home = () => process.env.AGENTIC_HOME ?? join(homedir(), '.agentic-coder');
export const mcpFile = () => join(home(), 'mcp.json');
export const mcpStateFile = () => join(home(), 'mcp-state.json');
export const projectMcpFile = (cwd) => join(cwd, '.agentic', 'mcp.json');
export const mcpLogFile = (name) => join(home(), 'logs', `mcp-${name}.log`);
const tilde = (p) => (String(p).startsWith(homedir()) ? `~${String(p).slice(homedir().length)}` : p);
const sha = (text, n = 16) => createHash('sha256').update(text).digest('hex').slice(0, n);

export const AUTHS = ['none', 'key', 'oauth'];
export const MAX_SERVERS = 24;

// A command line as its words: spaces split, quotes keep ("--name=a b" stays one word). Unlike a
// shell command's words (permissions.mjs), "=" and "," are part of a word here.
export function commandWords(line) {
  const words = [];
  let cur = '', has = false, quote = null;
  for (const c of String(line ?? '')) {
    if (quote) { if (c === quote) quote = null; else cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (/\s/.test(c)) { if (has) words.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (has) words.push(cur);
  return words;
}
const quoted = (w) => (/[\s"']/.test(w) || w === '' ? `"${w.replace(/"/g, '\\"')}"` : w);
export const commandLine = (s) => [s.command, ...(s.args ?? [])].filter((w) => w !== undefined && w !== null).map((w) => quoted(String(w))).join(' ');

// The Keychain entry of a server's key. A project's server has its own, by the folder it is in.
export const mcpKeyId = (name, from = 'you', cwd = null) => (from === 'project' && cwd ? `mcp-p${sha(realFolder(cwd), 8)}-${name}` : `mcp-${name}`);

// One server as the app uses it, from what a file holds. null: not a server (no command, no address).
export function serverOf(name, raw, { from = 'you', cwd = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !SERVER_NAME.test(name)) return null;
  const words = Array.isArray(raw.args) ? [String(raw.command ?? ''), ...raw.args.map(String)] : commandWords(raw.command);
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!words[0] && !url) return null;
  const local = raw.local === 'any' ? 'any' : Array.isArray(raw.local) ? [...new Set(raw.local.map(Number).filter((p) => Number.isInteger(p) && p > 0 && p < 65536))] : [];
  const env = raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env) ? Object.fromEntries(Object.entries(raw.env).filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)])) : {};
  const marks = { off: Array.isArray(raw.tools?.off) ? raw.tools.off.filter((x) => typeof x === 'string') : [], reads: raw.tools?.reads && typeof raw.tools.reads === 'object' ? { ...raw.tools.reads } : {} };
  const base = { name, from, on: raw.on !== false, timeout: Number(raw.timeout) > 0 ? Number(raw.timeout) : null, marks, keyId: mcpKeyId(name, from, cwd), hasKey: Boolean(raw.key), keyEnd: typeof raw.key?.end === 'string' ? raw.key.end : '' };
  if (url) {
    const auth = AUTHS.includes(raw.auth) ? raw.auth : raw.key ? 'key' : 'none';
    return { ...base, runs: 'address', url, auth, header: typeof raw.header === 'string' && /^[A-Za-z0-9-]+$/.test(raw.header) ? raw.header : 'Authorization', claude: raw.claude === 'connector' ? 'connector' : 'here' };
  }
  // read: folders outside the project its sandbox lets it read (the server's own, when it lives in your home folder).
  const read = Array.isArray(raw.read) ? raw.read.filter((x) => typeof x === 'string' && x.trim()) : [];
  return { ...base, runs: 'command', command: words[0], args: words.slice(1), env, keyEnv: typeof raw.keyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.keyEnv) ? raw.keyEnv : null, sandbox: raw.sandbox !== false, net: raw.net === true, local, read };
}

// A server as its file keeps it (the form saves this).
export function toFile(s) {
  const tools = { ...(s.marks?.off?.length ? { off: s.marks.off } : {}), ...(Object.keys(s.marks?.reads ?? {}).length ? { reads: s.marks.reads } : {}) };
  const common = { ...(s.on === false ? { on: false } : {}), ...(s.timeout ? { timeout: s.timeout } : {}), ...(s.hasKey ? { key: { end: s.keyEnd ?? '' } } : {}), ...(Object.keys(tools).length ? { tools } : {}) };
  if (s.runs === 'address') return { url: s.url, auth: s.auth ?? 'none', ...(s.header && s.header !== 'Authorization' ? { header: s.header } : {}), ...(s.claude === 'connector' ? { claude: 'connector' } : {}), ...common };
  return { command: commandLine(s), ...(Object.keys(s.env ?? {}).length ? { env: s.env } : {}), ...(s.keyEnv ? { keyEnv: s.keyEnv } : {}), sandbox: s.sandbox !== false, net: s.net === true, ...(s.local === 'any' ? { local: 'any' } : s.local?.length ? { local: s.local } : {}), ...(s.read?.length ? { read: s.read } : {}), ...common };
}

// { data, broken }: a file's content, or {} and why it could not be read. A file that cannot be
// read is never written over: a typo in it must not wipe your servers.
function readJson(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch (e) { return { data: {}, raw: null, broken: e.code === 'ENOENT' ? null : e.message }; }
  if (!raw.trim()) return { data: {}, raw, broken: null };
  try { const d = JSON.parse(raw); return d && typeof d === 'object' && !Array.isArray(d) ? { data: d, raw, broken: null } : { data: {}, raw, broken: 'it is not a JSON object' }; } catch (e) { return { data: {}, raw, broken: e.message }; }
}
function writeJson(file, data) {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}
const serversIn = (data) => { const s = data.servers ?? data.mcpServers; return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; };

// Your servers: [server], and why the file could not be read (then none).
export function readServers() {
  const { data, broken } = readJson(mcpFile());
  return { servers: Object.entries(serversIn(data)).map(([name, raw]) => serverOf(name, raw)).filter(Boolean).slice(0, MAX_SERVERS), broken: broken ? `${tilde(mcpFile())} cannot be read (${broken})` : null };
}
function changeServers(fn) {
  const { data, broken } = readJson(mcpFile());
  if (broken) return { ok: false, error: `${tilde(mcpFile())} cannot be read (${broken}). Fix or delete it, then try again.` };
  const servers = { ...serversIn(data) };
  const r = fn(servers);
  if (r.ok) { const { mcpServers: _m, ...rest } = data; writeJson(mcpFile(), { ...rest, servers }); }
  return r;
}
// Save one server (a new one, or the same name again). was: its name before, when it was renamed.
export function saveServer(server, { was = null } = {}) {
  if (!SERVER_NAME.test(server.name)) return { ok: false, error: 'A name is letters, digits and hyphens (github, shop-db), at most 32.' };
  return changeServers((servers) => {
    if (was && was !== server.name) delete servers[was];
    if (!(server.name in servers) && Object.keys(servers).length >= MAX_SERVERS) return { ok: false, error: `That is ${MAX_SERVERS} servers already. Remove one first.` };
    servers[server.name] = toFile(server);
    return { ok: true };
  });
}
export const removeServer = (name) => changeServers((servers) => { if (!(name in servers)) return { ok: false, missing: true }; delete servers[name]; return { ok: true }; });

// ---- what you said: the state file --------------------------------------------------------------

const readState = () => { const { data } = readJson(mcpStateFile()); return { projects: {}, allowed: {}, eras: {}, ...data }; };
function changeState(fn) { const s = readState(); fn(s); try { writeJson(mcpStateFile(), s); } catch { /* a home that cannot be written: it holds for this run only */ } return s; }

// A project's own servers, as its file is now: { file, print, servers, answer, broken } or null (no file).
// answer: 'yes' (you allowed this very file), 'never', or null (not asked, or the file changed since).
export function readProject(cwd) {
  const file = projectMcpFile(cwd);
  if (!existsSync(file)) return null;
  const { data, raw, broken } = readJson(file);
  const print = sha(raw ?? '');
  const key = realFolder(cwd);
  const saved = readState().projects[key];
  const marks = saved?.marks ?? {};
  const servers = Object.entries(serversIn(data)).map(([name, r]) => serverOf(name, { ...r, tools: marks[name] }, { from: 'project', cwd })).filter(Boolean).slice(0, MAX_SERVERS);
  return { file, print, servers, answer: saved?.print === print || saved?.answer === 'never' ? saved.answer ?? null : null, changed: Boolean(saved?.print) && saved.print !== print, broken: broken ? `${tilde(file)} cannot be read (${broken})` : null };
}
// Your answer for a project's file as it is now ('yes' or 'never'); a changed file asks again.
export function answerProject(cwd, print, answer) {
  changeState((s) => { const key = realFolder(cwd); s.projects[key] = { ...(s.projects[key] ?? {}), print, answer, at: new Date().toISOString() }; });
}

// Your marks on a server's tools: which are off, and which you say only read (with the tool's
// fingerprint, so the mark holds for that tool as it was). A project's server keeps them in the
// state file, yours in mcp.json.
export function saveMarks(server, marks, cwd) {
  const clean = { off: [...new Set(marks.off ?? [])], reads: { ...(marks.reads ?? {}) } };
  if (server.from === 'project') { changeState((s) => { const key = realFolder(cwd); s.projects[key] = { ...(s.projects[key] ?? {}), marks: { ...(s.projects[key]?.marks ?? {}), [server.name]: clean } }; }); return { ok: true }; }
  return changeServers((servers) => { if (!(server.name in servers)) return { ok: false, missing: true }; const t = { ...(clean.off.length ? { off: clean.off } : {}), ...(Object.keys(clean.reads).length ? { reads: clean.reads } : {}) }; const { tools: _t, ...rest } = servers[server.name]; servers[server.name] = { ...rest, ...(Object.keys(t).length ? { tools: t } : {}) }; return { ok: true }; });
}

// The fingerprint a tool had when you said "always allow": a tool that changed since asks again.
export const allowedPrint = (id) => readState().allowed[id] ?? null;
export const rememberAllowed = (id, print) => { changeState((s) => { s.allowed[id] = print; }); };

// Which era a server started as a program spoke last time, so its start is not probed again
// (the probe starts the program once more). Kept a week, for the command as it is.
const ERA_DAYS = 7;
const eraKey = (s) => `${s.name}|${sha(commandLine(s), 8)}`;
export function knownEra(server) {
  const e = readState().eras[eraKey(server)];
  return e && Date.now() - e.at < ERA_DAYS * 86_400_000 ? e : null;
}
export const rememberEra = (server, era, discover = null) => { changeState((s) => { s.eras[eraKey(server)] = { era, at: Date.now(), ...(discover ? { discover } : {}) }; }); };

// ---- the key ------------------------------------------------------------------------------------

export const serverKey = (server) => process.env.AGENTIC_MCP_KEY || readKey(server.keyId);
export function saveServerKey(server, key) { saveKey(key, server.keyId, `Agentic Coder MCP · ${server.name}`); return keyEnd(key); }
export const removeServerKey = (server) => removeKey(server.keyId);

// Every server for a folder: yours, then the project's when you said yes to its file (yours win a
// shared name). { servers, project, broken }.
export function serversFor(cwd) {
  const mine = readServers();
  const project = cwd ? readProject(cwd) : null;
  const names = new Set(mine.servers.map((s) => s.name));
  const theirs = project?.answer === 'yes' ? project.servers.filter((s) => !names.has(s.name)) : [];
  return { servers: [...mine.servers, ...theirs], project, broken: mine.broken ?? project?.broken ?? null };
}
