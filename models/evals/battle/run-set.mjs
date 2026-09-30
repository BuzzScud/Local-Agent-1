// One model, one Battle set: the Work 28, the New 28, the Practice 28 or your own tests (My tests)
// on Gemma (or Qwen) alone, one test at a time, each the way the arena runs it (run-one.mjs: Low,
// the context helpers, a throwaway copy of the test's files, its own checks, 10 minutes at most
// once the model is loaded). The hub's ▶ Run a test starts it (One practice task is
// --set practice --only p12, or p18b for a copy of yours); it runs from Terminal too:
//   node models/evals/battle/run-set.mjs --model gemma --set work28|new28|practice|mine [--only w01,w05] [--out dir] [--think on]
// --think on: thinking on, at High (a battle runs Low); each test still stops at 10 minutes.
// It plays your copies in the arena (~/.agentic-coder/battle/tests/), so an edit made there is what
// runs. One line per test as it ends, then a line in the test record (Battle sets). Raw results:
// models/<model>/results/sets/<set>-<time>/<test>/ (result.json, events.jsonl, run.log, files/).
// Control-C (or SIGTERM, the hub's Stop) stops the test under way (it saves what it has), skips the
// rest, and records what ran as stopped; a second Control-C quits at once.
// AGENTIC_BATTLE_FAKE=1: stand-in runs (fake-one.mjs), no model, for the tests.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, modelFolder } from '../../registry.mjs';
import { recordTest, codeLabel } from '../record.mjs';
import { paths, seedSuites, listTests, readJson, LIMIT_SECS, SUITES } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const FAKE = process.env.AGENTIC_BATTLE_FAKE === '1';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const SETS = ['work28', 'new28', 'practice', 'mine'];
const model = MODELS[opt('model')];
const set = opt('set');
if (!model || !SETS.includes(set)) { console.error(`usage: run-set.mjs --model <${Object.keys(MODELS).join('|')}> --set <${SETS.join('|')}> [--only w01,w05]`); process.exit(2); }
const only = opt('only', null)?.split(',').map((s) => s.trim()).filter(Boolean);
const thinking = opt('think', 'off') === 'on';

