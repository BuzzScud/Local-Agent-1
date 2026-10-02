// Instructions: local vs remote (the Arena → ▶ Run a test, `/test remote-rules`; 2 Oct 2026): one model
// on a service (/remote's Another service, an Ollama) plays the same tasks with each set of prompt
// files (terminal/src/agent/prompt-files.mjs): the local set, the one the 9–12B models on this Mac get
// (terminal/rules), then the remote set (terminal/rules/remote: HARNESS.md, its TOOLS.md, nine guides
// and its skills), then the remote set with its skills off (a skill takes a request off the app's
// focused change and fix paths, so whether they help is measured, not assumed). The app decides on
// every side. The tasks: the Practice 28 and the 10 hard ones (30–39), each through
// bench/run.mjs --remote … --instructions local|remote; then one results page and one line in the
// test record.
// The rule, written before the first run (2 Oct 2026): the remote set holds when, on each set of
// tasks, it passes at least as many as the local set AND takes at most 25% more time in all.
//   node models/evals/tools/remote-rules-ab.mjs [--remote <address>] [--remote-model <name>] [--set 28|hard|both]
//        [--sides local,remote,remote-noskills] [--only 1,7] [--out dir] [--no-record] [--from <dir>] [--dry]
//   --remote / --remote-model: the service and its model; else the remote /remote saved (its key from the Keychain)
//   --sides remote --set hard: the hard tasks alone on the remote set ("Hard practice tasks", /test hard)
// From a copy of the repo, AGENTIC_REPO=~/Desktop/agentic-coder sends the raw runs to the main folder's
// models/ and the page to its docs/. Stop (SIGTERM): the run under way saves what it did, the rest is not
// started, and the page shows what ran.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
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
const look = args.includes('--no-record');
const from = opt('from', null);
export const SLOWER = 0.25; // the remote set may take at most this much more time in all
export const SIDES = ['local', 'remote', 'remote-noskills'];
const sides = opt('sides', SIDES.join(',')).split(',');
if (!sides.length || sides.some((s) => !SIDES.includes(s))) { console.error(`--sides: some of ${SIDES.join(', ')}`); process.exit(2); }
const setWord = opt('set', 'both');
const sets = setWord === 'both' ? ['28', 'hard'] : [setWord];
if (sets.some((s) => !['28', 'hard'].includes(s))) { console.error('--set 28, hard or both'); process.exit(2); }
const alone = sides.length === 1; // one side: a plain run of the tasks (the Hard practice tasks entry)

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
const out = from ?? opt('out') ?? join(home, 'models', 'remote', 'results', `${alone ? 'hard' : 'rules-ab'}-${stamp}`);

// The remote set without its skills: a copy of terminal/rules whose remote SKILLS.md has none
// (a file there with no "## " skill is used as it is; only a missing one falls back to the local).
function noSkillsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-rules-noskills-'));
  cpSync(join(root, 'terminal', 'rules'), dir, { recursive: true });
  writeFileSync(join(dir, 'remote', 'SKILLS.md'), '# Skills (remote models)\n\nSwitched off for this run (remote-rules-ab.mjs, remote-noskills).\n');
  return dir;
}
const sideEnv = (side) => ({
  AGENTIC_INSTRUCTIONS: side === 'local' ? 'local' : 'remote',
  ...(side === 'remote-noskills' ? { AGENTIC_RULES_DIR: noSkillsDir() } : {}),
});
const benchArgs = (side, set) => [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--remote', address, '--remote-model', name, '--think', 'off',
  '--instructions', side === 'local' ? 'local' : 'remote', ...(only ? ['--only', only] : ['--set', set]), '--out', join(out, set, side), '--no-record'];
if (args.includes('--dry')) { for (const set of sets) for (const s of sides) console.log(`${set} ${s}: ${Object.entries(sideEnv(s)).map(([k, v]) => `${k}=${v}`).join(' ')} ${[process.execPath, ...benchArgs(s, set)].join(' ')}`); process.exit(0); }

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
  for (const set of sets) for (const s of sides) {
    if (stopping) break;
    console.log(`${s === 'local' ? 'Local' : s === 'remote' ? 'Remote' : 'Remote, skills off'}: the ${only ? `tasks ${only}` : set === 'hard' ? '10 hard tasks' : 'Practice 28'} on ${name} at ${address}`);
    const code = await new Promise((ok) => {
      child = spawn(process.execPath, benchArgs(s, set), { cwd: root, env: { ...process.env, ...sideEnv(s), ...(key ? { AGENTIC_REMOTE_KEY: key } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
      // The Arena counts the lines that start with PASS or FAIL.
      createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, `$1 ${s}$2`)));
      createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
      child.on('exit', (c) => ok(c));
    });
    child = null;
    if (code !== 0 && !stopping) console.log(`the ${set} ${s} run ended with code ${code}`);
  }
}

