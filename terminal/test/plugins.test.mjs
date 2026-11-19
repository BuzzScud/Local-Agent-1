// Plugins (19 Nov 2026, agent/plugins.mjs, app/plugins-cmd.mjs): one folder in Claude Code's layout that brings
// skills, helper agents, hooks and MCP servers, added with /plugins add, switched on and off as one, and
// removed into plugins/.removed (nothing deleted). Each part reaches the place yours do.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A throwaway home BEFORE the models part is first imported (it reads AGENTIC_HOME once).
const FIRST_HOME = mkdtempSync(join(tmpdir(), 'agentic-plugins-home-'));
process.env.AGENTIC_HOME = FIRST_HOME;
process.env.AGENTIC_MEMORY_SAVE = 'off';
process.env.AGENTIC_NO_OPEN = '1';
const { addPlugin, listPlugins, activePlugins, setPlugin, removePlugin, pluginsDir, readManifest, pluginParts, withRoot } = await import('../src/agent/plugins.mjs');
const { readSkills, readHelperAgents } = await import('../src/agent/prompt-files.mjs');
const { pluginHooks, UserHooks } = await import('../src/agent/user-hooks.mjs');
const { serversFor } = await import('../src/app/mcp-store.mjs');
const { pluginsPanel, pluginsCommand } = await import('../src/app/plugins-cmd.mjs');
const { HOME } = await import('../../models/index.mjs');

