// `bun run test`: the unit tests of both parts, and one line in the test
// record when a full run ends. The test files run side by side, each in its
// own `bun test`, the slowest of the last run first; a file's output is
// printed whole when it ends. AGENTIC_TEST_JOBS sets how many run at once
// (1 = one after the other). A run narrowed by extra arguments (a file,
// -t "name") goes to one `bun test` as before and is not recorded.
//   node models/evals/tools/run-suite.mjs [anything bun test takes]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { recordTest, codeLabel, recordFile, skipsIn, skipWords } from '../record.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const extra = process.argv.slice(2);
const t0 = Date.now();
const env = { ...process.env, ...(process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: '1' } : {}) };
// What an earlier run left: the run folders of test processes that are gone, and the programs still
// running from them (terminal/test/test-tmp.mjs; a bun of its own, since the models part imports no file
// of the terminal's but its index). At the start and the end of every run; a sweep that fails never fails the run.
const sweep = () => { try { const out = execFileSync('bun', [join(root, 'terminal', 'test', 'test-tmp.mjs'), '--sweep'], { encoding: 'utf8', timeout: 60_000 }); if (out) process.stdout.write(out); } catch { /* nothing to clean, or no bun: the run goes on */ } };
sweep();
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

function record({ pass, fail, files, code, failed = [], why = {}, flaky = [] }) {
  if (extra.length || process.env.CI || process.env.AGENTIC_NO_RECORD || pass == null) return;
  const words = skipWords(why);
  recordTest({ kind: 'suite', name: 'Unit tests, both parts', code: codeLabel(root), passed: pass, total: pass + fail, secs: (Date.now() - t0) / 1000,
    result: code === 0 && fail === 0 ? 'pass' : 'fail', note: [files ? `${files} files` : '', words ? `skipped: ${words}` : '', flaky.length ? `flaky: ${flaky.length} passed on a second run` : '', code !== 0 && fail === 0 ? `bun test ended with code ${code}` : ''].filter(Boolean).join(' · '), raw: '', failed, skipped: why, flaky });
}

