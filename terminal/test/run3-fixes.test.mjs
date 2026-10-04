// The third watched run of 4 Oct 2026 (Qwen3.6 on a service, from the repo): asked to analyze a
// calculator page, outline approaches and ask up to 5 questions, it answered a question of 30 Sep
// that one of Claude's notes quoted (the note was matched on the request's closing words alone, and
// sat after the request), asked nothing, wrote its page into the repo's own Desktop/ folder, sent a
// path to Map and a List of a file. The owner's picks: everything, questions as choices in the window
// (up to 5), new files on the Desktop unless the request says where (asked when unclear), "no, this is
// wrong" asks what is wrong, and Remember at four moments.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-run3-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { desktopDefault } = await import('../src/agent/tools.mjs');
const { topicOf, chasedQuestion, claudeText } = await import('../src/agent/claude-notes.mjs');
const { wantsQuestions, questionLines, askedQuestions, pageWrongQuestion } = await import('../src/agent/questions.mjs');
const { partFor, nearParts } = await import('../src/agent/ladder.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { FakeEmbedder } = await import('./fake-embedder.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const model = MODELS[DEFAULT_MODEL];
const REQUEST = 'can you analyze the link : http://203.0.113.9:60011/index.html . i want you to learn everything you can about the math and formulas. Investigate the codebase and outline the best implementation approach, step-by-step (from the most comprehensive to the simplest). Ask me up to 5 clarifying questions about my specific requirements, user flow constraints, and edge cases to ensure we have a flawless implementation';
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-run3-'));
  writeFileSync(join(dir, 'package.json'), '{"name":"calc"}');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'math.mjs'), 'export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;\n');
  writeFileSync(join(dir, 'src', 'calc.mjs'), 'export const add = (a, b) => a + b;\n');
  writeFileSync(join(dir, 'notes.txt'), 'one\ntwo\n');
});
const agentOn = (url, extra = {}) => new Agent({ url, model, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, way: 'model', hooks: [], ...extra });

test('notes are matched on what a request is about, marked as earlier, and a note\'s question taken for it is caught', () => {
  expect(topicOf(REQUEST)).toBe('can you analyze the link : http://203.0.113.9:60011/index.html . i want you to learn everything you can about the math and formulas.');
  expect(topicOf('Investigate the codebase and outline the best implementation approach.')).toBe('Investigate the codebase and outline the best implementation approach.'); // nothing else: as it was
  const note = 'Asked 30 Sep 2026: "how does agentic coder models update memory?" then "can we improve this?"';
  expect(chasedQuestion('The user wants to know "how does agentic coder models update memory?" based on the notes.', note, REQUEST)).toBe('how does agentic coder models update memory?');
  expect(chasedQuestion('The user wants to know "what formulas does the page use?"', note, REQUEST)).toBe('');
  expect(claudeText([{ id: 'n', name: 'n', type: 'project', part: note }])).toContain('a question or a request a note quotes was asked then, not now, so do not take it up');
});

test('with notes after it, the request comes again at the end; a request for questions gets the Ask note', async () => {
  const notes = mkdtempSync(join(tmpdir(), 'agentic-run3-notes-'));
  writeFileSync(join(notes, 'MEMORY.md'), '# notes\n- [Calculator math](calc-math.md) — the formulas of the calculator page and how they are checked\n');
  writeFileSync(join(notes, 'calc-math.md'), '---\nname: calc-math\ndescription: The math and formulas of the calculator page, how they are checked\nmetadata:\n  type: project\n---\n\nAsked 30 Sep 2026: "how does agentic coder models update memory?" The calculator formulas are checked against the exports.\n');
  const home = mkdtempSync(join(tmpdir(), 'agentic-run3-you-'));
  const fake = await startFakeServer([{ text: 'Here is the outline.' }]);
  try {
    const a = agentOn(fake.url, { memory: { embedder: new FakeEmbedder(), home, save: false, claude: { dir: notes, store: mkdtempSync(join(tmpdir(), 'agentic-run3-store-')) } }, home });
    await a.send(REQUEST);
    const sent = fake.requests.find((r) => r.stream).messages.find((m) => m.role === 'user').content;
    expect(sent).toContain("(From Claude's notes.");
    expect(sent).toContain(`(This message's request, the one to answer; what is above it is background: "${REQUEST.slice(0, 60)}`);
    expect(sent.lastIndexOf("This message's request")).toBeGreaterThan(sent.lastIndexOf('how does agentic coder models update memory'));
    expect(sent).toContain('The request asks for questions. Put them to the user with the Ask tool, never as text');
  } finally { await fake.close(); }
});

