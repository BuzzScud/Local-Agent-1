// Thinking old vs new (the Arena → Thinking old vs new, `/test thinking`): the Practice 28 twice on
// one model, thinking at High both times: first the way thinking was spent before 30 Sep 2026
// (AGENTIC_THINK=old: every try thinks, nothing steps down), then today's (think when it pays: the
// first round of tests and drafts is written without thinking, a try after a miss thinks; and past
// half a task's time it thinks only briefly), each through bench/run.mjs; then one results page and
// one line in the test record. Low (thinking off) is the same both ways, so it is not run.
// The rule, written before the first run (30 Sep 2026): the new way holds when it passes at least as
// many tasks as the old one AND takes at least 15% less time in all (runs of the same code have
// differed by about 10% by chance).
//   node models/evals/tools/think-ab.mjs --model qwen [--only 1,3] [--order old,new] [--out dir]
//   --no-record: a look only; no line in the test record and no results page
//   --from <dir>: the page and the record line from two runs already made
//                 (<dir>/old and <dir>/new, each a bench/run.mjs --out), no model
//   --dry: print the two commands it would run, and stop
// From a copy of the repo (a worktree nobody else edits), AGENTIC_REPO=~/Desktop/agentic-coder
// sends the raw runs to the main folder's models/ and the page to its docs/.
// Stop (the Arena's Stop, SIGTERM): the run under way saves what it did, the other way is not
// started, and the page shows what ran.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { MODELS, DEFAULT_MODEL, modelFolder, recordTest, codeLabel } from '../../index.mjs';
import { SETUP_THINK_CAP, THINK_BUDGET_SECS, STEP_DOWN_CAP } from '../../../terminal/index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { buildPromptPage, sideTotals, flips } from './prompt-ab-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo this code runs from
const home = process.env.AGENTIC_REPO ?? root; // where the results go
const docsDir = process.env.AGENTIC_DOCS ?? (home === root ? DOCS_DIR : join(home, 'docs'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const only = opt('only', null);
const order = opt('order', 'old,new').split(',');
if (order.length !== 2 || !order.includes('old') || !order.includes('new')) { console.error('--order old,new or new,old'); process.exit(2); }
const look = args.includes('--no-record');
const from = opt('from', null);
export const FASTER = 0.15; // the new way must take at least this much less time in all

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = from ?? opt('out') ?? join(home, 'models', basename(modelFolder(model)), 'results', `think-ab-${stamp}`);

// One side's run: the Practice 28 (or the tasks picked) at High with that way, recorded by this script, not by it.
const benchArgs = (v) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--model', model.id, '--think', 'on', '--effort', 'high',
  ...(only ? ['--only', only] : ['--set', '28']), '--out', join(out, v), '--thinking', v, '--no-record'];
if (args.includes('--dry')) { for (const v of order) console.log(`${v}: ${[process.execPath, ...benchArgs(v)].join(' ')}`); process.exit(0); }

let stopping = false;
let child = null;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('stopping: the run under way saves what it did, and the other way is not started');
  child?.kill(sig);
});

if (!from) {
  mkdirSync(out, { recursive: true });
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  for (const v of order) {
    if (stopping) break;
    console.log(`${v} thinking: the ${only ? `practice tasks ${only}` : 'Practice 28'} on ${model.name}, thinking at High`);
    const code = await new Promise((ok) => {
      child = spawn(process.execPath, benchArgs(v), { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      // "PASS old  think=on  1-json-flag …": the Arena counts the lines that start with PASS or FAIL.
      createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, `$1 ${v}$2`)));
      createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
      child.on('exit', (c) => ok(c));
    });
    child = null;
    if (code !== 0 && !stopping) console.log(`the ${v} way's run ended with code ${code}`);
  }
}

const read = (v) => { try { return JSON.parse(readFileSync(join(out, v, 'summary.json'), 'utf8')); } catch { return null; } };
const sides = { old: read('old'), new: read('new') };
if (!sides.old && !sides.new) { console.error(`nothing to compare: no summary.json in ${join(out, 'old')} or ${join(out, 'new')}`); process.exit(1); }
const keep = (r) => (r ? { pass: Boolean(r.pass), secs: r.secs ?? 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null, steppedDown: Boolean(r.steppedDown), why: r.why ?? '' } : null);
const tasks = [...new Set([...(sides.old?.results ?? []), ...(sides.new?.results ?? [])].map((r) => r.task))];
const rows = tasks.map((task) => ({ task, old: keep(sides.old?.results?.find((r) => r.task === task)), new: keep(sides.new?.results?.find((r) => r.task === task)) }));
const o = sideTotals(rows, 'old'), n = sideTotals(rows, 'new'), moved = flips(rows);
const stepped = rows.filter((r) => r.new?.steppedDown).map((r) => r.task);
const want = only ? only.split(',').length : 28;
const full = o.tasks === want && n.tasks === want && !sides.old?.stopped && !sides.new?.stopped;
const passesHold = n.passed >= o.passed;
const timeHolds = o.secs > 0 ? n.secs <= o.secs * (1 - FASTER) : null;
const pass = full && passesHold && timeHolds === true;
const change = o.secs > 0 ? Math.round((100 * (n.secs - o.secs)) / o.secs) : null;
const timeWords = change == null ? '' : change === 0 ? 'in the same time' : `in ${Math.abs(change)}% ${change < 0 ? 'less' : 'more'} time`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const verdict = !full
  ? `A part run: ${o.tasks} of ${want} tasks ran both ways${sides.old?.stopped || sides.new?.stopped ? ', and it was stopped' : ''}. On those, the new way passed ${n.passed} and the old one ${o.passed}${timeWords ? `, ${timeWords}` : ''}. The rule needs every task run both ways.`
  : pass ? `<b>The new way holds.</b> It passed ${n.passed} of ${want} against ${o.passed} for the old one, ${timeWords}.`
  : `<b>The new way does not hold.</b> It passed ${n.passed} of ${want} against ${o.passed} for the old one, ${timeWords}${!passesHold ? ': fewer passes' : `: not ${Math.round(FASTER * 100)}% faster`}.`;
