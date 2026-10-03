// Step 2, sorting a request: every real request keeps the path it should take
// (sort-lines.mjs), and the rules added on 2026-09-27 do what they say — thanks
// and offers of work get the quick reply, a line that continues the last turn
// carries on, plain commands and clear short requests start without a call to
// the model, the path shows under the request, and the question before
// starting comes with answers to pick.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { sortOf } from '../src/flows/sort.mjs';
import { routeByRules, isSmallTalk } from '../src/flows/index.mjs';
import { needsClarifying, cleanOptions } from '../src/flows/clarify.mjs';
import { isQuit, isFollowUp, isCommand, isPageRequest, sortLine } from '../src/flows/words.mjs';
import { permissionOptions } from '../src/app/screen.jsx';
import { startFakeServer } from './fake-server.mjs';
import { LINES } from './sort-lines.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = join(mkdtempSync(join(tmpdir(), 'agentic-sort-')), 'project'); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };

// One conversation against the scripted model: each message is sent in turn.
async function talk(messages, replies, { answer, cwd = project(), mode = 'edits' } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode, flows: true, confirmPlan: false,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return typeof answer === 'function' ? answer(req) : answer ?? { choice: 'no' }; } });
  for (const t of ['assistant', 'tool', 'note', 'route', 'sorted']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reasons = [];
  const marks = [];
  for (const m of messages) { marks.push({ events: events.length, requests: fake.requests.length }); reasons.push(await agent.send(m)); }
  await fake.close();
  // What the last message alone caused.
  const last = { events: events.slice(marks.at(-1).events), requests: fake.requests.slice(marks.at(-1).requests) };
  return { reasons, events, agent, fake, last };
}

test(`every one of the ${LINES.length} lines takes its path`, () => {
  const wrong = [];
  for (const l of LINES) {
    const s = sortOf(l.text, { hasPrior: l.prior });
    if (s.path !== l.path || s.ask !== l.ask) wrong.push(`${l.set} ${l.n} ${JSON.stringify(l.text.slice(0, 60))}: ${s.path}${s.ask ? ` +ask(${s.ask})` : ''}, not ${l.path}${l.ask ? ` +ask(${l.ask})` : ''}`);
  }
  expect(wrong).toEqual([]);
  // The sets are whole: 25 typed lines, 28 tasks, 28 real requests, 20 traps.
  const count = (set) => LINES.filter((l) => l.set === set).length;
  expect([count('yours'), count('tasks'), count('requests'), count('traps')]).toEqual([25, 28, 28, 20]);
});

test('the 2026-09-27 rules moved 15 real lines and no trap', () => {
  const moved = LINES.filter((l) => l.was);
  expect(moved.length).toBe(15);
  expect(moved.filter((l) => l.set === 'traps')).toEqual([]);
  expect(moved.filter((l) => l.set === 'tasks')).toEqual([]);
  // Fewer calls to the model before work starts: a line is a call when the
  // model is asked whether it is clear, or (in a code project) to sort it.
  const calls = (s, project) => (s.ask === 'model' ? 1 : project && s.path === 'unsorted' ? 1 : 0);
  const real = LINES.filter((l) => l.set !== 'traps');
  const inProject = (l) => l.set === 'tasks' || (l.set === 'requests' && l.n < 25) || (l.set === 'requests' && l.n === 28);
  const before = real.reduce((n, l) => n + calls(l.was ?? l, inProject(l)), 0);
  const after = real.reduce((n, l) => n + calls(l, inProject(l)), 0);
  expect([before, after]).toEqual([12, 2]);
});

test('thanks, praise and an offer of work get the quick reply; a request that starts with them does not', () => {
  for (const talkLine of ['its perfect , thank you', 'hello , ima need help with something', 'i want you to help me with something', 'thank you so much', 'great job', 'looks good, thanks', 'ok thanks', 'i need your help with something']) {
    expect([talkLine, isSmallTalk(talkLine)]).toEqual([talkLine, true]);
    expect(routeByRules(talkLine)).toEqual({ kind: 'question', chat: true });
  }
  for (const request of ['great, now add a --json flag to export.mjs', 'thanks, now rename calcTotal to totalPrice', 'perfect, fix the failing date test', 'i need help with the export function in export.mjs', 'good morning, can you explain export.mjs', 'nice work on the tests but the date test fails']) {
    expect([request, isSmallTalk(request)]).toEqual([request, false]);
  }
});

test('exit and quit leave; a request that starts with them is a request', () => {
  for (const t of ['exit', 'quit', 'Exit.', ' QUIT! ']) expect([t, isQuit(t)]).toEqual([t, true]);
  for (const t of ['exit the loop early in parse()', 'quit using var in export.mjs', '/exit', 'exit code 1']) expect([t, isQuit(t)]).toEqual([t, false]);
});

