// The ConstantKV check (the Arena's checks → ConstantKV check, `/test constantkv`): does Bonsai 2 27B
// ConstantKV run on this Mac well enough to build into Agentic Coder beside today's Bonsai? It is the
// same Bonsai weights as Prism's MLX pack, with a closed runtime (crystal_runtime, a research license)
// that keeps the attention memory of its 16 full-attention layers at 1.27 GB at any length.
// The bar, written before the first run (1 Oct 2026). PASS when all four hold:
//   (a) it loads and answers;
//   (b) it reads 40+ tokens a second up to 16k tokens;
//   (c) it holds 64k tokens with a peak footprint of 12.5 GB or less;
//   (d) the app's real instructions and tools give a call the app's own parser reads (toolCallInText),
//       on 2 of 3 tries.
// (a)–(c) are decided by constantkv/run.py, in the Python of ~/.agentic-coder/engine/mlx-crystal-2.0.0,
// with the model in ~/.agentic-coder/models/Ternary-Bonsai-2-27B-ConstantKV; (d) here, from the replies
// it saves. It needs about 12.5 GB free: the Arena holds the memory for it (its `memory` in
// run-tests.mjs), so an Agentic Coder window lets go of its model first.
// It writes its results page into the DOCS folder (tests/) and its line in the test record.
//   node models/evals/tools/constantkv-check.mjs [--no-record]
//   --no-record: a look only; no line in the test record and no results page
//   CKV_PYTHON, CKV_SCRIPT, CKV_PACK, CKV_OUT: another Python, model half, model folder or results
//   folder (the tests' stand-in)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { HOME, MODELS_DIR, recordTest, codeLabel } from '../../index.mjs';
import { toolCallInText, toolSchemas, systemPrompt } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const look = process.argv.includes('--no-record');
const PACK = process.env.CKV_PACK || join(MODELS_DIR, 'Ternary-Bonsai-2-27B-ConstantKV');
const PY = process.env.CKV_PYTHON || join(HOME, 'engine', 'mlx-crystal-2.0.0', 'venv', 'bin', 'python');
const SCRIPT = process.env.CKV_SCRIPT || join(here, 'constantkv', 'run.py');
// Today's Bonsai (llama.cpp, PQ2_0, with its helper), measured on the 28 practice tasks of 25 Sep 2026.
const BONSAI = { read: 52, write: 13.7, file: 7.21 };
const ITEMS = { a: 'it loads and answers', b: 'it reads 40+ tokens a second up to 16k', c: 'it holds 64k tokens at 12.5 GB or less', d: 'the app’s tool calls on 2 of 3 tries' };
const t0 = Date.now(); const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
let stopping = false;

console.log('ConstantKV check · Bonsai 2 27B ConstantKV on this Mac · against a bar written before the first run');
const missing = [[PY, 'its Python (~/.agentic-coder/engine/mlx-crystal-2.0.0)'], [join(PACK, 'model.safetensors'), 'the model (~/.agentic-coder/models/Ternary-Bonsai-2-27B-ConstantKV)'], [SCRIPT, 'its model half']].filter(([p]) => !existsSync(p));
if (missing.length) {
  console.log(`FAIL  (a) ${ITEMS.a}: not set up on this Mac, ${missing.map(([, w]) => w).join(' and ')} missing`);
  console.log('nothing ran, so nothing is recorded');
  process.exit(1);
}

// The app's own start, as a model gets it: the instructions for an empty folder and the tools of Who decides: Model.
const out = process.env.CKV_OUT || join(root, 'models', 'bonsai-2-27b', 'results', `constantkv-${stamp}`);
const project = join(out, 'project'); mkdirSync(project, { recursive: true });
const app = { system: systemPrompt({ cwd: project, notes: '', git: 'not a git repo', tests: null }), tools: toolSchemas('model') };
writeFileSync(join(out, 'app-prompt.json'), JSON.stringify(app, null, 1));

