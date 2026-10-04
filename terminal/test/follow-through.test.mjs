// Follow-through (4 Oct 2026, the owner's picks after a Qwen3.6 run on a service): asked to test the formulas
// from a calculator's page, it met a login and tested something else without asking, typed a file's name
// wrong, read only the outline of the report page and said it had found the math, never wrote a plan, and
// answered "All 24 formulas passed" after a run that printed "22 passed, 2 failed". These hold each part:
// outlines for pages and data, the closest name in the folder named, walls that make it ask, the answer
// against its last check run, read before claiming, a plan for several asks, the folder named from the
// home folder, and the second look at the answer.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-follow-home-'));
process.env.AGENTIC_MEMORY_SAVE = 'off';
const { Agent, claimsAllGood, claimsFound, severalAsks, fullPathsIn } = await import('../src/agent/agent.mjs');
const { execute, wallOf, settlePath } = await import('../src/agent/tools.mjs');
const { outlineText, docParts, jsonShape } = await import('../src/tools/outline.mjs');
const { nearPath, nearNames } = await import('../src/tools/fs.mjs');
const { readResults } = await import('../src/flows/results.mjs');
const { foldersNamed } = await import('../src/agent/projects.mjs');
const { HOOKS, MODEL_HOOKS } = await import('../src/agent/way.mjs');
const { secondLook, ownSteps, lookFacts, lookText, LOOK_SYSTEM } = await import('../src/agent/second-look.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { startFakeServer } = await import('./fake-server.mjs');
const { MODELS, DEFAULT_MODEL, setEndpoint, dropEndpoint } = await import('../../models/index.mjs');

const local = MODELS[DEFAULT_MODEL];
const remote = { ...local, remote: { model: 'big-coder' } };
const REPORT = 'forecast-exports-report-2026-10-03.html';
// The run's folder, small: the report page (long, with its sections), a plan page, an export.
function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-follow-'));
  const work = join(dir, 'forecast export work 3OCT');
  mkdirSync(join(work, 'equity-orbit-export-2026-10-03-0118'), { recursive: true });
  const sections = ['verdict', 'scores', 'horizon', 'bands'].map((id, i) => `<section id="${id}">\n<h2>Part ${i + 1}</h2>\n${'<p>words</p>\n'.repeat(40)}<h3>The math</h3>\n<p>z = (r - median) / (1.4826 * MAD)</p>\n</section>`).join('\n');
  writeFileSync(join(work, REPORT), `<!doctype html>\n<html><head><title>r</title>\n<style>\nbody{}\n</style>\n</head>\n<body>\n<h1>Three forecast exports, measured</h1>\n${sections}\n</body></html>\n`);
  writeFileSync(join(work, 'forecaster-4-build-plan-2026-10-03.html'), '<p>plan</p>\n');
  writeFileSync(join(work, 'equity-orbit-export-2026-10-03-0118', 'projections.csv'), `id,ticker,close\n${Array.from({ length: 200 }, (_, i) => `${i},NQZ2026,${29000 + i}`).join('\n')}\n`);
  return { dir, work };
}

test('a long page, table or JSON file comes back with its parts: headings and sections, the header row, the keys', () => {
  const { work } = folder();
  const page = require('node:fs').readFileSync(join(work, REPORT), 'utf8');
  const o = outlineText(page, REPORT);
  expect(o).toContain('#verdict · h2 Part 1');
  expect(o).toContain('h3 The math');
  expect(o).toContain('styles (<style>)');
  expect(o).not.toContain('no functions to list');
  const csv = outlineText(require('node:fs').readFileSync(join(work, 'equity-orbit-export-2026-10-03-0118', 'projections.csv'), 'utf8'), 'projections.csv');
  expect(csv).toContain('header, 3 columns: id, ticker, close');
  expect(csv).toContain('200 rows; the first: 0,NQZ2026,29000');
  const json = JSON.stringify({ v: 1, projections: Array.from({ length: 12 }, (_, i) => ({ id: i, close: 29000 })) }).replace('[', '[\n').replaceAll('},{', '},\n{');
  expect(jsonShape(json)).toBe('It holds v: 1; projections: a list of 12, each with id, close (the first at line 2, one a line).');
  expect(docParts('<p>one</p>', 'x.html')).toEqual([]); // fewer than two: blocks of 60 lines as before
  expect(docParts('# A\ntext\n```\n# not a heading\n```\n## B\n', 'n.md').map((p) => p.name)).toEqual(['# A', '## B']);
});

