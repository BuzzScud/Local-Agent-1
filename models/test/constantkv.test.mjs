// The ConstantKV check (models/evals/tools/constantkv-check.mjs) end to end with a stand-in for its
// model half (no Python, no model): (a)–(c) come from the model half's lines and results.jsonl, (d) is
// read here with the app's own parser from the replies it saved, and what was not reached says so.
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTestById, runCommand } from '../evals/run-tests.mjs';

const REPO = join(import.meta.dir, '..', '..');
const CHECK = join(REPO, 'models', 'evals', 'tools', 'constantkv-check.mjs');
const call = (path) => `I will write it.\n\n<tool_call>\n<function=Write>\n<parameter=path>\n${path}\n</parameter>\n<parameter=content>\nprint(1)\n</parameter>\n</function>\n</tool_call>`;

// The stand-in model half: it writes what run.py writes (results.jsonl, the replies) and prints its lines.
// STUB=slow: reading fails (b) at 16k, so (c) is never reached.
const STUB = `import { writeFileSync, appendFileSync } from 'node:fs'; import { join } from 'node:path';
const [out] = process.argv.slice(2); const slow = process.env.STUB === 'slow';
const rec = (o) => appendFileSync(join(out, 'results.jsonl'), JSON.stringify(o) + '\\n');
writeFileSync(join(out, 'results.jsonl'), '');
rec({ phase: 'start', free_gb: 12.9, swap_gb: 0.4 }); rec({ phase: 'load', sec: 40, footprint_gb: 9.1 }); rec({ phase: 'agent-prompt', tokens: 5512 });
const replies = ${JSON.stringify([call('hello.py'), 'Sure: print(1)', call('fib.py')])};
replies.forEach((t, i) => { writeFileSync(join(out, 'agent-try' + (i + 1) + '.txt'), t); rec({ phase: 'agent', tri: i + 1, read_tps: slow ? 20 : 55, write_tps: 6.4, wrote: 120, ended: 'eos' }); });
console.log('PASS  (a) it loads and answers'); rec({ phase: 'bar', item: 'a', ok: true, value: 120 });
rec({ phase: 'long', T: 16384, read_tps: slow ? 21 : 58, write_ms: 156, write_tps: 6.4, footprint_gb: 11.6, free_gb: 1.2 });
console.log((slow ? 'FAIL' : 'PASS') + '  (b) it reads 40+ tokens a second up to 16k'); rec({ phase: 'bar', item: 'b', ok: !slow, value: slow ? 21 : 58 });
if (slow) rec({ phase: 'long', stopped: 'reading under 40 a second at 16k' });
else { rec({ phase: 'long', T: 65536, read_tps: 55, write_ms: 157, write_tps: 6.4, footprint_gb: 12.2, free_gb: 0.9 }); console.log('PASS  (c) it holds 64k tokens at 12.5 GB or less'); rec({ phase: 'bar', item: 'c', ok: true, value: 12.2 }); }
rec({ phase: 'end', footprint_peak_gb: 12.2 });`;

function run(stub = '') {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-ckv-'));
  writeFileSync(join(dir, 'stub.mjs'), STUB);
  writeFileSync(join(dir, 'model.safetensors'), '');
  const r = spawnSync(process.execPath, [CHECK, '--no-record'], { cwd: REPO, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, AGENTIC_HOME: join(dir, 'home'), AGENTIC_MEMORY_SAVE: 'off', CKV_PYTHON: process.execPath, CKV_SCRIPT: join(dir, 'stub.mjs'), CKV_PACK: dir, CKV_OUT: join(dir, 'out'), STUB: stub } });
  return { lines: r.stdout.trim().split('\n'), code: r.status, summary: JSON.parse(readFileSync(join(dir, 'out', 'summary.json'), 'utf8')) };
}

test('it is an Arena check of no model of /model that still holds the memory, counted by its four PASS or FAIL lines', () => {
  const t = runTestById('constantkv');
  expect(t).toMatchObject({ model: false, memory: 12.5e9, total: 4, record: { kind: 'other', name: '^ConstantKV check$' } });
  expect(runCommand('constantkv', { model: 'qwen' }).argv).toEqual(['models/evals/tools/constantkv-check.mjs']);
});

test('all four hold: (d) is read with the app’s own parser from the replies, 2 of 3 real calls is a pass', () => {
  const { lines, code, summary } = run();
  expect(code).toBe(0);
  expect(lines.filter((l) => /^(PASS|FAIL)\s/.test(l))).toEqual(['PASS  (a) it loads and answers', 'PASS  (b) it reads 40+ tokens a second up to 16k', 'PASS  (c) it holds 64k tokens at 12.5 GB or less', 'PASS  (d) the app’s tool calls on 2 of 3 tries: 2 of 3']);
  expect(lines).toContain('  Try 1: a real Write call (path, content)');
  expect(lines).toContain('  Try 2: no call the app can read');
  expect(lines.at(-1)).toBe('ConstantKV check: 4 of 4 · PASSED · worth building · writes 6.4/s (today’s Bonsai 13.7)');
  expect(summary).toMatchObject({ passed: 4, pass: true, page: '', prompt: 5512 });
  // The app's own instructions and tools went to the model half.
  expect(lines).toContain('a look only: no results page, no line in the test record');
});

test('reading too slow at 16k: (b) fails, (c) is not reached and says why, and the verdict is a fail', () => {
  const { lines, summary } = run('slow');
  expect(lines).toContain('FAIL  (b) it reads 40+ tokens a second up to 16k');
  expect(lines).toContain('  (c) it holds 64k tokens at 12.5 GB or less: not reached (reading under 40 a second at 16k)');
  expect(lines.at(-1)).toMatch(/^ConstantKV check: 2 of 4 · FAILED/);
  expect(summary).toMatchObject({ passed: 2, pass: false, early: 'reading under 40 a second at 16k' });
});

test('not set up on this Mac: it says what is missing and records nothing', () => {
  const r = spawnSync(process.execPath, [CHECK, '--no-record'], { cwd: REPO, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, AGENTIC_HOME: mkdtempSync(join(tmpdir(), 'agentic-ckv-')), CKV_PYTHON: '/nonexistent/python', CKV_PACK: '/nonexistent' } });
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('FAIL  (a) it loads and answers: not set up on this Mac');
  expect(r.stdout).toContain('nothing ran, so nothing is recorded');
});
