// The tests helper's run before the first step (agent-read.mjs): a folder whose run was cut off skips
// it for a week (tests-first.mjs), and a loop's run whose last run ran the tests skips it (testsFirst).
// The cut-off is 1.5 s here (AGENTIC_TESTS_FIRST_MS), set before the agent loads.
import { test, expect } from 'bun:test';
import { cpSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENTIC_TESTS_FIRST_MS = '1500';
const { Agent } = await import('../src/agent/agent.mjs');
const { systemPrompt } = await import('../src/agent/prompt.mjs');
const { slowRun, noteSlow, slowFile, SLOW_DAYS } = await import('../src/agent/tests-first.mjs');
const { MODELS, DEFAULT_MODEL, HOME } = await import('../../models/index.mjs');
const { startFakeServer } = await import('./fake-server.mjs');

const tmp = (name) => mkdtempSync(join(tmpdir(), `agentic-tests-first-${name}-`));
const fixture = () => { const d = join(tmp('fix'), 'project'); cpSync(join(import.meta.dir, 'fixture-fix'), d, { recursive: true }); return d; };

async function send(cwd, prompt, { testsFirst } = {}) {
  const fake = await startFakeServer([{ text: 'Done.' }]);
  const events = [];
  const agent = new Agent({ url: fake.url, model: MODELS[DEFAULT_MODEL], cwd, system: systemPrompt({ cwd, git: 'test' }), thinking: false, mode: 'edits', flows: false, maxTries: 2, confirmPlan: false, helpers: 'tests', indexDir: tmp('index'), ask: async () => ({ choice: 'yes' }), ...(testsFirst === undefined ? {} : { testsFirst }) });
  for (const t of ['tool', 'note', 'context']) agent.on(t, (e) => events.push({ type: t, ...e }));
  await agent.send(prompt);
  await fake.close();
  return {
    ran: events.some((e) => e.type === 'note' && /^Running node --test first/.test(e.text)),
    notes: events.filter((e) => e.type === 'note').map((e) => e.text),
    helpers: events.find((e) => e.type === 'context' && e.title === 'Helpers') ?? null,
    given: events.filter((e) => e.type === 'tool' && e.given).map((e) => `${e.label}(${e.arg})`),
  };
}

test('the note is kept in the throwaway home', () => {
  expect(slowFile()).toBe(join(HOME, 'tests-first.json'));
});

test('a folder whose run before the first step was cut off skips it on the next message, and says so once', async () => {
  const cwd = fixture();
  // A test that takes longer than the cut-off.
  writeFileSync(join(cwd, 'slow.test.mjs'), "import { test } from 'node:test';\ntest('slow', async () => { await new Promise((r) => setTimeout(r, 6000)); });\n");
  const first = await send(cwd, 'The tests fail, fix the bug.');
  expect(first.ran).toBe(true);
  expect(first.helpers.items[0]).toMatchObject({ from: 'tests', text: 'node --test · stopped after 60 s' });
  expect(slowRun(cwd, 'node --test')).toMatchObject({ cmd: 'node --test' });
  // The next message: no run first, the Helpers line says why, and the model is not given a cut-off run.
  const next = await send(cwd, 'The tests still fail, fix the bug.');
  expect(next.ran).toBe(false);
  expect(next.given).toEqual([]);
  expect(next.notes).toContain('Not running node --test first: it took over 1.5 s here, so the model runs it when it needs to.');
  expect(next.helpers.items).toEqual([expect.objectContaining({ from: 'tests', text: 'node --test', skipped: expect.stringMatching(/^cut off after 1\.5 s here on \d{4}-\d\d-\d\d$/) })]);
}, 30_000);

test('the note holds a week, for that command only, and a quick folder never gets one', async () => {
  const file = join(tmp('note'), 'tests-first.json');
  const now = Date.parse('2026-10-09T22:00:00Z');
  noteSlow('/work/big', 'bun run test', 64.2, { file, now });
  expect(slowRun('/work/big', 'bun run test', { file, now: now + 3_600_000 })).toEqual({ cmd: 'bun run test', at: '2026-10-09T22:00:00.000Z', secs: 64 });
  expect(slowRun('/work/big', 'npm test', { file, now })).toBe(null); // another command: tried again
  expect(slowRun('/work/big', 'bun run test', { file, now: now + SLOW_DAYS * 86_400_000 + 1 })).toBe(null); // a week on: tried again
  // A note older than a week goes when another is written.
  noteSlow('/work/other', 'npm test', 61, { file, now: now + 8 * 86_400_000 });
  expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toEqual(['/work/other']);
  // A run that finishes in time leaves no note.
  const cwd = fixture();
  expect((await send(cwd, 'The tests fail, fix the bug.')).ran).toBe(true);
  expect(slowRun(cwd, 'node --test')).toBe(null);
  expect((await send(cwd, 'The tests fail, fix the bug.')).ran).toBe(true);
  expect(existsSync(file)).toBe(true);
}, 30_000);

test("a loop's run whose last run ran the tests does not run them first", async () => {
  const r = await send(fixture(), 'The tests fail, fix the bug.', { testsFirst: false });
  expect(r.ran).toBe(false);
  expect(r.given).toEqual([]);
  expect(r.helpers.items).toEqual([expect.objectContaining({ from: 'tests', text: 'node --test', skipped: "the loop's last run ran them" })]);
});
