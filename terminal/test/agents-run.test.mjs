// /agents' run engine (agents-run.mjs): six stages, each a ring of four steps the app runs in order.
// On the pretend driver of /agents demo, and on a small stand-in driver whose model, commands and
// files each test sets; the real agent is the app test's (app-agents-run.test.mjs).
import { test, expect } from 'bun:test';
import { AgentsRun, coveringCommand, isTestFile, jsonOf, isMathy, missOf, STAGES } from '../src/agent/agents-run.mjs';
import { demoDriver } from '../src/agent/agents-demo.mjs';

// Answers each question as it comes: pick(gate) → [option, typed text].
const answering = (run, pick = () => [0]) => run.on('state', (s) => {
  if (!s.gate || s.gate.seen) return;
  s.gate.seen = true;
  const [n, text] = pick(s.gate);
  setTimeout(() => run.answer(n, text), 0);
});

// A stand-in driver: one question, two tasks; each task's new test fails once, then passes.
function standIn(over = {}) {
  const writes = new Map(), sends = [], execs = [], calls = [];
  let guard = null, redNext = false;
  const d = {
    model: 'stand-in', reviewer: null, testCmd: 'bun test',
    async complete({ system, user }) {
      calls.push({ system, user });
      if (/Ask the 3 to 5 questions/.test(system)) return '{"questions":[{"q":"What counts as done?","options":["the checks pass","it runs"]}]}';
      if (/Write SPEC\.md/.test(system)) return '## Goal\nAdd two numbers.\n\n## Acceptance checks\n1. add(2, 3) is 5';
      if (/Break the spec/.test(system)) return '{"tasks":[{"title":"Add","check":"add(2, 3) is 5"},{"title":"Negatives","check":"add(-2, 3) is 1"}]}';
      return over.findings?.(system) ?? '{"findings":[]}';
    },
    async send(text) {
      sends.push(text);
      if (over.send) { const r = await over.send(text, guard); if (r) return r; }
      if (/failing test/.test(text)) { redNext = true; return { reason: 'done', files: ['test/add.test.mjs'], diff: '+test', text: 'wrote it' }; }
      return { reason: 'done', files: ['src/add.mjs'], diff: '+code', text: 'done' };
    },
    async exec(cmd) {
      execs.push(cmd);
      if (over.exec) { const r = over.exec(cmd, execs); if (r) return r; }
      if (cmd === 'bun test') return { code: 0, out: '9 pass' };
      if (redNext) { redNext = false; return { code: 1, out: 'error: expect(received).toBe(expected)\n1 fail' }; }
      return { code: 0, out: '1 pass' };
    },
    async review() { return over.review?.() ?? { ok: true, findings: [] }; },
    listFiles: () => ['src/add.mjs', 'test/'],
    read: (rel) => writes.get(rel) ?? null,
    write: (rel, text) => { writes.set(rel, text); },
    setGuard: (fn) => { guard = fn; },
    reviewInTurn: () => {},
    save: () => {},
  };
  return { d, writes, sends, execs, calls };
}

test('a whole run on the pretend driver: six stages, every task test-first with a rewind point and a doubt review, then GO', async () => {
  const run = new AgentsRun({ request: 'build a Kepler solver: where an orbit is at time t', driver: demoDriver({ beat: 1 }) });
  answering(run);
  const s = await run.start();
  expect(s.verdict).toEqual({ kind: 'go' });
  expect(s.math).toBe(true);
  expect(s.items[0].map((q) => q.answer)).toEqual(['a, e, i, Ω, ω, M0 and a time t', '|E − e·sin E − M| ≤ 1e−12', 'reference cases and a slow bisection']);
  expect(s.items[2]).toHaveLength(7);
  expect(s.items[2].every((t) => t.state === 'done')).toBe(true);
  expect(s.items[2][2].tries).toBe(2); // task 3 missed once, then passed
  expect(s.items[2][4].doubt).toBe('fixed'); // its doubt review found something, and it was fixed
  expect(s.items[2].filter((t) => t.doubt === 'held')).toHaveLength(6);
  expect(s.rewind).toBe(7);
  expect(s.findings).toMatchObject({ critical: 0, important: 1, suggestion: 1 });
  expect(s.items[4].map((a) => a.title)).toEqual(['Correctness', 'Stability', 'Precision', 'Speed', 'Readability']); // the math areas
  expect(s.adv.calls).toBeGreaterThanOrEqual(9);
  expect(s.log.some((e) => e.who === '2nd opinion' && /before the plan: the plan has no e = 0 case/.test(e.text))).toBe(true);
  expect(s.log.some((e) => e.who === '2nd opinion' && /after a miss: start Newton at E0 = π/.test(e.text))).toBe(true);
  expect(STAGES.map((x) => x.name)).toEqual(['Define', 'Plan', 'Build', 'Verify', 'Review', 'Ship']);
});

