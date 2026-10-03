// The skills check (▶ Run a test → Skills check, `/test skills`): does a skill from
// SKILLS.md help the real model, on this Mac? The example skill "Write a test" (the one
// terminal/rules/SKILLS.md ships switched off) is turned on in a throwaway rules folder
// (AGENTIC_RULES_DIR) and three test-writing tasks each run twice through
// `coding -p --yes`: without skills (the app's own path, as today) and with it (the app
// picks it by its words; the steps go with the request, step by step). A seventh run asks
// without the skill's words, so only the skills list can lead the model to it.
// A task passes when a new test of the named function is in a test file, the project's
// whole suite passes afterwards, and the code under test is unchanged.
// The rule, written before the first run: with the skill the model passes at least as
// many tasks as without, and takes at most 25% more time in all.
//   node models/evals/tools/skills-check.mjs --model qwen [--out dir] [--no-record]
//   node models/evals/tools/skills-check.mjs --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, HOME, modelFolder, contextCheck, hasDraft, recordTest, codeLabel } from '../../index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { skillsPage } from './skills-page.mjs';
import { BUN, CLI, llamaServers, options, pad, previousRun, rawOf, short, stampOf, toolsOf as tools, writeResultsPage } from './check-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const { opt } = options(args);
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const CTX = 32_768;
// The three tasks, each without and with the skill, then the one without its words.
export const TASKS = [
  { id: 'withtax', ask: 'add a test for withTax in src/cart.mjs', fn: 'withTax', file: 'src/cart.mjs' },
  { id: 'discount', ask: 'write a test for applyDiscount in src/price.mjs', fn: 'applyDiscount', file: 'src/price.mjs' },
  { id: 'empty', ask: 'add a unit test that total of an empty list is 0 (src/cart.mjs)', fn: 'total', file: 'src/cart.mjs' },
];
const BACKUP = { id: 'list', ask: 'create a file test/tax.test.mjs that checks withTax from src/cart.mjs', fn: 'withTax', file: 'src/cart.mjs' };
export const CHECKS = TASKS.length * 2 + 1;
const MAX_SLOWER = 0.25;

// "Ran just the new test file": some test command ran ("npm test -- test/x.test.mjs" counts),
// and the suite's second file left no mark, so the whole suite did not run.
export const oneFileOf = (bash, suiteRan) => !suiteRan && bash.some((b) => /\btest\b/.test(b));

// The verdict from the rows: the rule above, and what each side came to.
export function verdictOf(rows) {
  const side = (skill) => rows.filter((r) => r.arm === (skill ? 'skill' : 'none'));
  const [off, on] = [side(false), side(true)];
  const sum = (xs, k) => xs.reduce((n, r) => n + (r[k] ?? 0), 0);
  const a = { passed: off.filter((r) => r.ok).length, secs: sum(off, 'secs'), one: off.filter((r) => r.oneFile).length, n: off.length };
  const b = { passed: on.filter((r) => r.ok).length, secs: sum(on, 'secs'), one: on.filter((r) => r.oneFile).length, n: on.length };
  const slower = a.secs ? (b.secs - a.secs) / a.secs : 0;
  const holds = a.n === TASKS.length && b.n === TASKS.length && b.passed >= a.passed && slower <= MAX_SLOWER;
  const list = rows.find((r) => r.arm === 'list');
  return { off: a, on: b, slower, holds, opened: list ? Boolean(list.opened) : null };
}

const previous = (out, summary) => previousRun(out, summary, 'skills-check-');
const writePage = (out, rows, summary, prev) => writeResultsPage(skillsPage, out, rows, summary, prev);

const main = import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (main && args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, summary));
  console.log(`results page drawn again: ${summary.page}`);
  process.exit(0);
}
if (main) await run();

