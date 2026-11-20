// Tools on demand (agent/tool-groups.mjs, the owner's pick 19 Nov 2026: "Tools on demand, like hearth"):
// a model on another machine starts with the tools for files, commands, plans and questions; MoreTools
// adds a group for the rest of the conversation; a tool of a group not added yet still runs, and its group
// joins; an MCP server the request points at joins by itself. The list only grows, at its end.
// A scripted stand-in is the model (fake-server.mjs); the MCP server is the stand-in one (fake-mcp.mjs).
import { test, expect, afterAll } from 'bun:test';
import { cpSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeMcpCommand } from './fake-mcp.mjs';
import { startFakeServer } from './fake-server.mjs';

process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-on-demand-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
delete process.env.AGENTIC_TOOLS_ON_DEMAND;
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');
const { McpHub } = await import('../src/tools/mcp.mjs');
const store = await import('../src/app/mcp-store.mjs');
const groups = await import('../src/agent/tool-groups.mjs');

const model = MODELS[DEFAULT_MODEL];
const hubs = [];
afterAll(async () => { for (const h of hubs) await h.stopAll(); });
const project = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-on-demand-'))); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };
const call = (name, args) => ({ tool: { name, args } });
const names = (r) => (r.tools ?? []).map((t) => t.function.name);

// One conversation on a service (an OpenAI-compatible model on another machine), tools on demand as set.
async function run(replies, { setting = 'auto', kind = 'openai', requests = ['do the thing'], shop = false } = {}) {
  const cwd = project();
  let hub = null;
  if (shop) {
    const c = fakeMcpCommand({});
    hub = new McpHub({ cwd, startMs: 5000, callMs: 5000, allowed: { print: () => null, remember: () => {} } });
    hubs.push(hub);
    hub.configure([store.serverOf('shop', { command: c.command, args: c.args, env: c.env, sandbox: false })]);
  }
  const fake = await startFakeServer(replies);
  setEndpoint(fake.url, { remote: true, kind, model: 'some-model', label: 'svc' });
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, flows: false, verify: false, confirmPlan: false, way: 'model', web: { search: 'off', fetch: true }, mcp: hub, ask: async () => ({ choice: 'yes' }) });
  agent.toolsOnDemand = setting;
  const tools = [];
  agent.on('tool', (e) => tools.push(e));
  for (const r of requests) await agent.send(r);
  await fake.close();
  dropEndpoint(fake.url);
  const sent = fake.requests.filter((r) => r.stream);
  const results = agent.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
  return { agent, sent, tools, results };
}

test('on or off: auto is on for a model on another machine, not for the Claude API or this Mac; on and off say so; the env wins', () => {
  const svc = { remote: true, kind: 'openai' };
  expect(groups.onDemandOf('auto', svc, {})).toBe(true);
  expect(groups.onDemandOf('auto', { remote: true, kind: 'claude' }, {})).toBe(false);
  expect(groups.onDemandOf('auto', null, {})).toBe(false);
  expect(groups.onDemandOf('on', null, {})).toBe(true);
  expect(groups.onDemandOf('off', svc, {})).toBe(false);
  expect(groups.onDemandOf(null, svc, {})).toBe(false);
  expect(groups.onDemandOf('auto', svc, { AGENTIC_TOOLS_ON_DEMAND: 'off' })).toBe(false);
  expect(groups.onDemandOf(null, null, { AGENTIC_TOOLS_ON_DEMAND: 'on' })).toBe(true);
});

