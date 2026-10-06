// Fewer steps: before vs after (the Arena → Fewer steps, `/test steps`): the 10 hard tasks twice on the
// model /remote uses on a service, first as before 6 Oct 2026 (AGENTIC_STEPS=old: a call under a name the
// app did not know was turned back, a Read of a folder was an error, and nothing said Read takes several
// files), then with those three (terminal/src/agent/tools.mjs oldSteps, agent.mjs READ_TIP), each through
// bench/run.mjs --remote; then one results page and one line in the test record.
// Why: four timed runs of Qwen3.6 35B on the service (6 Oct 2026) lost 12 of 46 steps to calls turned
// back, and read seven files in seven replies.
// The rule, written before the first run (6 Oct 2026): after holds when it passes at least as many tasks,
// takes fewer steps, AND takes at least 10% less working time in all (seconds less the time the service
// kept a reply waiting, which other work on a shared service decides, not this code).
//   node models/evals/tools/steps-ab.mjs [--remote <address>] [--remote-model <name>] [--only 31,37] [--reps 2] [--order old,new] [--out dir]
//   --remote / --remote-model: the service and its model; else the remote /remote saved (its key from the Keychain)
//   --no-record: a look only; no line in the test record and no results page
//   --from <dir>: the page and the record line from two runs already made (<dir>/old and <dir>/new)
//   --dry: print the two commands it would run, and stop
// From a copy of the repo, AGENTIC_REPO=~/Desktop/agentic-coder sends the raw runs to the main
// folder's models/ and the page to its docs/. Stop (SIGTERM): the run under way saves what it did,
// the other side is not started, and the page shows what ran.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { HOME, directUrl, readKey, keyIdOf, recordTest, codeLabel } from '../../index.mjs';
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
export const FASTER = 0.1; // after must take at least this much less working time in all

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
const out = from ?? opt('out') ?? join(home, 'models', 'remote', 'results', `steps-ab-${stamp}`);

// One side's run: the hard tasks (or the tasks picked), thinking on as /remote starts a model, recorded by this script.
const benchArgs = (side) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--remote', address, '--remote-model', name, '--think', 'on', '--effort', 'high',
  ...(only ? ['--only', only] : ['--set', 'hard']), ...(reps > 1 ? ['--reps', String(reps)] : []), '--out', join(out, side), '--no-record'];
const sideEnv = (side) => ({ ...process.env, AGENTIC_STEPS: side === 'old' ? 'old' : 'new', ...(key ? { AGENTIC_REMOTE_KEY: key } : {}) });
if (args.includes('--dry')) { for (const s of order) console.log(`${s}: AGENTIC_STEPS=${s} ${[process.execPath, ...benchArgs(s)].join(' ')}`); process.exit(0); }

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
    console.log(`${s === 'old' ? 'Before' : 'After'}: the ${only ? `practice tasks ${only}` : '10 hard tasks'}${reps > 1 ? ` ×${reps}` : ''} on ${name} at ${address}`);
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
const model = sides.new?.remote?.model ?? sides.old?.remote?.model ?? name;
const keep = (r) => (r ? { pass: Boolean(r.pass), secs: r.secs ?? 0, wait: r.time?.wait ?? 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null, route: r.route ?? null, why: r.why ?? '' } : null);
// A task run more than once is one row a try (31-hard-refactor-dedupe ×2 → two rows), paired by try.
const keyOf = (r) => `${r.task}${reps > 1 ? ` · try ${r.rep ?? 1}` : ''}`;
const tasks = [...new Set([...(sides.old?.results ?? []), ...(sides.new?.results ?? [])].map(keyOf))];
const rows = tasks.map((task) => ({ task, old: keep(sides.old?.results?.find((r) => keyOf(r) === task)), new: keep(sides.new?.results?.find((r) => keyOf(r) === task)) }));
const a = sideTotals(rows, 'old'), b = sideTotals(rows, 'new'), moved = flips(rows);
// Over the tasks both sides ran, as sideTotals counts them.
const waitOf = (side) => rows.filter((r) => r.old && r.new).reduce((n, r) => n + (r[side].wait ?? 0), 0);
const workA = a.secs - waitOf('old'), workB = b.secs - waitOf('new');
const want = (only ? only.split(',').length : 10) * reps;
const full = a.tasks === want && b.tasks === want && !sides.old?.stopped && !sides.new?.stopped;
const passesHold = b.passed >= a.passed;
const stepsHold = a.modelCalls != null && b.modelCalls != null ? b.modelCalls < a.modelCalls : null;
const timeHolds = workA > 0 ? workB <= workA * (1 - FASTER) : null;
const pass = full && passesHold && stepsHold === true && timeHolds === true;
const change = workA > 0 ? Math.round((100 * (workB - workA)) / workA) : null;
const timeWords = change == null ? '' : change === 0 ? 'in the same working time' : `in ${Math.abs(change)}% ${change < 0 ? 'less' : 'more'} working time`;
const steps = `${b.modelCalls ?? '—'} replies against ${a.modelCalls ?? '—'}, ${b.toolErrors ?? '—'} calls turned back against ${a.toolErrors ?? '—'}`;