test('a follow-up needs an earlier turn, a bare it/that after the verb, and no code named', () => {
  for (const t of ['can you add it to my desktop?', ' why', 'fix that', 'do it again', 'try again', 'make it bigger', 'ok now move them to the archive', 'use blue instead', 'and delete that please']) {
    expect([t, isFollowUp(t, true)]).toEqual([t, true]);
    expect([t, isFollowUp(t, false)]).toEqual([t, false]); // the first line of a conversation never is one
  }
  for (const t of ['tell me about multiplication, how does it work?', 'fix this bug in export.mjs', 'why does export.mjs crash on an empty file?', 'rename it to loadBars', 'make this function faster: toCsv in export.mjs',
    'add a --json flag to export.mjs that prints the rows as JSON', 'what does this project do?', 'add a test for formatMoney and run it', 'copy it to ~/Desktop/reports/ and open that folder']) {
    expect([t, isFollowUp(t, true)]).toEqual([t, false]);
  }
});

test('plain commands and page requests are sorted by a rule; ones that name code are left as they were', () => {
  for (const t of ['run the tests', 'TEST', 'commit and push to github', 'git reset --hard', 'kill the node server on port 3999', 'run sudo ls to check the permissions', 'npm install']) {
    expect([t, isCommand(t)]).toEqual([t, true]);
    expect([t, routeByRules(t)?.kind]).toEqual([t, 'other']);
  }
  for (const t of ['build a login page component in src/pages/Login.jsx', 'install lodash and use it in export.mjs to group the rows', 'exit the loop early in parse() when the row is empty']) {
    expect([t, routeByRules(t)]).toEqual([t, null]); // still the model's to sort
  }
  // A rule that was already there keeps its answer: fix stays fix.
  expect(routeByRules('run the tests and fix what fails').kind).toBe('fix');
  for (const t of ['can you create a self contained html file and design a simple and modern finance dashbaord?', 'make me a landing page for my store', 'create a website for my store']) {
    expect([t, isPageRequest(t)]).toEqual([t, true]);
    expect([t, routeByRules(t)?.kind]).toEqual([t, 'other']);
  }
  expect(routeByRules('add a settings page to the app').kind).toBe('change'); // "add" is a change to what exists
  expect(routeByRules('design a dashboard')).toBe(null); // no rule had it before, none takes it now: the model sorts it
  expect(routeByRules('create a new file called slug.mjs with a slugify(text) function').kind).toBe('other'); // as before
});

test('a file to make on the Desktop, or a request that opens with what to do, is work even with a question mark', () => {
  // 3 Oct 2026: sorted as questions, so each Write was turned away ("A question changes no files").
  for (const t of ['create the helper agent file for me and add it to my desktop when you are done?', 'write a summary of this repo and save it to my desktop?', 'make me a page about the data and put it on my desktop?']) {
    expect([t, routeByRules(t)?.kind]).toEqual([t, 'other']);
  }
  for (const t of ['make me a chart of the trades?', 'ok, add a --json flag to export.mjs?', 'create a notes file?']) expect([t, routeByRules(t)?.kind]).not.toEqual([t, 'question']);
  // Asking about the Desktop makes nothing: still a question.
  for (const t of ['what is on my desktop?', 'which files are in my desktop folder?', 'is the page on my desktop?']) expect([t, routeByRules(t)?.kind]).toEqual([t, 'question']);
});

test('a short request the rules understand is not asked about; a lone word still is', () => {
  for (const t of ['rename test to check', 'explain the tests', 'update the readme', 'describe the project']) expect([t, needsClarifying(t)]).toEqual([t, null]);
  for (const t of ['api', 'cleanup', 'make it faster', 'dark mode', 'why']) expect([t, needsClarifying(t)]).toEqual([t, 'model']);
});

test('the line under the request', () => {
  expect(sortLine('change', { shortcut: true })).toBe('Sorted as: change · shortcut');
  expect(sortLine('rename', { shortcut: true })).toBe('Sorted as: rename · shortcut');
  expect(sortLine('change')).toBe('Sorted as: change · step by step'); // outside a code project the shortcuts are off
  expect(sortLine('question', { shortcut: true })).toBe('Sorted as: question · step by step');
  expect(sortLine('other', { shortcut: true })).toBe('Sorted as: task · step by step');
  expect(sortLine(undefined)).toBe('Sorted as: task · step by step');
  expect(sortLine('follow-up')).toBe('Sorted as: follow-up · continues the conversation');
});

test('the answers to pick: two or three, short, different', () => {
  expect(cleanOptions(['Explain how the API works', 'Fix a broken API endpoint', 'Add a new API endpoint'])).toEqual(['Explain how the API works', 'Fix a broken API endpoint', 'Add a new API endpoint']);
  expect(cleanOptions(['1. Explain it', '- Fix it', ' explain it ', '', null, 'Add to it', 'A fourth'])).toEqual(['Explain it', 'Fix it', 'Add to it']);
  expect(cleanOptions(['What should be faster?', 'Speed up export.mjs'], 'What should be faster?')).toEqual([]); // one real answer is no list
  expect(cleanOptions(undefined)).toEqual([]);
  expect(cleanOptions(['x'.repeat(200), 'short'])[0].length).toBe(80);
});

