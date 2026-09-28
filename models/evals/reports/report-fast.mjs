// The "faster" round of 25 Sep 2026 as a stats page: our engine build + the
// DFlash2 guessing helper against Prism's release + n-gram guessing. Same code,
// same 28 practice tasks, one run each side; plus the engine probes.
//   node models/evals/reports/report-fast.mjs [--dir <results dir>]
// Reads models/bonsai-2-27b/results/runs/2026-09-25-fast/ (not in git) and
// writes the page into the DOCS folder.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../docs/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const dir = opt('dir', join(root, 'models/bonsai-2-27b/results/runs/2026-09-25-fast'));
for (const f of ['before/summary.json', 'after/summary.json', 'probes.json']) {
  if (!existsSync(join(dir, f))) { console.error(`${f} not found in ${dir} (results are kept on the Mac, not in git)`); process.exit(1); }
}
const load = (p) => JSON.parse(readFileSync(join(dir, p), 'utf8'));
const probes = load('probes.json');
// Reading and writing across each whole run, from the server's own log (log-speeds.json).
const [logB, logA] = existsSync(join(dir, 'log-speeds.json')) ? load('log-speeds.json') : [null, null];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- the numbers ---------- */
const side = (name) => Object.fromEntries(load(`${name}/summary.json`).results.map((r) => [r.task, r]));
const B = side('before');
const A = side('after');
const num = (t) => Number(t.split('-')[0]);
const tasks = [...new Set([...Object.keys(B), ...Object.keys(A)])].sort((a, b) => num(a) - num(b));
const taskText = (t) => { const p = join(root, 'models/evals/bench/tasks', t, 'task.txt'); return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''; };
const rows = tasks.map((t) => ({ task: t, n: num(t), prompt: taskText(t), route: A[t]?.route ?? B[t]?.route, before: B[t] ?? null, after: A[t] ?? null }));
const both = rows.filter((r) => r.before && r.after);
const sum = (list, k) => list.reduce((s, r) => s + (r[k]?.secs ?? 0), 0);
const passes = (list, k) => list.filter((r) => r[k]?.pass).length;
const byRoute = (k, route) => { const xs = both.filter((r) => r.route === route).map((r) => r[k].secs); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null; };
const pct = (b, a) => (b ? `${a - b > 0 ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '');
const req = Object.fromEntries(probes.requests.rows.map((r) => [r.setup, r]));
const kinds = [['code', 'Code', 'a JavaScript module and its tests, 700 tokens'], ['rewrite', 'A rewrite', 'one function changed, 83 tokens'], ['prose', 'Prose', 'about 200 words of explanation']];
const fp = (name) => {
  const p = join(dir, name, 'footprint.txt');
  if (!existsSync(p)) return null;
  const gb = readFileSync(p, 'utf8').split('\n').map((l) => /([\d.]+) ([KMG])B/.exec(l)).filter(Boolean).map((m) => Number(m[1]) * { K: 1e-6, M: 1e-3, G: 1 }[m[2]]);
  return gb.length ? Math.max(...gb) : null;
};
const fpB = fp('before'), fpA = fp('after');
const budgets = [15, 30, 60, 120, 240, 480];
const curve = (k, name) => ({ name, n: both.length, pts: budgets.map((b) => { const done = both.filter((r) => r[k].pass && r[k].secs <= b).length; return { b, done, pct: Math.round((done / both.length) * 100) }; }) });

const DATA = {
  budgets,
  curves: [['before', curve('before', 'Before · Prism release + n-gram')], ['after', curve('after', 'After · our engine + helper')]],
  tasks: rows.map((r) => ({ task: r.task, n: r.n, route: r.route, b: r.before?.secs, a: r.after?.secs, bp: r.before?.pass, ap: r.after?.pass })),
  requests: probes.requests.rows,
  batch: probes.batchCost.rows,
};

/* ---------- the launch table ---------- */
const best = (vals, lower) => { const xs = vals.filter((v) => v != null); return xs.length ? (lower ? Math.min(...xs) : Math.max(...xs)) : null; };
const cell = (v, bestV, fmt = (x) => x, q = '') => (v == null ? '<td class="na">—</td>' : `<td class="${v === bestV ? 'best' : ''}">${fmt(v)}${q ? `<span class="q">${q}</span>` : ''}</td>`);
const delta = (b, a, lowerIsBetter, unit = '') => {
  if (b == null || a == null) return '<td class="sep na">—</td>';
  const d = Math.round((a - b) * 100) / 100;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return `<td class="sep delta ${d === 0 ? '' : good ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}${unit}${unit === ' pts' ? '' : `<span class="q">${pct(b, a)}</span>`}</td>`;
};
const COLS = ['Before<span class="q">Prism release, n-gram guessing</span>', 'After<span class="q">our engine, helper, 1 guess</span>', 'Helper, 3 guesses<span class="q">tried, not used</span>', 'Helper, 7 guesses<span class="q">tried, not used</span>'];
const launch = [];
for (const [k, label, what] of kinds) {
  const vals = [req.ngram[k], req['dflash-n1'][k], req['dflash-n3'][k], req['dflash-n7'][k]];
  const bv = best(vals, false);
  launch.push(`<tr><td class="bench"><b>Writing: ${label}</b><span>tokens per second · ${what}<sup>1</sup></span></td>${vals.map((v) => cell(v, bv)).join('')}${delta(vals[0], vals[1], false)}</tr>`);
}
{
  const vals = [passes(both, 'before'), passes(both, 'after')];
  const bv = best(vals, false);
  launch.push(`<tr><td class="bench"><b>Practice tasks passed</b><span>28 tasks, thinking off, one run each<sup>2</sup></span></td>${vals.map((v) => cell(v, bv, (x) => `${x} of ${both.length}`)).join('')}<td class="na">—</td><td class="na">—</td>${delta(vals[0], vals[1], false)}</tr>`);
}
{
  const vals = [sum(both, 'before'), sum(both, 'after')];
  const bv = best(vals, true);
  launch.push(`<tr><td class="bench"><b>Practice tasks, all the time</b><span>seconds for all 28, start to finished check</span></td>${vals.map((v) => cell(v, bv, (x) => `${x.toLocaleString()} s`)).join('')}<td class="na">—</td><td class="na">—</td>${delta(vals[0], vals[1], true, ' s')}</tr>`);
}
for (const [route, label] of [['change', 'A change, test first'], ['fix', 'A fix'], ['question', 'A question about the code']]) {
  const vals = [byRoute('before', route), byRoute('after', route)];
  if (vals[0] == null && vals[1] == null) continue;
  const bv = best(vals, true);
  launch.push(`<tr><td class="bench"><b>${label}</b><span>average seconds on the ${route} path</span></td>${vals.map((v) => cell(v, bv, (x) => `${x} s`)).join('')}<td class="na">—</td><td class="na">—</td>${delta(vals[0], vals[1], true, ' s')}</tr>`);
}
{
  // the multi-file tasks (several files planned from the project map)
  const multi = both.filter((r) => [19, 20].includes(r.n));
  if (multi.length) {
    const vals = [sum(multi, 'before'), sum(multi, 'after')];
    const bv = best(vals, true);
    launch.push(`<tr><td class="bench"><b>Several files at once</b><span>seconds for tasks 19 and 20 together</span></td>${vals.map((v) => cell(v, bv, (x) => `${x} s`)).join('')}<td class="na">—</td><td class="na">—</td>${delta(vals[0], vals[1], true, ' s')}</tr>`);
  }
}
if (logB && logA) {
  const rowsL = [
    ['Writing speed across the run', 'tokens per second, all 28 tasks, from the server log<sup>3</sup>', logB.writeTps, logA.writeTps, false, ''],
    ['Time spent writing', 'seconds the model spent writing, all 28 tasks', logB.writeSecs, logA.writeSecs, true, ' s'],
    ['Reading speed across the run', 'tokens per second; the helper needs a smaller micro-batch (128)', logB.readTps, logA.readTps, false, ''],
  ];
  for (const [label, what, b, a, lower, unit] of rowsL) {
    const bv = best([b, a], lower);
    launch.push(`<tr><td class="bench"><b>${label}</b><span>${what}</span></td>${cell(b, bv, (x) => `${x.toLocaleString()}${unit}`)}${cell(a, bv, (x) => `${x.toLocaleString()}${unit}`)}<td class="na">—</td><td class="na">—</td>${delta(b, a, lower, unit)}</tr>`);
  }
  const keptB = Math.round((logB.accepted / logB.drafted) * 100), keptA = Math.round((logA.accepted / logA.drafted) * 100);
  launch.push(`<tr><td class="bench"><b>Guesses kept</b><span>share of guessed tokens the 27B agreed with, whole run</span></td>${cell(keptB, keptA > keptB ? null : keptB, (x) => `${x}%`, `${logB.accepted.toLocaleString()} of ${logB.drafted.toLocaleString()}`)}${cell(keptA, keptA > keptB ? keptA : null, (x) => `${x}%`, `${logA.accepted.toLocaleString()} of ${logA.drafted.toLocaleString()}`)}<td class="na">—</td><td class="na">—</td>${delta(keptB, keptA, false, ' pts')}</tr>`);
}
for (const w of [2, 4, 8]) {
  const r = probes.batchCost.rows.find((x) => x.words === w);
  const vals = [r.before, r.after];
  const bv = best(vals, true);
  launch.push(`<tr><td class="bench"><b>Checking ${w} words at once</b><span>time compared with writing 1 word, whole model<sup>4</sup></span></td>${vals.map((v) => cell(v, bv, (x) => `${x}×`)).join('')}<td class="na">—</td><td class="na">—</td>${delta(vals[0], vals[1], true, '×')}</tr>`);
}
{
  const vals = [probes.memory.needBytes32kGB.before, probes.memory.needBytes32kGB.after];
  launch.push(`<tr><td class="bench"><b>Memory for 32k context</b><span>what Bonsai needs free to start at 32k (else 16k)<sup>5</sup></span></td>${cell(vals[0], vals[0], (x) => `${x} GB`)}${cell(vals[1], null, (x) => `${x} GB`)}<td class="na">—</td><td class="na">—</td>${delta(vals[0], vals[1], true, ' GB')}</tr>`);
}
if (fpB != null && fpA != null) {
  const vals = [Math.round(fpB * 100) / 100, Math.round(fpA * 100) / 100];
  launch.push(`<tr><td class="bench"><b>Server memory during the run</b><span>largest footprint seen, sampled every 20 s (files mapped on top)</span></td>${cell(vals[0], vals[0], (x) => `${x} GB`)}${cell(vals[1], null, (x) => `${x} GB`)}<td class="na">—</td><td class="na">—</td>${delta(vals[0], vals[1], true, ' GB')}</tr>`);
}