test('its files: SPEC.md, CONSTRAINTS.md, tasks/plan.md and todo.md, review.md and ship.md; each task red then green then the suite; nothing committed', async () => {
  const { d, writes, sends, execs } = standIn();
  const run = new AgentsRun({ request: 'add two numbers', driver: d });
  answering(run);
  const s = await run.start();
  expect(s.verdict.kind).toBe('go');
  expect(s.math).toBe(false);
  expect([...writes.keys()].sort()).toEqual(['CONSTRAINTS.md', 'SPEC.md', 'tasks/plan.md', 'tasks/review.md', 'tasks/ship.md', 'tasks/todo.md']);
  expect(writes.get('SPEC.md')).toContain('## Acceptance checks');
  expect(writes.get('CONSTRAINTS.md')).toContain('Nothing is committed');
  expect(writes.get('tasks/plan.md')).toContain('1. **Add** · check: add(2, 3) is 5');
  expect(writes.get('tasks/todo.md')).toContain('- [x] 2. Negatives');
  expect(writes.get('tasks/ship.md')).toContain('Nothing was committed');
  // per task: the failing test, its covering run (fails), the code, the covering run (passes), the suite
  expect(sends[0]).toContain('Write ONE new failing test for this check: add(2, 3) is 5');
  expect(sends[1]).toContain('Make the new test in test/add.test.mjs pass with the least code');
  expect(execs.slice(0, 3)).toEqual(['bun test ./test/add.test.mjs', 'bun test ./test/add.test.mjs', 'bun test']);
  expect(sends.some((x) => /git (commit|push)/.test(x))).toBe(false);
  expect(s.items[4].map((a) => a.title)).toEqual(['Correctness', 'Readability', 'Architecture', 'Security', 'Performance']); // the poster's five
});

test('the plan gate: "Show the plan" lists the tasks, "Change it" plans again with your words, and only 1 builds it', async () => {
  const { d, calls } = standIn();
  const run = new AgentsRun({ request: 'add two numbers', driver: d });
  const plan = [[2], [1, 'one task per sign'], [0]];
  const details = [];
  answering(run, (gate) => { if (gate.kind !== 'plan') return [0]; details.push(gate.detail); return plan.shift(); });
  const s = await run.start();
  expect(details[0]).toContain('Only 1 builds it');
  expect(details[1]).toBe('1 Add · 2 Negatives');
  expect(calls.filter((c) => /Break the spec/.test(c.system)).at(-1).user).toContain('The user asked for this change to the plan: one task per sign');
  expect(s.log.some((e) => e.who === 'you' && e.text === 'one task per sign')).toBe(true);
  expect(s.verdict.kind).toBe('go');
});

