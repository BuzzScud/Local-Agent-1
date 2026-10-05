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
const { CASES_ASK, casesOf, caseProbe, untested, isTestPath, casesFromList, gapCases, reviewWrong, reviewBack, signSample } = await import('../src/agent/cases.mjs');
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
  expect(casesFromList([{ example: '`slugify("A B")`', expect: '"a-b"' }, { example: 'Rename the helper', expect: '-' }, { example: 'slugify("A B")', expect: 'again' }])).toEqual([{ text: '`slugify("A B")` → "a-b"', example: 'slugify("A B")', exact: true }]);
});

// Eight runs (4 Oct 2026) all failed "anything else runs as typed": the list stopped at 20 cases, before the
// ones that must stay as typed (&&, ;, a redirect, $( )), and a test of one file passed for the two-file case.
test('the list has two halves, what changes and what stays; an example is tried only by its own form', () => {
  const list = casesFromList([{ example: "plainRead('cat FILE')", expect: 'Read FILE' }], [{ example: "plainRead('ls && cat notes.txt')", expect: 'null: runs as typed' }, { example: "plainRead('cat FILE')", expect: 'again' }]);
  expect(list.map((c) => c.example)).toEqual(["plainRead('cat FILE')", "plainRead('ls && cat notes.txt')"]);
  expect(list[1].text).toBe("`plainRead('ls && cat notes.txt')` → null: runs as typed");
  // A call with more arguments than the request gives the function is a made-up form: left out.
  const req = 'Export plainRead(command, cwd) from tools.mjs: cat FILE is Read FILE.';
  expect(casesFromList([{ example: "plainRead('cat', ['file.txt'], '/home/user')", expect: 'Read' }, { example: "plainRead('cat a.txt', cwd)", expect: 'Read' }, { example: 'cat notes.txt', expect: 'Read notes.txt' }], [], req).map((c) => c.example)).toEqual(["plainRead('cat a.txt', cwd)", 'cat notes.txt']);
  // A sentence is no example: no test could be found to try it.
  expect(casesFromList([{ example: 'agent.mjs step function output for a mapped plain read.', expect: 'starts with (Run as Read)' }, { example: "step with 'cat FILE' in agent.mjs", expect: 'x' }, { example: 'cat notes.txt > output.txt', expect: 'runs as typed' }, { example: 'cat notes.txt && echo done', expect: 'runs as typed' }]).map((c) => c.example)).toEqual(['cat notes.txt > output.txt', 'cat notes.txt && echo done']);
  const tried = (example, test) => caseProbe(example).test(test);
  // as many words as the example has
  expect(tried("plainRead('cat FILE1 FILE2')", "plainRead('cat notes.txt', cwd)")).toBe(false);
  expect(tried("plainRead('cat FILE1 FILE2')", "plainRead('cat a.txt b.txt', cwd)")).toBe(true);
  expect(tried('cat FILE', "plainRead('cat a.txt b.txt')")).toBe(false);
  expect(tried("plainRead('ls DIR')", "plainRead('ls', cwd)")).toBe(false);
  expect(tried("plainRead('ls DIR')", "plainRead('ls src', cwd)")).toBe(true);
  expect(tried('grep -rn tax', "plainRead('grep -rn tax src', dir)")).toBe(false);
  expect(tried('grep -rn tax', "plainRead('grep -rn tax', dir)")).toBe(true);
  expect(tried('find DIR -name GLOB', `plainRead("find src -name '*.mjs'", cwd)`)).toBe(true);
  expect(tried('find DIR -name GLOB', `plainRead("find src -name '*.mjs' -type f", cwd)`)).toBe(false);
  // a chain, a pipe, a redirect, $( ): each by its own sign
  expect(tried('ls && cat notes.txt', "plainRead('ls && cat x.txt')")).toBe(true);
  expect(tried('ls && cat notes.txt', "plainRead('ls; cat x.txt')")).toBe(false);
  expect(tried('cat a.txt | grep x', "plainRead('cat n.txt | head -1')")).toBe(true);
  expect(tried('cat notes.txt > copy.txt', "plainRead('cat n.txt > out.txt')")).toBe(true);
  expect(tried('cat $(echo notes.txt)', "plainRead('cat a.txt b.txt')")).toBe(false);
  expect(tried('cat $(echo notes.txt)', "plainRead('cat $(echo n.txt)')")).toBe(true);
  expect(tried('head -c 10 FILE', "plainRead('head -n 10 n.txt')")).toBe(false);
});

