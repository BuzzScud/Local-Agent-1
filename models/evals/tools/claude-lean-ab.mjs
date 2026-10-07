// Claude: lean vs full (the Arena → Claude: lean vs full, `/test claude-lean`): the 10 hard tasks twice on the
// Claude API as /remote saved it, first with the app's checks (AGENTIC_LEAN=off: the app decides, every check,
// reminder and put-back on, as every Claude run went before 7 Oct 2026), then on the lean harness, which a
// Claude model gets by itself since then (agent/way.mjs LEAN_AUTO), each through bench/run.mjs --remote claude;
// then one results page and one line in the test record.
// Why: on 7 Oct 2026 a Claude Opus 5.5 session spent 13 minutes and 43 replies ($1.55) and built nothing, while
// the app's checks, made for small models on this Mac, stepped in 11 times. The owner chose lean on Claude
// before this was measured ("turn it off on Claude now"); this check says whether it holds.
// The rule (set with the first run, 7 Oct 2026, as for Fewer steps): lean holds when it passes at least as many
// tasks, takes fewer replies, AND takes at least 10% less time in all.
//   node models/evals/tools/claude-lean-ab.mjs [--remote-model <name>] [--only 31,37] [--reps 2] [--order old,new] [--out dir]
//   --remote-model: another Claude model than the one /remote saved
//   --no-record: a look only; no line in the test record and no results page
//   --from <dir>: the page and the record line from two runs already made (<dir>/old and <dir>/new)
//   --dry: print the two commands it would run, and stop
// Each task costs money on the Claude API: the 10 hard tasks both ways cost about $3.50 on Opus 5.5 (7 Oct 2026).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { recordTest, codeLabel } from '../../index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { buildPromptPage, sideTotals, flips } from './prompt-ab-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo this code runs from
const home = process.env.AGENTIC_REPO ?? root; // where the results go
const docsDir = process.env.AGENTIC_DOCS ?? (home === root ? DOCS_DIR : join(home, 'docs'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const only = opt('only', null);
const reps = Number(opt('reps', 1));
const order = opt('order', 'old,new').split(',');
if (order.length !== 2 || !order.includes('old') || !order.includes('new')) { console.error('--order old,new or new,old'); process.exit(2); }
const look = args.includes('--no-record');
const from = opt('from', null);
const name = opt('remote-model', null);
export const FASTER = 0.1; // lean must take at least this much less time in all

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = from ?? opt('out') ?? join(home, 'models', 'remote', 'results', `claude-lean-ab-${stamp}`);

// One side's run: the hard tasks (or the tasks picked), thinking on as /remote starts a model, recorded by this script.
const benchArgs = (side) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--remote', 'claude', ...(name ? ['--remote-model', name] : []), '--think', 'on',
  ...(only ? ['--only', only] : ['--set', 'hard']), ...(reps > 1 ? ['--reps', String(reps)] : []), '--out', join(out, side), '--no-record'];
const sideEnv = (side) => ({ ...process.env, AGENTIC_LEAN: side === 'old' ? 'off' : 'on' });
if (args.includes('--dry')) { for (const s of order) console.log(`${s}: AGENTIC_LEAN=${sideEnv(s).AGENTIC_LEAN} ${[process.execPath, ...benchArgs(s)].join(' ')}`); process.exit(0); }

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
    console.log(`${s === 'old' ? 'Full' : 'Lean'}: the ${only ? `practice tasks ${only}` : '10 hard tasks'}${reps > 1 ? ` ×${reps}` : ''} on the Claude API`);
    const code = await new Promise((ok) => {
      child = spawn(process.execPath, benchArgs(s), { cwd: root, env: sideEnv(s), stdio: ['ignore', 'pipe', 'pipe'] });
      // "PASS old  think=on  31-hard-…": the Arena counts the lines that start with PASS or FAIL.
      createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, `$1 ${s}$2`)));
      createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
      child.on('exit', (c) => ok(c));
    });
    child = null;
    if (code !== 0 && !stopping) console.log(`the ${s} side's run ended with code ${code}`);
  }
}

