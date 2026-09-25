// Asking you when the request is unclear: the model's Ask tool, the question
// before starting (src/flows/clarify.mjs), and the answers hook for runs
// without a screen.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { needsClarifying, FIX_QUESTION, FIX_QUESTION_NO_TESTS } from '../src/flows/clarify.mjs';
import { runHeadless } from '../src/headless.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = join(mkdtempSync(join(tmpdir(), 'bonsai-ask-')), 'project'); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };
const plainFolder = () => { const d = join(mkdtempSync(join(tmpdir(), 'bonsai-ask-')), 'notes'); cpSync(join(import.meta.dir, '..', '..', 'models', 'evals', 'bench', 'tasks', '18-writing-noncode-folder', 'project'), d, { recursive: true }); return d; };

async function run(prompt, replies, { flows = false, answer, cwd = project() } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return typeof answer === 'function' ? answer(req) : answer ?? { choice: 'answer', text: 'export.mjs' }; } });
  for (const t of ['assistant', 'tool', 'note', 'route']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(prompt);
  await fake.close();
  return { reason, events, agent, cwd, fake };
}

test('needsClarifying: a bare "fix it" and lone words ask; real requests do not', () => {
  expect(needsClarifying('fix the bug')).toBe('fix');
  expect(needsClarifying('Fix it!')).toBe('fix');
  expect(needsClarifying('fix the test')).toBe('fix');
  expect(needsClarifying('api')).toBe('model');
  expect(needsClarifying('cleanup')).toBe('model');
  expect(needsClarifying('TEST')).toBe(null); // = run the tests
  expect(needsClarifying('make it faster')).toBe('model');
  for (const clear of ['add a --json flag to export.mjs', 'explain export.mjs', 'run the tests', 'hello', 'thanks!', 'why is it slow?', 'rename toCsv to toCSV', 'The tests fail. Fix the bug.', 'delete trades.json', 'fix the crash when the summary is empty in report.mjs']) {
    expect([clear, needsClarifying(clear)]).toEqual([clear, null]);
  }
});

test('the Ask tool: the question reaches you, the answer goes back to the model', async () => {
  const { reason, events, agent } = await run('do the thing', [
    { tool: { name: 'Ask', args: { question: 'Which file should change?', options: ['export.mjs', 'export.test.mjs'] } } },
    { text: 'Understood: export.mjs.' },
  ]);
  expect(reason).toBe('done');
  const ask = events.find((e) => e.type === 'ask');
  expect(ask.name).toBe('Ask');
  expect(ask.req.args).toEqual({ question: 'Which file should change?', options: ['export.mjs', 'export.test.mjs'] });
  const tool = events.find((e) => e.type === 'tool' && e.label === 'Ask');
  expect(tool.view).toEqual({ kind: 'answer', question: 'Which file should change?', text: 'export.mjs' });
  expect(agent.messages.find((m) => m.role === 'tool').content).toBe('The user answered: export.mjs');
  expect(events.at(-1).text).toBe('Understood: export.mjs.');
});

test('the Ask tool: closing the question ends the turn', async () => {
  const { reason, events } = await run('do the thing', [{ tool: { name: 'Ask', args: { question: 'What?' } } }, { text: 'never sent' }], { answer: { choice: 'no' } });
  expect(reason).toBe('declined');
  expect(events.find((e) => e.type === 'tool' && e.label === 'Ask').view.kind).toBe('declined');
});

test('"fix the bug" in a plain folder asks what is wrong first; the answer joins the conversation', async () => {
  const { reason, events, agent, fake } = await run('fix the bug', [{ text: 'I looked at the notes; nothing is broken.' }], { flows: true, cwd: plainFolder(), answer: { choice: 'answer', text: 'the shopping list has a typo' } });
  expect(reason).toBe('done');
  const ask = events.find((e) => e.type === 'ask');
  expect(ask.req.args.question).toBe(FIX_QUESTION_NO_TESTS);
  expect(agent.messages.slice(1, 4).map((m) => [m.role, m.content])).toEqual([['user', 'fix the bug'], ['assistant', FIX_QUESTION_NO_TESTS], ['user', 'the shopping list has a typo']]);
  // The model's request carries the question and the answer.
  const sent = fake.requests.at(-1).messages.map((m) => m.content).join('\n');
  expect(sent).toContain(FIX_QUESTION_NO_TESTS);
  expect(sent).toContain('the shopping list has a typo');
  expect(events.find((e) => e.type === 'tool' && e.label === 'Ask').view.text).toBe('the shopping list has a typo');
});