test('Read counts the parts it lists: never -1', async () => {
  const { dir } = folder();
  const r = await execute('Read', { path: `forecast export work 3OCT/${REPORT}` }, {}, { cwd: dir, request: 'what is in it' });
  expect(r.view.outline).toBe(true);
  expect(r.view.parts).toBeGreaterThan(5);
  const flat = await execute('Read', { path: 'big.txt' }, {}, { cwd: (() => { const d = mkdtempSync(join(tmpdir(), 'agentic-flat-')); writeFileSync(join(d, 'big.txt'), 'x\n'.repeat(900)); return d; })(), request: 'q' });
  expect(flat.view.parts).toBe(0);
});

test('a name typed a little wrong is set right from its own folder, from the home folder too', async () => {
  const { dir, work } = folder();
  const typo = join(work, 'forecast-export-exports-report-2026-10-03.html');
  expect(nearPath(typo)).toEqual({ fixed: join(work, REPORT), picks: [join(work, REPORT)] });
  expect(nearPath(join(dir, 'forecast exports work 3OCT', REPORT)).fixed).toBe(join(work, REPORT)); // a folder's name too
  expect(nearPath(join(work, 'totally-other.html'))).toEqual({ fixed: null, picks: [] });
  expect(nearNames(work, 'forecaster-4-build-plan.html').map((n) => n.name)).toEqual(['forecaster-4-build-plan-2026-10-03.html']); // the date left off
  // From the "home folder" (cwd = the folder above everything): the walk of didYouMean is off, the folder's own look is not.
  const s = await execute('Search', { pattern: '1.4826', path: typo }, {}, { cwd: dir, request: 'x' });
  expect(s.error).toBeFalsy();
  expect(s.text).toContain(`does not exist; this is ${join(work, REPORT)}, the closest name in its folder`);
  expect(s.view.count).toBe(4);
  const l = await execute('List', { path: 'forecast exports work 3OCT' }, {}, { cwd: dir, request: 'x' });
  expect(l.text).toContain('(forecast exports work 3OCT does not exist; this is forecast export work 3OCT, the closest name in its folder)');
  expect(settlePath(dir, 'forecast export work 3OCT/nothing-like-it.md')).toEqual({ picks: [] });
});

test('a page that needs a login, or an address or path the user gave that is not there, is a wall: the result says to ask', async () => {
  const req = 'analyze the link http://calc.test/index.html . can we use the calculator';
  expect(wallOf({ status: 401, text: '{"ok":false,"message":"Missing bearer token"}' }, 'http://calc.test/api/formulas', req)).toMatchObject({ kind: 'login' });
  expect(wallOf({ status: 200, url: 'http://calc.test/api/formulas', type: 'application/json', text: '{"error":"Login required"}' }, 'http://calc.test/api/formulas', req)).toMatchObject({ kind: 'login' });
  // A dashboard whose menu says "Sign in" is not a wall (the replay's first run, 4 Oct 2026); a page titled "Sign in" is.
  expect(wallOf({ status: 200, url: 'http://calc.test/index.html', type: 'text/html', title: 'Thesis dashboard', text: 'Thesis dashboard # Run calculations. Sign in to save. Log in' }, 'http://calc.test/index.html', req)).toBeNull();
  expect(wallOf({ status: 200, url: 'http://calc.test/app', type: 'text/html', title: 'Sign in · Thesis', text: 'Email Password' }, 'http://calc.test/app', req)).toMatchObject({ kind: 'login' });
  expect(wallOf({ status: 200, url: 'http://calc.test/login.html', text: 'a long page' }, 'http://calc.test/api/formulas', req)).toMatchObject({ kind: 'login' });
  expect(wallOf({ status: 200, url: 'http://calc.test/signup.html', text: 'Sign up' }, 'http://calc.test/signup.html', req)).toBeNull(); // the sign-up page itself
  expect(wallOf({ status: 200, url: 'http://calc.test/caps', text: '{"functions":["sin"]}' }, 'http://calc.test/caps', req)).toBeNull();
  expect(wallOf({ status: 404, text: 'no' }, 'http://calc.test/index.html', req)).toMatchObject({ kind: 'broken' });
  expect(wallOf({ status: 404, text: 'no' }, 'http://other.test/x', req)).toBeNull(); // not one the user gave
  const { dir } = folder();
  const r = await execute('Read', { path: 'notes-from-friday.md' }, {}, { cwd: dir, request: 'summarize notes-from-friday.md' });
  expect(r.wall).toMatchObject({ kind: 'missing' });
  expect(r.text).toContain('ask how to go on, with Ask');
  const off = await execute('Read', { path: 'notes-from-friday.md' }, {}, { cwd: dir, request: 'summarize notes-from-friday.md', blocked: false });
  expect(off.wall).toBeUndefined();
});

