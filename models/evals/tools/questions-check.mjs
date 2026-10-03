// The plain questions check (▶ Run a test → Plain questions check, `/test questions`): the
// question the app asks first when a request is short and vague (questionFor() in
// terminal/src/flows/clarify.mjs), on 8 such requests in a small shop project. A request passes
// when its question comes with 2 or 3 choices, every choice has a line saying what it means for
// you (its about), and no choice or line names a file or code. Pass: at least 7 of 8 (the rule
// of 3 Oct 2026, when the choices first carried an about line; before that, 0 of 15 had one and
// every choice named a file).
// Each run writes its results page into the DOCS folder (tests/), beside the run before it on the
// same model, and its line in the test record names that page, so the Tests tab opens it.
//   node models/evals/tools/questions-check.mjs --model qwen [--url http://127.0.0.1:PORT] [--out dir]
//   --url: on a server that is already up (no model is loaded or stopped)
//   --remote <address> [--remote-model <name>]: a model on another machine (an OpenAI-style service)
//   --no-record: a look only; no line in the test record and no results page
//   node models/evals/tools/questions-check.mjs --rebuild <a run's folder>: draws its page again
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir, loadavg } from 'node:os';
import { spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, hasDraft, recordTest, codeLabel, connectRemote } from '../../index.mjs';
import { questionFor, testSettings } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { makeShop } from './ab-kit.mjs';
import { questionsPage } from './questions-page.mjs';
import { options, pad, previousRun, rebuildIfAsked, root, stampOf } from './check-kit.mjs';