const chips = [
  { text: `passes: new ${n.passed} ≥ old ${o.passed}`, ok: passesHold },
  { text: `time: new at least ${Math.round(FASTER * 100)}% less${change == null ? '' : ` (${change >= 0 ? '+' : '−'}${Math.abs(change)}%)`}`, ok: timeHolds },
  { text: full ? `every task run both ways (${want})` : `a part run (${o.tasks} and ${n.tasks} of ${want})`, ok: full ? true : false },
  { text: `stepped down: ${stepped.length} task${stepped.length === 1 ? '' : 's'}${stepped.length ? ` (${stepped.join(', ')})` : ''}`, ok: null },
];
const changed = [
  `<b>Think when it pays.</b> The first round of tests and drafts (two tests and two drafts, the work before the tries) is written without thinking. A try after a miss (✗) thinks, with the miss in front of it, and so does the round after tests and drafts disagree. The tries that fix or change the code think from the first one, as before. Old: every one of them thought, up to ${SETUP_THINK_CAP.toLocaleString('en-US')} tokens.`,
  `<b>The step-down.</b> Past half of a task’s time (${Math.round(THINK_BUDGET_SECS / 60)} minutes in the app, the task’s limit here), it thinks only briefly: the focused paths’ calls stop thinking, and the chat’s replies are capped at ${STEP_DOWN_CAP} tokens of thinking (the thinking switch stays on, since Gemma’s sits at the top of its prompt and turning it off would read the whole conversation again). Old: it thought fully until the limit cut it off.`,
  '<b>Not changed:</b> Low (thinking off), the model, its sampling, the thinking cap of a fix, and everything the practice tasks check.',
];
const method = [
  `Model: ${esc(model.name)}, thinking on at High. The ${only ? `practice tasks ${esc(only)}` : 'Practice 28'} both ways, ${order[0]} first, one after the other on the same Mac.`,
  'Each side is <code>bench/run.mjs … --think on --effort high --thinking old|new --no-record</code>: the same tasks, checks, helpers and context as a Practice 28 run; only the way thinking is spent differs.',
  `The rule, written before the first run: the new way holds when it passes at least as many tasks as the old one and takes at least ${Math.round(FASTER * 100)}% less time in all (the seconds of the tasks both ran). Runs of the same code have differed by about 10% by chance, hence the margin.`,
  'A task’s seconds run from its first request to its last reply; loading the model is not in them. Thinking tokens are the model’s own count where it gives one.',
  `Code: <code>${esc(codeLabel(root))}</code>. Run ${esc(now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}.`,
];

const docs = existsSync(docsDir);
const summary = { model: model.id, order, only, rule: `new passes ≥ old, time ≤ −${Math.round(FASTER * 100)}%`, old: o, new: n, moved, stepped, full, pass, stopped: Boolean(sides.old?.stopped || sides.new?.stopped),
  page: docs && !look ? `tests/agentic-coder-thinking-old-vs-new-${model.id}-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title: `Thinking old vs new · ${model.name}`, dateline: `Thinking at High · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed, method, raw: [relative(home, out)],
    names: { old: 'Old thinking', new: 'New thinking', oldSub: 'every try thinks', newSub: 'think when it pays', thing: 'way of thinking' } }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
if (!look) recordTest({
  kind: 'tasks', model: model.id, name: `Thinking old vs new${only ? `, tasks ${only}` : ''}`, code: codeLabel(root), effort: 'high', ctx: sides.new?.ctx ?? sides.old?.ctx ?? null,
  passed: n.passed, total: n.tasks, secs: o.secs + n.secs, result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
  note: `old ${o.passed} of ${o.tasks} in ${Math.round(o.secs)} s · new ${n.passed} of ${n.tasks} in ${Math.round(n.secs)} s${stepped.length ? ` · stepped down: ${stepped.join(', ')}` : ''}${moved.fixed.length ? ` · fixed: ${moved.fixed.join(', ')}` : ''}${moved.broke.length ? ` · broke: ${moved.broke.join(', ')}` : ''}`,
  bar: `new passes ≥ old, ≥ ${Math.round(FASTER * 100)}% less time`, raw: relative(home, out), page: summary.page,
});
console.log(`Thinking old vs new on ${model.name}: old ${o.passed} of ${o.tasks}, new ${n.passed} of ${n.tasks} · ${full ? (pass ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