// The model half: its lines pass straight through (the Arena shows them live). Stop reaches it as well
// (the runner stops a check of no model with everything it started); it ends with what it has.
const code = await new Promise((ok) => {
  const child = spawn(PY, [SCRIPT, out, join(out, 'app-prompt.json')], { cwd: out, env: { ...process.env, CKV_PACK: PACK, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const relay = (s) => { let buf = ''; s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { console.log(buf.slice(0, i)); buf = buf.slice(i + 1); } }); s.on('end', () => { if (buf) console.log(buf); }); };
  relay(child.stdout); relay(child.stderr);
  const onStop = () => { stopping = true; try { child.kill('SIGTERM'); } catch {} };
  process.on('SIGTERM', onStop); process.on('SIGINT', onStop);
  child.on('exit', (c, sig) => ok(c ?? (sig ? 128 : 1)));
  child.on('error', (e) => { console.log(`  ERROR: ${e.message}`); ok(1); });
});

// What the model half wrote down.
const rows = []; try { for (const l of readFileSync(join(out, 'results.jsonl'), 'utf8').split('\n')) if (l.trim()) { try { rows.push(JSON.parse(l)); } catch {} } } catch {}
const bars = {}; for (const r of rows.filter((x) => x.phase === 'bar')) bars[r.item] = { ok: r.ok, value: r.value, text: r.text };
const tries = rows.filter((r) => r.phase === 'agent'), points = rows.filter((r) => r.phase === 'long' && r.T && !r.stopped);
const start = rows.find((r) => r.phase === 'start') ?? null, load = rows.find((r) => r.phase === 'load') ?? null, end = rows.find((r) => r.phase === 'end') ?? null;
const error = (rows.find((r) => r.phase === 'error')?.error ?? null)?.split(homedir()).join('~') ?? null, early = rows.find((r) => r.phase === 'long' && r.stopped)?.stopped ?? null;
const stopped = stopping || rows.some((r) => r.phase === 'stopped');

// (d): each saved reply read with the app's own parser, as the app reads a call written as text.
const calls = [];
const defs = app.tools.map((t) => t.function);
for (const k of [1, 2, 3]) {
  const f = join(out, `agent-try${k}.txt`);
  if (!existsSync(f)) continue;
  const call = toolCallInText(readFileSync(f, 'utf8'));
  const def = call && defs.find((d) => d.name === call.name);
  let args = null; try { args = call ? JSON.parse(call.args) : null; } catch {}
  const lacks = def ? (def.parameters.required ?? []).filter((r) => args?.[r] === undefined) : [];
  calls.push({ tri: k, ok: Boolean(def && args && !lacks.length), name: call?.name ?? null, args: args ? Object.keys(args) : [], lacks });
}
if (calls.length) {
  console.log('Tool calls (read with the app’s own parser):');
  for (const c of calls) console.log(`  Try ${c.tri}: ${c.ok ? `a real ${c.name} call (${c.args.join(', ')})` : c.name ? `a ${c.name} call without ${c.lacks.join(', ') || 'readable arguments'}` : 'no call the app can read'}`);
}
const good = calls.filter((c) => c.ok).length;
if (calls.length === 3) { bars.d = { ok: good >= 2, value: good, text: `${ITEMS.d}: ${good} of 3` }; console.log(`${good >= 2 ? 'PASS' : 'FAIL'}  (d) ${bars.d.text}`); }
for (const k of Object.keys(ITEMS)) if (!bars[k]) console.log(`  (${k}) ${ITEMS[k]}: not reached${stopped ? ' (stopped)' : early ? ` (${early})` : error ? ' (the run ended with an error)' : ''}`);

const passed = Object.values(bars).filter((b) => b.ok).length;
const pass = passed === 4;
const secs = (Date.now() - t0) / 1000;
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  code: codeLabel(), started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs, exit: code, stopped, error, early,
  bars, passed, pass, start, load, end, prompt: rows.find((r) => r.phase === 'agent-prompt')?.tokens ?? null, tries, points, calls,
  write: median(tries.map((t) => t.write_tps)), read: median(tries.map((t) => t.read_tps)),
  page: docs ? `tests/agentic-coder-constantkv-check-${stamp}.html` : '',
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writeFileSync(docsPath(summary.page), page(summary)); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look && (rows.length || calls.length)) recordTest({
  kind: 'other', name: 'ConstantKV check', passed, total: 4, secs, part: stopped, bar: 'all four: loads · 40+ tokens/s to 16k · 64k at 12.5 GB or less · tool calls on 2 of 3',
  result: stopped ? 'stopped' : pass ? 'pass' : 'fail',
  note: `Bonsai 2 27B ConstantKV: ${['a', 'b', 'c', 'd'].map((k) => `(${k}) ${bars[k] ? (bars[k].ok ? 'pass' : 'fail') : 'not reached'}`).join(', ')}.${summary.read ? ` Reads ${summary.read}/s at the app's start` : ''}${bars.b ? `, ${bars.b.value}/s to 16k` : ''}${summary.write ? `; writes ${summary.write}/s (today's Bonsai ${BONSAI.write})` : ''}${bars.c?.value ? `; peak ${bars.c.value} GB` : ''}.${error ? ` Error: ${String(error).slice(0, 160)}` : ''}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`ConstantKV check: ${passed} of 4 · ${stopped ? 'STOPPED' : pass ? 'PASSED · worth building' : 'FAILED · not worth building as it stands'}${summary.write ? ` · writes ${summary.write}/s (today’s Bonsai ${BONSAI.write})` : ''}`);
process.exit(stopped || pass || rows.length ? 0 : 1);

// ---------- the results page: tabs that fit the window ----------
function page(s) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = new Date(s.finished).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const f1 = (x) => (x == null ? '—' : Number(x).toFixed(1));
  const mark = (k) => (s.bars[k] ? (s.bars[k].ok ? '<span class="ok">pass</span>' : '<span class="bad">fail</span>') : '<span class="mute">not reached</span>');
  const verdict = s.stopped ? 'Stopped before the end' : s.pass ? 'PASS: worth building beside today’s Bonsai' : 'FAIL: not worth building as it stands';
  const tile = (k, label, value, dir) => `<div class="tile"><span class="k">(${k}) ${label} · ${mark(k)}</span><b>${value}</b><small>${dir}</small></div>`;
  const p64 = s.points.find((p) => p.T === 65536);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ConstantKV check</title><style>
:root { --page: #f9f9f7; --surface: #fcfcfb; --line: #e3e2dc; --ink: #0b0b0b; --ink2: #52514e; --ink3: #8a887f; --ok: #1c8558; --bad: #b3261e; --mono: ui-monospace, "SF Mono", Menlo, monospace; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #0d0d0d; --surface: #1a1a19; --line: #34342f; --ink: #fff; --ink2: #c3c2b7; --ink3: #8f8e86; --ok: #4fc38d; --bad: #ff8b82; color-scheme: dark; } }
:root[data-theme="dark"] { --page: #0d0d0d; --surface: #1a1a19; --line: #34342f; --ink: #fff; --ink2: #c3c2b7; --ink3: #8f8e86; --ok: #4fc38d; --bad: #ff8b82; color-scheme: dark; }
* { box-sizing: border-box; } body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 14px 24px; } h1 { font-size: 21px; margin: 0; } .dateline { color: var(--ink3); font-size: 13px; }
nav { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 12px; } nav button { font: inherit; padding: 6px 13px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; } nav button[aria-selected="true"] { background: var(--ink); color: var(--page); border-color: var(--ink); }
[hidden] { display: none !important; } .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.verdict { font-size: 17px; font-weight: 650; margin: 0 0 10px; } .verdict.ok { color: var(--ok); } .verdict.bad { color: var(--bad); }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; } .tile { display: flex; flex-direction: column; gap: 2px; } .tile b { font-size: 22px; } .tile .k { color: var(--ink2); font-size: 13px; } .tile small { color: var(--ink3); font-size: 11.5px; }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; } .mute { color: var(--ink3); }
.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; } th, td { text-align: left; padding: 5px 10px; border-top: 1px solid var(--line); } thead th { border-top: none; color: var(--ink3); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; } td.num, th.num { text-align: right; } code { font-family: var(--mono); font-size: 12px; }
h3 { font-size: 14px; margin: 0 0 6px; } p, ol { color: var(--ink2); max-width: 940px; } li + li { margin-top: 4px; }
@media (max-width: 800px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } .two { grid-template-columns: minmax(0, 1fr); } main { padding: 12px 16px; } }
</style></head><body><main>
<h1>ConstantKV check</h1><div class="dateline">${esc(when)} · code ${esc(s.code)} · Bonsai 2 27B ConstantKV on this Mac · ${Math.round(s.secs / 60)} min</div>
<nav role="tablist"><button role="tab" data-v="result" aria-selected="true">1 · The result</button><button role="tab" data-v="all" aria-selected="false">2 · Every number</button><button role="tab" data-v="how" aria-selected="false">3 · How it is checked</button></nav>
<section data-v="result"><p class="verdict ${s.pass ? 'ok' : 'bad'}">${verdict} · ${s.passed} of 4</p>
<div class="tiles card">${tile('a', 'It runs', s.bars.a ? (s.bars.a.ok ? 'answers' : 'no answer') : '—', 'loads and answers = pass')}${tile('b', 'Reads up to 16k', s.bars.b ? `${f1(s.bars.b.value)}/s` : '—', 'tokens a second · more is better · 40+ = pass')}${tile('c', 'Peak at 64k', s.bars.c?.value != null ? `${f1(s.bars.c.value)} GB` : '—', 'footprint · less is better · 12.5 or less = pass')}${tile('d', 'Tool calls the app reads', s.calls.length ? `${s.calls.filter((c) => c.ok).length} of 3` : '—', 'more is better · 2 of 3 = pass')}</div>
<div class="card"><h3>Beside today’s Bonsai</h3><table><thead><tr><th></th><th class="num">ConstantKV (this run)</th><th class="num">Bonsai today</th><th>Which way is better</th></tr></thead><tbody>
<tr><td>Reading, tokens a second (the app’s start)</td><td class="num">${f1(s.read)}</td><td class="num">${BONSAI.read}</td><td>more</td></tr>
<tr><td>Writing, tokens a second</td><td class="num">${f1(s.write)}</td><td class="num">${BONSAI.write}</td><td>more</td></tr>
<tr><td>Peak footprint at 64k tokens, GB</td><td class="num">${p64 ? f1(p64.footprint_gb) : '—'}</td><td class="num">not run (32k is its ceiling here)</td><td>less</td></tr>
<tr><td>Model file, GB</td><td class="num">8.6</td><td class="num">${BONSAI.file}</td><td>less</td></tr></tbody></table>
<p>Bonsai today: llama.cpp with its PQ2_0 file and its guessing helper, from the 28 practice tasks of 25 Sep 2026. ConstantKV writes without a helper: its author’s paper says its drafts do not pay on an M4.</p></div>
${s.error ? `<div class="card"><h3>It ended with an error</h3><p><code>${esc(String(s.error).slice(0, 400))}</code></p></div>` : ''}</section>
<section data-v="all" hidden><div class="two"><div class="card"><h3>Part 1 · the app’s real start${s.prompt ? ` (${s.prompt.toLocaleString('en-US')} tokens)` : ''}</h3><table><thead><tr><th>Try</th><th class="num">Reads /s</th><th class="num">Wrote</th><th class="num">Writes /s</th><th>Ended</th><th>Tool call</th></tr></thead><tbody>${[1, 2, 3].map((k) => { const t = s.tries.find((x) => x.tri === k), c = s.calls.find((x) => x.tri === k); return t || c ? `<tr><td>${k}</td><td class="num">${f1(t?.read_tps)}</td><td class="num">${t?.wrote ?? '—'}</td><td class="num">${f1(t?.write_tps)}</td><td>${t ? (t.ended === 'eos' ? 'by itself' : 'at 300') : '—'}</td><td>${c ? (c.ok ? `<span class="ok">${esc(c.name)}</span>` : `<span class="bad">${c.name ? `${esc(c.name)}, lacks ${esc(c.lacks.join(', '))}` : 'none'}</span>`) : '—'}</td></tr>` : ''; }).join('') || '<tr><td colspan="6">Part 1 did not run.</td></tr>'}</tbody></table></div>
<div class="card"><h3>Part 2 · one long read (two books, 64k tokens)</h3><table><thead><tr><th class="num">Tokens</th><th class="num">Reads /s</th><th class="num">Writes, ms a token</th><th class="num">Footprint GB</th><th class="num">Free GB</th></tr></thead><tbody>${s.points.map((p) => `<tr><td class="num">${p.T.toLocaleString('en-US')}</td><td class="num">${f1(p.read_tps)}</td><td class="num">${Math.round(p.write_ms)}</td><td class="num">${f1(p.footprint_gb)}</td><td class="num">${f1(p.free_gb)}</td></tr>`).join('') || '<tr><td colspan="5">Part 2 did not report.</td></tr>'}${s.early ? `<tr><td colspan="5">Stopped early: ${esc(s.early)}</td></tr>` : ''}</tbody></table></div></div>
<div class="card"><p>Free memory at the start: <b>${f1(s.start?.free_gb)} GB</b> · swap used ${f1(s.start?.swap_gb)} GB · loaded in ${s.load ? Math.round(s.load.sec) : '—'} s · peak footprint over the whole run ${f1(s.end?.footprint_peak_gb)} GB.</p></div></section>
<section data-v="how" hidden><div class="card"><ol>
<li>The model is <code>tfwnotops/Ternary-Bonsai-2-27B-ConstantKV</code> (revision a9489cfe, 30 Sep 2026): Prism ML’s MLX pack of Bonsai 2 27B, byte for byte, and a closed runtime (<code>crystal_runtime</code> 2.0.0, a research license) whose 16 full-attention layers keep 1.27 GB at any length: the last 1,024 tokens exactly, 8,192 picked tokens exactly, the rest folded into a small running state. Up to 9,216 tokens it is the model’s own attention.</li>
<li>It runs in its own Python (<code>~/.agentic-coder/engine/mlx-crystal-2.0.0</code>, mlx 0.32.0) from <code>~/.agentic-coder/models/Ternary-Bonsai-2-27B-ConstantKV</code>. Only the calls its own Apache-licensed scripts make are used; nothing looks inside the runtime.</li>
<li>Part 1: the app’s own instructions for an empty folder and the tools a model gets (Who decides: Model), one request (“Create hello.py that prints the first 10 Fibonacci numbers…”), three tries with Bonsai’s sampling (temperature 0.7, top_p 0.8, top_k 20), thinking off. Each reply is read with <code>toolCallInText</code>, the app’s parser for a call written as text; a call counts when it names one of the tools and has its required arguments.</li>
<li>Part 2: two books from the model’s own evaluation data, joined, read in blocks of 512 tokens up to 65,536, with 16 tokens written at 4k, 16k, 32k and 64k. It stops early when (b) has failed at 16k, or when the footprint passes 14 GB.</li>
<li>Memory is the process’s macOS footprint (what the app’s memory guard reads), sampled every 2 seconds.</li>
<li>The bar, written before the first run: (a) it answers; (b) 40+ tokens a second up to 16k; (c) a peak of 12.5 GB or less at 64k; (d) a readable tool call on 2 of 3 tries. All four = worth building beside today’s Bonsai.</li>
<li>The raw results are on this Mac in <code>${esc(relative(root, out))}/</code> (results.jsonl, summary.json, the three replies).</li></ol></div></section>
</main><script>(function () { const tabs = [...document.querySelectorAll('[role="tab"]')], views = [...document.querySelectorAll('section[data-v]')]; const show = (v) => { if (!tabs.some((t) => t.dataset.v === v)) v = tabs[0].dataset.v; tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === v))); views.forEach((x) => { x.hidden = x.dataset.v !== v; }); try { history.replaceState(null, '', '#' + v); } catch {} }; tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.v))); document.addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; const at = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'); const to = /^[1-3]$/.test(e.key) ? Number(e.key) - 1 : e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : -1; if (to >= 0 && to < tabs.length) show(tabs[to].dataset.v); }); if (location.hash.length > 1) show(location.hash.slice(1)); window.addEventListener('hashchange', () => show(location.hash.slice(1))); })();</script></body></html>`;
}
