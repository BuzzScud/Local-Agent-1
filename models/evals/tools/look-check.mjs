// The Look first check (▶ Run a test → Look first check, `/test lookfirst`): does a minimum of
// looking before the answer (/effort's Look first, terminal/src/agent/look.mjs) give right
// answers more often, on this Mac? Four questions about a small shop whose answers need more
// than one file, each asked twice at Effort High: Look first off, then auto (30 s on High).
// An answer is right when it has every fact asked for.
// The rule, written before the first run: with Look first at least as many answers are right,
// and the four take at most 60 s more each on average (the owner's "up to a minute").
//   node models/evals/tools/look-check.mjs --model qwen [--out dir] [--no-record] [--url <a model server already up>]
//   node models/evals/tools/look-check.mjs --rebuild <a run's folder>: draws that run's page again
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir, loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, modelFolder, recordTest, codeLabel } from '../../index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { refusal, throwawayHome, setSettings, trust, makeShop, codingP, ownToolLines, noteLines, stopServers, previous, rawOf, stampOf, subOf, short } from './ab-kit.mjs';
import { lookPage } from './look-page.mjs';

export const QUESTIONS = [
  { id: 'rate', ask: 'What tax rate does withTax use, and in which file is it set?', need: [/0?\.0825|8\.25\s*%/, /config\.mjs/], facts: '0.0825, in config.mjs' },
  { id: 'shipping', ask: 'Above what order amount is shipping free, and what does shipping cost otherwise?', need: [/\b50\b/, /5\.99/], facts: '50, and 5.99 otherwise' },
  { id: 'checkout', ask: 'Which functions does checkout call?', need: [/\btotal\b/, /\bwithTax\b/, /\bshippingFor\b/], facts: 'total, withTax and shippingFor' },
  { id: 'round', ask: 'How is the result of withTax rounded?', need: [/roundCents/, /cent|two decimal|2 decimal/i], facts: 'roundCents: to whole cents' },
];
export const CHECKS = QUESTIONS.length * 2;
export const MAX_MORE_SECS = 60;
const LOOKS = /^(Read|Search|List|Map|CodeSearch)\(/;

// An answer is right when it has every fact the question asks for.
export const rightAnswer = (q, text) => q.need.every((re) => re.test(String(text ?? '')));

// The verdict from the rows: the rule above, and what each side came to.
export function verdictOf(rows) {
  const side = (arm) => {
    const r = rows.filter((x) => x.arm === arm);
    const sum = (k) => r.reduce((n, x) => n + (x[k] ?? 0), 0);
    return { right: r.filter((x) => x.ok).length, secs: sum('secs'), looks: sum('looks'), backs: sum('backs'), n: r.length };
  };
  const off = side('off'), on = side('on');
  const morePerQuestion = off.n && on.n ? (on.secs - off.secs) / on.n : 0;
  const holds = off.n === QUESTIONS.length && on.n === QUESTIONS.length && on.right >= off.right && morePerQuestion <= MAX_MORE_SECS;
  return { off, on, morePerQuestion, holds };
}

function writePage(out, rows, summary, prev) {
  mkdirSync(dirname(docsPath(summary.page)), { recursive: true });
  writeFileSync(docsPath(summary.page), lookPage({ summary, rows, prev, raw: [rawOf(out)] }));
}

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const main = import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (main && args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, 'look-check-', summary));
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
  const out = opt('out') ?? join(modelFolder(model), 'results', `look-check-${stamp}`);
  mkdirSync(out, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'agentic-look-check-'));
  // Effort High (Look first's auto is 30 s there); off or auto per run.
  const settings = (look) => ({ model: model.id, thinking: true, effort: 'high', memory: false, limits: { look } });
  const home = throwawayHome(join(tmp, 'home'), settings('off'));
  const base = makeShop(join(tmp, 'shop'));

  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: finishing the question under way…'); });
  const rows = [];
  let n = 0;
  async function ask(q, arm) {
    if (stopping) return;
    const cwd = join(tmp, `run-${++n}-${q.id}-${arm}`);
    cpSync(base, cwd, { recursive: true });
    trust(home, cwd);
    setSettings(home, settings(arm === 'on' ? 'auto' : 'off'));
    const r = await codingP({ cwd, prompt: q.ask, home, args: via });
    const looks = ownToolLines(r.err).filter((t) => LOOKS.test(t)); // its own, not what the app read for it first
    const notes = noteLines(r.err);
    const backs = notes.filter((t) => t.includes('asked it to look further')).length;
    const on = notes.some((t) => t.startsWith('Looking first'));
    const ok = r.code === 0 && rightAnswer(q, r.out);
    const detail = `${ok ? 'right' : `missing ${q.need.filter((re) => !re.test(r.out)).map((re) => re.source).join(', ')}`} · ${looks.length} look${looks.length === 1 ? '' : 's'}: ${looks.map((t) => short(t, 40)).join(', ') || 'none'}${arm === 'on' ? ` · ${on ? 'looked first' : 'Look first did NOT start'}, sent back ${backs}×` : ''}${r.code ? ` · exit ${r.code}: ${short(r.err.split('\n').at(-1), 80)}` : ''}`;
    rows.push({ id: `${q.id}-${arm}`, question: q.id, arm, name: `${q.ask} · ${arm === 'on' ? 'Look first on (auto, 30 s)' : 'Look first off'}`, ok, detail: short(detail, 400), secs: Math.round(r.secs * 10) / 10, looks: looks.length, backs, started: on, answer: short(r.out, 400) });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${rows.at(-1).name} · ${short(detail, 150)} · ${r.secs.toFixed(1)} s`);
  }

  const t0 = Date.now();
  console.log(`${model.name} · ${CHECKS} runs: ${QUESTIONS.length} questions at Effort High, each with Look first off and then on…`);
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  // A first request loads the model, so its seconds are not counted against either side.
  trust(home, base);
  if (!url) await codingP({ cwd: base, prompt: 'say ready', home, ms: 300_000 });
  for (const q of QUESTIONS) { await ask(q, 'off'); await ask(q, 'on'); }
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
    label: 'This run', sub: subOf(now, code), page: docs ? `tests/agentic-coder-look-first-check-${model.id}-${stamp}.html` : '',
  };
  writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const prev = previous(out, 'look-check-', summary);
  if (look) console.log('a look only: no results page, no line in the test record');
  else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
  else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
  if (!look) recordTest({
    kind: 'other', name: 'Look first check', model: model.id, ctx: CTX, passed, total: CHECKS, secs, part: !full, bar: `with Look first at least as many right, at most ${MAX_MORE_SECS} s more a question`,
    result: !full ? 'stopped' : v.holds ? 'pass' : 'fail',
    note: `Right answers ${v.off.right} of ${v.off.n} with Look first off, ${v.on.right} of ${v.on.n} on; ${Math.round(v.off.secs)} s → ${Math.round(v.on.secs)} s (${v.morePerQuestion >= 0 ? '+' : ''}${Math.round(v.morePerQuestion)} s a question); looks ${v.off.looks} → ${v.on.looks}, sent back ${v.on.backs}×.`,
    raw: rawOf(out), page: summary.page,
  });
  console.log(`Look first check on ${model.name}: right ${v.off.right}/${v.off.n} off → ${v.on.right}/${v.on.n} on · ${Math.round(v.off.secs)} s → ${Math.round(v.on.secs)} s · ${v.holds ? 'HOLDS' : full ? 'DOES NOT HOLD' : 'STOPPED'}`);
  process.exit(v.holds ? 0 : 1);
}
