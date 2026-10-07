// Files you make for the remote set (2 Oct 2026, the .md maker on the Desktop), kept in the app's
// home (~/.agentic-coder/rules/remote; here a throwaway AGENTIC_HOME's): a guide of your own is
// listed after the shipped ones and opens at RULES/<NAME>.md, and a helper agent file in its
// agents/ folder is a helper the main model can hand work to with the Agent tool, with its own
// instructions, tools and model. A file left in the repo's folder is not one of them.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, cpSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A throwaway home BEFORE the models part is first imported (it reads AGENTIC_HOME once).
process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-agent-files-home-'));
const { readGuides, readGuidePath, readHelperAgents, parseHelperAgent, extraGuides, ownDir, GUIDES } = await import('../src/agent/prompt-files.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { prepare, execute, toolDefs, agentToolDef, AGENT_TOOL_DEF, EXPLORE_TOOLS } = await import('../src/agent/tools.mjs');
const { Agent, helperToolFilter } = await import('../src/agent/agent.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { fakeOllama } = await import('./fake-ollama.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const SOURCE = new URL('../rules/', import.meta.url).pathname;
const local = MODELS[DEFAULT_MODEL];

const WRITER = `# Test writer

Use it to add one test for one behaviour and run only that test file.

- Tools: Read, Search, Write
- Model: main

## Instructions

1. Read the code the behaviour lives in.
2. Add one test and run only its file.
`;

let rules, proj, saved;
beforeEach(() => {
  saved = { rules: process.env.AGENTIC_RULES_DIR, set: process.env.AGENTIC_INSTRUCTIONS };
  const root = mkdtempSync(join(tmpdir(), 'agentic-agent-files-'));
  rules = join(root, 'rules'); proj = join(root, 'proj');
  cpSync(SOURCE, rules, { recursive: true });
  mkdirSync(proj);
  process.env.AGENTIC_RULES_DIR = rules;
  delete process.env.AGENTIC_INSTRUCTIONS;
  rmSync(ownDir(), { recursive: true, force: true });
  mkdirSync(ownDir(), { recursive: true });
});
afterEach(() => {
  for (const [k, v] of [['AGENTIC_RULES_DIR', saved.rules], ['AGENTIC_INSTRUCTIONS', saved.set]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
const helpersDir = () => { const d = join(ownDir(), 'agents'); mkdirSync(d, { recursive: true }); return d; };
const names = (req) => (req.tools ?? []).map((t) => t.function?.name ?? t.name);

test('a guide you add is listed after the shipped ones, opens at RULES/<NAME>.md and is read-only; other names, the set\'s own files and a file in the repo\'s folder are not guides', async () => {
  const local0 = systemPrompt({ cwd: proj, git: 'g' });
  const own = ownDir();
  expect(own.startsWith(process.env.AGENTIC_HOME)).toBe(true);
  writeFileSync(join(own, 'DEPLOY.md'), '# Deploy\n\nRead this when a change goes live on the server.\n\n## Steps\n\n1. Ship it.\n');
  writeFileSync(join(own, 'step2.md'), '# Step two\n\nUse this for the second step.\n\n## Do\n\n- Go.\n');
  writeFileSync(join(own, 'my notes.md'), 'a space in the name\n');
  writeFileSync(join(own, 'EMPTY.md'), '  \n');
  writeFileSync(join(own, 'TESTING.md'), '# Mine\n\nRead this never.\n\n## X\n\nY.\n'); // a shipped name: the shipped one stays
  writeFileSync(join(rules, 'remote', 'LOOSE.md'), '# Loose\n\nRead this when it is in the repo.\n\n## X\n\nY.\n');
  writeFileSync(helpersDir() + '/TEST-WRITER.md', WRITER);
  expect(extraGuides().map((g) => g.name)).toEqual(['DEPLOY', 'EMPTY', 'STEP2']);
  expect(readGuides('remote').find((g) => g.name === 'TESTING').about).not.toBe('never');
  const listed = readGuides('remote').map((g) => g.name);
  expect(listed).toEqual([...GUIDES.filter((g) => g !== 'SUBAGENTS' && g !== 'MCP'), 'DEPLOY', 'STEP2']);
  expect(readGuides('remote').at(-2)).toEqual({ name: 'DEPLOY', about: 'when a change goes live on the server', body: '## Steps\n\n1. Ship it.' });
  const prompt = systemPrompt({ cwd: proj, git: 'g', set: 'remote' });
  expect(prompt).toContain('- RULES/ANSWERS.md:');
  expect(prompt).toContain('- RULES/DEPLOY.md: when a change goes live on the server\n- RULES/STEP2.md: Use this for the second step');
  expect(prompt.indexOf('RULES/ANSWERS.md')).toBeLessThan(prompt.indexOf('RULES/DEPLOY.md'));
  // the local instructions are the same letter for letter
  expect(systemPrompt({ cwd: proj, git: 'g' })).toBe(local0);
  const env = { cwd: proj, rulesSet: 'remote', agents: false };
  expect((await execute('Read', { path: 'RULES/deploy' }, null, env)).text).toBe('RULES/DEPLOY.md:\n## Steps\n\n1. Ship it.');
  expect((await execute('Read', { path: 'RULES/STEP2.md' }, null, env)).text.startsWith('RULES/STEP2.md:\n## Do')).toBe(true);
  expect(prepare('Edit', { path: 'RULES/DEPLOY.md', old_text: 'Ship', new_text: 'Sink' }, env).error).toContain("one of the user's guides");
  // a guide you delete is gone at the next read
  unlinkSync(join(own, 'DEPLOY.md'));
  expect(readGuides('remote').map((g) => g.name)).not.toContain('DEPLOY');
  expect(readGuidePath(proj, 'RULES/DEPLOY.md', readGuides('remote')).error).toContain('No guide RULES/DEPLOY.');
});

test('a helper agent file: what the Agent tool says about it, its tools (all, look or a list) and its model, from its fields; comments left out', () => {
  expect(parseHelperAgent('TEST-WRITER', WRITER)).toEqual({ name: 'TEST-WRITER', kind: 'test-writer', about: 'Use it to add one test for one behaviour and run only that test file', tools: ['Read', 'Search', 'Write'], model: 'main', body: '## Instructions\n\n1. Read the code the behaviour lives in.\n2. Add one test and run only its file.' });
  const bare = parseHelperAgent('CHECKER', '# Checker\n\nUse it to check a page.\n<!-- - Tools: look -->\n\n## Steps\n\n1. Look.\n');
  expect(bare).toMatchObject({ kind: 'checker', about: 'Use it to check a page', tools: 'all', model: 'main' });
  expect(parseHelperAgent('A', 'Use it to read.\n- Tools: look only\n- Model: qwen3-coder:30b\n\n## Do\nRead.\n')).toMatchObject({ tools: 'look', model: 'qwen3-coder:30b' });
  // the folder: no body, a built-in kind's name or a bad name are left out
  const d = helpersDir();
  writeFileSync(join(d, 'TEST-WRITER.md'), WRITER);
  writeFileSync(join(d, 'NOBODY.md'), '# Nobody\n\nUse it for nothing.\n');
  writeFileSync(join(d, 'EXPLORE.md'), '# Mine\n\nUse it to look.\n\n## Do\nLook.\n');
  writeFileSync(join(d, 'bad name.md'), '# Bad\n\n## Do\nX.\n');
  expect(readHelperAgents('remote').map((a) => a.kind)).toEqual(['test-writer']);
  expect(readHelperAgents('local')).toEqual([]);
  // the tools a helper gets
  const all = ['Read', 'List', 'Search', 'Edit', 'Write', 'Bash', 'TodoWrite', 'Ask'];
  expect(helperToolFilter('all', all)).toBeNull();
  expect(helperToolFilter('look', all)).toBe(EXPLORE_TOOLS);
  expect([...helperToolFilter(['read', 'WRITE', 'Nope'], all)]).toEqual(['Read', 'Write']);
});

test('the Agent tool names your helpers: each a kind of its own with what it is for; without any, it is as before', () => {
  expect(agentToolDef([])).toBe(AGENT_TOOL_DEF);
  const def = agentToolDef([parseHelperAgent('TEST-WRITER', WRITER)]);
  expect(def.parameters.properties.kind.enum).toEqual(['explore', 'general', 'test-writer']);
  expect(def.description.startsWith(AGENT_TOOL_DEF.description)).toBe(true);
  expect(def.description).toContain('\n- test-writer: Use it to add one test for one behaviour and run only that test file');
  expect(toolDefs('app', null, { agents: true, helpers: [parseHelperAgent('TEST-WRITER', WRITER)] }).at(-1)).toEqual(def);
});

test('on the remote set a helper agent file brings the Agent tool (and the helpers guide) on App too; not on the local set, not with "subagents": false', () => {
  const make = (o = {}) => new Agent({ url: 'http://127.0.0.1:1', model: local, cwd: proj, system: 'x', memory: false, flows: false, verify: false, way: 'app', hooks: [], instructions: 'remote', ...o });
  expect(make().tools().map((t) => t.function.name)).not.toContain('Agent');
  writeFileSync(join(helpersDir(), 'TEST-WRITER.md'), WRITER);
  const a = make();
  const agentTool = a.tools().find((t) => t.function.name === 'Agent');
  expect(agentTool.function.parameters.properties.kind.enum).toContain('test-writer');
  expect(systemPrompt({ cwd: proj, git: 'g', set: 'remote', agents: a.agentsOn() })).toContain('- RULES/SUBAGENTS.md:');
  expect(make({ instructions: 'local' }).tools().map((t) => t.function.name)).not.toContain('Agent');
  expect(make({ subagents: false }).tools().map((t) => t.function.name)).not.toContain('Agent');
});

test('a helper of yours at work on App: its instructions, only its tools (another is refused, naming the ones it has), its report back by its name', async () => {
  writeFileSync(join(helpersDir(), 'TEST-WRITER.md'), WRITER);
  writeFileSync(join(proj, 'a.mjs'), 'export const add = (a, b) => a + b;\n');
  const fake = await startFakeServer([
    { tool: { name: 'Agent', args: { description: 'write the test', prompt: 'Add a test for add in a.mjs.', kind: 'test-writer' } } },
    { tool: { name: 'Bash', args: { command: 'echo hi' } } },
    { tool: { name: 'Read', args: { path: 'a.mjs' } } },
    { text: 'Read a.mjs; I could not run the test (no Bash).' },
    { text: 'The helper read a.mjs.' },
  ]);
  try {
    const a = new Agent({ url: fake.url, model: local, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none', set: 'remote', agents: true }), memory: false, flows: false, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'remote', checkIns: false, confirmPlan: false });
    a.look = 'off';
    await a.send('what does add do? hand it to the test writer helper');
    const chats = fake.requests.filter((q) => q.stream);
    const helper = chats.find((q) => q.messages[0].content.includes('# You are a helper'));
    expect(helper).toBeTruthy();
    expect(helper.messages[0].content).toContain('# Your job: test-writer\nThe user wrote these instructions for you (TEST-WRITER.md):\n## Instructions\n\n1. Read the code');
    expect(names(helper).sort()).toEqual(['Read', 'Search', 'Write']);
    const all = JSON.stringify(chats.map((c) => c.messages));
    expect(all).toContain("Bash is not one of this helper's tools (it has Read, Search, Write)");
    expect(all).toContain("The test-writer helper's report (");
  } finally { await fake.close(); }
});

test('a helper\'s Model line: on an Ollama service it runs on that model at a helper\'s size; elsewhere on this one, and its report says so', async () => {
  const d = helpersDir();
  writeFileSync(join(d, 'READER.md'), '# Reader\n\nUse it to read one file and say what it holds.\n\n- Tools: look\n- Model: tiny:3b\n\n## Instructions\n\nRead the file and report.\n');
  writeFileSync(join(d, 'SAME.md'), '# Same\n\nUse it to read with the main model.\n\n- Tools: look\n- Model: Coder:30b\n\n## Instructions\n\nRead the file and report.\n');
  writeFileSync(join(proj, 'notes.txt'), `Hello wrold ${'and more '.repeat(6000)}\n`); // one long line: Read gives it whole, cut to the room
  const svc = await fakeOllama();
  setEndpoint(svc.url, { remote: true, kind: 'openai', ollama: true, model: 'coder:30b', numCtx: 131072, keepAlive: -1, free: true });
  try {
    const a = new Agent({ url: svc.url, model: { ...local, remote: { model: 'coder:30b' } }, cwd: proj, system: 'You are the main agent.', ctx: 131072, memory: false, flows: false, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'remote', checkIns: false, confirmPlan: false });
    const out = await a.runHelper('h1', { prompt: 'Read the file notes.txt and say what it holds.', kind: 'reader' }, { label: 'reader', arg: 'read notes' });
    const asked = svc.seen.filter((s) => s.path === '/api/chat').map((s) => s.body);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((b) => b.model === 'tiny:3b' && b.options.num_ctx === 32768 && b.keep_alive === '30m')).toBe(true);
    expect(asked[0].messages[0].content).toContain('# Your job: reader');
    expect(asked[0].tools.map((t) => t.function.name).every((n) => EXPLORE_TOOLS.has(n))).toBe(true);
    expect(out.text).toContain("The reader helper's report (");
    expect(out.text).toContain(', on tiny:3b');
    // it has that model's room, not the main one's: a long file comes back cut to fit 32k
    const longest = Math.max(...asked.flatMap((b) => b.messages.filter((m) => m.role === 'tool').map((m) => String(m.content).length)));
    expect(longest).toBeGreaterThan(4_000);
    expect(longest).toBeLessThan(20_000);
    // the main model by its own name is the main model, at its own size (no second load)
    const before = svc.seen.length;
    const same = await a.runHelper('h3', { prompt: 'Read the file notes.txt and say what it holds.', kind: 'same' }, { label: 'same', arg: 'read notes' });
    const asked2 = svc.seen.slice(before).filter((s) => s.path === '/api/chat').map((s) => s.body);
    expect(asked2.length).toBeGreaterThan(0);
    expect(asked2.every((b) => b.model === 'coder:30b' && b.options.num_ctx === 131072)).toBe(true);
    expect(same.text).not.toContain(', on ');
  } finally { dropEndpoint(svc.url); await svc.close(); }
  // not an Ollama service: the main model, and the report says why
  const fake = await startFakeServer([{ text: 'It says Hello wrold.' }]);
  try {
    const b = new Agent({ url: fake.url, model: local, cwd: proj, system: 'You are the main agent.', memory: false, flows: false, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'remote', checkIns: false, confirmPlan: false });
    const out = await b.runHelper('h2', { prompt: 'Read notes.txt.', kind: 'reader' }, { label: 'reader', arg: 'read notes' });
    expect(out.text).toContain('its Model line (tiny:3b) works on an Ollama service only');
    expect(fake.requests.filter((q) => q.stream)[0].model ?? '').not.toBe('tiny:3b');
  } finally { await fake.close(); }
});

test('a file you save between two messages counts from the next one: the new guide in the list, the new helper in the Agent tool', async () => {
  const fake = await startFakeServer([{ text: 'One.' }, { text: 'Two.' }]);
  try {
    const a = new Agent({ url: fake.url, model: local, cwd: proj, system: systemPrompt({ cwd: proj, git: 'none', set: 'remote' }), memory: false, flows: false, verify: false, way: 'app', hooks: [], mode: 'edits', instructions: 'remote', checkIns: false, confirmPlan: false });
    a.look = 'off';
    await a.send('what is in this folder?');
    writeFileSync(join(ownDir(), 'DEPLOY.md'), '# Deploy\n\nRead this when a change goes live.\n\n## Steps\n\n1. Ship it.\n');
    writeFileSync(join(helpersDir(), 'TEST-WRITER.md'), WRITER);
    await a.send('and now?');
    const [one, two] = fake.requests.filter((q) => q.stream);
    expect(one.messages[0].content).not.toContain('RULES/DEPLOY.md');
    expect(names(one)).not.toContain('Agent');
    expect(two.messages[0].content).toContain('- RULES/DEPLOY.md: when a change goes live');
    expect(two.messages[0].content).toContain('- RULES/SUBAGENTS.md:');
    expect(two.tools.find((t) => t.function.name === 'Agent').function.parameters.properties.kind.enum).toContain('test-writer');
  } finally { await fake.close(); }
});

test('with none of your files nothing changes: no helpers, no added guides, a file in the repo\'s agents folder is not one; the helpers guide says where they go', () => {
  mkdirSync(join(rules, 'remote', 'agents'), { recursive: true });
  writeFileSync(join(rules, 'remote', 'agents', 'TEST-WRITER.md'), WRITER);
  expect(readHelperAgents('remote')).toEqual([]);
  expect(extraGuides()).toEqual([]);
  expect(readGuides('remote').map((g) => g.name)).toEqual(GUIDES.filter((g) => g !== 'SUBAGENTS' && g !== 'MCP'));
  expect(readFileSync(join(SOURCE, 'remote', 'SUBAGENTS.md'), 'utf8')).toContain('~/.agentic-coder/rules/remote/agents');
});