async function run() {
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
  for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
  const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
  if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
  
  const now = new Date();
  const stamp = stampOf(now);
  const out = opt('out') ?? join(modelFolder(model), 'results', `skills-check-${stamp}`);
  mkdirSync(out, { recursive: true });

  // A throwaway home (Who decides: App, the default), two rules folders and a small project.
  const tmp = mkdtempSync(join(tmpdir(), 'agentic-skills-check-'));
  const home = join(tmp, 'home');
  mkdirSync(home, { recursive: true });
  symlinkSync(join(HOME, 'engine'), join(home, 'engine'));
  symlinkSync(join(HOME, 'models'), join(home, 'models'));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: model.id, thinking: false, memory: false }));
  const shipped = readFileSync(join(root, 'terminal', 'rules', 'SKILLS.md'), 'utf8');
  const rulesFor = (on) => {
    const dir = join(tmp, on ? 'rules-skill' : 'rules-none');
    mkdirSync(dir, { recursive: true });
    for (const f of ['bug-fixing.md', 'TOOLS.md']) cpSync(join(root, 'terminal', 'rules', f), join(dir, f));
    // on: the shipped example turned on (the two lines around it taken out); off: as shipped (none on).
    writeFileSync(join(dir, 'SKILLS.md'), on ? shipped.replace('<!--\n## Write a test', '## Write a test').replace(/\n-->\n?$/, '\n') : shipped);
    return dir;
  };
  const rules = { none: rulesFor(false), skill: rulesFor(true) };
  const base = join(tmp, 'project');
  for (const d of ['src', 'test']) mkdirSync(join(base, d), { recursive: true });
  writeFileSync(join(base, 'package.json'), '{\n  "name": "shop",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n');
  writeFileSync(join(base, 'src', 'cart.mjs'), "export const RATE = 0.08;\n\n// The sum of the items' prices.\nexport const total = (items) => items.reduce((s, i) => s + i.price, 0);\n\n// The total with tax, rounded to cents.\nexport const withTax = (items) => Math.round(total(items) * (1 + RATE) * 100) / 100;\n");
  writeFileSync(join(base, 'src', 'price.mjs'), "// A price after a discount in percent, never below zero.\nexport function applyDiscount(price, percent) {\n  return Math.max(0, price - (price * percent) / 100);\n}\n");
  writeFileSync(join(base, 'test', 'cart.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/cart.mjs';\n\ntest('total adds the prices', () => {\n  assert.equal(total([{ price: 2 }, { price: 3 }]), 5);\n});\n");
  // Run with the whole suite only: it leaves a mark, so a run of just one file is told apart.
  writeFileSync(join(base, 'test', 'shipping.test.mjs'), "import test from 'node:test';\nimport { writeFileSync } from 'node:fs';\n\nwriteFileSync(new URL('../.suite-ran', import.meta.url), 'yes');\ntest('shipping is free', () => {});\n");
  spawnSync('git', ['init', '-q'], { cwd: base });
  spawnSync('git', ['-c', 'user.name=check', '-c', 'user.email=check@example.invalid', 'add', '.'], { cwd: base });
  spawnSync('git', ['-c', 'user.name=check', '-c', 'user.email=check@example.invalid', 'commit', '-qm', 'start'], { cwd: base });
  const quiet = { AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_HELPERS: 'off', AGENTIC_NO_OPEN: '1', AGENTIC_HOME: home };

      const testCount = (dir) => readdirSync(join(dir, 'test')).filter((f) => f.endsWith('.mjs') && f !== 'shipping.test.mjs').reduce((n, f) => n + (readFileSync(join(dir, 'test', f), 'utf8').match(/\btest\s*\(/g) ?? []).length, 0);
  const testsText = (dir) => readdirSync(join(dir, 'test')).filter((f) => f.endsWith('.mjs') && f !== 'shipping.test.mjs').map((f) => readFileSync(join(dir, 'test', f), 'utf8')).join('\n');
  function codingP(cwd, prompt, rulesDir, ms = 480_000) {
    return new Promise((ok) => {
      const t = Date.now();
      const p = spawn(BUN, [CLI, '-p', prompt, '--yes'], { cwd, env: { ...process.env, ...quiet, AGENTIC_RULES_DIR: rulesDir }, stdio: ['ignore', 'pipe', 'pipe'] });
      let o = '', e = '';
      p.stdout.on('data', (d) => { o += d; });
      p.stderr.on('data', (d) => { e += d; });
      const timer = setTimeout(() => p.kill('SIGTERM'), ms);
      p.on('exit', (code) => { clearTimeout(timer); ok({ code, out: o.trim(), err: e.trim(), secs: (Date.now() - t) / 1000 }); });
    });
  }
  const servers = () => llamaServers(home);

  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the run under way…'); });
  const rows = [];
  let n = 0;
  async function one(task, arm) {
    if (stopping) return;
    const cwd = join(tmp, `run-${++n}-${task.id}-${arm}`);
    cpSync(base, cwd, { recursive: true });
    writeFileSync(join(home, 'trust.json'), JSON.stringify({ [cwd]: new Date().toISOString() }));
    const mentions = () => testsText(cwd).split(task.fn).length - 1;
    const before = { tests: testCount(cwd), mentions: mentions(), code: readFileSync(join(cwd, task.file), 'utf8') };
    const r = await codingP(cwd, task.ask, arm === 'none' ? rules.none : rules.skill);
    const used = tools(r.err);
    const bash = used.filter((t) => t.startsWith('Bash('));
    const suiteByRun = existsSync(join(cwd, '.suite-ran')); // before the check's own run of the suite
    rmSync(join(cwd, '.suite-ran'), { force: true });
    const added = testCount(cwd) - before.tests;
    const names = mentions() > before.mentions; // the new test uses the function it was asked about
    const suite = spawnSync('node', ['--test'], { cwd, encoding: 'utf8', timeout: 60_000 });
    const same = readFileSync(join(cwd, task.file), 'utf8') === before.code;
    const ok = r.code === 0 && added > 0 && names && suite.status === 0 && same;
    const skill = /Skill: Write a test/.test(r.err) || /skill "Write a test"/.test(r.err);
    const opened = used.some((t) => /^Read\(SKILLS\//.test(t));
    // Just the one file: a test command ran, and the whole suite never did (its second file leaves a mark).
    const oneFile = oneFileOf(bash, suiteByRun);
    const detail = `${added > 0 ? `${added} new test${added === 1 ? '' : 's'}` : 'no new test'}${names ? '' : `, none of ${task.fn}`} · suite ${suite.status === 0 ? 'passes' : 'FAILS'} · ${same ? 'code unchanged' : 'CODE CHANGED'} · ${skill ? 'skill picked' : 'no skill'}${opened ? ' · opened SKILLS/' : ''} · ran ${bash.length ? bash.map((b) => short(b.slice(5, -1), 40)).join(', ') : 'no command'}${suiteByRun ? ' (the whole suite ran)' : ''} · ${used.length} steps${r.code ? ` · exit ${r.code}: ${short(r.err.split('\n').at(-1), 80)}` : ''}`;
    rows.push({ id: `${task.id}-${arm}`, task: task.id, arm, name: `${task.ask} · ${arm === 'none' ? 'no skill' : arm === 'skill' ? 'with the skill' : 'no skill words (the list)'}`, ok, detail: short(detail, 400), secs: Math.round(r.secs * 10) / 10, steps: used.length, skill, opened, oneFile, suiteByRun, answer: short(r.out, 300) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${rows.at(-1).name} · ${short(detail, 160)} · ${r.secs.toFixed(1)} s`);
  }

  const t0 = Date.now();
  console.log(`${model.name} · ${CHECKS} runs: 3 tasks without and with the skill "Write a test", then one without its words…`);
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  // A first request loads the model, so its seconds are not counted against either side.
  await codingP(base, 'say ready', rules.none, 300_000);
  for (const task of TASKS) { await one(task, 'none'); await one(task, 'skill'); }
  await one(BACKUP, 'list');
  for (const { pid } of servers()) { try { process.kill(pid, 'SIGTERM'); } catch {} }

  const v = verdictOf(rows);
  const full = rows.length === CHECKS;
  const passed = rows.filter((r) => r.ok).length;
  const code = codeLabel();
  const secs = (Date.now() - t0) / 1000;
  const look = args.includes('--no-record');
  const docs = !look && existsSync(DOCS_DIR);
  const summary = {
    model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
    checks: rows.length, of: CHECKS, passed, pass: full && v.holds, stopped: stopping || !full, verdict: v, load: Math.round(loadavg()[0] * 10) / 10,
    label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
    page: docs ? `tests/agentic-coder-skills-check-${model.id}-${stamp}.html` : '',
  };
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const prev = previous(out, summary);
  if (look) console.log('a look only: no results page, no line in the test record');
  else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
  else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
  if (!look) recordTest({
    kind: 'other', name: 'Skills check', model: model.id, ctx: CTX, passed, total: CHECKS, secs, part: !full, bar: `with the skill at least as many passed, at most ${MAX_SLOWER * 100}% slower`,
    result: !full ? 'stopped' : v.holds ? 'pass' : 'fail',
    note: `Without the skill ${v.off.passed} of ${v.off.n} in ${Math.round(v.off.secs)} s; with it ${v.on.passed} of ${v.on.n} in ${Math.round(v.on.secs)} s (${v.slower >= 0 ? '+' : ''}${Math.round(v.slower * 100)}%). Just the one test file run: ${v.off.one} vs ${v.on.one}. Without its words the model ${v.opened ? 'opened the skill from the list' : 'did not open the skill'}.`,
    raw: rawOf(out), page: summary.page,
  });
  console.log(`Skills check on ${model.name}: without ${v.off.passed}/${v.off.n} in ${Math.round(v.off.secs)} s · with the skill ${v.on.passed}/${v.on.n} in ${Math.round(v.on.secs)} s · ${v.holds ? 'HOLDS' : full ? 'DOES NOT HOLD' : 'STOPPED'}`);
  process.exit(v.holds ? 0 : 1);
}
