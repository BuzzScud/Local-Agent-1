// Cache check (the Arena → Cache check, `/test cache`): a few practice tasks on the Claude API as /remote saved it,
// thinking on, and how much of what each reply sent Claude read from its prompt cache (a read costs 5% of the
// input price on Opus 5.5, a write a quarter more than plain). Then one results page and one line in the test record.
// Why (13 Oct 2026, the owner's pick "1 · Track cache re-use"): $155 went to the Claude API in two weeks and the
// app kept only the dollars, so nobody could say whether the cache worked. Each answer's tokens are now kept
// (agent/spend.mjs: "<ms> <usd> <sent> <hit> <wrote>" a line in spend/<day>/<pid>.claude); this check reads them.
// The rule (set before the first run): a task holds when every reply after its first reads at least 80% of what
// it sends from the cache (its first writes the instructions and tools, so it cannot); the check holds when
// every task does.
//   node models/evals/tools/cache-check.mjs [--remote-model <id>] [--only 31,37,39] [--out dir]
//   --no-record: a look only; no line in the test record and no results page
//   --from <dir>: the page and the record line from a run already made (<dir>/run and <dir>/replies.json)
//   --dry: print the command it would run, and stop
// It costs money on the Claude API: three hard tasks are about $0.60 on Opus 5.5 (13 Oct 2026).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { recordTest, codeLabel, HOME } from '../../index.mjs';
import { DOCS_DIR } from '../../../docs/tools/to-docs.mjs';
import { buildCheckPage } from './check-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo this code runs from
const home = process.env.AGENTIC_REPO ?? root; // where the results go
const docsDir = process.env.AGENTIC_DOCS ?? (home === root ? DOCS_DIR : join(home, 'docs'));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const only = opt('only', '31,37,39');
const look = args.includes('--no-record');
const from = opt('from', null);
const name = opt('remote-model', null);
const HIT_BAR = 0.8; // each reply after a task's first reads at least this much of what it sends from the cache

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = from ?? opt('out') ?? join(home, 'models', 'remote', 'results', `cache-check-${stamp}`);
// The run's own name for its spend files, so its replies are told from every window's (agent/spend.mjs).
const spendId = `cache-check-${stamp}`;
const spendDir = join(process.env.AGENTIC_HOME ?? HOME, 'spend');

const benchArgs = [join(root, 'models', 'evals', 'bench', 'run.mjs'), '--remote', 'claude', ...(name ? ['--remote-model', name] : []), '--think', 'on', '--only', only, '--out', join(out, 'run'), '--no-record'];
if (args.includes('--dry')) { console.log(`AGENTIC_SPEND_PID=${spendId} ${[process.execPath, ...benchArgs].join(' ')}`); process.exit(0); }

let stopping = false;
let child = null;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log('stopping: the run saves what it did');
  child?.kill(sig);
});

// Each reply the run's window sent to the Claude API: { at, usd, sent, hit, wrote }, from the spend lines.
function repliesOf(id, fromMs) {
  const rows = [];
  let days = [];
  try { days = readdirSync(spendDir).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)); } catch {}
  for (const d of days) {
    let text = '';
    try { text = readFileSync(join(spendDir, d, `${id}.claude`), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const [at, usd, sent, hit, wrote] = line.split(' ').map(Number);
      if (at >= fromMs && Number.isFinite(sent)) rows.push({ at, usd, sent, hit, wrote });
    }
  }
  return rows.sort((a, b) => a.at - b.at);
}

if (!from) {
  mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  console.log(`Cache check: practice tasks ${only} on the Claude API, thinking on`);
  const code = await new Promise((ok) => {
    child = spawn(process.execPath, benchArgs, { cwd: root, env: { ...process.env, AGENTIC_SPEND_PID: spendId }, stdio: ['ignore', 'pipe', 'pipe'] });
    // The run's own PASS/FAIL lines are the task's check, not this one's: they are shown as "task …".
    createInterface({ input: child.stdout }).on('line', (l) => console.log(l.replace(/^(PASS|FAIL)(\s+)/, 'task $1$2')));
    createInterface({ input: child.stderr }).on('line', (l) => console.error(l));
    child.on('exit', (c) => ok(c));
  });
  child = null;
  if (code !== 0 && !stopping) console.log(`the run ended with code ${code}`);
  writeFileSync(join(out, 'replies.json'), JSON.stringify(repliesOf(spendId, t0), null, 1));
}