test('a note\'s question taken for the request: the next step brings the request back, once', () => {
  const a = agentOn('http://127.0.0.1:9');
  a.claudeSaid = 'From Claude\'s notes. Asked 30 Sep 2026: "how does agentic coder models update memory?"';
  a.turn = { request: REQUEST, task: REQUEST };
  const notes = [];
  a.on('note', (n) => notes.push(n.text));
  const line = a.noteChaseDue('The user wants to know "how does agentic coder models update memory?"');
  expect(line).toStartWith('(The question "how does agentic coder models update memory?" is quoted in Claude\'s notes from an earlier conversation; it is not this request, so leave it. This message\'s request: "can you analyze the link');
  expect(notes[0]).toContain("It took a question from Claude's notes for your request");
  expect(a.noteChaseDue('The user wants to know "how does agentic coder models update memory?"')).toBe('');
});

test('questions asked for go through Ask: up to 5; written as text they go back once; an Ask beside a question in the text is kept', async () => {
  expect(wantsQuestions(REQUEST)).toBe(true);
  expect(wantsQuestions('fix the cart total')).toBe(false);
  expect(questionLines('Outline…\n1. Which formulas matter most?\n2. Who uses the page?\nDone.')).toBe(2);
  expect(askedQuestions({ question: 'a?', more: [{ question: 'b?' }, { question: 'c?' }, { question: 'd?' }, { question: 'e?' }, { question: 'f?' }] }).map((q) => q.question)).toEqual(['a?', 'b?', 'c?', 'd?', 'e?']);
  const five = { question: 'Which formulas first?', options: ['All', 'Pricing'], more: ['Who uses it?', 'Which browsers?', 'Offline too?', 'How exact?'].map((q) => ({ question: q, options: ['Yes', 'No'] })) };
  const fake = await startFakeServer([
    { text: 'Approach A, then B.\n\n1. Which formulas matter most?\n2. Who uses the page?' },
    { text: 'Approach A, then B. Which do you prefer?', tool: { name: 'Ask', args: five } },
    { text: 'Thanks, building A.' },
  ]);
  const asked = [];
  try {
    const a = agentOn(fake.url, { ask: async (req) => { asked.push(req.args?.question); return { choice: 'answer', text: 'All' }; } });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send(REQUEST);
    expect(notes).toContain('It wrote its questions as text; asked it to put them in the picker (Ask).');
    expect(fake.requests[1].messages.at(-1).content).toContain('Put them to the user with the Ask tool now');
    expect(asked).toEqual(['Which formulas first?', 'Who uses it?', 'Which browsers?', 'Offline too?', 'How exact?']);
  } finally { await fake.close(); }
});

test('Map takes a path for a part, and names the nearest parts when none fits', () => {
  const ladder = { parts: ['docs.md', 'terminal.md', 'terminal--src.md', 'terminal--src--agent.md', 'models.md', 'models--evals--battle--new28.md'].map((file) => ({ file })) };
  expect(partFor(ladder, 'docs/map/docs/tools.md')).toBe('docs');
  expect(partFor(ladder, 'terminal/src/agent/tools.mjs')).toBe('terminal--src--agent');
  expect(partFor(ladder, 'docs/map/terminal--src.md')).toBe('terminal--src');
  expect(partFor(ladder, 'nowhere')).toBeNull();
  expect(nearParts(ladder, 'agent tools')).toEqual(['terminal--src--agent', 'docs', 'terminal', 'models']);
});

