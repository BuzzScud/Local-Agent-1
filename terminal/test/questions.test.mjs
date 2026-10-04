// Questions in plain words (3 Oct 2026): a choice with what it means, the one recommended,
// ticking several, more than one question, and the app's own questions without tool names.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt, WORK_HABITS } from '../src/agent/prompt.mjs';
import { askedQuestions, fileSaid, planSaid, changesSaid, lookSaid, stepSaid, errorSaid, checkInQuestion, stuckQuestion } from '../src/agent/questions.mjs';
import { parseArgs, TOOL_DEFS } from '../src/agent/tools.mjs';
import { permissionOptions } from '../src/app/screen.jsx';
import { cleanChoices } from '../src/flows/clarify.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const project = () => { const d = mkdtempSync(join(tmpdir(), 'agentic-questions-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };

test('a choice is a string or { label, about, recommended }; "(recommended)" in a label counts too', () => {
  const [q] = askedQuestions({ question: ' What should the footer show? ', options: [
    { label: 'Time left this hour', about: 'A small clock. Example: "42 min left"', recommended: true },
    'Messages used today (recommended)',
    { text: 'Both, side by side', description: 'Needs a wider window.' },
    'Time left this hour', // the same choice again
    { label: '' },
    'A fifth', 'A sixth',
  ] });
  expect(q).toEqual({
    question: 'What should the footer show?',
    options: ['Time left this hour', 'Messages used today', 'Both, side by side', 'A fifth'],
    about: ['A small clock. Example: "42 min left"', '', 'Needs a wider window.', ''],
    recommended: 0, // the first one marked
    several: false,
  });
  expect(askedQuestions({ question: 'Pick', options: ['One'], several: true })[0].several).toBe(false); // one choice: nothing to tick
});

// Five since 4 Oct 2026 (the owner asks for "up to 5 clarifying questions"; four before).
test('more questions are asked after the first, five at most; one with no words is left out', () => {
  const qs = askedQuestions({ question: 'First?', options: ['a', 'b'], more: [{ question: 'Second?', options: ['c', 'd'], several: true }, { question: '' }, { question: 'Third?' }, { question: 'Fourth?' }, { question: 'Fifth?' }, { question: 'Sixth?' }] });
  expect(qs.map((q) => q.question)).toEqual(['First?', 'Second?', 'Third?', 'Fourth?', 'Fifth?']);
  expect(qs[1].several).toBe(true);
  // A list sent as a string of JSON is read as a list.
  const { args } = parseArgs('Ask', JSON.stringify({ question: 'Which?', options: '[{"label":"A","about":"x"},"B"]' }));
  expect(askedQuestions(args)[0].options).toEqual(['A', 'B']);
});

test('the Ask tool asks for about lines, a recommended choice, several and more', () => {
  const ask = TOOL_DEFS.find((d) => d.name === 'Ask');
  expect(Object.keys(ask.parameters.properties)).toEqual(['question', 'options', 'several', 'more']);
  expect(ask.parameters.properties.options.items.properties.about).toBeTruthy();
  expect(ask.description).toContain('everyday words, no file paths, commands or code names');
  // Every model is told to talk this way (the remote set has the same line in HARNESS.md).
  expect(WORK_HABITS).toContain('Talk to the user in everyday words');
});

test('on screen: each choice keeps its about line and mark; then your own answer; esc stops (no row for it)', () => {
  const [q] = askedQuestions({ question: 'Which?', options: [{ label: 'A', about: 'the first', recommended: true }, 'B'] });
  expect(permissionOptions({ name: 'Ask', args: q }, '')).toEqual([
    { label: 'A', choice: 'answer', text: 'A', about: 'the first', recommended: true },
    { label: 'B', choice: 'answer', text: 'B', about: '', recommended: false },
    { label: 'Type your own answer…', choice: 'type', about: 'Write it in the box below, then press enter.' },
  ]);
  // The app's own questions name their own "type" row.
  expect(permissionOptions({ name: 'Ask', args: checkInQuestion(['a.mjs'], 30) }, '').map((o) => o.label)).toEqual(['Keep going', 'Tell me where to look…']);
});