let run = null, replies = [];
try { run = JSON.parse(readFileSync(join(out, 'run', 'summary.json'), 'utf8')); } catch {}
try { replies = JSON.parse(readFileSync(join(out, 'replies.json'), 'utf8')); } catch {}
if (!run?.results?.length) { console.error(`nothing to read: no tasks in ${join(out, 'run', 'summary.json')}`); process.exit(1); }
const model = run.remote?.model ?? name ?? 'Claude';
const share = (c) => (c.sent ? c.hit / c.sent : 0);
const pct = (x) => `${Math.round(100 * x)}%`;
const money = (n) => `$${n.toFixed(2)}`;
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// Each reply goes with the task that had started last before it (the tasks run one after another).
const results = [...run.results].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
const taskOf = (at) => [...results].reverse().find((r) => (r.startedAt ?? 0) <= at) ?? results[0];
for (const r of results) r.replies = [];
for (const x of replies) taskOf(x.at).replies.push(x);
const rows = results.map((r) => {
  const later = r.replies.slice(1);
  const low = later.filter((x) => share(x) < HIT_BAR);
  const all = r.replies.reduce((c, x) => ({ sent: c.sent + x.sent, hit: c.hit + x.hit, wrote: c.wrote + x.wrote, usd: c.usd + x.usd }), { sent: 0, hit: 0, wrote: 0, usd: 0 });
  const ok = r.replies.length > 1 && !low.length;
  const detail = !r.replies.length ? 'no reply with cache numbers was kept'
    : r.replies.length === 1 ? 'one reply only: nothing after it to read the cache'
    : `${r.replies.length} replies, ${pct(share(all))} of ${tok(all.sent)} tokens from the cache, ${money(all.usd)}${low.length ? `; under ${pct(HIT_BAR)}: reply ${low.map((x) => r.replies.indexOf(x) + 1).join(', ')} (${low.map((x) => pct(share(x))).join(', ')})` : `; after the first, the lowest ${pct(Math.min(...later.map(share)))}`}${r.pass ? '' : ' · the task itself failed its check'}`;
  return { id: r.task, name: `${r.task}${r.pass ? '' : ' (task failed)'}`, ok, detail, secs: r.secs, all };
});
const total = rows.reduce((c, r) => ({ sent: c.sent + r.all.sent, hit: c.hit + r.all.hit, wrote: c.wrote + r.all.wrote, usd: c.usd + r.all.usd }), { sent: 0, hit: 0, wrote: 0, usd: 0 });
const laterAll = results.flatMap((r) => r.replies.slice(1)).reduce((c, x) => ({ sent: c.sent + x.sent, hit: c.hit + x.hit }), { sent: 0, hit: 0 });
// What the same replies would have cost with no cache at all: every token sent at the plain price.
const price = { 'claude-opus-5-5': 4, 'claude-sonnet-5-5': 2, 'claude-fable-5-1': 10, 'claude-haiku-4-5': 1 }[model] ?? null;
const plain = price == null ? null : total.usd + (total.hit * price * 0.95 - total.wrote * price * 0.25) / 1e6;
const want = only.split(',').length;
const passed = rows.filter((r) => r.ok).length;
const full = rows.length === want && !run.stopped;
const pass = full && passed === want;

const s = { name: model, of: want, checks: rows.length, passed, pass, stopped: !full, sub: `${replies.length} replies on the Claude API · ${money(total.usd)}`, share: share(total), later: share(laterAll), usd: total.usd, plain, code: codeLabel(root) };
const verdict = !full ? null
  : pass ? `<b>Yes: the cache works.</b> After each task's first reply, ${pct(s.later)} of what ${model} was sent came from its cache, and every reply read at least ${pct(HIT_BAR)}.${plain != null ? ` These ${replies.length} replies cost ${money(total.usd)}; with no cache they would have cost about ${money(plain)}.` : ''}`
  : `<b>No: some replies missed the cache.</b> After each task's first reply, ${pct(s.later)} of what ${model} was sent came from its cache, but ${want - passed} of ${want} tasks had a reply under ${pct(HIT_BAR)} (tab 2 says which).`;
