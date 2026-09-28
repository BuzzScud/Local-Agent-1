// A Write with its content but no path (Gemma, 28 Sep, twice in a row): the
// content is kept, the error says how to send the call again, and a Write that
// names only the file writes the kept content. Also: /clear goes back to the
// folder Agentic Coder was started in, and "Work in <project>?" offers staying first.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { parseArgs } from '../src/agent/tools.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = mkdtempSync(join(tmpdir(), 'agentic-kept-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };
const PAGE = ['<!doctype html>', '<html lang="en">', '<head><meta charset="utf-8"><title>Notes</title></head>', '<body>', ...Array.from({ length: 60 }, (_, i) => `<p>line ${i + 1}</p>`), '</body>', '</html>', ''].join('\n');
const REQUEST = 'Create one self-contained HTML file called notes.html with a "+ New note" button.';

async function run(replies, { cwd = project(), request = REQUEST } = {}) {
  const fake = await startFakeServer(replies, { chunk: 400 });
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: true, ctx: 32768, mode: 'edits', flows: false, verify: false, confirmPlan: false, ask: async () => ({ choice: 'yes' }) });
  for (const t of ['tool', 'note']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(request, {});
  await fake.close();
  return { reason, events, agent, cwd, fake };
}

test('a missing argument says how to send the call again', () => {
  expect(parseArgs('Write', JSON.stringify({ content: 'x' })).error).toBe('Write needs "path": the file path, relative to the project folder. Send the Write call again with "path" set.');
  expect(parseArgs('Bash', '{}').error).toContain('Send the Bash call again with "command" set.');
});

test('Write without a path keeps the content; a Write with only the path writes it', async () => {
  const replies = [
    { tool: { name: 'Write', args: { content: PAGE } } },
    { tool: { name: 'Write', args: { path: 'notes.html' } } },
    { text: 'Created notes.html.' },
  ];
  const { reason, events, agent, cwd, fake } = await run(replies);
  expect(reason).toBe('done');
  // The file holds the content sent the first time, whole.
  expect(readFileSync(join(cwd, 'notes.html'), 'utf8')).toBe(PAGE);
  // The first error says the content is kept, how to send the call, and the name the request gives.
  const first = agent.messages.find((m) => m.role === 'tool').content;
  expect(first).toContain('Write needs "path"');
  expect(first).toContain(`Your content (${PAGE.split('\n').length} lines) is kept, so do not write it again`);
  expect(first).toContain('send Write with only "path" (the request names "notes.html")');
  // The long call in the conversation shrank to one line, so the model does not
  // carry the page twice; the next request to the model already had it shrunk.
  const call = agent.messages.find((m) => m.tool_calls?.[0]?.function.name === 'Write').tool_calls[0];
  expect(JSON.parse(call.function.arguments)).toEqual({ content: `[${PAGE.split('\n').length} lines, kept by Agentic Coder]` });
  const second = fake.requests[1].messages.find((m) => m.tool_calls?.[0]?.function?.name === 'Write');
  expect(second.tool_calls[0].function.arguments).not.toContain('line 60');
  // What you see: the short error line, then the Write of notes.html and a note.
  const tools = events.filter((e) => e.type === 'tool');
  expect(tools[0].view.message).toBe(`Write needs "path"; its ${PAGE.split('\n').length} lines are kept until it names the file`);
  expect(tools[1]).toMatchObject({ label: 'Write', arg: 'notes.html' });
  expect(tools[1].error).toBeFalsy();
  expect(events.some((e) => e.type === 'note' && e.text === 'Wrote the kept content to notes.html; it was not written again.')).toBe(true);
  expect(agent.keptWrite).toBeNull();
});

test('without anything kept, a Write with only the path still needs content', async () => {
  const replies = [{ tool: { name: 'Write', args: { path: 'notes.html' } } }, { text: 'Sorry.' }];
  const { agent, cwd } = await run(replies);
  expect(agent.messages.find((m) => m.role === 'tool').content).toContain('Write needs "content": the full file content.');
  expect(existsSync(join(cwd, 'notes.html'))).toBe(false);
});

test('the kept content is named in the notes when the memory fills', async () => {
  const replies = [{ tool: { name: 'Write', args: { content: PAGE } } }, { text: 'Stopping here.' }];
  const { agent } = await run(replies);
  expect(agent.keptWrite?.content).toBe(PAGE);
  // restartFrom puts seenSoFar() after the notes: the kept content survives the restart.
  expect(agent.seenSoFar()).toContain(`Agentic Coder still keeps the content of my Write call that had no path (${PAGE.split('\n').length} lines)`);
  expect(agent.restartFrom('I wrote the page but forgot the path.')).toBe(true);
  expect(agent.messages.some((m) => m.role === 'assistant' && String(m.content).includes('I send Write with only "path" to save it'))).toBe(true);
  expect(agent.keptWrite?.content).toBe(PAGE);
});

test('/clear goes back to the folder it was started in, and forgets what was kept', () => {
  const home = project();
  const repo = project();
  const agent = new Agent({ url: 'http://127.0.0.1:1', model, cwd: home, system: systemPrompt({ cwd: home, git: 'test' }), flows: false, verify: false, ask: async () => ({ choice: 'yes' }) });
  const moved = [];
  agent.on('cwd', (e) => moved.push(e.cwd));
  agent.moveTo(repo);
  agent.offered = new Set([repo]);
  agent.keptWrite = { content: 'x' };
  expect(agent.startOver(home)).toBe(true);
  expect(agent.cwd).toBe(home);
  expect(moved).toEqual([repo, home]);
  expect(agent.messages).toHaveLength(1);
  expect(agent.offered).toBeNull();
  expect(agent.keptWrite).toBeNull();
  // Already there: nothing moves.
  expect(agent.startOver(home)).toBe(false);
  expect(moved).toEqual([repo, home]);
});

test('"Work in <project>?" offers staying first, so enter keeps you where you are', async () => {
  const home = homedir();
  const repo = join(home, 'Desktop', 'agentic-coder');
  let asked = null;
  const agent = new Agent({ url: 'http://127.0.0.1:1', model, cwd: home, system: 'test', flows: false, verify: false, ask: async (req) => { asked = req; return { choice: 'answer', text: req.args.options[0] }; } });
  agent.projects = [repo];
  const r = await agent.offerProject('rsync -a ~/Desktop/agentic-coder/ ~/worktrees/copy/', null);
  expect(asked.args.question).toBe('Work in ~/Desktop/agentic-coder? Agentic Coder then uses its tests and its AGENTS.md, and its commands can only change files there, until /clear.');
  expect(asked.args.options).toEqual(['No, stay in ~', 'Yes, work in agentic-coder']);
  // The first choice (what enter picks) keeps it home.
  expect(r).toBeNull();
  expect(agent.cwd).toBe(home);
});
