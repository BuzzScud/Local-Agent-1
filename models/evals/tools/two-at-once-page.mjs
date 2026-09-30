// The results page of the two-at-once speed check (two-at-once.mjs): one self-contained HTML file
// for the DOCS folder, opened from the run's line in the hub's Tests tab. Tabs that fit the window:
// Result · Rounds · How it was measured.
//   buildTwoPage({ title, dateline, s, rows, bar, raw }) → html
//     s     the run's summary.json; rows its rows.json (one a round: apart, together, ratio)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function buildTwoPage({ title, dateline = '', s, rows = [], bar = 1.25, raw = [] }) {
  const full = !s.stopped;
  const verdict = `${!full ? `Stopped after ${s.rounds} of ${s.of} rounds: ` : s.pass ? 'Worth it: ' : 'Not worth it: '}two tries at once wrote ${n1(s.togetherTps)} tokens a second, one after the other ${n1(s.apartTps)}, so ×${s.ratio.toFixed(2)}.`;
  const pairMs = rows.reduce((n, r) => n + r.together.ms, 0), soloMs = rows.reduce((n, r) => n + r.apart.ms, 0);
  const chips = [
    `<span class="chip ${full ? (s.pass ? 'ok' : 'no') : ''}">${full ? (s.pass ? '✓' : '✗') : '·'} At least ×${bar} the tokens a second: ×${s.ratio.toFixed(2)}</span>`,
    `<span class="chip">· Speed helper ${s.draft ? 'on' : 'off'}</span>`,
    `<span class="chip">· Mac load ${esc(s.load)} at the end</span>`,
  ].join('');
  const card = (k, v, sub) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const cards = [
    card('At once', `${n1(s.togetherTps)}`, 'tokens a second, both slots together · higher is better'),
    card('One after the other', `${n1(s.apartTps)}`, 'tokens a second, one slot · higher is better'),
    card('Gain', `×${s.ratio.toFixed(2)}`, `pass at ×${bar} · higher is better`),
    card('Time for the pairs', `${secs(pairMs)} vs ${secs(soloMs)}`, 'at once vs one after the other · lower is better'),
  ].join('');
  const tr = rows.map((r) => `<tr><td>${r.round}</td><td>${r.first === 'apart' ? 'one after the other' : 'at once'}</td>
<td class="num">${secs(r.apart.ms)}</td><td class="num">${r.apart.tokens}</td><td class="num">${n1(r.apart.tps)}</td>
<td class="num">${secs(r.together.ms)}</td><td class="num">${r.together.tokens}</td><td class="num">${n1(r.together.tps)}</td>
<td class="num ${r.ratio >= bar ? 'ok' : 'no'}">×${r.ratio.toFixed(2)}</td></tr>`).join('');
  const method = [
    'Each round the model writes the same two pieces of code twice: one after the other on slot 1 (the way tries ran until 30 Sep 2026), and at once, one on slot 1 and one on slot 0 (the chat’s slot, idle while a focused path runs). The way that goes first swaps every round, so a busy Mac hurts both alike.',
    `On its own server with the app’s settings: ${Number(s.ctx).toLocaleString('en-US')} tokens of memory shared by both slots, the speed helper ${s.draft ? 'on' : 'off'}. Thinking off, the model’s own sampling at temperature 0.7 (a second try’s), at most ${s.maxTokens} tokens each, prompts not cached, so both ways read them the same.`,
    'Tokens a second = all tokens written in that way ÷ the wall-clock seconds it took, reading the prompts included. The time for the pairs is what you wait for two tries.',
    `Pass: at least ×${bar} the tokens a second over the whole run (the rule written before the first run).`,
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
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><span class="date">${esc(dateline)}</span></header>
<nav class="tabs" role="tablist">
<button role="tab" aria-selected="true" data-tab="result">Result</button>
<button role="tab" aria-selected="false" data-tab="rounds">Rounds</button>
<button role="tab" aria-selected="false" data-tab="how">How it was measured</button>
</nav>
<section class="panel" id="result"><p class="verdict">${esc(verdict)}</p><div class="chips">${chips}</div><div class="cards">${cards}</div></section>
<section class="panel" id="rounds" hidden><div class="table-wrap"><table>
<thead><tr><th>Round</th><th>Went first</th><th class="num">One after the other<small>seconds · lower is better</small></th><th class="num">tokens</th><th class="num">tokens/s<small>higher is better</small></th><th class="num">At once<small>seconds · lower is better</small></th><th class="num">tokens</th><th class="num">tokens/s<small>higher is better</small></th><th class="num">Gain<small>higher is better</small></th></tr></thead>
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
