// Builds terminal/docs/bonsai-code-report-2026-09-25.html: tonight's round (faster
// start, /model, the "/" menu, the box at the bottom, the app icon) with the
// real app's screens captured from real runs.
//   node terminal/scripts/report-ui.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL } from '../../models/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const model = MODELS[DEFAULT_MODEL];
const load = (f) => (existsSync(join(root, 'scripts', f)) ? JSON.parse(readFileSync(join(root, 'scripts', f), 'utf8')) : null);
const ui = load('capture-ui.json');
const task = { classic: load('capture-classic.json'), live: load('capture-live.json') };
const icon = readFileSync(join(root, 'app', 'icon-1024.png')).toString('base64');
const when = (c) => (c ? new Date(c.capturedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const UI_MOMENTS = [['starting', 'Starting'], ['slash', '"/" menu'], ['model', '/model'], ['hello', 'First reply']];
const TASK_MOMENTS = [['working', 'While it works'], ['asking', 'Asking you'], ['done', 'Done']];
const viewer = (id, layouts, moments) => `
  <div class="bar">
    ${layouts.length > 1 ? `<span class="seg" data-g="${id}" data-k="layout">${layouts.map((k, i) => `<button data-v="${k}" aria-pressed="${i === 0}">${k === 'live' ? 'Live thinking' : 'Classic'}</button>`).join('')}</span>` : ''}
    <span class="seg" data-g="${id}" data-k="moment">${moments.map(([k, label], i) => `<button data-v="${k}" aria-pressed="${i === 0}">${label}</button>`).join('')}</span>
  </div>
  <div class="winwrap"><div class="win"><div class="tb"><i></i><i></i><i></i><span>bonsai — demo-project — 155×43</span></div><div class="screen" id="${id}"></div></div></div>`;

const screens = {
  ui: ui ? { classic: ui.screens } : {},
  task: Object.fromEntries(Object.entries(task).filter(([, v]) => v).map(([k, v]) => [k, v.screens])),
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bonsai Code · 25 Sep</title>
<style>
  :root { --page:#f3f3f1; --ink:#1d1d1f; --muted:#6b6b70; --line:#d9d9d6; --card:#fff; --accent:#2f8a4c; --soft:#e4f1e1; --chip:#ecece9; --ok:#2e7d32; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --accent:#87d787; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; } }
  :root[data-theme="dark"] { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --accent:#87d787; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; }
  * { box-sizing: border-box; }
  html, body { margin:0; background:var(--page); color:var(--ink); }
  body { font:14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1120px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:-.01em; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:28px 0 10px; }
  h3 { font-size:14px; margin:0 0 6px; }
  .sub { color:var(--muted); margin:0 0 14px; }
  code { font:12.5px ui-monospace, "SF Mono", Menlo, monospace; background:var(--chip); padding:1px 5px; border-radius:4px; }
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
  td.old { color:var(--muted); } b.ok { color:var(--ok); }
  .cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .card ul { margin:0; padding-left:18px; } .card li { margin:4px 0; }
  .app { display:flex; gap:20px; align-items:center; }
  .app img { width:112px; height:112px; flex:none; }
  @media (max-width:760px) { .stats { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } .cols { grid-template-columns:minmax(0,1fr); } .app { flex-direction:column; align-items:flex-start; } }
</style>
</head>
<body>
<main>
  <h1>Bonsai Code: a fast start, /model, the "/" menu and an app icon</h1>
  <p class="sub">25 Sep 2026, on ${esc(model.name)}. Everything is in <code>~/Desktop/bonsai-code</code>, saved there as a local git commit (nothing pushed).</p>

  <div class="card app">
    <img alt="Bonsai Code app icon" src="data:image/png;base64,${icon}">
    <div>
      <h3>Bonsai Code.app</h3>
      <p style="margin:0 0 6px">In the <code>bonsai-code</code> folder, like XMR Miner.app. Drag it to the Dock. Double-click: it asks which project folder (starting at the last one you used) and opens Terminal there with <code>bonsai</code>. Or drop a folder on the icon to open it straight away.</p>
      <p class="note" style="margin:0">Rebuild it with <code>app/make-app.sh</code>; the icon is <code>app/icon.svg</code> (a bonsai in a pot with a <code>&gt;_</code> prompt, on a green disc).</p>
    </div>
  </div>

  <h2>New screens</h2>
  ${ui ? `${viewer('ui', ['classic'], UI_MOMENTS)}<p class="note" style="text-align:center">Real screens: the installed <code>bonsai</code> with ${esc(model.name)}, captured ${esc(when(ui))}. Starting restored the saved warm-up; the box sits at the bottom from the start.</p>` : '<p class="note">(No captures.)</p>'}

  <h2>The whole task, both layouts</h2>
  ${Object.keys(screens.task).length ? `${viewer('task', Object.keys(screens.task), TASK_MOMENTS)}<p class="note" style="text-align:center">“${esc(Object.values(task).find(Boolean).task)}”, answering Yes to each question. Captured ${esc(when(Object.values(task).find(Boolean)))}.</p>` : ''}

  <h2>Where it stands</h2>
  <div class="stats">
    <div class="stat"><b>~11 s</b><span><code>bonsai -p "hello"</code> from a cold start once the warm-up is saved (93 s the very first time)</span></div>
    <div class="stat"><b>82 of 82</b><span>automated tests (72 before + 10 new); 7 deliberate breaks, all caught</span></div>
    <div class="stat"><b>5 of 5</b><span>practice tasks on the real 27B, a third time, now with two slots</span></div>
    <div class="stat"><b>9.6 GB</b><span>peak memory in that run (7.2 GB model + 2.4 GB working)</span></div>
  </div>

  <h2>Why it said "Starting" so long, and now</h2>
  <div class="tw"><table>
    <thead><tr><th></th><th>Before</th><th>Now</th></tr></thead>
    <tbody>
      <tr><th>Reading its instructions at start</th><td class="old">every start: 1,616 tokens, ~27 s</td><td>the first time only (~26 s), then saved to disk: later starts restore it in 0.1 s and read just this project's details (~40 tokens, ~1.5 s)</td></tr>
      <tr><th>"hello"</th><td class="old">the model was asked to sort it, which wiped the instructions: another ~26 s</td><td>greetings skip sorting; sorting also has its own slot now, so it never wipes the conversation (2.3 s measured)</td></tr>
      <tr><th>What the screen says</th><td class="old">Starting Bonsai 2 27B… (20s)</td><td>… loading the model / reading its instructions, about 30 s the first time / restoring its instructions from last time; a queued message says it sends as soon as the model is ready</td></tr>
      <tr><th>The question practice task</th><td class="old">52 s</td><td>33 s</td></tr>
    </tbody>
  </table></div>

  <h2>What changed</h2>
  <div class="cols">
    <div class="card"><h3>Your four picks</h3><ul>
      <li><b>/model</b>: the model list and one Thinking row, Off · Medium · High (←/→), kept for next time. <code>/think off|medium|high</code> does the same from the prompt.</li>
      <li><b>The box at the bottom</b>, chat style: the screen is pushed up at start, so the box sits on the last lines and the conversation grows above it. Terminal's own scrolling and copying still work.</li>
      <li><b>Start-up, all of it</b>: the saved warm-up, a second slot for side requests, greetings skip sorting, and a start line that says what it waits for.</li>
      <li><b>"/" menu closer to Claude Code</b>: up to 10 commands, the whole selected row highlighted, the footer makes room while it's open, tab fills in.</li>
    </ul></div>
    <div class="card"><h3>What I decided along the way</h3><ul>
      <li>The instructions now end with a short "This session" part (date, git, tests, project notes), so the saved warm-up is the same in every project and on every day.</li>
      <li>Two slots cost about 0.3 GB; checkpoints went from 4 to 3 per slot to keep the total near 9.6 GB.</li>
      <li>At most 2 saved warm-ups are kept (~210 MB each, in <code>~/.bonsai-code/slots</code>); "High" thinking adds a line to the instructions, so it has its own.</li>
      <li>The memory note is shorter: "7.7 GB free, so using 16k (needs 9.2 GB); close other apps, such as the desk servers, to keep it fast."</li>
      <li>Tonight's pages are copied into <code>docs/</code> (now terminal/docs and models/bonsai-2-27b/reports), the experiments into <code>scripts/dev/experiments/</code> (now models/evals/dev/experiments) (with a README), and the report builders now write into <code>docs/</code>.</li>
    </ul></div>
  </div>

  <h2>Checked</h2>
  <div class="cols">
    <div class="card"><ul>
      <li>82 of 82 tests from source; the terminal tests again against the installed program.</li>
      <li>New tests: the picker (keys, what's sent, what's saved), the menu (10 rows, footer, tab), the box at the bottom, start-up (reads and saves, then restores, with a stand-in model server), the warm-up's fallback and pruning, the slots, greetings, High = the template's "xhigh".</li>
      <li>Each new behaviour broken on purpose once: all 7 breaks were caught, then put back.</li>
    </ul></div>
    <div class="card"><ul>
      <li>Real 27B: two slots and the saved warm-up measured directly (save 0.14 s, restore 0.09 s, "hello" 2.5 s after a restore).</li>
      <li>Real 27B: <code>bonsai -p "hello"</code> 93 s the first time, 10.9 s the second; the 5 practice tasks 5 of 5.</li>
      <li>The app: macOS shows the new icon for it, its signature checks out, and the command it runs works from a normal Terminal shell. I didn't double-click it myself: it would open a Terminal window and start the model on your screen.</li>
    </ul></div>
  </div>

  <h2>Good to know</h2>
  <div class="card"><ul>
    <li>One test run had a slow moment (the longest terminal test waited too long once); it passed alone and in the next two full runs.</li>
    <li>Switching thinking to High mid-conversation changes the instructions' first line, so the next reply reads the conversation again once.</li>
    <li>The rough diff from last night (a small file rewritten whole can show more lines as changed) is still there.</li>
  </ul></div>
  <p class="note">Code: ~/Desktop/bonsai-code · app: ~/Desktop/bonsai-code/Bonsai Code.app · command: ~/.local/bin/bonsai · model: ~/.bonsai-code/models/${esc(model.file)}</p>
</main>
<script>
(() => {
  const screens = ${JSON.stringify(screens)};
  for (const id of ['ui', 'task']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const layouts = Object.keys(screens[id]);
    const state = { layout: layouts[0], moment: document.querySelector('.seg[data-g="' + id + '"][data-k="moment"] button').dataset.v };
    const show = () => {
      el.innerHTML = (screens[id][state.layout] || {})[state.moment] || '<div>(This run never reached this moment.)</div>';
      el.scrollTop = el.scrollHeight;
      document.querySelectorAll('.seg[data-g="' + id + '"] button').forEach((b) => b.setAttribute('aria-pressed', String(state[b.parentNode.dataset.k] === b.dataset.v)));
    };
    document.querySelectorAll('.seg[data-g="' + id + '"] button').forEach((b) => { b.onclick = () => { state[b.parentNode.dataset.k] = b.dataset.v; show(); }; });
    show();
  }
})();
</script>
</body>
</html>
`;
const target = process.env.REPORT_OUT ?? join(root, 'docs', 'bonsai-code-report-2026-09-25.html');
writeFileSync(target, html);
console.log(`wrote ${target}`);