seedSuites();
const P = paths();
const tests = listTests().filter((t) => t.suite === set && (!only || only.some((o) => t.id === o || t.id.startsWith(`${o}-`))));
if (!tests.length) { console.error(`no ${SUITES[set]} tests${only ? ` named ${only.join(', ')}` : ''} in ${P.tests}`); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(opt('out', join(modelFolder(model), 'results', 'sets', `${set}-${stamp}`)));
mkdirSync(outDir, { recursive: true });

// Keeps the Mac awake until this run ends.
if (!FAKE) { try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {} }

let stopping = false;
let child = null;
const stop = (sig) => {
  if (stopping) { if (sig === 'SIGINT') { try { process.kill(-child?.pid, 'SIGKILL'); } catch {} process.exit(130); } return; }
  stopping = true;
  console.log(`\nstopping: the test under way saves what it has, the rest are skipped; what ran is recorded as stopped${sig === 'SIGINT' ? ' (Control-C again quits without saving)' : ''}`);
  if (child) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

// One test, the way the arena runs it. Resolves with its result.json (or a failed one).
function playOne(t) {
  return new Promise((done) => {
    const out = join(outDir, t.id);
    mkdirSync(out, { recursive: true });
    const fd = openSync(join(out, 'run.log'), 'w');
    const env = { ...process.env }; delete env.FORCE_COLOR;
    child = spawn(process.execPath, [join(HERE, FAKE ? 'fake-one.mjs' : 'run-one.mjs'), '--model', model.id, '--test', join(P.tests, t.id), '--out', out, '--timeout', String(LIMIT_SECS), ...(thinking ? ['--think', 'on'] : [])], { cwd: REPO, env, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    // Loading is not counted in its 10 minutes: past that and a margin, it is stopped hard.
    const guard = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, (LIMIT_SECS + 150) * 1000);
    child.on('exit', (code, sig) => {
      clearTimeout(guard);
      child = null;
      const r = readJson(join(out, 'result.json'));
      if (r) return done(r);
      let tail = '';
      try { tail = readFileSync(join(out, 'run.log'), 'utf8').trim().split('\n').slice(-2).join(' · '); } catch {}
      done({ pass: false, error: `it ended without a result (${code ?? sig})${tail ? `: ${tail.slice(0, 200)}` : ''}`, secs: 0, stepCount: 0, checks: [] });
    });
  });
}

const whyOf = (r) => {
  if (r.error) return r.error;
  if (r.overLimit) return 'went past 10 minutes';
  if (r.stopped) return 'stopped';
  const bad = (r.checks ?? []).find((c) => !c.pass);
  return bad ? `${bad.label}${bad.why ? `: ${bad.why}` : ''}` : '';
};
const clock = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
const name = SUITES[set];
// Its line in the test record: one practice test by its number and title ("Practice test 18b: …"),
// your own tests as My tests, a whole set as "The Work 28".
const one = set === 'practice' && tests.length === 1 ? tests[0] : null;
const recName = (ran) => (one ? `Practice test ${one.n}${one.variant ?? ''}: ${one.title}, one model`
  : `${set === 'mine' ? name : `The ${name}`}${only ? ` (${ran} picked)` : ''}, one model`);
console.log(`${model.name} · ${name} · thinking ${thinking ? 'on (High)' : 'off (Low)'} · ${tests.length} test${tests.length === 1 ? '' : 's'}, one at a time, each stops at 10 minutes${FAKE ? ' · practice run: no model' : ''}`);
const rows = [];
const t0 = Date.now();
for (const t of tests) {
  if (stopping) break;
  const r = await playOne(t);
  // Stopped part way: this test did not get its chance, so it is left out, not failed.
  if (stopping && r.stopped) break;
  const pass = r.pass === true && !r.overLimit && !r.stopped && !r.error;
  const mark = r.pass == null && !r.error && !r.overLimit ? 'NONE' : pass ? 'PASS' : 'FAIL';
  const why = mark === 'NONE' ? 'no check: read its answer in the results' : pass ? '' : whyOf(r);
  rows.push({ id: t.id, title: t.title, kind: t.kind, pass, mark, secs: Math.round(r.secs ?? 0), steps: r.stepCount ?? 0, errors: r.errors ?? 0, why });
  console.log(`${mark}  ${t.id.padEnd(26)} ${String(Math.round(r.secs ?? 0)).padStart(4)}s  ${String(r.stepCount ?? 0).padStart(2)} steps${why ? `  — ${why}` : ''}`);
}
const passed = rows.filter((r) => r.pass).length;
const secs = rows.reduce((s, r) => s + r.secs, 0);
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ model: model.id, set, thinking, only: only ?? null, fake: FAKE, stopped: stopping, at: new Date(t0).toISOString(), passed, total: rows.length, secs, rows }, null, 1));
console.log(`${name} on ${model.name.split(' ')[0]}: ${passed} of ${rows.length} passed${stopping ? ' · stopped' : ''} · ${clock(secs)} of test time, ${clock((Date.now() - t0) / 1000)} in all`);
const failed = rows.filter((r) => !r.pass).map((r) => r.id);
if (rows.length) recordTest({ kind: 'sets', model: model.id, name: recName(rows.length), code: codeLabel(REPO), effort: thinking ? 'high' : 'low', ctx: 32768,
  passed, total: rows.length, secs, part: Boolean(only) || stopping, result: stopping ? 'stopped' : undefined,
  note: [FAKE ? 'practice run: no model ran' : '', failed.length ? `failed: ${failed.join(', ')}` : ''].filter(Boolean).join(' · '), raw: outDir });
console.log(`saved ${outDir}/summary.json`);
process.exit(0);
