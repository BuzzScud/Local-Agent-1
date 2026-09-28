// "update memory" (src/agent/memory.mjs): recognised without catching code
// changes, saved to the right file without a question, merged without repeats.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMemoryRequest, memoryFile, applyMemory, readMemory, digest } from '../src/agent/memory.mjs';
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
  // a project that already has the old .bonsai/notes.md keeps using it
  mkdirSync(join(plain, '.bonsai')); writeFileSync(join(plain, '.bonsai', 'notes.md'), '# old\n');
  expect(memoryFile(plain, home)).toBe(join(plain, '.bonsai', 'notes.md'));
});

test('merging: new facts added once, named lines dropped, the user\'s own text kept, kept out of git', () => {
  const repo = mkdtempSync(join(tmpdir(), 'agentic-mem-repo-')); mkdirSync(join(repo, '.git', 'info'), { recursive: true });
  const file = join(repo, '.bonsai', 'notes.md');
  let r = applyMemory(file, { add: ['Prefers tabs over spaces', 'Tests run with bun test'], drop: [] });
  expect(r.added).toHaveLength(2);
  expect(readFileSync(file, 'utf8')).toContain('# Agentic Coder memory');
  writeFileSync(file, readFileSync(file, 'utf8') + '\nMy own line, not a fact.\n');
  r = applyMemory(file, { add: ['prefers TABS over spaces!', 'Deploys go through ssh orbit'], drop: ['Tests run with bun test'] });
  expect(r.added).toEqual(['Deploys go through ssh orbit']); // the repeat is skipped
  expect(r.dropped).toEqual(['Tests run with bun test']);
  expect(readMemory(file)).toEqual(['Prefers tabs over spaces', 'Deploys go through ssh orbit']);
  expect(readFileSync(file, 'utf8')).toContain('My own line, not a fact.');
  expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('.bonsai/');
  expect(digest([{ role: 'user', content: 'hi' }, { role: 'tool', content: 'x' }, { role: 'assistant', content: 'Hello' }])).toBe('User: hi\nAgentic Coder: Hello');
});

test('"update memory" in a conversation saves straight to the file: no question about where', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentic-mem-agent-'));
  const fake = await startFakeServer([{ text: '{"add":["Likes self-contained HTML files on the Desktop"],"drop":[]}' }]);
  const asked = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test', tests: null }), thinking: false, ctx: 32768, mode: 'ask', flows: true, ask: async (req) => { asked.push(req); return { choice: 'no' }; } });
  const said = []; agent.on('assistant', (e) => said.push(e.text));
  agent.messages.push({ role: 'user', content: 'make notes.html on my Desktop, self-contained' }, { role: 'assistant', content: 'Done: ~/Desktop/notes.html.' });
  const reason = await agent.send('update memory');
  await fake.close();
  expect(reason).toBe('done');
  expect(asked).toHaveLength(0); // never asks where
  expect(fake.requests).toHaveLength(1); // one focused question to the model, nothing else
  expect(JSON.stringify(fake.requests[0])).toContain('make notes.html on my Desktop');
  expect(readMemory(join(cwd, '.agentic', 'notes.md'))).toEqual(['Likes self-contained HTML files on the Desktop']);
  expect(said.at(-1)).toContain('Saved to memory');
  expect(existsSync(join(cwd, '.agentic', 'notes.md'))).toBe(true);
});