test('the words of the run: what claims all good, what claims it found it, several asks, a script\'s own count', () => {
  expect(claimsAllGood('Yes — the calculator works and validated every formula in your forecast-export reports.')).toBe(true);
  expect(claimsAllGood('All 24 formulas passed.')).toBe(true);
  expect(claimsAllGood('Excellent — 22 of 24 passed! Two failed: phi and the Wilson range.')).toBe(false);
  expect(claimsFound('Good — I found the math. The report page has all the formulas built right into it.')).toBe(true);
  expect(claimsFound('Let me look for the formulas.')).toBe(false);
  expect(severalAsks("analyze the link http://x/index.html . can we use the calculator to validate our math in this folder? can you check? '/Users/me/work' can you take all of the formulas from the link and test them all locally?")).toBe(true);
  expect(severalAsks('fix the bug in stats.mjs')).toBe(false);
  expect(readResults('Results: 22 passed, 2 failed out of 24', 1)).toMatchObject({ passed: 22, failed: 2 });
  expect(readResults('22/24 passed', 1)).toMatchObject({ passed: 22, failed: 2 });
  expect(fullPathsIn('Here: /Users/me/Desktop/agent docs/work/report-2026.html with all of it.', '/Users/me/Desktop/agent docs/work', '/Users/me')).toEqual(['/Users/me/Desktop/agent docs/work/report-2026.html']);
});

test('the five checks are hooks, on for both ways, and in /hooks', () => {
  for (const id of ['blocked', 'results', 'read-first', 'to-do', 'second-look']) {
    expect(HOOKS.some((h) => h.id === id)).toBe(true);
    expect(MODEL_HOOKS).toContain(id);
  }
});

// A whole conversation on a stand-in model. route answers the second look.
async function talk(replies, request, { model = remote, endpoint = null, look = null, ...extra } = {}) {
  const fake = await startFakeServer(replies, { delayMs: 0, route: (j) => (j.messages?.[0]?.content === LOOK_SYSTEM ? { text: JSON.stringify(look ?? { verdict: 'ok', problems: [] }) } : null) });
  if (endpoint) setEndpoint(fake.url, { remote: true, model: 'big-coder', label: 'svc', ...endpoint });
  try {
    const { dir, work } = folder();
    const cwd = extra.cwd ?? work;
    const a = new Agent({ url: fake.url, model, cwd, system: systemPrompt({ cwd, git: 'none' }), memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, thinking: false, way: 'model', web: { fetch: true }, ...extra });
    const notes = [];
    a.on('note', (n) => notes.push(n.text));
    await a.send(request);
    const sent = a.messages.filter((m) => m.role === 'user').map((m) => String(m.content));
    const results = a.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
    return { a, notes, sent, results, dir, work, looks: fake.requests.filter((j) => j.messages?.[0]?.content === LOOK_SYSTEM) };
  } finally { fake.close(); if (endpoint) dropEndpoint(fake.url); }
}
const RUN = { tool: { name: 'Bash', args: { command: "printf 'Results: 22 passed, 2 failed out of 24\\n'; exit 1" } } };