test('"fix the bug" in a project whose tests pass asks; a failing test suite is never asked about', async () => {
  // Passing tests (the demo project): the fixed question, before any model call.
  const a = await run('fix the bug', [{ text: 'not json' }, { text: 'Done; nothing was broken.' }], { flows: true, answer: { choice: 'answer', text: 'toCsv([]) throws' } });
  expect(a.events.find((e) => e.type === 'ask').req.args.question).toBe(FIX_QUESTION);
  expect(a.reason).toBe('done');
  // Failing tests: the fix path is the answer; no question.
  const cwd = join(mkdtempSync(join(tmpdir(), 'bonsai-ask-')), 'project');
  cpSync(join(import.meta.dir, 'fixture-fix'), cwd, { recursive: true });
  const b = await run('fix the bug', [{ text: '```js\nexport function median(v) { return 0; }\n```' }, { text: 'Done.' }], { flows: true, cwd, answer: { choice: 'no' } });
  expect(b.events.some((e) => e.type === 'ask' && e.name === 'Ask')).toBe(false);
});

test('a lone word: the model judges; when unclear it asks, and the answer travels with the request', async () => {
  // Unclear: one question, then the request (with the answer) is sorted and worked on.
  const a = await run('api', [
    { text: '{"clear": false, "question": "What should be done with the API?"}' },
    { text: 'Added the notes.' },
  ], { flows: true, answer: { choice: 'answer', text: 'add notes about the API to NOTES.md' } });
  expect(a.reason).toBe('done');
  expect(a.events.find((e) => e.type === 'ask').req.args.question).toBe('What should be done with the API?');
  const sorting = a.fake.requests[0];
  expect(sorting.messages[1].content).toContain('Request: "api"');
  expect(sorting.messages[1].content).toContain('export.mjs'); // the file list
  expect(sorting.response_format.type).toBe('json_schema');
  const loop = a.fake.requests.at(-1).messages;
  expect(loop.slice(-3).map((m) => [m.role, m.content])).toEqual([['user', 'api'], ['assistant', 'What should be done with the API?'], ['user', 'add notes about the API to NOTES.md']]);
  // The answer is what gets sorted: "just explain … change nothing" is a question, not a change.
  const c = await run('api', [{ text: '{"clear": false, "question": "What should be done with the API?"}' }, { text: 'It exports toCsv and main.' }], { flows: true, answer: { choice: 'answer', text: 'Just explain what the API in export.mjs does; change nothing.' } });
  expect(c.reason).toBe('done');
  expect(c.events.find((e) => e.type === 'route').kind).toBe('question');
  expect(c.events.filter((e) => e.type === 'tries-done')).toEqual([]);
  // Clear enough: no question.
  const b = await run('TEST', [{ text: '{"clear": true, "question": ""}' }, { text: 'The tests pass.' }], { flows: true });
  expect(b.events.some((e) => e.type === 'ask')).toBe(false);
  expect(b.reason).toBe('done');
});

test('without a screen, the answers hook replies and every question is recorded', async () => {
  const cwd = plainFolder();
  const fake = await startFakeServer([{ text: 'Fixed the typo.' }]);
  const seen = [];
  const run1 = await runHeadless({ prompt: 'fix the bug', cwd, url: fake.url, model, thinking: false, ctx: 32768, autoApprove: true, answers: (q) => { seen.push(q); return 'the list has a typo'; } });
  expect(run1.asked).toEqual([{ question: FIX_QUESTION_NO_TESTS, answer: 'the list has a typo' }]);
  expect(seen).toEqual([FIX_QUESTION_NO_TESTS]);
  // No hook, auto-approved: a stand-in answer keeps the run going; not auto-approved: the turn stops.
  const fake2 = await startFakeServer([{ text: 'Looked around.' }]);
  const run2 = await runHeadless({ prompt: 'fix the bug', cwd, url: fake2.url, model, thinking: false, ctx: 32768, autoApprove: true });
  expect(run2.asked[0].answer).toMatch(/stop and tell me/);
  const fake3 = await startFakeServer([]);
  const run3 = await runHeadless({ prompt: 'fix the bug', cwd, url: fake3.url, model, thinking: false, ctx: 32768 });
  expect(run3.reason).toBe('declined');
  await Promise.all([fake.close(), fake2.close(), fake3.close()]);
});
