// The weights reader check (the Arena's checks → Weights reader check, `/test reader`): does the
// hub's Weights tab read every model file on this Mac exactly as llama.cpp does? The reader is the
// page's own (the <script id="core"> in terminal/src/app/weights.html); the answer to check it
// against is llama.cpp's own Python reader (its gguf package), run through uv, which fetches it the
// first time. For each model file: every storage type it keeps a big matrix in, up to three
// matrices of each type (the first, one in the middle, the last), five rows of each (the first
// three, the middle one, the last), every weight compared.
// Pass (the rule of 30 Sep 2026): every weight compared is identical, and no big matrix in any of
// the files is of a type the page cannot read.
// It writes its results page into the DOCS folder (tests/) and its line in the test record, which
// names that page, so the Arena's record opens it.
//   node models/evals/tools/reader-check.mjs [--models gemma,qwen] [--no-record]
//   --no-record: a look only; no line in the test record and no results page
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MODELS, modelPath, recordTest, codeLabel } from '../../index.mjs';
import { weightsCore } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const look = args.includes('--no-record');
const Core = weightsCore();
const t0 = Date.now(); const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const fmt = (n) => Number(n).toLocaleString('en-US');
let stopping = false; process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });

// A "file" the way the reader wants one, over a path on disk.
const fileOf = (p) => { const size = statSync(p).size; return { name: basename(p), size, slice: (a, b) => ({ arrayBuffer: async () => { const fd = openSync(p, 'r'); try { const n = Math.min(b, size) - a; const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, a); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + n); } finally { closeSync(fd); } } }) }; };

// GGUF files only: an MLX model's pack (format 'mlx') has no GGUF reader to check.
const ids = opt('models', Object.keys(MODELS).filter((id) => MODELS[id].format !== 'mlx').join(',')).split(',').filter((id) => MODELS[id]);
const models = ids.map((id) => ({ id, name: MODELS[id].name, path: modelPath(MODELS[id]) })).filter((m) => existsSync(m.path));
console.log(`Weights reader check · ${models.length ? models.map((m) => m.name).join(' and ') : 'no model file on this Mac'} · against llama.cpp's own reader`);

// What to compare: per file, per storage type, up to three matrices and five rows of each.
const picks = []; const unreadable = [];
for (const m of models) {
  m.file = fileOf(m.path); m.head = await Core.parseHeader(m.file);
  const big = m.head.tensors.filter((t) => t.dims.length === 2);
  for (const t of big) if (!t.rowBytes) unreadable.push({ model: m.id, tensor: t.name, type: t.typeName });
  const byType = {}; for (const t of big) if (t.rowBytes && Core.BLOCK[t.type]) (byType[t.typeName] ||= []).push(t);
  m.types = Object.keys(byType);
  for (const [type, ts] of Object.entries(byType)) {
    for (const t of [...new Set([ts[0], ts[Math.floor(ts.length / 2)], ts[ts.length - 1]])]) {
      const rows = [...new Set([0, 1, 2, Math.floor(t.rows / 2), t.rows - 1].filter((r) => r >= 0 && r < t.rows))];
      picks.push({ model: m.id, path: m.path, tensor: t.name, type, rows, ne0: t.ne0, of: ts.length });
    }
  }
}