test('Answer matches results: "all passed" after a failing run goes back once with the run\'s own line; again, a line says so', async () => {
  const r = await talk([RUN, { text: 'All 24 formulas passed.' }, { text: '22 of 24 passed; phi and the Wilson range failed.' }], 'test the formulas', { hooks: ['results'] });
  const back = r.sent.find((s) => s.includes('your last run of the checks did not'));
  expect(back).toContain('printed "Results: 22 passed, 2 failed out of 24" and ended with exit code 1');
  expect(r.notes.some((n) => n.startsWith('Its answer says everything passed, but its last check run did not'))).toBe(true);
  const again = await talk([RUN, { text: 'All 24 formulas passed.' }, { text: 'Every formula passed.' }], 'test the formulas', { hooks: ['results'] });
  expect(again.sent.filter((s) => s.includes('your last run of the checks did not'))).toHaveLength(1);
  expect(again.notes.at(-1)).toBe('Check this answer: its last check run did not pass (Results: 22 passed, 2 failed out of 24).');
  // A run that passed, or the check off: nothing.
  const fine = await talk([{ tool: { name: 'Bash', args: { command: "printf '24 passed, 0 failed\\n'" } } }, { text: 'All 24 passed.' }], 'test the formulas', { hooks: ['results'] });
  expect(fine.sent.some((s) => s.includes('your last run of the checks did not'))).toBe(false);
  const off = await talk([RUN, { text: 'All 24 formulas passed.' }], 'test the formulas', { hooks: [] });
  expect(off.sent.some((s) => s.includes('your last run of the checks did not'))).toBe(false);
}, 30_000);

test('Stop when blocked: a missing path the user named is told at once, reminded two steps later, and an answer that leaves it out goes back', async () => {
  const list = { tool: { name: 'List', args: { path: '.' } } };
  const r = await talk([{ tool: { name: 'Read', args: { path: 'notes-from-friday.md' } } }, list, list, { text: 'Here is the summary of the folder.' }, { text: 'notes-from-friday.md is not there. Where is it?' }], 'summarize notes-from-friday.md', { hooks: ['blocked'] });
  const at = r.results.findIndex((x) => x.includes('(Blocked: notes-from-friday.md, which the user named, is not there.'));
  expect(at).toBeGreaterThanOrEqual(0);
  expect(r.results[at + 2]).toContain('(You have not asked the user yet: notes-from-friday.md, which the user named, is not there. Ask now, with Ask');
  expect(r.results.filter((x) => x.includes('You have not asked the user yet'))).toHaveLength(1);
  expect(r.sent.some((s) => s.includes('Your answer leaves out what blocked you'))).toBe(true);
  expect(r.notes).toContain('Blocked: notes-from-friday.md, which the user named, is not there. Told it to ask you rather than do something else.');
}, 30_000);

test('a login wall on a page: the result says to ask; a question to you ends the message', async () => {
  const site = Bun.serve({ port: 0, fetch: (req) => (new URL(req.url).pathname === '/api/formulas' ? new Response('{"ok":false,"message":"Missing bearer token"}', { status: 401 }) : new Response('<p>calculator</p>', { headers: { 'content-type': 'text/html' } })) });
  try {
    const base = `http://127.0.0.1:${site.port}`;
    const r = await talk([{ tool: { name: 'WebFetch', args: { url: `${base}/api/formulas` } } }, { text: 'The formula list needs a login. Do you have one, or should I test the formulas in your folder instead?' }], `analyze the link ${base}/index.html . can we use the calculator to check our math?`, { hooks: ['blocked'] });
    expect(r.results.some((x) => x.includes('answered 401: it needs a login or is not open to this app. Do not do a different task instead.'))).toBe(true);
    expect(r.a.turn.walls).toHaveLength(1);
    expect(r.sent.some((s) => s.includes('Your answer leaves out what blocked you'))).toBe(false);
  } finally { site.stop(true); }
}, 30_000);

