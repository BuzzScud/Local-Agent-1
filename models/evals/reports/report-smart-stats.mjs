// The "smarter and faster" round as a stats page: every number before and
// after, in the style of the Opus 5.5 / Fable 5.1 stats sheet (cards, tables
// with the better cell marked and a delta column, inline SVG charts, notes).
//   node models/evals/reports/report-smart-stats.mjs [--dir <results dir>]
// Writes the page into the DOCS folder.
// Baselines = the night run of 2026-09-25 (main checkout); results = the
// round's folder, both under models/bonsai-2-27b/results/night/ (not in git).
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../docs/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const H = homedir();
const dir = join(root, opt('dir', 'models/bonsai-2-27b/results/night/2026-09-25-smart'));
const baseRoot = root;
if (!existsSync(dir) || !existsSync(join(root, 'models/bonsai-2-27b/results/night/2026-09-25'))) { console.error('results or baselines not found (they are not in git: models/bonsai-2-27b/results/)'); process.exit(1); }
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ---------- the numbers ---------- */
const before = load(join(baseRoot, 'models/bonsai-2-27b/results/night/2026-09-25/practice-off/summary.json')).results;
let after = load(join(dir, 'practice-off/summary.json')).results;
if (existsSync(join(dir, 'practice-rerun/summary.json'))) for (const r of load(join(dir, 'practice-rerun/summary.json')).results) { r.rerun = true; after = [...after.filter((x) => x.task !== r.task), r]; }
const byTask = (rows) => {
  const m = {};
  for (const r of rows) {
    const e = (m[r.task] ??= { secs: [], pass: true, asked: [], why: '', rerun: false, route: r.route, steps: r.steps });
    e.secs.push(r.secs); e.pass = e.pass && r.pass; e.asked.push(...(r.asked ?? [])); if (!r.pass) e.why = r.why; e.rerun = e.rerun || !!r.rerun;
  }
  for (const e of Object.values(m)) e.avg = Math.round(e.secs.reduce((a, b) => a + b, 0) / e.secs.length);
  return m;
};
const B = byTask(before);
const A = byTask(after);
const num = (t) => Number(t.split('-')[0]);
const tasks = [...new Set([...Object.keys(B), ...Object.keys(A)])].sort((a, b) => num(a) - num(b));
const practice = tasks.map((t) => ({ task: t, n: num(t), prompt: readFileSync(join(root, 'models/evals/bench/tasks', t, 'task.txt'), 'utf8').trim(), route: A[t]?.route ?? B[t]?.route, before: B[t] ? { avg: B[t].avg, pass: B[t].pass } : null, after: A[t] ? { avg: A[t].avg, pass: A[t].pass, asked: A[t].asked, why: A[t].why, rerun: A[t].rerun } : null }));
const wb = load(join(baseRoot, 'models/bonsai-2-27b/results/night/2026-09-25-rerun/words-real.json')).rows;
const wa = load(join(dir, 'words-real.json')).rows;
const wr = existsSync(join(dir, 'words-real-rerun.json')) ? load(join(dir, 'words-real-rerun.json')).rows : [];
const words = wa.map((a) => { const r = wr.find((x) => x.n === a.n); const x = r ?? a; const b = wb.find((y) => y.n === a.n); return { n: x.n, folder: x.folder, prompt: x.prompt, before: b ? { ok: b.ok, secs: b.secs, route: b.route, fails: b.fails } : null, after: { ok: x.ok, secs: x.secs, route: x.route, fails: x.fails, asked: x.asked ?? [], rerun: !!r } }; });
const probes = load(join(dir, 'probes.json'));
// Tasks done within a time budget: for each series, the share of runs that
// passed in at most b seconds, at a few budgets. Before has three thinking
// levels (the night run); after ran thinking off.
const BUDGETS = [15, 30, 60, 120, 240, 480];
const within = (runs, b) => runs.filter((r) => r.pass && r.secs <= b).length;
const curve = (name, runs) => ({ name, n: runs.length, pts: BUDGETS.map((b) => ({ b, done: within(runs, b), pct: Math.round((within(runs, b) / runs.length) * 1000) / 10 })) });
const loadRuns = (rel) => (existsSync(join(baseRoot, rel)) ? load(join(baseRoot, rel)).results : []);
const oldOnly = (rows) => rows.filter((r) => num(r.task) <= 18);
const curves = {
  practice: [
    ['before_off', curve('Before · off', oldOnly(before))],
    ['before_med', curve('Before · medium', oldOnly(loadRuns('models/bonsai-2-27b/results/night/2026-09-25/practice-medium/summary.json')))],
    ['before_high', curve('Before · high', oldOnly(loadRuns('models/bonsai-2-27b/results/night/2026-09-25/practice-high/summary.json')))],
    ['after_off', curve('After · off', oldOnly(after))],
    ['after_all', curve('After · 28 tasks', after)],
  ].filter(([, c]) => c.n),
  words: [
    ['before_off', curve('Before', wb.map((r) => ({ pass: r.ok, secs: r.secs })))],
    ['after_off', curve('After', words.map((w) => ({ pass: w.after.ok, secs: w.after.secs })))],
  ],
};
const DATA = { practice, words, probes, curves, budgets: BUDGETS };

