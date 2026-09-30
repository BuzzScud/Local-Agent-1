// The two-at-once speed check (the Arena → Two at once, `/test twoatonce`): does the model write
// more in the same time when two tries run together, one on each of the server's two slots, than
// when they run one after the other on one slot? The focused paths' tries (writing tests,
// drafting, trying fixes) ran one at a time until 30 Sep 2026, while the chat's slot sat idle.
// Each round writes the same two pieces of code both ways (the order swaps each round, so a busy
// Mac hurts both alike): one after the other on slot 1, and at once on slots 1 and 0. Thinking off,
// the model's own sampling at 0.7 (a second try's), 450 tokens at most, prompts not cached (both
// ways read them the same). Pass: two at once writes at least 1.25× the tokens a second over the
// whole run (the rule written before the first run, 30 Sep 2026).
//   node models/evals/tools/two-at-once.mjs --model qwen [--rounds 3] [--url http://127.0.0.1:PORT]
//   --url: on a server that is already up, with two slots (no model is loaded or stopped)
//   --no-record: a look only; no line in the test record and no results page
//   --rebuild <a run's folder>: draws that run's page again from its saved results
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, hasDraft, recordTest, codeLabel, thinkingKwargs } from '../../index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { buildTwoPage } from './two-at-once-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
export const BAR = 1.25;
const ROUNDS = Math.max(1, Number(opt('rounds', 3)));
const CTX = 32_768; // the app's own size: both slots share it (-kvu)
const MAX_TOKENS = 450;

// Four pieces of code of the size a try writes (a test file, a function, a small module).
const PROMPTS = [
  'Write a small test file using node:test and node:assert/strict for a module ./stats.mjs that exports mean(values), median(values) and mode(values). Check an odd and an even count for median, an empty array for mean (it returns 0), and ties for mode (the smallest wins). Reply with the complete test file in one fenced code block.',
  'Write a JavaScript module money.mjs that exports formatMoney(cents, currency) (e.g. 123456, "USD" → "$1,234.56"; "EUR" → "€1,234.56"; negative amounts get a leading minus), parseMoney(text) (the reverse, returning cents), and addMoney(a, b) that refuses two different currencies. Reply with the complete file in one fenced code block.',
  'Write a Python module inventory.py with a class Inventory: add(sku, qty), remove(sku, qty) (raises ValueError when there is not enough), count(sku), and to_dict() that returns the counts sorted by sku. Add a short docstring to each method. Reply with the complete file in one fenced code block.',
  'Write a small test file using node:test and node:assert/strict for a module ./dates.mjs that exports addDays(isoDate, n), daysBetween(a, b) and isWeekend(isoDate). Cover a month end, a leap day, a negative n, and both weekend days. Reply with the complete test file in one fenced code block.',
];

const pad = (n) => String(n).padStart(2, '0');

// One request on one slot: its tokens and seconds as the server counted them, and its wall time.
async function write(url, prompt, slot) {
  const a = performance.now();
  const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS, ...model.sampling, temperature: 0.7,
    chat_template_kwargs: thinkingKwargs(model, false), cache_prompt: false, id_slot: slot, stream: false }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  const tokens = j.usage?.completion_tokens ?? j.timings?.predicted_n ?? 0;
  return { slot, tokens, ms: Math.round(performance.now() - a), serverTps: j.timings?.predicted_per_second ?? null };
}

// The page from a run's saved rows and summary.
function writePage(out, rows, s) {
  const at = new Date(s.started);
  writeFileSync(docsPath(s.page), buildTwoPage({
    title: `Two at once · ${s.name}`,
    dateline: `${at.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${pad(at.getHours())}:${pad(at.getMinutes())} · code ${s.code} · ${s.rounds} rounds · ${Math.round(s.secs)} s · Mac load ${s.load}`,
    s, rows, bar: BAR, raw: [relative(root, out)],
  }));
}

if (args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!s.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  if (!existsSync(DOCS_DIR)) { console.error(`the DOCS folder is not here (${DOCS_DIR})`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), s);
  console.log(`results page drawn again: ${s.page}`);
  process.exit(0);
}

const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = opt('out') ?? join(modelFolder(model), 'results', `two-at-once-${stamp}`); // modelFolder is already whole
mkdirSync(out, { recursive: true });

// Stop (the Arena's Stop sends SIGTERM): the round under way ends, and what is done is kept.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: keeping the rounds done so far…'); });

