// Step 3 ("It works"), the round of 2026-09-27: a question changes nothing,
// and a draft that also touches the tests keeps its changes to the source.
// (Check first has its own file: pagecheck.test.mjs.)
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Agent, AUTO } from '../src/agent/agent.mjs';
import { execute, toolSchemas } from '../src/agent/tools.mjs';
import { systemPrompt } from '../src/agent/prompt.mjs';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
import { partsFor, wholeSmallProject, nameScore, nameWords, namesIn } from '../src/flows/explain.mjs';
import { startFakeServer } from './fake-server.mjs';

const model = MODELS[DEFAULT_MODEL];
const TASKS = join(import.meta.dir, '..', '..', 'models', 'evals', 'bench', 'tasks');
const demo = () => { const d = mkdtempSync(join(tmpdir(), 'bonsai-step3-')); cpSync(join(import.meta.dir, '..', 'demo-project'), d, { recursive: true }); return d; };
const copyTask = (name) => { const d = join(mkdtempSync(join(tmpdir(), 'bonsai-step3-')), 'project'); cpSync(join(TASKS, name, 'project'), d, { recursive: true }); return d; };

async function run(cwd, prompt, replies, { flows = true, mode = 'edits', answer = 'yes' } = {}) {
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode, flows, maxTries: 4, confirmPlan: false,
    ask: async (req) => { events.push({ type: 'ask', name: req.name, req }); return { choice: typeof answer === 'function' ? answer(req) : answer }; } });
  for (const t of ['assistant', 'tool', 'note', 'tries-done', 'route']) agent.on(t, (e) => events.push({ type: t, ...e }));
  const reason = await agent.send(prompt);
  await fake.close();
  return { reason, events, agent, fake };
}
const names = (dir) => readdirSync(dir).sort().join(' ');

// ————— A question changes nothing (practice task 25, 2026-09-26) —————

test('a question changes nothing: Write and Edit are turned away, and a command that may write runs in a throwaway copy', async () => {
  const cwd = demo();
  const before = names(cwd);
  const { reason, events, agent } = await run(cwd, "Where is the CSV written, and what does it hold? Don't change any files.", [
    { tool: { name: 'Write', args: { path: 'scratch-notes.txt', content: 'an idea' } } },
    { tool: { name: 'Bash', args: { command: 'mkdir -p .probe && echo hi > .probe/a.txt && ls .probe' } } },
    { tool: { name: 'Bash', args: { command: 'ls' } } },
    { text: 'It is written by export.mjs.' },
  ], { flows: false });
  expect(reason).toBe('done');
  const tools = events.filter((e) => e.type === 'tool');
  // (The first Read is Bonsai's own: a small project's code is put in front of a question.)
  expect(tools.map((e) => `${e.name}:${e.view.kind}${e.error ? ':error' : ''}`)).toEqual(['Read:read', 'Write:denied:error', 'Bash:bash', 'Bash:bash']);
  const results = agent.messages.filter((m) => m.role === 'tool').map((m) => m.content).slice(1);
  expect(results[0]).toBe('This is a question, so no file is changed. Answer it from what you have read. If a change is needed, say which one, and the user can ask for it.');
  // The command ran (its own output is there), but in a copy: the project is as it was.
  expect(results[1]).toStartWith('(This ran in a throwaway copy of the project: a question changes no files.)\na.txt');
  expect(results[2]).not.toContain('throwaway'); // plain reading runs in the project itself
  expect(results[2]).toContain('export.mjs');
  expect(names(cwd)).toBe(before);
  expect(existsSync(join(cwd, '.probe'))).toBe(false);
});

test('a request that asks for a change still changes files', async () => {
  const cwd = demo();
  const { events } = await run(cwd, 'make a notes file with one line in it', [
    { tool: { name: 'Write', args: { path: 'notes.txt', content: 'one line\n' } } },
    { text: 'Done: notes.txt holds one line.' },
    { text: '{"done": true, "missing": "", "parts": []}' },
  ], { flows: false });
  // The file is written in the project itself, and the project's tests run after it, as always.
  expect(events.filter((e) => e.type === 'tool').map((e) => `${e.name}:${e.view.kind}`)).toEqual(['Write:diff', 'Bash:bash']);
  expect(readFileSync(join(cwd, 'notes.txt'), 'utf8')).toBe('one line\n');
});

