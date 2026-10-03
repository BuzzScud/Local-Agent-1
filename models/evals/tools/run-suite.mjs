// `bun run test`: the unit tests of both parts, and one line in the test
// record when a full run ends. The test files run side by side, each in its
// own `bun test`, the slowest of the last run first; a file's output is
// printed whole when it ends. AGENTIC_TEST_JOBS sets how many run at once
// (1 = one after the other). A run narrowed by extra arguments (a file,
// -t "name") goes to one `bun test` as before and is not recorded.
//   node models/evals/tools/run-suite.mjs [anything bun test takes]
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { recordTest, codeLabel, recordFile, skipsIn, skipWords } from '../record.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const extra = process.argv.slice(2);
const t0 = Date.now();
const env = { ...process.env, ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: '1' } : {}) };
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const count = (text, word) => { const m = new RegExp(`^\\s*(\\d+) ${word}`, 'm').exec(text); return m ? Number(m[1]) : null; };
// The tests that failed, by name, from what bun printed: "(fail) group > name [1.2ms]", or "✗ group > name"
// in colour, each under its file's "terminal/test/hub-run.test.mjs:" line. Named "hub-run.test.mjs › group > name".
function failedIn(text) {
  let file = '';
  const out = [];
  for (const l of plain(text).split('\n')) {
    const h = /^(\S+\.test\.(?:mjs|js|jsx)):$/.exec(l);
    if (h) { file = h[1].split('/').pop(); continue; }
    const m = /^(?:\(fail\)|✗)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(l);
    if (m) out.push(file ? `${file} › ${m[1]}` : m[1]);
  }
  return out;
}

function record({ pass, fail, files, code, failed = [], why = {} }) {
  if (extra.length || process.env.CI || process.env.AGENTIC_NO_RECORD || pass == null) return;
  const words = skipWords(why);
  recordTest({ kind: 'suite', name: 'Unit tests, both parts', code: codeLabel(root), passed: pass, total: pass + fail, secs: (Date.now() - t0) / 1000,
    result: code === 0 && fail === 0 ? 'pass' : 'fail', note: [files ? `${files} files` : '', words ? `skipped: ${words}` : '', code !== 0 && fail === 0 ? `bun test ended with code ${code}` : ''].filter(Boolean).join(' · '), raw: '', failed, skipped: why });
}

// One `bun test` over the given paths. Live: its output goes straight to the
// screen; otherwise it is kept and handed back.
function bunTest(paths, { live }) {
  return new Promise((resolve) => {
    const child = spawn('bun', ['test', ...paths], { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], env });
    let out = '';
    const keep = (to) => (d) => { out += d; if (live) to.write(d); };
    child.stdout.on('data', keep(process.stdout));
    child.stderr.on('data', keep(process.stderr));
    child.on('error', (e) => { process.stderr.write(`could not start bun test: ${e.message}\n`); process.exit(1); });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

const jobs = Math.max(1, Number(process.env.AGENTIC_TEST_JOBS) || Math.min(4, cpus().length));
if (extra.length || jobs === 1) {
  // A file or folder named on the command line is run alone; with only flags
  // (-t "name") both parts are searched.
  const named = extra.some((a) => !a.startsWith('-') && existsSync(join(root, a)));
  const { code, out } = await bunTest([...(named ? [] : ['./terminal/test', './models/test']), ...extra], { live: true });
  const tail = plain(out.slice(-4000));
  record({ pass: count(tail, 'pass\\b'), fail: count(tail, 'fail\\b') ?? 0, files: /across (\d+) files/.exec(tail)?.[1], code, failed: failedIn(out), why: skipsIn(out) });
  process.exit(code);
}

// The test files of both parts: the ones at the top of each test folder. The
// practice projects under terminal/test (fixture-*) hold tests of their own,
// one of them failing on purpose; they are material, not part of the suite.
const files = ['terminal/test', 'models/test'].flatMap((dir) => readdirSync(join(root, dir)).filter((f) => /\.test\.(mjs|js|jsx)$/.test(f)).sort().map((f) => `./${dir}/${f}`));
// How long each took last time, kept beside the test record; a file not yet
// timed goes by its size.
const timesFile = join(dirname(recordFile()), 'suite-times.json');
let last = {};
try { last = JSON.parse(readFileSync(timesFile, 'utf8')); } catch { /* the first run */ }
const weight = (f) => last[f] ?? statSync(join(root, f)).size / 2000;
const queue = [...files].sort((a, b) => weight(b) - weight(a));

const sum = { pass: 0, fail: 0, skip: 0, todo: 0, expects: 0, tests: 0 };
const took = {};
const broken = [];
const failed = [];
const why = {}; // skipped for want of a tool, by reason
let worst = 0;
async function worker() {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const t = Date.now();
    const { code, out } = await bunTest([file], { live: false });
    took[file] = Math.round((Date.now() - t) / 100) / 10;
    const text = plain(out);
    const pass = count(text, 'pass$');
    // A file that ran no test, or whose counts cannot be read, is a failure:
    // it must never drop out of the total without a word.
    if (pass == null || !/^Ran \d+ tests? across 1 file/m.test(text)) broken.push(file);
    sum.pass += pass ?? 0; sum.fail += count(text, 'fail$') ?? 0; sum.skip += count(text, 'skip$') ?? 0; sum.todo += count(text, 'todo$') ?? 0;
    sum.expects += count(text, 'expect\\(\\) calls') ?? 0; sum.tests += Number(/^Ran (\d+) tests?/m.exec(text)?.[1] ?? 0);
    if (code !== 0) worst = worst || code;
    failed.push(...failedIn(text));
    skipsIn(text, why);
    // The file's own lines, without bun's banner and its per-file summary.
    const lines = out.split('\n').filter((l) => { const p = plain(l); return !/^bun test v/.test(p) && !/^\s*\d+ (pass|fail|skip|todo|expect\(\) calls)$/.test(p) && !/^Ran \d+ tests? across/.test(p); });
    process.stdout.write(`${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n\n`);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

const secs = (Date.now() - t0) / 1000;
for (const f of broken) process.stdout.write(`(fail) ${f.slice(2)}: no result could be read from this file\n`);
const fail = sum.fail + broken.length;
const code = worst || (fail ? 1 : 0);
process.stdout.write(`\n ${sum.pass} pass\n${sum.skip ? ` ${sum.skip} skip\n` : ''}${skipWords(why) ? ` skipped for want of a tool: ${skipWords(why)}\n` : ''}${sum.todo ? ` ${sum.todo} todo\n` : ''} ${fail} fail\n ${sum.expects} expect() calls\nRan ${sum.tests} tests across ${files.length} files. [${secs.toFixed(2)}s]\n`);
try { mkdirSync(dirname(timesFile), { recursive: true }); writeFileSync(timesFile, JSON.stringify(took, null, 1)); } catch { /* only a hint for the next run's order */ }
record({ pass: sum.pass, fail, files: files.length, code, failed: [...failed, ...broken.map((f) => `${f.split('/').pop()} › no result could be read`)], why });
process.exit(code);