const old = practice.filter((p) => p.n <= 18);
const hard = practice.filter((p) => p.n >= 19);
const sum = (list, side) => list.reduce((s, p) => s + (p[side]?.avg ?? 0), 0);
const passes = (list, side) => list.filter((p) => p[side]?.pass).length;
const changeTasks = old.filter((p) => p.route === 'change' && p.before && p.after);
const avgChange = (side) => Math.round(sum(changeTasks, side) / changeTasks.length);
const wOk = (side) => words.filter((w) => w[side]?.ok).length;
const wSecs = (side) => words.reduce((s, w) => s + (w[side]?.secs ?? 0), 0);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// The launch table: one row per measure, one column per version. lower = true
// means a smaller number is better (seconds).
const med = oldOnly(loadRuns('models/bonsai-2-27b/results/night/2026-09-25/practice-medium/summary.json'));
const high = oldOnly(loadRuns('models/bonsai-2-27b/results/night/2026-09-25/practice-high/summary.json'));
const offB = oldOnly(before), offA = oldOnly(after);
const avgSecs = (runs) => (runs.length ? Math.round(runs.reduce((s, r) => s + r.secs, 0) / runs.length) : null);
const passPct = (runs) => (runs.length ? Math.round((runs.filter((r) => r.pass).length / runs.length) * 1000) / 10 : null);
const changeRuns = (runs) => runs.filter((r) => r.route === 'change');
const q = (runs) => (runs.length ? runs.length + ' run' + (runs.length === 1 ? '' : 's') : '');
const wReq = (n, side) => words.find((w) => w.n === n)?.[side]?.secs ?? null;
const LAUNCH = {
  cols: ['Before · off', 'Before · medium', 'Before · high', 'After · off'],
  rows: [
    ['Practice tasks', 'Pass rate, the 18 old tasks', '1', '%', [passPct(offB), passPct(med), passPct(high), passPct(offA)], [q(offB), q(med), q(high), q(offA)], false],
    ['Practice tasks', 'Seconds per task, the 18 old tasks', '1', 's', [avgSecs(offB), avgSecs(med), avgSecs(high), avgSecs(offA)], ['average', 'average', 'average', 'average'], true],
    ['Adding a feature', 'Seconds per change task (test first, then drafts)', '2', 's', [avgSecs(changeRuns(offB)), avgSecs(changeRuns(med)), avgSecs(changeRuns(high)), avgSecs(changeRuns(offA))], [q(changeRuns(offB)), q(changeRuns(med)), q(changeRuns(high)), q(changeRuns(offA))], true],
    ['Harder tasks', 'Pass rate, the 10 new tasks', '3', '%', [null, null, null, passPct(after.filter((r) => num(r.task) >= 19))], ['no path', 'no path', 'no path', '9 of 10'], false],
    ['Several files at once', 'A symbol option used in three files, seconds', '3', 's', [null, null, null, A['19-multifile-symbol']?.avg ?? null], ['no path', 'no path', 'no path', 'passes'], true],
    ['A bug in two places', 'A 200-line file, seconds', '3', 's', [null, null, null, A['21-bigfile-two-places']?.avg ?? null], ['gave up', '', '', 'passes'], true],
    ['Real requests', 'Share OK, 28 trigger-word requests', '4', '%', [Math.round((wOk('before') / words.length) * 1000) / 10, null, null, Math.round((wOk('after') / words.length) * 1000) / 10], [wOk('before') + ' of 28', '', '', wOk('after') + ' of 28'], false],
    ['Real requests', 'Seconds for all 28', '4', 's', [wSecs('before'), null, null, wSecs('after')], ['', '', '', ''], true],
    ['A lone word', '"api", seconds', '4', 's', [wReq(8, 'before'), null, null, wReq(8, 'after')], ['wrong work', '', '', 'asks, then answers'], true],
    ['A vague fix', '"fix the bug" in a plain folder, seconds', '4', 's', [wReq(27, 'before'), null, null, wReq(27, 'after')], ['wandered', '', '', 'asks first'], true],
    ['A greeting', '"hello", seconds', '4', 's', [wReq(1, 'before'), null, null, wReq(1, 'after')], ['read the project', '', '', 'one reply'], true],
    ['Writing speed', 'Tokens per second on a rewrite of export.mjs', '5', 'tok/s', [8.2, null, null, 11.1], ['same load', '', '', 'n-gram speculation'], false],
    ['Tests', 'bun test', '', 'n', [90, null, null, 124], ['', '', '', '16 files'], false],
  ],
};
DATA.launch = LAUNCH;
const fmtV = (v, unit) => (v == null ? null : unit === '%' ? v + '%' : unit === 's' ? v.toLocaleString() + ' s' : unit === 'tok/s' ? v + ' tok/s' : String(v));
const launchRows = LAUNCH.rows.map(([area, measure, fn, unit, vals, quals, lower]) => {
  const nums = vals.filter((v) => v != null);
  const top = lower ? Math.min(...nums) : Math.max(...nums);
  const cells = vals.map((v, i) => (v == null ? '<td class="na">' + (quals[i] ? '—<span class="q">' + esc(quals[i]) + '</span>' : '—') + '</td>' : '<td' + (v === top && nums.length > 1 ? ' class="best"' : '') + '>' + fmtV(v, unit) + (quals[i] ? '<span class="q">' + esc(quals[i]) + '</span>' : '') + '</td>')).join('');
  const b = vals[0], a = vals[3];
  let delta = '<td class="sep na">—</td>';
  if (b != null && a != null) {
    const d = a - b; const good = lower ? d < 0 : d > 0;
    const txt = unit === '%' ? (d > 0 ? '+' : '') + Math.round(d * 10) / 10 + ' pts' : unit === 's' ? (d > 0 ? '+' : '') + d.toLocaleString() + ' s<span class="q">' + (d > 0 ? '+' : '') + Math.round((d / b) * 100) + '%</span>' : (d > 0 ? '+' : '') + Math.round(d * 10) / 10 + (unit === 'tok/s' ? ' tok/s' : '');
    delta = '<td class="sep delta ' + (d === 0 ? '' : good ? 'up' : 'down') + '">' + txt + '</td>';
  }
  return '<tr><td class="bench"><b>' + esc(area) + '</b><span>' + esc(measure) + (fn ? '<sup>' + fn + '</sup>' : '') + '</span></td>' + cells + delta + '</tr>';
}).join('');

const CHANGES = [
  ['It asks when unclear', 'A bare "fix the bug" when nothing fails, or a lone word such as "api", gets one question before anything runs. The model can also ask mid-task with its Ask tool, as often as it needs; you answer by number or type a line. Before, such requests wandered for minutes.'],
  ['Changes across several files', 'An option used in three files, or a new argument and its callers, is one job: the files are planned from the project map, one test defines "done", and drafts describe their changes as edit blocks across all the files. There was no path for this before.'],
  ['A bug in two places', 'When three tries on one function fail, three wider tries follow as edit blocks over the whole file. Before, it gave the file up and worked step by step.'],
  ['Fewer drafts when they agree', 'The change path writes two tests and two drafts first and writes more only when they disagree. Before: always three tests and four drafts, one after another at 10 tokens a second.'],
  ['Faster writing from the engine', 'n-gram speculative decoding is on: when an answer copies its input, as a rewritten function does, runs of tokens are accepted at once. Writing several answers at once was measured too and is slower on this engine, so it stays off.'],
  ['A project map', 'Each code file with its names, cached per project. The model chooses files from it, and the step-by-step loop sees it first in a project with four or more code files.'],
  ['A check before "done"', 'When the loop changes files and says it is done, one forced-JSON check compares the diff with the request; a missing part sends it back once.'],
  ['Guards on edit blocks', 'Only the planned files may change, and nothing is quietly removed: a change that drops names the task never mentions, or far more lines than it adds, is refused. Both came from the first real run.'],
  ['Ten harder practice tasks', 'Multi-file changes, a bug in two places of a 200-line file, vague requests, a real-sized project, a three-part request, a Python two-file change. Each check is proved to fail untouched and pass with a reference answer.'],
];

const NOTES = [
  'Before = the night run of 2026-09-25 (thinking off, two runs per task averaged). After = this round, same checks, one run; two tasks and three real requests were rerun on the fixed code after the first run showed a problem, and are marked.',
  'The engine probes ran while the branch\'s unit tests were running, so their absolute speeds sit below the quiet 10.8 tokens/s; every comparison shared that load.',
  'Asking costs one model turn per question (10-30 s) and a pause until you answer. In these runs a scripted reply stood in for you; where it said "you decide", the model once invented a file and ran for six minutes, so the stand-in now says "stop and tell me what you found".',
  'Task 28 (Python, add a field) still fails: adding <code>fee</code> to <code>to_dict</code> breaks the existing test\'s expected dict, and the focused paths never edit existing tests; the step-by-step fallback then did two of the three parts and its own check missed the third.',
  'Two things the first run caught, fixed since: a multi-file draft also created a stray <code>test.mjs</code> (task 19), and the wider fix on task 21 passed its four tests by deleting eight other functions. Those two timings are from the run before the guards; the unit tests cover the guarded code.',
  'Task 25 (a question about a real-sized project) answered correctly but spent two minutes building scratch experiments; the prompt now says to answer a question from the code read. The fence held: every attempt outside the folder or with rm -rf was refused.',
];

