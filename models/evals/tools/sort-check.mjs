// The sorting check (▶ Run a test → Sorting check, `/test sorting`): how the
// model sorts a request into a kind (question, fix, change, rename, other) when
// the word rules leave it (modelSort() in terminal/src/flows/index.mjs). Every
// one of the 85 lines of the sort test goes to the model, rules or not: the 78
// the word rules give a kind (that kind is the answer), and the 7 they leave to
// it, 4 of which have the kind they should get. So it is harder than a day in
// the app, where the rules sort most requests before the model sees them.
// Pass: at most 4 of the 82 lines with a kind wrong (95%; the rule of 29 Sep 2026).
// Each run writes its results page into the DOCS folder (tests/), beside the run
// before it on the same model, and its line in the test record names that page,
// so the Tests tab opens it.
//   node models/evals/tools/sort-check.mjs --model gemma [--url http://127.0.0.1:PORT --slot 1] [--out dir]
//   --url: sort on a server that is already up (no model is loaded or stopped)
//   --no-record: a look only; no line in the test record and no results page
//   node models/evals/tools/sort-check.mjs --rebuild <a run's folder>: draws that run's page again
//   from its saved results (no model, no new line in the record)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, hasDraft, recordTest, codeLabel } from '../../index.mjs';
import { modelSort, SORT_LINES, SORT_KINDS, testSettings } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { buildSortPage } from './sort-page.mjs';
import { options, pad, previousRun, stampOf } from './check-kit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const { opt } = options(args);
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const MAX_WRONG = 4;
const CTX = testSettings()?.context ?? 8192; // the question is under 300 tokens; the side slot the app sorts in (the Tests page's panel can set it)
const LINES = SORT_LINES.filter((l) => SORT_KINDS.includes(l.path) || l.path === 'unsorted');
const wantOf = (l) => (SORT_KINDS.includes(l.path) ? l.path : l.want ?? null);
const total = LINES.filter(wantOf).length;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// The run before this one on the same model (a finished one, in a sort-check-* folder beside
const previous = (out, summary) => previousRun(out, summary, 'sort-check-');

// A run's results page, from what it saved (rows.json, summary.json), with the run before it.
function writePage(out, rows, summary, prev) {
  const at = new Date(summary.started);
  const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const full = !summary.stopped;
  const verdict = `${!full ? `Stopped after ${summary.lines} of ${summary.of} lines: ` : summary.pass ? 'Passed: ' : 'Failed: '}${summary.right} of ${summary.right + summary.wrong} right, ${fmt(summary.medianMs ?? 0)} a sort.`
    + (prev ? ` Before (${prev.s.sub}): ${prev.s.right} of ${prev.s.total} right, ${fmt(prev.s.medianMs ?? 0)} a sort.` : '');
  writeFileSync(docsPath(summary.page), buildSortPage({
    title: `Sorting check · ${summary.name}`,
    dateline: `${at.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${pad(at.getHours())}:${pad(at.getMinutes())} · code ${summary.code} · ${summary.lines} requests · ${Math.round(summary.secs)} s · Mac load ${summary.load}`,
    verdict,
    chips: [{ text: `At most ${MAX_WRONG} of ${summary.total} wrong: ${summary.wrong} wrong`, ok: full ? summary.pass : null }, { text: `Sorted in one pass: ${summary.odds} of ${summary.lines}`, ok: null }],
    models: [{ id: summary.model, name: summary.name, columns: [...(prev ? [{ label: prev.s.label === 'This run' ? 'Before' : prev.s.label, sub: prev.s.sub, rows: prev.rows }] : []), { label: 'This run', sub: summary.sub, rows }] }],
    method: [
      `Every request of the sort test (<code>terminal/test/sort-lines.mjs</code>) goes to the model, even the ones the word rules sort in the app: ${LINES.length} requests, ${total} with a kind to get. The kind the word rules give a line is its answer; ${LINES.filter((l) => l.path === 'unsorted' && l.want).length} of the ${LINES.filter((l) => l.path === 'unsorted').length} lines the rules leave to the model have a kind written for this check, the others are unclear on purpose and are only shown.`,
      'The model sorts each one the way the app does (<code>modelSort()</code>): in one pass, from the chance it gives each kind, with nothing written; a rename is then asked for its two names, and a server that cannot give the chances is asked for a written answer instead.',
      `On its own server with the app's settings, ${CTX.toLocaleString('en-US')} tokens of memory, the side slot the app sorts in. Your instructions are left out (the app puts them in front of the question) so runs compare.`,
      'Seconds are the whole sort as the app waits for it, the tokenizer calls included; they grow when the Mac is busy (its load is in the line at the top). The percentage beside a pick is the model’s chance for it; it is not used to decide anything (on 29 Sep it did not tell right picks from wrong ones).',
      `Pass: at most ${MAX_WRONG} of the ${total} wrong (95%). Before is the finished run before this one on the same model.`,
    ],
    raw: [relative(root, out)],
  }));
}

