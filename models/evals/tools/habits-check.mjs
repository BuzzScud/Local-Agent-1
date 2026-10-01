// The Tool habits check (▶ Run a test → Tool habits check, `/test habits`): do the four tool
// lines TOOLS.md got on 30 Sep change what the real model does, on this Mac? Four tasks, each
// aimed at one line, run twice: with the Tool use lines from before (old) and with TOOLS.md as
// shipped (new). The focused fix and change paths are off (--no-flows), so every task goes step by
// step and the tool lines are what guide it; Effort Low, as the app starts.
//   test file   "cover withTax … with a test": ran just that test file, not the whole suite
//   search      "where is the free-shipping limit set?": searched before its first Read (Who decides:
//               Model for this one, so the app reads nothing for it first)
//   done        "make applyDiscount never return a negative price": after its last change, it ran
//               something or read the file back itself before saying done
//   skill       "create test/tax.test.mjs …" (no skill words): opened SKILLS/write-a-test
// A task passes when its work is right (each says how below). The example skill is on in both.
// The rule, written before the first run: the new lines show more of the four habits than the
// old ones, and at least as many tasks pass. The time is shown, not judged.
//   node models/evals/tools/habits-check.mjs --model qwen [--out dir] [--no-record] [--url <a model server already up>]
//   node models/evals/tools/habits-check.mjs --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, modelFolder, recordTest, codeLabel } from '../../index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { ROOT, refusal, throwawayHome, trust, makeShop, codingP, ownToolLines, stopServers, previous, rawOf, stampOf, subOf, short } from './ab-kit.mjs';
import { habitsPage } from './habits-page.mjs';

// The Tool use lines before 30 Sep evening, word for word (terminal/src/agent/prompt-files.mjs TOOL_USE_OLD).
export const OLD_TOOL_USE = `- Use List, Search and Read to find the code; try a shorter search if needed.
- To change an existing file, use Edit with old_text copied exactly from Read, without line numbers. Include enough context to match once. Use Write for new files.
- Call one tool at a time and wait for its result.`;

export const TASKS = [
  { id: 'testfile', habit: 'ran just the test file', ask: 'cover withTax in src/cart.mjs with a test' },
  // Who decides: Model here, so the app reads nothing for it first and the first look is the model's own.
  { id: 'search', habit: 'searched before reading', ask: 'Where is the free-shipping limit set, and what is it?', args: ['--way', 'model'] },
  { id: 'done', habit: 'proved it before saying done', ask: 'make applyDiscount in src/price.mjs never return a negative price' },
  { id: 'skill', habit: 'opened the fitting skill', ask: 'create a file test/tax.test.mjs that checks withTax from src/cart.mjs' },
];
export const CHECKS = TASKS.length * 2;

// What `coding -p` printed, in order: the tool lines and the app's notes. A tool line is the model's
// own unless the app read it for it first (" [app]") or ran it as its own check (the note
// "Checking the change: …" just before it).
export function linesOf(err) {
  const lines = String(err ?? '').split('\n').filter((l) => /^[⏺✗·] /.test(l)).map((l) => ({ note: l.startsWith('· '), text: l.slice(2) }));
  return lines.map((l, i) => ({ ...l, own: !l.note && !l.text.endsWith(' [app]') && !(lines[i - 1]?.note && /^Checking the change/.test(lines[i - 1].text)) }));
}