// ————— Drafts that also touch the tests (practice task 28, 1 run in 5) —————

const SOURCE = `### config.mjs
<<<<<<< OLD
export const DEFAULTS = { locale: 'en-US', decimals: 2 };
=======
export const DEFAULTS = { locale: 'en-US', decimals: 2, symbol: '$' };
>>>>>>> NEW

### format.mjs
<<<<<<< OLD
  return \`\${amount < 0 ? '-' : ''}$\${fixed}\`;
=======
  return \`\${amount < 0 ? '-' : ''}\${o.symbol}\${fixed}\`;
>>>>>>> NEW

### report.mjs
<<<<<<< OLD
  return ['Total in $', ...lines, \`Total: \${formatMoney(total, o)}\`].join('\\n');
=======
  return [\`Total in \${o.symbol}\`, ...lines, \`Total: \${formatMoney(total, o)}\`].join('\\n');
>>>>>>> NEW
`;
const ALSO_A_TEST = `${SOURCE}
### report.test.mjs
<<<<<<< OLD
=======
test('a test the draft wrote on the side', () => { assert.equal(1, 1); });
>>>>>>> NEW
`;
const ONLY_A_TEST = ALSO_A_TEST.slice(ALSO_A_TEST.indexOf('### report.test.mjs'));
const SYMBOL_TEST = "```js\ntest('symbol option reaches the rows and the header', () => {\n  assert.equal(formatMoney(1234.5, { symbol: '€' }), '€1,234.50');\n  assert.equal(buildReport([{ name: 'a', amount: 1 }], { symbol: '€' }), 'Total in €\\na: €1.00\\nTotal: €1.00');\n});\n```";

test('a draft that also touches the tests keeps its changes to the source, so the tests can be compared against drafts', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const task = readFileSync(join(TASKS, '19-multifile-symbol', 'task.txt'), 'utf8').trim();
  const { reason, events, fake } = await run(cwd, task, [{ text: SYMBOL_TEST }, { text: SYMBOL_TEST }, { text: ALSO_A_TEST }, { text: ALSO_A_TEST }, { text: 'Adds a symbol option.' }], { mode: 'ask' });
  expect(reason).toBe('done');
  expect(events.filter((e) => e.type === 'tries-done').map((e) => `${e.label}: ${e.marks.join('')}`)).toEqual(['Writing tests: ✓✓', 'Drafting changes: ✓✓', 'Checked tests against drafts: ✓✓']);
  expect(fake.remaining()).toBe(0);
  // The approved test is the one from the test step; the draft's own test never reaches the project.
  expect(readFileSync(join(cwd, 'report.test.mjs'), 'utf8')).toContain('symbol option reaches the rows and the header');
  expect(readFileSync(join(cwd, 'report.test.mjs'), 'utf8')).not.toContain('on the side');
  const c = spawnSync('/bin/zsh', [join(TASKS, '19-multifile-symbol', 'check.sh')], { cwd, encoding: 'utf8', timeout: 60_000 });
  expect([c.status, c.stdout + c.stderr]).toEqual([0, '']);
}, 30_000);

test('a draft that changes only the tests is still dropped', async () => {
  const cwd = copyTask('19-multifile-symbol');
  const task = readFileSync(join(TASKS, '19-multifile-symbol', 'task.txt'), 'utf8').trim();
  const { reason, events } = await run(cwd, task, [{ text: SYMBOL_TEST }, { text: SYMBOL_TEST }, { text: ONLY_A_TEST }, { text: SOURCE }, { text: SYMBOL_TEST }, { text: SOURCE }, { text: SOURCE }], { mode: 'ask', answer: (req) => (req.name === 'Test' ? 'no' : 'yes') });
  expect(reason).toBe('declined');
  expect(events.find((e) => e.type === 'tries-done' && e.label === 'Drafting changes').marks).toEqual(['✗', '✓']);
  expect(readFileSync(join(cwd, 'config.mjs'), 'utf8')).not.toContain('symbol');
}, 30_000);