// llama.cpp's reader, through uv: those rows as float32, one file per matrix.
const out = join(root, 'models', 'evals', 'results', `reader-check-${stamp}`); mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'picks.json'), JSON.stringify(picks, null, 2));
writeFileSync(join(out, 'reference.py'), `# llama.cpp's own reader (its gguf package): the picked rows of each matrix, as float32.
import sys, json, numpy as np
from gguf import GGUFReader
from gguf.quants import dequantize
out = sys.argv[1]; picks = json.load(open(out + '/picks.json')); readers = {}
for i, p in enumerate(picks):
    r = readers.get(p['path']) or readers.setdefault(p['path'], GGUFReader(p['path']))
    t = next(x for x in r.tensors if x.name == p['tensor'])
    dequantize(np.asarray(t.data)[p['rows']], t.tensor_type).astype(np.float32).tofile(f"{out}/ref-{i}.f32")
    print(f"read {p['model']} {p['tensor']}", flush=True)
`);
let reference = null;
if (picks.length && !stopping) {
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  if (uv.status !== 0) reference = 'uv is not on this Mac: the check needs it to run llama.cpp’s reader (brew install uv)';
  else {
    console.log(`asking llama.cpp's reader for ${picks.length} matrices (${uv.stdout.trim()})…`);
    const r = spawnSync('uv', ['run', '--quiet', '--no-project', '--with', 'gguf', '--with', 'numpy', 'python', join(out, 'reference.py'), out], { encoding: 'utf8', timeout: 600000 });
    if (r.status !== 0) reference = `llama.cpp’s reader did not run: ${(r.stderr || r.error?.message || '').trim().split('\n').slice(-2).join(' ').slice(0, 300)}`;
  }
}

// Compare, weight for weight.
const rows = [];
for (const [i, p] of picks.entries()) {
  if (stopping || reference) break;
  const m = models.find((x) => x.id === p.model); const t = m.head.tensors.find((x) => x.name === p.tensor);
  const want = new Float32Array(readFileSync(join(out, `ref-${i}.f32`)).buffer.slice(0));
  let same = 0, n = 0, first = null;
  for (const [k, r] of p.rows.entries()) {
    const got = Core.realRow(t, Core.decodeRows(t, await Core.readRows(m.file, m.head, t, r, 1), 1), 0, null, new Float32Array(t.ne0));
    for (let c = 0; c < t.ne0; c++) { n++; if (Object.is(got[c], want[k * t.ne0 + c]) || got[c] === want[k * t.ne0 + c]) same++; else if (!first) first = { row: r, col: c, got: got[c], want: want[k * t.ne0 + c] }; }
  }
  const row = { model: p.model, type: p.type, tensor: p.tensor, rows: p.rows, weights: n, same, first, of: p.of };
  rows.push(row);
  console.log(`${same === n ? 'PASS' : 'FAIL'} ${p.model} ${p.type.padEnd(5)} ${p.tensor.padEnd(30)} rows ${p.rows.join(',')} · ${fmt(same)} of ${fmt(n)} identical${first ? ` · first difference: row ${first.row}, column ${first.col}: ${first.got} here, ${first.want} in llama.cpp` : ''}`);
}
for (const u of unreadable) console.log(`FAIL ${u.model} ${u.tensor} is kept as ${u.type}, which the page cannot read`);
if (reference) console.error(`stopped: ${reference}`);

const weights = rows.reduce((a, r) => a + r.weights, 0), same = rows.reduce((a, r) => a + r.same, 0);
const good = rows.filter((r) => r.same === r.weights).length;
const full = !stopping && !reference && rows.length === picks.length && models.length > 0;
const pass = full && good === rows.length && !unreadable.length;
const code = codeLabel(); const secs = (Date.now() - t0) / 1000;
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs, models: models.map((m) => ({ id: m.id, name: m.name, file: basename(m.path), types: m.types })),
  matrices: rows.length, of: picks.length, good, weights, same, unreadable, pass, stopped: !full, why: reference,
  page: docs ? `tests/agentic-coder-weights-reader-check-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2)); writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writeFileSync(docsPath(summary.page), page(summary, rows)); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'Weights reader check', passed: good, total: picks.length, secs, part: !full, bar: 'every weight identical, every matrix readable',
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${fmt(same)} of ${fmt(weights)} weights identical to llama.cpp’s reader, in ${good} of ${rows.length} matrices of ${summary.models.map((m) => `${m.name} (${m.types.join(', ')})`).join(' and ')}.${unreadable.length ? ` ${unreadable.length} big matrices of a type the page cannot read.` : ''}${reference ? ` Stopped: ${reference}` : ''}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`Weights reader check: ${fmt(same)} of ${fmt(weights)} weights identical in ${good} of ${rows.length} matrices · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(reference ? 1 : 0);

