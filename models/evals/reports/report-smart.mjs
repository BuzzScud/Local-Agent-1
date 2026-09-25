// Builds the report for the "smarter and faster" round of 2026-09-25:
// what changed, the engine probes, every practice task before and after,
// the ten harder tasks, the 28 real requests before and after.
//   node models/evals/reports/report-smart.mjs [--dir models/bonsai-2-27b/results/night/2026-09-25-smart]
// (the first version of the round's page; report-smart-stats.mjs builds the current one)
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toDocs } from '../../../docs/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const dir = join(root, opt('dir', 'models/bonsai-2-27b/results/night/2026-09-25-smart'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

// The night's baselines are under models/bonsai-2-27b/results/night (not in git).
const baseRoot = existsSync(join(root, 'models/bonsai-2-27b/results/night/2026-09-25')) ? root : join(homedir(), 'Desktop', 'bonsai-code');
const before = load(join(baseRoot, 'models/bonsai-2-27b/results/night/2026-09-25/practice-off/summary.json'));
const after = load(join(dir, 'practice-off/summary.json'));
// Items rerun on the fixed code (after the run showed a problem) replace their first result and are marked.
const rerun = load(join(dir, 'practice-rerun/summary.json'));
if (after && rerun) for (const r of rerun.results) { r.rerun = true; after.results = [...after.results.filter((x) => x.task !== r.task), r]; }
const wordsBefore = load(join(baseRoot, 'models/bonsai-2-27b/results/night/2026-09-25-rerun/words-real.json'));
const wordsAfter = load(join(dir, 'words-real.json'));
const wordsRerun = load(join(dir, 'words-real-rerun.json'));
if (wordsAfter && wordsRerun) { for (const r of wordsRerun.rows) { r.rerun = true; wordsAfter.rows = wordsAfter.rows.map((x) => (x.n === r.n ? r : x)); } wordsAfter.ok = wordsAfter.rows.filter((r) => r.ok).length; }
const probes = load(join(dir, 'probes.json'));

// Per task: average seconds and "all passed" across reps.
function byTask(summary) {
  const out = new Map();
  for (const r of summary?.results ?? []) {
    const e = out.get(r.task) ?? { task: r.task, route: r.route, secs: [], pass: true, rows: [] };
    e.secs.push(r.secs); e.pass = e.pass && r.pass; e.rows.push(r); e.route = r.route; e.rerun = e.rerun || !!r.rerun;
    out.set(r.task, e);
  }
  for (const e of out.values()) e.avg = Math.round(e.secs.reduce((a, b) => a + b, 0) / e.secs.length);
  return out;
}
const B = byTask(before);
const A = byTask(after);
const num = (t) => Number(t.split('-')[0]);
const tasks = [...new Set([...B.keys(), ...A.keys()])].sort((a, b) => num(a) - num(b));
const old = tasks.filter((t) => num(t) <= 18);
const hard = tasks.filter((t) => num(t) >= 19);
const sum = (m, list) => list.reduce((s, t) => s + (m.get(t)?.avg ?? 0), 0);
const passes = (m, list) => list.filter((t) => m.get(t)?.pass).length;
const has = (m, list) => list.filter((t) => m.has(t)).length;

const CHANGES = [
  ['It asks when unclear', 'A bare "fix the bug" when nothing fails, or a lone word such as "api", gets one question before anything runs; the model can also ask mid-task with its Ask tool, as often as it needs. You answer by number or type a line. Before, such requests wandered for minutes (115 s for "api", 348 s for "fix the bug").'],
  ['Changes across several files', 'An option used in three files, or a new argument and its callers, is now one job: the files are planned from the project map, one test defines "done", and drafts describe their changes as edit blocks across all the files. Before, there was no path for this at all.'],
  ['A bug in two places', 'When three tries on one function fail, three wider tries follow as edit blocks over the whole file. Before, it gave up on the file and worked step by step.'],
  ['Fewer drafts when they agree', 'The change path writes two tests and two drafts first, and only writes more when they disagree. Before, it always wrote three tests and four drafts, one after another at 10 tokens a second.'],
  ['Faster writing from the engine', 'n-gram speculative decoding is on: when the answer copies its input, as a rewritten function does, runs of tokens are accepted at once. Measured 25-35% faster writing, same output. Writing several answers at once was measured too, and is slower on this engine, so it stays off.'],
  ['A project map', 'Each code file with its names, cached per project. The model chooses files from it, and the step-by-step loop sees it first in a project with four or more code files, instead of listing and reading a piece at a time.'],
  ['A check before "done"', 'When the loop changes files and says it is done, one forced-JSON check compares the diff with the request; a missing part sends it back once.'],
  ['Ten harder practice tasks', 'Multi-file changes, a bug in two places of a 200-line file, vague requests, a real-sized project (a copy of Bonsai Code\'s own source), a three-part request, and a Python two-file change. Each check is proved to fail untouched and pass with a reference answer.'],
];