// ————— Reading long files —————

function longFiles(pageLines = 900) {
  const cwd = mkdtempSync(join(tmpdir(), 'bonsai-step3-'));
  const page = [];
  for (let i = 1; i <= pageLines; i++) page.push(i === 412 ? '    .hud{position:absolute;z-index:4;pointer-events:none}' : i === 640 ? '    .symbox .ag-menu{z-index:80;width:330px}' : `    .filler-${i}{color:#${String(i).padStart(3, '0')}}`);
  writeFileSync(join(cwd, 'index.html'), `${page.join('\n')}\n`);
  const code = [];
  for (let i = 1; i <= 300; i++) code.push(i === 207 ? 'export function placeMenu(el) { el.style.zIndex = 80; }' : `const filler${i} = ${i};`);
  writeFileSync(join(cwd, 'menu.mjs'), `${code.join('\n')}\n`);
  return cwd;
}

test('Read with find shows the lines around a word or name in a long file, ready to copy into an edit', async () => {
  const cwd = longFiles();
  const r = await execute('Read', { path: 'index.html', find: '.hud' }, {}, { cwd, request: '' });
  expect(r.error).toBeUndefined();
  expect(r.text).toStartWith('".hud" is on 1 line of index.html (901 lines): 412. The lines around them:\n\nindex.html (lines 406-418):\n```\n');
  expect(r.text).toContain('\n    .hud{position:absolute;z-index:4;pointer-events:none}\n');
  expect(r.view).toMatchObject({ kind: 'read', lines: 13, total: 901 });
  // Whatever its case; and a pattern when the plain text is nowhere.
  expect((await execute('Read', { path: 'index.html', find: '.HUD' }, {}, { cwd, request: '' })).text).toContain('(lines 406-418)');
  expect((await execute('Read', { path: 'index.html', find: 'z-index:\\s*(4|80)\\b' }, {}, { cwd, request: '' })).text).toStartWith('"z-index:\\s*(4|80)\\b" is on 2 lines of index.html (901 lines): 412, 640.');
  // Not there: said so, with the way in.
  const none = await execute('Read', { path: 'index.html', find: 'tv-lg' }, {}, { cwd, request: '' });
  expect(none.text).toStartWith('"tv-lg" does not appear in index.html. index.html is 901 lines, too long to show at once');
  // The tool's own description says so, in a few words (the instructions are read at every start).
  const read = toolSchemas().find((t) => t.function.name === 'Read').function;
  expect(read.description).toContain('pass find (a word or name) to see the lines around it');
  expect(Object.keys(read.parameters.properties)).toEqual(['path', 'find', 'offset', 'limit']);
});

test('a long page or stylesheet is not listed in blocks of 60 lines; code still shows its parts', async () => {
  const cwd = longFiles();
  const page = await execute('Read', { path: 'index.html' }, {}, { cwd, request: '' });
  expect(page.text).toBe('index.html is 901 lines, too long to show at once, and it has no functions to list. Read only the part you need: Read again with find (a word or a name, such as an id or a class) to see the lines around it, or with offset (first line) and limit (number of lines).');
  const code = await execute('Read', { path: 'menu.mjs' }, {}, { cwd, request: '' });
  expect(code.text).toContain('Its parts (lines, name):');
  expect(code.text).toContain('placeMenu');
  expect(code.text).toContain('Read again with find (a word or a name) to see the lines around it, or with offset');
});