const replyRows = results.flatMap((r) => r.replies.map((x, i) => `<tr><td>${r.task}</td><td class="num">${i + 1}</td><td class="num">${tok(x.sent)}</td><td class="num">${tok(x.hit)}</td><td class="num">${tok(x.wrote)}</td><td class="num ${i && share(x) < HIT_BAR ? 'no' : ''}">${pct(share(x))}</td><td class="num">${money(x.usd)}</td></tr>`)).join('');
const more = [{ id: 'replies', name: 'Each reply', html: `<div class="table-wrap"><table><thead><tr><th>Task</th><th class="num">Reply</th><th class="num">Sent<small>tokens</small></th><th class="num">From the cache<small>higher is cheaper</small></th><th class="num">Written to it<small>a quarter more</small></th><th class="num">Share<small>higher is better</small></th><th class="num">Cost<small>lower is better</small></th></tr></thead><tbody>${replyRows}</tbody></table></div>` }];
const docs = existsSync(docsDir);
const slug = String(model).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const page = docs && !look ? `tests/agentic-coder-cache-check-${slug}-${stamp}.html` : '';
writeFileSync(join(out, 'summary.json'), JSON.stringify({ ...s, only, rule: `every reply after a task's first ≥ ${pct(HIT_BAR)} from the cache`, rows: rows.map(({ all, ...r }) => ({ ...r, ...all })), page }, null, 2));
if (page) {
  mkdirSync(join(docsDir, 'tests'), { recursive: true });
  writeFileSync(join(docsDir, page), buildCheckPage({
    title: `Cache check · ${model}`, summary: s, rows, raw: [relative(home, out)], first: false, more,
    passRule: `every reply after a task's first reads ≥ ${pct(HIT_BAR)} from the cache`, verdict,
    cards: [
      { k: 'From the cache, after each first reply', v: pct(s.later), sub: `all replies: ${pct(s.share)} of ${tok(total.sent)} tokens`, dir: 'higher is cheaper' },
      { k: 'What the replies cost', v: money(total.usd), sub: plain != null ? `with no cache: about ${money(plain)}` : 'the cost meter’s figure', dir: 'lower is better' },
      { k: 'Tasks that held', v: `${passed} of ${want}`, sub: 'every reply after the first at the bar', dir: 'higher is better' },
    ],
    how: [
      `The model: ${model} on the Claude API, thinking on, through <b>bench/run.mjs --remote claude --only ${only}</b>: the hard practice tasks as the Arena runs them, each in a throwaway copy, one after another.`,
      'Each reply’s tokens come from Claude’s own answer (usage: input, cache read, cache written). Since 13 Oct 2026 the cost meter keeps them a line a reply; this run’s replies are the ones under its own name.',
      `The rule, set before the first run: a task holds when every reply after its first reads at least ${pct(HIT_BAR)} of what it sends from the cache (the first reply writes the instructions and the tools, so it cannot). The check holds when every task does.`,
      `A read from the cache costs 5% of the input price on Opus and Sonnet 5.5; writing to it costs a quarter more than plain input. “With no cache” prices every token sent at the plain price.`,
      `Code: <code>${s.code}</code>. Run ${now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`,
    ],
  }));
  console.log(`results page: ${page}`);
} else if (look) console.log('a look only: no results page, no line in the test record');
else console.log(`no results page: the DOCS folder is not here (${docsDir})`);
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.detail}`);
if (!look) recordTest({
  kind: 'other', model: `remote:${model}`, name: 'Cache check', code: s.code, effort: 'high', ctx: run.ctx ?? null,
  passed, total: want, secs: rows.reduce((n, r) => n + (r.secs ?? 0), 0), result: full ? (pass ? 'pass' : 'fail') : 'stopped', part: false,
  note: `${pct(s.later)} from the cache after each first reply (${pct(s.share)} of all ${tok(total.sent)} tokens) · ${replies.length} replies, ${money(total.usd)}${plain != null ? `, about ${money(plain)} with no cache` : ''}`,
  bar: `every reply after a task's first ≥ ${pct(HIT_BAR)} from the cache`, raw: relative(home, out), page,
});
console.log(`Cache check on ${model}: ${passed} of ${want} tasks held · ${pct(s.later)} from the cache after each first reply · ${money(total.usd)}${plain != null ? ` (about ${money(plain)} with no cache)` : ''} · ${full ? (pass ? 'HOLDS' : 'DOES NOT HOLD') : 'PART RUN'}`);
process.exit(0);