test('the list asks for both halves, and the cases go with the notes when memory fills', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x;\n' } } },
    { text: JSON.stringify({ cases: [{ example: 'g(3)', expect: '3' }], unchanged: [{ example: 'f(2)', expect: '2, as before' }] }) },
    { text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' }, { text: 'Done.' },
  ]);
  try {
    const a = agentOn(fake.url);
    await a.send('add g, with a --json flag; f must stay as it is');
    const asked = fake.requests.find((r) => JSON.stringify(r.messages ?? '').includes('List what this request specifies'));
    expect(JSON.stringify(asked.messages)).toContain('unchanged: each thing it says must stay as it is');
    expect(results(a).some((t) => t.includes('`g(3)` → 3') && t.includes('`f(2)` → 2, as before'))).toBe(true);
    // What the request spells out and no case uses joins the list: here its --json flag.
    expect(a.turn.cases.map((c) => c.example)).toEqual(['g(3)', 'f(2)', '--json']);
    // Memory fills: the notes carry the cases.
    a.turn.casesDone = false;
    expect(a.restartFrom('I added g in more.mjs; next, the tests for g and f.')).toBe(true);
    const notes = a.messages.find((m) => m.role === 'assistant' && String(m.content).includes('My memory filled up'));
    expect(notes.content).toContain("The request's cases (before I answer, each needs a test that tries its example):");
    expect(notes.content).toContain('1. `g(3)` → 3');
    expect(notes.content).toContain('2. `f(2)` → 2, as before');
    expect(notes.content).toContain('3. `--json` → the request names it and no case above uses it');
  } finally { await fake.close(); }
});

// "; or &&" came back from the list as the ";" alone, twice; "&&" is what every run got wrong.
test('a flag or a sign the request spells out, used by no case, is a case of its own', () => {
  const request = 'Anything else runs as typed: a pipe, a redirect, ; or &&, $( ), a flag the tool has no word for (head -c, grep -i), two files. grep -r, -rn or -nr PATTERN DIR is Search.';
  const listed = casesFromList([{ example: 'grep -r pattern src', expect: 'Search' }, { example: 'grep -rn pattern src', expect: 'Search' }], [{ example: 'cat notes.txt; ls src', expect: 'null' }, { example: 'cat $(echo notes.txt)', expect: 'null' }, { example: 'head -c 10 notes.txt', expect: 'null' }]);
  const gaps = gapCases(request, listed);
  expect(gaps.map((c) => c.example)).toEqual(['-i', '-nr', '&&']);
  const tests = "plainRead('grep -i tax src'); plainRead('grep -nr tax src'); if (a && b) plainRead('cat notes.txt; ls');";
  // a sign counts inside a quoted command, not as the test's own code
  expect(untested(gaps, tests).map((c) => c.example)).toEqual(['&&']);
  expect(untested(gaps, `${tests} plainRead('ls && cat notes.txt')`)).toEqual([]);
  expect(gapCases('add a --json flag to export.mjs', casesFromList([{ example: 'export.mjs --json trades.json', expect: 'JSON' }]))).toEqual([]);
});

// Qwen3.6 on the fixed harness (5 Oct 2026): 4 of 6 twice, the same two parts missing. `cat nonexistent.txt`
// had passed as tried by a test of a file that is there, and tail's "last N lines, with the right offset" had
// come from the list as { name: 'Read', args: ['notes.txt', '-3'] }.
test('a listed example must be in a test as written, and a made-up shape of its result is left to the request', () => {
  const list = casesFromList([{ example: 'tail -n 3 notes.txt', expect: "{ name: 'Read', args: ['notes.txt', '-3'] }" }, { example: 'grep -r "pattern" src', expect: 'Search pattern in src' }], [{ example: 'cat nonexistent.txt', expect: 'null' }]);
  expect(list.map((c) => c.text)).toEqual(['`tail -n 3 notes.txt` → what the request says for this form', '`grep -r "pattern" src` → Search pattern in src', '`cat nonexistent.txt` → null']);
  const tests = `plainRead('cat notes.txt', cwd); plainRead('tail -n 2 notes.txt', cwd); plainRead("grep -r 'pattern'  src", cwd);`;
  expect(untested(list, tests).map((c) => c.example)).toEqual(['tail -n 3 notes.txt', 'cat nonexistent.txt']);
  expect(untested(list, `${tests} assert.equal(plainRead('cat nonexistent.txt', cwd), null); plainRead('tail -n 3 notes.txt', cwd);`)).toEqual([]);
  // A case the model wrote in its own plan keeps the loose match (its FILE and N stand for any).
  expect(untested(casesOf([{ text: '`head -n N FILE` → Read' }]), "plainRead('head -n 5 a.txt', cwd)")).toEqual([]);
});