test('after a Search, reading a long file it matched shows those lines with the lines around them', async () => {
  const cwd = longFiles();
  const r = await execute('Read', { path: 'index.html' }, {}, { cwd, request: '', searches: ['z-index:\\s*80', 'nowhere-in-this-file'] });
  expect(r.text).toContain('Lines matching your search "z-index:\\s*80" (1 in this file):\nindex.html (lines 637-643):');
  expect(r.text).not.toContain('nowhere-in-this-file');
  // The agent hands this message's searches to Read, newest first.
  const { agent, fake } = await run(cwd, 'where is the layer of the menu set?', [
    { tool: { name: 'Search', args: { pattern: 'ag-menu' } } },
    { tool: { name: 'Read', args: { path: 'index.html' } } },
    { text: 'On line 640.' },
  ], { flows: false });
  expect(agent.turn.searches).toEqual(['ag-menu']);
  const result = fake.requests.at(-1).messages.findLast((m) => m.role === 'tool').content;
  expect(result).toContain('Lines matching your search "ag-menu" (1 in this file):\nindex.html (lines 637-643):');
});

test('the same part asked for a second time is pointed back to; a third time it is given again', async () => {
  const read = { tool: { name: 'Read', args: { path: 'export.mjs' } } };
  const { events, agent } = await run(demo(), 'add a --json flag to export.mjs', [read, read, read, { text: 'I will need more detail.' }], { flows: false });
  expect(events.filter((e) => e.type === 'tool' && e.name === 'Read').map((e) => e.view.kind)).toEqual(['read', 'same', 'read']);
  const results = agent.messages.filter((m) => m.role === 'tool').map((m) => m.content);
  expect(results[1]).toContain('You already read this part of export.mjs');
  expect(results[2]).toBe(results[0]);
  // What Bonsai put in front of a question counts as read: asked for, it is pointed back to.
  const asked = await run(demo(), 'what does the export do?', [read, { text: 'It writes a CSV.' }], { flows: false });
  expect(asked.events.filter((e) => e.type === 'tool' && e.name === 'Read').map((e) => e.view.kind)).toEqual(['read', 'same']);
});

// ————— When memory fills: notes first —————

async function filled(replies, opts = {}) {
  const cwd = demo();
  const fake = await startFakeServer(replies);
  const events = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, slots: { main: 0, side: 1 }, ask: async () => ({ choice: 'yes' }), ...opts });
  for (const t of ['note', 'compacted']) agent.on(t, (e) => events.push({ type: t, ...e }));
  await agent.send('fix the bug: the total is wrong when the list is empty');
  const held = agent.messages.length;
  agent.ctxUsed = Math.round(agent.ctx * 0.75); // pretend the server reported a nearly full memory
  await agent.fitContext();
  await fake.close();
  return { agent, fake, events, held };
}
const LOOKS = [
  { tool: { name: 'Read', args: { path: 'export.mjs' } } },
  { tool: { name: 'Search', args: { pattern: 'toCsv' } } },
  { tool: { name: 'Read', args: { path: 'export.test.mjs' } } },
  { text: 'The cause is that toCsv drops the header row when the list is empty.' },
];
const NOTES = 'I read export.mjs and its test. The cause is in toCsv, line 7: the header is dropped for an empty list. Next step: change line 7 of export.mjs.';

