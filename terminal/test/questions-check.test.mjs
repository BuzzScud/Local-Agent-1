// The plain questions check (models/evals/tools/questions-check.mjs, ▶ Run a test → Plain
// questions check) end to end on a stand-in model: a PASS or FAIL line per request, the raw
// results, a results page in the DOCS folder, and its line in the test record naming that page.
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { startFakeServer } from './fake-server.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-questions-check-'));
const DOCS = join(HOME, 'docs');
mkdirSync(join(DOCS, 'tests'), { recursive: true });
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
const plain = (q) => ({ text: JSON.stringify({ clear: false, question: q, options: [{ label: 'Explain how it works', about: 'I tell you in plain words, with an example.' }, { label: 'Add a coupon code', about: 'Customers type SAVE10 and pay less.' }] }) });
let fake = null;
afterAll(() => fake?.close());

test('a run: a line per request, the raw results, a results page, and a line in the record that names it', async () => {
  // Seven plain questions, and one whose choices name a file and have no lines.
  const named = { text: JSON.stringify({ clear: false, question: 'Which file?', options: ['Add discount logic to cart.mjs', 'Update config.mjs'] }) };
  fake = await startFakeServer([plain('One?'), named, ...Array.from({ length: 6 }, (_, i) => plain(`Q${i}?`))]);
  const out = join(HOME, 'run1');
  const r = await new Promise((ok) => {
    const child = spawn(NODE, [join(REPO, 'models', 'evals', 'tools', 'questions-check.mjs'), '--model', 'qwen', '--url', fake.url, '--out', out], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
    let text = '';
    child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
    child.on('exit', (code) => ok({ code, text }));
  });
  expect(r.code).toBe(0);
  expect(r.text.match(/^PASS /gm)?.length).toBe(7);
  expect(r.text).toMatch(/^FAIL #2 "make checkout better" · [\d.]+ s · 2 without a line, 2 naming a file or code · Which file\?$/m);
  expect(r.text).toContain('7 of 8 plain · PASSED'); // the bar is 7 of 8
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8'));
  expect([summary.passed, summary.of, summary.choices, summary.withAbout, summary.plain]).toEqual([7, 8, 16, 14, 14]);
  expect(existsSync(join(DOCS, summary.page))).toBe(true);
  expect(readFileSync(join(DOCS, summary.page), 'utf8')).toContain('Yes: 7 of 8 questions came in plain words');
  const line = JSON.parse(readFileSync(RECORD, 'utf8').trim().split('\n').at(-1));
  expect([line.name, line.passed, line.total, line.result, line.page]).toEqual(['Plain questions check', 7, 8, 'pass', summary.page]);
}, 60_000);