test('three misses in a row ask you: "Leave it open" goes on to the next task; "Stop /agents" ends the run', async () => {
  const always = { exec: (cmd) => (cmd === 'bun test' ? null : { code: 1, out: 'E   AssertionError: 4 != 5' }) };
  const a = standIn(always);
  const open = new AgentsRun({ request: 'add two numbers', driver: a.d });
  answering(open, (gate) => (/won't pass/.test(gate.title) ? [1] : [0]));
  const s = await open.start();
  expect(s.items[2].map((t) => t.state)).toEqual(['open', 'open']);
  expect(s.log.filter((e) => e.who === 'checker' && e.text.endsWith('fails: AssertionError: 4 != 5'))).toHaveLength(6); // three a task, what failed each time
  expect(s.stops).toBe(2);
  // open tasks make Ship ask, and stopping there comes first: NO-GO
  expect(s.verdict).toEqual({ kind: 'nogo', why: '2 tasks left open' });

  const b = standIn(always);
  const stop = new AgentsRun({ request: 'add two numbers', driver: b.d });
  answering(stop, (gate) => (/won't pass/.test(gate.title) ? [2] : [0]));
  const t = await stop.start();
  expect(t.verdict.kind).toBe('stopped');
  expect(t.stage).toBe(2);
  expect(t.log.at(-1).text).toContain('nothing committed');
});

test('a step on the stop list asks first: "No" turns it away with the reason, "Allow it this once" lets it run, typed words go to the model', async () => {
  const results = [];
  const { d } = standIn({
    send: async (text, guard) => {
      if (!/least code/.test(text) || results.length) return null;
      results.push(await guard({ name: 'Bash', args: { command: 'npm install left-pad' }, before: '' }));
      results.push(await guard({ name: 'Bash', args: { command: 'npm install left-pad' }, before: '' }));
      results.push(await guard({ name: 'Read', args: { path: '.env' }, before: '' }));
      results.push(await guard({ name: 'Edit', args: { path: 'src/add.mjs', old_text: 'a', new_text: 'b' }, before: 'a' }));
      return null;
    },
  });
  const run = new AgentsRun({ request: 'add two numbers', driver: d });
  const picks = [[0], [1], [2, 'use the fake token in test/fixtures']];
  answering(run, (gate) => (gate.kind === 'stop' ? picks.shift() : [0]));
  const s = await run.start();
  expect(results[0].text).toContain('The user said no to this step (New package: It wants to run: npm install left-pad)');
  expect(results[1]).toBeNull(); // allowed this once
  expect(results[2].text).toContain('They said: use the fake token in test/fixtures');
  expect(results[3]).toBeNull(); // a plain edit runs
  expect(s.stops).toBe(3);
  expect(s.log.filter((e) => e.who === 'stop').map((e) => e.text)).toEqual(['New package: It wants to run: npm install left-pad', 'New package: It wants to run: npm install left-pad', 'Secrets: It wants to read .env.']);
});

test('a critical finding in Review goes back to Build for one fix task, then Review goes on; a critical one in Ship is NO-GO when you stop there', async () => {
  let once = true;
  const { d } = standIn({ findings: (system) => (/one area: Correctness/.test(system) && once ? ((once = false), '{"findings":[{"level":"critical","at":"src/add.mjs:3","text":"add(1e308, 1e308) is Infinity","fix":"say so in SPEC.md, or check"}]}') : null) });
  const run = new AgentsRun({ request: 'add two numbers', driver: d });
  answering(run);
  const s = await run.start();
  expect(s.items[2]).toHaveLength(3);
  expect(s.items[2][2].title).toBe('Fix: add(1e308, 1e308) is Infinity');
  expect(s.findings).toMatchObject({ critical: 1, fixed: 1 });
  expect(s.verdict.kind).toBe('go');

  const n = standIn({ findings: (system) => (/security-auditor/.test(system) ? '{"findings":[{"level":"critical","at":"src/add.mjs:9","text":"eval of the input"}]}' : null) });
  const nogo = new AgentsRun({ request: 'add two numbers', driver: n.d });
  answering(nogo, (gate) => (gate.title === 'NO-GO' ? [1] : [0]));
  const t = await nogo.start();
  expect(t.verdict).toEqual({ kind: 'nogo', why: 'src/add.mjs:9 eval of the input' });
  expect(t.lanes[1]).toMatchObject({ name: 'security-auditor', status: 'bad' });
});

test('pause holds it between steps; resume goes on; a note you type goes with its next step', async () => {
  const { d, sends } = standIn();
  const run = new AgentsRun({ request: 'add two numbers', driver: d });
  answering(run);
  run.note('keep it in one file');
  run.pause();
  const p = run.start();
  await new Promise((r) => setTimeout(r, 60));
  expect(sends).toHaveLength(0);
  expect(run.state.stage).toBe(0);
  run.resume();
  await p;
  expect(sends[0]).toStartWith('Notes from the user for this step:\n- keep it in one file');
  expect(sends[1]).not.toContain('keep it in one file');
});

test('the helpers: the covering command from the suite\'s, test files, JSON in a reply, the line that says what failed, a request about numbers', () => {
  expect(coveringCommand('python3 -m pytest', 'tests/test_kepler.py')).toBe('python3 -m pytest tests/test_kepler.py');
  expect(coveringCommand('pytest', 'tests/test a.py')).toBe("pytest 'tests/test a.py'");
  expect(coveringCommand('bun run test', 'test/x.test.mjs')).toBe('bun test ./test/x.test.mjs');
  expect(coveringCommand('npm test', 'a.test.js')).toBe('npm test -- a.test.js');
  expect(coveringCommand('node --test', 'a.test.mjs')).toBe('node --test a.test.mjs');
  expect(coveringCommand('cargo test', 'tests/a.rs')).toBe('cargo test');
  expect(coveringCommand(null, 'tests/test_a.py')).toBe('python3 -m pytest tests/test_a.py');
  expect(coveringCommand('npm test', null)).toBe('npm test');
  expect(['tests/test_a.py', 'test/x.test.mjs', 'src/a.spec.ts', '__tests__/b.js', 'test_c.py'].every(isTestFile)).toBe(true);
  expect(['src/a.mjs', 'kepler.py', 'contest.py'].some(isTestFile)).toBe(false);
  expect(jsonOf('Sure!\n```json\n{"a": [1, {"b": 2}]}\n```')).toEqual({ a: [1, { b: 2 }] });
  expect(jsonOf('no json here')).toBeNull();
  expect(missOf('collected 6\n____ test ____\nE   ArithmeticError: |f| = 3e-09\n==== 1 failed ====')).toBe('ArithmeticError: |f| = 3e-09');
  expect(missOf('✗ caps at 30 s\n  expected: <= 30000 · received: 32100\n 1 fail')).toBe('expected: <= 30000 · received: 32100');
  expect(isMathy('solve Kepler\'s equation to 1e-12')).toBe(true);
  expect(isMathy('add a login page')).toBe(false);
});