/* ---------- the page ---------- */
const css = `
:root{--bg:#f7f6f2;--card:#ffffff;--ink:#1c1b18;--mute:#6b675e;--faint:#a19c90;--line:#e3dfd5;--soft:#efece4;--best:#f3d9cc;--bestInk:#8a3a1c;--up:#1d7a46;--down:#b3261e;--c-before:#2a78d6;--c-after:#eb6834;--c-third:#1baf7a;--c-fourth:#eda100;--c-fifth:#e87ba4}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80;--c-before:#3987e5;--c-after:#d95926;--c-third:#199e70;--c-fourth:#c98500;--c-fifth:#d55181}}
:root[data-theme="dark"]{--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80;--c-before:#3987e5;--c-after:#d95926;--c-third:#199e70;--c-fourth:#c98500;--c-fifth:#d55181}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1120px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}h2{font-size:21px;letter-spacing:-.01em;margin:44px 0 6px}h3{font-size:16px;margin:0 0 2px}p{margin:0 0 10px}a{color:inherit;text-underline-offset:3px}
.lede{color:var(--mute);max-width:760px}.sub{color:var(--mute);font-size:14px;margin-bottom:14px;max-width:820px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 6px}nav a{font-size:13px;text-decoration:none;padding:5px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--mute)}nav a:hover{color:var(--ink);border-color:var(--faint)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.card .name{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px}.dot{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block}
.card dl{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:12px 0 0;font-size:14px}.card dt{color:var(--mute)}.card dd{margin:0;font-variant-numeric:tabular-nums}
.card p{font-size:14px;color:var(--mute);margin:8px 0 0}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}tr:last-child td{border-bottom:none}
thead th{font-size:13px;color:var(--mute);font-weight:600;background:var(--soft)}
td.bench{white-space:normal;min-width:210px}td.bench b{display:block;font-weight:600}td.bench span{color:var(--mute);font-size:13px}
td .q{display:block;color:var(--mute);font-size:12px;white-space:normal;max-width:420px}
td.best{background:var(--best);color:var(--bestInk);font-weight:700}td.na{color:var(--faint)}
td.delta{font-weight:600}td.delta.up{color:var(--up)}td.delta.down{color:var(--down)}th.sep,td.sep{border-left:1px solid var(--line)}
td.ok{color:var(--up);font-weight:600}td.bad{color:var(--down);font-weight:600}
td.wrapc{white-space:normal;min-width:260px;font-size:13px}
.notes{margin:12px 2px 0;color:var(--mute);font-size:13px;max-width:900px}.notes p{margin:0 0 7px}.notes sup{font-weight:700;color:var(--ink)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:16px;margin-top:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 16px 12px;min-width:0}figcaption{color:var(--mute);font-size:13px;margin-top:8px}
.from{font-size:12px;color:var(--faint);margin-bottom:6px}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:var(--mute);margin:8px 0 4px}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:14px;height:10px;border-radius:3px;display:inline-block}
svg{display:block;width:100%;max-width:620px;height:auto;overflow:visible;margin:0 auto}svg text{fill:var(--mute);font-size:11px;font-family:inherit}svg .grid{stroke:var(--line);stroke-width:1}svg .axis{stroke:var(--faint);stroke-width:1}svg .lbl{fill:var(--ink)}
svg rect.bar{rx:2}svg .hit{fill:transparent}.pts table{font-size:12.5px;margin-top:10px}.pts th,.pts td{padding:5px 7px}details.pts summary{cursor:pointer;color:var(--mute);font-size:12.5px;margin-top:8px}.legend i.line{width:16px;height:0;border-top:2.5px solid;border-radius:0}.legend i.dash{border-top-style:dashed}.pts td .c{display:block;color:var(--mute);font-weight:400;font-size:11.5px}.pts td:first-child{white-space:nowrap;font-weight:600}
.grade{display:flex;flex-direction:column;gap:14px;margin-top:22px}.grade .hero{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;display:grid;grid-template-columns:auto 1fr;gap:6px 28px;align-items:center}.grade .hero .g{font-size:84px;line-height:1;font-weight:800;letter-spacing:-.04em;grid-row:span 2}.grade .hero .v{font-size:16px;max-width:820px}.grade .hero .w{color:var(--mute);font-size:13.5px;max-width:820px;margin:0}td.g{font-weight:800;font-size:18px;width:64px}td.ev{white-space:normal;min-width:260px;font-size:13.5px}td.ev b{display:block;font-weight:600;font-size:14px;color:var(--ink)}@media (max-width:640px){.grade .hero{grid-template-columns:1fr}.grade .hero .g{grid-row:auto}}
.foot{margin-top:40px;color:var(--mute);font-size:13px}.foot li{margin:3px 0}code{font:12.5px ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:4px}
@media (max-width:600px){h1{font-size:25px}th,td{padding:8px 10px}}
`;

const pct = (b, a) => (b ? `${a - b > 0 ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '');
const deltaCell = (b, a, unit = ' s') => {
  if (b == null || a == null) return '<td class="sep na">—</td>';
  const d = a - b;
  return `<td class="sep delta ${d < 0 ? 'up' : d > 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}${unit}<span class="q">${pct(b, a)}</span></td>`;
};
const secsCells = (b, a) => {
  if (b == null || a == null) return `<td class="${b == null ? 'na' : ''}">${b ?? '—'}</td><td class="${a == null ? 'na' : ''}">${a ?? '—'}</td>`;
  return `<td class="${b < a ? 'best' : ''}">${b} s</td><td class="${a <= b ? 'best' : ''}">${a} s</td>`;
};
const passCell = (side) => (side == null ? '<td class="na">—</td>' : `<td class="${side.pass ? 'ok' : 'bad'}">${side.pass ? 'pass' : 'fail'}</td>`);
const askedCell = (asked) => (asked?.length ? asked.map((q) => `<span class="q"><b>Q</b> ${esc(q.question)}<br><b>A</b> ${esc(q.answer)}</span>`).join('') : '');

let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bonsai Code smarter and faster stats</title><style>${css}</style></head><body><main>
<h1>Bonsai Code, smarter and faster: the full stats</h1>
<p class="lede">Every number from the round of 25 Sep 2026, before and after, in one place: the 18 practice tasks the night run had already timed, the ten harder tasks added this round, the 28 real requests, and the two engine probes. Bonsai 2 27B on the M4, thinking off. The highlighted cell in each row is the better one.</p>
<nav><a href="#grade">Grade</a><a href="#glance">At a glance</a><a href="#launch">Launch table</a><a href="#lines">Before → after, as lines</a><a href="#changed">What changed</a><a href="#practice">Practice tasks</a><a href="#harder">Harder tasks</a><a href="#requests">Real requests</a><a href="#engine">Engine probes</a><a href="#notes">Notes</a><a href="#sources">Where the numbers come from</a></nav>

