// hearth door check (the Arena → hearth door check, 20 Nov 2026): Agentic Coder on hearth's API, before and after it
// treated hearth as hearth. The owner had connected it with their hearth key and a task took about 5 minutes, then
// failed ("A newer job from this key took its place"); its own request log said 82% of what hearth's 27b wrote was
// thinking nobody set, and every side job ended at its cap with nothing back. The same small change in a copy of the
// shop, through `coding -p` in a throwaway home on the owner's key, twice: GitHub's main as it was (--before, by default
// a clean copy of origin/main), then this code. Each run's requests are read from that home's activity record.
// The checks, written before the first run:
//   1 after: no step taken over by a newer job of the same key
//   2 after: every side job comes back with words (not cut off while thinking)
//   3 after: side jobs ask for no thinking, and the steps say their level (thinking sent on every call)
//   4 after: the change is made and the shop's tests pass
//   5 after: the request's working time at most 10% over before's
// Runs on hearth's 27b on Poseidon by default (--model hearth@poseidon-seats: the door names it so; "hearth@poseidon" matches no server): tests and measurements never go to the copy kept
// for customers. Usage: bun models/evals/tools/hearth-door-check.mjs [--before <checkout>] [--model <name>] [--look]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUN, root, options, pad, stampOf, previousRun, writeResultsPage, rebuildIfAsked, rawOf } from './check-kit.mjs';
import { makeShop, throwawayHome, trust } from './ab-kit.mjs';
import { hearthPage } from './hearth-door-check-page.mjs';

const o = options();
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const DIR = join(root, 'models', 'evals', 'results');
rebuildIfAsked(o, (dir, rows, summary) => writeResultsPage(hearthPage, dir, rows, summary, previousRun(dir, summary, 'hearth-door-')));

const { recordTest, codeLabel, HEARTH_ADDRESS } = await import('../../index.mjs');
const MODEL = o.opt('model', 'hearth@poseidon-seats');
const look = o.has('look');
const TASK = 'In src/price.mjs, applyDiscount can return a negative price when the percent is over 100. Make it never go below 0, add a test for that in test/price.test.mjs, and run the tests.';
const key = spawnSync('security', ['find-generic-password', '-s', 'agentic-coder-remote', '-a', 'hearth', '-w'], { encoding: 'utf8' }).stdout.trim();
if (!key) { console.log('no hearth key in the Keychain (agentic-coder-remote / hearth): set it up with /remote hearth first'); process.exit(2); }