test('Read before claiming: "I found it" after only an outline is told to read the part, on the next step and at the end', async () => {
  const outline = { tool: { name: 'Read', args: { path: REPORT } } };
  const mid = await talk([outline, { text: 'Good — I found the math.', tool: { name: 'List', args: { path: '.' } } }, { text: 'The math is z = (r - median) / (1.4826 * MAD).' }], 'tell me what it holds', { hooks: ['read-first'] });
  expect(mid.results.some((x) => x.startsWith('Listed') || x.includes(`(You wrote that you found or have what you need, but of ${REPORT} you have seen only the outline`))).toBe(true);
  expect(mid.results.filter((x) => x.includes(`but of ${REPORT} you have seen only the outline`))).toHaveLength(1);
  const end = await talk([outline, { text: 'I have all the formulas: they are in the report.' }, { tool: { name: 'Read', args: { path: REPORT, offset: 40, limit: 20 } } }, { text: 'The robust score is z = (r - median) / (1.4826 * MAD).' }], 'tell me what it holds', { hooks: ['read-first'] });
  expect(end.sent.some((s) => s.includes('you have seen only the outline: its parts and line numbers, none of its text. Read the part you need'))).toBe(true);
  // The request's words found lines of the file: it saw text, so no line.
  const seen = await talk([outline, { text: 'I found the math.' }], 'what is the math?', { hooks: ['read-first'] });
  expect(seen.sent.some((s) => s.includes('you have seen only the outline'))).toBe(false);
}, 30_000);

test('Plan for several asks: no TodoWrite by the third step, and the line asks for one; one ask, or a plan written, no line', async () => {
  const list = { tool: { name: 'List', args: { path: '.' } } };
  const asks = 'can we use the calculator to check our math? can you check? can you test them all?';
  const r = await talk([list, list, list, list, { text: 'Done.' }], asks, { hooks: ['to-do'] });
  expect(r.results.filter((x) => x.includes('(Your request has several asks. Write your plan now with TodoWrite'))).toHaveLength(1);
  expect(r.notes).toContain('Several asks and no plan yet: asked it to write one.');
  const one = await talk([list, list, list, list, { text: 'Done.' }], 'list this folder', { hooks: ['to-do'] });
  expect(one.results.some((x) => x.includes('several asks'))).toBe(false);
  const planned = await talk([{ tool: { name: 'TodoWrite', args: { todos: [{ content: 'Check', status: 'in_progress' }] } } }, list, list, list, { text: 'Done.' }], asks, { hooks: ['to-do'] });
  expect(planned.results.some((x) => x.includes('several asks'))).toBe(false);
}, 30_000);

test('the folder a request names, from the home folder: offered, and the checks use it when you stay', async () => {
  const { dir, work } = folder();
  expect(foldersNamed(`check '${work}' please`, dir, dir)).toEqual([work]);
  expect(foldersNamed(`and ${work}/${REPORT}`, dir, dir)).toEqual([]); // a path with spaces, unquoted: its first word is no folder
  expect(foldersNamed(`'${work}/${REPORT}'`, dir, dir)).toEqual([work]); // a named file gives its folder
  expect(foldersNamed(`look at '${dir}'`, dir, dir)).toEqual([]); // the home folder itself, never
  // The agent from the "home folder": the question, and No keeps it there with the folder as turn.workFolder.
  const fake = await startFakeServer([{ text: 'Looked.' }], { delayMs: 0 });
  try {
    const a = new Agent({ url: fake.url, model: remote, cwd: dir, home: dir, system: 'x', memory: false, flows: false, verify: false, mode: 'bypass', confirmPlan: false, thinking: false, way: 'model', hooks: [] });
    const asked = [];
    a.ask = async (req) => { asked.push(req.args); return { choice: 'answer', text: req.args.options[0] }; };
    a.projects = [];
    await a.send(`can we check the math in '${work}'?`);
    expect(asked[0]?.question).toMatch(/^Work in .*forecast export work 3OCT\? Agentic Coder then starts there: commands can only change files there, until \/clear\.$/);
    expect(a.cwd).toBe(dir);
    expect(a.turn.workFolder).toBe(work);
  } finally { fake.close(); }
}, 30_000);