const read = (s) => { try { return JSON.parse(readFileSync(join(out, s, 'summary.json'), 'utf8')); } catch { return null; } };
const sides = { old: read('old'), new: read('new') };
if (!sides.old && !sides.new) { console.error(`nothing to compare: no summary.json in ${join(out, 'old')} or ${join(out, 'new')}`); process.exit(1); }
const model = sides.new?.remote?.model ?? sides.old?.remote?.model ?? name ?? 'Claude';
const keep = (r) => (r ? { pass: Boolean(r.pass), secs: r.secs ?? 0, wait: 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null, route: r.route ?? null, why: r.why ?? '', usd: r.usd ?? null } : null);
// A task run more than once is one row a try, paired by try.
const keyOf = (r) => `${r.task}${reps > 1 ? ` · try ${r.rep ?? 1}` : ''}`;
const tasks = [...new Set([...(sides.old?.results ?? []), ...(sides.new?.results ?? [])].map(keyOf))];
const rows = tasks.map((task) => ({ task, old: keep(sides.old?.results?.find((r) => keyOf(r) === task)), new: keep(sides.new?.results?.find((r) => keyOf(r) === task)) }));
const a = sideTotals(rows, 'old'), b = sideTotals(rows, 'new'), moved = flips(rows);
const usdOf = (side) => rows.filter((r) => r.old && r.new).reduce((n, r) => n + (r[side].usd ?? 0), 0);
const stepsOf = (side) => rows.filter((r) => r.old && r.new).reduce((n, r) => n + (r[side].steps ?? 0), 0);
const want = (only ? only.split(',').length : 10) * reps;
const full = a.tasks === want && b.tasks === want && !sides.old?.stopped && !sides.new?.stopped;
const passesHold = b.passed >= a.passed;
const stepsHold = a.modelCalls != null && b.modelCalls != null ? b.modelCalls < a.modelCalls : null;
const timeHolds = a.secs > 0 ? b.secs <= a.secs * (1 - FASTER) : null;
const pass = full && passesHold && stepsHold === true && timeHolds === true;
const change = a.secs > 0 ? Math.round((100 * (b.secs - a.secs)) / a.secs) : null;
const timeWords = change == null ? '' : change === 0 ? 'in the same time' : `in ${Math.abs(change)}% ${change < 0 ? 'less' : 'more'} time`;
const money = (n) => `$${n.toFixed(2)}`;
const steps = `${b.modelCalls ?? '—'} replies against ${a.modelCalls ?? '—'}, ${money(usdOf('new'))} against ${money(usdOf('old'))}`;

const verdict = !full
  ? `A part run: ${Math.min(a.tasks, b.tasks)} of ${want} tasks ran both ways${sides.old?.stopped || sides.new?.stopped ? ', and it was stopped' : ''}. On those, lean passed ${b.passed} and full ${a.passed}${timeWords ? `, ${timeWords}` : ''} (${steps}). The rule needs every task both ways.`
  : pass ? `<b>Lean holds on Claude.</b> ${model} passed ${b.passed} of ${want} lean, against ${a.passed} with the app's checks, ${timeWords}: ${steps}.`
  : `<b>Lean does not hold on Claude.</b> ${model} passed ${b.passed} of ${want} lean, against ${a.passed} with the app's checks, ${timeWords} (${steps})${!passesHold ? ': fewer passes' : stepsHold !== true ? ': not fewer replies' : `: not ${Math.round(FASTER * 100)}% faster`}.`;
