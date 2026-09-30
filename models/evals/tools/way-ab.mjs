// Who decides: App vs Model (the Arena → Who decides, `/test way`): the Practice 28 twice on one
// model, first with the app deciding (as before: word rules sort each task, the focused paths,
// the files read ahead, the checks), then with the model deciding (terminal/src/agent/way.mjs:
// no sorting and no reading ahead, its own tools Map, CodeSearch, Rename, TestFirst and Remember,
// several calls a reply, the app's checks off), each through bench/run.mjs; then one results page
// and one line in the test record.
// The rule, written before the first run (30 Sep 2026): Model holds when it passes at least as
// many tasks as App AND takes at most 25% more time in all. The app's steps were built because the
// small models are slow a step (Gemma writes ~12 tokens a second), so some more time is expected;
// fewer passes is not taken. Holding is what would make Model the default.
//   node models/evals/tools/way-ab.mjs --model qwen [--think on|off] [--only 1,7] [--order app,model] [--out dir]
//   --no-record: a look only; no line in the test record and no results page
//   --from <dir>: the page and the record line from two runs already made
//                 (<dir>/app and <dir>/model, each a bench/run.mjs --out), no model
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
const think = opt('think', 'off') === 'on';
const only = opt('only', null);
const order = opt('order', 'app,model').split(',');
if (order.length !== 2 || !order.includes('app') || !order.includes('model')) { console.error('--order app,model or model,app'); process.exit(2); }
const look = args.includes('--no-record');
const from = opt('from', null);
export const SLOWER = 0.25; // Model may take at most this much more time in all

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = from ?? opt('out') ?? join(home, 'models', basename(modelFolder(model)), 'results', `way-ab-${stamp}`);

// One side's run: the Practice 28 (or the tasks picked) that way, recorded by this script, not by it.
const benchArgs = (w) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--model', model.id, ...(think ? ['--think', 'on', '--effort', 'high'] : ['--think', 'off']),
  ...(only ? ['--only', only] : ['--set', '28']), '--out', join(out, w), '--way', w, '--no-record'];
if (args.includes('--dry')) { for (const w of order) console.log(`${w}: ${[process.execPath, ...benchArgs(w)].join(' ')}`); process.exit(0); }

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
  for (const w of order) {
    if (stopping) break;
    console.log(`${w === 'app' ? 'App decides' : 'Model decides'}: the ${only ? `practice tasks ${only}` : 'Practice 28'} on ${model.name}, thinking ${think ? 'at High' : 'off'}`);
    const code = await new Promise((ok) => {
      child = spawn(process.execPath, benchArgs(w), { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      // "PASS model  think=off  7-explain-code …": the Arena counts the lines that start with PASS or FAIL.
      createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, `$1 ${w}$2`)));
      createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
      child.on('exit', (c) => ok(c));
    });
    child = null;
    if (code !== 0 && !stopping) console.log(`the ${w} way's run ended with code ${code}`);
  }
}

const read = (w) => { try { return JSON.parse(readFileSync(join(out, w, 'summary.json'), 'utf8')); } catch { return null; } };
const sides = { app: read('app'), model: read('model') };
if (!sides.app && !sides.model) { console.error(`nothing to compare: no summary.json in ${join(out, 'app')} or ${join(out, 'model')}`); process.exit(1); }
const keep = (r) => (r ? { pass: Boolean(r.pass), secs: r.secs ?? 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null, route: r.route ?? null, why: r.why ?? '' } : null);
const tasks = [...new Set([...(sides.app?.results ?? []), ...(sides.model?.results ?? [])].map((r) => r.task))];
// The page builder's two sides are old and new: App is the way before, Model the new one.
const rows = tasks.map((task) => ({ task, old: keep(sides.app?.results?.find((r) => r.task === task)), new: keep(sides.model?.results?.find((r) => r.task === task)) }));
const a = sideTotals(rows, 'old'), m = sideTotals(rows, 'new'), moved = flips(rows);
const want = only ? only.split(',').length : 28;
const full = a.tasks === want && m.tasks === want && !sides.app?.stopped && !sides.model?.stopped;
const passesHold = m.passed >= a.passed;
const timeHolds = a.secs > 0 ? m.secs <= a.secs * (1 + SLOWER) : null;
const pass = full && passesHold && timeHolds === true;
const change = a.secs > 0 ? Math.round((100 * (m.secs - a.secs)) / a.secs) : null;
const timeWords = change == null ? '' : change === 0 ? 'in the same time' : `in ${Math.abs(change)}% ${change < 0 ? 'less' : 'more'} time`;

