// The design studio check (the Arena's checks → Design studio check, `/test studio`): is every
// piece in the design studio (docs/private/design studio/, terminal/src/agent/studio.mjs) fit to be
// handed to the model? No model runs. Each piece is put in the page shell the model is told to use,
// its styles are built the way the app builds them, and it is opened in headless Chrome by the
// layout check (1440×900, a 390-wide phone, dark mode, every button clicked).
// A piece passes (the rule of 30 Sep 2026) when:
//   head     it has a name and at least 3 Words
//   size     its HTML is at most PIECE_CHARS (it is handed over whole, never cut)
//   theme    every colour class is one of the theme's (a stock colour draws nothing)
//   layout   the layout check finds nothing broken, dead buttons included
//   found    "make a <its name>" picks it
// It writes a gallery of every piece, live, into the studio folder (private, like the pieces), the
// results page into the DOCS folder (tests/: names and results, no piece's code), and its line in
// the test record.
//   node models/evals/bench/design/studio-check.mjs [--only cards/stat-card] [--shots <folder>] [--no-record]
//   --shots: also save a desktop, phone and dark picture of each piece there
//   --no-record: a look only; no line in the test record and no results page
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { recordTest, codeLabel } from '../../../index.mjs';
import { studioDir, readPieces, pickPieces, buildStyles, readTheme, layoutCheck, findChrome, PIECE_CHARS } from '../../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../../docs/tools/to-docs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const look = args.includes('--no-record');
const only = opt('only', null);
const shots = opt('shots', null);
const t0 = Date.now(); const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
let stopping = false; process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });

// The page shell the model is told to start from (studio.mjs), around one piece.
export const shell = (name, body) => `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head>\n<body class="min-h-screen bg-paper text-ink font-sans antialiased">\n<main class="mx-auto max-w-6xl p-4 sm:p-8">\n${body}\n</main>\n</body>\n</html>\n`;