const verdict = !full
  ? `A part run: ${Math.min(a.tasks, b.tasks)} of ${want} tasks ran both ways${sides.old?.stopped || sides.new?.stopped ? ', and it was stopped' : ''}. On those, after passed ${b.passed} and before ${a.passed}${timeWords ? `, ${timeWords}` : ''} (${steps}). The rule needs every task run both ways.`
  : pass ? `<b>Fewer steps holds.</b> ${model} passed ${b.passed} of ${want} after, against ${a.passed} before, ${timeWords}: ${steps}.`
  : `<b>Fewer steps does not hold.</b> ${model} passed ${b.passed} of ${want} after, against ${a.passed} before, ${timeWords} (${steps})${!passesHold ? ': fewer passes' : stepsHold !== true ? ': not fewer replies' : `: not ${Math.round(FASTER * 100)}% faster`}.`;
const chips = [
  { text: `passes: after ${b.passed} ≥ before ${a.passed}`, ok: passesHold },
  { text: `replies: after ${b.modelCalls ?? '—'} < before ${a.modelCalls ?? '—'} (fewer is better)`, ok: stepsHold },
  { text: `working time: at least ${Math.round(FASTER * 100)}% less${change == null ? '' : ` (${change >= 0 ? '+' : '−'}${Math.abs(change)}%)`} (less is better)`, ok: timeHolds },
  { text: `calls turned back: before ${a.toolErrors ?? '—'} · after ${b.toolErrors ?? '—'} (fewer is better)`, ok: null },
  { text: `waiting on the service: before ${Math.round(waitOf('old'))} s · after ${Math.round(waitOf('new'))} s (left out of the time)`, ok: null },
  { text: full ? `every task run both ways (${want})` : `a part run (${a.tasks} and ${b.tasks} of ${want})`, ok: full ? true : false },
];
const changed = [
  '<b>Names it uses.</b> Before: a call named RunCommand, run_command, shell or read_file, or a name in another case ("bash"), was told "There is no tool called"; Edit sent with "pattern", "original" or "old_content" for its old text, or Bash with "Command", was told it needs "old_text" or "command". After: each runs as the tool and argument it means.',
  '<b>A Read of a folder.</b> Before: an error, "Use List to see what is in it". After: what is in the folder, as a List gives it.',
  '<b>Several files a reply.</b> Before: nothing past the tool’s own words. After: two one-file Reads in a row, when the model decides, bring one line once a message: Read takes "paths", the other files can come together.',
  '<b>The same both ways.</b> The model, its context (the size it is loaded at on the service), thinking on at High as /remote starts it, the tasks and their checks.',
];
const ctx = sides.new?.ctx ?? sides.old?.ctx ?? null;
const method = [
  `Model: ${model} on ${address ?? 'the service'}${ctx ? `, ${Math.round(ctx / 1024)}k context` : ''}, thinking on. The ${only ? `practice tasks ${only}` : '10 hard tasks'}${reps > 1 ? `, each ${reps} times,` : ''} both ways, ${order[0]} first, one after the other.`,
  'Each side is <code>bench/run.mjs --remote … --think on --no-record</code> with <code>AGENTIC_STEPS=old</code> or <code>new</code>: the same code, tasks, checks and context; only the three changes differ.',
  `The rule, written before the first run: after holds when it passes at least as many tasks, takes fewer replies, and takes at least ${Math.round(FASTER * 100)}% less working time in all. Working time is a task’s seconds less the time the service kept its replies waiting (other work on a shared service), as the bench’s timing reads it.`,
  'A task’s seconds run from its first request to its last reply; loading the model is not in them. One run of a task says little on this model: --reps 2 or more for a firmer answer.',
  `Code: <code>${codeLabel(root)}</code>. Run ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
];

const docs = existsSync(docsDir);
const slug = String(model).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const summary = { model, address, order, only, reps, rule: `after passes ≥ before, fewer replies, working time ≤ −${Math.round(FASTER * 100)}%`, old: { ...a, wait: waitOf('old'), work: workA }, new: { ...b, wait: waitOf('new'), work: workB }, moved, full, pass, stopped: Boolean(sides.old?.stopped || sides.new?.stopped),
  page: docs && !look ? `tests/agentic-coder-fewer-steps-${slug}-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title: `Fewer steps: before vs after · ${model}`, dateline: `On a service · thinking on · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed, method, raw: [relative(home, out)],
    names: { old: 'Before', new: 'After', oldSub: 'calls turned back as before', newSub: 'the names it uses run', thing: 'change' } }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
if (!look) recordTest({
  kind: 'tasks', model: `remote:${model}`, name: `Fewer steps: before vs after${only ? `, tasks ${only}` : ''}`, code: codeLabel(root), effort: 'high', ctx,
  passed: b.passed, total: b.tasks, secs: a.secs + b.secs, result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
  note: `before ${a.passed} of ${a.tasks}, ${a.modelCalls ?? '?'} replies, ${Math.round(workA)} s working · after ${b.passed} of ${b.tasks}, ${b.modelCalls ?? '?'} replies, ${Math.round(workB)} s working${moved.fixed.length ? ` · fixed: ${moved.fixed.join(', ')}` : ''}${moved.broke.length ? ` · broke: ${moved.broke.join(', ')}` : ''}`,
  bar: `after passes ≥ before, fewer replies, ≥ ${Math.round(FASTER * 100)}% less working time`, raw: relative(home, out), page: summary.page,
});
console.log(`Fewer steps on ${model}: before ${a.passed} of ${a.tasks} (${a.modelCalls ?? '?'} replies, ${Math.round(workA)} s working), after ${b.passed} of ${b.tasks} (${b.modelCalls ?? '?'} replies, ${Math.round(workB)} s working) · ${full ? (pass ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