// GitHub's main as it was, unless a checkout is named: a clean copy of origin/main with this repo's packages.
function beforeCheckout() {
  const named = o.opt('before', null);
  if (named) return { dir: named, code: spawnSync('git', ['-C', named, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'before' };
  const dir = mkdtempSync(join(tmpdir(), 'hearth-before-'));
  const tar = spawnSync('sh', ['-c', `git -C "${root}" archive origin/main | tar -x -C "${dir}"`]);
  if (tar.status !== 0) throw new Error('could not copy origin/main');
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  return { dir, code: spawnSync('git', ['-C', root, 'rev-parse', '--short', 'origin/main'], { encoding: 'utf8' }).stdout.trim() };
}

// One side: a throwaway home on hearth, a fresh shop, the request; then what its requests did.
async function arm(name, checkout) {
  const base = mkdtempSync(join(tmpdir(), `hearth-${name}-`));
  const shop = makeShop(join(base, 'shop'));
  const remote = { use: true, source: 'hearth', kind: 'openai', connect: 'https', address: HEARTH_ADDRESS, port: null, model: MODEL, context: 0, key: true, keyEnd: key.slice(-4), keyId: 'hearth' };
  const home = throwawayHome(join(base, 'home'), { remote, remotes: { hearth: remote }, instructions: 'auto' });
  trust(home, shop);
  const t0 = Date.now();
  const run = await new Promise((ok) => {
    const p = spawn(BUN, [join(checkout, 'terminal', 'src', 'cli.jsx'), '-p', TASK, '--yes', '--mode', 'bypass'], { cwd: shop, env: { ...process.env, AGENTIC_HOME: home, AGENTIC_REMOTE_KEY: key, AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => p.kill('SIGTERM'), 20 * 60_000);
    p.on('exit', (code) => { clearTimeout(timer); ok({ code, out, err }); });
  });
  const secs = (Date.now() - t0) / 1000;
  const file = join(home, 'activity', 'requests.jsonl');
  const reqs = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.at >= new Date(t0).toISOString()) : [];
  const steps = reqs.filter((r) => r.who === 'conversation');
  const sides = reqs.filter((r) => r.who !== 'conversation');
  const sum = (list, k) => list.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const wrote = sum(reqs, 'wroteTok'), think = sum(reqs, 'thinkTok');
  const tests = spawnSync('node', ['--test'], { cwd: shop, encoding: 'utf8' });
  const clamp = spawnSync('node', ['-e', "import('./src/price.mjs').then((m) => process.exit(m.applyDiscount(10, 150) === 0 && m.applyDiscount(10, 50) === 5 ? 0 : 1))"], { cwd: shop });
  const wroteTest = existsSync(join(shop, 'test', 'price.test.mjs'));
  return {
    secs, code: run.code, steps: steps.length, side: sides.length,
    sideWords: sides.filter((r) => r.end !== 'error' && r.end !== 'length' && (r.wroteTok || 0) > (r.thinkTok || 0)).length,
    sideThinking: sides.filter((r) => (r.thinkTok || 0) > 0).length,
    stepsThought: steps.filter((r) => r.think).length,
    taken: reqs.filter((r) => /took its place/.test(r.error || '')).length,
    errors: reqs.filter((r) => r.end === 'error').map((r) => String(r.error).slice(0, 160)),
    wrote, think, thinkShare: wrote ? think / wrote : null,
    workSecs: (sum(reqs, 'readMs') + sum(reqs, 'writeMs')) / 1000,
    waitSecs: Math.max(0, sum(reqs, 'secs') - (sum(reqs, 'readMs') + sum(reqs, 'writeMs')) / 1000),
    done: tests.status === 0 && clamp.status === 0 && wroteTest,
    answer: run.out.trim().slice(-400), reqs,
  };
}

const now = new Date();
const stamp = stampOf(now);
const out = join(DIR, `hearth-door-${stamp}`);
mkdirSync(out, { recursive: true });
const code = codeLabel();
const before = beforeCheckout();
console.log(`before: ${before.code} · after: ${code} · on ${MODEL}`);
const t0 = Date.now();
const b = await arm('before', before.dir);
console.log(`before: ${Math.round(b.secs)} s, ${b.steps} steps, ${b.side} side jobs (${b.sideWords} with words), ${b.taken} taken over, thinking ${pct(b.thinkShare)}`);
const a = await arm('after', root);
console.log(`after: ${Math.round(a.secs)} s, ${a.steps} steps, ${a.side} side jobs (${a.sideWords} with words), ${a.taken} taken over, thinking ${pct(a.thinkShare)}`);
const row = (id, name, ok, detail) => ({ id, name, ok, detail, secs: id === 'time' ? a.secs : 0 });
const rows = [
  row('taken', 'No step taken over by a newer job', a.taken === 0, `after ${a.taken}, before ${b.taken}${a.errors.length ? ` · errors: ${a.errors.join(' | ')}` : ''}`),
  row('side', 'Side jobs come back with words', a.side === 0 || a.sideWords === a.side, `after ${a.sideWords} of ${a.side}, before ${b.sideWords} of ${b.side}`),
  row('think', 'Side jobs ask for no thinking, and the steps say their level', a.sideThinking === 0 && a.steps > 0 && a.stepsThought === a.steps, `side jobs that thought: after ${a.sideThinking} of ${a.side}, before ${b.sideThinking} of ${b.side} · steps that said their level: after ${a.stepsThought} of ${a.steps}, before ${b.stepsThought} of ${b.steps} · thinking in all the 27b wrote: after ${pct(a.thinkShare)}, before ${pct(b.thinkShare)}`),
  row('done', 'The change made and the tests pass', a.done, `after ${a.done ? 'yes' : 'no'}, before ${b.done ? 'yes' : 'no'}`),
  row('time', 'Working time at most 10% over before', a.workSecs <= b.workSecs * 1.1, `after ${Math.round(a.workSecs)} s working (${Math.round(a.secs)} s in all), before ${Math.round(b.workSecs)} s (${Math.round(b.secs)} s)`),
];
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} · ${r.detail}`);
const pass = rows.every((r) => r.ok);
const secs = (Date.now() - t0) / 1000;
const strip = ({ reqs, ...x }) => x;
const summary = {
  name: 'hearth door check', model: MODEL, code, beforeCode: before.code, task: TASK, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: rows.length, passed: rows.filter((r) => r.ok).length, pass, stopped: false, arms: { before: strip(b), after: strip(a) },
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: look ? '' : `tests/agentic-coder-hearth-door-${stamp}.html`,
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(out, 'requests.json'), JSON.stringify({ before: b.reqs, after: a.reqs }, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else {
  writeResultsPage(hearthPage, out, rows, summary, previousRun(out, summary, 'hearth-door-'));
  console.log(`results page: ${summary.page}`);
  recordTest({
    kind: 'other', model: `remote:${MODEL}`, name: 'hearth door check', code, passed: summary.passed, total: rows.length, secs, part: false,
    result: pass ? 'pass' : 'fail', bar: 'after: no step taken over, side jobs back with words and no thinking, steps that said their level, the change made with tests passing, working time at most 10% over before',
    note: `before ${Math.round(b.secs)} s (${b.taken} taken over, ${b.sideWords}/${b.side} side jobs back), after ${Math.round(a.secs)} s (${a.taken} taken over, ${a.sideWords}/${a.side} back)`, raw: rawOf(out), page: summary.page,
  });
}
console.log(`hearth door check: ${pass ? 'PASSED' : 'FAILED'}`);
process.exit(pass ? 0 : 1);