/* ---------- the page ---------- */
const css = `
:root{--bg:#f7f6f2;--card:#ffffff;--ink:#1c1b18;--mute:#6b675e;--faint:#a19c90;--line:#e3dfd5;--soft:#efece4;--best:#f3d9cc;--bestInk:#8a3a1c;--up:#1d7a46;--down:#b3261e;--c-before:#2a78d6;--c-after:#eb6834}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80;--c-before:#3987e5;--c-after:#e0692f}}
:root[data-theme="dark"]{--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80;--c-before:#3987e5;--c-after:#e0692f}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1120px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}h2{font-size:21px;letter-spacing:-.01em;margin:44px 0 6px}h3{font-size:16px;margin:0 0 2px}p{margin:0 0 10px}a{color:inherit;text-underline-offset:3px}
.lede{color:var(--mute);max-width:780px}.sub{color:var(--mute);font-size:14px;margin-bottom:14px;max-width:820px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 6px}nav a{font-size:13px;text-decoration:none;padding:5px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--mute)}nav a:hover{color:var(--ink);border-color:var(--faint)}
.hero{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;display:grid;grid-template-columns:auto 1fr;gap:6px 28px;align-items:center;margin-top:22px}.hero .g{font-size:64px;line-height:1;font-weight:800;letter-spacing:-.04em;grid-row:span 2}.hero .v{font-size:16px;max-width:820px}.hero .w{color:var(--mute);font-size:13.5px;max-width:820px;margin:0}
@media (max-width:640px){.hero{grid-template-columns:1fr}.hero .g{grid-row:auto}}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.card .name{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px}.dot{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block}
.card dl{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:12px 0 0;font-size:14px}.card dt{color:var(--mute)}.card dd{margin:0;font-variant-numeric:tabular-nums}
.card p{font-size:14px;color:var(--mute);margin:8px 0 0}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}tr:last-child td{border-bottom:none}
thead th{font-size:13px;color:var(--mute);font-weight:600;background:var(--soft)}thead th .q{font-weight:400}
td.bench{white-space:normal;min-width:220px}td.bench b{display:block;font-weight:600}td.bench span{color:var(--mute);font-size:13px}
td .q,th .q{display:block;color:var(--mute);font-size:12px;white-space:normal;max-width:420px}
td.best{background:var(--best);color:var(--bestInk);font-weight:700}td.na{color:var(--faint)}
td.delta{font-weight:600}td.delta.up{color:var(--up)}td.delta.down{color:var(--down)}th.sep,td.sep{border-left:1px solid var(--line)}
td.ok{color:var(--up);font-weight:600}td.bad{color:var(--down);font-weight:600}
.notes{margin:12px 2px 0;color:var(--mute);font-size:13px;max-width:900px}.notes p{margin:0 0 7px}.notes sup{font-weight:700;color:var(--ink)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:16px;margin-top:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 16px 12px;min-width:0}figcaption{color:var(--mute);font-size:13px;margin-top:8px}
.from{font-size:12px;color:var(--faint);margin-bottom:6px}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--mute);margin:8px 0 4px}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:14px;height:10px;border-radius:3px;display:inline-block}.legend i.line{width:16px;height:0;border-top:2.5px solid;border-radius:0}
svg{display:block;width:100%;max-width:620px;height:auto;overflow:visible;margin:0 auto}svg text{fill:var(--mute);font-size:11px;font-family:inherit}svg .grid{stroke:var(--line);stroke-width:1}svg .axis{stroke:var(--faint);stroke-width:1}svg .lbl{fill:var(--ink)}
svg rect.bar{rx:2}.pts table{font-size:12.5px;margin-top:10px}.pts th,.pts td{padding:5px 7px}details.pts summary{cursor:pointer;color:var(--mute);font-size:12.5px;margin-top:8px}.pts td .c{display:block;color:var(--mute);font-weight:400;font-size:11.5px}.pts td:first-child{white-space:nowrap;font-weight:600}
.foot{margin-top:40px;color:var(--mute);font-size:13px}.foot li{margin:3px 0}code{font:12.5px ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:4px}
@media (max-width:600px){h1{font-size:25px}th,td{padding:8px 10px}}
`;