function shoot(chrome, page, out, w, h, dark = false) {
  const prof = mkdtempSync(join(tmpdir(), 'agentic-studio-shot-'));
  try {
    spawnSync(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${prof}`, `--window-size=${w},${h}`, '--virtual-time-budget=2000', ...(dark ? ['--blink-settings=preferredColorScheme=0'] : []), `--screenshot=${out}`, `file://${page}`], { timeout: 30_000, stdio: 'ignore' });
  } finally { rmSync(prof, { recursive: true, force: true }); }
  return existsSync(out);
}

const dir = studioDir();
const all = readPieces(dir).pieces.filter((p) => !only || p.file === `components/${only}.html` || p.file.includes(only));
console.log(`Design studio check · ${all.length} piece${all.length === 1 ? '' : 's'} · ${dir ? dir.replace(process.env.HOME ?? '~', '~') : 'no studio folder'}`);
if (!dir || !all.length) { console.log('nothing to check: make "design studio" in docs/private/ with components/<kind>/<piece>.html'); process.exit(1); }
const chrome = findChrome();
if (!chrome) { console.log('no headless Chrome on this Mac (Chrome, or Playwright\'s own)'); process.exit(1); }
const theme = readTheme(dir);
const scratch = mkdtempSync(join(tmpdir(), 'agentic-studio-check-'));
if (shots) mkdirSync(shots, { recursive: true });

const rows = [];
const built = [];
for (const p of all) {
  if (stopping) break;
  const name = p.file.replace(/^components\//, '').replace(/\.html?$/i, '');
  const r = await buildStyles(shell(p.name, p.body), { theme, force: true });
  const file = join(scratch, `${name.replace(/\//g, '--')}.html`);
  writeFileSync(file, r.html);
  const lc = await layoutCheck(file);
  const picked = pickPieces(`Make a ${p.name.toLowerCase()}`, { pieces: all.length > 1 ? readPieces(dir).pieces : all }).pieces.map((x) => x.file);
  const checks = {
    head: Boolean(p.name) && p.words.length >= 3,
    size: p.body.length <= PIECE_CHARS,
    theme: !r.stock.length,
    layout: !lc.skipped && !lc.problems.length,
    found: picked.includes(p.file),
  };
  const pass = Object.values(checks).every(Boolean);
  const why = [
    !checks.head && `head: ${p.name ? '' : 'no name; '}${p.words.length} Words (needs 3)`,
    !checks.size && `size: ${p.body.length.toLocaleString('en-US')} characters (at most ${PIECE_CHARS.toLocaleString('en-US')})`,
    !checks.theme && `theme: ${r.stock.join(', ')}`,
    !checks.layout && `layout: ${lc.skipped ?? lc.problems.join(' ')}`,
    !checks.found && `found: "make a ${p.name.toLowerCase()}" picks ${picked.join(', ') || 'nothing'}`,
  ].filter(Boolean);
  rows.push({ piece: name, name: p.name, kind: p.kind, chars: p.body.length, classes: r.classes, css: r.bytes, secs: lc.secs ?? null, checks, pass, why });
  built.push({ name, title: p.name, kind: p.kind, for: p.for, html: r.html });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${why.length ? `  — ${why.join(' · ')}` : ''}`);
  if (shots) {
    shoot(chrome, file, join(shots, `${name.replace(/\//g, '--')}.png`), 1100, 760);
    shoot(chrome, file, join(shots, `${name.replace(/\//g, '--')}-phone.png`), 390, 760);
    shoot(chrome, file, join(shots, `${name.replace(/\//g, '--')}-dark.png`), 1100, 760, true);
  }
}
rmSync(scratch, { recursive: true, force: true });

// Which pieces the test requests get (the UI component battle's and the design test's): no rule, a look.
const asks = [...JSON.parse(readFileSync(join(here, 'components.json'), 'utf8')), ...JSON.parse(readFileSync(join(here, 'pages.json'), 'utf8'))]
  .map((q) => ({ id: q.id, name: q.name ?? q.id, picks: pickPieces(q.prompt, { dir }).pieces.map((x) => x.file.replace(/^components\//, '').replace(/\.html?$/i, '')) }));

const passed = rows.filter((r) => r.pass).length;
const full = !stopping && rows.length === all.length;
const pass = full && passed === rows.length;
const secs = (Date.now() - t0) / 1000;
const gallery = join(dir, 'gallery.html');
if (!only) { writeFileSync(gallery, galleryPage(built)); console.log(`gallery: ${gallery.replace(process.env.HOME ?? '~', '~')}`); }
const docs = !look && existsSync(DOCS_DIR);
const pagePath = docs ? `tests/agentic-coder-design-studio-check-${stamp}.html` : '';
if (docs) { writeFileSync(docsPath(pagePath), resultsPage({ rows, asks, passed, full, pass, secs })); console.log(`results page: ${pagePath}`); }
if (!look) recordTest({
  kind: 'other', name: 'Design studio check', passed, total: all.length, secs, part: !full || Boolean(only), bar: 'every piece: a head, at most 2,600 characters, theme colours only, nothing broken in the browser, found by its name',
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${passed} of ${all.length} pieces fit to hand to the model${rows.some((r) => !r.pass) ? `; not yet: ${rows.filter((r) => !r.pass).map((r) => r.piece).slice(0, 8).join(', ')}` : ''}.`,
  page: pagePath, code: codeLabel(),
});
console.log(`Design studio check: ${passed} of ${all.length} pieces pass · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(full && pass ? 0 : 1);

// ---------- the gallery (private, beside the pieces): every piece live, light or dark ----------
function galleryPage(items) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kinds = [...new Set(items.map((i) => i.kind))];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design studio</title><style>
:root { --paper:#f7f6f2; --surface:#fff; --ink:#1c1b18; --muted:#6b675e; --line:#e3dfd5; --accent:#1f66bd; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#15161a; --surface:#1d1f24; --ink:#ecebe6; --muted:#a4a19a; --line:#34363e; --accent:#6aa5ec; } }
:root[data-theme="dark"] { --paper:#15161a; --surface:#1d1f24; --ink:#ecebe6; --muted:#a4a19a; --line:#34363e; --accent:#6aa5ec; }
* { box-sizing: border-box; } body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 12px 16px; background: var(--paper); border-bottom: 1px solid var(--line); }
h1 { font-size: 18px; margin: 0 12px 0 0; } nav { display: flex; flex-wrap: wrap; gap: 6px; } .sp { flex: 1; }
button, input { font: inherit; color: inherit; } button { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
button[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
input { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 4px 10px; min-width: 0; width: 220px; max-width: 100%; }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 16px; padding: 16px; }
figure { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; min-width: 0; }
figcaption { display: flex; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
figcaption b { font-weight: 600; } figcaption span { color: var(--muted); overflow-wrap: anywhere; }
iframe { display: block; width: 100%; height: 360px; border: 0; }
</style></head><body>
<header><h1>Design studio · ${items.length} pieces</h1><nav id="kinds"><button aria-pressed="true" data-kind="">All</button>${kinds.map((k) => `<button aria-pressed="false" data-kind="${esc(k)}">${esc(k)}</button>`).join('')}</nav><span class="sp"></span><input id="q" type="search" placeholder="Find a piece" aria-label="Find a piece"><button id="theme" aria-pressed="false">Dark</button></header>
<main>${items.map((i, n) => `<figure data-kind="${esc(i.kind)}" data-words="${esc(`${i.title} ${i.for} ${i.name}`.toLowerCase())}"><figcaption><b>${esc(i.title)}</b><span>STUDIO/components/${esc(i.name)}.html</span></figcaption><iframe title="${esc(i.title)}" loading="lazy" data-n="${n}"></iframe></figure>`).join('')}</main>
<script>
const PAGES = ${JSON.stringify(items.map((i) => i.html)).replace(/</g, '\\u003c')};
const DARK = '<style id="force-dark">:root{--paper:#15161a;--surface:#1d1f24;--subtle:#24262c;--ink:#ecebe6;--muted:#a4a19a;--line:#34363e;--accent:#6aa5ec;--accent-ink:#0e1726;--accent-soft:#1f3350;--good:#6fcf8f;--good-soft:#173523;--wait:#e8b04a;--wait-soft:#3a2c10;--bad:#f28b82;--bad-soft:#3d1a18;color-scheme:dark}</style>';
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
const fill = () => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.getElementById('theme').setAttribute('aria-pressed', String(dark)); document.querySelectorAll('iframe').forEach((f) => { const h = PAGES[f.dataset.n]; f.srcdoc = dark ? h.replace('</head>', DARK + '</head>') : h; }); };
document.getElementById('theme').onclick = () => { dark = !dark; fill(); };
let kind = '';
const filter = () => { const q = document.getElementById('q').value.trim().toLowerCase(); document.querySelectorAll('figure').forEach((f) => { f.hidden = (kind && f.dataset.kind !== kind) || (q && !f.dataset.words.includes(q)); }); };
document.getElementById('kinds').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; kind = b.dataset.kind; document.querySelectorAll('#kinds button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); filter(); };
document.getElementById('q').oninput = filter;
fill();
</script></body></html>`;
}

// ---------- the results page (public: names and results, no piece's code) ----------
function resultsPage(s) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const mark = (ok) => (ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>');
  const verdict = !s.full ? 'Stopped before every piece was checked' : s.pass ? `All ${s.rows.length} pieces are fit to hand to the model` : `${s.rows.length - s.passed} of ${s.rows.length} pieces are not fit yet`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design studio check</title><style>
:root { --page:#f7f6f2; --surface:#fff; --line:#e3dfd5; --ink:#1c1b18; --muted:#6b675e; --ok:#1f7a3d; --bad:#b42318; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page:#15161a; --surface:#1d1f24; --line:#34363e; --ink:#ecebe6; --muted:#a4a19a; --ok:#6fcf8f; --bad:#f28b82; color-scheme: dark; } }
:root[data-theme="dark"] { --page:#15161a; --surface:#1d1f24; --line:#34363e; --ink:#ecebe6; --muted:#a4a19a; --ok:#6fcf8f; --bad:#f28b82; color-scheme: dark; }
* { box-sizing: border-box; } html, body { height: 100%; } body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; flex-direction: column; }
header { padding: 16px 20px 0; } h1 { font-size: 22px; margin: 0; } .sub { color: var(--muted); margin: 2px 0 12px; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; } .tabs button { font: inherit; color: inherit; border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.tabs button[aria-selected="true"] { background: var(--ink); color: var(--page); border-color: var(--ink); }
section { flex: 1; min-height: 0; overflow: auto; padding: 12px 20px 20px; } section[hidden] { display: none; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; } .tile b { display: block; font-size: 28px; font-variant-numeric: tabular-nums; } .tile small, .k { color: var(--muted); }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; } th { color: var(--muted); font-weight: 500; } td.n { text-align: right; font-variant-numeric: tabular-nums; } td.c { text-align: center; }
.ok { color: var(--ok); font-weight: 600; } .bad { color: var(--bad); font-weight: 600; } .why { color: var(--muted); }
.wrap { overflow-x: auto; } p.lead { font-size: 17px; margin: 0 0 14px; }
</style></head><body>
<header><h1>Design studio check · ${esc(verdict)}</h1><p class="sub">${esc(when)} · ${s.rows.length} pieces from the private design studio, each built the way the app builds it and opened in headless Chrome (desktop, phone, dark, every button clicked) · ${Math.round(s.secs)} s · no model</p>
<div class="tabs" role="tablist"><button role="tab" aria-selected="true" data-t="1">1 · The result</button><button role="tab" aria-selected="false" data-t="2">2 · Every piece</button><button role="tab" aria-selected="false" data-t="3">3 · What the test requests get</button></div></header>
<section data-p="1"><p class="lead">${esc(verdict)}.</p><div class="tiles">
<div class="tile"><span class="k">Pieces that pass</span><b>${s.passed} of ${s.rows.length}</b><small>higher is better</small></div>
<div class="tile"><span class="k">Nothing broken in the browser</span><b>${s.rows.filter((r) => r.checks.layout).length}</b><small>higher is better</small></div>
<div class="tile"><span class="k">Theme colours only</span><b>${s.rows.filter((r) => r.checks.theme).length}</b><small>higher is better</small></div>
<div class="tile"><span class="k">Found by their own name</span><b>${s.rows.filter((r) => r.checks.found).length}</b><small>higher is better</small></div>
<div class="tile"><span class="k">Largest piece</span><b>${Math.max(...s.rows.map((r) => r.chars)).toLocaleString('en-US')}</b><small>characters · at most ${PIECE_CHARS.toLocaleString('en-US')}</small></div>
</div><p class="sub" style="margin-top:14px">A piece passes with a head (a name and 3 Words), at most ${PIECE_CHARS.toLocaleString('en-US')} characters, only the theme's colours, nothing broken in the layout check (dead buttons included), and "make a &lt;its name&gt;" picking it.</p></section>
<section data-p="2" hidden><div class="wrap"><table><thead><tr><th>Piece</th><th>Head</th><th>Size</th><th>Theme</th><th>Layout</th><th>Found</th><th class="n">Characters</th><th>Why not</th></tr></thead><tbody>
${s.rows.map((r) => `<tr><td>${esc(r.piece)}</td><td class="c">${mark(r.checks.head)}</td><td class="c">${mark(r.checks.size)}</td><td class="c">${mark(r.checks.theme)}</td><td class="c">${mark(r.checks.layout)}</td><td class="c">${mark(r.checks.found)}</td><td class="n">${r.chars.toLocaleString('en-US')}</td><td class="why">${esc(r.why.join(' · ') || '—, it passes')}</td></tr>`).join('\n')}
</tbody></table></div></section>
<section data-p="3" hidden><p class="sub">The pieces each test request would get, picked by their Words (no rule: a look at whether the picks fit).</p><div class="wrap"><table><thead><tr><th>Request</th><th>Pieces it gets</th></tr></thead><tbody>
${s.asks.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.picks.length ? esc(a.picks.join(' + ')) : '— none fits: it gets the design cards instead'}</td></tr>`).join('\n')}
</tbody></table></div></section>
<script>
const tabs = [...document.querySelectorAll('[role=tab]')];
const show = (t) => { tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t))); document.querySelectorAll('section').forEach((p) => { p.hidden = p.dataset.p !== t; }); };
tabs.forEach((b) => { b.onclick = () => show(b.dataset.t); });
addEventListener('keydown', (e) => { if (/^[1-3]$/.test(e.key)) show(e.key); const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true'); if (e.key === 'ArrowRight') show(String(Math.min(3, i + 2))); if (e.key === 'ArrowLeft') show(String(Math.max(1, i))); });
</script></body></html>`;
}
