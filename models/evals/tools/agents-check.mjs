// The subagent check (▶ Run a test → Subagent check, `/test subagent`): helpers (the
// Agent tool) with the real model, on this Mac. With Who decides on Model it asks
// through `coding -p --yes` in a throwaway home whose engine and model files are
// links to the ones in ~/.agentic-coder: an explore helper finds a function (and its
// requests run on the server's side slot, so the conversation's place is kept), an
// explore helper told to change a file cannot, a general helper makes a change, and
// in the real window esc stops a helper at work. Pass: all 5 checks.
//   node models/evals/tools/agents-check.mjs --model qwen [--out dir] [--no-record]
//   node models/evals/tools/agents-check.mjs --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, HOME, modelFolder, contextCheck, hasDraft, recordTest, codeLabel } from '../../index.mjs';
import { runInPty } from '../../../terminal/index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { agentsPage } from './agents-page.mjs';
import { llamaServers, options, pad, previousRun, rawOf, rebuildIfAsked, runCoding, short, stampOf, toolsOf as tools, writeResultsPage } from './check-kit.mjs';

const args = process.argv.slice(2);
const { opt } = options(args);
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const CTX = 32_768;
export const CHECKS = 5;

const previous = (out, summary) => previousRun(out, summary, 'agents-check-');
const writePage = (out, rows, summary, prev) => writeResultsPage(agentsPage, out, rows, summary, prev);

rebuildIfAsked(options(args), (dir, rows, summary) => writePage(dir, rows, summary, previous(dir, summary)));

const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }

const now = new Date();
const stamp = stampOf(now);
const out = opt('out') ?? join(modelFolder(model), 'results', `agents-check-${stamp}`);
mkdirSync(out, { recursive: true });

// A throwaway home (Who decides: Model) and a small project.
const tmp = mkdtempSync(join(tmpdir(), 'agentic-agents-check-'));
const home = join(tmp, 'home'), proj = join(tmp, 'project');
for (const d of [home, proj, join(proj, 'src'), join(proj, 'src', 'billing')]) mkdirSync(d, { recursive: true });
symlinkSync(join(HOME, 'engine'), join(home, 'engine'));
symlinkSync(join(HOME, 'models'), join(home, 'models'));
writeFileSync(join(home, 'trust.json'), JSON.stringify({ [proj]: new Date().toISOString() }));
writeFileSync(join(home, 'settings.json'), JSON.stringify({ model: model.id, thinking: false, memory: false, limits: { way: 'model' } }));
writeFileSync(join(proj, 'src', 'cart.mjs'), "import { computeTax } from './billing/tax.mjs';\nexport const total = (items) => items.reduce((s, i) => s + i.price, 0);\nexport const withTax = (items) => total(items) + computeTax(total(items));\n");
writeFileSync(join(proj, 'src', 'billing', 'rates.mjs'), 'export const RATE = 0.08;\n');
writeFileSync(join(proj, 'src', 'billing', 'tax.mjs'), "import { RATE } from './rates.mjs';\n\n// The tax on an amount, rounded to cents.\nexport function computeTax(amount) {\n  return Math.round(amount * RATE * 100) / 100;\n}\n");
writeFileSync(join(proj, 'notes.mjs'), "export const NOTES = ['first'];\n");
const quiet = { AGENTIC_NO_UPDATE: '1', AGENTIC_MEMORY_SAVE: 'off', AGENTIC_NO_MEMORY: '1', AGENTIC_HELPERS: 'off', AGENTIC_NO_OPEN: '1', AGENTIC_HOME: home };
const logFile = join(home, 'logs', 'server.log');
const logNow = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');

