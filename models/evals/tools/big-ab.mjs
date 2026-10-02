// Big-model mode: off vs on (the Arena → Big-model mode, `/test big`): the Practice 28 twice on a
// big model on a service (/remote's Another service, an Ollama), first with the settings a small
// model gets (Who decides App, 40 steps, 8 tries, 80 lines of output, Read 150 lines whole), then
// in big-model mode (models/runtime/remote.mjs BIG_HARNESS: Who decides Model with its helpers and
// four checks, 80 steps, 12 tries, 160 lines, Read 400 lines whole), each through
// bench/run.mjs --remote; then one results page and one line in the test record.
// The rule, written before the first run (1 Oct 2026): big-model mode holds when it passes at
// least as many tasks as off AND takes at most 25% more time in all (it reads more and decides
// for itself, so some more time is expected; fewer passes is not taken).
//   node models/evals/tools/big-ab.mjs [--remote <address>] [--remote-model <name>] [--only 1,7] [--order off,on] [--out dir]
//   --remote / --remote-model: the service and its model; else the remote /remote saved (its key from the Keychain)
//   --no-record: a look only; no line in the test record and no results page
//   --from <dir>: the page and the record line from two runs already made (<dir>/off and <dir>/on)
//   --dry: print the two commands it would run, and stop
// From a copy of the repo, AGENTIC_REPO=~/Desktop/agentic-coder sends the raw runs to the main
// folder's models/ and the page to its docs/. Stop (SIGTERM): the run under way saves what it did,
// the other side is not started, and the page shows what ran.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { HOME, BIG_HARNESS, directUrl, readKey, keyIdOf, recordTest, codeLabel } from '../../index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { buildPromptPage, sideTotals, flips } from './prompt-ab-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo this code runs from
const home = process.env.AGENTIC_REPO ?? root; // where the results go
const docsDir = process.env.AGENTIC_DOCS ?? (home === root ? DOCS_DIR : join(home, 'docs'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const only = opt('only', null);
const order = opt('order', 'off,on').split(',');
if (order.length !== 2 || !order.includes('off') || !order.includes('on')) { console.error('--order off,on or on,off'); process.exit(2); }
const look = args.includes('--no-record');
const from = opt('from', null);
export const SLOWER = 0.25; // big-model mode may take at most this much more time in all

// The service: as given, else the remote /remote saved (and its key, from the Keychain).
let saved = null;
try { saved = JSON.parse(readFileSync(join(HOME, 'settings.json'), 'utf8')).remote ?? null; } catch {}
const address = opt('remote', null) ?? (saved?.address ? directUrl(saved) : null);
const name = opt('remote-model', null) ?? (opt('remote', null) ? null : saved?.model || null);
if (!from && (!address || !name)) { console.error('no service: set one up in /remote (Another service), or give --remote <address> --remote-model <name>'); process.exit(2); }
const key = !opt('remote', null) && saved?.key ? readKey(keyIdOf(saved)) : process.env.AGENTIC_REMOTE_KEY;

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = from ?? opt('out') ?? join(home, 'models', 'remote', 'results', `big-ab-${stamp}`);

// One side's run: the Practice 28 (or the tasks picked) on the service, recorded by this script, not by it.
const benchArgs = (side) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--remote', address, '--remote-model', name, '--big', side, '--think', 'off',
  ...(only ? ['--only', only] : ['--set', '28']), '--out', join(out, side), '--no-record'];
if (args.includes('--dry')) { for (const s of order) console.log(`${s}: ${[process.execPath, ...benchArgs(s)].join(' ')}`); process.exit(0); }

let stopping = false;
let child = null;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('stopping: the run under way saves what it did, and the other side is not started');
  child?.kill(sig);
});