const totB = sum(both, 'before'), totA = sum(both, 'after');
const codeGain = pct(req.ngram.code, req['dflash-n1'].code);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bonsai faster: before and after</title><style>${css}</style></head><body><main>
<h1>Bonsai Code, faster: before and after</h1>
<p class="lede">25 Sep 2026. Bonsai 2 27B on the M4 (16 GB), thinking off. Before: Prism's release of llama.cpp with n-gram guessing, as Bonsai ran it this morning. After: Prism's newest source with one routine of ours added, and a 1.1 GB helper model that guesses the next word for the 27B to check. The same Bonsai code on both sides. In each row the better cell is highlighted.</p>
<nav><a href="#verdict">In one line</a><a href="#launch">Launch table</a><a href="#curves">Tasks within a time budget</a><a href="#tasks">Every task</a><a href="#guesses">How many guesses</a><a href="#engine">The engine change</a><a href="#notes">Notes</a><a href="#sources">Sources</a></nav>

<section id="verdict"><div class="hero"><div class="g">${pct(totB, totA)}</div>
<div class="v">The 28 practice tasks took ${totA.toLocaleString()} s instead of ${totB.toLocaleString()} s, with ${passes(both, 'after')} of ${both.length} passing (${passes(both, 'before')} before). Writing code went from ${req.ngram.code} to ${req['dflash-n1'].code} tokens a second (${codeGain}).</div>
<div class="w">The helper guesses the next word from the 27B's own hidden states; the 27B checks the guess in the same pass as its own next word and keeps it when it agrees, so the output is still the 27B's. It pays only because checking two words now costs 1.16× one word instead of 2.48×. It costs memory: 32k context now needs ${probes.memory.needBytes32kGB.after} GB free instead of ${probes.memory.needBytes32kGB.before} GB.</div></div>
<div class="cards">
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-before)"></span>Before</div><dl>
    <dt>Engine</dt><dd>Prism release prism-b10735</dd><dt>Guessing</dt><dd>n-grams from the prompt</dd>
    <dt>Practice tasks</dt><dd>${passes(both, 'before')} of ${both.length} pass · ${totB.toLocaleString()} s</dd>
    <dt>Writing code</dt><dd>${req.ngram.code} tokens/s</dd></dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-after)"></span>After</div><dl>
    <dt>Engine</dt><dd>Prism source adfffbe + our PQ2_0 routine</dd><dt>Guessing</dt><dd>DFlash2 helper, 1 word per check</dd>
    <dt>Practice tasks</dt><dd>${passes(both, 'after')} of ${both.length} pass · ${totA.toLocaleString()} s <span style="color:var(--up)">(${pct(totB, totA)})</span></dd>
    <dt>Writing code</dt><dd>${req['dflash-n1'].code} tokens/s <span style="color:var(--up)">(${codeGain})</span></dd></dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--faint)"></span>What it costs</div>
    <p>More memory while Bonsai runs: the helper file (1.14 GB) and ${fpA != null && fpB != null ? `${(Math.round((fpA - fpB) * 10) / 10)} GB` : 'about 0.5 GB'} more working space in this run (its working space, and one spare copy of the running state per slot to take a wrong guess back). The rule that picks the context counts 2.2 GB to be safe, so 32k now needs ${probes.memory.needBytes32kGB.after} GB free; below that Bonsai starts at 16k, as it already did when memory was short.</p>
    <p><code>bonsai setup</code> now builds the engine (about 3 minutes, needs cmake and Apple's command line tools) and downloads the helper (1.14 GB). <code>BONSAI_HELPER=off</code> runs without it.</p></div>
</div></section>

<section id="launch"><h2>Launch table</h2>
<p class="sub">Every measure, before and after, with the two helper settings that were tried and not used. The last column is after minus before.</p>
<div class="wrap"><table><thead><tr><th></th>${COLS.map((c) => `<th>${c}</th>`).join('')}<th class="sep">After vs before</th></tr></thead><tbody>${launch.join('')}</tbody></table></div>
<div class="notes">
<p><sup>1</sup> ${esc(probes.requests.note)} Before is the n-gram row; plain decoding without any guessing measured ${req.plain.code}, ${req.plain.rewrite} and ${req.plain.prose}.</p>
<p><sup>2</sup> <code>models/evals/bench/run.mjs --think off</code>, the before side from a frozen copy of main at 2d6c7c7 and the after side from a frozen copy of the branch, one after the other on the same afternoon. Bonsai's questions get the scripted answers in each task's answers.json.</p>
<p><sup>3</sup> Summed from llama-server's own timing lines (<code>~/.bonsai-code/logs/server.log</code>) for each run: every request's reading and writing, side requests included. The tasks themselves also run tests and tools, which the helper does not speed up; that is why a 30% faster writer gives a ${pct(totB, totA).replace('-', '')} shorter run.</p>
<p><sup>4</sup> ${esc(probes.batchCost.note)}. Guessing pays only when checking a guess costs little more than writing a word.</p>
<p><sup>5</sup> The estimate Bonsai uses to pick 32k or 16k, checked against the measured footprint with two slots at 32k (${probes.memory.footprintGB.before} → ${probes.memory.footprintGB.after} GB, plus the mapped files).</p>
</div></section>

<section id="curves"><h2>Tasks done within a time budget</h2>
<p class="sub">The share of the 28 practice tasks finished and passing within each time budget, before and after. A line further up and to the left is better.</p>
<div class="charts" id="chart-curves"></div></section>

<section id="tasks"><h2>Every practice task</h2>
<p class="sub">Seconds per task, one run each side. Rename tasks never call the model, so they take 0 s either way.</p>
<div class="charts" id="chart-tasks"></div>
<div class="wrap" style="margin-top:14px"><table><thead><tr><th>Task</th><th>Path</th><th>Before</th><th>After</th><th>Before</th><th>After</th><th class="sep">Change</th></tr></thead><tbody>
${rows.map((r) => `<tr><td class="bench"><b>${esc(r.task)}</b><span>${esc(r.prompt.length > 110 ? `${r.prompt.slice(0, 107)}…` : r.prompt)}</span>${r.after && !r.after.pass && r.after.why ? `<span class="q" style="color:var(--down)">${esc(r.after.why)}</span>` : ''}</td><td>${esc(r.route)}</td>${[r.before, r.after].map((s) => (s ? `<td class="${s.pass ? 'ok' : 'bad'}">${s.pass ? 'pass' : 'fail'}</td>` : '<td class="na">—</td>')).join('')}${cell(r.before?.secs, best([r.before?.secs, r.after?.secs], true), (x) => `${x} s`)}${cell(r.after?.secs, best([r.before?.secs, r.after?.secs], true), (x) => `${x} s`)}${delta(r.before?.secs, r.after?.secs, true, ' s')}</tr>`).join('')}
<tr><td class="bench"><b>All ${both.length}</b></td><td></td><td class="ok">${passes(both, 'before')} pass</td><td class="ok">${passes(both, 'after')} pass</td>${cell(totB, Math.min(totB, totA), (x) => `${x.toLocaleString()} s`)}${cell(totA, Math.min(totB, totA), (x) => `${x.toLocaleString()} s`)}${delta(totB, totA, true, ' s')}</tr>
</tbody></table></div></section>

<section id="guesses"><h2>How many guesses per check</h2>
<p class="sub">The helper can guess several words ahead. More guesses help when they are right, as in code, and cost a longer check when they are wrong, as in prose. One guess was the only setting faster than before on all three kinds of writing, and it needs the least memory.</p>
<div class="charts" id="chart-guesses"></div>
<div class="wrap" style="margin-top:14px"><table><thead><tr><th>Setup</th>${kinds.map(([, l]) => `<th>${l}</th>`).join('')}<th>Guesses kept</th></tr></thead><tbody>
${probes.requests.rows.map((r) => `<tr><td class="bench"><b>${esc(r.label)}</b></td>${kinds.map(([k]) => cell(r[k], best(probes.requests.rows.map((x) => x[k]), false), (x) => `${x} tok/s`)).join('')}<td>${r.accepted ? kinds.map(([k]) => (r.accepted[k][1] ? `${Math.round((r.accepted[k][0] / r.accepted[k][1]) * 100)}%` : '—')).join(' · ') : '—'}</td></tr>`).join('')}
<tr><td class="bench"><b>Helper, 7 guesses, before our routine</b><span>Prism's small-batch path</span></td>${kinds.map(([k]) => `<td>${probes.requests.stockN7[k]} tok/s</td>`).join('')}<td>${kinds.map(([k]) => `${Math.round((probes.requests.stockN7.accepted[k][0] / probes.requests.stockN7.accepted[k][1]) * 100)}%`).join(' · ')}</td></tr>
</tbody></table></div>
<div class="notes"><p>Guesses kept is code · rewrite · prose. The helper is right about the next word 96% of the time on code and 64% on prose; the second and later guesses are right less often.</p></div></section>

<section id="engine"><h2>The engine change</h2>
<p class="sub">${esc(probes.kernel.note)}. Before: Prism's general small-batch routine for this format. After: <code>kernel_mul_mv_pq2_0_multicol</code>, which decodes each weight byte once and uses it for two words. ${esc(probes.kernel.checks)}.</p>
<div class="charts" id="chart-engine"></div>
<div class="notes"><p>The M4's GPU runs out of arithmetic before memory speed once more than one word is in flight, even for the engine's tuned 4-bit routine (Q4_0: ${probes.kernel.q4_0['1']}, ${probes.kernel.q4_0['4']} and ${probes.kernel.q4_0['8']} µs for 1, 4 and 8 words). Prism's routine measured ${probes.kernel.before.range4[0]}–${probes.kernel.before.range4[1]} µs for 4 words and ${probes.kernel.before.range8[0]}–${probes.kernel.before.range8[1]} µs for 8 across runs. Registers set the limit: 16 weights per thread or 4 words per pass ran out of them and got slower. ${esc(probes.memory.gpuOOM)}.</p></div></section>

<section id="notes"><h2>Notes</h2><div class="notes">
<p>Task 1 is the one clear loss (91 → 146 s): it was the first task on the new engine, so Bonsai read its instructions once instead of restoring them (saved warm-ups are keyed by engine build), and its two drafts disagreed, which adds a round of tests and drafts. Task 21 took one wider fix either way and was 47 s slower on the same steps.</p>
<p>One run per side on the same Mac, one after the other; a second session was working in the repo at the same time, so both sides shared that load. Single-run task times vary by several seconds; the totals and the writing-speed probes are the steadier numbers.</p>
<p>The helper is DFlash2 (a block-diffusion drafter by z-lab / Inco AI), re-fitted by naklitechie to this ternary model's own hidden states, Apache 2.0. Prism merged DFlash2 support into their engine's source on 25 Sep, after the release Bonsai used.</p>
<p>With a guess the check runs two words through the model at once, so the result can differ from one-at-a-time writing where the model's top two choices were within rounding; Prism reports the same for their batched check.</p>
<p>The saved warm-up still restores with the helper on, and the helper kept guessing well afterwards (${esc(probes.memory.warmRestore.split('; ')[1])}). Saved warm-ups are now keyed by engine build, so the first start after the switch reads the instructions once (about 26 s).</p>
</div></section>

<section class="foot" id="sources"><h3 style="color:var(--ink)">Where the numbers come from</h3><ul>
<li><code>models/bonsai-2-27b/results/runs/2026-09-25-fast/</code> — <code>before/</code> and <code>after/</code> (summary.json, per-task traces, footprint.txt), <code>log-speeds.json</code>, <code>probes.json</code>, <code>raw/</code> (kept on the Mac, not in git)</li>
<li>Engine: <code>models/runtime/engine/</code> (build-engine.sh, pq2-multicol.patch, README) · this page: <code>node models/evals/reports/report-fast.mjs</code></li></ul>
<p>Nothing on this page loads from the internet. Point at a bar or dot to see its exact numbers.</p></section>
</main>
<script>
const DATA = ${JSON.stringify(DATA)};
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function niceStep(span, n) { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function figure(host, from, title, svg, cap, legend) {
  const f = el('figure');
  if (from) f.appendChild(el('div', 'from', from));
  f.appendChild(el('h3', '', title));
  if (legend) { const lg = el('div', 'legend'); legend.forEach(([name, col, line]) => lg.appendChild(el('span', '', '<i class="' + (line ? 'line' : '') + '" style="' + (line ? 'border-color' : 'background') + ':var(' + col + ')"></i>' + esc(name)))); f.appendChild(lg); }
  f.insertAdjacentHTML('beforeend', svg);
  if (cap) f.appendChild(el('figcaption', '', cap));
  document.getElementById(host).appendChild(f);
  return f;
}
// Horizontal bars, one row per item, one or two series; hover title on each bar.
function bars(host, { from, title, rows, series, unit = ' s', cap, xLabel, max }) {
  const W = 560, L = 150, R = 20, T = 8, rowH = series.length > 1 ? 30 : 22, H = T + rows.length * rowH + 34;
  max = max ?? Math.max(...rows.flatMap((r) => series.map((s) => r[s.key] ?? 0)));
  const step = niceStep(max, 4), x1 = Math.ceil(max / step) * step;
  const X = (v) => L + (v / x1) * (W - L - R);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
  for (let v = 0; v <= x1 + 1e-9; v += step) s += '<line class="grid" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + T + '" y2="' + (H - 30) + '"/><text x="' + X(v) + '" y="' + (H - 16) + '" text-anchor="middle">' + Math.round(v * 100) / 100 + '</text>';
  s += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 3) + '" text-anchor="middle">' + esc(xLabel) + '</text>';
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    s += '<text class="lbl" x="' + (L - 8) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end">' + esc(r.label) + (r.mark ? ' <tspan style="fill:var(--down)">' + esc(r.mark) + '</tspan>' : '') + '</text>';
    series.forEach((sr, k) => {
      const v = r[sr.key];
      if (v == null) return;
      const bh = series.length > 1 ? 10 : 12, by = y + (rowH - (bh * series.length + 2 * (series.length - 1))) / 2 + k * (bh + 2);
      s += '<rect class="bar" x="' + L + '" y="' + by + '" width="' + Math.max(1, X(v) - L) + '" height="' + bh + '" fill="var(' + sr.color + ')"><title>' + esc(r.label) + ' · ' + esc(sr.name) + ': ' + v + unit + '</title></rect>';
    });
  });
  s += '</svg>';
  figure(host, from, title, s, cap, series.length > 1 ? series.map((sr) => [sr.name, sr.color, false]) : null);
}
const S2 = [{ key: 'b', name: 'Before', color: '--c-before' }, { key: 'a', name: 'After', color: '--c-after' }];
const short = (t) => t.replace(/^\\d+-/, '');
const half = (list) => [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))];
const tmax = Math.max(...DATA.tasks.flatMap((t) => [t.b ?? 0, t.a ?? 0]));
half(DATA.tasks).forEach((part, i) => bars('chart-tasks', { from: 'models/evals/bench/run.mjs, thinking off', title: 'Seconds per practice task' + (i ? ', continued' : ''), xLabel: 'seconds', series: S2, max: tmax,
  cap: i ? '✗ marks a task that failed its check after the change.' : 'Shorter is better. One run each side.', rows: part.map((t) => ({ label: short(t.task), b: t.b, a: t.a, mark: t.ap === false ? '✗' : '' })) }));