const verdict = !full
  ? `A part run: ${Math.min(a.tasks, m.tasks)} of ${want} tasks ran both ways${sides.app?.stopped || sides.model?.stopped ? ', and it was stopped' : ''}. On those, the model deciding passed ${m.passed} and the app deciding ${a.passed}${timeWords ? `, ${timeWords}` : ''}. The rule needs every task run both ways.`
  : pass ? `<b>Model decides holds.</b> It passed ${m.passed} of ${want} against ${a.passed} with the app deciding, ${timeWords}.`
  : `<b>Model decides does not hold.</b> It passed ${m.passed} of ${want} against ${a.passed} with the app deciding, ${timeWords}${!passesHold ? ': fewer passes' : `: more than ${Math.round(SLOWER * 100)}% slower`}.`;
const chips = [
  { text: `passes: model ${m.passed} ≥ app ${a.passed}`, ok: passesHold },
  { text: `time: model at most ${Math.round(SLOWER * 100)}% more${change == null ? '' : ` (${change >= 0 ? '+' : '−'}${Math.abs(change)}%)`}`, ok: timeHolds },
  { text: full ? `every task run both ways (${want})` : `a part run (${a.tasks} and ${m.tasks} of ${want})`, ok: full ? true : false },
  { text: `model calls: app ${a.modelCalls ?? '—'} · model ${m.modelCalls ?? '—'}`, ok: null },
];
const changed = [
  '<b>It sorts.</b> App: word rules pick the kind (question, fix, change, rename), and a focused path runs for a fix, a change or a rename. Model: nothing is sorted; the model reads the task and decides, and calls <code>TestFirst</code> or <code>Rename</code> when it wants a focused path.',
  '<b>The first look.</b> App: the files named, the closest files, the project map and the helpers are read before the first step. Model: nothing is read ahead; the model uses <code>Map</code>, <code>CodeSearch</code>, List, Search and Read itself, several calls a reply (Read takes several paths, for Gemma, which sends one call a reply).',
  '<b>Safety nets.</b> App: a question cannot change files, and the app’s checks send work back (empty reply, “do it now”, tests after a change, removed function, done check). Model: the permission mode decides (the bench auto-accepts, as for App), and every check is off (the hooks).',
  '<b>Done.</b> The same both ways here: each task’s own check decides pass or fail. (The memory is off in a practice run, so <code>Remember</code> saves nothing.)',
];
const method = [
  `Model: ${model.name}, thinking ${think ? 'on at High' : 'off (Low, the default)'}. The ${only ? `practice tasks ${only}` : 'Practice 28'} both ways, ${order[0]} first, one after the other on the same Mac.`,
  'Each side is <code>bench/run.mjs … --way app|model --no-record</code>: the same tasks, checks, helpers and context; only who decides differs.',
  `The rule, written before the first run: the model deciding holds when it passes at least as many tasks as the app deciding and takes at most ${Math.round(SLOWER * 100)}% more time in all (the seconds of the tasks both ran).`,
  'A task’s seconds run from its first request to its last reply; loading the model is not in them.',
  `Code: <code>${codeLabel(root)}</code>. Run ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
];

const docs = existsSync(docsDir);
const summary = { model: model.id, think, order, only, rule: `model passes ≥ app, time ≤ +${Math.round(SLOWER * 100)}%`, app: a, modelDecides: m, moved, full, pass, stopped: Boolean(sides.app?.stopped || sides.model?.stopped),
  page: docs && !look ? `tests/agentic-coder-who-decides-app-vs-model-${model.id}-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title: `Who decides: App vs Model · ${model.name}`, dateline: `Thinking ${think ? 'at High' : 'off'} · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed, method, raw: [relative(home, out)],
    names: { old: 'App decides', new: 'Model decides', oldSub: 'as before', newSub: 'like Claude Code', thing: 'way' } }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
if (!look) recordTest({
  kind: 'tasks', model: model.id, name: `Who decides: App vs Model${only ? `, tasks ${only}` : ''}`, code: codeLabel(root), effort: think ? 'high' : 'low', ctx: sides.model?.ctx ?? sides.app?.ctx ?? null,
  passed: m.passed, total: m.tasks, secs: a.secs + m.secs, result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
  note: `app ${a.passed} of ${a.tasks} in ${Math.round(a.secs)} s · model ${m.passed} of ${m.tasks} in ${Math.round(m.secs)} s${moved.fixed.length ? ` · fixed: ${moved.fixed.join(', ')}` : ''}${moved.broke.length ? ` · broke: ${moved.broke.join(', ')}` : ''}`,
  bar: `model passes ≥ app, ≤ ${Math.round(SLOWER * 100)}% more time`, raw: relative(home, out), page: summary.page,
});
console.log(`Who decides on ${model.name}: app ${a.passed} of ${a.tasks}, model ${m.passed} of ${m.tasks} · ${full ? (pass ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
