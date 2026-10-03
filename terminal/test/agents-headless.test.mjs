// coding -p --agents (headless.mjs): /agents' engine on the real agent (agents-driver.mjs) against a
// stand-in model server: the interview, SPEC.md and the plan from focused calls, then the task in the
// agent's own loop (a real Write, the real test command run by the app), the reviews, GO.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeServer } from './fake-server.mjs';
import { runHeadless } from '../src/headless.mjs';

const TEST = "import { test, expect } from 'bun:test';\nimport { add } from '../src/add.mjs';\ntest('add', () => { expect(add(2, 3)).toBe(5); });\n";
function route(json) {
  const sys = String(json.messages?.[0]?.content ?? '');
  const last = json.messages?.at(-1);
  const said = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
  if (/Ask the 3 to 5 questions/.test(sys)) return { text: '{"questions":[{"q":"What counts as done?","options":["add(2, 3) is 5","it prints 5"]}]}' };
  if (/Write SPEC\.md/.test(sys)) return { text: '## Goal\nAdd two numbers.\n\n## Acceptance checks\n1. add(2, 3) is 5' };
  if (/Break the spec/.test(sys)) return { text: '{"tasks":[{"title":"Add two numbers","check":"add(2, 3) is 5","files":["src/add.mjs"]}]}' };
  if (/one area:|You are the /.test(sys)) return { text: '{"findings":[]}' };
  if (/review work another assistant/.test(sys)) return { text: 'LGTM' };
  if (last?.role === 'tool') return { text: 'Done.' };
  if (/Write ONE new failing test/.test(said)) return { tool: { name: 'Write', args: { path: 'test/add.test.mjs', content: TEST } } };
  if (/pass with the least code/.test(said)) return { tool: { name: 'Write', args: { path: 'src/add.mjs', content: 'export const add = (a, b) => a + b;\n' } } };
  if (/verify/.test(said)) return { text: 'Ran it: add(2, 3) is 5.' };
  return { text: 'Done.' };
}

test('coding -p --agents: the six stages on the real agent, a real failing test then the code, the files written, GO, nothing committed', async () => {
  const base = mkdtempSync(join(tmpdir(), 'agentic-agents-'));
  const cwd = join(base, 'adder');
  mkdirSync(join(cwd, 'test'), { recursive: true });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'adder', type: 'module', scripts: { test: 'bun test' } }));
  writeFileSync(join(cwd, 'bun.lock'), '');
  const fake = await startFakeServer([], { route });
  const notes = [];
  // The test's own home: nothing of the real ~/.agentic-coder is read or written.
  const homeWas = process.env.AGENTIC_HOME;
  process.env.AGENTIC_HOME = join(base, 'home');
  const r = await runHeadless({ prompt: 'add two numbers', cwd, url: fake.url, model: { name: 'Stand-in', sampling: {} }, autoApprove: true, agents: true, flows: true, rank: false, helpers: 'off',
    onEvent: (type, ev) => { if (type === 'note') notes.push(ev.text); } });
  await fake.close();
  if (homeWas === undefined) delete process.env.AGENTIC_HOME; else process.env.AGENTIC_HOME = homeWas;
  expect(r.reason).toBe('done');
  expect(r.finalText.split('\n')[0]).toMatch(/^GO · 0 critical/);
  expect(r.finalText).toContain('Verdict: GO');
  // the files it wrote, and the work the model did with its own tools
  for (const f of ['SPEC.md', 'CONSTRAINTS.md', 'tasks/plan.md', 'tasks/todo.md', 'tasks/review.md', 'tasks/ship.md']) expect(existsSync(join(cwd, f))).toBe(true);
  expect(readFileSync(join(cwd, 'test/add.test.mjs'), 'utf8')).toBe(TEST);
  expect(readFileSync(join(cwd, 'src/add.mjs'), 'utf8')).toBe('export const add = (a, b) => a + b;\n');
  expect(readFileSync(join(cwd, 'tasks/todo.md'), 'utf8')).toContain('- [x] 1. Add two numbers');
  // the app ran the covering test: it failed before the code and passed after
  expect(notes).toContain('/agents · checker: bun test ./test/add.test.mjs: fails, as it should');
  expect(notes).toContain('/agents · checker: bun test ./test/add.test.mjs: passes');
  expect(notes.some((n) => /^\/agents asks: Approve the plan → Yes, build it$/.test(n))).toBe(true);
  expect(notes.some((n) => n.startsWith('/agents · 2nd opinion: before done:'))).toBe(true);
}, 120_000);
