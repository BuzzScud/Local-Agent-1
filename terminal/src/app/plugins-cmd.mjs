// /plugins (19 Nov 2026, as Claude Code's /plugin): skills, helper agents, hooks and MCP servers that come
// together in one folder (agent/plugins.mjs). With a word:
//   /plugins add <folder | git address> [replace]   copy it in and switch it on; it says what it brings
//   /plugins on <name> · /plugins off <name>         switch one, with all it brings
//   /plugins show <name>                             what it brings
//   /plugins remove <name>                           out of the list (kept dated in plugins/.removed/)
//   /plugins open                                    the folder in Finder
// Skills and helpers are read at each message; hooks and MCP servers are taken again here, at once.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { addPlugin, listPlugins, pluginLines, pluginsDir, removePlugin, setPlugin } from '../agent/plugins.mjs';
import { reloadMcp } from './mcp-start.mjs';

const tilde = (p) => (p?.startsWith(`${homedir()}/`) ? `~${p.slice(homedir().length)}` : p);
const KEYS = '/plugins add <folder or git address> · on|off <name> · show <name> · remove <name> · open';

// The panel: every plugin, on or off, and what it brings. plugins: for the tests.
export function pluginsPanel({ plugins = listPlugins() } = {}) {
  const rows = [];
  if (!plugins.length) rows.push(['  None yet. A plugin is a folder with skills/, agents/, hooks or MCP servers (Claude Code\'s layout): /plugins add <folder or git address>.']);
  for (const p of plugins) {
    const [head, ...parts] = pluginLines(p);
    rows.push([`${p.on ? '●' : '○'} ${head}`]);
    rows.push(...parts.map((l) => [`  ${l}`]));
  }
  rows.push(['', KEYS]);
  return { type: 'panel', title: `Plugins · ${plugins.filter((p) => p.on).length} on of ${plugins.length} · ${tilde(pluginsDir())}`, pad: 2, rows };
}

// Hooks and MCP servers again, after a plugin came, went or was switched.
function retake(self) {
  try { self.agent.userHooks?.reload(); } catch { /* the next window takes them */ }
  if (self.mcpHub) { try { reloadMcp(self.mcpHub, self.agent.cwd); self.agent.mcpStale = true; } catch { /* the next window takes them */ } }
}

export function pluginsCommand(self, arg, busy) {
  const [what = '', ...rest] = arg.trim().split(/\s+/);
  const say = (text, tone = 'dim') => self.push({ type: 'note', text, tone });
  const name = rest.join(' ').trim().toLowerCase();
  switch (what.toLowerCase()) {
    case '': self.push(pluginsPanel()); return;
    case 'add':
    case 'install': {
      if (busy) { self.flash('Wait for Agentic Coder to finish first'); return; }
      const replace = rest.at(-1)?.toLowerCase() === 'replace';
      const source = (replace ? rest.slice(0, -1) : rest).join(' ').trim();
      const r = addPlugin(source, { cwd: self.agent.cwd, replace });
      if (!r.ok) { say(r.error, 'warn'); return; }
      retake(self);
      say(`${pluginLines(r.plugin).join('\n')}\nAdded and on. Its skills and helpers come with your next message; its hooks and MCP servers start now. /plugins off ${r.plugin.name} switches all of it off.`);
      return;
    }
    case 'on':
    case 'off':
    case 'enable':
    case 'disable': {
      if (busy) { self.flash('Wait for Agentic Coder to finish first'); return; }
      const on = what === 'on' || what === 'enable';
      if (!name) { say(`Which one? /plugins ${what} <name>; /plugins lists them.`, 'warn'); return; }
      const r = setPlugin(name, on);
      if (!r.ok) { say(r.error, 'warn'); return; }
      retake(self);
      say(`${name} is ${on ? 'on: its skills, helpers, hooks and MCP servers are back' : 'off: its skills, helpers, hooks and MCP servers are out until /plugins on'} ${name}.`);
      return;
    }
    case 'show': {
      const p = listPlugins().find((x) => x.name === name);
      if (!p) { say(name ? `No plugin called ${name}. /plugins lists them.` : 'Which one? /plugins show <name>.', 'warn'); return; }
      self.push({ type: 'expand', title: `${p.name} · ${p.on ? 'on' : 'off'} · ${tilde(p.root)}`, text: [...pluginLines(p), '', p.from ? `From: ${tilde(p.from)}` : '', p.at ? `Added: ${new Date(p.at).toLocaleString()}` : ''].filter((l, i) => l || i < 6).join('\n') });
      return;
    }
    case 'remove':
    case 'uninstall': {
      if (busy) { self.flash('Wait for Agentic Coder to finish first'); return; }
      const r = removePlugin(name);
      if (!r.ok) { say(r.error, 'warn'); return; }
      retake(self);
      say(`Removed ${name}; its folder is kept at ${tilde(r.to)}.`);
      return;
    }
    case 'open': {
      const dir = pluginsDir();
      try { mkdirSync(dir, { recursive: true }); } catch {}
      if (!process.env.AGENTIC_NO_OPEN) { try { Bun.spawn(['open', dir], { stdout: 'ignore', stderr: 'ignore' }); } catch {} }
      say(`Your plugins: ${tilde(dir)}`);
      return;
    }
    default: say(`/plugins ${what}? ${KEYS}.`, 'warn');
  }
}