let url = opt('url'), srv = null, draft = null;
const t0 = Date.now();
if (!url) {
  // Looked up read-only (scanServers would also stop servers it finds left over).
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
  if (!contextCheck(model, CTX, { draft: hasDraft(model) }).fits) console.log('waiting for memory to free up (up to 2 minutes)…');
  for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) await new Promise((r) => setTimeout(r, 5000));
  const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
  if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  console.log(`${model.name} · ${ROUNDS} rounds of two pieces of code, one after the other and at once · loading the model…`);
  srv = new ModelServer(model);
  process.on('uncaughtException', async (e) => { console.error(e); try { await srv.stop(); } catch {} process.exit(1); });
  const st = await srv.start({ ctx: CTX, share: false, lingerSecs: 0 });
  if (st.slots < 2) { console.error('refused: this model runs with one slot, so there is nothing to run at once'); await srv.stop(); process.exit(5); }
  url = srv.url;
  draft = st.draft;
  console.log(`loaded in ${Math.round((Date.now() - t0) / 1000)} s${draft ? ' (speed helper on)' : ''}`);
} else console.log(`${model.name} · ${ROUNDS} rounds · on ${url}`);

// A first short answer on each slot, so neither way pays for the first run's setup.
await Promise.all([write(url, 'Say OK.', 0), write(url, 'Say OK.', 1)]).catch(() => {});

const rows = [];
let broke = null;
for (let r = 0; r < ROUNDS && !stopping; r++) {
  const [pa, pb] = [PROMPTS[(2 * r) % PROMPTS.length], PROMPTS[(2 * r + 1) % PROMPTS.length]];
  const ways = r % 2 ? ['together', 'apart'] : ['apart', 'together'];
  const row = { round: r + 1, first: ways[0] };
  try {
    for (const way of ways) {
      const a = performance.now();
      const reqs = way === 'apart' ? [await write(url, pa, 1), await write(url, pb, 1)] : await Promise.all([write(url, pa, 1), write(url, pb, 0)]);
      const ms = Math.round(performance.now() - a);
      const tokens = reqs.reduce((n, q) => n + q.tokens, 0);
      row[way] = { ms, tokens, tps: tokens / (ms / 1000), reqs };
    }
  } catch (e) { broke = e.message; break; }
  row.ratio = row.together.tps / row.apart.tps;
  rows.push(row);
  console.log(`${row.ratio >= BAR ? 'PASS' : 'FAIL'} round ${r + 1}: at once ${row.together.tps.toFixed(1)} tokens/s (${(row.together.ms / 1000).toFixed(1)} s for ${row.together.tokens}) · one after the other ${row.apart.tps.toFixed(1)} tokens/s (${(row.apart.ms / 1000).toFixed(1)} s for ${row.apart.tokens}) · ×${row.ratio.toFixed(2)}`);
}
if (srv) { try { await srv.stop(); } catch {} }
if (broke) console.error(`stopped: the model's server did not answer (${broke})`);

const sum = (way, k) => rows.reduce((n, r) => n + r[way][k], 0);
const apartTps = rows.length ? sum('apart', 'tokens') / (sum('apart', 'ms') / 1000) : 0;
const togetherTps = rows.length ? sum('together', 'tokens') / (sum('together', 'ms') / 1000) : 0;
const ratio = apartTps ? togetherTps / apartTps : 0;
const full = rows.length === ROUNDS;
const pass = full && ratio >= BAR;
const code = codeLabel();
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: model.id, name: model.name, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  rounds: rows.length, of: ROUNDS, apartTps, togetherTps, ratio, pass, stopped: !full, draft, ctx: CTX, maxTokens: MAX_TOKENS,
  load: Math.round(loadavg()[0] * 10) / 10, // how busy the Mac was at the end: the speeds depend on it
  page: docs ? `tests/agentic-coder-two-at-once-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);

if (!look) recordTest({
  kind: 'other', name: 'Two at once', model: model.id, ctx: CTX, passed: rows.filter((r) => r.ratio >= BAR).length, total: rows.length, secs, part: !full, bar: `at least ×${BAR} over the run`,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `Two tries at once wrote ${togetherTps.toFixed(1)} tokens a second, one after the other ${apartTps.toFixed(1)}: ×${ratio.toFixed(2)} (pass at ×${BAR})${draft ? '' : '; speed helper off'}.${broke ? ` Stopped: ${broke}.` : ''}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`Two at once on ${model.name}: ×${ratio.toFixed(2)} (${togetherTps.toFixed(1)} vs ${apartTps.toFixed(1)} tokens/s) · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(broke ? 1 : 0);