const codingP = (prompt, ms = 420_000) => runCoding({ cwd: proj, env: quiet, prompt, ms });
const said = (r) => `tools: ${tools(r.err).map((t) => short(t, 60)).join(', ') || 'none'} · answered ${JSON.stringify(short(r.out, 70))} in ${r.secs.toFixed(1)} s${r.code ? ` · exit ${r.code}: ${short(r.err.split('\n').at(-1))}` : ''}`;
const helped = (r, verb) => tools(r.err).some((t) => t.startsWith(`${verb}(`));
const servers = () => llamaServers(home);

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the check under way…'); });
const rows = [];
async function check(id, name, fn) {
  if (stopping) return false;
  const a = Date.now();
  let ok = false, detail = '';
  try { ({ ok, detail } = await fn()); } catch (e) { ok = false; detail = e.message; }
  const secs = (Date.now() - a) / 1000;
  rows.push({ id, name, ok: Boolean(ok), detail: short(detail, 300), secs: Math.round(secs * 10) / 10 });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} · ${short(detail, 140)} · ${secs.toFixed(1)} s`);
  return ok;
}

const t0 = Date.now();
console.log(`${model.name} · ${CHECKS} checks of helpers (the Agent tool, Who decides: Model) on this Mac…`);
try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
let exploreSecs = null, keptTokens = null, sideLog = '';

await check('explore', 'an explore helper finds a function for it', async () => {
  const before = logNow().length;
  const r = await codingP('Use the Agent tool with kind explore to find which file defines the function computeTax and on which line. Then tell me the file and the line.');
  exploreSecs = r.secs;
  sideLog = logNow().slice(before);
  return { ok: r.code === 0 && helped(r, 'Explore') && /tax\.mjs/.test(r.out) && /\b4\b/.test(r.out), detail: said(r) };
});
await check('side', 'its requests ran on the side slot, and the conversation’s place was kept', async () => {
  // llama-server logs each request's slot and what it processed ("print_timing: id  1 | task … | prompt eval time = … / N tokens").
  const evals = [...sideLog.matchAll(/print_timing: id\s+(\d+) \| task \d+ \| prompt eval time =\s+[\d.]+ ms \/\s+(\d+) tokens/g)].map((m) => ({ slot: Number(m[1]), n: Number(m[2]) }));
  const side = evals.filter((e) => e.slot === 1).length;
  // The conversation's steps on slot 0 after the helper's first request: the first of them processed only what was new.
  const firstSide = evals.findIndex((e) => e.slot === 1);
  const after = firstSide >= 0 ? evals.slice(firstSide).find((e) => e.slot === 0) : null;
  keptTokens = after?.n ?? null;
  return { ok: side > 0 && after != null && after.n < 1500, detail: `${side} request${side === 1 ? '' : 's'} on slot 1 · ${evals.filter((e) => e.slot === 0).length} on slot 0 · the conversation's next step processed ${after ? `${after.n} tokens` : 'nothing seen'}` };
});
await check('readonly', 'an explore helper told to change a file cannot', async () => {
  const r = await codingP("Use the Agent tool with kind explore and ask it to add the string 'second' to the NOTES list in notes.mjs. Tell me what happened.");
  const same = readFileSync(join(proj, 'notes.mjs'), 'utf8') === "export const NOTES = ['first'];\n";
  return { ok: r.code === 0 && helped(r, 'Explore') && same, detail: `${same ? 'notes.mjs unchanged' : 'notes.mjs CHANGED'} · ${said(r)}` };
});
await check('general', 'a general helper makes a change', async () => {
  const r = await codingP("Use the Agent tool with kind general to add the string 'second' to the NOTES list in notes.mjs. Then tell me it is done.");
  const text = readFileSync(join(proj, 'notes.mjs'), 'utf8');
  return { ok: r.code === 0 && helped(r, 'Agent') && /'second'|"second"/.test(text), detail: `notes.mjs: ${JSON.stringify(short(text, 60))} · ${said(r)}` };
});
await check('esc', 'in the window, esc stops a helper at work', async () => {
  let shown = false;
  const r = await runInPty({ cwd: proj, env: { ...quiet }, args: [], timeoutMs: 600_000, steps: [
    { wait: '? for shortcuts', ms: 60_000 }, { waitGone: `Starting ${model.name}`, ms: 240_000 }, { sleep: 500 },
    { type: 'Use the Agent tool with kind explore to read every file in this project one by one and summarize each.' }, { sleep: 300 }, { key: 'enter' },
    { wait: ' · 1 step · ', ms: 240_000 }, { fn: () => { shown = true; } }, { key: 'esc' },
    { wait: 'Interrupted', ms: 60_000 }, { sleep: 500 }, { snapshot: 'stopped' },
    { sleep: 300 }, { key: 'ctrlC' }, { sleep: 200 }, { key: 'ctrlC' },
  ] });
  return { ok: shown && /Interrupted/.test(r.snapshots.stopped ?? ''), detail: `${shown ? 'its line showed its first step' : 'its line never showed'} · ${/Interrupted/.test(r.snapshots.stopped ?? '') ? 'esc stopped it: Interrupted' : 'not stopped'}` };
});
for (const { pid } of servers()) { try { process.kill(pid, 'SIGTERM'); } catch {} }

const passed = rows.filter((r) => r.ok).length;
const full = rows.length === CHECKS;
const pass = full && passed === CHECKS;
const code = codeLabel();
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  checks: rows.length, of: CHECKS, passed, pass, stopped: stopping || !full, exploreSecs, keptTokens, load: Math.round(loadavg()[0] * 10) / 10,
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-subagent-check-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(out, 'server-log-explore.txt'), sideLog);
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'Subagent check', model: model.id, ctx: CTX, passed, total: CHECKS, secs, part: !full, bar: `all ${CHECKS} checks`,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${passed} of ${CHECKS} checks of helpers (the Agent tool); an explore helper's answer in ${exploreSecs ? exploreSecs.toFixed(1) : '?'} s; the conversation's next step processed ${keptTokens ?? '?'} tokens after it.${rows.filter((r) => !r.ok).map((r) => ` Failed: ${r.name} (${r.detail}).`).join('')}`,
  raw: rawOf(out), page: summary.page,
});
console.log(`Subagent check on ${model.name}: ${passed} of ${CHECKS} · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(pass ? 0 : 1);
