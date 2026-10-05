// The request's cases, each shown by a test (cases.mjs; 4 Oct 2026, after the model shootout: four big models
// tested the forms they had built, said done, and never tried head -N, tail -N, a pipe or two files the request
// listed). Also the Write that would break a file, and notes answered with a tool call.
import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-cases-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { prepare } = await import('../src/agent/tools.mjs');
const { CASES_ASK, casesOf, caseProbe, untested, isTestPath, casesFromList } = await import('../src/agent/cases.mjs');
const { MODEL_HOOKS } = await import('../src/agent/way.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL } = await import('../../models/index.mjs');

const remote = { ...MODELS[DEFAULT_MODEL], remote: { kind: 'openai', label: 'the service', ollama: '0.12.0' } };
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-cases-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mini', type: 'module', scripts: { test: 'node --test' } }));
  writeFileSync(join(dir, 'lib.mjs'), 'export const f = (x) => x;\n');
});
const agentOn = (url, extra = {}) => new Agent({ url, model: remote, cwd: dir, system: systemPrompt({ cwd: dir, git: 'none' }), memory: false, flows: false, verify: true, mode: 'bypass', confirmPlan: false, way: 'model', hooks: ['cases'], thinking: false, ask: async () => ({ choice: 'yes' }), ...extra });
const autoNotes = (a) => a.messages.filter((m) => m.role === 'user' && /^\[Automatic note/.test(String(m.content))).map((m) => String(m.content));
const results = (a) => a.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));

test("a case's example is found in a test however its files and numbers were chosen", () => {
  const plan = [{ text: '`head -4 notes.txt` → Read notes.txt, lines 1 to 4' }, { text: 'Read the request' }, { text: '`cat a.txt | head -1 → runs as typed`' }, { text: '`tail -n 2 notes.txt` gives the last 2 lines' }];
  expect(casesOf(plan).map((c) => c.example)).toEqual(['head -4 notes.txt', 'cat a.txt | head -1', 'tail -n 2 notes.txt']);
  expect(caseProbe('head -4 notes.txt').test("plainRead('head -12 three.txt', dir)")).toBe(true);
  expect(caseProbe('head -4 notes.txt').test("plainRead('head -n 4 three.txt', dir)")).toBe(false);
  expect(caseProbe('cat a.txt | head -1').test("plainRead('cat notes.txt|head -3', dir)")).toBe(true);
  expect(caseProbe('cat a.txt | head -1').test("plainRead('cat notes.txt', dir)")).toBe(false);
  expect(caseProbe('cat notes.txt; ls').test("'cat x.txt;ls'")).toBe(true);
  expect(caseProbe('grep -r "tax" src').test("plainRead('grep -r total lib', dir)")).toBe(true);
  expect(caseProbe('add(2, 3)').test('assert.equal(add(10,20), 30)')).toBe(true);
  const cases = casesOf(plan);
  expect(untested(cases, "plainRead('head -4 n.txt'); plainRead('tail -n 9 n.txt')").map((c) => c.example)).toEqual(['cat a.txt | head -1']);
  for (const p of ['agent.test.mjs', 'test/run.mjs', 'src/cart.spec.ts', 'tests/test_cart.py', 'cart_test.go']) expect(isTestPath(p)).toBe(true);
  for (const p of ['agent.mjs', 'latest.mjs', 'contest/x.mjs']) expect(isTestPath(p)).toBe(false);
  expect(MODEL_HOOKS).toEqual(expect.arrayContaining(['cases', 'done']));
});

