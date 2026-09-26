// Builds bonsai-code-27b-report.html in the DOCS folder: the switch to Bonsai 2 27B
// (step 2) with the real app's screens, captured from real runs.
//   node models/evals/reports/report-27b.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL } from '../../index.mjs';
import { docsPath } from '../../../docs/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const model = MODELS[DEFAULT_MODEL];

const captures = {};
for (const layout of ['classic', 'live']) {
  const f = join(root, 'terminal', 'scripts', `capture-${layout}.json`);
  if (existsSync(f)) captures[layout] = JSON.parse(readFileSync(f, 'utf8'));
}
const MOMENTS = [['working', 'While it works'], ['asking', 'Asking you'], ['done', 'Done']];
const screens = JSON.stringify(Object.fromEntries(Object.entries(captures).map(([k, v]) => [k, v.screens])));
const capNotes = Object.fromEntries(Object.entries(captures).map(([k, v]) => [k, `${k === 'live' ? 'Live thinking' : 'Classic'}: the whole task took ${Math.round(v.secs / 60)} min ${v.secs % 60} s, including starting the model; export.mjs ${v.changed ? 'got the --json flag' : 'was NOT changed'}.`]));

// The 5 old practice tasks. Round 1 and the 8B round 2 check are from the
// handoff page (bonsai-code-progress.html); the 27B runs are from 24 Sep.
const TASKS = [
  ['Add a --json flag and a test', 'never (0 of 9)', '✓ 51 s', ['✓', 166], ['✓', 141]],
  ['Find and fix a bug (median)', 'never (0 of 9)', '✓ 12 s', ['✓', 37], ['✓', 33]],
  ['Add titleCase() with a test', 'never (0 of 9)', 'passed in some runs, not others', ['✓', 131], ['✓', 95]],
  ['Rename a function in 2 files', '2 of 3', '✓ instant', ['✓', 0], ['✓', 0]],
  ['Answer: which port, set where?', '3 of 3', '✓', ['✓', 48], ['✓', 52]],
];
const secs = (n) => (n === 0 ? 'instant (no model)' : n < 60 ? `${n} s` : `${Math.floor(n / 60)} min ${n % 60} s`);
const rows = TASKS.map(([t, r1, r2, a, b]) => `<tr><th>${esc(t)}</th><td class="old">${esc(r1)}</td><td class="old">${esc(r2)}</td><td><b class="ok">${a[0]}</b> ${secs(a[1])}</td><td><b class="ok">${b[0]}</b> ${secs(b[1])}</td></tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bonsai Code · 27B</title>
<style>
  :root { --page:#f3f3f1; --ink:#1d1d1f; --muted:#6b6b70; --line:#d9d9d6; --card:#fff; --accent:#3f8f3f; --soft:#e4f1e1; --chip:#ecece9; --ok:#2e7d32; --no:#b3261e; --warn:#a15c00; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --accent:#87d787; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; --no:#ff8a80; --warn:#ffb74d; } }
  :root[data-theme="dark"] { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --accent:#87d787; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; --no:#ff8a80; --warn:#ffb74d; }
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
  .winwrap { overflow-x:auto; padding:6px 0 18px; }
  .win { border-radius:10px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.4); width:max-content; margin:0 auto; }
  .tb { height:28px; background:#2d2d2f; display:flex; align-items:center; padding:0 10px; position:relative; }
  .tb i { display:inline-block; width:12px; height:12px; border-radius:50%; margin-right:8px; }
  .tb i:nth-child(1){background:#ff5f57} .tb i:nth-child(2){background:#febc2e} .tb i:nth-child(3){background:#28c840}
  .tb span { position:absolute; left:0; right:0; text-align:center; color:#a8a8ab; font-size:12.5px; }
  .screen { background:#171717; color:#fff; color-scheme:dark; padding:3px 5px; font:11px/13px "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; white-space:pre; width:calc(155ch + 10px); height:calc(43 * 13px + 6px); overflow:auto; }
  .screen div { height:13px; } .screen .g { display:inline-block; width:1ch; text-align:center; overflow:visible; }
  .note { color:var(--muted); font-size:12.5px; }
  .stats { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .stat b { display:block; font-size:22px; letter-spacing:-.01em; } .stat span { color:var(--muted); font-size:12.5px; }
  .tw { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:8px 12px; border-top:1px solid var(--line); vertical-align:top; }
  thead th { border-top:0; color:var(--muted); font-weight:600; font-size:12.5px; }
  td.old { color:var(--muted); }
  b.ok { color:var(--ok); }
  .cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .card h3 { font-size:13.5px; margin:0 0 6px; }
  .card ul { margin:0; padding-left:18px; } .card li { margin:4px 0; }
  .keys td, .keys th { padding:5px 10px; font-size:13px; } .keys th { width:34%; font-weight:500; }
  @media (max-width:760px) { .stats, .cols { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } .cols { grid-template-columns:minmax(0,1fr); } }
</style>
</head>
<body>
<main>
  <h1>Bonsai Code now runs ${esc(model.name)}</h1>
  <p class="sub">Step 2 of the switch, done 24 Sep 2026. The 8B and its code are gone; the <code>bonsai</code> command is rebuilt and reinstalled. Nothing is committed (there is no git repo); the old source is backed up.</p>
  <span class="start">cd any/project &nbsp;→&nbsp; bonsai</span>

  <h2>How the terminal looks</h2>
  ${Object.keys(captures).length ? `
  <div class="bar">
    <span class="seg" id="layouts">${Object.keys(captures).map((k, i) => `<button data-v="${k}" aria-pressed="${i === 0}">${k === 'live' ? 'Live thinking' : 'Classic'}</button>`).join('')}</span>
    <span class="seg" id="moments">${MOMENTS.map(([k, label], i) => `<button data-v="${k}" aria-pressed="${i === 0}">${label}</button>`).join('')}</span>
    <span class="note">ctrl+l switches layouts in the app · captured ${esc(new Date(Object.values(captures)[0].capturedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}</span>
  </div>
  <div class="winwrap"><div class="win"><div class="tb"><i></i><i></i><i></i><span>bonsai — demo-project — 155×43</span></div><div class="screen" id="screen"></div></div></div>
  <p class="note" style="text-align:center">Real screens, not a mock-up: the installed <code>bonsai</code>, ${esc(model.name)} on your M4, in a 155×43 terminal, asked to “${esc(Object.values(captures)[0].task)}”. Each question was answered Yes.</p>
  <p class="note" id="capnote" style="text-align:center"></p>` : '<p class="note">(No captures yet.)</p>'}

  <h2>Where it stands</h2>
  <div class="stats">
    <div class="stat"><b>5 of 5, twice</b><span>the old practice tasks on the real 27B, through the new paths (round 1 on the 8B: 5 of 15 attempts)</span></div>
    <div class="stat"><b>72 of 72</b><span>automated tests (60 before + 12 new); the terminal tests also pass against the installed program</span></div>
    <div class="stat"><b>9.3 GB</b><span>memory at 32k, and it stays there (the server's defaults grew past 16 GB in a session)</span></div>
    <div class="stat"><b>10.4 · 61</b><span>tokens a second writing · reading (the 8B: 31–38 · 233)</span></div>
  </div>

  <h2>The practice tasks</h2>
  <div class="tw"><table>
    <thead><tr><th>Task (real project, real check)</th><th>Round 1 · 8B, step by step</th><th>Round 2 · 8B, first check</th><th>27B · server defaults</th><th>27B · memory capped (as installed)</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th>Passed</th><td class="old">5 of 15 attempts</td><td class="old">4 of 5</td><td><b class="ok">5 of 5</b> · 6 min 22 s</td><td><b class="ok">5 of 5</b> · 5 min 21 s</td></tr></tfoot>
  </table></div>
  <p class="note">Thinking off, as installed. Also checked end to end: the installed <code>bonsai -p</code> answered the port question correctly in 53 s and stopped its model afterwards. The 27B is slower per task than the 8B was when the 8B got it right (2 min 21 s against 51 s for the --json task), but it got every one right.</p>

  <h2>What changed</h2>
  <div class="cols">
    <div class="card"><h3>Your three picks</h3><ul>
      <li><b>Thinking off by default;</b> <code>/think</code> (or <code>--think</code>) turns on PrismML's "medium", which thought about 200 tokens on a small task.</li>
      <li><b>Files over 80 lines:</b> a try rewrites only the one function that changes. The model still reads files up to 300 lines whole, so it knows the names around it. If changing that one function never passes, it works step by step instead.</li>
      <li><b>27B only, reinstalled:</b> the 8B entry, its chat template and its template file are removed.</li>
    </ul></div>
    <div class="card"><h3>What I decided without asking</h3><ul>
      <li><b>Capped the server's saved states</b> (4 checkpoints, no store of old prompts). With its defaults the 27B's server took 9 GB of extra memory within 13 prompts. Capped, it stays around 2 GB, and a try still skips re-reading its shared start (540 of 2,049 tokens re-read).</li>
      <li><b>The model's own chat template</b> instead of a custom one: it already handles tool calls and the thinking switch.</li>
      <li><b>No "presence penalty"</b> (PrismML suggests 1.5): it pushes the model away from repeating words, and code repeats names and brackets. These are the settings the real jobs passed with.</li>
      <li><b>Thinking stops at 2,048 tokens</b> (about 3 min); checked with a tiny cap of 40, which stopped at 42.</li>
      <li><b>When a failure doesn't point inside a function,</b> the model picks the function from a list (a forced-JSON answer) instead of giving up.</li>
      <li><b>Safety:</b> a whole-file reply isn't pasted into a function; a garbled tool call is stored as <code>{}</code> so the conversation can't break; the practice runner allows 15 min per task (was 6).</li>
    </ul></div>
  </div>

  <h2>Good to know</h2>
  <div class="cols">
    <div class="card"><ul>
      <li><b>Memory:</b> about 9.3 GB at 32k. When less is free (for example with the desk servers running), it uses 16k and says so, and suggests closing other apps when even that is tight.</li>
      <li><b>Speed:</b> a one-function try is under a minute; the change path (test first, drafts, then the change) took 1½–2½ min on these small projects.</li>
      <li><b>Not committed:</b> there is no git repo. The source from before the switch is in <code>bonsai-code/backups/2026-09-24-before-27b.tar.gz</code>.</li>
      <li><b>Round 1's screens are kept</b> as <code>terminal/scripts/capture-*-8b-round1.json</code>; round 1's report is unchanged.</li>
      <li><b>In these captures only 6–7 GB was free,</b> so it used 16k and said so (the orange line). The Live thinking meter showed 8.4 GB in use, and the task still finished in about 3 minutes.</li>
      <li><b>A rough edge I found:</b> when a small file is rewritten whole, the diff can show more lines as changed than really changed (see "Done"), because it only trims matching lines from the top and bottom. This was already there in round 2; a proper line-by-line diff is a small fix.</li>
    </ul></div>
    <div class="card"><h3>Still to do (from the handoff page)</h3><ul>
      <li>10 more practice tasks (15 in all, 3 per path).</li>
      <li>The full measurement: 15 tasks × 3 runs. The "before" column will be round 1's recorded 8B numbers, since the 8B can't be re-run.</li>
      <li>The final report page with those numbers; the README's round 2 notes are already in.</li>
    </ul></div>
  </div>

  <h2>Keys</h2>
  <div class="card"><table class="keys">
    <tr><th>ctrl+l</th><td>switch Classic / Live thinking</td></tr>
    <tr><th>shift+tab</th><td>ask first → accept edits → plan</td></tr>
    <tr><th>esc</th><td>stop · twice clears the prompt</td></tr>
    <tr><th>ctrl+o</th><td>show the last thinking or output in full</td></tr>
    <tr><th>/ · @ · ! · ?</th><td>commands · attach a file · run a shell command · shortcuts</td></tr>
    <tr><th>/think /model /doctor</th><td>thinking off or "medium" · which model and memory · check the setup</td></tr>
    <tr><th>ctrl+c twice</th><td>quit (the conversation is saved)</td></tr>
  </table></div>
  <p class="note">Code: ~/Desktop/bonsai-code · model and runtime: ~/.bonsai-code · command: ~/.local/bin/bonsai · model file: ${esc(model.file)} (${(model.bytes / 1e9).toFixed(2)} GB)</p>
</main>
<script>
(() => {
  const screens = ${screens};
  const notes = ${JSON.stringify(capNotes)};
  const el = document.getElementById('screen');
  if (!el) return;
  let layout = Object.keys(screens)[0], moment = 'working';
  const show = () => {
    const s = screens[layout] || {};
    el.innerHTML = s[moment] || '<div>(This run never reached this moment.)</div>';
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
const target = process.env.REPORT_OUT ?? docsPath('reports/bonsai-code-27b-report.html');
writeFileSync(target, html);
console.log(`wrote ${target}`);
