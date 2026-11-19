// Plugins (19 Nov 2026, as Claude Code's): one folder that brings skills, helper agents, hooks and MCP
// servers together, added in one go and switched on or off as one. In Claude Code's own layout, so a
// plugin written for it works here:
//   .claude-plugin/plugin.json (or plugin.json)   { "name", "description", "version" }
//   skills/<skill>/SKILL.md                        a skill: its front matter's name and description
//                                                  ("words:" too, when it has them), then its steps
//   agents/<name>.md                               a helper agent (Claude Code's front matter, or ours)
//   hooks/hooks.json (or hooks.json)               hooks, as Claude Code writes them
//   .mcp.json (or mcp.json, or plugin.json's "mcpServers")   MCP servers
// ${CLAUDE_PLUGIN_ROOT} in a hook's or a server's command is the plugin's folder.
// Where they are kept, in the app's home (AGENTIC_HOME's in a test, so a test never sees yours):
//   ~/.agentic-coder/plugins/<name>/        a copy of the plugin, made by /plugins add (a folder or a git address)
//   ~/.agentic-coder/plugins.json           which are on, where each came from and when
//   ~/.agentic-coder/plugins/.removed/      what /plugins remove took out, dated, so nothing is lost
// Adding one is your yes to it: /plugins add shows what it brings first. The model cannot change these
// files (the app's own, permissions.mjs OWN). A plugin changes no permission, mode or never-list: its
// skills and helpers are words, its hooks run as yours do, its servers ask as yours do.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { HOME } from '../../../models/index.mjs';

export const pluginsDir = (home = HOME) => join(home, 'plugins');
const stateFile = (home = HOME) => join(home, 'plugins.json');
const REMOVED = '.removed';
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const nameOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41);

const readJson = (file) => { try { const j = JSON.parse(readFileSync(file, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; } };
const firstFile = (root, names) => names.map((n) => join(root, n)).find((f) => existsSync(f)) ?? null;
const dirs = (folder) => { try { return readdirSync(folder, { withFileTypes: true }); } catch { return []; } };

// Its plugin.json: { name, description, version, mcpServers? }, the name from the folder when it gives none.
export function readManifest(root) {
  const m = readJson(firstFile(root, [join('.claude-plugin', 'plugin.json'), 'plugin.json']) ?? '') ?? {};
  return { name: nameOf(m.name || basename(root)), description: String(m.description ?? '').trim(), version: String(m.version ?? '').trim(), mcpServers: m.mcpServers && typeof m.mcpServers === 'object' && !Array.isArray(m.mcpServers) ? m.mcpServers : null };
}

// ${CLAUDE_PLUGIN_ROOT} (and $CLAUDE_PLUGIN_ROOT) as the plugin's folder, in a command or an argument.
export const withRoot = (text, root) => String(text ?? '').replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b/g, root);

// What a plugin brings: { skills: [{ slug, file, text }], agents: [{ name, file, text }], hooks: <file|null>, servers: { name: raw } }.
export function pluginParts(root) {
  const skills = [];
  for (const e of dirs(join(root, 'skills'))) {
    if (!e.isDirectory()) continue;
    const file = join(root, 'skills', e.name, 'SKILL.md');
    const slug = nameOf(e.name);
    if (!slug || !existsSync(file)) continue;
    try { skills.push({ slug, file, text: readFileSync(file, 'utf8') }); } catch {}
  }
  const agents = [];
  for (const e of dirs(join(root, 'agents'))) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    try { agents.push({ name: e.name.slice(0, -3), file: join(root, 'agents', e.name), text: readFileSync(join(root, 'agents', e.name), 'utf8') }); } catch {}
  }
  const hooks = firstFile(root, [join('hooks', 'hooks.json'), 'hooks.json']);
  const mcp = readJson(firstFile(root, ['.mcp.json', 'mcp.json']) ?? '');
  const block = mcp?.mcpServers ?? mcp?.servers ?? readManifest(root).mcpServers ?? {};
  const servers = {};
  for (const [name, raw] of Object.entries(block && typeof block === 'object' ? block : {})) {
    if (!raw || typeof raw !== 'object') continue;
    // Its folder in place of ${CLAUDE_PLUGIN_ROOT}; a sandboxed program may read its own folder.
    servers[name] = { ...raw, ...(raw.command !== undefined ? { command: withRoot(raw.command, root) } : {}), ...(Array.isArray(raw.args) ? { args: raw.args.map((a) => withRoot(a, root)) } : {}), read: [...(Array.isArray(raw.read) ? raw.read : []), root] };
  }
  return { skills, agents, hooks, servers };
}