// ---------- the results page: tabs that fit the window ----------
function page(s, rows) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = new Date(s.finished).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const byType = {}; for (const r of rows) { const k = `${r.model}:${r.type}`; const e = byType[k] ||= { model: r.model, type: r.type, matrices: 0, of: r.of, weights: 0, same: 0 }; e.matrices++; e.weights += r.weights; e.same += r.same; }
  const nameOf = (id) => s.models.find((m) => m.id === id)?.name ?? id;
  const verdict = s.stopped ? `Stopped: ${esc(s.why || 'before every matrix was compared')}` : s.pass ? `Identical: ${fmt(s.same)} of ${fmt(s.weights)} weights, in all ${s.matrices} matrices` : `Not identical: ${fmt(s.weights - s.same)} of ${fmt(s.weights)} weights differ${s.unreadable.length ? `, and ${s.unreadable.length} matrices cannot be read` : ''}`;
  const tile = (label, value, dir) => `<div class="tile"><span class="k">${label}</span><b>${value}</b><small>${dir}</small></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Weights reader check</title><style>
:root { --page: #f9f9f7; --surface: #fcfcfb; --line: #e3e2dc; --ink: #0b0b0b; --ink2: #52514e; --ink3: #8a887f; --ok: #1c8558; --bad: #b3261e; --mono: ui-monospace, "SF Mono", Menlo, monospace; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #0d0d0d; --surface: #1a1a19; --line: #34342f; --ink: #fff; --ink2: #c3c2b7; --ink3: #8f8e86; --ok: #4fc38d; --bad: #ff8b82; color-scheme: dark; } }
:root[data-theme="dark"] { --page: #0d0d0d; --surface: #1a1a19; --line: #34342f; --ink: #fff; --ink2: #c3c2b7; --ink3: #8f8e86; --ok: #4fc38d; --bad: #ff8b82; color-scheme: dark; }
* { box-sizing: border-box; } body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 14px 24px; } h1 { font-size: 21px; margin: 0; } .dateline { color: var(--ink3); font-size: 13px; }
nav { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 12px; } nav button { font: inherit; padding: 6px 13px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; } nav button[aria-selected="true"] { background: var(--ink); color: var(--page); border-color: var(--ink); }
[hidden] { display: none !important; } .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.verdict { font-size: 17px; font-weight: 650; margin: 0 0 10px; } .verdict.ok { color: var(--ok); } .verdict.bad { color: var(--bad); }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; } .tile { display: flex; flex-direction: column; gap: 2px; } .tile b { font-size: 22px; } .tile .k { color: var(--ink2); font-size: 13px; } .tile small { color: var(--ink3); font-size: 11.5px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; } th, td { text-align: left; padding: 5px 10px; border-top: 1px solid var(--line); } thead th { border-top: none; color: var(--ink3); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; } td.num, th.num { text-align: right; } td.ok { color: var(--ok); } td.bad { color: var(--bad); font-weight: 600; } code { font-family: var(--mono); font-size: 12px; }
.scroll { max-height: calc(100vh - 170px); overflow: auto; } p { color: var(--ink2); max-width: 900px; } ol { color: var(--ink2); max-width: 900px; }
@media (max-width: 800px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } main { padding: 12px 16px; } .scroll { max-height: none; } }
</style></head><body><main>
<h1>Weights reader check</h1><div class="dateline">${esc(when)} · code ${esc(s.code)} · ${s.models.map((m) => esc(m.name)).join(' and ')}</div>
<nav role="tablist"><button role="tab" data-v="result" aria-selected="true">1 · The result</button><button role="tab" data-v="all" aria-selected="false">2 · Every matrix</button><button role="tab" data-v="how" aria-selected="false">3 · How it is checked</button></nav>
<section data-v="result"><p class="verdict ${s.pass ? 'ok' : 'bad'}">${verdict}</p>
<div class="tiles card">${tile('Weights compared', fmt(s.weights), 'more = a wider check')}${tile('Identical to llama.cpp', fmt(s.same), `of ${fmt(s.weights)} · all = pass`)}${tile('Matrices', `${s.good} of ${s.matrices}`, 'every weight identical · all = pass')}${tile('Matrices it cannot read', fmt(s.unreadable.length), '0 = pass')}</div>
<div class="card"><table><thead><tr><th>Model</th><th>Kept as</th><th class="num">Matrices compared</th><th class="num">Of that type in the file</th><th class="num">Weights identical</th></tr></thead><tbody>${Object.values(byType).map((e) => `<tr><td>${esc(nameOf(e.model))}</td><td><code>${e.type}</code></td><td class="num">${e.matrices}</td><td class="num">${e.of}</td><td class="num ${e.same === e.weights ? 'ok' : 'bad'}">${fmt(e.same)} of ${fmt(e.weights)}</td></tr>`).join('')}</tbody></table></div></section>
<section data-v="all" hidden><div class="card scroll"><table><thead><tr><th>Model</th><th>Matrix</th><th>Kept as</th><th>Rows</th><th class="num">Identical</th><th>First difference</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(nameOf(r.model))}</td><td><code>${esc(r.tensor)}</code></td><td><code>${r.type}</code></td><td>${r.rows.join(', ')}</td><td class="num ${r.same === r.weights ? 'ok' : 'bad'}">${fmt(r.same)} of ${fmt(r.weights)}</td><td>${r.first ? `row ${r.first.row}, column ${r.first.col}: ${r.first.got} here, ${r.first.want} in llama.cpp` : '—'}</td></tr>`).join('')}${s.unreadable.map((u) => `<tr><td>${esc(nameOf(u.model))}</td><td><code>${esc(u.tensor)}</code></td><td><code>${esc(u.type)}</code></td><td>—</td><td class="num bad">cannot read</td><td>the page has no reader for this type</td></tr>`).join('')}</tbody></table></div></section>
<section data-v="how" hidden><div class="card"><ol>
<li>The reader is the Weights tab’s own: the <code>&lt;script id="core"&gt;</code> in <code>terminal/src/app/weights.html</code>, the code that draws every picture on the tab.</li>
<li>The answer it is checked against is llama.cpp’s own reader, its Python <code>gguf</code> package (<code>gguf.quants.dequantize</code>), run through <code>uv</code>, which fetches it the first time.</li>
<li>For each model file on this Mac: every storage type it keeps a big matrix in; up to three matrices of each type (the first, one in the middle, the last); five rows of each (the first three, the middle one, the last). Every weight of those rows is compared.</li>
<li>Pass: every weight is identical, to the last bit, and no big matrix in any file is of a type the page cannot read.</li>
<li>The raw results are on this Mac in <code>models/evals/results/reader-check-${stamp}/</code>.</li></ol></div></section>
</main><script>(function () { const tabs = [...document.querySelectorAll('[role="tab"]')], views = [...document.querySelectorAll('section[data-v]')]; const show = (v) => { if (!tabs.some((t) => t.dataset.v === v)) v = tabs[0].dataset.v; tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === v))); views.forEach((x) => { x.hidden = x.dataset.v !== v; }); try { history.replaceState(null, '', '#' + v); } catch {} }; tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.v))); document.addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; const at = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'); const to = /^[1-3]$/.test(e.key) ? Number(e.key) - 1 : e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : -1; if (to >= 0 && to < tabs.length) show(tabs[to].dataset.v); }); if (location.hash.length > 1) show(location.hash.slice(1)); window.addEventListener('hashchange', () => show(location.hash.slice(1))); })();</script></body></html>`;
}