if (!from) {
  mkdirSync(out, { recursive: true });
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  for (const s of order) {
    if (stopping) break;
    console.log(`Big-model mode ${s}: the ${only ? `practice tasks ${only}` : 'Practice 28'} on ${name} at ${address}`);
    const code = await new Promise((ok) => {
      child = spawn(process.execPath, benchArgs(s), { cwd: root, env: { ...process.env, ...(key ? { AGENTIC_REMOTE_KEY: key } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
      // "PASS on  think=off  7-explain-code …": the Arena counts the lines that start with PASS or FAIL.
      createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, `$1 ${s}$2`)));
      createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
      child.on('exit', (c) => ok(c));
    });
    child = null;
    if (code !== 0 && !stopping) console.log(`the ${s} side's run ended with code ${code}`);
  }
}

const read = (s) => { try { return JSON.parse(readFileSync(join(out, s, 'summary.json'), 'utf8')); } catch { return null; } };
const sides = { off: read('off'), on: read('on') };
if (!sides.off && !sides.on) { console.error(`nothing to compare: no summary.json in ${join(out, 'off')} or ${join(out, 'on')}`); process.exit(1); }
const model = sides.on?.remote?.model ?? sides.off?.remote?.model ?? name;
const keep = (r) => (r ? { pass: Boolean(r.pass), secs: r.secs ?? 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null, route: r.route ?? null, why: r.why ?? '' } : null);
const tasks = [...new Set([...(sides.off?.results ?? []), ...(sides.on?.results ?? [])].map((r) => r.task))];
// The page builder's two sides are old and new: off is the way before, on the new one.
const rows = tasks.map((task) => ({ task, old: keep(sides.off?.results?.find((r) => r.task === task)), new: keep(sides.on?.results?.find((r) => r.task === task)) }));
const a = sideTotals(rows, 'old'), b = sideTotals(rows, 'new'), moved = flips(rows);
const want = only ? only.split(',').length : 28;
const full = a.tasks === want && b.tasks === want && !sides.off?.stopped && !sides.on?.stopped;
const passesHold = b.passed >= a.passed;
const timeHolds = a.secs > 0 ? b.secs <= a.secs * (1 + SLOWER) : null;
const pass = full && passesHold && timeHolds === true;
const change = a.secs > 0 ? Math.round((100 * (b.secs - a.secs)) / a.secs) : null;
const timeWords = change == null ? '' : change === 0 ? 'in the same time' : `in ${Math.abs(change)}% ${change < 0 ? 'less' : 'more'} time`;

const verdict = !full
  ? `A part run: ${Math.min(a.tasks, b.tasks)} of ${want} tasks ran both ways${sides.off?.stopped || sides.on?.stopped ? ', and it was stopped' : ''}. On those, big-model mode passed ${b.passed} and the small-model settings ${a.passed}${timeWords ? `, ${timeWords}` : ''}. The rule needs every task run both ways.`
  : pass ? `<b>Big-model mode holds.</b> ${model} passed ${b.passed} of ${want} with it, against ${a.passed} with the small-model settings, ${timeWords}.`
  : `<b>Big-model mode does not hold.</b> ${model} passed ${b.passed} of ${want} with it, against ${a.passed} with the small-model settings, ${timeWords}${!passesHold ? ': fewer passes' : `: more than ${Math.round(SLOWER * 100)}% slower`}.`;
const chips = [
  { text: `passes: on ${b.passed} ≥ off ${a.passed}`, ok: passesHold },
  { text: `time: on at most ${Math.round(SLOWER * 100)}% more${change == null ? '' : ` (${change >= 0 ? '+' : '−'}${Math.abs(change)}%)`}`, ok: timeHolds },
  { text: full ? `every task run both ways (${want})` : `a part run (${a.tasks} and ${b.tasks} of ${want})`, ok: full ? true : false },
  { text: `model calls: off ${a.modelCalls ?? '—'} · on ${b.modelCalls ?? '—'}`, ok: null },
];
const h = BIG_HARNESS;
const changed = [
  `<b>Who decides.</b> Off: the app sorts each task, runs a focused path for a fix, a change or a rename, and reads the files ahead. On: the model decides (no sorting, nothing read ahead, several calls a reply), with its helpers (the Agent tool) and the four checks Model starts with (next-step, tests, stuck, said-done).`,
  `<b>Reading.</b> Off: Read gives a file whole up to 150 lines, a part 150 lines at a time (400 at most). On: whole up to ${h.read.whole} lines, a part ${h.read.part} at a time (${h.read.max.toLocaleString()} at most).`,
  `<b>Room.</b> Off: 40 steps a request, 8 tries a fix, 80 lines of command output. On: ${h.steps} steps, ${h.tries} tries, ${h.outputLines} lines.`,
  '<b>The same both ways.</b> The model, its context (the size it is loaded at on the service), Effort Low, the tasks and their checks.',
];
const ctx = sides.on?.ctx ?? sides.off?.ctx ?? null;
const method = [
  `Model: ${model} on ${address}${ctx ? `, ${Math.round(ctx / 1024)}k context` : ''}, Effort Low. The ${only ? `practice tasks ${only}` : 'Practice 28'} both ways, ${order[0]} first, one after the other.`,
  'Each side is <code>bench/run.mjs --remote … --big off|on --no-record</code>: the same tasks, checks and context; only big-model mode differs. A service shared with other work may be slower at times, for both sides.',
  `The rule, written before the first run: big-model mode holds when it passes at least as many tasks as off and takes at most ${Math.round(SLOWER * 100)}% more time in all (the seconds of the tasks both ran).`,
  'A task’s seconds run from its first request to its last reply; loading the model is not in them.',
  `Code: <code>${codeLabel(root)}</code>. Run ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
];

const docs = existsSync(docsDir);
const slug = String(model).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const summary = { model, address, order, only, rule: `on passes ≥ off, time ≤ +${Math.round(SLOWER * 100)}%`, off: a, on: b, moved, full, pass, stopped: Boolean(sides.off?.stopped || sides.on?.stopped),
  page: docs && !look ? `tests/agentic-coder-big-model-mode-${slug}-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title: `Big-model mode: off vs on · ${model}`, dateline: `On a service · Effort Low · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed, method, raw: [relative(home, out)],
    names: { old: 'Off', new: 'Big-model mode', oldSub: 'small-model settings', newSub: 'decides, reads more', thing: 'mode' } }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
if (!look) recordTest({
  kind: 'tasks', model: `remote:${model}`, name: `Big-model mode: off vs on${only ? `, tasks ${only}` : ''}`, code: codeLabel(root), effort: 'low', ctx,
  passed: b.passed, total: b.tasks, secs: a.secs + b.secs, result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
  note: `off ${a.passed} of ${a.tasks} in ${Math.round(a.secs)} s · on ${b.passed} of ${b.tasks} in ${Math.round(b.secs)} s${moved.fixed.length ? ` · fixed: ${moved.fixed.join(', ')}` : ''}${moved.broke.length ? ` · broke: ${moved.broke.join(', ')}` : ''}`,
  bar: `on passes ≥ off, ≤ ${Math.round(SLOWER * 100)}% more time`, raw: relative(home, out), page: summary.page,
});
console.log(`Big-model mode on ${model}: off ${a.passed} of ${a.tasks}, on ${b.passed} of ${b.tasks} · ${full ? (pass ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
