// Builds terminal/docs/bonsai-code-built.html: the real app's screens (captured
// from real runs), measured numbers, the practice scorecard, keys and limits.
//   node terminal/scripts/report.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';
const MODEL_NAME = MODELS[DEFAULT_MODEL].name;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const measured = JSON.parse(readFileSync(join(root, 'scripts', 'measured.json'), 'utf8'));

// The scorecard's two columns come from the runs named in measured.json
// (thinking off from one run, thinking on from another), else the latest run.
const resultsDir = join(root, '..', 'models', 'bonsai-2-27b', 'results', 'runs');
const runs = readdirSync(resultsDir).filter((d) => existsSync(join(resultsDir, d, 'summary.json'))).sort();
const load = (d) => JSON.parse(readFileSync(join(resultsDir, d, 'summary.json'), 'utf8')).results;
const offRun = measured.runOff ?? runs.at(-1);
const onRun = measured.runOn ?? runs.at(-1);
const summary = { results: [...load(offRun).filter((r) => !r.thinking), ...load(onRun).filter((r) => r.thinking)] };
const tasks = [...new Set(summary.results.map((r) => r.task))];
const TASK_NAMES = {
  '1-json-flag': 'Add a --json flag and a test',
  '2-fix-bug': 'Find and fix a bug (median)',
  '3-add-function': 'Add titleCase() with a test',
  '4-rename': 'Rename a function in 2 files',
  '5-question': 'Answer: which port, set where?',
};
const pick = (task, thinking) => summary.results.filter((r) => r.task === task && r.thinking === thinking);
const all = (thinking) => summary.results.filter((r) => r.thinking === thinking);
const score = (thinking) => all(thinking).filter((r) => r.pass).length;
const avgTask = (thinking) => { const rs = all(thinking); return rs.length ? Math.round(rs.reduce((s, r) => s + r.secs, 0) / rs.length) : 0; };

const captures = {};
for (const layout of ['classic', 'live']) {
  const f = join(root, 'scripts', `capture-${layout}${process.env.REPORT_FAKE ? '-fake' : ''}.json`);
  if (existsSync(f)) captures[layout] = JSON.parse(readFileSync(f, 'utf8'));
}

// One cell per task: a mark per attempt, how many passed, the average time.
const cell = (rs) => {
  if (!rs.length) return '<td>—</td>';
  const passed = rs.filter((r) => r.pass).length;
  const marks = rs.map((r) => `<i class="${r.pass ? 'ok' : 'no'}" title="${esc(r.pass ? `passed in ${r.secs}s` : `${r.why} (${r.secs}s)`)}">${r.pass ? '✓' : '✗'}</i>`).join('');
  const why = rs.find((r) => !r.pass)?.why;
  return `<td><b class="marks">${marks}</b><span>${passed} of ${rs.length} · about ${Math.round(rs.reduce((x, r) => x + r.secs, 0) / rs.length)}s each${why && !passed ? ` · ${esc(why)}` : ''}</span></td>`;
};
const rows = tasks.map((t) => `<tr><th>${esc(TASK_NAMES[t] ?? t)}</th>${cell(pick(t, false))}${cell(pick(t, true))}</tr>`).join('');