const read = (set, s) => { try { return JSON.parse(readFileSync(join(out, set, s, 'summary.json'), 'utf8')); } catch { return null; } };
const keep = (r) => (r ? { pass: Boolean(r.pass), secs: r.secs ?? 0, steps: r.steps ?? null, ownSteps: r.ownSteps ?? null, modelCalls: r.modelCalls ?? null, toolErrors: r.toolErrors ?? null, thinkTokens: r.thinkTokens ?? null, route: r.route ?? null, why: r.why ?? '' } : null);
const want = (set) => (only ? only.split(',').length : set === 'hard' ? 10 : 28);
// Per set of tasks: each side's rows and totals; the page compares local (old) with remote (new).
const per = sets.map((set) => {
  const runs = Object.fromEntries(sides.map((s) => [s, read(set, s)]));
  const tasks = [...new Set(Object.values(runs).flatMap((r) => (r?.results ?? []).map((x) => x.task)))];
  const rowsOf = (a, b) => tasks.map((task) => ({ task, old: keep(runs[a]?.results?.find((r) => r.task === task)), new: keep(runs[b]?.results?.find((r) => r.task === task)) }));
  const base = alone ? sides[0] : 'local';
  const main = alone ? sides[0] : sides.includes('remote') ? 'remote' : sides.find((s) => s !== 'local');
  const rows = rowsOf(base, main);
  const totals = Object.fromEntries(sides.map((s) => [s, sideTotals(rowsOf(s, s), 'old')]));
  const stopped = Object.values(runs).some((r) => r?.stopped);
  const full = !stopped && sides.every((s) => totals[s].tasks === want(set));
  return { set, runs, rows, totals, full, base, main, stopped, ctx: Object.values(runs).find((r) => r?.ctx)?.ctx ?? null };
});
if (per.every((p) => Object.values(p.runs).every((r) => !r))) { console.error(`nothing to compare: no summary.json under ${out}`); process.exit(1); }
const model = per.flatMap((p) => Object.values(p.runs)).find((r) => r?.remote?.model)?.remote?.model ?? name;
const setName = (set) => (set === 'hard' ? 'the 10 hard tasks' : only ? `tasks ${only}` : 'the Practice 28');

// The verdict per set: the remote set (skills on, or off when only that side ran) against the local one.
const judged = per.map((p) => {
  const a = p.totals[p.base], b = p.totals[p.main];
  const passesHold = b.passed >= a.passed;
  const timeHolds = a.secs > 0 ? b.secs <= a.secs * (1 + SLOWER) : null;
  const change = a.secs > 0 ? Math.round((100 * (b.secs - a.secs)) / a.secs) : null;
  return { ...p, a, b, passesHold, timeHolds, change, holds: p.full && passesHold && timeHolds === true };
});
const full = judged.every((j) => j.full);
const pass = alone ? full && judged.every((j) => j.a.passed === j.a.tasks) : full && judged.every((j) => j.holds);
const timeWords = (c) => (c == null ? '' : c === 0 ? 'in the same time' : `in ${Math.abs(c)}% ${c < 0 ? 'less' : 'more'} time`);
const line = (j) => (alone
  ? `${setName(j.set)}: ${j.a.passed} of ${j.a.tasks} passed in ${Math.round(j.a.secs)} s`
  : `${setName(j.set)}: remote ${j.b.passed} of ${j.b.tasks}, local ${j.a.passed} of ${j.a.tasks}, ${timeWords(j.change)}${j.totals['remote-noskills'] && j.main !== 'remote-noskills' ? `; remote with its skills off ${j.totals['remote-noskills'].passed}` : ''}`);
const verdict = alone
  ? `<b>${model} on ${setName(judged[0].set)}</b> with the ${sides[0] === 'local' ? 'local' : 'remote'} instructions: ${judged.map(line).join('; ')}.`
  : !full ? `A part run: ${judged.map(line).join('; ')}. The rule needs every task run on every side.`
  : pass ? `<b>The remote instructions hold.</b> ${model}: ${judged.map(line).join('; ')}.`
  : `<b>The remote instructions do not hold.</b> ${model}: ${judged.map(line).join('; ')}.`;