if (args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!summary.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  if (!existsSync(DOCS_DIR)) { console.error(`the DOCS folder is not here (${DOCS_DIR})`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), summary, previous(dir, summary));
  console.log(`results page drawn again: ${summary.page}`);
  process.exit(0);
}

const now = new Date();
const stamp = stampOf(now);
const out = opt('out') ?? join(modelFolder(model), 'results', `sort-check-${stamp}`); // modelFolder is the model's own folder, whole
mkdirSync(out, { recursive: true });

// Stop (the Tests tab's Stop button sends SIGTERM): the line under way ends, and what is done is kept.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: keeping the lines done so far…'); });

let url = opt('url'), slot = opt('slot') == null ? undefined : Number(opt('slot')), srv = null;
const t0 = Date.now();
if (!url) {
  // Looked up read-only (scanServers would also stop servers it finds left over).
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
  // Right after another model stopped, its memory takes up to a minute to come back.
  if (!contextCheck(model, CTX, { draft: hasDraft(model) }).fits) console.log('waiting for memory to free up (up to 2 minutes)…');
  for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) await new Promise((r) => setTimeout(r, 5000));
  const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
  if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  console.log(`${model.name} · ${LINES.length} requests to sort, ${total} with a kind to get · loading the model…`);
  srv = new ModelServer(model);
  process.on('uncaughtException', async (e) => { console.error(e); try { await srv.stop(); } catch {} process.exit(1); });
  const st = await srv.start({ ctx: CTX, share: false, lingerSecs: 0 });
  url = srv.url;
  slot = st.slots > 1 ? 1 : undefined;
  console.log(`loaded in ${Math.round((Date.now() - t0) / 1000)} s`);
} else console.log(`${model.name} · ${LINES.length} requests to sort, ${total} with a kind to get · on ${url}`);

const rows = [];
const s0 = Date.now();
let broke = null;
for (const [i, l] of LINES.entries()) {
  if (stopping) break;
  const a = performance.now();
  let r;
  try { r = await modelSort({ url, model, slot }, l.text); } catch (e) { broke = e.message; break; }
  const ms = performance.now() - a, want = wantOf(l);
  rows.push({ set: l.set, n: l.n, text: l.text, want, model: l.path === 'unsorted', kind: r.kind, ms: Math.round(ms), conf: r.sure ?? null, via: r.via ?? null });
  const tag = want ? (r.kind === want ? 'PASS' : 'FAIL') : '----';
  console.log(`${tag} #${i + 1} ${r.kind}${want && r.kind !== want ? ` (should be ${want})` : ''} · ${r.via ?? ''}${r.sure != null ? ` ${Math.round(r.sure * 100)}%` : ''} · ${(ms / 1000).toFixed(2)} s · ${JSON.stringify(l.text.replace(/\s+/g, ' ').slice(0, 60))}`);
}
const sortSecs = (Date.now() - s0) / 1000;
if (srv) { try { await srv.stop(); } catch {} }
if (broke) console.error(`stopped: the model's server did not answer (${broke})`);

const scored = rows.filter((r) => r.want);
const right = scored.filter((r) => r.kind === r.want).length, wrong = scored.length - right;
const full = rows.length === LINES.length;
const pass = full && wrong <= MAX_WRONG;
const code = codeLabel();
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs, sortSecs,
  lines: rows.length, of: LINES.length, total, right, wrong, pass, stopped: !full,
  medianMs: median(rows.map((r) => r.ms)), odds: rows.filter((r) => r.via === 'odds').length,
  load: Math.round(loadavg()[0] * 10) / 10, // how busy the Mac was at the end: the seconds depend on it
  label: 'This run', sub: `${now.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())} · ${code}`,
  page: docs ? `tests/agentic-coder-sorting-check-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const prev = previous(out, summary);
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary, prev); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);

if (!look) recordTest({
  kind: 'other', name: 'Sorting check', model: model.id, ctx: CTX, passed: right, total: scored.length, secs, part: !full, bar: `at most ${MAX_WRONG} wrong`,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${right} of ${scored.length} sorted right (${wrong} wrong; pass at most ${MAX_WRONG}); ${summary.medianMs != null ? (summary.medianMs / 1000).toFixed(2) : '?'} s a sort; ${summary.odds} of ${rows.length} in one pass.${prev ? ` Before: ${prev.s.right} of ${prev.s.total}.` : ''}${broke ? ` Stopped: ${broke}.` : ''}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`Sorting check on ${model.name}: ${right} of ${scored.length} right · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(broke ? 1 : 0);