const MOMENTS = [['working', 'While it works'], ['asking', 'Asking you'], ['done', 'Done']];
const screens = JSON.stringify(Object.fromEntries(Object.entries(captures).map(([k, v]) => [k, v.screens])));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bonsai Code · built</title>
<style>
  :root { --page:#f3f3f1; --ink:#1d1d1f; --muted:#6b6b70; --line:#d9d9d6; --card:#fff; --accent:#3f8f3f; --soft:#e4f1e1; --chip:#ecece9; --ok:#2e7d32; --no:#b3261e; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --accent:#87d787; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; --no:#ff8a80; } }
  * { box-sizing: border-box; }
  html, body { margin:0; background:var(--page); color:var(--ink); }
  body { font:14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1120px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:-.01em; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:28px 0 10px; }
  .sub { color:var(--muted); margin:0 0 14px; }
  code { font:12.5px ui-monospace, "SF Mono", Menlo, monospace; background:var(--chip); padding:1px 5px; border-radius:4px; }
  .start { display:inline-block; font:15px ui-monospace, "SF Mono", Menlo, monospace; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:6px 12px; }
  .bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:10px; }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .seg button { font:inherit; border:0; background:var(--card); color:var(--muted); padding:6px 12px; cursor:pointer; }
  .seg button[aria-pressed="true"] { background:var(--soft); color:var(--ink); font-weight:600; }
  .win { border-radius:10px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.4); width:max-content; max-width:100%; margin:0 auto; }
  .tb { height:28px; background:#2d2d2f; display:flex; align-items:center; padding:0 10px; position:relative; }
  .tb i { display:inline-block; width:12px; height:12px; border-radius:50%; margin-right:8px; }
  .tb i:nth-child(1){background:#ff5f57} .tb i:nth-child(2){background:#febc2e} .tb i:nth-child(3){background:#28c840}
  .tb span { position:absolute; left:0; right:0; text-align:center; color:#a8a8ab; font-size:12.5px; }
  .screen { background:#171717; color:#fff; color-scheme:dark; padding:3px 5px; font:11px/13px "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; white-space:pre; width:calc(155ch + 10px); height:calc(43 * 13px + 6px); overflow:auto; }
  .screen div { height:13px; } .screen .g { display:inline-block; width:1ch; text-align:center; overflow:visible; }
  .note { color:var(--muted); font-size:12.5px; }
  .stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .stat b { display:block; font-size:22px; letter-spacing:-.01em; } .stat span { color:var(--muted); font-size:12.5px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:8px 12px; border-top:1px solid var(--line); vertical-align:top; }
  thead th { border-top:0; color:var(--muted); font-weight:600; font-size:12.5px; }
  td b { display:block; } td span { color:var(--muted); font-size:12px; }
  .marks i { font-style:normal; margin-right:4px; } .marks i.ok { color:var(--ok); } .marks i.no { color:var(--no); }
  tfoot th, tfoot td { font-weight:600; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .card ul { margin:0; padding-left:18px; } .card li { margin:3px 0; }
  .keys td, .keys th { padding:5px 10px; font-size:13px; } .keys th { width:34%; font-weight:500; }
  @media (max-width:760px) { .stats, .cols { grid-template-columns:1fr 1fr; } }
</style>
</head>
<body>
<main>
  <h1>Bonsai Code is built</h1>
  <p class="sub">Your Claude Code–style coding agent, running ${esc(MODEL_NAME)} on this Mac. Nothing leaves the machine.</p>
  <span class="start">cd any/project &nbsp;→&nbsp; bonsai</span>

  <h2>The real app, with the real model</h2>
  ${Object.keys(captures).length ? `
  <div class="bar">
    <span class="seg" id="layouts">${Object.keys(captures).map((k, i) => `<button data-v="${k}" aria-pressed="${i === 0}">${k === 'live' ? 'Live thinking' : 'Classic'}</button>`).join('')}</span>
    <span class="seg" id="moments">${MOMENTS.map(([k, label], i) => `<button data-v="${k}" aria-pressed="${i === 0}">${label}</button>`).join('')}</span>
    <span class="note">ctrl+l switches layouts in the app · captured ${esc(new Date(Object.values(captures)[0].capturedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</span>
  </div>
  <div class="win"><div class="tb"><i></i><i></i><i></i><span>bonsai — demo-project — 155×43</span></div><div class="screen" id="screen"></div></div>
  <p class="note" style="text-align:center">Real screens from real runs: the installed app, ${esc(MODEL_NAME)} on your M4, asked to “${esc(Object.values(captures)[0].task)}”. Each question was answered Yes.</p>
  <div class="card" id="capnote" style="margin-top:8px"></div>` : '<p class="note">(No captures yet.)</p>'}

  <h2>Measured on your Mac</h2>
  <div class="stats">
    <div class="stat"><b>${measured.writeTps} tok/s</b><span>writing (llama-bench); about ${measured.writeTpsInUse} in real use</span></div>
    <div class="stat"><b>${measured.readTps} tok/s</b><span>reading a prompt</span></div>
    <div class="stat"><b>${measured.memoryGb} GB</b><span>memory at 32k context (drops to 16k when short)</span></div>
    <div class="stat"><b>${measured.startSecs} s</b><span>model start, plus a few seconds to warm the cache</span></div>
  </div>

  <h2>Practice tasks: thinking off vs on</h2>
  <table>
    <thead><tr><th>Task (real project, real check)</th><th>Thinking off</th><th>Thinking on</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Passed</th><td>${score(false)} of ${all(false).length} attempts · about ${avgTask(false)}s per task</td><td>${score(true)} of ${all(true).length} attempts · about ${avgTask(true)}s per task</td></tr></tfoot>
  </table>
  <p class="note">${esc(measured.verdict)}</p>

  <h2>What's in it</h2>
  <div class="cols">
    <div class="card"><ul>
      <li>Claude Code's flow: welcome box, <code>⏺ Tool(arg)</code> / <code>⎿</code> result lines, red/green diffs, a plan list, the spinner, the input box.</li>
      <li>Asks before every edit and command: Yes · Yes for this session · No and say what instead.</li>
      <li>Always blocked: <code>rm -rf</code>, <code>sudo</code>, <code>git push</code>, <code>git reset --hard</code>, <code>kill</code>/<code>pkill</code>, stopping services.</li>
      <li>Starts and stops the model itself; restarts it if it crashes.</li>
      <li>Saves every conversation: <code>bonsai -c</code> or <code>/resume</code>.</li>
      <li>Built for a small model: forgiving tools, loop and repeat guards, a thinking budget, memory trimming.</li>
    </ul></div>
    <div class="card"><table class="keys">
      <tr><th>ctrl+l</th><td>switch Classic / Live thinking</td></tr>
      <tr><th>shift+tab</th><td>ask first → accept edits → plan</td></tr>
      <tr><th>esc</th><td>stop · twice clears the prompt</td></tr>
      <tr><th>ctrl+o</th><td>show the last thinking or output in full</td></tr>
      <tr><th>/ · @ · ! · ?</th><td>commands · attach a file · run a shell command · shortcuts</td></tr>
      <tr><th>/think /compact /init</th><td>thinking on/off · free memory · write AGENTS.md</td></tr>
      <tr><th>ctrl+c twice</th><td>quit (saved)</td></tr>
    </table></div>
  </div>

  <h2>Honest limits</h2>
  <div class="card"><ul>${measured.limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>

  <h2>Checked</h2>
  <div class="card"><ul>${measured.checks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
  <p class="note">Code: ~/Desktop/bonsai-code · model and runtime: ~/.bonsai-code · command: ~/.local/bin/bonsai</p>
</main>
<script>
(() => {
  const screens = ${screens};
  const notes = ${JSON.stringify(measured.captureNotes ?? {})};
  const el = document.getElementById('screen');
  if (!el) return;
  let layout = Object.keys(screens)[0], moment = 'working';
  const show = () => {
    const s = screens[layout] || {};
    el.innerHTML = s[moment] || '<div>(This run never reached this moment: see the note below.)</div>';
    const n = document.getElementById('capnote'); if (n) n.textContent = notes[layout] || '';
    el.scrollTop = el.scrollHeight;
    for (const b of document.querySelectorAll('#layouts button')) b.setAttribute('aria-pressed', String(b.dataset.v === layout));
    for (const b of document.querySelectorAll('#moments button')) b.setAttribute('aria-pressed', String(b.dataset.v === moment));
  };
  document.querySelectorAll('#layouts button').forEach((b) => b.onclick = () => { layout = b.dataset.v; show(); });
  document.querySelectorAll('#moments button').forEach((b) => b.onclick = () => { moment = b.dataset.v; show(); });
  show();
})();
</script>
</body>
</html>
`;
const target = process.env.REPORT_OUT ?? join(root, 'docs', 'bonsai-code-built.html');
writeFileSync(target, html);
console.log(`wrote ${target} (${(html.length / 1024).toFixed(0)} KB)`);