const css = `
:root { --bg:#fbfaf7; --fg:#1d1d1b; --dim:#6b6b66; --line:#e4e1da; --card:#fff; --ok:#1f7a3a; --bad:#b3261e; --warn:#8a5a00; --acc:#2a5db0; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#141412; --fg:#ebe9e3; --dim:#9a988f; --line:#2a2a26; --card:#1c1c19; --ok:#5fd08a; --bad:#ff7b72; --warn:#e0b050; --acc:#8ab4ff; } }
:root[data-theme="dark"] { --bg:#141412; --fg:#ebe9e3; --dim:#9a988f; --line:#2a2a26; --card:#1c1c19; --ok:#5fd08a; --bad:#ff7b72; --warn:#e0b050; --acc:#8ab4ff; }
* { box-sizing: border-box; } body { margin:0; background:var(--bg); color:var(--fg); font: 15px/1.5 -apple-system, "SF Pro Text", Helvetica, Arial, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 28px 16px 60px; }
h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 19px; margin: 34px 0 10px; } h3 { font-size: 16px; margin: 20px 0 6px; }
.sub { color: var(--dim); margin-bottom: 18px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 8px 0 14px; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; } th { color: var(--dim); font-weight: 600; } td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; } .warn { color: var(--warn); } .dim { color: var(--dim); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 10px 0; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin: 12px 0; } .tile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; } .tile b { display:block; font-size: 22px; } .tile span { color: var(--dim); font-size: 13px; }
code { font: 13px ui-monospace, Menlo, monospace; background: var(--line); padding: 1px 5px; border-radius: 4px; } .q { color: var(--acc); }
ul { padding-left: 20px; } li { margin: 4px 0; }
`;

const tile = (v, label) => `<div class="tile"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
const pf = (p) => (p ? '<span class="ok">pass</span>' : '<span class="bad">fail</span>');
const secsCell = (b, a) => {
  if (b == null || a == null) return `<td class="n">${b ?? '–'}</td><td class="n">${a ?? '–'}</td><td class="n">–</td>`;
  const d = a - b; const pct = b ? Math.round((d / b) * 100) : 0;
  return `<td class="n">${b}</td><td class="n">${a}</td><td class="n ${d < 0 ? 'ok' : d > 0 ? 'warn' : ''}">${d > 0 ? '+' : ''}${d} s${b ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''}</td>`;
};

let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bonsai smarter and faster</title><style>${css}</style></head><body><main>
<h1>Bonsai Code: smarter and faster</h1>
<div class="sub">Round of 2026-09-25 · branch <code>smart</code> on top of <code>open9</code> · Bonsai 2 27B on the M4 · thinking off · ${esc(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</div>`;

// Tiles
const oldBoth = old.filter((t) => B.has(t) && A.has(t));
const changeTasks = oldBoth.filter((t) => B.get(t).route === 'change');
html += `<div class="tiles">
${tile(`${passes(A, old)} / ${has(A, old)}`, 'old practice tasks pass now (before: all 18)')}
${tile(`${passes(A, hard)} / ${has(A, hard)}`, 'harder new tasks pass')}
${tile(`${sum(B, oldBoth)} → ${sum(A, oldBoth)} s`, 'the 18 old tasks, total time before → after')}
${tile(changeTasks.length ? `${Math.round(sum(B, changeTasks) / changeTasks.length)} → ${Math.round(sum(A, changeTasks) / changeTasks.length)} s` : '–', 'a change (add a feature), average')}
${tile(wordsAfter ? `${wordsAfter.ok} / ${wordsAfter.total}` : '–', `real requests OK (before: ${wordsBefore ? `${wordsBefore.ok} / ${wordsBefore.total}` : '–'})`)}
${tile('120', 'tests pass (bun test), 28 task checks proved')}
</div>`;

html += `<h2>What changed</h2>` + CHANGES.map(([h, t]) => `<div class="card"><b>${esc(h)}</b><br>${esc(t)}</div>`).join('');