// Qwen3.6's own plan in the first run with the check: no backticks, cases after arrows, several on a line,
// and steps of the plan between them. The check found none and never ran.
test('cases written with arrows are read, and plain steps of the plan are not', () => {
  const plan = [
    { text: 'Plan: cat FILE → Read, head -n N/FILE → Read, tail -N → Read with offset, ls DIR → List, piped/multi/special → null/run typed' },
    { text: 'head -n 5 FILE or head -5 FILE → Read FILE, lines 1-5\nUpdate step in agent.mjs → prefix output\npipe/redirect/multi-file/special flag → null (runs as typed)' },
    { text: 'Add plainRead to tools.mjs' },
  ];
  expect(casesOf(plan).map((c) => c.example)).toEqual(['cat FILE', 'head -n N/FILE', 'tail -N', 'ls DIR', 'head -n 5 FILE', 'head -5 FILE']);
  expect(caseProbe('tail -N').test("plainRead('tail -3 x.txt', dir)")).toBe(true);
  expect(caseProbe('slugify("")').test("slugify('')")).toBe(true);
  // More arguments in the test than in the example still tries it.
  expect(caseProbe("plainRead('ls')").test("assert.deepStrictEqual(plainRead('ls', cwd), {})")).toBe(true);
  expect(caseProbe("plainRead('ls')").test("plainRead('cat', cwd)")).toBe(false);
  expect(CASES_ASK).not.toMatch(/head|tail|cat |grep|ls /); // no task's own answer in the ask
});

// Two models of four ignored an ask to write their plan as the cases, twice (4 Oct 2026): the list comes from
// a call of its own, with a fixed form of answer, made with the first change.
const LIST = (cases) => ({ text: JSON.stringify({ cases }) });
test('the first change lists the cases in a call of their own; an untested case goes back, then the answer stands', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x;\n' } } },
    LIST([{ example: 'f(2)', expect: '2' }, { example: 'g(3)', expect: '3' }, { example: 'Adding g', expect: 'a step, not code' }]),
    { tool: { name: 'Write', args: { path: 'more.test.mjs', content: "import { f } from './lib.mjs';\nf(2);\n" } } },
    { text: 'Done: both work.' },
    { tool: { name: 'Edit', args: { path: 'more.test.mjs', old_text: 'f(2);', new_text: "f(2);\nimport('./more.mjs').then((m) => m.g(3));" } } },
    { text: 'Done: f and g are tested.' },
  ]);
  try {
    const a = agentOn(fake.url);
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    await a.send('add g to the project, with tests');
    expect(results(a).some((t) => t.includes("The request's cases, as Agentic Coder lists them") && t.includes('`g(3)` → 3'))).toBe(true);
    expect(results(a).some((t) => t.includes(CASES_ASK))).toBe(false);
    expect(notes.some((t) => /listed by a call of their own: 2,/.test(t))).toBe(true);
    const back = autoNotes(a).filter((t) => /have no test yet/.test(t));
    expect(back).toHaveLength(1);
    expect(back[0]).toContain('`g(3)` → 3');
    expect(back[0]).not.toContain('`f(2)`');
    expect(notes.some((t) => /1 of the 2 cases in its plan have no test yet: sent back \(1 of 2\)/.test(t))).toBe(true);
    expect(a.messages.at(-1).content).toBe('Done: f and g are tested.');
  } finally { await fake.close(); }
});

test('twice back with cases still untested, then the answer stands with a line naming them', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'TodoWrite', args: { todos: [{ text: '`g(3)` → 3', status: 'pending' }] } } },
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x;\n' } } },
    LIST([]),
    { text: 'Done.' }, { text: 'Done, really.' }, { text: 'It works.' }, { text: 'It works.' },
  ]);
  try {
    const a = agentOn(fake.url);
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    await a.send('add g');
    expect(autoNotes(a).filter((t) => /have no test yet/.test(t))).toHaveLength(2);
    expect(notes.some((t) => /Untested cases from its plan: g\(3\)/.test(t))).toBe(true);
    expect(results(a).some((t) => t.includes(CASES_ASK))).toBe(false); // its plan had cases before the change
  } finally { await fake.close(); }
});

