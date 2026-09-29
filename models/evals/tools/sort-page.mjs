// The results page of the sorting check (sort-check.mjs), and of any run that
// compares ways of sorting requests: one self-contained HTML file for the DOCS
// folder, opened from the run's line in the hub's Tests tab. Tabs that fit the
// window: Result · By kind · Misses · Model-sorted lines · How it was measured.
// A model switch shows when the page holds more than one model.
//
//   buildSortPage({ title, dateline, verdict, chips, models, method, raw }) → html
//     chips   [{ text, ok }]: the rule, one chip per test (ok: true, false or null)
//     models  [{ id, name, columns: [{ label, sub, rows }] }]
//     rows    [{ set, n, text, want, model, kind, ms, conf, via }]: want is the kind
//             it should get (null: no kind, shown only), model true for a line the
//             word rules leave to the model, conf the model's chance for its pick
//             (null when it wrote its answer), via 'odds' or 'written'
//     verdict, method  HTML written by the builder's caller (never a request's text); raw: where the raw results are
export const KIND_ORDER = ['question', 'fix', 'change', 'rename', 'other'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildSortPage({ title, dateline = '', verdict = '', chips = [], models = [], method = [], raw = [] }) {
  const data = JSON.stringify({ models, kinds: KIND_ORDER }).replace(/</g, '\\u003c');
  const chipHtml = chips.map((c) => `<span class="chip ${c.ok === true ? 'ok' : c.ok === false ? 'no' : ''}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '·'} ${esc(c.text)}</span>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#ffffff;--ink:#1c1b18;--mute:#6b675e;--faint:#a19c90;--line:#e3dfd5;--soft:#efece4;--best:#f3d9cc;--bestInk:#8a3a1c;--up:#1d7a46;--down:#b3261e}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80}}
:root[data-theme="dark"]{--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;padding:14px 16px;gap:10px;overflow:hidden}
header{flex:none;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px}
h1{font-size:21px;margin:0;letter-spacing:-.01em}.date{color:var(--mute);font-size:13px}
.bar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tabs button,.models button{font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"],.models button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.models{display:flex;gap:6px;margin-left:auto}.models:empty{display:none}
.panel{flex:1;min-height:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;overflow:hidden;display:flex;flex-direction:column;gap:12px}
.verdict{font-size:17px;margin:0;max-width:1100px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--soft);color:var(--mute)}
.chip.ok{color:var(--up)}.chip.no{color:var(--down)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 14px}.card .k{color:var(--mute);font-size:12.5px}.card .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.card .s{color:var(--mute);font-size:12.5px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12.5px;color:var(--mute);font-weight:600}th small,td small{display:block;color:var(--faint);font-weight:400;font-size:11.5px}
td.num,th.num{text-align:right}
td.best{background:var(--best);color:var(--bestInk);font-weight:700}
td.req{max-width:0;width:48%;overflow:hidden;text-overflow:ellipsis}
.ok{color:var(--up)}.no{color:var(--down)}.dim{color:var(--faint)}
.pager{display:flex;align-items:center;gap:10px;margin-top:auto}.pager button{font:inherit;font-size:13px;padding:4px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer}
.pager button:disabled{background:var(--soft);color:var(--mute);cursor:default}.pager span{font-size:13px;color:var(--mute)}
.fill{flex:1;min-height:0;overflow:hidden}
ul.how{margin:0;padding-left:20px;max-width:1100px}ul.how li{margin:0 0 6px}ul.how code{overflow-wrap:anywhere}
code{font-size:.9em;background:var(--soft);padding:1px 5px;border-radius:5px}
@media (max-height:820px){body{padding:10px 14px;gap:8px}.panel{padding:12px 16px;gap:9px}.verdict{font-size:15px}.card{padding:7px 12px}.card .v{font-size:20px}th,td{padding:5px 10px}}
@media (max-width:760px),(max-height:520px){body{overflow:auto;height:auto}.panel{overflow:visible}.fill{overflow:visible}td.req{white-space:normal}.table-wrap{overflow-x:auto}}
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><span class="date">${esc(dateline)}</span></header>
<div class="bar"><div class="tabs" role="tablist" id="tabs"></div><div class="models" id="models"></div></div>
<main class="panel" id="panel"><noscript>This page draws its tables with JavaScript.</noscript></main>
<script id="data" type="application/json">${data}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const VERDICT = ${JSON.stringify(verdict)}, CHIPS = ${JSON.stringify(chipHtml)};
const METHOD = ${JSON.stringify(method)}, RAW = ${JSON.stringify(raw.map(esc))};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABS = [['result', 'Result'], ['kinds', 'By kind'], ['misses', 'Misses'], ['model', 'Model-sorted lines'], ['how', 'How it was measured']];
let tab = Math.max(0, TABS.findIndex(([id]) => '#' + id === location.hash)), mi = 0, page = 0;
const M = () => D.models[mi];
const labelled = (rows) => rows.filter((r) => r.want);
const right = (rows) => rows.filter((r) => r.want && r.kind === r.want).length;
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const secs = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(2) + ' s');
const pick = (r) => r ? '<span class="' + (r.want ? (r.kind === r.want ? 'ok' : 'no') : '') + '">' + esc(r.kind) + '</span>' + (r.conf != null ? ' <span class="dim">' + Math.round(r.conf * 100) + '%</span>' : '') : '<span class="dim">—</span>';
// A cell per column; the best one (most right, or fewest seconds) is marked.
function row(name, sub, vals, show, better) {
  const nums = vals.map((v) => (v == null ? null : v));
  const ok = nums.filter((v) => v != null);
  const best = ok.length > 1 && new Set(ok).size > 1 ? (better === 'low' ? Math.min(...ok) : Math.max(...ok)) : null;
  return '<tr><td><b>' + name + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</td>' + vals.map((v, i) => '<td class="num' + (v != null && v === best ? ' best' : '') + '">' + show(v, i) + '</td>').join('') + '</tr>';
}
const head = (first) => '<thead><tr><th>' + first + '</th>' + M().columns.map((c) => '<th class="num">' + esc(c.label) + '<small>' + esc(c.sub ?? '') + '</small></th>').join('') + '</tr></thead>';
// Lines matched across columns by their place in the sort test.
const keyOf = (r) => r.set + ':' + r.n;
function lines(filter) {
  const cols = M().columns, base = cols[cols.length - 1].rows; // the newest column's lines
  return base.map((r) => ({ r, picks: cols.map((c) => c.rows.find((x) => keyOf(x) === keyOf(r))) })).filter(filter);
}
function draw() {
  document.getElementById('tabs').innerHTML = TABS.map(([id, name], i) => '<button type="button" role="tab" aria-selected="' + (i === tab) + '" data-i="' + i + '">' + (i + 1) + ' · ' + name + '</button>').join('');
  document.getElementById('models').innerHTML = D.models.length > 1 ? D.models.map((m, i) => '<button type="button" aria-pressed="' + (i === mi) + '" data-m="' + i + '">' + esc(m.name) + '</button>').join('') : '';
  const p = document.getElementById('panel'), cols = M().columns, id = TABS[tab][0];
  if (id === 'result') {
    const lab = cols.map((c) => labelled(c.rows));
    const notOther = (rows) => rows.filter((r) => r.want !== 'other'), other = (rows) => rows.filter((r) => r.want === 'other');
    const cards = cols.map((c, i) => '<div class="card"><div class="k">' + esc(c.label) + ' · right · higher is better</div><div class="v">' + right(lab[i]) + ' of ' + lab[i].length + '</div><div class="s">' + secs(median(c.rows.map((r) => r.ms))) + ' a sort (median) · ' + esc(c.sub ?? '') + '</div></div>').join('');
    const odds = cols.map((c) => (c.rows.some((r) => r.via) ? c.rows.filter((r) => r.via === 'odds').length : null));
    p.innerHTML = '<p class="verdict">' + VERDICT + '</p><div class="chips">' + CHIPS + '</div><div class="cards">' + cards + '</div><div class="table-wrap"><table>' + head('Measure') + '<tbody>'
      + row('Right answers', 'the lines with a kind to get · higher is better', lab.map(right), (v, i) => v + ' of ' + lab[i].length, 'high')
      + row('Right, without the “other” lines', 'question, fix, change, rename · higher is better', lab.map((l) => right(notOther(l))), (v, i) => v + ' of ' + notOther(lab[i]).length, 'high')
      + row('Right on the “other” lines', 'a page, notes, a file to move, a command · higher is better', lab.map((l) => right(other(l))), (v, i) => v + ' of ' + other(lab[i]).length, 'high')
      + row('Seconds a sort', 'the median · lower is faster', cols.map((c) => median(c.rows.map((r) => r.ms))), (v) => secs(v), 'low')
      + (odds.some((v) => v != null) ? row('Sorted in one pass', 'from the chances, nothing written', odds, (v, i) => (v == null ? '—' : v + ' of ' + cols[i].rows.length), null) : '')
      + '</tbody></table></div>';
  } else if (id === 'kinds') {
    const kinds = D.kinds.filter((k) => cols.some((c) => c.rows.some((r) => r.want === k)));
    p.innerHTML = '<p class="verdict">How many lines of each kind got their kind. Higher is better; the best cell of a row is marked.</p><div class="table-wrap"><table>' + head('Kind') + '<tbody>'
      + kinds.map((k) => { const n = (c) => c.rows.filter((r) => r.want === k).length; return row(esc(k), n(cols[cols.length - 1]) + ' lines', cols.map((c) => c.rows.filter((r) => r.want === k && r.kind === k).length), (v, i) => v + ' of ' + n(cols[i]), 'high'); }).join('')
      + '</tbody></table></div>';
  } else if (id === 'misses' || id === 'model') {
    const list = id === 'misses' ? lines((x) => x.r.want && x.picks.some((q) => q && q.kind !== x.r.want)) : lines((x) => x.r.model);
    const lede = id === 'misses' ? list.length + ' line' + (list.length === 1 ? '' : 's') + ' that a column got wrong (red). The percentage is the model’s chance for its pick, where it sorted in one pass.' : 'The lines the word rules leave to the model: the ones it sorts in the app. A kind under “should be” was written for this check; the others are unclear on purpose.';
    p.innerHTML = '<p class="verdict">' + lede + '</p><div class="fill" id="fill"><div class="table-wrap"><table id="t">' + head('Request') .replace('<th>Request</th>', '<th>Request</th><th>Should be</th>') + '<tbody></tbody></table></div></div><div class="pager"><button type="button" id="prev">‹ Back</button><button type="button" id="next">Next ›</button><span id="at"></span></div>';
    const fill = document.getElementById('fill'), body = p.querySelector('tbody');
    const rowHtml = (x) => '<tr><td class="req" title="' + esc(x.r.text) + '">' + esc(x.r.text.replace(/\\s+/g, ' ')) + '</td><td>' + esc(x.r.want ?? 'unclear') + '</td>' + x.picks.map((q) => '<td class="num">' + pick(q) + '</td>').join('') + '</tr>';
    body.innerHTML = list.length ? rowHtml(list[0]) : '<tr><td colspan="9" class="dim">None.</td></tr>';
    const small = matchMedia('(max-width:760px),(max-height:520px)').matches;
    const rh = body.firstElementChild?.getBoundingClientRect().height || 36, th = p.querySelector('thead').getBoundingClientRect().height;
    const per = small ? list.length || 1 : Math.max(1, Math.floor((fill.clientHeight - th) / rh));
    const pages = Math.max(1, Math.ceil(list.length / per)); page = Math.min(page, pages - 1);
    if (list.length) body.innerHTML = list.slice(page * per, page * per + per).map(rowHtml).join('');
    document.getElementById('at').textContent = list.length ? 'Page ' + (page + 1) + ' of ' + pages + ' · lines ' + (page * per + 1) + '–' + Math.min(list.length, page * per + per) + ' of ' + list.length : '';
    document.getElementById('prev').disabled = page === 0; document.getElementById('next').disabled = page >= pages - 1;
    document.getElementById('prev').onclick = () => { page--; draw(); }; document.getElementById('next').onclick = () => { page++; draw(); };
  } else {
    p.innerHTML = '<ul class="how">' + METHOD.map((m) => '<li>' + m + '</li>').join('') + (RAW.length ? '<li>Raw results, on this Mac: ' + RAW.map((r) => '<code>' + r + '</code>').join(', ') + '</li>' : '') + '<li>Nothing on this page loads from the internet.</li></ul>';
  }
}
document.getElementById('tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { tab = Number(b.dataset.i); page = 0; try { history.replaceState(null, '', '#' + TABS[tab][0]); } catch {} draw(); } };
document.getElementById('models').onclick = (e) => { const b = e.target.closest('button'); if (b) { mi = Number(b.dataset.m); page = 0; draw(); } };
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= TABS.length) { tab = n - 1; page = 0; draw(); }
  else if (e.key === 'ArrowRight') { tab = (tab + 1) % TABS.length; page = 0; draw(); }
  else if (e.key === 'ArrowLeft') { tab = (tab + TABS.length - 1) % TABS.length; page = 0; draw(); }
});
addEventListener('resize', () => draw());
draw();
</script>
</body>
</html>
`;
}
