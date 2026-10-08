// Agentic Coder working on itself (agent-work.mjs, the owner's pick 8 Oct 2026): a turn on the Claude
// API in Bypass that changed the app's own code and ran its tests, which passed, restarts the window on
// that code once the answer is in. Not when the tests failed, not when only a doc or test changed, not
// when the model already asked the App tool for the restart, and never on a local model.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } from '../../models/index.mjs';
import { startFakeAnthropic } from './fake-anthropic.mjs';

process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'self-restart-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const model = MODELS[DEFAULT_MODEL];

// A folder shaped like the app's repo (update.mjs findRepo: terminal/src/cli.jsx), with one passing test.
function repoLike() {
  const repo = mkdtempSync(join(tmpdir(), 'self-restart-repo-'));
  mkdirSync(join(repo, 'terminal', 'src', 'agent'), { recursive: true });
  writeFileSync(join(repo, 'terminal', 'src', 'cli.jsx'), '');
  writeFileSync(join(repo, 'ok.test.mjs'), "import { test } from 'node:test';\ntest('ok', () => {});\n");
  writeFileSync(join(repo, 'bad.test.mjs'), "import { test } from 'node:test';\ntest('bad', () => { throw new Error('no'); });\n");
  return repo;
}

async function turn(replies, { cwd, mode = 'bypass', app = true, env = {} } = {}) {
  const repoWas = process.env.AGENTIC_REPO;
  process.env.AGENTIC_REPO = cwd; // update.mjs findRepo: this folder stands for the app's repo
  const fake = await startFakeAnthropic(replies);
  setEndpoint(fake.url, { key: fake.key, kind: 'claude', model: 'claude-opus-5-5' });
  const restarts = [];
  const notes = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, ctx: 32768, mode, flows: false, way: 'model', verify: false, ask: async () => ({ choice: 'yes' }) });
  if (app) agent.app = { restart: async (reason) => { restarts.push(reason); return { ok: true }; }, command: async () => ({ notes: [] }), setting: async () => ({ value: null }) };
  agent.on('note', (e) => notes.push(e.text));
  try {
    const reason = await agent.send('change the app', env);
    return { reason, restarts, notes, turn: agent.turn };
  } finally { if (repoWas === undefined) delete process.env.AGENTIC_REPO; else process.env.AGENTIC_REPO = repoWas; dropEndpoint(fake.url); await fake.close(); }
}

const write = (path) => ({ name: 'Write', args: { path, content: '// changed\n' } });
const tests = (file = 'ok.test.mjs') => ({ name: 'Bash', args: { command: `node --test ${file}` } });

test('app code changed and the tests pass: the window restarts after the answer, with the file in the reason', async () => {
  const cwd = repoLike();
  const r = await turn([{ tools: [write('terminal/src/agent/new.mjs')] }, { tools: [tests()] }, { text: 'Added new.mjs; the test passes.' }], { cwd });
  expect(r.reason).toBe('done');
  expect(r.restarts).toEqual(['terminal/src/agent/new.mjs changed and the tests pass']);
}, 30_000);

test('no restart when the tests failed, when only a test file changed, or when there is no window', async () => {
  const cwd = repoLike();
  const failed = await turn([{ tools: [write('terminal/src/agent/new.mjs')] }, { tools: [tests('bad.test.mjs')] }, { text: 'It fails; I stop here.' }, { text: 'Still failing.' }, { text: 'Still failing.' }], { cwd });
  expect(failed.restarts).toEqual([]);
  const onlyTest = await turn([{ tools: [write('terminal/test/new.test.mjs')] }, { tools: [tests()] }, { text: 'Added a test.' }], { cwd });
  expect(onlyTest.restarts).toEqual([]);
  const noApp = await turn([{ tools: [write('terminal/src/agent/new.mjs')] }, { tools: [tests()] }, { text: 'Done.' }], { cwd, app: false });
  expect(noApp.restarts).toEqual([]);
}, 60_000);

test('the model asked for the restart itself with the App tool: the end of the turn does not ask again', async () => {
  const cwd = repoLike();
  const r = await turn([{ tools: [write('terminal/src/agent/new.mjs')] }, { tools: [tests()] }, { tools: [{ name: 'App', args: { action: 'restart', reason: 'new.mjs, test passes' } }] }, { text: 'Restarting.' }], { cwd });
  expect(r.restarts).toEqual(['new.mjs, test passes']);
}, 30_000);

test('outside self (Auto on the Claude API) nothing restarts, even with the same change and passing tests', async () => {
  const cwd = repoLike();
  const r = await turn([{ tools: [write('terminal/src/agent/new.mjs')] }, { tools: [tests()] }, { text: 'Done.' }], { cwd, mode: 'auto' });
  expect(r.restarts).toEqual([]);
}, 30_000);
