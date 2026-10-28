// Bonsai speed test (models/evals/tools/bonsai-speed.mjs, the Arena → Bonsai speed test): two requests to a stand-in
// Ollama with Ollama's own figures, the three rules, its results page and its line in the test record. No model.
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { RUN_TESTS } from '../evals/run-tests.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'agentic-bonsai-speed-'));
const DOCS = join(HOME, 'docs');
const RECORD = join(HOME, 'record.jsonl');
const REPO = join(import.meta.dir, '..', '..');
const NODE = process.execPath.endsWith('bun') ? 'node' : process.execPath;
mkdirSync(join(DOCS, 'tests'), { recursive: true });

// An Ollama whose later step reads `laterNs` (kept: 0.2 s; read again: 21 s).
const servers = [];
const ollama = (laterNs) => new Promise((ok) => {
  const s = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [{ name: 'bonsai-2:9b', context_length: 65536 }] }));
    const later = JSON.parse(b).messages.length > 2;
    res.end(JSON.stringify({ message: { role: 'assistant', content: later ? 'Code.' : 'I read and change files.' }, done: true,
      prompt_eval_count: later ? 30 : 4482, prompt_eval_duration: later ? laterNs : 21.4e9, eval_count: 120, eval_duration: 4.3e9, load_duration: 1e7 }));
  });
  servers.push(s);
  s.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${s.address().port}`));
});
afterAll(() => { for (const s of servers) s.close(); });
const run = (extra) => new Promise((ok) => {
  const child = spawn(NODE, [join(REPO, 'models/evals/tools/bonsai-speed.mjs'), ...extra], { cwd: REPO, env: { ...process.env, AGENTIC_DOCS: DOCS, AGENTIC_TEST_RECORD: RECORD, AGENTIC_HOME: HOME } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  child.on('exit', (code) => ok({ code, text }));
});
const lastLine = () => readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);

test('it is in the Arena: no model of this Mac, three checks counted from its PASS and FAIL lines', () => {
  expect(RUN_TESTS.find((t) => t.id === 'bonsai-speed')).toMatchObject({ name: 'Bonsai speed test', script: 'models/evals/tools/bonsai-speed.mjs', total: 3, model: false, record: { kind: 'other', name: '^Bonsai speed test$' } });
});

test('what was read kept: three passes, the figures, a results page and a line', async () => {
  const r = await run(['--remote', await ollama(2e8), '--out', join(HOME, 'bonsai-speed-1')]);
  expect(r.code).toBe(0);
  expect(r.text.match(/^PASS /gm)).toHaveLength(3);
  expect(r.text).toContain('Bonsai speed test: reads 209 tokens/s, writes 27.9/s; a fresh prompt of 4,482 tokens 21.4 s; a later step 4.5 s (reading 0.2 s)');
  const line = lastLine();
  expect(line).toMatchObject({ kind: 'other', name: 'Bonsai speed test', model: 'remote:bonsai-2:9b', ctx: 65536, passed: 3, total: 3, result: 'pass' });
  expect(existsSync(join(DOCS, line.page))).toBe(true);
  const page = readFileSync(join(DOCS, line.page), 'utf8');
  expect(page).toContain('209 tokens/s');
  expect(page).toContain('on 27 Oct 2026, through a logging relay'); // no run before it
});

test('read again: the later step fails its rule, and the run before is the page’s Before', async () => {
  const r = await run(['--remote', await ollama(21e9), '--out', join(HOME, 'bonsai-speed-2')]);
  expect(r.code).toBe(1);
  expect(r.text).toContain('FAIL A later step reads what is new in under 3 s');
  const line = lastLine();
  expect(line).toMatchObject({ passed: 2, total: 3, result: 'fail' });
  expect(readFileSync(join(DOCS, line.page), 'utf8')).toContain('before: 0.2 s');
});

test('no service there: a failed line saying why, no page', async () => {
  const r = await run(['--remote', 'http://127.0.0.1:9', '--out', join(HOME, 'none')]);
  expect(r.code).toBe(1);
  expect(lastLine()).toMatchObject({ name: 'Bonsai speed test', passed: 0, result: 'fail', page: '' });
});