test("the app's own questions in plain words: files by name, the Desktop as yours, no tool names", () => {
  expect(fileSaid('Desktop/social-feed-post.html')).toBe('social-feed-post.html on your Desktop');
  expect(fileSaid('src/app/export.mjs')).toBe('export.mjs in src/app');
  expect(fileSaid('export.mjs')).toBe('export.mjs');
  expect(planSaid('Write', { path: 'Desktop/card.html' }, { rel: 'Desktop/card.html', created: true })).toBe('make a new file, card.html on your Desktop');
  expect(planSaid('Write', {}, { rel: 'a.mjs', created: false })).toBe('replace what is in a.mjs');
  expect(planSaid('Edit', {}, { rel: 'a.mjs', additions: 1, removals: 1 })).toBe('change 1 line of a.mjs');
  expect(changesSaid([{ rel: 'a.mjs', additions: 3, removals: 1 }, { rel: 'lib/b.mjs', additions: 0, removals: 2 }])).toBe('change 3 lines of a.mjs and 2 lines of b.mjs in lib');
  expect(lookSaid('Bash', { command: 'ls -la ~/Desktop/ 2>/dev/null | head -20' })).toBe('the output of a command');
  expect(lookSaid('List', { path: 'src' })).toBe('the files in src');
  expect(lookSaid('WebFetch', { url: 'https://example.com/a/b' })).toBe('a web page on example.com');
  const q = checkInQuestion(['the output of a command', 'countdown-card.html on your Desktop'], 6 * 60);
  expect(q.question).toBe('I have spent 6 minutes looking around and have not changed anything yet. I looked at the output of a command and countdown-card.html on your Desktop. Am I on the right track?');
  expect(stuckQuestion('repeat', stepSaid('Read', { path: 'export.mjs' }), '').question).toBe('I tried the same step twice (looking at export.mjs) and I am not getting further. What should I do?');
  // The step it repeated, by name: the command, the file changed (3 Oct: "looking at the output of a command", "looking at Edit").
  expect(stuckQuestion('repeat', stepSaid('Bash', { command: 'npm test' }), '').question).toBe('I tried the same step twice (running npm test) and I am not getting further. What should I do?');
  expect(stepSaid('Edit', { path: 'src/export.mjs' })).toBe('changing export.mjs in src');
  expect(stepSaid('Write', { path: 'notes.txt' })).toBe('writing notes.txt');
  expect(stepSaid('List', { path: 'src' })).toBe('looking at the files in src');
  // The step, then the error's own words.
  expect(stuckQuestion('errors', 'running cat a.txt', 'ENOENT: no such file').question).toBe('Three steps in a row did not work. The last one (running cat a.txt) ended with: ENOENT: no such file. What should I do?');
  expect(stuckQuestion('errors', 'running make', '').question).toBe('Three steps in a row did not work. The last one (running make) gave no error words. What should I do?');
  // A script typed into the command is named by its first line.
  expect(stepSaid('Bash', { command: "python3 - <<'PYEOF'\nimport json\nprint(1)\nPYEOF" })).toBe("running python3 - <<'PYEOF' …");
});

// 4 Oct 2026: a script printed "=== MNQ ===" and its numbers, then a traceback; the question quoted
// "=== MNQ ===", the first line, and asked the same thing again after three more failures.
test("the stuck question quotes the line that says what went wrong", () => {
  const out = ['=== MNQ ===', '  name: MNQ', '  total: 2681', 'Traceback (most recent call last):', '  File "<stdin>", line 279, in <module>', '    html += cards_res.get(r)', "AttributeError: 'str' object has no attribute 'get'", '(exit code 1)'].join('\n');
  expect(errorSaid('Bash', out)).toBe("AttributeError: 'str' object has no attribute 'get' (line 279)");
  expect(errorSaid('Bash', 'src/a.c:3: error: expected ;\nmake: *** [all] Error 1\n(exit code 2)')).toBe('src/a.c:3: error: expected ;');
  // No line reads as an error: the last one, never the app's own exit line.
  expect(errorSaid('Bash', 'building\nhalf way\n(exit code 1)')).toBe('half way');
  expect(errorSaid('Bash', '(exit code 1)')).toBe('');
  // Another tool's result says what went wrong first.
  expect(errorSaid('Edit', 'old_string was not found in a.mjs\nthe nearest lines:\n  error = 1')).toBe('old_string was not found in a.mjs');
});

test("the opening question's answers keep their about lines", () => {
  expect(cleanChoices([{ label: 'Explain it', about: 'I tell you how it works.' }, 'Fix it', { label: 'explain it', about: 'again' }])).toEqual([
    { label: 'Explain it', about: 'I tell you how it works.' }, { label: 'Fix it', about: '' },
  ]);
});

test('the model asks two questions in one call: each is asked with its place, and both answers go back', async () => {
  const cwd = project();
  const call = { tool: { name: 'Ask', args: {
    question: 'What should the footer show?',
    options: [{ label: 'Time left', about: 'A small clock', recommended: true }, { label: 'Messages used', about: 'A count' }],
    more: [{ question: 'Which pages?', options: ['Home', 'Settings', 'Reports'], several: true }],
  } } };
  const fake = await startFakeServer([call, { text: 'Done.' }]);
  const asked = [];
  const answers = ['Time left', 'Home, Reports'];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false,
    ask: async (req) => { asked.push(req.args); return { choice: 'answer', text: answers[asked.length - 1] }; } });
  const shown = [];
  agent.on('tool', (e) => { if (e.name === 'Ask') shown.push(e.view); });
  expect(await agent.send('add usage to the footer')).toBe('done');
  await fake.close();
  expect(asked.map((a) => [a.question, a.step, a.several, a.recommended])).toEqual([
    ['What should the footer show?', { at: 1, of: 2 }, false, 0],
    ['Which pages?', { at: 2, of: 2 }, true, -1],
  ]);
  expect(asked[0].about).toEqual(['A small clock', 'A count']);
  expect(shown.map((v) => v.text)).toEqual(['Time left', 'Home, Reports']);
  const back = fake.requests[1].messages.find((m) => m.role === 'tool')?.content ?? '';
  expect(back).toBe('The user answered:\n1. What should the footer show? → Time left\n2. Which pages? → Home, Reports');
});

test('esc on the second question: the turn stops, and the first answer is kept in what the model reads', async () => {
  const cwd = project();
  const call = { tool: { name: 'Ask', args: { question: 'One?', options: ['a', 'b'], more: [{ question: 'Two?', options: ['c', 'd'] }] } } };
  const fake = await startFakeServer([call, { text: 'OK.' }]);
  let n = 0;
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false,
    ask: async () => (++n === 1 ? { choice: 'answer', text: 'a' } : { choice: 'no', feedback: 'not now' }) });
  await agent.send('do the thing');
  await fake.close();
  const back = fake.requests[1]?.messages.find((m) => m.role === 'tool')?.content ?? '';
  expect(back).toBe('The user did not answer and wrote: not now Their answers before that: One? → a.');
});