bars('chart-guesses', { from: 'three requests, temperature 0.7', title: 'Writing speed by setup: code', xLabel: 'tokens per second', unit: ' tok/s', series: [{ key: 'a', name: 'tok/s', color: '--c-after' }], rows: DATA.requests.map((r) => ({ label: r.setup, a: r.code })), cap: 'A 700-token JavaScript module with tests. The helper at 1 and 3 guesses is fastest.' });
bars('chart-guesses', { from: 'three requests, temperature 0.7', title: 'Writing speed by setup: prose', xLabel: 'tokens per second', unit: ' tok/s', series: [{ key: 'a', name: 'tok/s', color: '--c-after' }], rows: DATA.requests.map((r) => ({ label: r.setup, a: r.prose })), cap: 'About 200 words. Wrong guesses cost a longer check: 7 guesses halve the speed, 1 guess still gains.' });
bars('chart-engine', { from: 'llama-bench, whole model', title: 'Time to check N words, compared with 1', xLabel: 'times the cost of one word', unit: '×', series: S2, rows: DATA.batch.filter((r) => r.words > 1).map((r) => ({ label: r.words + ' words', b: r.before, a: r.after })), cap: 'Lower is better. Two words now cost 1.16× one word, so a single guess is nearly free to check.' });

// Score against cost: x = seconds (log), y = share of tasks done within that budget.
const budgetLabel = (b) => (b < 60 ? b + 's' : (b / 60) + 'm');
(function curves() {
  const W = 560, H = 300, L = 46, R = 14, T = 12, B = 40;
  const x0 = DATA.budgets[0] / 1.3, x1 = DATA.budgets[DATA.budgets.length - 1] * 1.3;
  const X = (v) => L + (Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0)) * (W - L - R);
  const Y = (v) => T + (1 - v / 100) * (H - T - B);
  const cols = { before: '--c-before', after: '--c-after' };
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Practice tasks done within a time budget">';
  for (let v = 0; v <= 100; v += 20) s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 7) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end">' + v + '</text>';
  DATA.budgets.forEach((v) => { s += '<line class="grid" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + T + '" y2="' + (H - B) + '" stroke-dasharray="2 3"/><text x="' + X(v) + '" y="' + (H - B + 15) + '" text-anchor="middle">' + budgetLabel(v) + '</text>'; });
  s += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
  s += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Time budget per task (seconds, log scale)</text><text transform="translate(11 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">Tasks done within the budget (%)</text>';
  DATA.curves.forEach(([k, c]) => {
    const lead = k === 'after';
    s += '<polyline fill="none" stroke="var(' + cols[k] + ')" stroke-width="' + (lead ? 2.6 : 1.8) + '" stroke-linejoin="round" points="' + c.pts.map((p) => X(p.b) + ',' + Y(p.pct)).join(' ') + '"/>';
    c.pts.forEach((p) => {
      s += '<circle cx="' + X(p.b) + '" cy="' + Y(p.pct) + '" r="' + (lead ? 4.2 : 3.4) + '" fill="var(' + cols[k] + ')" stroke="var(--card)" stroke-width="1.5"><title>' + esc(c.name) + ' · within ' + budgetLabel(p.b) + ': ' + p.pct + '% (' + p.done + ' of ' + c.n + ')</title></circle>';
      if (lead) s += '<text x="' + X(p.b) + '" y="' + (Y(p.pct) - 9) + '" text-anchor="middle" style="fill:var(' + cols[k] + ');font-weight:600;font-size:10px">' + p.pct + '%</text>';
    });
  });
  s += '</svg>';
  const f = figure('chart-curves', 'models/evals/bench/run.mjs · the 28 practice tasks', 'Practice tasks done within a time budget', s,
    'Each task counts once per side, when it passed its check within the budget.', DATA.curves.map(([k, c]) => [c.name, cols[k], true]));
  const d = el('details', 'pts'); d.open = true; d.appendChild(el('summary', '', 'The numbers'));
  let tb = '<div class="wrap"><table><thead><tr><th></th>' + DATA.budgets.map((b) => '<th>' + budgetLabel(b) + '</th>').join('') + '</tr></thead><tbody>';
  const top = DATA.budgets.map((b, i) => Math.max(...DATA.curves.map(([, c]) => c.pts[i].pct)));
  DATA.curves.forEach(([k, c]) => { tb += '<tr><td><span class="dot" style="background:var(' + cols[k] + ');margin-right:6px"></span>' + esc(c.name) + '</td>' + c.pts.map((p, i) => '<td' + (p.pct === top[i] ? ' style="font-weight:700"' : '') + '>' + p.pct + '%<span class="c">' + p.done + ' of ' + c.n + '</span></td>').join('') + '</tr>'; });
  d.insertAdjacentHTML('beforeend', tb + '</tbody></table></div>');
  f.appendChild(d);
})();
</script></body></html>`;

const out = docsPath('tests/bonsai-faster-2026-09-25.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