test('when memory fills it writes its notes in the conversation it already holds, then carries on from them', async () => {
  const { agent, fake, events, held } = await filled([...LOOKS, { text: NOTES }]);
  // The request for notes goes on the end of the same conversation, in the same slot, with no tool to call.
  const asked = fake.requests.at(-1);
  expect(asked.messages.length).toBe(held + 1);
  expect(asked.messages.at(-1).content).toStartWith(AUTO);
  expect(asked.messages.at(-1).content).toContain('Write your notes now');
  expect(asked).toMatchObject({ id_slot: 0, tool_choice: 'none' });
  expect(asked.messages.slice(0, 2)).toEqual(fake.requests[0].messages.slice(0, 2));
  // Afterwards: the instructions, the request word for word, its notes, and the go-ahead.
  expect(agent.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(agent.messages[1].content).toBe('fix the bug: the total is wrong when the list is empty');
  expect(agent.messages[2].content).toStartWith(`My memory filled up, so I wrote down where I am. My notes (all of them are here; nothing is saved anywhere else):\n${NOTES}`);
  // What it looked at comes from Bonsai's own record, whatever the notes forgot.
  expect(agent.messages[2].content).toContain("From Bonsai's record of this message:\n- Files I have read: export.mjs (from the top), export.test.mjs (from the top).\n- Searches I ran: \"toCsv\".");
  expect(agent.messages[3].content).toContain('Do not start the investigation over');
  expect(events.filter((e) => e.type === 'note').map((e) => e.text)).toEqual(['Memory is filling up: writing down where I am, then carrying on from my notes…']);
  expect(events.find((e) => e.type === 'compacted')).toMatchObject({ summary: NOTES, inPlace: true });
  expect(agent.ctxUsed).toBeLessThan(agent.ctx * 0.3);
});

test('an output the model has not read yet is held back from the notes and follows them, whole', async () => {
  const cwd = demo();
  const long = Array.from({ length: 400 }, (_, i) => `export const value${i} = ${i}; // a line of the long file`).join('\n');
  writeFileSync(join(cwd, 'long.mjs'), `${long}\n`);
  const fake = await startFakeServer([{ tool: { name: 'Read', args: { path: 'export.mjs' } } }, { tool: { name: 'Read', args: { path: 'long.mjs', offset: 1, limit: 200 } } }, { text: NOTES }, { text: 'Done looking.' }]);
  const warmed = [];
  const agent = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, confirmPlan: false, slots: { main: 0, side: 1 }, ask: async () => ({ choice: 'yes' }), rewarm: async () => { warmed.push(agent.messages.length); } });
  // Memory "fills" as the second output arrives: the next step starts with the notes.
  agent.on('tool', (e) => { if (e.arg === 'long.mjs') agent.ctxUsed = Math.round(agent.ctx * 0.75); });
  const fit = agent.fitContext.bind(agent);
  agent.fitContext = async (s) => { const r = await fit(s); agent.ctxUsed = Math.min(agent.ctxUsed, agent.ctx * 0.3); return r; };
  await agent.send('add a --json flag to export.mjs');
  await fake.close();
  const asked = fake.requests.filter((r) => r.stream)[2];
  expect(asked.messages.at(-1).content).toContain('Write your notes now');
  // In the request for notes the long output is a line, not 200 lines…
  expect(asked.messages.at(-2)).toMatchObject({ role: 'tool', content: '(This output is kept for you: it comes back, whole, right after your notes.)' });
  // …and in the conversation that carries on it is there, whole, after the notes.
  const next = fake.requests.filter((r) => r.stream)[3].messages;
  expect(next.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'tool']);
  expect(next[3].content).toContain('The output of your last step follows');
  expect(next[4].tool_calls[0].function.name).toBe('Read');
  expect(next[5].content).toStartWith('long.mjs (lines 1-200 of 400; pass offset to read more):\nexport const value0 = 0;');
  // The instructions come back from their saved reading, once, after the restart.
  expect(warmed).toEqual([6]);
}, 30_000);

test('no usable notes (an empty reply): old tool output is emptied instead, as before', async () => {
  const { agent, events } = await filled([...LOOKS, { text: ' ' }]);
  expect(agent.messages.length).toBeGreaterThan(4);
  expect(agent.messages[1].content).toBe('fix the bug: the total is wrong when the list is empty');
  expect(events.some((e) => e.type === 'compacted')).toBe(false);
  expect(events.filter((e) => e.type === 'note').map((e) => e.text.replace(/about [\d,]+ tokens/, 'about N tokens'))).toEqual(['Memory is filling up: writing down where I am, then carrying on from my notes…', 'Trimmed old tool output to save memory (about N tokens).']);
  expect(agent.messages.some((m) => m.role === 'tool' && m.content.startsWith('[older output removed'))).toBe(true);
});

test('memory: "trim" keeps the way before: no notes are asked for', async () => {
  const { fake, held, agent } = await filled(LOOKS, { memory: 'trim' });
  expect(fake.requests.filter((r) => r.stream).length).toBe(4);
  expect(agent.messages.length).toBe(held);
});

// ————— Explain this code —————

