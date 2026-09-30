// Prompt old vs new (▶ Run a test → Prompt old vs new, `/test prompt`): the
// Practice 28 twice on one model, first with the system prompt from before
// 30 Sep 2026 (AGENTIC_PROMPT=old: no Work habits, the notes files neither
// labelled nor ranked, 6,000 characters of notes), then with today's, each
// through bench/run.mjs; then one results page and one line in the test record.
// The practice tasks have no notes files and run without the memory, so what
// differs in them is the Work habits block.
// The rule, written before the first run (30 Sep 2026): the new prompt holds when
// it passes at least as many tasks as the old one AND takes at most 10% longer in all.
//   node models/evals/tools/prompt-ab.mjs --model qwen [--think on|off] [--only 1,3] [--order old,new] [--out dir]
//   --no-record: a look only; no line in the test record and no results page
//   --from <dir>: the page and the record line from two runs already made
//                 (<dir>/old and <dir>/new, each a bench/run.mjs --out), no model
//   --dry: print the two commands it would run, and stop
// From a copy of the repo (a worktree nobody else edits), AGENTIC_REPO=~/Desktop/agentic-coder
// sends the raw runs to the main folder's models/ and the page to its cli docs, as the
// design test does.
// Stop (the Tests tab's Stop, SIGTERM): the run under way saves what it did, the
// other prompt is not started, and the page shows what ran.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { MODELS, DEFAULT_MODEL, modelFolder, recordTest, codeLabel } from '../../index.mjs';
import { WORK_HABITS, NOTES_RANK } from '../../../terminal/index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { buildPromptPage, sideTotals, flips } from './prompt-ab-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo this code runs from
const home = process.env.AGENTIC_REPO ?? root; // where the results go
const docsDir = process.env.AGENTIC_DOCS ?? (home === root ? DOCS_DIR : join(home, 'cli docs'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const think = opt('think', 'off') === 'on';
const only = opt('only', null);
const order = opt('order', 'old,new').split(',');
if (order.length !== 2 || !order.includes('old') || !order.includes('new')) { console.error('--order old,new or new,old'); process.exit(2); }
const look = args.includes('--no-record');
const from = opt('from', null);
const SLOWER = 0.1; // the new prompt may take this much longer in all

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = from ?? opt('out') ?? join(home, 'models', basename(modelFolder(model)), 'results', `prompt-ab-${stamp}`);

// One side's run: the Practice 28 (or the tasks picked) with that prompt, recorded by this script, not by it.
const benchArgs = (v) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--model', model.id, ...(think ? ['--think', 'on', '--effort', 'high'] : ['--think', 'off']),
  ...(only ? ['--only', only] : ['--set', '28']), '--out', join(out, v), '--prompt', v, '--no-record'];
if (args.includes('--dry')) { for (const v of order) console.log(`${v}: ${[process.execPath, ...benchArgs(v)].join(' ')}`); process.exit(0); }

let stopping = false;
let child = null;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('stopping: the run under way saves what it did, and the other prompt is not started');
  child?.kill(sig);
});

if (!from) {
  mkdirSync(out, { recursive: true });
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  for (const v of order) {
    if (stopping) break;
    console.log(`${v} prompt: the ${only ? `practice tasks ${only}` : 'Practice 28'} on ${model.name}${think ? ', thinking at High' : ''}`);
    const code = await new Promise((ok) => {
      child = spawn(process.execPath, benchArgs(v), { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      // "PASS old  think=off  1-json-flag …": the Tests tab counts the lines that start with PASS or FAIL.
      createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, `$1 ${v}$2`)));
      createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
      child.on('exit', (c) => ok(c));
    });
    child = null;
    if (code !== 0 && !stopping) console.log(`the ${v} prompt's run ended with code ${code}`);
  }
}

