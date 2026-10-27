// The Bonsai check (the Arena → ▶ Run a test, `/test bonsai`; 27 Oct 2026): Bonsai 2 9B on the Ollama service
// on this Mac writes the notes page (practice task 29, the owner's own test prompt), thinking on, as the app ran
// it before 27 Oct ("before": the remote instructions, no form check) and as it runs it since ("after": the local
// instructions it gets by itself, models/runtime/remote.mjs OWN_REMOTES, and the page check's form pass). Both
// sides have the page check on (it is off in practice runs), 120 steps and 30 minutes a run. Each page it left
// is clicked through in a real browser (bench/tasks/29-notes-page/click-check.mjs, 16 checks), and task 29's own
// check (its words, its script, the same click-through) says pass or fail.
// The rule, written before the first run: after holds when its pages pass at least as many click checks in all
// as before's, and at least as many runs pass the task's check.
//   node models/evals/tools/bonsai-check.mjs [--remote <address>] [--remote-model bonsai-2:9b] [--reps 2]
//        [--sides before,after] [--out dir] [--no-record] [--from <dir>] [--dry]
// The service: as given, else http://localhost:11434 (the Ollama this Mac runs Bonsai on). Stop (SIGTERM): the
// run under way saves what it did, the rest is not started, and the page shows what ran.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { recordTest, codeLabel } from '../../index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { buildPromptPage, sideTotals } from './prompt-ab-page.mjs';
import { clickCheck } from '../bench/tasks/29-notes-page/click-check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo this code runs from
const home = process.env.AGENTIC_REPO ?? root; // where the results go
const docsDir = process.env.AGENTIC_DOCS ?? (home === root ? DOCS_DIR : join(home, 'docs'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const look = args.includes('--no-record');
const from = opt('from', null);
const SIDES = ['before', 'after'];
const sides = opt('sides', SIDES.join(',')).split(',');
if (!sides.length || sides.some((s) => !SIDES.includes(s))) { console.error(`--sides: some of ${SIDES.join(', ')}`); process.exit(2); }
const reps = Number(opt('reps', 2));
if (!(reps >= 1)) { console.error('--reps: a number, 1 or more'); process.exit(2); }
const address = opt('remote', 'http://localhost:11434');
const name = opt('remote-model', 'bonsai-2:9b');
const TASK = '29-notes-page';

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = from ?? opt('out') ?? join(home, 'models', 'remote', 'results', `bonsai-check-${stamp}`);

// Both sides: the page check on (practice runs have it off), as `coding -p` and a window that checks by itself run it.
const BOTH = { AGENTIC_DESIGN: 'on', AGENTIC_LAYOUT: 'on', AGENTIC_LAYOUT_ASK: 'off' };
const sideEnv = (side) => ({ ...BOTH, ...(side === 'before' ? { AGENTIC_INSTRUCTIONS: 'remote', AGENTIC_FORM_CHECK: 'off' } : {}) });
const benchArgs = (side) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--remote', address, '--remote-model', name, '--think', 'on',
  '--instructions', side === 'before' ? 'remote' : 'auto', '--only', '29', '--reps', String(reps), '--timeout', '1800', '--keep', '--out', join(out, side), '--no-record'];
if (args.includes('--dry')) { for (const s of sides) console.log(`${s}: ${Object.entries(sideEnv(s)).map(([k, v]) => `${k}=${v}`).join(' ')} ${[process.execPath, ...benchArgs(s)].join(' ')}`); process.exit(0); }

let stopping = false;
let child = null;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('stopping: the run under way saves what it did, and the rest is not started');
  child?.kill(sig);
});

if (!from) {
  mkdirSync(out, { recursive: true });
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  for (const s of sides) {
    if (stopping) break;
    console.log(`${s === 'before' ? 'Before' : 'After'}: the notes page ${reps} time${reps === 1 ? '' : 's'} on ${name} at ${address}`);
    const code = await new Promise((ok) => {
      child = spawn(process.execPath, benchArgs(s), { cwd: root, env: { ...process.env, ...sideEnv(s) }, stdio: ['ignore', 'pipe', 'pipe'] });
      // The Arena counts the lines that start with PASS or FAIL.
      createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, `$1 ${s}$2`)));
      createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
      child.on('exit', (c) => ok(c));
    });
    child = null;
    if (code !== 0 && !stopping) console.log(`the ${s} run ended with code ${code}`);
  }
}