// With every case tested, runs still missed parts: the model's tests held the same slip as its code. A call
// of its own reads the changed code against each case, and what reads wrong goes back once.
test('case review: the changed code is read against each case; what reads wrong goes back once, to be checked by running it', async () => {
  const fake = await startFakeServer([
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x + 1;\n' } } },
    LIST([{ example: 'f(2)', expect: '2' }, { example: 'g(3)', expect: '3' }]),
    { tool: { name: 'Write', args: { path: 'more.test.mjs', content: "import { f } from './lib.mjs';\nimport { g } from './more.mjs';\nf(2); g(3);\n" } } },
    { text: 'Done: f and g are tested.' },
    { text: JSON.stringify({ reviews: [{ n: 1, gives: 'f returns its argument: 2', ok: true }, { n: 2, says: 'g(3) is 3', gives: 'g returns x + 1: 4, not 3', ok: false }, { n: 9, gives: 'no such case', ok: false }] }) },
    { tool: { name: 'Edit', args: { path: 'more.mjs', old_text: 'x + 1', new_text: 'x' } } },
    { text: 'Fixed: g(3) gave 4; it gives 3 now.' }, { text: 'again' },
  ]);
  try {
    const a = agentOn(fake.url, { hooks: ['cases', 'case-review'] });
    const notes = [];
    a.on('note', (e) => notes.push(e.text));
    await a.send('add g to the project, with tests');
    // The review saw the request, the code it changed (not the test file) and both cases.
    const asked = fake.requests.find((r) => JSON.stringify(r.messages ?? '').includes('follow the code by hand'));
    const body = JSON.stringify(asked.messages);
    expect(body).toContain('--- more.mjs');
    expect(body).toContain('export const g = (x) => x + 1;');
    expect(body).not.toContain('--- more.test.mjs');
    expect(body).toContain('2. `g(3)` → 3');
    // Only the case read as wrong went back, once, as a read that can be wrong.
    const back = autoNotes(a).filter((t) => /A fresh read of your code against the request's cases/.test(t));
    expect(back).toHaveLength(1);
    expect(back[0]).toContain('thinks 1 of the 2 come out wrong');
    expect(back[0]).toContain('1. `g(3)` → 3\n   the request: g(3) is 3\n   as read, the code gives: g returns x + 1: 4, not 3');
    expect(back[0]).not.toContain('`f(2)`');
    expect(notes.some((t) => /Case review: 1 of the 2 cases read as wrong .*sent back once to be checked\. · g\(3\)/.test(t))).toBe(true);
    expect(a.messages.at(-1).content).toBe('Fixed: g(3) gave 4; it gives 3 now.');
    expect(fake.requests.filter((r) => JSON.stringify(r.messages ?? '').includes('follow the code by hand'))).toHaveLength(1);
  } finally { await fake.close(); }
});

test('case review: all read right, or no answer, and the answer stands; off without its hook', async () => {
  const script = (review) => [
    { tool: { name: 'Write', args: { path: 'more.mjs', content: 'export const g = (x) => x;\n' } } },
    LIST([{ example: 'g(3)', expect: '3' }]),
    { tool: { name: 'Write', args: { path: 'more.test.mjs', content: "import { g } from './more.mjs';\ng(3);\n" } } },
    { text: 'Done.' }, ...(review ? [review] : []), { text: 'again' },
  ];
  for (const [review, said, hooks] of [
    [{ text: JSON.stringify({ reviews: [{ n: 1, gives: '3', ok: true }] }) }, /Case review: the code reads right for all 1 cases/, ['cases', 'case-review']],
    [{ text: 'I cannot say.' }, /Case review: no answer came back/, ['cases', 'case-review']],
    [null, null, ['cases']],
  ]) {
    const fake = await startFakeServer(script(review));
    // a folder of its own each time: the file it writes must be new
    const cwd = mkdtempSync(join(tmpdir(), 'agentic-cases-r-'));
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'mini', type: 'module', scripts: { test: 'node --test' } }));
    try {
      const a = agentOn(fake.url, { hooks, cwd, system: systemPrompt({ cwd, git: 'none' }) });
      const notes = [];
      a.on('note', (e) => notes.push(e.text));
      await a.send('add g');
      expect(a.messages.at(-1).content).toBe('Done.');
      expect(autoNotes(a).some((t) => /A fresh read of your code/.test(t))).toBe(false);
      if (said) expect(notes.some((t) => said.test(t))).toBe(true);
      else expect(notes.some((t) => /Case review/.test(t))).toBe(false);
    } finally { await fake.close(); }
  }
  expect(reviewWrong([{ n: 1, gives: 'a', ok: false }, { n: 1, gives: 'again', ok: false }, { n: 2, gives: 'b', ok: true }], [{ example: 'x(1)', text: '`x(1)` → 1' }, { example: 'y(1)', text: '`y(1)` → 1' }])).toEqual([{ example: 'x(1)', text: '`x(1)` → 1', gives: 'a', says: '' }]);
  expect(reviewBack([{ example: 'x(1)', text: '`x(1)` → 1', gives: 'a' }], 2)).toContain('It read the code and did not run it, so it can be wrong');
  // A sign the request spells out, as an example the review can follow.
  expect(signSample('&&', ['cat notes.txt', 'ls src', 'cat a | b'])).toBe('cat notes.txt && ls src');
  expect(signSample('>', ['cat notes.txt'])).toBe('cat notes.txt > out.txt');
  expect(signSample('$(', ['cat notes.txt'])).toBe('cat $(echo notes.txt)');
});