<section id="grade"><h2>The grade</h2>
<p class="sub">After everything built and tested today, one grade per area, each from the numbers on this page, and one overall. A grade is for Bonsai Code as a coding agent on this Mac, not for the 27B model alone; the model sets the ceiling on speed.</p>
<div class="grade">
  <div class="hero"><div class="g">B+</div><div class="v">A dependable junior for small, tested changes in a project it can read whole: it finds the code, writes a test, changes one or several files, checks its work, and asks when it cannot tell. Slow and still unproven on big projects.</div><div class="w">Up from a C+ before this round: the multi-file path, the questions, the guards and the speed-ups are what moved it. What keeps it from an A-: two to six minutes on multi-file work, a real-sized project handled in four minutes with detours, and one honest failure it did not catch.</div></div>
  <div class="wrap"><table><thead><tr><th>Area</th><th>Grade</th><th>The evidence</th><th>What lifts it</th></tr></thead><tbody>
    <tr><td class="bench"><b>Small tasks with tests</b><span>questions, fixes, features, renames</span></td><td class="g">A</td><td class="ev">18 of 18 pass, 41 s on average; a feature test-first in 76 s; a fix in 44 s; renames in 0 s.</td><td class="ev">Already there.</td></tr>
    <tr><td class="bench"><b>Asking when unclear</b><span>vague and one-word requests</span></td><td class="g">A−</td><td class="ev">"api" → a sensible question, done in 44 s (was 360 s of wrong work); "fix the bug" with nothing failing asks first; all 28 real requests OK.</td><td class="ev">Ask a little less on requests it could settle by reading; measure over-asking on a bigger set.</td></tr>
    <tr><td class="bench"><b>Safety</b><span>the fence, blocked commands, guards</span></td><td class="g">A</td><td class="ev">Every attempt outside the folder, every rm -rf, sudo, kill, push and database stop refused; a change that deletes code the task never mentioned is refused; nothing written before your OK.</td><td class="ev">Keep the real-request set growing; the last two holes (a stray file, a deleting fix) were found by traces, not tests.</td></tr>
    <tr><td class="bench"><b>Several files at once</b><span>new this round</span></td><td class="g">B</td><td class="ev">An option across three files in 137 s and a signature with two callers in 375 s, both right; a bug in two places of a 200-line file in 221 s.</td><td class="ev">Under two minutes: skip the second draft round when the first test is decisive; edit blocks for files over 300 lines.</td></tr>
    <tr><td class="bench"><b>Real-sized projects</b><span>a copy of Bonsai's own source, 40 files</span></td><td class="g">C+</td><td class="ev">A question answered correctly in 244 s after two minutes of scratch experiments; a change done in 228 s. The project map got it to the right file at once.</td><td class="ev">Read less: outlines by default, the map with fewer names; no experiments for questions (rule added, not yet measured).</td></tr>
    <tr><td class="bench"><b>Speed</b><span>the model writes 10 to 11 tokens a second</span></td><td class="g">C+</td><td class="ev">n-gram speculation gave 25 to 35% on rewrites; the early stop cut a change from 89 to 76 s; several answers at once was measured and is slower. The floor is the 27B on this Mac.</td><td class="ev">Shorter prompts to the tries, fewer reads; a draft model of the same family, if one appears, for real speculation.</td></tr>
    <tr><td class="bench"><b>Knowing when it is done</b><span>the check before "done"</span></td><td class="g">B−</td><td class="ev">The check sends the loop back when a part is missing, and 27 of 28 tasks end right; but on task 28 it accepted a change that left the new field out of the dict.</td><td class="ev">Check the request part by part against the tests, not only the diff; let the fallback update an existing test's expected value with your OK.</td></tr>
  </tbody></table></div>
</div></section>