test('a clear question in a project: no call to the model before the work, and the line says where it went', async () => {
  const { reasons, events, fake } = await talk(['explain the tests'], [{ text: 'They check toCsv and main.' }]);
  expect(reasons).toEqual(['done']);
  expect(events.some((e) => e.type === 'ask')).toBe(false);
  expect(fake.requests.filter((r) => r.response_format).length).toBe(0); // no sorting call, no "is this clear?" call
  expect(events.filter((e) => e.type === 'sorted').map((e) => e.text)).toEqual(['Sorted as: question · step by step']);
  expect(events.at(-1).text).toBe('They check toCsv and main.');
});

test('a plain command in a project goes step by step without being sorted by the model', async () => {
  const { reasons, events, fake } = await talk(['commit and push to github'], [{ text: 'This folder is not a git repo.' }]);
  expect(reasons).toEqual(['done']);
  expect(fake.requests.filter((r) => r.response_format).length).toBe(0);
  expect(events.find((e) => e.type === 'route').kind).toBe('other');
  expect(events.filter((e) => e.type === 'sorted').map((e) => e.text)).toEqual(['Sorted as: task · step by step']);
});

test('a follow-up carries on with the conversation: no question, no focused path', async () => {
  const { reasons, last, agent } = await talk(['explain the tests', 'can you add it to my desktop?'], [{ text: 'They check toCsv and main.' }, { text: 'I cannot reach the Desktop from this folder.' }]);
  expect(reasons).toEqual(['done', 'done']);
  expect(last.events.some((e) => e.type === 'ask')).toBe(false);
  expect(last.events.some((e) => e.type === 'route')).toBe(false); // the focused paths never saw it
  expect(last.events.filter((e) => e.type === 'sorted').map((e) => e.text)).toEqual(['Sorted as: follow-up · continues the conversation']);
  expect(last.requests.length).toBe(1); // one call: the reply itself
  // …and that call has the conversation in it.
  const sent = last.requests[0].messages.map((m) => m.content).join('\n');
  expect(sent).toContain('They check toCsv and main.');
  expect(sent).toContain('can you add it to my desktop?');
  expect(agent.messages.at(-1).content).toBe('I cannot reach the Desktop from this folder.');
});

test('the same line as the first of a conversation is sorted on its own, as before', async () => {
  const { events } = await talk(['can you add it to my desktop?'], [{ text: '{"kind":"other"}' }, { text: 'Add what?' }]);
  expect(events.filter((e) => e.type === 'sorted').map((e) => e.text)).not.toContain('Sorted as: follow-up · continues the conversation');
});

test('a lone word: the question comes with answers to pick, and the pick is what gets sorted', async () => {
  const { reasons, events, fake } = await talk(['api'], [
    { text: '{"clear": false, "question": "What do you want to do with the API?", "options": ["Explain how the API works", "Fix a broken API endpoint", "Add a new API endpoint"]}' },
    { text: 'It exports toCsv and main.' },
  ], { answer: (req) => ({ choice: 'answer', text: req.args.options[0] }) });
  expect(reasons).toEqual(['done']);
  const ask = events.find((e) => e.type === 'ask');
  expect(ask.req.args).toEqual({ question: 'What do you want to do with the API?', options: ['Explain how the API works', 'Fix a broken API endpoint', 'Add a new API endpoint'] });
  // The call asks for the answers, and for different kinds of work.
  const call = fake.requests[0];
  expect(call.response_format.json_schema.schema.required).toEqual(['clear', 'question', 'options']);
  expect(call.messages[1].content).toContain('different kind of work');
  // On screen: the answers, then typing your own, then stopping.
  expect(permissionOptions(ask.req, '').map((o) => o.label)).toEqual(['Explain how the API works', 'Fix a broken API endpoint', 'Add a new API endpoint', 'Type an answer', 'Stop here (esc)']);
  // "Explain how the API works" is a question: no focused path, and the line says so.
  expect(events.find((e) => e.type === 'route').kind).toBe('question');
  expect(events.filter((e) => e.type === 'sorted').map((e) => e.text)).toEqual(['Sorted as: question · step by step']);
  expect(events.find((e) => e.type === 'tool' && e.label === 'Ask').view).toEqual({ kind: 'answer', question: 'What do you want to do with the API?', text: 'Explain how the API works' });
});

test('a question with no usable answers is asked as before, to be typed', async () => {
  const { events } = await talk(['api'], [
    { text: '{"clear": false, "question": "What should be done with the API?", "options": ["Fix it", "fix it"]}' },
    { text: 'It exports toCsv and main.' },
  ], { answer: { choice: 'answer', text: 'Just explain what the API in export.mjs does; change nothing.' } });
  expect(events.find((e) => e.type === 'ask').req.args).toEqual({ question: 'What should be done with the API?' });
});

test('greetings, thanks and a plan show no line', async () => {
  const a = await talk(['its perfect , thank you'], [{ text: 'You’re welcome.' }]);
  expect(a.events.some((e) => e.type === 'sorted')).toBe(false);
  expect(a.fake.requests.length).toBe(1);
  const b = await talk(['add a --json flag to export.mjs'], [{ text: '1. Read export.mjs. 2. Add the flag.' }], { mode: 'plan' });
  expect(b.events.some((e) => e.type === 'sorted')).toBe(false);
});