// Each habit, from the run's lines (and, for the test file, whether the whole suite ran).
export function habitOf(id, err, { suiteRan = false } = {}) {
  const lines = linesOf(err);
  const tools = lines.filter((l) => l.own).map((l) => l.text);
  if (id === 'testfile') return !suiteRan && tools.some((t) => /^Bash\(.*\btest\b/.test(t));
  if (id === 'search') {
    const first = tools.findIndex((t) => /^(Search|CodeSearch|Read)\(/.test(t));
    return first >= 0 && /^(Search|CodeSearch)\(/.test(tools[first]);
  }
  if (id === 'done') {
    // After its last change, a Bash or Read of its own (not the app's check).
    const last = tools.map((t) => /^(Update|Write)\(/.test(t)).lastIndexOf(true);
    return last >= 0 && tools.slice(last + 1).some((t) => /^(Bash|Read)\(/.test(t));
  }
  if (id === 'skill') return tools.some((t) => /^Read\(SKILLS\//.test(t));
  return false;
}

// The verdict from the rows: the rule above, and what each side came to.
export function verdictOf(rows) {
  const side = (arm) => {
    const r = rows.filter((x) => x.arm === arm);
    return { passed: r.filter((x) => x.ok).length, habits: r.filter((x) => x.habit).length, secs: r.reduce((n, x) => n + (x.secs ?? 0), 0), n: r.length };
  };
  const old = side('old'), now = side('new');
  const holds = old.n === TASKS.length && now.n === TASKS.length && now.habits > old.habits && now.passed >= old.passed;
  return { old, new: now, holds };
}

function writePage(out, rows, summary, prev) {
  mkdirSync(dirname(docsPath(summary.page)), { recursive: true });
  writeFileSync(docsPath(summary.page), habitsPage({ summary, rows, prev, raw: [rawOf(out)] }));
}

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const main = import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (main && args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, 'habits-check-', summary));
  console.log(`results page drawn again: ${summary.page}`);
  process.exit(0);
}
if (main) await run();

async function run() {
  const model = MODELS[opt('model', DEFAULT_MODEL)];
  if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
  const CTX = 32_768;
  // --url: a model server already up (the end-to-end test uses a stand-in): nothing to start or refuse.
  const url = opt('url', null);
  const no = url ? null : await refusal(model, CTX);
  if (no) { console.error(`refused: ${no}`); process.exit(3); }
  const via = url ? ['--url', url] : [];
  const now = new Date();
  const stamp = stampOf(now);
  const out = opt('out') ?? join(modelFolder(model), 'results', `habits-check-${stamp}`);
  mkdirSync(out, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'agentic-habits-check-'));
  const home = throwawayHome(join(tmp, 'home'), { model: model.id, thinking: false, memory: false, limits: { look: 'off' } });
  // Two rules folders: the Tool use lines from before, and TOOLS.md as shipped. The example skill on in both.
  const shippedSkills = readFileSync(join(ROOT, 'terminal', 'rules', 'SKILLS.md'), 'utf8');
  const skillOn = shippedSkills.replace('<!--\n## Write a test', '## Write a test').replace(/\n-->\n?$/, '\n');
  const rulesFor = (arm) => {
    const dir = join(tmp, `rules-${arm}`);
    mkdirSync(dir, { recursive: true });
    cpSync(join(ROOT, 'terminal', 'rules', 'bug-fixing.md'), join(dir, 'bug-fixing.md'));
    writeFileSync(join(dir, 'TOOLS.md'), arm === 'old' ? `# Tools\n\n## Tool use\n\n${OLD_TOOL_USE}\n` : readFileSync(join(ROOT, 'terminal', 'rules', 'TOOLS.md'), 'utf8'));
    writeFileSync(join(dir, 'SKILLS.md'), skillOn);
    return dir;
  };
  const rules = { old: rulesFor('old'), new: rulesFor('new') };
  const base = makeShop(join(tmp, 'shop'));

  // Whether each task's work is right.
  const testsText = (cwd) => readdirSync(join(cwd, 'test')).filter((f) => f.endsWith('.mjs') && f !== 'shipping.test.mjs').map((f) => readFileSync(join(cwd, 'test', f), 'utf8')).join('\n');
  const suitePasses = (cwd) => spawnSync('node', ['--test'], { cwd, encoding: 'utf8', timeout: 60_000 }).status === 0;
  const node = (cwd, code) => spawnSync('node', ['--input-type=module', '-e', code], { cwd, encoding: 'utf8', timeout: 20_000 });
  const workRight = {
    testfile: (cwd, before) => testsText(cwd).split('withTax').length - 1 > before.withTax && suitePasses(cwd) && readFileSync(join(cwd, 'src', 'cart.mjs'), 'utf8') === before.cart,
    search: (cwd, before, out) => /\b50\b/.test(out) && /config\.mjs/.test(out),
    done: (cwd) => node(cwd, "import { applyDiscount } from './src/price.mjs'; if (!(applyDiscount(10, 150) >= 0 && applyDiscount(100, 10) === 90)) process.exit(1);").status === 0 && suitePasses(cwd),
    skill: (cwd) => existsSync(join(cwd, 'test', 'tax.test.mjs')) && /withTax/.test(readFileSync(join(cwd, 'test', 'tax.test.mjs'), 'utf8')) && suitePasses(cwd),
  };

  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the task under way…'); });
  const rows = [];
  let n = 0;
  async function one(task, arm) {
    if (stopping) return;
    const cwd = join(tmp, `run-${++n}-${task.id}-${arm}`);
    cpSync(base, cwd, { recursive: true });
    trust(home, cwd);
    const before = { withTax: testsText(cwd).split('withTax').length - 1, cart: readFileSync(join(cwd, 'src', 'cart.mjs'), 'utf8') };
    const r = await codingP({ cwd, prompt: task.ask, home, args: ['--no-flows', ...(task.args ?? []), ...via], env: { AGENTIC_RULES_DIR: rules[arm] } });
    const suiteRan = existsSync(join(cwd, '.suite-ran')); // before the check's own run of the suite
    rmSync(join(cwd, '.suite-ran'), { force: true });
    const habit = habitOf(task.id, r.err, { suiteRan });
    const ok = r.code === 0 && workRight[task.id](cwd, before, r.out);
    const tools = ownToolLines(r.err);
    const detail = `${ok ? 'work right' : 'work NOT right'} · ${habit ? task.habit : `not: ${task.habit}`} · ${tools.length} steps: ${tools.map((t) => short(t, 36)).join(', ') || 'none'}${suiteRan ? ' (the whole suite ran)' : ''}${r.code ? ` · exit ${r.code}: ${short(r.err.split('\n').at(-1), 80)}` : ''}`;
    rows.push({ id: `${task.id}-${arm}`, task: task.id, arm, name: `${task.ask} · ${arm === 'old' ? 'lines from before' : 'TOOLS.md now'}`, ok, habit, detail: short(detail, 400), secs: Math.round(r.secs * 10) / 10, steps: tools.length, answer: short(r.out, 300) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${rows.at(-1).name} · ${short(detail, 150)} · ${r.secs.toFixed(1)} s`);
  }

  const t0 = Date.now();
  console.log(`${model.name} · ${CHECKS} runs: ${TASKS.length} tasks, each with the Tool use lines from before and with TOOLS.md now (shortcuts off)…`);
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  // A first request loads the model, so its seconds are not counted against either side.
  trust(home, base);
  if (!url) await codingP({ cwd: base, prompt: 'say ready', home, env: { AGENTIC_RULES_DIR: rules.old }, ms: 300_000 });
  for (const task of TASKS) { await one(task, 'old'); await one(task, 'new'); }
  stopServers(home);

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
    label: 'This run', sub: subOf(now, code), page: docs ? `tests/agentic-coder-tool-habits-check-${model.id}-${stamp}.html` : '',
  };
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const prev = previous(out, 'habits-check-', summary);
  if (look) console.log('a look only: no results page, no line in the test record');
  else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
  else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
  if (!look) recordTest({
    kind: 'other', name: 'Tool habits check', model: model.id, ctx: CTX, passed, total: CHECKS, secs, part: !full, bar: 'the new lines show more of the four habits, and at least as many tasks pass',
    result: !full ? 'stopped' : v.holds ? 'pass' : 'fail',
    note: `Habits ${v.old.habits} of ${v.old.n} with the lines from before, ${v.new.habits} of ${v.new.n} with TOOLS.md now; work right ${v.old.passed} → ${v.new.passed}; ${Math.round(v.old.secs)} s → ${Math.round(v.new.secs)} s.${rows.filter((r) => r.arm === 'new' && !r.habit).map((r) => ` Not shown now: ${TASKS.find((t) => t.id === r.task).habit}.`).join('')}`,
    raw: rawOf(out), page: summary.page,
  });
  console.log(`Tool habits check on ${model.name}: habits ${v.old.habits}/${v.old.n} → ${v.new.habits}/${v.new.n} · work right ${v.old.passed} → ${v.new.passed} · ${v.holds ? 'HOLDS' : full ? 'DOES NOT HOLD' : 'STOPPED'}`);
  process.exit(v.holds ? 0 : 1);
}