// One `bun test` over the given paths. Live: its output goes straight to the
// screen; otherwise it is kept and handed back.
function bunTest(paths, { live }) {
  return new Promise((resolve) => {
    // --timeout: bun reads no timeout from bunfig.toml (checked 7 Oct 2026 on bun 1.4.2: a 6 s test failed at
    // 5 s with timeout = 30000 there), so every test without its own limit had bun's 5 s, and a busy Mac failed them.
    const child = spawn('bun', ['test', '--timeout', '30000', ...paths], { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], env });
    let out = '';
    const keep = (to) => (d) => { out += d; if (live) to.write(d); };
    child.stdout.on('data', keep(process.stdout));
    child.stderr.on('data', keep(process.stderr));
    child.on('error', (e) => { process.stderr.write(`could not start bun test: ${e.message}\n`); process.exit(1); });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

// Six files at once (four until 7 Oct 2026: 315 s; eight took 170 s on a quiet Mac but failed a test in every
// run while other sessions loaded it).
const jobs = Math.max(1, Number(process.env.AGENTIC_TEST_JOBS) || Math.min(6, cpus().length));
if (extra.length || jobs === 1) {
  // A file or folder named on the command line is run alone; with only flags
  // (-t "name") both parts are searched.
  const named = extra.some((a) => !a.startsWith('-') && existsSync(join(root, a)));
  const { code, out } = await bunTest([...(named ? [] : ['./terminal/test', './models/test']), ...extra], { live: true });
  const tail = plain(out.slice(-4000));
  record({ pass: count(tail, 'pass\\b'), fail: count(tail, 'fail\\b') ?? 0, files: /across (\d+) files/.exec(tail)?.[1], code, failed: failedIn(out), why: skipsIn(out) });
  sweep();
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
const flaky = []; // tests that failed in the busy run and passed when their file ran again alone
const again = []; // the files that failed, for their second run
const why = {}; // skipped for want of a tool, by reason
let worst = 0;
// One file's run, read: its counts, the tests that failed, whether its result could be read at all.
function readRun({ code, out }) {
  const text = plain(out);
  const pass = count(text, 'pass$');
  // A file that ran no test, or whose counts cannot be read, is a failure:
  // it must never drop out of the total without a word.
  const ok = pass != null && /^Ran \d+ tests? across 1 file/m.test(text);
  return { code, out, text, ok, pass: pass ?? 0, fail: count(text, 'fail$') ?? 0, failed: failedIn(text) };
}
function add(file, r) {
  if (!r.ok) broken.push(file);
  sum.pass += r.pass; sum.fail += r.fail; sum.skip += count(r.text, 'skip$') ?? 0; sum.todo += count(r.text, 'todo$') ?? 0;
  sum.expects += count(r.text, 'expect\\(\\) calls') ?? 0; sum.tests += Number(/^Ran (\d+) tests?/m.exec(r.text)?.[1] ?? 0);
  if (r.code !== 0) worst = worst || r.code;
  failed.push(...r.failed);
  skipsIn(r.text, why);
}
// The file's own lines, without bun's banner and its per-file summary.
const show = (out) => { const lines = out.split('\n').filter((l) => { const p = plain(l); return !/^bun test v/.test(p) && !/^\s*\d+ (pass|fail|skip|todo|expect\(\) calls)$/.test(p) && !/^Ran \d+ tests? across/.test(p); }); process.stdout.write(`${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n\n`); };
async function worker() {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const t = Date.now();
    const r = readRun(await bunTest([file], { live: false }));
    took[file] = Math.round((Date.now() - t) / 100) / 10;
    show(r.out);
    // A file that failed runs once more, alone, once every other file is done (below).
    if (r.code !== 0 || !r.ok || r.fail) again.push({ file, first: r }); else add(file, r);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
// The second run, one file at a time on a quiet Mac. Six files at once while other sessions load the
// Mac failed one or two app-driving tests in 40 of 137 full runs from 1 Oct to 15 Oct 2026, a
// different one almost every time. A file that passes now counts as passed, and the tests that
// failed the first time are kept as flaky (the record's line names them); one that fails again
// counts as failed, with its second run's counts.
for (const { file, first } of again) {
  process.stdout.write(`(again) ${file.slice(2)}: failed in the busy run (${first.failed.length ? first.failed.join('; ') : 'no result could be read'}); running it once more, alone\n`);
  const r = readRun(await bunTest([file], { live: false }));
  show(r.out);
  if (r.code === 0 && r.ok && !r.fail) flaky.push(...(first.failed.length ? first.failed : [`${file.split('/').pop()} › no result could be read`]));
  add(file, r);
}

const secs = (Date.now() - t0) / 1000;
for (const f of broken) process.stdout.write(`(fail) ${f.slice(2)}: no result could be read from this file\n`);
const fail = sum.fail + broken.length;
const code = worst || (fail ? 1 : 0);
for (const f of flaky) process.stdout.write(`(flaky) ${f}: failed in the busy run, passed alone\n`);
process.stdout.write(`\n ${sum.pass} pass\n${sum.skip ? ` ${sum.skip} skip\n` : ''}${skipWords(why) ? ` skipped for want of a tool: ${skipWords(why)}\n` : ''}${sum.todo ? ` ${sum.todo} todo\n` : ''}${flaky.length ? ` ${flaky.length} flaky (passed on a second run)\n` : ''} ${fail} fail\n ${sum.expects} expect() calls\nRan ${sum.tests} tests across ${files.length} files. [${secs.toFixed(2)}s]\n`);
try { mkdirSync(dirname(timesFile), { recursive: true }); writeFileSync(timesFile, JSON.stringify(took, null, 1)); } catch { /* only a hint for the next run's order */ }
record({ pass: sum.pass, fail, files: files.length, code, failed: [...failed, ...broken.map((f) => `${f.split('/').pop()} › no result could be read`)], why, flaky });
sweep();
process.exit(code);