const chips = alone ? [{ text: `${judged.reduce((n, j) => n + j.a.passed, 0)} of ${judged.reduce((n, j) => n + j.a.tasks, 0)} passed`, ok: pass }] : judged.flatMap((j) => [
  { text: `${j.set === 'hard' ? 'hard 10' : 'Practice 28'}: remote ${j.b.passed} ≥ local ${j.a.passed}`, ok: j.passesHold },
  { text: `${j.set === 'hard' ? 'hard 10' : 'Practice 28'}: time at most +${Math.round(SLOWER * 100)}%${j.change == null ? '' : ` (${j.change >= 0 ? '+' : '−'}${Math.abs(j.change)}%)`}`, ok: j.timeHolds },
  ...(j.totals['remote-noskills'] ? [{ text: `${j.set === 'hard' ? 'hard 10' : 'Practice 28'}: skills off ${j.totals['remote-noskills'].passed} in ${Math.round(j.totals['remote-noskills'].secs)} s`, ok: null }] : []),
]);
const changed = [
  '<b>Local.</b> The instructions the models on this Mac get (terminal/rules): the built-in opening, Work habits, Fixing a bug and Rules, TOOLS.md\'s Tool use lines, and no skills on.',
  '<b>Remote.</b> terminal/rules/remote: HARNESS.md\'s opening, How you work and rules, its TOOLS.md, the nine guides it opens by name (RULES/<NAME>.md), and four skills (Write a test, Review code, Refactor, Flaky test) that come with a request whose words they use.',
  '<b>Remote, skills off.</b> The same, with no skills: so no request leaves the app\'s focused change and fix paths for a skill\'s steps.',
  '<b>The same on every side.</b> The model, its context (the size it is loaded at on the service), Effort Low, the app deciding, the tasks and their checks.',
];
const ctx = judged.find((j) => j.ctx)?.ctx ?? null;
const method = [
  `Model: ${model} on ${address ?? 'a service'}${ctx ? `, ${Math.round(ctx / 1024)}k context` : ''}, Effort Low, the app deciding. ${sets.map(setName).join(' and ')}, each side in turn (${sides.join(', ')}).`,
  'Each side is <code>bench/run.mjs --remote … --instructions local|remote --no-record</code>; skills off runs with a copy of terminal/rules whose remote SKILLS.md has none.',
  `The rule, written before the first run: the remote set holds when, on each set of tasks, it passes at least as many as the local set and takes at most ${Math.round(SLOWER * 100)}% more time in all.`,
  'A task\'s seconds run from its first request to its last reply; loading the model is not in them. The page\'s table compares local with remote; the other side is in the chips.',
  `Code: <code>${codeLabel(root)}</code>. Run ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
];

const docs = existsSync(docsDir);
const slug = String(model).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rows = judged.flatMap((j) => j.rows);
const summary = { model, address, sets, sides, only, rule: `remote passes ≥ local, time ≤ +${Math.round(SLOWER * 100)}% (each set)`, per: judged.map((j) => ({ set: j.set, totals: j.totals, full: j.full, holds: j.holds, moved: flips(j.rows) })), full, pass,
  page: docs && !look ? `tests/agentic-coder-${alone ? 'hard-tasks' : 'instructions-local-vs-remote'}-${slug}-${stamp}.html` : '' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const title = alone ? `Hard practice tasks · ${model}` : `Instructions: local vs remote · ${model}`;
if (summary.page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, summary.page), buildPromptPage({ title, dateline: `On a service · Effort Low · the app decides · ${now.toLocaleDateString('en-US', { dateStyle: 'medium' })}`,
    verdict, chips, rows, changed: alone ? changed.slice(sides[0] === 'local' ? 0 : 1, sides[0] === 'local' ? 1 : 2) : changed, method, raw: [relative(home, out)],
    names: alone ? { old: sides[0], new: sides[0], oldSub: 'the run', newSub: 'the run', thing: 'run' } : { old: 'Local', new: 'Remote', oldSub: 'terminal/rules', newSub: 'terminal/rules/remote', thing: 'instructions' } }));
  console.log(`results page: ${summary.page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
const passed = judged.reduce((n, j) => n + j.b.passed, 0);
const total = judged.reduce((n, j) => n + j.b.tasks, 0);
if (!look) recordTest({
  kind: 'tasks', model: `remote:${model}`, name: alone ? `Hard practice tasks${only ? `, tasks ${only}` : ''}` : `Instructions: local vs remote${only ? `, tasks ${only}` : ''}`, code: codeLabel(root), effort: 'low', ctx,
  passed, total, secs: judged.reduce((n, j) => n + Object.values(j.totals).reduce((m, t) => m + t.secs, 0), 0), result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: Boolean(only),
  note: judged.map(line).join(' · '),
  bar: alone ? 'every hard task passes' : `remote passes ≥ local, ≤ ${Math.round(SLOWER * 100)}% more time, on each set`, raw: relative(home, out), page: summary.page,
});
console.log(`${title}: ${judged.map(line).join(' · ')} · ${full ? (pass ? (alone ? 'ALL PASS' : 'HOLDS') : (alone ? 'NOT ALL' : 'DOES NOT HOLD')) : 'PART RUN'}`);
process.exit(0);