const args = process.argv.slice(2);
const { opt } = options(args);
const REQUESTS = ['shipping', 'make checkout better', 'add a discount', 'tax', 'clean up the code', 'make it faster', 'totals', 'coupons'];
const MIN_PASS = 7;
const CTX = testSettings()?.context ?? 8192; // the question is under 600 tokens
// A file name, a path, or a name written as code.
const CODEY = /\b[\w-]+\.(?:mjs|cjs|js|jsx|ts|json|html|css|py|md)\b|`|\b[a-z]+[A-Z]\w*\(|\/\w+\//;

// One request's question, judged: choices, each with its line, none naming a file or code.
function judge(q) {
  const options = q?.options ?? [];
  const about = q?.about ?? [];
  const missing = options.filter((_, i) => !String(about[i] ?? '').trim()).length;
  const codey = options.filter((o, i) => CODEY.test(o) || CODEY.test(about[i] ?? '')).length;
  const ok = options.length >= 2 && missing === 0 && codey === 0;
  const why = !q ? 'no question (it judged the request clear)' : options.length < 2 ? 'no choices to pick from' : [missing && `${missing} without a line`, codey && `${codey} naming a file or code`].filter(Boolean).join(', ');
  return { ok, missing, codey, why };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

const previous = (out, summary) => previousRun(out, summary, 'questions-check-');
const writePage = (out, rows, summary, prev) => writeFileSync(docsPath(summary.page), questionsPage({ summary, rows, prev, raw: [relative(root, out)] }));

rebuildIfAsked(options(args), (dir, rows, summary) => writePage(dir, rows, summary, previous(dir, summary)));
let model = MODELS[opt('model', DEFAULT_MODEL)];
const remoteAt = opt('remote', null);
if (!model && !remoteAt) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const now = new Date();
const stamp = stampOf(now);

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: keeping the requests done so far…'); });

let url = opt('url'), srv = null, conn = null;
const t0 = Date.now();
if (remoteAt) {
  try { conn = await connectRemote({ use: true, source: 'openai', kind: 'openai', connect: 'http', address: remoteAt, model: opt('remote-model', ''), key: Boolean(process.env.AGENTIC_REMOTE_KEY) }); }
  catch (e) { console.error(`the remote at ${remoteAt} did not answer: ${e.message}`); process.exit(1); }
  url = conn.url; model = { ...conn.model, name: `${conn.model.remote?.model ?? 'a model'} on a service` }; // no address: the page is public
  console.log(`${model.name} · ${REQUESTS.length} vague requests · on the service`);
} else if (!url) {
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
  for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) await new Promise((r) => setTimeout(r, 5000));
  const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
  if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
  console.log(`${model.name} · ${REQUESTS.length} vague requests · loading the model…`);
  srv = new ModelServer(model);
  process.on('uncaughtException', async (e) => { console.error(e); try { await srv.stop(); } catch {} process.exit(1); });
  await srv.start({ ctx: CTX, share: false, lingerSecs: 0 });
  url = srv.url;
  console.log(`loaded in ${Math.round((Date.now() - t0) / 1000)} s`);
} else console.log(`${model.name} · ${REQUESTS.length} vague requests · on ${url}`);

const id = model.remote ? `remote-${String(model.remote.model ?? 'model').replace(/[^\w.-]+/g, '-')}` : model.id;
const out = opt('out') ?? join(model.remote ? join(root, 'models', 'evals', 'results') : join(modelFolder(model), 'results'), `questions-check-${stamp}`);
mkdirSync(out, { recursive: true });
const cwd = mkdtempSync(join(tmpdir(), 'questions-check-'));
makeShop(cwd);
const rows = [];
let broke = null;
for (const [i, text] of REQUESTS.entries()) {
  if (stopping) break;
  const a = performance.now();
  let q;
  try { q = await questionFor({ url, model, cwd }, text); } catch (e) { broke = e.message; break; }
  const secs = (performance.now() - a) / 1000;
  const j = judge(q);
  rows.push({ id: `r${i + 1}`, name: `“${text}”`, ok: j.ok, secs, question: q?.question ?? null, options: q?.options ?? [], about: q?.about ?? [], missing: j.missing, codey: j.codey,
    detail: q ? `${q.question} · ${(q.options ?? []).map((o, k) => `${k + 1}. ${o}${q.about?.[k] ? ` (${q.about[k]})` : ''}`).join(' · ')}${j.ok ? '' : ` — ${j.why}`}` : j.why });
  console.log(`${j.ok ? 'PASS' : 'FAIL'} #${i + 1} ${JSON.stringify(text)} · ${secs.toFixed(1)} s${j.ok ? '' : ` · ${j.why}`}${q ? ` · ${q.question}` : ''}`);
}
if (srv) { try { await srv.stop(); } catch {} }
if (conn) { try { await conn.stop?.(); } catch {} }
if (broke) console.error(`stopped: the model's server did not answer (${broke})`);

const passed = rows.filter((r) => r.ok).length;
const full = rows.length === REQUESTS.length;
const pass = full && passed >= MIN_PASS;
const choices = rows.reduce((n, r) => n + r.options.length, 0);
const code = codeLabel();
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs: (Date.now() - t0) / 1000,
  of: REQUESTS.length, checks: rows.length, passed, pass, stopped: !full, minPass: MIN_PASS,
  choices, withAbout: rows.reduce((n, r) => n + r.options.length - r.missing, 0), plain: choices - rows.reduce((n, r) => n + r.codey, 0),
  medianSecs: median(rows.map((r) => r.secs)), load: Math.round(loadavg()[0] * 10) / 10,
  sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code} · ${model.name}`,
  page: docs ? `tests/agentic-coder-questions-check-${id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
if (!look) recordTest({
  kind: 'other', name: 'Plain questions check', model: id, ctx: CTX, passed, total: REQUESTS.length, secs: summary.secs, part: !full, bar: `at least ${MIN_PASS} of ${REQUESTS.length}`,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${passed} of ${rows.length} questions plain; choices with a line ${summary.withAbout} of ${choices}, free of file or code names ${summary.plain} of ${choices}; ${summary.medianSecs?.toFixed(1) ?? '?'} s a question.${prev ? ` Before: ${prev.s.passed} of ${prev.s.of}.` : ''}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`Plain questions check on ${model.name}: ${passed} of ${rows.length} plain · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(broke ? 1 : 0);