test('the second look sees the request, its own calls and the app\'s facts, never a page\'s or a command\'s output', async () => {
  const turn = { checks: [{ cmd: 'python3 /tmp/test_formulas3.py', code: 1, failed: true, counts: 'Results: 22 passed, 2 failed out of 24' }], walls: [{ why: 'http://calc.test/api/formulas answered 401' }], errors: ['Search: Path not found: x.html.'], outlined: new Set(['/Users/me/w/report.html']), created: [], changed: false, wroteByCommand: true };
  const facts = lookFacts(turn, { home: '/Users/me' });
  expect(facts).toEqual([
    'A run of checks: python3 /tmp/test_formulas3.py → FAILED ("Results: 22 passed, 2 failed out of 24"), exit code 1.',
    'Blocked: http://calc.test/api/formulas answered 401. It did not ask the user.',
    'An error: Search: Path not found: x.html.',
    'Seen only as an outline (none of its text): ~/w/report.html.',
  ]);
  const steps = ownSteps([{ role: 'assistant', tool_calls: [{ function: { name: 'Bash', arguments: JSON.stringify({ command: `cat > t.py <<'EOF'\nr = calc("7500 + 293")\nEOF\npython3 t.py` }) } }, { function: { name: 'WebFetch', arguments: '{"url":"http://calc.test/api/formulas"}' } }] }]);
  expect(steps[0]).toContain('7500 + 293');
  expect(steps[1]).toBe('WebFetch http://calc.test/api/formulas');
  let asked = null;
  const r = await secondLook({ request: 'test the formulas', steps, facts, answer: 'All 24 formulas passed.', ask: async (q) => { asked = q; return { json: { verdict: 'wrong', problems: ['It says all 24 passed; the run printed 22 passed, 2 failed.'] } }; } });
  expect(r).toMatchObject({ ok: false, problems: ['It says all 24 passed; the run printed 22 passed, 2 failed.'] });
  expect(asked.system).toBe(LOOK_SYSTEM);
  expect(asked.user).toContain('What the app recorded:\n- A run of checks');
  expect(asked.user).toContain('Its answer:\nAll 24 formulas passed.');
  expect(await secondLook({ ask: async () => ({ json: { verdict: 'wrong', problems: [] } }) })).toMatchObject({ failed: true });
  expect(lookText(['A.', 'B.'])).toBe('A second look at your answer against what happened in this message (it can be wrong):\n- A.\n- B.\nAnswer again: fix what is real and keep what is right. If work is missing, do it first.');
});

test('the second look in a conversation: after real work, once a message, on the other Mac\'s second lane; a plain question gets none', async () => {
  const was = process.env.AGENTIC_SECOND_LOOK;
  process.env.AGENTIC_SECOND_LOOK = 'on';
  try {
    const wrong = await talk([RUN, { text: 'Two of 24 failed.' }, { text: 'Two of 24 failed: phi and Wilson. I said so.' }], 'test the formulas', { hooks: ['second-look'], endpoint: { kind: 'llama' }, slots: { main: 0, side: 1 }, look: { verdict: 'wrong', problems: ['It does not say which two failed.'] } });
    expect(wrong.looks).toHaveLength(1);
    expect(wrong.looks[0].id_slot).toBe(1);
    expect(wrong.looks[0].messages[1].content).toContain('A run of checks:');
    expect(wrong.looks[0].messages[1].content).not.toContain('Results: 22 passed, 2 failed out of 24\n'); // the run's output itself is not sent, only its count line
    expect(wrong.sent.some((s) => s.startsWith('A second look at your answer') || s.includes('A second look at your answer against what happened'))).toBe(true);
    expect(wrong.notes.some((n) => /^Second look: It does not say which two failed\. Sent it back \([\d.]+ s\)\.$/.test(n))).toBe(true);
    const ok = await talk([RUN, { text: 'Two of 24 failed: phi and Wilson.' }], 'test the formulas', { hooks: ['second-look'], endpoint: { kind: 'llama' }, slots: { main: 0, side: 1 } });
    expect(ok.notes.some((n) => /^Second look: the answer holds \([\d.]+ s\)\.$/.test(n))).toBe(true);
    const plain = await talk([{ text: 'It holds four parts.' }], 'what is in the report?', { hooks: ['second-look'], endpoint: { kind: 'llama' }, slots: { main: 0, side: 1 } });
    expect(plain.looks).toHaveLength(0);
    const offEnv = await (async () => { process.env.AGENTIC_SECOND_LOOK = 'off'; return talk([RUN, { text: 'Two failed.' }], 'test the formulas', { hooks: ['second-look'], endpoint: { kind: 'llama' }, slots: { main: 0, side: 1 } }); })();
    expect(offEnv.looks).toHaveLength(0);
  } finally { if (was === undefined) delete process.env.AGENTIC_SECOND_LOOK; else process.env.AGENTIC_SECOND_LOOK = was; }
}, 60_000);