test('no case check on this Mac, or in a project with no tests', async () => {
  const fake = await startFakeServer([{ tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = 1;\n' } } }, { text: 'Done.' }]);
  try {
    const a = agentOn(fake.url, { model: MODELS[DEFAULT_MODEL] });
    await a.send('add g');
    expect(results(a).some((t) => t.includes(CASES_ASK))).toBe(false);
  } finally { await fake.close(); }
  const bare = mkdtempSync(join(tmpdir(), 'agentic-cases-bare-'));
  const fake2 = await startFakeServer([{ tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = 1;\n' } } }, { text: 'Done.' }]);
  try {
    const b = agentOn(fake2.url, { cwd: bare, system: systemPrompt({ cwd: bare, git: 'none' }) });
    await b.send('add g');
    expect(results(b).some((t) => t.includes(CASES_ASK))).toBe(false);
  } finally { await fake2.close(); }
});

// gpt-oss replaced tools.mjs whole with text that did not parse; the run ended on it.
test('a Write that would break a file which parsed is refused; a new broken file is still written', () => {
  const env = { cwd: dir, rulesSet: 'remote', rewrite: () => true };
  const r = prepare('Write', { path: 'lib.mjs', content: 'export const f = (x => x;\n' }, env);
  expect(r.error).toMatch(/That Write would break lib\.mjs: .*Nothing was changed/);
  expect(readFileSync(join(dir, 'lib.mjs'), 'utf8')).toBe('export const f = (x) => x;\n');
  expect(prepare('Write', { path: 'lib.mjs', content: 'export const f = (x) => x + 1;\n' }, env).error).toBeUndefined();
  expect(prepare('Write', { path: 'draft.mjs', content: 'export const g = (;\n' }, env).error).toBeUndefined();
});

test('notes answered with a tool call are asked for again with no tools', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Read', args: { path: 'lib.mjs' } } },
    { text: 'Notes: g is added in more.mjs; its test is in more.test.mjs; next, run the tests and check tail.' },
  ]);
  try {
    const a = agentOn(fake.url, { thinking: true });
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    a.messages.push({ role: 'user', content: 'add g' }, { role: 'assistant', content: 'Reading.' }, { role: 'tool', content: 'x'.repeat(200), tool_call_id: 'c' }, { role: 'assistant', content: 'Next.' });
    expect(await a.notesInPlace()).toBe(true);
    expect(notes.some((t) => /answered the notes request with a tool call: asked again with no tools/.test(t))).toBe(true);
    const reqs = fake.requests.filter((r) => r.messages);
    expect(reqs.at(-1).tools ?? []).toEqual([]);
  } finally { await fake.close(); }
});

test('cases stay when the plan is written again without them (memory filled and it started over)', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'TodoWrite', args: { todos: [{ text: '`f(2)` → 2', status: 'pending' }, { text: '`g(3)` → 3', status: 'pending' }] } } },
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x;\n' } } },
    LIST([]),
    { tool: { name: 'TodoWrite', args: { todos: [{ text: 'Fix the parser', status: 'in_progress' }, { text: 'Run the tests', status: 'pending' }] } } },
    { tool: { name: 'Write', args: { path: 'more.test.mjs', content: "f(2);\n" } } },
    { text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' },
  ]);
  try {
    const a = agentOn(fake.url);
    await a.send('add g');
    const back = autoNotes(a).filter((t) => /have no test yet/.test(t));
    expect(back.length).toBeGreaterThan(0);
    expect(back[0]).toContain('`g(3)` → 3');
  } finally { await fake.close(); }
});

test('no list from its own call: the model is asked to write the cases, and its plan is held to them', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x;\n' } } },
    { text: 'I cannot list them.' },
    { tool: { name: 'TodoWrite', args: { todos: [{ text: '`g(3)` → 3', status: 'pending' }] } } },
    { text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' },
  ]);
  try {
    const a = agentOn(fake.url);
    await a.send('add g');
    expect(results(a).some((t) => t.includes(CASES_ASK))).toBe(true);
    expect(autoNotes(a).filter((t) => /have no test yet/.test(t))[0]).toContain('`g(3)` → 3');
  } finally { await fake.close(); }
  expect(casesFromList([{ example: '`slugify("A B")`', expect: '"a-b"' }, { example: 'Rename the helper', expect: '-' }, { example: 'slugify("A B")', expect: 'again' }])).toEqual([{ text: '`slugify("A B")` → "a-b"', example: 'slugify("A B")' }]);
});