test('MoreTools names its groups; a group not there is said with the list; one added twice says so', () => {
  const g = groups.groupsOffered(['Read', 'WebFetch', 'Screen'], [{ name: 'mcp__shop__get_ticket', server: 'shop' }]);
  expect(g.map((x) => x.id)).toEqual(['web', 'screen', 'mcp:shop']);
  expect(g[0].tools).toEqual(['WebFetch']);
  const def = groups.moreToolsDef(g).function;
  expect(def.parameters.properties.group.enum).toEqual(['web', 'screen', 'mcp:shop']);
  expect(def.description).toContain('- web: searching the web and reading a web page (WebFetch)');
  expect(def.description).toContain('- mcp:shop: the user\'s MCP server "shop" (1 tool)');
  expect(groups.moreToolsAnswer({ group: 'code' }, g, [])).toMatchObject({ error: true, joined: null });
  expect(groups.moreToolsAnswer({ group: 'code' }, g, []).text).toBe('There is no group "code". The groups: web, screen, mcp:shop.');
  expect(groups.moreToolsAnswer({ group: 'shop' }, g, []).joined).toBe('mcp:shop');
  expect(groups.moreToolsAnswer({ group: 'web' }, g, ['web'])).toMatchObject({ joined: null, text: 'web is already added: WebFetch. Call them now.' });
});

test('a service starts with the small set and MoreTools; an added group comes at the end and the list before it stays the same', async () => {
  const { sent, results, tools } = await run([call('MoreTools', { group: 'web' }), { text: 'Ready.' }]);
  const first = names(sent[0]);
  expect(first).toEqual(expect.arrayContaining(['Read', 'List', 'Search', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Ask', 'Jobs', 'MoreTools']));
  for (const hidden of ['WebFetch', 'Map', 'CodeSearch', 'Rename', 'TestFirst']) expect(first).not.toContain(hidden);
  // Helpers stay in the start set: a model that decides hands work off without asking for them first.
  expect(first).toContain('Agent');
  expect(results[0]).toBe('Added web: WebFetch. They are yours from your next step.');
  expect(tools.find((t) => t.name === 'MoreTools')).toMatchObject({ label: 'More tools', arg: 'web' });
  const second = names(sent[1]);
  expect(second.slice(0, first.length)).toEqual(first);
  expect(second.slice(first.length)).toEqual(['WebFetch']);
  // The definitions before it are sent letter for letter as before, so the server keeps its place.
  expect(JSON.stringify(sent[1].tools.slice(0, first.length))).toBe(JSON.stringify(sent[0].tools));
});

test('a tool of a group not added yet still runs when called by name, and its group joins', async () => {
  const { sent, results, agent } = await run([call('Map', {}), { text: 'Laid out.' }]);
  expect(names(sent[0])).not.toContain('Map');
  expect(results[0]).not.toMatch(/There is no tool/);
  expect(agent.toolsJoined).toEqual(['code']);
  const first = names(sent[0]), second = names(sent[1]);
  expect(second.slice(0, first.length)).toEqual(first);
  expect(second.slice(first.length)[0]).toBe('Map');
});

test('an MCP server is a group: left out at first, there once the request points at it, and kept through the conversation', async () => {
  const quiet = await run([{ text: 'Hello.' }], { shop: true, requests: ['hello'] });
  expect(names(quiet.sent[0]).some((n) => n.startsWith('mcp__'))).toBe(false);
  expect(quiet.sent[0].tools.find((t) => t.function.name === 'MoreTools').function.parameters.properties.group.enum).toContain('mcp:shop');
  const asked = await run([{ text: 'One.' }, { text: 'Two.' }], { shop: true, requests: ['open a ticket in the shop tracker', 'thanks'] });
  expect(names(asked.sent[0])).toContain('mcp__shop__create_ticket');
  expect(names(asked.sent[1])).toContain('mcp__shop__create_ticket');
  expect(asked.agent.toolsJoined).toEqual(['mcp:shop']);
  // A new conversation starts small again.
  asked.agent.reset();
  expect(asked.agent.toolsJoined).toEqual([]);
});

test('off ("off", or no setting as in a test or a practice run): every tool as before and no MoreTools', async () => {
  for (const opts of [{ setting: 'off' }, { setting: null }]) {
    const { sent } = await run([{ text: 'Hello.' }], opts);
    expect(names(sent[0])).toContain('WebFetch');
    expect(names(sent[0])).toContain('Map');
    expect(names(sent[0])).not.toContain('MoreTools');
  }
});
