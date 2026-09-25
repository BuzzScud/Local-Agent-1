// Builds the before/after page for the terminal UI walk: every screen at each
// window size, before and after side by side, with what each check found.
//   node terminal/scripts/ui-report.mjs [out.html]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { DOCS_DIR } from '../../docs/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Straight into the DOCS folder (the page is 1-2 MB of captured screens).
const out = process.argv[2] ?? join(DOCS_DIR, 'bonsai-terminal-ui-before-after.html');
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const SIZES = ['155x43', '80x24', '100x30'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const sections = SIZES.map((size) => ({ size, before: load(join(root, 'ui-walk/before', `${size}.json`)), after: load(join(root, 'ui-walk/after', `${size}.json`)) })).filter((s) => s.after);
const clean = (run) => (run ? run.shots.filter((s) => s.checks.every((c) => c.ok)).length : null);

function screen(s) {
  if (!s) return '<div class="none">not captured</div>';
  const bad = s.checks.filter((c) => !c.ok);
  const pills = bad.length
    ? bad.map((c) => `<span class="pill bad" title="${esc(c.detail)}">${esc(c.what)}</span>`).join('')
    : '<span class="pill ok">all checks pass</span>';
  return `<div class="shot"><div class="pills">${pills}</div><div class="fit"><div class="win"><div class="tb"><i></i><i></i><i></i><span>bonsai — ${s.cols}×${s.rows}</span></div><div class="screen" style="--c:${s.cols};--r:${s.rows}">${s.html}</div></div></div></div>`;
}

function section({ size, before, after }) {
  const names = after.shots.map((s) => s.name);
  const byName = (run) => Object.fromEntries((run?.shots ?? []).map((s) => [s.name, s]));
  const b = byName(before);
  const a = byName(after);
  const rows = names.map((n) => {
    const changed = b[n] && b[n].checks.some((c) => !c.ok);
    return `<section class="row${changed ? ' changed' : ''}"><h3>${esc(n)}</h3>${a[n].note ? `<p class="note">${esc(a[n].note)}</p>` : ''}<div class="pair${before ? '' : ' one'}">${before ? `<div><div class="lab">Before</div>${screen(b[n])}</div>` : ''}<div><div class="lab">After</div>${screen(a[n])}</div></div></section>`;
  }).join('');
  return `<div class="size" data-size="${size}" hidden>${rows}</div>`;
}

const tiles = sections.map((s) => `<div class="stat"><b>${s.before ? `${clean(s.before)} → ` : ''}${clean(s.after)} <small>of ${s.after.shots.length}</small></b><span>screens clean at ${s.size.replace('x', '×')}${s.before ? ', before → after' : ' (after only)'}</span></div>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bonsai Terminal UI</title>
<style>
  :root { --page:#f3f3f1; --ink:#1d1d1f; --muted:#6b6b70; --line:#d9d9d6; --card:#fff; --soft:#e4f1e1; --chip:#ecece9; --ok:#2e7d32; --okbg:#e3f1e4; --bad:#b3261e; --badbg:#fbe7e5; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; --okbg:#1b2a1d; --bad:#f28b82; --badbg:#3a1d1b; } }
  :root[data-theme="dark"] { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; --okbg:#1b2a1d; --bad:#f28b82; --badbg:#3a1d1b; }
  * { box-sizing:border-box; }
  html, body { margin:0; background:var(--page); color:var(--ink); }
  body { font:14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1500px; margin:0 auto; padding:24px 16px 60px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:-.01em; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:26px 0 10px; }
  h3 { font-size:14px; margin:0 0 4px; }
  .sub { color:var(--muted); margin:0 0 16px; max-width:900px; }
  code { font:12.5px ui-monospace, "SF Mono", Menlo, monospace; background:var(--chip); padding:1px 5px; border-radius:4px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:10px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .stat b { display:block; font-size:22px; letter-spacing:-.01em; } .stat b small { font-size:13px; color:var(--muted); font-weight:500; }
  .stat span { color:var(--muted); font-size:12.5px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; }
  .card ul { margin:4px 0; padding-left:20px; } .card li { margin:3px 0; }
  .bar { position:sticky; top:0; z-index:5; background:var(--page); padding:10px 0; display:flex; gap:12px; align-items:center; flex-wrap:wrap; border-bottom:1px solid var(--line); }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .seg button { font:inherit; border:0; background:var(--card); color:var(--muted); padding:6px 12px; cursor:pointer; }
  .seg button[aria-pressed="true"] { background:var(--soft); color:var(--ink); font-weight:600; }
  label.only { color:var(--muted); display:flex; gap:6px; align-items:center; }
  .row { padding:16px 0; border-bottom:1px solid var(--line); }
  .note { color:var(--muted); font-size:12.5px; margin:0 0 6px; }
  .pair { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; align-items:start; }
  .pair.one { grid-template-columns:minmax(0,1fr); max-width:900px; }
  @media (max-width: 800px) { .pair { grid-template-columns:minmax(0,1fr); } }
  .lab { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:4px; }
  .pills { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; min-height:22px; }
  .pill { font-size:11.5px; font-weight:600; padding:1px 8px; border-radius:999px; }
  .pill.ok { background:var(--okbg); color:var(--ok); } .pill.bad { background:var(--badbg); color:var(--bad); }
  .fit { width:100%; overflow:hidden; }
  .win { border-radius:8px; overflow:hidden; box-shadow:0 6px 24px rgba(0,0,0,.25), 0 0 0 1px rgba(0,0,0,.35); width:max-content; transform-origin:top left; }
  .tb { height:24px; background:#2d2d2f; display:flex; align-items:center; padding:0 10px; position:relative; }
  .tb i { display:inline-block; width:11px; height:11px; border-radius:50%; margin-right:7px; }
  .tb i:nth-child(1){background:#ff5f57} .tb i:nth-child(2){background:#febc2e} .tb i:nth-child(3){background:#28c840}
  .tb span { position:absolute; left:0; right:0; text-align:center; color:#a8a8ab; font-size:12px; }
  .screen { background:#171717; color:#fff; color-scheme:dark; padding:3px 5px; font:11px/13px "SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace; white-space:pre; width:calc(var(--c) * 1ch + 10px); height:calc(var(--r) * 13px + 6px); overflow:hidden; }
  .screen div { height:13px; } .screen .g { display:inline-block; width:1ch; text-align:center; overflow:visible; font-weight:inherit; }
  .none { color:var(--muted); font-style:italic; padding:20px 0; }
</style>
</head>
<body>
<main>
  <h1>Bonsai Code: the terminal UI, before and after</h1>
  <p class="sub">Every screen of the app, walked through by a script in a real terminal (a pseudo-terminal read back by a terminal emulator that re-wraps lines on resize, the way Terminal does), with the window resized in each state: smaller, bigger, a fast drag, height only, too small, and back. The model is scripted, so every run shows the same thing. ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.</p>
  <div class="stats">${tiles}</div>
  <h2>What changed</h2>
  <div class="card"><ul>
    <li><b>Resizing redraws everything.</b> While you drag, nothing is drawn; about 0.15 s after the size stops changing, the window is cleared and the whole conversation is printed again at the new width, ending on the last lines with the prompt box at the bottom. No leftover copies of the box or the spinner. (Clearing also clears what was in the window before you started bonsai.)</li>
    <li><b>80×24 is the floor.</b> Smaller shows "Make the window at least 80×24 to see Bonsai", and keys are ignored (so enter cannot answer a question you cannot see); ctrl+c still works. Bonsai keeps working meanwhile, and everything comes back when the window is big enough.</li>
    <li><b>Esc closes an open menu first</b> (the "/" menu, @ files, the shortcuts list). The next esc stops Bonsai. The text you typed stays.</li>
    <li><b>Everything fits the width:</b> menu rows, the footer, the spinner line and the meter line are cut with "…" instead of wrapping; tips wrap under their own text.</li>
    <li><b>Prompts fit the height:</b> edit, rename and command prompts size their diffs to the window, so the bottom area never fills the whole window (that made Ink clear and repaint the screen on every frame, and repaint old-width text).</li>
    <li><b>Typing while Bonsai works:</b> keys that arrive together with enter (the app was busy) now send the message instead of adding a new line.</li>
  </ul></div>
  <div class="bar">
    <span class="seg" role="group" aria-label="Window size">${sections.map((s, i) => `<button type="button" data-size="${s.size}" aria-pressed="${i === 0}">${s.size.replace('x', '×')}</button>`).join('')}</span>
    <label class="only"><input type="checkbox" id="only"> only screens that had problems before</label>
  </div>
  ${sections.map(section).join('')}
</main>
<script>
  const show = (size) => {
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
    document.querySelectorAll('.size').forEach((d) => { d.hidden = d.dataset.size !== size; });
    fit();
  };
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => show(b.dataset.size)));
  document.getElementById('only').addEventListener('change', (e) => document.querySelectorAll('.row').forEach((r) => { r.hidden = e.target.checked && !r.classList.contains('changed'); }));
  // Each terminal is scaled down to its column, keeping its real proportions.
  function fit() {
    document.querySelectorAll('.size:not([hidden]) .fit').forEach((f) => {
      const w = f.firstElementChild;
      w.style.transform = '';
      const k = Math.min(1, f.clientWidth / w.offsetWidth);
      w.style.transform = 'scale(' + k + ')';
      f.style.height = (w.offsetHeight * k) + 'px';
    });
  }
  addEventListener('resize', fit);
  show(${JSON.stringify(sections[0]?.size)});
</script>
</body>
</html>`;
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1e6).toFixed(1)} MB)`);