// Probes
if (probes) {
  html += `<h2>Engine probes</h2><p class="dim">${esc(probes.note)}</p>
<h3>Several answers at once</h3><table><tr><th class="n">answers at once</th><th class="n">read tok/s</th><th class="n">write tok/s, all together</th><th class="n">seconds for 96 tokens each</th></tr>
${probes.parallelDecode.rows.map((r) => `<tr><td class="n">${r.answersAtOnce}</td><td class="n">${r.readTps}</td><td class="n">${r.writeTpsTotal}</td><td class="n">${r.writeSecs}</td></tr>`).join('')}</table><p>${esc(probes.parallelDecode.verdict)}</p>
<h3>Speculative decoding from the prompt</h3><p class="dim">${esc(probes.speculative.task)}</p><table><tr><th>mode</th><th class="n">temp</th><th class="n">seconds</th><th class="n">write tok/s</th><th class="n">drafted / accepted</th><th class="n">lines</th></tr>
${probes.speculative.rows.map((r) => `<tr><td>${esc(r.mode)}</td><td class="n">${r.temp}</td><td class="n">${r.secs}</td><td class="n">${r.writeTps}</td><td class="n">${r.draft != null ? `${r.draft} / ${r.accepted}` : '–'}</td><td class="n">${r.lines}</td></tr>`).join('')}</table><p>${esc(probes.speculative.verdict)}</p>`;
}

// Old tasks before/after
html += `<h2>The 18 practice tasks, before and after</h2><p class="dim">Before = the night run of 2026-09-25 (average of 2 runs, thinking off). After = this round, from the same checks.</p>
<table><tr><th>task</th><th>path</th><th>before</th><th>after</th><th class="n">before s</th><th class="n">after s</th><th class="n">change</th><th>asked</th></tr>`;
for (const t of old) {
  const b = B.get(t); const a = A.get(t);
  const asked = a?.rows.flatMap((r) => r.asked ?? []) ?? [];
  html += `<tr><td>${esc(t)}${a?.rerun ? ' <span class="dim">(rerun on the fixed code)</span>' : ''}</td><td>${esc(a?.route ?? b?.route ?? '')}</td><td>${b ? pf(b.pass) : '–'}</td><td>${a ? pf(a.pass) : '<span class="dim">running</span>'}</td>${secsCell(b?.avg, a?.avg)}<td>${asked.map((q) => `<span class="q">${esc(q.question)}</span> → ${esc(q.answer)}`).join('<br>')}</td></tr>`;
}
html += `<tr><th>total</th><th></th><th>${passes(B, old)} / ${has(B, old)}</th><th>${passes(A, old)} / ${has(A, old)}</th>${secsCell(sum(B, oldBoth), sum(A, oldBoth)).replace(/td/g, 'th')}<th></th></tr></table>`;
const failsOld = old.filter((t) => A.get(t) && !A.get(t).pass);
if (failsOld.length) html += `<p class="bad">Now failing: ${failsOld.map((t) => `${esc(t)} (${esc(A.get(t).rows.find((r) => !r.pass)?.why)})`).join('; ')}</p>`;

// Harder tasks
html += `<h2>The ten harder tasks</h2><table><tr><th>task</th><th>what it asks</th><th>path</th><th>result</th><th class="n">seconds</th><th>questions asked → answers</th><th>why (if failed)</th></tr>`;
for (const t of hard) {
  const a = A.get(t);
  const prompt = existsSync(join(root, 'models/evals/tasks', t, 'task.txt')) ? readFileSync(join(root, 'models/evals/tasks', t, 'task.txt'), 'utf8').trim() : '';
  const asked = a?.rows.flatMap((r) => r.asked ?? []) ?? [];
  html += `<tr><td>${esc(t)}${a?.rerun ? ' <span class="dim">(rerun on the fixed code)</span>' : ''}</td><td class="dim">${esc(prompt.length > 140 ? `${prompt.slice(0, 137)}…` : prompt)}</td><td>${esc(a?.route ?? '')}</td><td>${a ? pf(a.pass) : '<span class="dim">running</span>'}</td><td class="n">${a?.avg ?? '–'}</td><td>${asked.map((q) => `<span class="q">${esc(q.question)}</span> → ${esc(q.answer)}`).join('<br>') || '<span class="dim">none</span>'}</td><td class="warn">${esc(a?.rows.find((r) => !r.pass)?.why ?? '')}</td></tr>`;
}
html += `</table>`;