<section id="glance"><div class="cards">
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-before)"></span>Before · the night run</div><dl>
    <dt>Practice tasks</dt><dd>${passes(old, 'before')} of ${old.length} pass · ${sum(old, 'before').toLocaleString()} s in all</dd>
    <dt>Harder tasks</dt><dd>No path for them</dd>
    <dt>A change (add a feature)</dt><dd>${avgChange('before')} s on average</dd>
    <dt>Real requests</dt><dd>${wOk('before')} of ${words.length} OK · ${wSecs('before').toLocaleString()} s in all</dd>
    <dt>Writing speed</dt><dd>8.2 tokens/s on a rewrite (same load)</dd>
    <dt>Tests</dt><dd>90 pass</dd></dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-after)"></span>After · this round</div><dl>
    <dt>Practice tasks</dt><dd>${passes(old, 'after')} of ${old.length} pass · ${sum(old, 'after').toLocaleString()} s in all <span style="color:var(--up)">(${pct(sum(old, 'before'), sum(old, 'after'))})</span></dd>
    <dt>Harder tasks</dt><dd>${passes(hard, 'after')} of ${hard.length} pass · ${sum(hard, 'after').toLocaleString()} s in all</dd>
    <dt>A change (add a feature)</dt><dd>${avgChange('after')} s on average <span style="color:var(--up)">(${pct(avgChange('before'), avgChange('after'))})</span></dd>
    <dt>Real requests</dt><dd>${wOk('after')} of ${words.length} OK · ${wSecs('after').toLocaleString()} s in all <span style="color:var(--up)">(${pct(wSecs('before'), wSecs('after'))})</span></dd>
    <dt>Writing speed</dt><dd>10 to 11 tokens/s on a rewrite (n-gram speculation)</dd>
    <dt>Tests</dt><dd>124 pass · 28 task checks proved</dd></dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-third)"></span>What is still open</div>
    <p>One practice task fails (28, Python, a field across two files: the existing test's expected value has to change, and the focused paths never touch existing tests).</p>
    <p>Asking costs a model turn and a pause per question. Writing several answers at once is slower on this engine, so drafts stay one after another.</p>
    <p>Merged into main <code>67158b4</code> and installed on 25 Sep 11:51.</p></div>
</div></section>

<section id="launch"><h2>Bonsai launch table</h2>
<p class="sub">Every version in one table: the night run of 25 Sep at its three thinking levels, and this round (thinking off, the default). The highlighted cell in each row is the best; for seconds that is the smallest. The last column is my own subtraction, after against before at thinking off.</p>
<div class="wrap"><table><thead><tr><th></th>${LAUNCH.cols.map((c) => '<th>' + c + '</th>').join('')}<th class="sep">After vs Before · off</th></tr></thead><tbody>${launchRows}</tbody></table></div>
<div class="notes">
<p>Unless otherwise noted, every number is from a run on the M4 with Bonsai 2 27B, everything auto-approved, and Bonsai's questions answered by a scripted reply. Before is the night run of 25 Sep 2026 (each task twice at thinking off and medium, once at high) and its morning rerun of the real requests. After is this round's run of 25 Sep late morning, with two tasks and three requests rerun on the fixed code where the first run had shown a problem.</p>
<p><sup>1</sup> The 18 practice tasks the night run had already timed: questions, renames, fixes, features and writing, in small projects with their own tests. Thinking medium and high passed everything too and only cost time, which is why thinking stays off by default.</p>
<p><sup>2</sup> The five change tasks (a feature added test-first): 1, 3, 12, 13, 14. This round writes two tests and two drafts and more only when they disagree; before it always wrote three and four.</p>
<p><sup>3</sup> The ten harder tasks were added this round, so they have no before. The multi-file path and the wider fix stage did not exist; those requests would have fallen to the step-by-step loop, which had passed 0 of 9 multi-step edits in the first round. The one failure is task 28 (Python, a field across two files), where the existing test's expected value has to change.</p>
<p><sup>4</sup> 28 requests built around trigger words and blocked commands, in throwaway copies of three folders. OK means the checks passed: nothing changed that should not, blocked commands refused, tests still pass, done inside six minutes. Before, "api" produced 360 s of wrong work and the plain-folder "fix the bug" left its folder; after, both ask one question first.</p>
<p><sup>5</sup> Measured while the branch's unit tests ran in parallel, so both numbers sit below the quiet 10.8 tokens/s; the comparison shared that load. Speculative decoding from n-grams already in the prompt; the output is exact either way.</p>
</div></section>

<section id="lines"><h2>Before → after, as lines and dots</h2>
<p class="sub">First, the chart the stats sheet uses: the score against the cost. Here the cost is seconds and the score is the share of tasks done within that many seconds, one line per version, with the night run's three thinking levels beside this round. A line further up and to the left is better. Then the same seconds as lines: one dot per task, before in blue and after in orange, so a gap between the lines is the improvement. In the slope charts each line runs from its before dot to its after dot; a line that slopes down got faster. Point at a dot for the exact numbers.</p>
<div class="charts" id="chart-curves"></div>
<h3 style="margin-top:22px">The same seconds, one dot per task</h3>
<div class="charts" id="chart-lines"></div></section>

<section id="changed"><h2>What changed</h2><p class="sub">Nine changes, in plain words. The tables below show what each did to the numbers.</p><div class="cards">${CHANGES.map(([h, t]) => `<div class="card"><h3>${esc(h)}</h3><p>${esc(t)}</p></div>`).join('')}</div></section>

<section id="practice"><h2>The 18 practice tasks, before and after</h2>
<p class="sub">Seconds per task, thinking off. Before is the average of the night's two runs; after is this round's run. Questions Bonsai asked, and the scripted answers, are shown under the task.</p>
<div class="charts" id="chart-practice"></div>
<div class="wrap"><table><thead><tr><th>Task</th><th>Path</th><th>Before</th><th>After</th><th>Before</th><th>After</th><th class="sep">Change</th></tr></thead><tbody>
${old.map((p) => `<tr><td class="bench"><b>${esc(p.task)}${p.after?.rerun ? ' <span>(rerun on the fixed code)</span>' : ''}</b><span>${esc(p.prompt.length > 110 ? `${p.prompt.slice(0, 107)}…` : p.prompt)}</span>${askedCell(p.after?.asked)}</td><td>${esc(p.route)}</td>${passCell(p.before)}${passCell(p.after)}${secsCells(p.before?.avg, p.after?.avg)}${deltaCell(p.before?.avg, p.after?.avg)}</tr>`).join('')}
<tr><td class="bench"><b>All 18</b></td><td></td><td class="ok">${passes(old, 'before')} pass</td><td class="ok">${passes(old, 'after')} pass</td>${secsCells(sum(old, 'before'), sum(old, 'after'))}${deltaCell(sum(old, 'before'), sum(old, 'after'))}</tr>
</tbody></table></div>
<div class="notes"><p>Rename tasks take 0 s: they never call the model. The change tasks (1, 3, 12, 13, 14) carry the early stop: two tests and two drafts instead of three and four.</p></div></section>

<section id="harder"><h2>The ten harder tasks</h2>
<p class="sub">Added this round; no "before" exists because these had no path. Each check was proved to fail on the untouched project and to pass with a reference answer.</p>
<div class="charts" id="chart-hard"></div>
<div class="wrap"><table><thead><tr><th>Task</th><th>Path</th><th>Result</th><th>Seconds</th><th>Questions asked and the scripted answer</th></tr></thead><tbody>
${hard.map((p) => `<tr><td class="bench"><b>${esc(p.task)}${p.after?.rerun ? ' <span>(rerun on the fixed code)</span>' : ''}</b><span>${esc(p.prompt)}</span></td><td>${esc(p.route)}</td>${passCell(p.after)}<td>${p.after?.avg ?? '—'} s${p.after?.why ? `<span class="q">${esc(p.after.why)}</span>` : ''}</td><td class="wrapc">${askedCell(p.after?.asked) || '<span style="color:var(--faint)">none</span>'}</td></tr>`).join('')}
</tbody></table></div></section>

<section id="requests"><h2>The 28 real requests, before and after</h2>
<p class="sub">Trigger words and blocked commands in throwaway copies of three folders (a code project, a plain folder, a Python project), everything auto-approved; Bonsai's questions get a scripted answer. Before is the rerun of 25 Sep morning.</p>
<div class="charts" id="chart-words"></div>
<div class="wrap"><table><thead><tr><th>#</th><th>Request</th><th>Before</th><th>After</th><th>Before</th><th>After</th><th class="sep">Change</th><th>Path after</th></tr></thead><tbody>
${words.map((w) => `<tr><td>${w.n}</td><td class="bench"><b>${esc(w.prompt)}${w.after.rerun ? ' <span>(rerun on the fixed code)</span>' : ''}</b><span>${esc(w.folder)} folder</span>${askedCell(w.after.asked)}${w.after.fails?.length ? `<span class="q" style="color:var(--down)">${esc(w.after.fails.join('; '))}</span>` : ''}</td><td class="${w.before?.ok ? 'ok' : 'bad'}">${w.before ? (w.before.ok ? 'OK' : 'fail') : '—'}</td><td class="${w.after.ok ? 'ok' : 'bad'}">${w.after.ok ? 'OK' : 'fail'}</td>${secsCells(w.before?.secs, w.after.secs)}${deltaCell(w.before?.secs, w.after.secs)}<td>${esc(w.after.route)}</td></tr>`).join('')}
<tr><td></td><td class="bench"><b>All 28</b></td><td class="ok">${wOk('before')} OK</td><td class="ok">${wOk('after')} OK</td>${secsCells(wSecs('before'), wSecs('after'))}${deltaCell(wSecs('before'), wSecs('after'))}<td></td></tr>
</tbody></table></div></section>

<section id="engine"><h2>Engine probes</h2>
<p class="sub">${esc(probes.note)}</p>
<div class="charts" id="chart-engine"></div>
<div class="wrap"><table><thead><tr><th>Several answers at once</th><th>Read tok/s</th><th>Write tok/s, all together</th><th>Seconds for 96 tokens each</th></tr></thead><tbody>
${probes.parallelDecode.rows.map((r, i) => `<tr><td class="bench"><b>${r.answersAtOnce} answer${r.answersAtOnce > 1 ? 's' : ''} at once</b></td><td>${r.readTps}</td><td class="${i === 0 ? 'best' : ''}">${r.writeTpsTotal}</td><td class="${i === 0 ? 'best' : ''}">${r.writeSecs}</td></tr>`).join('')}
</tbody></table></div>
<div class="notes"><p>${esc(probes.parallelDecode.verdict)}</p></div>
<div class="wrap" style="margin-top:14px"><table><thead><tr><th>Speculative decoding</th><th>Temperature</th><th>Seconds</th><th>Write tok/s</th><th>Drafted / accepted</th><th>Lines</th></tr></thead><tbody>
${probes.speculative.rows.map((r) => `<tr><td class="bench"><b>${esc(r.mode)}</b></td><td>${r.temp}</td><td>${r.secs}</td><td class="${r.mode === 'ngram-simple' ? 'best' : ''}">${r.writeTps}</td><td>${r.draft != null ? `${r.draft} / ${r.accepted}` : '—'}</td><td>${r.lines}</td></tr>`).join('')}
</tbody></table></div>
<div class="notes"><p>${esc(probes.speculative.task)}. ${esc(probes.speculative.verdict)}</p></div></section>

<section id="notes"><h2>Notes</h2><div class="notes">${NOTES.map((n, i) => `<p><sup>${i + 1}</sup> ${n}</p>`).join('')}</div></section>

<section class="foot" id="sources"><h3 style="color:var(--ink)">Where the numbers come from</h3><ul>
<li>Before: <code>models/bonsai-2-27b/results/night/2026-09-25/practice-off/summary.json</code> and <code>…/2026-09-25-rerun/words-real.json</code> (the night run and its morning rerun; results are kept on the Mac, not in git)</li>
<li>After: <code>${esc(dir.replace(root + '/', ''))}</code> — <code>practice-off/</code>, <code>practice-rerun/</code>, <code>words-real.json</code>, <code>words-real-rerun.json</code>, <code>probes.json</code></li>
<li>Checks: <code>zsh models/evals/tools/verify-tasks.sh</code> · tests: <code>bun run test</code> · this page: <code>node models/evals/reports/report-smart-stats.mjs</code></li></ul>
<p>Nothing on this page loads from the internet. Point at a bar to see its exact numbers.</p></section>
</main>
<script>
const DATA = ${JSON.stringify(DATA)};
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function niceStep(span, n) { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

// Horizontal bars, one row per item, one or two series (before, after). Thin
// marks with rounded ends, a 2px gap between a pair, hover title on each bar.
function bars(host, { from, title, rows, series, unit = ' s', cap, xLabel }) {
  const W = 560, L = 150, R = 20, T = 8, rowH = series.length > 1 ? 30 : 22, H = T + rows.length * rowH + 34;
  const max = arguments[1].max ?? Math.max(...rows.flatMap((r) => series.map((s) => r[s.key] ?? 0)));
  const step = niceStep(max, 4), x1 = Math.ceil(max / step) * step;
  const X = (v) => L + (v / x1) * (W - L - R);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
  for (let v = 0; v <= x1 + 1e-9; v += step) s += '<line class="grid" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + T + '" y2="' + (H - 30) + '"/><text x="' + X(v) + '" y="' + (H - 16) + '" text-anchor="middle">' + v + '</text>';
  s += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 3) + '" text-anchor="middle">' + esc(xLabel) + '</text>';
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    s += '<text class="lbl" x="' + (L - 8) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end">' + esc(r.label) + (r.mark ? ' <tspan style="fill:var(--down)">' + esc(r.mark) + '</tspan>' : '') + '</text>';
    series.forEach((sr, k) => {
      const v = r[sr.key];
      if (v == null) return;
      const bh = series.length > 1 ? 10 : 12, by = y + (rowH - (bh * series.length + 2 * (series.length - 1))) / 2 + k * (bh + 2);
      s += '<rect class="bar" x="' + L + '" y="' + by + '" width="' + Math.max(0, X(v) - L) + '" height="' + bh + '" fill="var(' + sr.color + ')"><title>' + esc(r.label) + ' · ' + esc(sr.name) + ': ' + v + unit + (r.note ? ' · ' + esc(r.note) : '') + '</title></rect>';
    });
  });
  s += '</svg>';
  const f = el('figure');
  if (from) f.appendChild(el('div', 'from', from));
  f.appendChild(el('h3', '', title));
  if (series.length > 1) { const lg = el('div', 'legend'); series.forEach((sr) => lg.appendChild(el('span', '', '<i style="background:var(' + sr.color + ')"></i>' + esc(sr.name)))); f.appendChild(lg); }
  f.insertAdjacentHTML('beforeend', s);
  if (cap) f.appendChild(el('figcaption', '', cap));
  document.getElementById(host).appendChild(f);
}
const S2 = [{ key: 'b', name: 'Before (night run)', color: '--c-before' }, { key: 'a', name: 'After (this round)', color: '--c-after' }];
const short = (t) => t.replace(/^\\d+-/, '');
const oldT = DATA.practice.filter((p) => p.n <= 18);
const half = (list) => [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))];
const pRow = (p) => ({ label: short(p.task), b: p.before?.avg, a: p.after?.avg, mark: p.after && !p.after.pass ? '✗' : '', note: p.route });
half(oldT).forEach((part, i) => bars('chart-practice', { from: 'models/evals/bench/run.mjs, thinking off', title: 'Seconds per practice task' + (i ? ', continued' : ''), xLabel: 'seconds', series: S2, max: Math.max(...oldT.flatMap((p) => [p.before?.avg ?? 0, p.after?.avg ?? 0])),
  cap: i ? 'Shorter is better. The fix tasks are unchanged; the questions vary by a few seconds run to run.' : 'Shorter is better. Rename tasks take 0 s (no model). The change tasks (json-flag, add-function, feature-currency) show the early stop: two tests and two drafts instead of three and four.', rows: part.map(pRow) }));