const read = (v) => { try { return JSON.parse(readFileSync(join(out, v, 'summary.json'), 'utf8')); } catch { return null; } };
const sides = { old: read('old'), new: read('new') };
if (!sides.old && !sides.new) { console.error(`nothing to compare: no summary.json in ${join(out, 'old')} or ${join(out, 'new')}`); process.exit(1); }
const keep = (r) => (r ? { pass: Boolean(r.pass), secs: r.secs ?? 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null, why: r.why ?? '' } : null);
const tasks = [...new Set([...(sides.old?.results ?? []), ...(sides.new?.results ?? [])].map((r) => r.task))];
const rows = tasks.map((task) => ({ task, old: keep(sides.old?.results?.find((r) => r.task === task)), new: keep(sides.new?.results?.find((r) => r.task === task)) }));
const o = sideTotals(rows, 'old'), n = sideTotals(rows, 'new'), moved = flips(rows);
const want = only ? only.split(',').length : 28;
const full = o.tasks === want && n.tasks === want && !sides.old?.stopped && !sides.new?.stopped;
const passesHold = n.passed >= o.passed;
const timeHolds = o.secs > 0 ? n.secs <= o.secs * (1 + SLOWER) : null;
const pass = full && passesHold && timeHolds === true;
const change = o.secs > 0 ? Math.round((100 * (n.secs - o.secs)) / o.secs) : null;
const timeWords = change == null ? '' : change === 0 ? 'in the same time' : `in ${Math.abs(change)}% ${change < 0 ? 'less' : 'more'} time`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const verdict = !full
  ? `A part run: ${o.tasks} of ${want} tasks ran with both prompts${sides.old?.stopped || sides.new?.stopped ? ', and it was stopped' : ''}. On those, the new prompt passed ${n.passed} and the old one ${o.passed}${timeWords ? `, ${timeWords}` : ''}. The rule needs every task run with both.`
  : pass ? `<b>The new prompt holds.</b> It passed ${n.passed} of ${want} against ${o.passed} for the old one, ${timeWords}.`
  : `<b>The new prompt does not hold.</b> It passed ${n.passed} of ${want} against ${o.passed} for the old one, ${timeWords}${!passesHold ? ': fewer passes' : ': more than 10% slower'}.`;
const chips = [
  { text: `passes: new ${n.passed} ≥ old ${o.passed}`, ok: passesHold },
  { text: `time: new at most 10% longer${change == null ? '' : ` (${change >= 0 ? '+' : '−'}${Math.abs(change)}%)`}`, ok: timeHolds },
  { text: full ? `every task run with both (${want})` : `a part run (${o.tasks} and ${n.tasks} of ${want})`, ok: full ? true : false },
];
const changed = [
  `<b>Work habits</b>: 8 lines after “Tool use”, in the part of the prompt kept on disk (about 200 tokens). This is the one change the practice tasks see.<pre>${esc(WORK_HABITS)}</pre>`,
  `<b>Which notes win</b>: one line above the project notes. Not in the practice tasks: they have no notes files, and they run without the memory.<pre>${esc(NOTES_RANK)}</pre>`,
  "<b>Each notes file named by its kind</b>: “From ~/AGENTS.md (the user's own rules, for every folder under the home folder):” where it was “From ~/AGENTS.md:”. Not in the practice tasks.",
  '<b>Room for the notes files</b>: 9,000 characters, was 6,000. Not in the practice tasks.',
  '<b>The date</b>: the Mac’s own calendar day in both runs. The old prompt’s UTC date was a bug, so the old run gets the fix too.',
];
const method = [
  `Model: ${esc(model.name)}${think ? ', thinking on at High' : ', thinking off'}. The ${only ? `practice tasks ${esc(only)}` : 'Practice 28'} with each prompt, ${order[0]} first, one after the other on the same Mac.`,
  `Each side is <code>bench/run.mjs … --prompt old|new --no-record</code>: the same tasks, checks, helpers and context as a Practice 28 run; only the system prompt differs.`,
  `The rule, written before the first run: the new prompt holds when it passes at least as many tasks as the old one and takes at most ${Math.round(SLOWER * 100)}% longer in all (the seconds of the tasks both ran).`,
  `A task's seconds run from its first request to its last reply; loading the model is not in them. Thinking tokens are the model's own count where it gives one.`,
  `Code: <code>${esc(codeLabel(root))}</code>. Run ${esc(now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}.`,
];

const docs = existsSync(docsDir);
const summary = { model: model.id, think, order, only, rule: `new passes ≥ old, time ≤ +${Math.round(SLOWER * 100)}%`, old: o, new: n, moved, full, pass, stopped: Boolean(sides.old?.stopped || sides.new?.stopped),
  page: docs && !look ? `tests/agentic-coder-prompt-old-vs-new-${model.id}-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title: `Prompt old vs new · ${model.name}`, dateline: `${think ? 'Thinking at High' : 'Thinking off'} · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed, method, raw: [relative(home, out)] }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
if (!look) recordTest({
  kind: 'tasks', model: model.id, name: `Prompt old vs new${only ? `, tasks ${only}` : ''}`, code: codeLabel(root), effort: think ? 'high' : 'low', ctx: sides.new?.ctx ?? sides.old?.ctx ?? null,
  passed: n.passed, total: n.tasks, secs: o.secs + n.secs, result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
  note: `old ${o.passed} of ${o.tasks} in ${Math.round(o.secs)} s · new ${n.passed} of ${n.tasks} in ${Math.round(n.secs)} s${moved.fixed.length ? ` · fixed: ${moved.fixed.join(', ')}` : ''}${moved.broke.length ? ` · broke: ${moved.broke.join(', ')}` : ''}`,
  bar: 'new passes ≥ old, ≤ +10% time', raw: relative(home, out), page: summary.page,
});
console.log(`Prompt old vs new on ${model.name}: old ${o.passed} of ${o.tasks}, new ${n.passed} of ${n.tasks} · ${full ? (pass ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
