// "update memory" (src/agent/memory.mjs): recognised without catching code
// changes; where a folder's memory lives; with the memory off, nothing saved.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMemoryRequest, memoryFile, digest } from '../src/agent/memory.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

test('which messages ask to save to memory', () => {
  for (const t of ['update memory', 'Update your memory.', 'please update the memory', 'save this to memory', 'add that to your memory', 'remember that I prefer tabs', 'Remember: tests run with bun', 'remember this']) expect([t, isMemoryRequest(t)]).toEqual([t, true]);
  for (const t of ['update the memory usage in cache.mjs', 'fix the memory leak', 'what do you remember?', 'how much memory does it use', 'I remember it worked yesterday']) expect([t, isMemoryRequest(t)]).toEqual([t, false]);
});

test('the right file: the home folder\'s, the git repo\'s top, or the folder itself', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-mem-home-'));
  expect(memoryFile(home, home)).toBe(join(home, '.agentic', 'notes.md'));
  const repo = join(home, 'repo'); mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  expect(memoryFile(join(repo, 'src', 'deep'), home)).toBe(join(repo, '.agentic', 'notes.md'));
  const plain = join(home, 'plain'); mkdirSync(plain);
  expect(memoryFile(plain, home)).toBe(join(plain, '.agentic', 'notes.md'));
  // the old .bonsai/notes.md is not read since 3 Oct 2026
  mkdirSync(join(plain, '.bonsai')); writeFileSync(join(plain, '.bonsai', 'notes.md'), '# old\n');
  expect(memoryFile(plain, home)).toBe(join(plain, '.agentic', 'notes.md'));
});

test('the digest: what was said, without tool output', () => {
  expect(digest([{ role: 'user', content: 'hi' }, { role: 'tool', content: 'x' }, { role: 'assistant', content: 'Hello' }])).toBe('User: hi\nAgentic Coder: Hello');
});

test('"update memory" with the memory off: says so, asks the model nothing, writes no notes file', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-mem-agent-'));
  const fake = await startFakeServer([{ text: '{"add":["Likes self-contained HTML files on the Desktop"],"drop":[]}' }]);
  const asked = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'ask', flows: true, ask: async (req) => { asked.push(req); return { choice: 'no' }; } });
  const said = []; agent.on('assistant', (e) => said.push(e.text));
  agent.messages.push({ role: 'user', content: 'make notes.html on my Desktop, self-contained' }, { role: 'assistant', content: 'Done: ~/Desktop/notes.html.' });
  const reason = await agent.send('update memory');
  await fake.close();
  expect(reason).toBe('done');
  expect(asked).toHaveLength(0);
  expect(fake.requests).toHaveLength(0);
  expect(said.at(-1)).toContain('The memory is off here');
  expect(existsSync(join(cwd, '.agentic', 'notes.md'))).toBe(false);
  expect(existsSync(join(cwd, '.bonsai', 'notes.md'))).toBe(false);
});