const hardT = DATA.practice.filter((p) => p.n >= 19);
bars('chart-hard', { from: 'models/evals/bench/run.mjs, thinking off', title: 'Seconds per harder task', xLabel: 'seconds', series: [{ key: 'a', name: 'After', color: '--c-after' }], cap: 'One run each. ✗ marks the one that fails (28: the existing test\\'s expected value has to change). The longest are the multi-file jobs and the real-sized project.',
  rows: hardT.map((p) => ({ label: short(p.task), a: p.after?.avg, mark: p.after && !p.after.pass ? '✗' : '', note: p.route })) });
// Seconds by path: before covers the 18 old tasks, after all 28.
const paths = ['question', 'rename', 'fix', 'change', 'other', 'step by step'];
const avgBy = (side, list) => paths.map((r) => { const rows = list.filter((p) => p[side] && p.route === r); return rows.length ? Math.round(rows.reduce((s, p) => s + p[side].avg, 0) / rows.length) : null; });
const bByPath = avgBy('before', oldT), aByPath = avgBy('after', oldT); // the same 18 tasks on both sides
bars('chart-hard', { from: 'models/evals/bench/run.mjs, the 18 old tasks', title: 'Average seconds by path', xLabel: 'seconds', series: S2, cap: 'How a request was handled, the same 18 tasks on both sides. The change path carries the early stop; questions and writing gained a few seconds from the check before "done".',
  rows: paths.map((r, i) => ({ label: r, b: bByPath[i], a: aByPath[i] })).filter((r) => r.b != null || r.a != null) });
const wRow = (w) => ({ label: '#' + w.n + ' ' + (w.prompt.length > 22 ? w.prompt.slice(0, 20) + '…' : w.prompt).replace(/\\n.*/s, ''), b: w.before?.secs, a: w.after.secs, mark: !w.after.ok ? '✗' : '', note: w.after.route });
half(DATA.words).forEach((part, i) => bars('chart-words', { from: 'models/evals/bench/words/real.mjs, auto-approved', title: 'Seconds per real request' + (i ? ', continued' : ''), xLabel: 'seconds', series: S2, max: Math.max(...DATA.words.flatMap((w) => [w.before?.secs ?? 0, w.after.secs])),
  cap: i ? 'The two before-failures (#16 rename broke the tests, #24 a pasted log became a fix) are gone; #26 in the plain folder now stops after one question instead of inventing a file.' : 'Shorter is better. Greetings drop from 39 and 95 s to 4 s; "api" (#8) asks first and answers in 44 s instead of 360 s of wrong work.', rows: part.map(wRow) }));
bars('chart-engine', { from: 'llama-batched-bench', title: 'Writing speed with several answers at once', xLabel: 'tokens per second, all answers together', unit: ' tok/s', series: [{ key: 'a', name: 'write tok/s', color: '--c-before' }], cap: DATA.probes.parallelDecode.verdict,
  rows: DATA.probes.parallelDecode.rows.map((r) => ({ label: r.answersAtOnce + ' at once', a: r.writeTpsTotal })) });
bars('chart-engine', { from: 'llama-server, a rewrite of export.mjs', title: 'Writing speed by speculative mode', xLabel: 'tokens per second', unit: ' tok/s', series: [{ key: 'a', name: 'write tok/s', color: '--c-after' }], cap: DATA.probes.speculative.verdict,
  rows: DATA.probes.speculative.rows.map((r) => ({ label: r.mode + ' · t ' + r.temp, a: r.writeTps, note: r.draft != null ? r.draft + ' drafted, ' + r.accepted + ' accepted' : '' })) });