// A plugin as Claude Code lays one out.
function makePlugin(name = 'review-kit', { more = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-plugin-src-'));
  mkdirSync(join(root, '.claude-plugin'));
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, description: 'Review tools', version: '1.2.0' }));
  mkdirSync(join(root, 'skills', 'review-pr'), { recursive: true });
  writeFileSync(join(root, 'skills', 'review-pr', 'SKILL.md'), '---\nname: review-pr\ndescription: Review a pull request for real bugs\nwords: review the pr, review this pull request\n---\n\n1. Read the diff.\n2. List real bugs with file:line.\n');
  if (more) {
    mkdirSync(join(root, 'agents'));
    writeFileSync(join(root, 'agents', 'security-reviewer.md'), '---\nname: security-reviewer\ndescription: Looks for security holes\ntools: Read, Grep\npermissionMode: plan\n---\nFind security holes.\n');
    mkdirSync(join(root, 'hooks'));
    writeFileSync(join(root, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "$CLAUDE_PLUGIN_ROOT" > "${CLAUDE_PLUGIN_ROOT}/ran.txt"' }] }] } }));
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'kit-notes': { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.mjs'] } } }));
  }
  return root;
}

let proj;
beforeEach(() => {
  expect(HOME).toBe(FIRST_HOME); // the throwaway, never ~/.agentic-coder
  rmSync(pluginsDir(), { recursive: true, force: true });
  rmSync(join(FIRST_HOME, 'plugins.json'), { force: true });
  proj = mkdtempSync(join(tmpdir(), 'agentic-plugins-proj-'));
});

test("a plugin's folder read as Claude Code lays it out: its name, what it brings, ${CLAUDE_PLUGIN_ROOT} as its folder", () => {
  const src = makePlugin();
  expect(readManifest(src)).toMatchObject({ name: 'review-kit', description: 'Review tools', version: '1.2.0' });
  const parts = pluginParts(src);
  expect(parts.skills.map((s) => s.slug)).toEqual(['review-pr']);
  expect(parts.agents.map((a) => a.name)).toEqual(['security-reviewer']);
  expect(parts.hooks).toBe(join(src, 'hooks', 'hooks.json'));
  expect(parts.servers['kit-notes']).toMatchObject({ command: 'node', args: [`${src}/server.mjs`], read: [src] });
  expect(withRoot('a ${CLAUDE_PLUGIN_ROOT}/b $CLAUDE_PLUGIN_ROOT/c', '/r')).toBe('a /r/b /r/c');
});

test('/plugins add: a copy in the home, on; its skill, its helper, its hook and its server reach where yours do', async () => {
  const src = makePlugin();
  const r = addPlugin(src);
  expect(r.ok).toBe(true);
  const root = join(pluginsDir(), 'review-kit');
  expect(existsSync(join(root, 'skills', 'review-pr', 'SKILL.md'))).toBe(true);
  expect(listPlugins().map((p) => [p.name, p.on])).toEqual([['review-kit', true]]);
  // the skill: listed with the rest, brought by its words, read-only from its plugin
  const skill = readSkills().find((s) => s.slug === 'review-pr');
  expect(skill).toMatchObject({ from: 'plugin', plugin: 'review-kit', about: 'Review a pull request for real bugs', words: ['review the pr', 'review this pull request'] });
  // the helper: Claude Code's front matter, its mode kept
  const helper = readHelperAgents('remote', { claude: null }).find((a) => a.kind === 'security-reviewer');
  expect(helper).toMatchObject({ from: 'plugin review-kit', tools: ['Read', 'Search'], mode: 'plan' });
  // the hook: its root in its command and its environment; it runs
  const hooks = pluginHooks();
  expect(hooks).toHaveLength(1);
  expect(hooks[0]).toMatchObject({ event: 'PreToolUse', matcher: 'Bash', plugin: 'review-kit', root });
  const uh = new UserHooks({ cwd: proj });
  expect(uh.has('PreToolUse', 'Bash')).toBe(true);
  await uh.run('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }, { tool: 'Bash' });
  expect(readFileSync(join(root, 'ran.txt'), 'utf8').trim()).toBe(root);
  // the server: with the plugin's folder in place, readable behind the fence, marked as a plugin's
  const server = serversFor(proj).servers.find((s) => s.name === 'kit-notes');
  expect(server).toMatchObject({ from: 'plugin', plugin: 'review-kit', command: 'node', args: [`${root}/server.mjs`], sandbox: true });
  expect(server.read).toContain(root);
});

test('/plugins off takes all it brings out, on brings it back; remove keeps its folder in .removed', () => {
  addPlugin(makePlugin());
  expect(setPlugin('review-kit', false).ok).toBe(true);
  expect(activePlugins()).toEqual([]);
  expect(readSkills().some((s) => s.slug === 'review-pr')).toBe(false);
  expect(readHelperAgents('remote', { claude: null }).some((a) => a.kind === 'security-reviewer')).toBe(false);
  expect(pluginHooks()).toEqual([]);
  expect(serversFor(proj).servers.some((s) => s.name === 'kit-notes')).toBe(false);
  expect(setPlugin('review-kit', true).ok).toBe(true);
  expect(pluginHooks()).toHaveLength(1);
  const r = removePlugin('review-kit');
  expect(r.ok).toBe(true);
  expect(existsSync(join(pluginsDir(), 'review-kit'))).toBe(false);
  expect(readdirSync(join(pluginsDir(), '.removed'))[0]).toMatch(/^review-kit-/);
  expect(listPlugins()).toEqual([]);
  expect(setPlugin('nope', true).error).toContain('No plugin called nope');
});

test('what /plugins add turns away: no folder, nothing in it, a name already here (unless replace), a bad name', () => {
  expect(addPlugin('').error).toContain('Say where it is');
  expect(addPlugin(join(proj, 'missing')).error).toContain('There is no folder');
  expect(addPlugin(proj).error).toContain('brings nothing');
  const src = makePlugin('kit', { more: false });
  expect(addPlugin(src).ok).toBe(true);
  expect(addPlugin(src).error).toContain('is here already');
  expect(addPlugin(src, { replace: true }).ok).toBe(true);
  expect(readdirSync(join(pluginsDir(), '.removed')).some((n) => n.startsWith('kit-'))).toBe(true);
  // A name from its folder when plugin.json has none; small letters only.
  const bare = mkdtempSync(join(tmpdir(), 'Odd Name '));
  mkdirSync(join(bare, 'skills', 'x'), { recursive: true });
  writeFileSync(join(bare, 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: d\n---\n1. Do.\n');
  expect(addPlugin(bare).plugin.name).toMatch(/^odd-name-/);
});

test('/plugins in the window: the panel, add with what it brings, off, show, remove; hooks and servers taken again', () => {
  const pushed = [];
  let reloads = 0;
  const self = { push: (e) => pushed.push(e), flash: () => {}, agent: { cwd: proj, userHooks: { reload: () => { reloads++; } } }, mcpHub: null };
  pluginsCommand(self, '', false);
  expect(pushed.at(-1)).toMatchObject({ type: 'panel', title: expect.stringContaining('Plugins · 0 on of 0') });
  pluginsCommand(self, `add ${makePlugin()}`, false);
  expect(pushed.at(-1).text).toContain('review-kit 1.2.0: Review tools');
  expect(pushed.at(-1).text).toContain('skills: review-pr');
  expect(pushed.at(-1).text).toContain('hooks: 1 (they run as your own do, with no sandbox)');
  expect(pushed.at(-1).text).toContain('MCP servers: kit-notes');
  expect(pushed.at(-1).text).toContain('Added and on.');
  expect(pluginsPanel().rows[0][0]).toBe('● review-kit 1.2.0: Review tools');
  pluginsCommand(self, 'off review-kit', false);
  expect(pushed.at(-1).text).toContain('review-kit is off');
  expect(pluginsPanel().rows[0][0].startsWith('○ ')).toBe(true);
  pluginsCommand(self, 'show review-kit', false);
  expect(pushed.at(-1)).toMatchObject({ type: 'expand', title: expect.stringContaining('review-kit · off') });
  pluginsCommand(self, 'remove review-kit', false);
  expect(pushed.at(-1).text).toContain('Removed review-kit');
  expect(reloads).toBe(3); // add, off, remove
  pluginsCommand(self, 'frob', false);
  expect(pushed.at(-1).tone).toBe('warn');
});
