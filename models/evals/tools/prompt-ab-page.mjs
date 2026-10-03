// The results page of Prompt old vs new (prompt-ab.mjs): the Practice 28 on one
// model with the prompt from before 30 Sep 2026 and with today's, side by side.
// One self-contained HTML file for the DOCS folder, opened from the run's line
// in the hub's Tests tab. Tabs that fit the window: Result · Task by task ·
// What changed · How it was measured. The look is the sorting check's page.
//
//   buildPromptPage({ title, dateline, verdict, chips, rows, changed, method, raw, names }) → html
//     names    what the two sides are called (default the prompts'); Thinking old vs new
//              (think-ab.mjs) draws its page with this builder too
//     rows     [{ task, old, new }]: old and new are a run's row ({ pass, secs, steps,
//              ownSteps, modelCalls, toolErrors, thinkTokens, why }) or null (not run)
//     chips    [{ text, ok }]: the rule, one chip per part (ok: true, false or null)
//     verdict, changed, method: HTML written by the builder's caller; raw: where the raw results are
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Totals of one side, over the tasks both sides ran.
export function sideTotals(rows, side) {
  const both = rows.filter((r) => r.old && r.new);
  const xs = both.map((r) => r[side]);
  // A measure no run reported (thinking tokens with thinking off) is null, shown as —, not 0.
  const sum = (k) => (xs.some((x) => x[k] != null) ? xs.reduce((a, x) => a + (x[k] ?? 0), 0) : null);
  const secs = xs.map((x) => x.secs).sort((a, b) => a - b);
  const median = secs.length ? (secs.length % 2 ? secs[(secs.length - 1) / 2] : (secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2) : null;
  return { tasks: xs.length, passed: xs.filter((x) => x.pass).length, secs: sum('secs') ?? 0, median, modelCalls: sum('modelCalls'), ownSteps: sum('ownSteps'), toolErrors: sum('toolErrors'), thinkTokens: sum('thinkTokens') };
}

// What moved: tasks the new prompt fixed (old failed, new passed) and broke (the other way).
export function flips(rows) {
  const both = rows.filter((r) => r.old && r.new);
  return { fixed: both.filter((r) => !r.old.pass && r.new.pass).map((r) => r.task), broke: both.filter((r) => r.old.pass && !r.new.pass).map((r) => r.task) };
}

const PROMPT_NAMES = { old: 'Old prompt', new: 'New prompt', oldSub: 'before 30 Sep', newSub: 'Work habits and the rest', thing: 'prompt' };

export function buildPromptPage({ title, dateline = '', verdict = '', chips = [], rows = [], changed = [], method = [], raw = [], names = PROMPT_NAMES }) {
  const data = JSON.stringify({ rows, old: sideTotals(rows, 'old'), new: sideTotals(rows, 'new'), flips: flips(rows) }).replace(/</g, '\\u003c');
  const chipHtml = chips.map((c) => `<span class="chip ${c.ok === true ? 'ok' : c.ok === false ? 'no' : ''}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '·'} ${esc(c.text)}</span>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#ffffff;--ink:#1c1b18;--mute:#6b675e;--line:#e3dfd5;--soft:#efece4;--best:#f3d9cc;--bestInk:#8a3a1c;--up:#1d7a46;--down:#b3261e}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80}}
:root[data-theme="dark"]{--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;padding:14px 16px;gap:10px;overflow:hidden}
header{flex:none;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px}
h1{font-size:21px;margin:0;letter-spacing:-.01em}.date{color:var(--mute);font-size:13px}
.tabs{flex:none;display:flex;flex-wrap:wrap;gap:6px}
.tabs button{font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.panel{flex:1;min-height:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;overflow:hidden;display:flex;flex-direction:column;gap:12px}
.verdict{font-size:17px;margin:0;max-width:1100px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--soft);color:var(--mute)}
.chip.ok{color:var(--up)}.chip.no{color:var(--down)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 14px}.card .k{color:var(--mute);font-size:12.5px}.card .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.card .s{color:var(--mute);font-size:12.5px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12.5px;color:var(--mute);font-weight:600}th small,td small{display:block;color:var(--mute);font-weight:400;font-size:11.5px}
td.num,th.num{text-align:right}
td.best{background:var(--best);color:var(--bestInk);font-weight:700}
.ok{color:var(--up)}.no{color:var(--down)}.dim{color:var(--mute)}
.pager{display:flex;align-items:center;gap:10px;margin-top:auto}.pager button{font:inherit;font-size:13px;padding:4px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer}
.pager button:disabled{background:var(--soft);color:var(--mute);cursor:default}.pager span{font-size:13px;color:var(--mute)}
.fill{flex:1;min-height:0;overflow:hidden}
ul.how{margin:0;padding-left:20px;max-width:1100px}ul.how li{margin:0 0 6px}ul.how code,pre{overflow-wrap:anywhere}
code{font-size:.9em;background:var(--soft);padding:1px 5px;border-radius:5px}
pre{margin:4px 0 0;white-space:pre-wrap;background:var(--soft);border-radius:8px;padding:8px 10px;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
@media (max-height:820px){body{padding:10px 14px;gap:8px}.panel{padding:12px 16px;gap:9px}.verdict{font-size:15px}.card{padding:7px 12px}.card .v{font-size:20px}th,td{padding:5px 10px}}
@media (max-width:760px),(max-height:520px){body{overflow:auto;height:auto}.panel{overflow:visible}.fill{overflow:visible}td.task{white-space:normal}.table-wrap{overflow-x:auto}}
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><span class="date">${esc(dateline)}</span></header>
<div class="tabs" role="tablist" id="tabs"></div>
<main class="panel" id="panel"><noscript>This page draws its tables with JavaScript.</noscript></main>
<script id="data" type="application/json">${data}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const VERDICT = ${JSON.stringify(verdict)}, CHIPS = ${JSON.stringify(chipHtml)};
const CHANGED = ${JSON.stringify(changed)}, METHOD = ${JSON.stringify(method)}, RAW = ${JSON.stringify(raw.map(esc))};
const N = ${JSON.stringify(Object.fromEntries(Object.entries({ ...PROMPT_NAMES, ...names }).map(([k, v]) => [k, esc(v)]))).replace(/</g, '\\u003c')};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TABS = [['result', 'Result'], ['tasks', 'Task by task'], ['changed', 'What changed'], ['how', 'How it was measured']];
let tab = Math.max(0, TABS.findIndex(([id]) => '#' + id === location.hash)), page = 0;
const num = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const pct = (a, b) => (a && b != null ? (b >= a ? '+' : '−') + Math.abs(Math.round(100 * (b - a) / a)) + '%' : '');
// Old and new side by side; the better cell marked (higher or lower is better, said on the row).
function row(name, sub, a, b, better, show = num) {
  const best = a != null && b != null && a !== b && better ? ((better === 'low') === (b < a) ? 'b' : 'a') : null;
  return '<tr><td><b>' + name + '</b><small>' + sub + '</small></td><td class="num' + (best === 'a' ? ' best' : '') + '">' + show(a) + '</td><td class="num' + (best === 'b' ? ' best' : '') + '">' + show(b) + '</td><td class="num dim">' + (better ? pct(a, b) : '') + '</td></tr>';
}
const cell = (x) => x ? '<span class="' + (x.pass ? 'ok' : 'no') + '">' + (x.pass ? 'PASS' : 'FAIL') + '</span> <span class="dim">· ' + num(x.secs) + ' s · ' + num(x.ownSteps ?? x.steps) + ' steps</span>' : '<span class="dim">— not run</span>';
function draw() {
  document.getElementById('tabs').innerHTML = TABS.map(([id, name], i) => '<button type="button" role="tab" aria-selected="' + (i === tab) + '" data-i="' + i + '">' + (i + 1) + ' · ' + name + '</button>').join('');
  const p = document.getElementById('panel'), id = TABS[tab][0], o = D.old, n = D.new, f = D.flips;
  if (id === 'result') {
    const cards = '<div class="card"><div class="k">' + N.old + ' · passed · higher is better</div><div class="v">' + o.passed + ' of ' + o.tasks + '</div><div class="s">' + num(o.secs) + ' s in all</div></div>'
      + '<div class="card"><div class="k">' + N.new + ' · passed · higher is better</div><div class="v">' + n.passed + ' of ' + n.tasks + '</div><div class="s">' + num(n.secs) + ' s in all</div></div>'
      + '<div class="card"><div class="k">Time in all · lower is better</div><div class="v">' + (pct(o.secs, n.secs) || '—') + '</div><div class="s">new against old</div></div>'
      + '<div class="card"><div class="k">Tasks that moved</div><div class="v">' + f.fixed.length + ' fixed · ' + f.broke.length + ' broke</div><div class="s">' + (f.fixed.length + f.broke.length ? esc([...f.fixed.map((t) => '+' + t), ...f.broke.map((t) => '−' + t)].join(', ')) : 'none') + '</div></div>';
    p.innerHTML = '<p class="verdict">' + VERDICT + '</p><div class="chips">' + CHIPS + '</div><div class="cards">' + cards + '</div><div class="table-wrap"><table><thead><tr><th>Measure</th><th class="num">' + N.old + '<small>' + N.oldSub + '</small></th><th class="num">' + N.new + '<small>' + N.newSub + '</small></th><th class="num">Change</th></tr></thead><tbody>'
      + row('Tasks passed', 'each task’s own check · higher is better', o.passed, n.passed, 'high')
      + row('Seconds in all', 'the tasks both ran · lower is better', o.secs, n.secs, 'low')
      + row('Seconds a task', 'the median · lower is better', o.median, n.median, 'low')
      + row('Model calls', 'in all · lower is better', o.modelCalls, n.modelCalls, 'low')
      + row('Its own steps', 'tool calls the model made · lower is better', o.ownSteps, n.ownSteps, 'low')
      + row('Tool errors', 'calls that came back as an error · lower is better', o.toolErrors, n.toolErrors, 'low')
      + row('Thinking', 'tokens, about · lower is better when the passes hold', o.thinkTokens, n.thinkTokens, 'low')
      + '</tbody></table></div>';
  } else if (id === 'tasks') {
    p.innerHTML = '<p class="verdict">Each practice task with the old ' + N.thing + ' and the new one: its check, its seconds and the model’s own steps. A task that moved is named in the last column.</p><div class="fill" id="fill"><div class="table-wrap"><table><thead><tr><th>Task</th><th>' + N.old + '</th><th>' + N.new + '</th><th>Moved</th></tr></thead><tbody></tbody></table></div></div><div class="pager"><button type="button" id="prev">‹ Back</button><button type="button" id="next">Next ›</button><span id="at"></span></div>';
    const fill = document.getElementById('fill'), body = p.querySelector('tbody'), list = D.rows;
    const moved = (r) => !r.old || !r.new ? '' : !r.old.pass && r.new.pass ? '<span class="ok">fixed</span>' : r.old.pass && !r.new.pass ? '<span class="no">broke</span>' : '<span class="dim">same</span>';
    const rowHtml = (r) => '<tr><td class="task">' + esc(r.task) + '</td><td>' + cell(r.old) + '</td><td>' + cell(r.new) + '</td><td>' + moved(r) + '</td></tr>';
    body.innerHTML = list.length ? rowHtml(list[0]) : '<tr><td colspan="4" class="dim">No tasks ran.</td></tr>';
    const small = matchMedia('(max-width:760px),(max-height:520px)').matches;
    const rh = body.firstElementChild?.getBoundingClientRect().height || 36, th = p.querySelector('thead').getBoundingClientRect().height;
    const per = small ? list.length || 1 : Math.max(1, Math.floor((fill.clientHeight - th) / rh));
    const pages = Math.max(1, Math.ceil(list.length / per)); page = Math.min(page, pages - 1);
    if (list.length) body.innerHTML = list.slice(page * per, page * per + per).map(rowHtml).join('');
    document.getElementById('at').textContent = list.length ? 'Page ' + (page + 1) + ' of ' + pages + ' · tasks ' + (page * per + 1) + '–' + Math.min(list.length, page * per + per) + ' of ' + list.length : '';
    document.getElementById('prev').disabled = page === 0; document.getElementById('next').disabled = page >= pages - 1;
    document.getElementById('prev').onclick = () => { page--; draw(); }; document.getElementById('next').onclick = () => { page++; draw(); };
  } else if (id === 'changed') {
    p.innerHTML = '<ul class="how">' + CHANGED.map((m) => '<li>' + m + '</li>').join('') + '</ul>';
  } else {
    p.innerHTML = '<ul class="how">' + METHOD.map((m) => '<li>' + m + '</li>').join('') + (RAW.length ? '<li>Raw results, on this Mac: ' + RAW.map((r) => '<code>' + r + '</code>').join(', ') + '</li>' : '') + '<li>Nothing on this page loads from the internet.</li></ul>';
  }
}
document.getElementById('tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { tab = Number(b.dataset.i); page = 0; try { history.replaceState(null, '', '#' + TABS[tab][0]); } catch {} draw(); } };
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = Number(e.key);
  if (k >= 1 && k <= TABS.length) { tab = k - 1; page = 0; draw(); }
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