// Each run's row: what task 29's check said, and its page clicked through (from the files the run kept).
const read = (s) => { try { return JSON.parse(readFileSync(join(out, s, 'summary.json'), 'utf8')); } catch { return null; } };
async function rowsOf(s) {
  const sum = read(s);
  const rows = [];
  for (const [i, r] of (sum?.results ?? []).filter((x) => x.task === TASK).entries()) {
    const kept = join(out, s, `${TASK}-think-on${(sum.reps ?? reps) > 1 ? `-rep${i + 1}` : ''}-files`, 'Desktop', 'notes.html');
    const click = existsSync(kept) ? await clickCheck(kept) : { skipped: 'no page written' };
    const clicks = click.skipped ? null : click.passed;
    const failed = click.skipped ? click.skipped : click.checks.filter((c) => !c.ok).map((c) => c.name).join(', ');
    rows.push({ task: `notes page, run ${i + 1}`, pass: Boolean(r.pass), clicks, total: click.total ?? 16, secs: r.secs ?? 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null,
      why: `${clicks == null ? 'no page' : `${clicks} of ${click.total} click checks`}${failed && clicks != null && clicks < click.total ? ` (fails: ${failed})` : ''}${r.why ? ` · ${r.why}` : ''}` });
  }
  return { sum, rows };
}
const got = Object.fromEntries(await Promise.all(sides.map(async (s) => [s, await rowsOf(s)])));
if (sides.every((s) => !got[s].sum)) { console.error(`nothing to compare: no summary.json under ${out}`); process.exit(1); }
const alone = sides.length === 1;
const a = got[alone ? sides[0] : 'before'].rows;
const b = got[alone ? sides[0] : 'after'].rows;
const rows = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => ({ task: `notes page, run ${i + 1}`, old: a[i] ?? null, new: b[i] ?? null }));
const clicksOf = (xs) => xs.reduce((n, x) => n + (x.clicks ?? 0), 0);
const passesOf = (xs) => xs.filter((x) => x.pass).length;
const stopped = sides.some((s) => got[s].sum?.stopped);
const full = !stopped && sides.every((s) => got[s].rows.length === reps);
const holds = !alone && full && clicksOf(b) >= clicksOf(a) && passesOf(b) >= passesOf(a);
const words = (xs) => `${clicksOf(xs)} of ${xs.length * 16} click checks, ${passesOf(xs)} of ${xs.length} runs pass`;
const verdict = alone ? `<b>Bonsai on the notes page (${sides[0]})</b>: ${words(a)}.`
  : !full ? `A part run: before ${words(a)}; after ${words(b)}. The rule needs every run on both sides.`
  : holds ? `<b>The new set-up holds.</b> ${name}: after ${words(b)}; before ${words(a)}.`
  : `<b>The new set-up does not hold.</b> ${name}: after ${words(b)}; before ${words(a)}.`;
const tot = (xs) => sideTotals(xs.map((x) => ({ old: x, new: x })), 'old');
const chips = alone ? [{ text: words(a), ok: null }] : [
  { text: `click checks: after ${clicksOf(b)} ≥ before ${clicksOf(a)}`, ok: full ? clicksOf(b) >= clicksOf(a) : null },
  { text: `runs that pass: after ${passesOf(b)} ≥ before ${passesOf(a)}`, ok: full ? passesOf(b) >= passesOf(a) : null },
  { text: `time: after ${Math.round(tot(b).secs / 60)} min, before ${Math.round(tot(a).secs / 60)} min in all`, ok: null },
];
const changed = [
  '<b>Before.</b> As the app ran Bonsai until 27 Oct 2026: the remote instructions (terminal/rules/remote: HARNESS.md, fourteen guides it opens by name), and the page check with no form pass.',
  '<b>After.</b> As it runs Bonsai since: the local instructions (terminal/rules, written for the small models on this Mac), which a model in OWN_REMOTES gets by itself, and the page check\'s form pass (it types a note, presses Save and looks for it on the page; what it finds goes back to the model).',
  '<b>The same on both sides.</b> The model at the context it is loaded at, thinking on, 120 steps, 30 minutes a run, the page check on, and two fixes that cannot be switched off: a guide or DESIGN.md asked for by its name alone opens, and a Read past a file\'s end says how long the file is now.',
];
const ctx = sides.map((s) => got[s].sum?.ctx).find(Boolean) ?? null;
const method = [
  `Model: ${name} on ${address}${ctx ? `, ${Math.round(ctx / 1024)}k context` : ''}, thinking on, the app deciding. Practice task 29 (the notes page) ${reps} time${reps === 1 ? '' : 's'} on each side, before then after.`,
  'Each side is <code>bench/run.mjs --remote … --only 29 --think on --keep</code> with the page check on; before adds <code>AGENTIC_INSTRUCTIONS=remote AGENTIC_FORM_CHECK=off</code>.',
  'Each page the run left on its Desktop is clicked through in headless Chrome (bench/tasks/29-notes-page/click-check.mjs: the button, the box in the middle with the page dimmed, Cancel, Save and the card it adds, Escape, reopening, dark mode, script errors). Pass is task 29\'s own check, which ends with the same click-through.',
  'The rule, written before the first run: after holds when its pages pass at least as many click checks in all as before\'s, and at least as many runs pass.',
  `Code: <code>${codeLabel(root)}</code>. Run ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
];
const docs = existsSync(docsDir);
const summary = { model: name, address, sides, reps, rule: 'after: click checks ≥ before, runs that pass ≥ before', before: alone ? null : { clicks: clicksOf(a), passes: passesOf(a) }, after: alone ? null : { clicks: clicksOf(b), passes: passesOf(b) }, rows, full, holds,
  page: docs && !look ? `tests/agentic-coder-bonsai-check-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const title = `Bonsai check · ${name}`;
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title, dateline: `On this Mac's Ollama · thinking on · the notes page · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed, method, raw: [relative(home, out)],
    names: { old: 'Before', new: 'After', oldSub: 'remote set, no form pass', newSub: 'local set, form pass', thing: 'set-up' } }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
const mine = alone ? a : b;
if (!look) recordTest({
  kind: 'tasks', model: `remote:${name}`, name: 'Bonsai check', code: codeLabel(root), effort: 'high', ctx,
  passed: passesOf(mine), total: mine.length, secs: sides.reduce((n, s) => n + tot(got[s].rows).secs, 0), result: full ? (alone || holds ? 'pass' : 'fail') : 'stopped', part: !full,
  note: alone ? words(a) : `after ${words(b)} · before ${words(a)}`,
  bar: 'after: click checks ≥ before, runs that pass ≥ before', raw: relative(home, out), page: summary.page,
});
console.log(`${title}: ${alone ? words(a) : `after ${words(b)} · before ${words(a)}`} · ${full ? (alone ? 'DONE' : holds ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