test('a new file goes to the Desktop unless the request says where; a new code file in a code project is asked about', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-run3-home2-'));
  const at = (p, request = 'make a report', code = true) => desktopDefault(p, { cwd: dir, home, request, code });
  expect(at('report.html')).toEqual({ to: join(home, 'Desktop', 'report.html') });
  expect(at('Desktop/notes.md')).toEqual({ to: join(home, 'Desktop', 'notes.md') });
  expect(at('helper.mjs')).toEqual({ ask: true, name: 'helper.mjs' });
  expect(at('helper.mjs', 'make a helper', false)).toEqual({ to: join(home, 'Desktop', 'helper.mjs') }); // not a code project: the Desktop
  for (const [p, request] of [['src/new.mjs', 'x'], ['README.md', 'x'], ['notes.txt', 'x'], ['report.html', 'save report.html in this folder'], [join(dir, 'abs.html'), 'x'], ['~/x.html', 'x']]) expect(at(p, request)).toBeNull();
});

test('in a conversation: a page lands on the Desktop; a code file asks where, and "this project" keeps it here', async () => {
  const was = process.env.AGENTIC_DESKTOP_DEFAULT;
  process.env.AGENTIC_DESKTOP_DEFAULT = 'on';
  const home = mkdtempSync(join(tmpdir(), 'agentic-run3-home3-'));
  mkdirSync(join(home, 'Desktop'));
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'report.html', content: '<p>the formulas</p>\n' } } },
    { tool: { name: 'Write', args: { path: 'helper.mjs', content: 'export const x = 1;\n' } } },
    { text: 'Done.' },
  ]);
  const asked = [];
  try {
    const a = agentOn(fake.url, { home, ask: async (req) => { asked.push(req.args?.question); return { choice: 'answer', text: req.kind === 'where' ? `This project (x)` : 'yes' }; } });
    await a.send('make a report page and a helper');
    expect(readFileSync(join(home, 'Desktop', 'report.html'), 'utf8')).toBe('<p>the formulas</p>\n');
    expect(existsSync(join(dir, 'report.html'))).toBe(false);
    expect(asked).toContain('Where should helper.mjs go?');
    expect(existsSync(join(dir, 'helper.mjs'))).toBe(true);
  } finally { process.env.AGENTIC_DESKTOP_DEFAULT = was; await fake.close(); }
});

test('"no, this is wrong" about a page asks what is wrong, then sends it back with that and the request', async () => {
  expect(pageWrongQuestion('math.html').options).toEqual(['Not what I asked', 'Parts are missing', 'Wrong place', 'It looks wrong']);
  const fake = await startFakeServer([{ tool: { name: 'Write', args: { path: 'math.html', content: '<p>memory</p>\n' } } }, { text: 'Saved math.html.' }, { text: 'Remade it.' }]);
  const asked = [];
  try {
    const a = agentOn(fake.url, { pageAsk: true, ask: async (req) => { asked.push(req.args?.question); return { choice: 'answer', text: /What is wrong/.test(req.args?.question) ? 'Not what I asked' : 'no this is wrong' }; } });
    await a.send('make a page of the calculator formulas, math.html');
    expect(asked.some((q) => /What is wrong with math\.html\?/.test(q))).toBe(true);
    const back = fake.requests.at(-1).messages.at(-1).content;
    expect(back).toContain('The user answered: no this is wrong');
    expect(back).toContain('What is wrong, in their words: Not what I asked');
    expect(back).toContain('Their request, to hold the page against: "make a page of the calculator formulas, math.html"');
  } finally { await fake.close(); }
});

test('a List of a file reads it; your answers to its questions bring a Remember line', async () => {
  const fake = await startFakeServer([{ tool: { name: 'List', args: { path: 'notes.txt' } } }, { tool: { name: 'Ask', args: { question: 'Which formulas?', options: ['All', 'Some'] } } }, { text: 'ok' }]);
  try {
    const home = mkdtempSync(join(tmpdir(), 'agentic-run3-me-'));
    const a = agentOn(fake.url, { memory: { home, recall: false }, home, ask: async () => ({ choice: 'answer', text: 'All' }) });
    const tools = [];
    a.on('tool', (e) => tools.push(e.name));
    await a.send('what is in notes.txt, and ask me which formulas');
    expect(tools).toContain('Read');
    const results = a.messages.filter((m) => m.role === 'tool' && !m.opening).map((m) => String(m.content));
    expect(results[0]).toContain('one');
    expect(results.find((r) => r.startsWith('The user answered: All'))).toContain('If one of these answers will hold next time too, save it with Remember: one short sentence.');
  } finally { await fake.close(); }
});
