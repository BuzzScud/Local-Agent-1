// The results page of the New model check (model-check.mjs): one self-contained HTML file for the
// DOCS folder, opened from the run's line in the hub's Tests tab. Tabs that fit the window:
// Result · Checks · How it was measured.
//   buildModelCheckPage({ title, dateline, s, rows, raw }) → html
//     s     the run's summary.json; rows its rows.json (one a check: name, pass, detail)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildModelCheckPage({ title, dateline = '', s, rows = [], raw = [] }) {
  const judged = rows.filter((r) => r.pass !== null);
  const failed = judged.filter((r) => !r.pass);
  const fromText = rows.filter((r) => r.how === 'written in the text, read by the app').length;
  const real = rows.filter((r) => r.how === 'a real call').length;
  const verdict = `${s.stopped ? 'Stopped early: ' : s.pass ? 'Ready: ' : 'Not ready yet: '}${s.passed} of ${s.total} checks passed on ${s.name}${failed.length ? ` (failed: ${failed.map((r) => r.name.toLowerCase()).join('; ')})` : ''}.`
    + (real + fromText ? ` Its tool calls came back ${fromText ? (real ? `${real} as real calls and ${fromText} written in the text (the app reads those)` : 'written in the text every time (the app reads them)') : 'as real calls every time'}.` : '');
  const chip = (ok, text) => `<span class="chip ${ok === null ? '' : ok ? 'ok' : 'no'}">${ok === null ? '·' : ok ? '✓' : '✗'} ${esc(text)}</span>`;
  const chips = judged.map((r) => chip(r.pass, r.name)).join('');
  const card = (k, v, sub) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const cards = [
    card('Checks passed', `${s.passed} / ${s.total}`, 'higher is better'),
    card('Reads', s.speed?.read ?? '–', 'tokens a second · higher is faster'),
    card('Writes', s.speed?.write ?? '–', 'tokens a second · higher is faster'),
    card('Memory taken', s.memory ? `${s.memory.takenGB} GB` : '–', `free memory, loading it at ${Number(s.ctx).toLocaleString('en-US')} tokens · lower is better`),
  ].join('');
  const tr = rows.map((r) => `<tr><td class="${r.pass === null ? '' : r.pass ? 'ok' : 'no'}">${r.pass === null ? 'measured' : r.pass ? 'PASS' : 'FAIL'}</td><td>${esc(r.name)}</td><td class="wrap">${esc(r.detail)}</td></tr>`).join('');
  const method = [
    `${esc(s.name)} on its own server (${esc(s.engine)}) with the app's settings, ${Number(s.ctx).toLocaleString('en-US')} tokens of context; nothing else loaded. Each request goes through the app's own client: the same instructions and tools a reply gets, the same thinking split and the same reading of a tool call written as text.`,
    'The tool-call checks ask it to read package.json with the Read tool; a check passes when a Read of package.json comes back, as a real call or written in the text.',
    'A level passes when its thinking comes apart from the answer and no thinking or tool tag is left in the open.',
    `The cap check asks for a ${s.cap}-token thinking cap at the highest level: on a sum that needs far more thinking than that. It passes when the cap really ends the thinking (the server\'s closing message is in it, or it reached the cap), the thinking stops near the cap (counted from its length, about 3.6 letters a token), and it goes on: an answer, or a tool call (with the app\'s tools it often acts, as Bash).`,
    'Speeds are the server\'s own counts: reading the app\'s instructions and tools (not cached), and writing a small module with thinking off.',
    'Pass: every check passes; the speeds are measured, not judged.',
  ].map((m) => `<li>${m}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#ffffff;--ink:#1c1b18;--mute:#6b675e;--faint:#a19c90;--line:#e3dfd5;--soft:#efece4;--up:#1d7a46;--down:#b3261e}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--up:#5fd08f;--down:#ff8a80}}
:root[data-theme="dark"]{--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--up:#5fd08f;--down:#ff8a80}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;padding:14px 16px;gap:10px;overflow:hidden}
header{flex:none;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px}
h1{font-size:21px;margin:0;letter-spacing:-.01em}.date{color:var(--mute);font-size:13px}
.tabs{flex:none;display:flex;flex-wrap:wrap;gap:6px}
.tabs button{font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.panel{flex:1;min-height:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;overflow:hidden;display:flex;flex-direction:column;gap:12px}
.panel[hidden]{display:none}
.verdict{font-size:17px;margin:0;max-width:1100px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--soft);color:var(--mute)}
.chip.ok{color:var(--up)}.chip.no{color:var(--down)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 14px}.card .k{color:var(--mute);font-size:12.5px}.card .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.card .s{color:var(--mute);font-size:12.5px}
.table-wrap{min-height:0;overflow:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12.5px;color:var(--mute);font-weight:600}th small{display:block;color:var(--faint);font-weight:400;font-size:11.5px}
td.num,th.num{text-align:right}.ok{color:var(--up)}.no{color:var(--down)}
ul.how{margin:0;padding-left:20px;max-width:1100px}ul.how li{margin:0 0 6px}ul.how code{overflow-wrap:anywhere}
code{font-size:.9em;background:var(--soft);padding:1px 5px;border-radius:5px}
@media (max-width:760px),(max-height:520px){body{overflow:auto;height:auto}.panel{overflow:visible}}
td.wrap{white-space:normal;min-width:320px}
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><span class="date">${esc(dateline)}</span></header>
<nav class="tabs" role="tablist">
<button role="tab" aria-selected="true" data-tab="result">Result</button>
<button role="tab" aria-selected="false" data-tab="checks">Checks</button>
<button role="tab" aria-selected="false" data-tab="how">How it was measured</button>
</nav>
<section class="panel" id="result"><p class="verdict">${esc(verdict)}</p><div class="chips">${chips}</div><div class="cards">${cards}</div></section>
<section class="panel" id="checks" hidden><div class="table-wrap"><table>
<thead><tr><th>Result</th><th>Check</th><th>What happened</th></tr></thead>
<tbody>${tr}</tbody></table></div></section>
<section class="panel" id="how" hidden><ul class="how">${method}<li>Raw results: ${raw.map((r) => `<code>${esc(r)}</code>`).join(', ')}</li></ul></section>
<script>
(function () {
  var tabs = document.querySelectorAll('.tabs button');
  function show(id) {
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.id !== id; });
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
  }
  tabs.forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.tab); }); });
  var h = location.hash.slice(1);
  if (document.getElementById(h)) show(h);
})();
</script>
</body>
</html>
`;
}