test('names from the project map are matched to a question by their words', () => {
  expect([nameWords('fitContext'), nameWords('to_dict'), nameWords('TOOL_DEFS'), nameWords('HTTPServer')]).toEqual([['fit', 'context'], ['to', 'dict'], ['tool', 'defs'], ['http', 'server']]);
  expect(namesIn('what does `verifyDone` do, and route(), and to_dict and fitContext?')).toEqual(['verifyDone', 'route', 'to_dict', 'fitContext']);
  const score = (name, q) => nameScore(name, q, q.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? []);
  expect(score('paginate', 'What is the default page size of paginate()?')).toBe(10); // written as code
  expect(score('testCommand', 'Where is the test command for a project decided?')).toBe(6); // its words, in a row
  expect(score('DEFAULT_PAGE_SIZE', 'What is the default page size?')).toBe(6);
  expect(score('pageSize', 'what size is a page?')).toBe(4); // its words, somewhere
  expect(score('addTax', 'Which function computes tax?')).toBe(2); // part of it
  // Everyday words are not names: a one-word name counts only when written as code.
  expect(score('check', 'explain how the check in works')).toBe(0);
  expect(score('sorted', 'where are requests sorted?')).toBe(0);
  expect(score('projectFiles', 'list the project files')).toBe(6);
  expect(score('projectFiles', 'which files does the project have?')).toBe(0);
  expect(score('getData', 'how do I get the list?')).toBe(0);
});

test('the four practice questions: the code each is about is found with no model and no search', () => {
  const at = (t) => join(TASKS, t, 'project');
  const q = (t) => readFileSync(join(TASKS, t, 'task.txt'), 'utf8').trim();
  // Two tiny projects: all of their code.
  expect(wholeSmallProject(at('5-question')).map((p) => `${p.rel} 1-${p.to}`)).toEqual(['src/config.mjs 1-5', 'src/server.mjs 1-6']);
  expect(wholeSmallProject(at('7-question-tax')).map((p) => p.rel)).toEqual(['billing.mjs', 'checkout.mjs']);
  // A copy of Bonsai's own source: the one function the question is about, "Don't change any files" left out.
  expect(wholeSmallProject(at('25-bigproject-question'))).toEqual([]);
  const parts = partsFor(at('25-bigproject-question'), q('25-bigproject-question'));
  expect(parts.map((p) => `${p.rel} ${p.name}`)).toEqual(['src/agent/prompt.mjs testCommand']);
  expect(parts[0].text).toStartWith('export function testCommand(cwd) {');
  expect(parts[0].text).toContain('pytest');
});

test('a question is answered from code already in front of the model: one request, no tool call of its own', async () => {
  const cwd = copyTask('25-bigproject-question');
  const before = names(cwd);
  const { reason, events, fake } = await run(cwd, readFileSync(join(TASKS, '25-bigproject-question', 'task.txt'), 'utf8').trim(), [{ text: 'It is decided by testCommand in src/agent/prompt.mjs; for a Python project it returns pytest.' }]);
  expect(reason).toBe('done');
  expect(events.find((e) => e.type === 'route').kind).toBe('question');
  expect(events.filter((e) => e.type === 'tool').map((e) => `${e.label}(${e.arg})`)).toEqual(['List(the project map)', 'Read(src/agent/prompt.mjs)']);
  const asked = fake.requests.filter((r) => r.stream);
  expect(asked.length).toBe(1);
  const read = asked[0].messages.findLast((m) => m.role === 'tool');
  expect(read.content).toMatch(/^src\/agent\/prompt\.mjs \(lines \d+-\d+ of \d+; pass offset to read more\):\nexport function testCommand\(cwd\) \{/);
  expect(names(cwd)).toBe(before);
});

test('a file too long to give whole comes with the lines that match the question', async () => {
  const cwd = longFiles(1400);
  writeFileSync(join(cwd, 'package.json'), '{}');
  const { fake } = await run(cwd, 'In index.html, where is the layer of the hud set?', [{ text: 'On line 412.' }]);
  const read = fake.requests.filter((r) => r.stream).at(-1).messages.findLast((m) => m.role === 'tool');
  expect(read.content).toStartWith('index.html is 1401 lines, too long to show at once');
  expect(read.content).toContain('Lines matching the request');
  expect(read.content).toContain('.hud{position:absolute;z-index:4;pointer-events:none}');
});
