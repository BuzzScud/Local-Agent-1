// The Agents check (▶ Run a test → Agents check, `/test agents`): is /agents worth its time on the
// real model? Three change tasks on the small shop, each run twice through `coding -p --yes`: as a
// plain request, and through /agents' six stages (--agents: the interview takes the first answers,
// the plan its yes, the stop list is allowed).
//   discount   "make applyDiscount never return a negative price"
//   tax        "cover withTax with a test"
//   shipping   "make shipping free from 75 instead of 50" (its test has to change: a test guard)
// A task passes when its work is right (each says how below) and the shop's suite passes.
// The rule, written before the first run: /agents passes at least one task and at least as many as
// the plain request, and every task it passes has a new or changed test. The time is shown, not judged
// (six stages cost more than one message).
//   node models/evals/tools/agents-ab.mjs --model qwen [--out dir] [--no-record] [--url <a model server already up>] [--no-flows]
// --no-flows: both ways go step by step, without the focused fix and change paths (the end-to-end test's
// stand-in, which only says done, would keep a focused path trying for minutes).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, modelFolder, recordTest, codeLabel } from '../../index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { refusal, throwawayHome, trust, makeShop, codingP, stopServers, rawOf, stampOf, subOf, short } from './ab-kit.mjs';

export const TASKS = [
  { id: 'discount', ask: 'make applyDiscount in src/price.mjs never return a negative price' },
  { id: 'tax', ask: 'cover withTax in src/cart.mjs with a test' },
  { id: 'shipping', ask: 'make shipping free from 75 instead of 50' },
];
export const ARMS = ['plain', 'agents'];
export const CHECKS = TASKS.length * ARMS.length;

const testsText = (cwd) => readdirSync(join(cwd, 'test')).filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(join(cwd, 'test', f), 'utf8')).join('\n');
const suitePasses = (cwd) => spawnSync('node', ['--test'], { cwd, encoding: 'utf8', timeout: 60_000 }).status === 0;
const node = (cwd, code) => spawnSync('node', ['--input-type=module', '-e', code], { cwd, encoding: 'utf8', timeout: 20_000 }).status === 0;
const WORK_RIGHT = {
  discount: (cwd) => node(cwd, "import { applyDiscount } from './src/price.mjs'; if (!(applyDiscount(10, 150) >= 0 && applyDiscount(100, 10) === 90)) process.exit(1);") && suitePasses(cwd),
  tax: (cwd, before) => testsText(cwd).split('withTax').length - 1 > before.withTax && suitePasses(cwd) && readFileSync(join(cwd, 'src', 'cart.mjs'), 'utf8') === before.cart,
  shipping: (cwd) => node(cwd, "import { shippingFor } from './src/shipping.mjs'; if (!(shippingFor(74.99) > 0 && shippingFor(75) === 0)) process.exit(1);") && suitePasses(cwd),
};

