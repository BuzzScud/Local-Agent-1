// The sorting check (models/evals/tools/sort-check.mjs, ▶ Run a test → Sorting check) end to end,
// on a stand-in server that gives token chances and always favours "change": a line per request
// (PASS/FAIL where it has a kind to get, ---- where it has none), its raw results, its results
// page in the DOCS folder with the run before it beside it, and its line in the test record
// naming that page.
import { test, expect, afterAll } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-sort-check-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;

// Letters are its tokens, so each kind starts with a token of its own.
const server = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const j = body ? JSON.parse(body) : {};
  res.setHeader('content-type', 'application/json');
  if (req.url === '/apply-template') return res.end(JSON.stringify({ prompt: `<s>${j.messages[0].content}</s><u>${j.messages[1].content}</u>` }));
  if (req.url === '/tokenize') return res.end(JSON.stringify({ tokens: Array.from(j.content).map((c) => c.codePointAt(0)) }));
  if (req.url === '/completion') return res.end(JSON.stringify({ completion_probabilities: [{ top_logprobs: [['c', 0.8], ['o', 0.15], ['f', 0.05]].map(([t, p]) => ({ id: t.codePointAt(0), logprob: Math.log(p) })) }] }));
  res.statusCode = 404; res.end('{}');
});
const url = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${server.address().port}`)));
afterAll(() => server.close());

const run = (out, extra = ['--model', 'qwen', '--url', url, '--out', out]) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models', 'evals', 'tools', 'sort-check.mjs'), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});

test('a run: a line per request, the raw results, a results page, and a line in the record that names it', async () => {
  // DOCS must exist for a page to be written (a missing DOCS folder is never recreated).
  (await import('node:fs')).mkdirSync(DOCS, { recursive: true });
  const out1 = join(HOME, 'results', 'sort-check-a');
  const r = await run(out1);
  expect(r.code).toBe(0);
  const lines = r.text.split('\n');
  expect(lines.filter((l) => /^(PASS|FAIL)\s/.test(l))).toHaveLength(82);
  expect(lines.filter((l) => /^----\s/.test(l))).toHaveLength(3); // "api" twice, and "i need help with…"
  expect(lines.filter((l) => /^PASS\s/.test(l))).toHaveLength(22); // the 18 change lines + the 4 model-sorted ones
  expect(r.text).toContain('Sorting check on Qwen');
  const rows = JSON.parse(readFileSync(join(out1, 'rows.json'), 'utf8'));
  expect(rows).toHaveLength(85);
  expect(rows.every((x) => x.via === 'odds' && x.kind === 'change' && Math.abs(x.conf - 0.8) < 1e-9)).toBe(true);
  const sum = JSON.parse(readFileSync(join(out1, 'summary.json'), 'utf8'));
  expect(sum).toMatchObject({ model: 'qwen', total: 82, right: 22, wrong: 60, pass: false, stopped: false, odds: 85 });

  const line = readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  expect(line).toMatchObject({ kind: 'other', name: 'Sorting check', model: 'qwen', passed: 22, total: 82, result: 'fail', part: false });
  expect(line.page).toMatch(/^tests\/agentic-coder-sorting-check-qwen-\d{4}-\d\d-\d\d-\d{4}\.html$/);
  const html = readFileSync(join(DOCS, line.page), 'utf8');
  expect(html).toContain('<title>Sorting check · Qwen');
  expect(html).toContain('Failed: 22 of 82 right');
  expect(new RegExp('^Sorting check$').test(line.name)).toBe(true);
}, 60_000);

test('the next run has the one before it beside it on its page', async () => {
  await new Promise((r) => setTimeout(r, 1100)); // a later "finished" time than the first run
  const out2 = join(HOME, 'results', 'sort-check-b');
  const r = await run(out2); // beside the first run, which becomes its Before column
  expect(r.code).toBe(0);
  const line = readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  const html = readFileSync(join(DOCS, line.page), 'utf8');
  expect(readdirSync(join(DOCS, 'tests')).length).toBeGreaterThanOrEqual(1);
  expect(existsSync(join(out2, 'rows.json'))).toBe(true);
  expect(html).toContain('"label":"Before"');
  expect(html).toContain('"label":"This run"');
  expect(html).toContain('Before (');
}, 60_000);

test("--rebuild draws a run's page again from its saved results, with no model and no new line in the record", async () => {
  const out2 = join(HOME, 'results', 'sort-check-b');
  const lines = readFileSync(RECORD, 'utf8').trim().split('\n').length;
  const { page } = JSON.parse(readFileSync(join(out2, 'summary.json'), 'utf8'));
  writeFileSync(join(DOCS, page), 'old');
  const r = await run(out2, ['--rebuild', out2]);
  expect(r.code).toBe(0);
  expect(r.text).toContain(`results page drawn again: ${page}`);
  const html = readFileSync(join(DOCS, page), 'utf8');
  expect(html).toContain('"label":"Before"');
  expect(readFileSync(RECORD, 'utf8').trim().split('\n').length).toBe(lines);
}, 60_000);