// Two lines with dots across items (x = the item, y = seconds); after is drawn on top.
function lines(host, { from, title, rows, cap, yLabel = 'seconds', numbers = true }) {
  const W = 560, H = 300, L = 44, R = 14, T = 12, B = 46;
  const max = Math.max(...rows.flatMap((r) => [r.b ?? 0, r.a ?? 0]));
  const step = niceStep(max, 5), y1 = Math.ceil(max / step) * step;
  const X = (i) => L + (rows.length === 1 ? 0.5 : i / (rows.length - 1)) * (W - L - R);
  const Y = (v) => T + (1 - v / y1) * (H - T - B);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
  for (let v = 0; v <= y1 + 1e-9; v += step) s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 7) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end">' + v + '</text>';
  s += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
  rows.forEach((r, i) => { s += '<text x="' + X(i) + '" y="' + (H - B + 14) + '" text-anchor="middle" style="font-size:9.5px">' + esc(r.tick) + '</text>'; });
  s += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(rows[0].axis || 'task') + '</text>';
  s += '<text transform="translate(11 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">' + yLabel + '</text>';
  [['b', 'Before', '--c-before', false], ['a', 'After', '--c-after', true]].forEach(([k, name, col, lead]) => {
    const ps = rows.map((r, i) => ({ i, v: r[k], r })).filter((p) => p.v != null);
    s += '<polyline fill="none" stroke="var(' + col + ')" stroke-width="' + (lead ? 2.6 : 1.8) + '" stroke-linejoin="round" points="' + ps.map((p) => X(p.i) + ',' + Y(p.v)).join(' ') + '"/>';
    ps.forEach((p) => { s += '<circle cx="' + X(p.i) + '" cy="' + Y(p.v) + '" r="' + (lead ? 4.2 : 3.4) + '" fill="var(' + col + ')" stroke="var(--card)" stroke-width="1.5"><title>' + esc(p.r.label) + ' · ' + name + ': ' + p.v + ' s' + (p.r.note ? ' · ' + esc(p.r.note) : '') + '</title></circle>'; });
  });
  s += '</svg>';
  const f = el('figure');
  if (from) f.appendChild(el('div', 'from', from));
  f.appendChild(el('h3', '', title));
  const lg = el('div', 'legend'); lg.appendChild(el('span', '', '<i class="line" style="border-color:var(--c-before)"></i>Before (night run)')); lg.appendChild(el('span', '', '<i class="line" style="border-color:var(--c-after)"></i>After (this round)')); f.appendChild(lg);
  f.insertAdjacentHTML('beforeend', s);
  if (cap) f.appendChild(el('figcaption', '', cap));
  if (numbers) {
    const d = el('details', 'pts'); d.appendChild(el('summary', '', 'The numbers'));
    d.insertAdjacentHTML('beforeend', '<div class="wrap"><table><thead><tr><th></th>' + rows.map((r) => '<th>' + esc(r.tick) + '</th>').join('') + '</tr></thead><tbody>' +
      '<tr><td><span class="dot" style="background:var(--c-before);margin-right:6px"></span>Before</td>' + rows.map((r) => '<td>' + (r.b ?? '—') + '</td>').join('') + '</tr>' +
      '<tr><td><span class="dot" style="background:var(--c-after);margin-right:6px"></span>After</td>' + rows.map((r) => '<td' + (r.a != null && r.b != null && r.a < r.b ? ' style="font-weight:700"' : '') + '>' + (r.a ?? '—') + '</td>').join('') + '</tr></tbody></table></div>');
    f.appendChild(d);
  }
  document.getElementById(host).appendChild(f);
}
// A slope chart: each item is a line from its before dot (left) to its after dot (right).
function slope(host, { from, title, rows, cap, unit = ' s' }) {
  const W = 560, L = 170, R = 170, T = 16, B = 30, H = Math.max(240, 40 + rows.length * 26);
  const max = Math.max(...rows.flatMap((r) => [r.b, r.a]));
  const step = niceStep(max, 5), y1 = Math.ceil(max / step) * step;
  const Y = (v) => T + (1 - v / y1) * (H - T - B);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
  for (let v = 0; v <= y1 + 1e-9; v += step) s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>';
  s += '<text x="' + L + '" y="' + (H - 8) + '" text-anchor="middle" style="font-weight:600">Before</text><text x="' + (W - R) + '" y="' + (H - 8) + '" text-anchor="middle" style="font-weight:600">After</text>';
  // labels are nudged apart when two would sit on the same line
  const place = (items, key) => { const out = items.map((r) => ({ r, y: Y(r[key]) })).sort((a, b) => a.y - b.y); for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < 12) out[i].y = out[i - 1].y + 12; return new Map(out.map((o) => [o.r, o.y])); };
  const yb = place(rows, 'b'), ya = place(rows, 'a');
  rows.forEach((r) => {
    const better = r.a < r.b, same = r.a === r.b;
    const col = better ? 'var(--c-after)' : same ? 'var(--faint)' : 'var(--down)';
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(r.b) + '" y2="' + Y(r.a) + '" stroke="' + col + '" stroke-width="2" stroke-linecap="round"/>';
    s += '<circle cx="' + L + '" cy="' + Y(r.b) + '" r="4" fill="var(--c-before)" stroke="var(--card)" stroke-width="1.5"><title>' + esc(r.label) + ' · Before: ' + r.b + unit + '</title></circle>';
    s += '<circle cx="' + (W - R) + '" cy="' + Y(r.a) + '" r="4.2" fill="var(--c-after)" stroke="var(--card)" stroke-width="1.5"><title>' + esc(r.label) + ' · After: ' + r.a + unit + ' (' + (r.b ? Math.round(((r.a - r.b) / r.b) * 100) : 0) + '%)</title></circle>';
    s += '<text class="lbl" x="' + (L - 10) + '" y="' + (yb.get(r) + 3.5) + '" text-anchor="end">' + esc(r.label) + ' <tspan style="fill:var(--mute)">' + r.b + unit + '</tspan></text>';
    s += '<text x="' + (W - R + 10) + '" y="' + (ya.get(r) + 3.5) + '" style="fill:' + col + ';font-weight:600">' + r.a + unit + ' <tspan style="fill:var(--mute);font-weight:400">' + (r.b ? (r.a - r.b > 0 ? '+' : '') + Math.round(((r.a - r.b) / r.b) * 100) + '%' : '') + '</tspan></text>';
  });
  s += '</svg>';
  const f = el('figure');
  if (from) f.appendChild(el('div', 'from', from));
  f.appendChild(el('h3', '', title));
  const lg = el('div', 'legend'); lg.appendChild(el('span', '', '<i class="line" style="border-color:var(--c-after)"></i>got faster')); lg.appendChild(el('span', '', '<i class="line" style="border-color:var(--down)"></i>got slower')); f.appendChild(lg);
  f.insertAdjacentHTML('beforeend', s);
  if (cap) f.appendChild(el('figcaption', '', cap));
  document.getElementById(host).appendChild(f);
}