const chips = [
  { text: `passes: lean ${b.passed} ≥ full ${a.passed}`, ok: passesHold },
  { text: `replies: lean ${b.modelCalls ?? '—'} < full ${a.modelCalls ?? '—'} (fewer is better)`, ok: stepsHold },
  { text: `time: at least ${Math.round(FASTER * 100)}% less${change == null ? '' : ` (${change >= 0 ? '+' : '−'}${Math.abs(change)}%)`} (less is better)`, ok: timeHolds },
  { text: `cost: full ${money(usdOf('old'))} · lean ${money(usdOf('new'))} (less is better)`, ok: null },
  { text: `steps: full ${stepsOf('old')} · lean ${stepsOf('new')} (fewer is better)`, ok: null },
  { text: full ? `every task run both ways (${want})` : `a part run (${a.tasks} and ${b.tasks} of ${want})`, ok: full ? true : false },
];
const changed = [
  "<b>Full (as before 7 Oct 2026).</b> The app decides: it sorts the request, reads ahead, may take a focused path (tests first, drafts cross-checked), asks before it starts, checks each answer (Look first, files that exist, the cases, the second look), reminds the model of the request and its plan, and puts a failed message's changes back. One call a reply.",
  "<b>Lean (what a Claude model gets by itself since 7 Oct 2026).</b> Claude Code's way: the model decides every step and checks its own work; several calls a reply; the instructions gain four lines on checking its own work. Permissions, your own hooks, the memory and the notes when memory fills stay.",
  '<b>The same both ways.</b> The model, thinking on as /remote starts it, the tasks and their checks, the helpers.',
];
const ctx = sides.new?.ctx ?? sides.old?.ctx ?? null;
const method = [
  `Model: ${model} on the Claude API${ctx ? `, ${Math.round(ctx / 1024)}k context` : ''}, thinking on. The ${only ? `practice tasks ${only}` : '10 hard tasks'}${reps > 1 ? `, each ${reps} times,` : ''} both ways, ${order[0] === 'old' ? 'full' : 'lean'} first, one after the other.`,
  'Each side is <code>bench/run.mjs --remote claude --think on --no-record</code> with <code>AGENTIC_LEAN=off</code> or <code>on</code>: the same code, tasks and checks; only the harness differs.',
  `The rule, set with the first run: lean holds when it passes at least as many tasks, takes fewer replies, and takes at least ${Math.round(FASTER * 100)}% less time in all. The cost is the cost meter's (agent/spend.mjs, the Claude API's prices).`,
  'One run of a task says little: --reps 2 or more for a firmer answer.',
  `Code: <code>${codeLabel(root)}</code>. Run ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
];

const docs = existsSync(docsDir);
const slug = String(model).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const summary = { model, order, only, reps, rule: `lean passes ≥ full, fewer replies, time ≤ −${Math.round(FASTER * 100)}%`, old: { ...a, usd: usdOf('old') }, new: { ...b, usd: usdOf('new') }, moved, full, pass, rows,
  page: docs && !look ? `tests/agentic-coder-claude-lean-${slug}-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title: `Claude: lean vs full · ${model}`, dateline: `On the Claude API · thinking on · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed, method, raw: [relative(home, out)],
    names: { old: 'Full', new: 'Lean', oldSub: "the app's checks", newSub: 'the model decides', thing: 'harness' } }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
if (!look) recordTest({
  kind: 'tasks', model: `remote:${model}`, name: `Claude: lean vs full${only ? `, tasks ${only}` : ''}`, code: codeLabel(root), effort: 'high', ctx,
  passed: b.passed, total: b.tasks, secs: a.secs + b.secs, result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
  note: `full ${a.passed} of ${a.tasks}, ${a.modelCalls ?? '?'} replies, ${Math.round(a.secs)} s, ${money(usdOf('old'))} · lean ${b.passed} of ${b.tasks}, ${b.modelCalls ?? '?'} replies, ${Math.round(b.secs)} s, ${money(usdOf('new'))}${moved.fixed.length ? ` · fixed: ${moved.fixed.join(', ')}` : ''}${moved.broke.length ? ` · broke: ${moved.broke.join(', ')}` : ''}`,
  bar: `lean passes ≥ full, fewer replies, ≥ ${Math.round(FASTER * 100)}% less time`, raw: relative(home, out), page: summary.page,
});
console.log(`Claude lean vs full on ${model}: full ${a.passed} of ${a.tasks} (${a.modelCalls ?? '?'} replies, ${Math.round(a.secs)} s, ${money(usdOf('old'))}), lean ${b.passed} of ${b.tasks} (${b.modelCalls ?? '?'} replies, ${Math.round(b.secs)} s, ${money(usdOf('new'))}) · ${full ? (pass ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
