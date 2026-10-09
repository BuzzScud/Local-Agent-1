// What qwen3-coder-next on a service did on 9 Oct 2026, deciding for itself: "update memory" answered
// with "First, let me locate the existing memory file." and a find command written out in a shell
// block, never called, twice; each message ended in 2 s with nothing run and nothing saved. Now
// "update memory" is the app's own save whoever decides, and a command written out and not run goes
// back once to be run.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-cmd-text-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { commandInText } = await import('../src/agent/agent-said.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const service = { ...MODELS[DEFAULT_MODEL], remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' }, replyTokens: 8192 };
const agentOn = (url, cwd, o = {}) => new Agent({ url, model: service, cwd, system: systemPrompt({ cwd, git: 'none' }), thinking: false, ctx: 131072, mode: 'edits', flows: false, confirmPlan: false, memory: false, way: 'model', hooks: ['next-step'], ask: async () => ({ choice: 'yes' }), ...o });

// The two replies of that window, word for word.
const FIRST = 'I’ll update the memory file for this project.\n\nFirst, let me locate the existing memory file.\n\n```bash\nfind /Users/someone/Desktop -name "*memory*" -type f 2>/dev/null | head -5\n```';
const SECOND = 'I’ll look for an existing memory file to update.\n\n```bash\nfind /Users/someone/Desktop -name "*memory*" -type f 2>/dev/null\n```';

test('a reply that says it will run a command and ends with it written out', () => {
  expect(commandInText(FIRST)).toBe('find /Users/someone/Desktop -name "*memory*" -type f 2>/dev/null | head -5');
  expect(commandInText(SECOND)).toBe('find /Users/someone/Desktop -name "*memory*" -type f 2>/dev/null'); // I’ll with a curly quote
  expect(commandInText('Let me list the folder.\n\n```sh\n$ ls -la\n```\n')).toBe('ls -la');
  expect(commandInText('Now I will run the tests.\n```\nbun test\n```')).toBe('bun test');
  // Not this: commands offered to the user, an answer with several blocks, code that is not a shell's, a block mid-answer.
  expect(commandInText('To see the hierarchy, run something like:\n\n```bash\ntree -L 3 Desktop/\n```')).toBe('');
  expect(commandInText('If you want, I can run it:\n\n```bash\nls\n```')).toBe('');
  expect(commandInText('Two ways.\n\n```bash\nsort a | uniq\n```\n\nLet me show the other.\n\n```bash\ntree -L 2\n```')).toBe('');
  expect(commandInText('Let me write it like this.\n\n```js\nconst a = 1;\n```')).toBe('');
  expect(commandInText('Let me check.\n\n```bash\nls\n```\n\nThat lists the folder.')).toBe('');
  expect(commandInText('The memory is saved.')).toBe('');
});

test('a command written out and not run goes back once to be run, at the first step too', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-cmd-text-'));
  const fake = await startFakeServer([{ text: 'First, let me list the folder.\n\n```bash\nls\n```' }, { tool: { name: 'Bash', args: { command: 'ls' } } }, { text: 'The folder is empty.' }]);
  const notes = [];
  const a = agentOn(fake.url, cwd);
  a.on('note', (e) => notes.push(e.text));
  const reason = await a.send('what is in this folder?');
  await fake.close();
  expect(reason).toBe('done');
  expect(fake.requests).toHaveLength(3);
  expect(fake.requests[1].messages.at(-1).content).toContain('You wrote a command in your reply but did not run it');
  expect(notes).toContain('It wrote a command out without running it; asked it to run it.');
});

test('only once a message, and not with Do it now off', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-cmd-text-'));
  const twice = await startFakeServer([{ text: 'Let me list it.\n\n```bash\nls\n```' }, { text: 'Let me list it.\n\n```bash\nls\n```' }]);
  await agentOn(twice.url, cwd).send('what is in this folder?');
  await twice.close();
  expect(twice.requests).toHaveLength(2);
  const off = await startFakeServer([{ text: 'Let me list it.\n\n```bash\nls\n```' }]);
  await agentOn(off.url, cwd, { hooks: [] }).send('what is in this folder?');
  await off.close();
  expect(off.requests).toHaveLength(1);
});

test('"update memory" while the model decides is the app\'s own save: the model is not asked', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-cmd-text-'));
  const fake = await startFakeServer([{ text: FIRST }]);
  const said = [];
  const a = agentOn(fake.url, cwd);
  a.on('assistant', (e) => said.push(e.text));
  expect(await a.send('update memory')).toBe('done');
  await fake.close();
  expect(fake.requests).toHaveLength(0);
  expect(said.at(-1)).toContain('The memory is off here'); // updateMemory's answer with the memory off
});