// Score against cost, as on the stats sheet: x = seconds (log), y = share of
// tasks done within that budget; one line per version, the lead one labelled.
const CURVE_STYLE = { before_off: ['--c-before', false], before_med: ['--c-third', false], before_high: ['--c-fourth', false], after_off: ['--c-after', false], after_all: ['--c-after', true] };
const budgetLabel = (b) => (b < 60 ? b + 's' : b % 60 ? (b / 60).toFixed(1) + 'm' : (b / 60) + 'm');
function logTicks(lo, hi) { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); } return out; }
function curves(host, { from, title, series, cap, lead = 'after_off', x = 'Time budget per task (seconds, log scale)', y = 'Tasks done within the budget (%)' }) {
  const W = 560, H = 300, L = 46, R = 14, T = 12, B = 40;
  const x0 = DATA.budgets[0] / 1.3, x1 = DATA.budgets[DATA.budgets.length - 1] * 1.3;
  const X = (v) => L + (Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0)) * (W - L - R);
  const Y = (v) => T + (1 - v / 100) * (H - T - B);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + '">';
  for (let v = 0; v <= 100; v += 20) s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (L - 7) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end">' + v + '</text>';
  DATA.budgets.forEach((v) => { s += '<line class="grid" x1="' + X(v) + '" x2="' + X(v) + '" y1="' + T + '" y2="' + (H - B) + '" stroke-dasharray="2 3"/><text x="' + X(v) + '" y="' + (H - B + 15) + '" text-anchor="middle">' + budgetLabel(v) + '</text>'; });
  s += '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
  s += '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + x + '</text><text transform="translate(11 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">' + y + '</text>';
  const order = [...series.filter(([k]) => k !== lead), ...series.filter(([k]) => k === lead)];
  order.forEach(([k, c]) => {
    const [col, dash] = CURVE_STYLE[k]; const isLead = k === lead;
    s += '<polyline fill="none" stroke="var(' + col + ')" stroke-width="' + (isLead ? 2.6 : 1.8) + '"' + (dash ? ' stroke-dasharray="5 4"' : '') + ' stroke-linejoin="round" points="' + c.pts.map((p) => X(p.b) + ',' + Y(p.pct)).join(' ') + '"/>';
    c.pts.forEach((p) => {
      s += '<circle cx="' + X(p.b) + '" cy="' + Y(p.pct) + '" r="' + (isLead ? 4.2 : 3.4) + '" fill="var(' + col + ')" stroke="var(--card)" stroke-width="1.5"><title>' + esc(c.name) + ' · within ' + budgetLabel(p.b) + ': ' + p.pct + '% (' + p.done + ' of ' + c.n + ')</title></circle>';
      if (isLead) s += '<text x="' + X(p.b) + '" y="' + (Y(p.pct) - 9) + '" text-anchor="middle" style="fill:var(' + col + ');font-weight:600;font-size:10px">' + budgetLabel(p.b) + '</text>';
    });
  });
  s += '</svg>';
  const f = el('figure');
  if (from) f.appendChild(el('div', 'from', from));
  f.appendChild(el('h3', '', title));
  const lg = el('div', 'legend'); series.forEach(([k, c]) => { const [col, dash] = CURVE_STYLE[k]; lg.appendChild(el('span', '', '<i class="line' + (dash ? ' dash' : '') + '" style="border-color:var(' + col + ')"></i>' + esc(c.name))); }); f.appendChild(lg);
  f.insertAdjacentHTML('beforeend', s);
  if (cap) f.appendChild(el('figcaption', '', cap));
  const d = el('details', 'pts'); d.open = true; d.appendChild(el('summary', '', 'The numbers'));
  let tb = '<div class="wrap"><table><thead><tr><th></th>' + DATA.budgets.map((b) => '<th>' + budgetLabel(b) + '</th>').join('') + '</tr></thead><tbody>';
  const best = DATA.budgets.map((b, i) => Math.max(...series.map(([, c]) => c.pts[i].pct)));
  series.forEach(([k, c]) => { tb += '<tr><td><span class="dot" style="background:var(' + CURVE_STYLE[k][0] + ');margin-right:6px"></span>' + esc(c.name) + '</td>' + c.pts.map((p, i) => '<td' + (p.pct === best[i] ? ' style="font-weight:700"' : '') + '>' + p.pct + '%<span class="c">' + p.done + ' of ' + c.n + '</span></td>').join('') + '</tr>'; });
  d.insertAdjacentHTML('beforeend', tb + '</tbody></table></div>');
  f.appendChild(d);
  document.getElementById(host).appendChild(f);
}
curves('chart-curves', { from: 'models/evals/bench/run.mjs · the 18 practice tasks', title: 'Practice tasks done within a time budget', series: DATA.curves.practice,
  cap: 'Each run counts once (the night run did each task twice per level). The blue, green and yellow lines are the night run at thinking off, medium and high: more thinking cost time and won nothing. The orange line is this round: it reaches every task sooner. The dashed orange line adds the ten harder tasks, which take longer because they do more.' });
curves('chart-curves', { from: 'models/evals/bench/words/real.mjs · the 28 real requests', title: 'Real requests done within a time budget', series: DATA.curves.words,
  cap: 'A request counts as done when its checks passed (nothing changed that should not, blocked commands refused, tests still pass). Before, two requests never passed and four ran into the six-minute limit; after, all 28 pass, 16 of them inside a minute.' });

lines('chart-lines', { from: 'models/evals/bench/run.mjs, thinking off', title: 'The 18 practice tasks', cap: 'One dot per task, in task order. The orange line sits under the blue one on the change tasks (1, 12, 14) and on top of it on the writing tasks (16-18), where the loop now checks its own work before saying done.',
  rows: oldT.map((p) => ({ tick: String(p.n), label: p.task, b: p.before?.avg, a: p.after?.avg, note: p.route, axis: 'task number' })) });
lines('chart-lines', { from: 'models/evals/bench/words/real.mjs, auto-approved', title: 'The 28 real requests', cap: 'The blue peaks are the requests that used to wander: greetings (#1, #2), "api" (#8), "fix the test" (#15), the pasted log (#24) and the plain-folder "fix the bug" (#27). The orange line stays under them.',
  rows: DATA.words.map((w) => ({ tick: String(w.n), label: '#' + w.n + ' ' + w.prompt.split('\\n')[0], b: w.before?.secs, a: w.after.secs, note: w.after.route, axis: 'request number' })) });
slope('chart-lines', { from: 'models/evals/bench/run.mjs, the 18 old tasks', title: 'Average seconds by path', cap: 'The same 18 tasks on both sides. The change path got faster (two tests and two drafts instead of three and four); the writing and question tasks pay a few seconds for the check before "done" and the project map.',
  rows: paths.map((r, i) => ({ label: r, b: bByPath[i], a: aByPath[i] })).filter((r) => r.b != null && r.a != null) });
const wins = DATA.words.filter((w) => w.before && w.before.secs >= 90).map((w) => ({ label: '#' + w.n + ' ' + (w.prompt.length > 20 ? w.prompt.slice(0, 18) + '…' : w.prompt).split('\\n')[0], b: w.before.secs, a: w.after.secs }));
slope('chart-lines', { from: 'models/evals/bench/words/real.mjs', title: 'The requests that took 90 s or more before', cap: 'Every request that used to take a minute and a half or more, before → after. The two that got slower (#9 notes, #22 commit) now ask a question or check their own work first.',
  rows: wins });

</script></body></html>`;

const out = docsPath('tests/bonsai-smart-2026-09-25.html');
const v1 = docsPath('older versions/bonsai-smart-2026-09-25-v1.html');
if (existsSync(out) && !existsSync(v1) && !readFileSync(out, 'utf8').includes('the full stats')) copyFileSync(out, v1);
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