// Real requests
if (wordsBefore || wordsAfter) {
  const rowsB = new Map((wordsBefore?.rows ?? []).map((r) => [r.n, r]));
  const rowsA = new Map((wordsAfter?.rows ?? []).map((r) => [r.n, r]));
  const ns = [...new Set([...rowsB.keys(), ...rowsA.keys()])].sort((a, b) => a - b);
  html += `<h2>The 28 real requests, before and after</h2><p class="dim">Trigger words and blocked commands in throwaway folders, everything auto-approved; Bonsai's questions get a scripted answer. Before = the rerun of 2026-09-25 morning.</p>
<table><tr><th class="n">#</th><th>request</th><th>before</th><th class="n">s</th><th>after</th><th class="n">s</th><th>path after</th><th>asked → answered</th><th>fails after</th></tr>`;
  for (const n of ns) {
    const b = rowsB.get(n); const a = rowsA.get(n);
    html += `<tr><td class="n">${n}</td><td>${esc((a ?? b).prompt)}${a?.rerun ? ' <span class="dim">(rerun on the fixed code)</span>' : ''}</td><td>${b ? (b.ok ? '<span class="ok">OK</span>' : '<span class="bad">BAD</span>') : '–'}</td><td class="n">${b?.secs ?? '–'}</td><td>${a ? (a.ok ? '<span class="ok">OK</span>' : '<span class="bad">BAD</span>') : '<span class="dim">running</span>'}</td><td class="n">${a?.secs ?? '–'}</td><td>${esc(a?.route ?? '')}</td><td>${(a?.asked ?? []).map((q) => `<span class="q">${esc(q.question)}</span> → ${esc(q.answer)}`).join('<br>')}</td><td class="warn">${esc((a?.fails ?? []).join('; '))}</td></tr>`;
  }
  const tb = wordsBefore ? wordsBefore.rows.reduce((s, r) => s + r.secs, 0) : null;
  const ta = wordsAfter ? wordsAfter.rows.reduce((s, r) => s + r.secs, 0) : null;
  html += `<tr><th></th><th>total</th><th>${wordsBefore ? `${wordsBefore.ok} / ${wordsBefore.total}` : ''}</th><th class="n">${tb ?? ''}</th><th>${wordsAfter ? `${wordsAfter.ok} / ${wordsAfter.total}` : ''}</th><th class="n">${ta ?? ''}</th><th></th><th></th><th></th></tr></table>`;
}

html += `<h2>Honest notes</h2><ul>
<li>Nothing is committed: the work sits in the worktree <code>~/worktrees/bonsai-smart</code> (branch <code>smart</code>, on top of <code>open9</code>), and the installed <code>bonsai</code> is still the morning build. Say the word to commit, merge and reinstall.</li>
<li>The engine probes ran while the branch's unit tests were running, so their absolute speeds are below the quiet 10.8 tokens/s; each comparison shared that load.</li>
<li>Asking costs one model turn per question (10-30 s) and a pause until you answer. The model is told to ask only what its tools cannot find; the vague-request question is one call, and "TEST"/"run the tests" never ask.</li>
<li>Writing several answers at once is slower on this engine, so the parallel plumbing (two side slots) exists but is off.</li>
<li>The multi-file path shows every file whole, so files over 300 lines fall back to the single-file path or step by step.</li>
<li>Two things the first real run caught, fixed since (after this run's snapshot): a multi-file draft also created a stray <code>test.mjs</code> (task 19; now only the planned files may change), and the wider fix on task 21 passed the four tests by deleting eight other functions (now a change that removes names the task never mentions, or far more lines than it adds, is refused). Both tasks still pass on the fixed code in the unit tests; the timings above are from the run before the guards.</li>
<li>Task 28 (Python, add a field) is the one that still fails. Adding <code>fee</code> to <code>to_dict</code> breaks the existing test's expected dict, and the focused paths never edit existing tests, so every draft failed (362 s). The step-by-step fallback then did two of the three parts in 70 s (the field, the value minus the fee) but left <code>fee</code> out of the dict, and its own check missed that. On the rerun it also repeated the single-file tries first (230 s); since then a failed set of tries goes straight to step by step.</li>
<li>Task 25 (a question about a real-sized project) answered correctly but spent two minutes building scratch experiments; the prompt now says to answer a question from the code read, without experiments. The fence held: every attempt outside the folder or with rm -rf was refused.</li>
</ul>
<p class="dim">Results: <code>${esc(dir.replace(root + '/', ''))}</code> · practice checks: <code>zsh models/evals/verify-tasks.sh</code> · tests: <code>bun test</code></p>
</main></body></html>`;

const out = join(root, 'models', 'bonsai-2-27b', 'reports', 'bonsai-smart-2026-09-25-v1.html');
writeFileSync(out, html);
console.log(`wrote ${out}`);
toDocs(out);