function readState(home) { return readJson(stateFile(home)) ?? {}; }
function writeState(home, s) {
  mkdirSync(home, { recursive: true });
  const f = stateFile(home);
  writeFileSync(`${f}.${process.pid}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
  renameSync(`${f}.${process.pid}.tmp`, f);
}

// Every plugin kept here: [{ name, root, on, manifest, parts, from, at }], by name.
export function listPlugins(home = HOME) {
  const state = readState(home);
  return dirs(pluginsDir(home))
    .filter((e) => e.isDirectory() && PLUGIN_NAME.test(e.name))
    .map((e) => { const root = join(pluginsDir(home), e.name); return { name: e.name, root, on: state[e.name]?.on !== false, manifest: readManifest(root), parts: pluginParts(root), from: state[e.name]?.from ?? null, at: state[e.name]?.at ?? null }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}
// The ones switched on: what the skills, the helpers, the hooks and the MCP servers read.
export const activePlugins = (home = HOME) => listPlugins(home).filter((p) => p.on);

// What a plugin brings, in one line a part: what /plugins add and /plugins show say.
export function pluginLines(p) {
  const { skills, agents, hooks, servers } = p.parts;
  let hookCount = 0;
  if (hooks) { const j = readJson(hooks); const block = j?.hooks ?? j ?? {}; for (const groups of Object.values(block)) for (const g of Array.isArray(groups) ? groups : []) hookCount += Array.isArray(g?.hooks) ? g.hooks.length : 0; }
  return [
    `${p.name}${p.manifest.version ? ` ${p.manifest.version}` : ''}${p.manifest.description ? `: ${p.manifest.description}` : ''}`,
    `  skills: ${skills.length ? skills.map((s) => s.slug).join(', ') : 'none'}`,
    `  helper agents: ${agents.length ? agents.map((a) => a.name).join(', ') : 'none'}`,
    `  hooks: ${hookCount ? `${hookCount} (they run as your own do, with no sandbox)` : 'none'}`,
    `  MCP servers: ${Object.keys(servers).length ? Object.entries(servers).map(([n, s]) => `${n} (${s.url ? s.url : [s.command, ...(s.args ?? [])].join(' ')})`).join(', ') : 'none'}`,
  ];
}

// Add a plugin from a folder or a git address (https or ssh; cloned once, without its history): a copy goes
// to plugins/<name>, on. { ok, plugin } or { ok: false, error }. A plugin of that name already here is
// replaced only with replace: true (its copy before goes to .removed/).
export function addPlugin(source, { home = HOME, cwd = process.cwd(), replace = false, now = new Date() } = {}) {
  const src = String(source ?? '').trim();
  if (!src) return { ok: false, error: 'Say where it is: /plugins add <folder> or /plugins add <git address>' };
  const git = /^(https:\/\/|git@|ssh:\/\/)\S+$/.test(src);
  let from = null;
  let tmp = null;
  try {
    if (git) {
      tmp = mkdtempSync(join(tmpdir(), 'agentic-plugin-'));
      try { execFileSync('git', ['clone', '--depth', '1', '--quiet', src, join(tmp, 'p')], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }); } catch (e) { return { ok: false, error: `git could not fetch ${src}: ${String(e.stderr ?? e.message).trim().split('\n').at(-1)}` }; }
      from = join(tmp, 'p');
    } else {
      from = resolve(cwd, src.replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
      if (!existsSync(from) || !statSync(from).isDirectory()) return { ok: false, error: `There is no folder at ${src}.` };
    }
    const manifest = readManifest(from);
    const parts = pluginParts(from);
    if (!PLUGIN_NAME.test(manifest.name)) return { ok: false, error: `"${manifest.name}" cannot be a plugin's name (small letters, digits and hyphens).` };
    if (!parts.skills.length && !parts.agents.length && !parts.hooks && !Object.keys(parts.servers).length) return { ok: false, error: `${src} brings nothing: no skills/, agents/, hooks or MCP servers in it.` };
    const to = join(pluginsDir(home), manifest.name);
    if (existsSync(to)) {
      if (!replace) return { ok: false, exists: manifest.name, error: `A plugin called ${manifest.name} is here already: /plugins add ${src} replace puts the new one in its place.` };
      moveAside(to, home, now);
    }
    mkdirSync(pluginsDir(home), { recursive: true });
    cpSync(from, to, { recursive: true, filter: (p) => basename(p) !== '.git' });
    const s = readState(home);
    s[manifest.name] = { on: true, from: git ? src : from, at: now.toISOString() };
    writeState(home, s);
    return { ok: true, plugin: listPlugins(home).find((p) => p.name === manifest.name) };
  } finally {
    if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch {} }
  }
}

function moveAside(root, home, now) {
  const bin = join(pluginsDir(home), REMOVED);
  mkdirSync(bin, { recursive: true });
  const to = join(bin, `${basename(root)}-${now.toISOString().replace(/[:.]/g, '-')}`);
  renameSync(root, to);
  return to;
}

// On or off: { ok, plugin } or { ok: false, error }.
export function setPlugin(name, on, home = HOME) {
  if (!listPlugins(home).some((p) => p.name === name)) return { ok: false, error: `No plugin called ${name}. /plugins lists them.` };
  const s = readState(home);
  s[name] = { ...(s[name] ?? {}), on: Boolean(on) };
  writeState(home, s);
  return { ok: true, plugin: listPlugins(home).find((p) => p.name === name) };
}

// Out of the list into .removed/<name>-<when>: { ok, to } or { ok: false, error }.
export function removePlugin(name, home = HOME, now = new Date()) {
  const root = join(pluginsDir(home), name);
  if (!PLUGIN_NAME.test(String(name)) || !existsSync(root)) return { ok: false, error: `No plugin called ${name}. /plugins lists them.` };
  const to = moveAside(root, home, now);
  const s = readState(home);
  delete s[name];
  writeState(home, s);
  return { ok: true, to };
}