export function verdictOf(rows) {
  const side = (arm) => { const r = rows.filter((x) => x.arm === arm); return { passed: r.filter((x) => x.ok).length, tested: r.filter((x) => x.ok && x.testChanged).length, secs: r.reduce((n, x) => n + (x.secs ?? 0), 0), n: r.length }; };
  const plain = side('plain'), agents = side('agents');
  // At least one right: nothing right on both sides is not a pass.
  const holds = plain.n === TASKS.length && agents.n === TASKS.length && agents.passed >= 1 && agents.passed >= plain.passed && agents.tested === agents.passed;
  return { plain, agents, holds };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function agentsPage({ summary, rows }) {
  const v = summary.verdict;
  const tr = rows.map((r) => `<tr><td>${esc(r.task)}</td><td>${esc(r.arm)}</td><td class="${r.ok ? 'ok' : 'no'}">${r.ok ? 'right' : 'not right'}</td><td>${r.testChanged ? 'yes' : 'no'}</td><td>${esc(r.verdict ?? '')}</td><td>${r.secs} s</td><td>${esc(r.detail)}</td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agents check</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#1d1f21;--dim:#5b6470;--line:#e1e4e8;--ok:#1f7a3d;--no:#b42318}@media (prefers-color-scheme:dark){:root{--bg:#111315;--fg:#e6e8ea;--dim:#9aa3ad;--line:#2a3036;--ok:#87d787;--no:#ff7b72}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,system-ui,sans-serif;padding:24px 16px}main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--dim);margin:0 0 16px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}.ok{color:var(--ok);font-weight:600}.no{color:var(--no);font-weight:600}.wrap{overflow-x:auto}</style></head>
<body><main><h1>Agents check · ${esc(summary.name)}</h1><p class="sub">${esc(summary.sub)} · ${summary.pass ? 'holds' : summary.stopped ? 'stopped' : 'does not hold'}: plain ${v.plain.passed}/${v.plain.n} right in ${Math.round(v.plain.secs)} s · /agents ${v.agents.passed}/${v.agents.n} right (${v.agents.tested} with a test) in ${Math.round(v.agents.secs)} s</p>
<p>The rule, written before the first run: /agents passes at least one task and at least as many as the plain request, and every task it passes has a new or changed test. The time is shown, not judged.</p>
<div class="wrap"><table><thead><tr><th>Task</th><th>Way</th><th>Work</th><th>Test changed</th><th>/agents said</th><th>Time</th><th>What it did</th></tr></thead><tbody>
${tr}
</tbody></table></div></main></body></html>`;
}

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const main = import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (main) await run();

async function run() {
  const model = MODELS[opt('model', DEFAULT_MODEL)];
  if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
  const CTX = 32_768;
  const url = opt('url', null);
  const no = url ? null : await refusal(model, CTX);
  if (no) { console.error(`refused: ${no}`); process.exit(3); }
  const via = [...(url ? ['--url', url] : []), ...(args.includes('--no-flows') ? ['--no-flows'] : [])];
  const now = new Date();
  const stamp = stampOf(now);
  const out = opt('out') ?? join(modelFolder(model), 'results', `agents-check-${stamp}`);
  mkdirSync(out, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'agentic-agents-check-'));
  const home = throwawayHome(join(tmp, 'home'), { model: model.id, thinking: false, memory: false });
  const base = makeShop(join(tmp, 'shop'));
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the task under way…'); });
  const rows = [];
  let n = 0;
  async function one(task, arm) {
    if (stopping) return;
    const cwd = join(tmp, `run-${++n}-${task.id}-${arm}`);
    cpSync(base, cwd, { recursive: true });
    trust(home, cwd);
    const before = { withTax: testsText(cwd).split('withTax').length - 1, cart: readFileSync(join(cwd, 'src', 'cart.mjs'), 'utf8'), tests: testsText(cwd) };
    const r = await codingP({ cwd, prompt: task.ask, home, args: [...(arm === 'agents' ? ['--agents'] : []), ...via], ms: arm === 'agents' ? 1_800_000 : 480_000 });
    const ok = r.code === 0 && WORK_RIGHT[task.id](cwd, before);
    const testChanged = testsText(cwd) !== before.tests;
    const verdict = arm === 'agents' ? short(r.out.split('\n')[0], 60) : '';
    const files = existsSync(join(cwd, 'SPEC.md')) ? 'SPEC.md, tasks/' : '';
    const detail = `${ok ? 'work right' : 'work NOT right'} · ${testChanged ? 'a test changed' : 'no test changed'}${files ? ` · wrote ${files}` : ''}`;
    rows.push({ id: `${task.id}-${arm}`, task: task.id, arm, ok, testChanged, verdict, detail, secs: Math.round(r.secs) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${task.id} · ${arm} · ${detail} · ${r.secs.toFixed(1)} s`);
  }
  const t0 = Date.now();
  console.log(`${model.name} · ${CHECKS} runs: ${TASKS.length} tasks, each as a plain request and through /agents…`);
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  trust(home, base);
  if (!url) await codingP({ cwd: base, prompt: 'say ready', home, ms: 300_000 });
  for (const task of TASKS) for (const arm of ARMS) await one(task, arm);
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
    sub: subOf(now, code), page: docs ? `tests/agentic-coder-agents-check-${model.id}-${stamp}.html` : '',
  };
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  if (look) console.log('a look only: no results page, no line in the test record');
  else if (docs) { mkdirSync(dirname(docsPath(summary.page)), { recursive: true }); writeFileSync(docsPath(summary.page), agentsPage({ summary, rows })); console.log(`results page: ${summary.page}`); }
  else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
  if (!look) recordTest({
    kind: 'other', name: 'Agents check', model: model.id, ctx: CTX, passed, total: CHECKS, secs, part: !full,
    bar: '/agents passes at least one task and as many as a plain request, each with a test', result: !full ? 'stopped' : v.holds ? 'pass' : 'fail',
    note: `Right: plain ${v.plain.passed}/${v.plain.n} in ${Math.round(v.plain.secs)} s, /agents ${v.agents.passed}/${v.agents.n} (${v.agents.tested} with a test) in ${Math.round(v.agents.secs)} s`,
    raw: rawOf(out), page: summary.page,
  });
  console.log(`Agents check on ${model.name}: plain ${v.plain.passed}/${v.plain.n} · /agents ${v.agents.passed}/${v.agents.n} (${v.agents.tested} tested) · ${v.holds ? 'HOLDS' : full ? 'DOES NOT HOLD' : 'STOPPED'}`);
  process.exit(v.holds ? 0 : 1);
}
