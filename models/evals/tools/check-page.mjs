// The results page of a check made of named steps (the Vision check, and the
// next ones): one self-contained HTML file for the DOCS folder, opened from the
// run's line in the hub's Tests tab. Tabs that fit the window: Result · The
// checks · How it was measured.
//   buildCheckPage({ title, summary, rows, prev, cards, how, raw, pass }) → html
//     summary  { name, of, checks, passed, pass, stopped, sub }
//     rows     [{ id, name, ok, detail, secs }]; prev: the run before ({ s, rows }) or null
//     cards    [{ k, v, sub, dir }] (dir: "higher is better" / "lower is faster")
//     how      HTML list items written by the caller (never a model's words)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sec = (x) => (x == null ? '—' : `${x < 10 ? x.toFixed(1) : Math.round(x)} s`);

//     verdict  the first line, when the pass rule is not "every check" (HTML the caller wrote)
//     first    false: no "Checks passed" card (the caller's cards say what passed)
export function buildCheckPage({ title, summary: s, rows, prev = null, cards = [], how = [], raw = [], passRule = `all ${s.of} checks`, yes = '', verdict: said = null, first = true }) {
  const before = prev ? Object.fromEntries(prev.rows.map((r) => [r.id, r])) : {};
  const failed = rows.filter((r) => !r.ok);
  const verdict = said && !s.stopped ? said : s.stopped
    ? `Stopped after ${s.checks} of ${s.of} checks: ${s.passed} passed.`
    : s.pass ? `Yes: all ${s.of} checks passed.${yes ? ` ${yes}` : ''}` : `No: ${failed.length} of ${s.of} checks failed (${failed.map((r) => esc(r.name)).join('; ')}).`;
  const allCards = [...(first ? [{ k: 'Checks passed', v: `${s.passed} of ${s.of}`, sub: prev ? `before: ${prev.s.passed} of ${prev.s.of}` : 'no run before this one', dir: 'higher is better' }] : []), ...cards];
  const cardHtml = allCards.map((c) => `<div class="card"><div class="k">${esc(c.k)} · ${esc(c.dir)}</div><div class="v">${esc(c.v)}</div><div class="s">${esc(c.sub)}</div></div>`).join('');
  const list = `<ol class="list">${rows.map((r) => `<li><span class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'}</span> ${esc(r.name)} <span class="dim">· ${sec(r.secs)}</span></li>`).join('')}</ol><p class="dim small">Tab 2 has what each check showed.</p>`;
  const table = `<table><thead><tr><th>#</th><th>Check</th><th>Result</th><th class="num">Seconds<small>lower is faster</small></th>${prev ? '<th class="num">Before<small>seconds</small></th>' : ''}<th>What it showed</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="dim">${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓ passed' : '✗ failed'}</td><td class="num">${sec(r.secs)}</td>${prev ? `<td class="num dim">${before[r.id] ? `${sec(before[r.id].secs)}${before[r.id].ok ? '' : ' ✗'}` : '—'}</td>` : ''}<td class="what">${esc(r.detail)}</td></tr>`).join('')}</tbody></table>`;
  const tabs = [['result', 'Result'], ['checks', 'The checks'], ['how', 'How it was measured']];
  const panels = {
    result: `<p class="verdict">${verdict}</p><div class="chips"><span class="chip ${s.pass ? 'ok' : 'no'}">${s.pass ? '✓' : '✗'} pass: ${esc(passRule)}</span><span class="chip">${esc(s.sub)}</span></div><div class="cards">${cardHtml}</div>${list}`,
    checks: `<div class="table-wrap">${table}</div>`,
    how: `<ul class="how">${[...how, ...(raw.length ? [`Raw results, on this Mac: ${raw.map((r) => `<code>${esc(r)}</code>`).join(', ')}`] : [])].map((h) => `<li>${h}</li>`).join('')}</ul>`,
  };
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
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 14px}.card .k{color:var(--mute);font-size:12.5px}.card .v{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.card .s{color:var(--mute);font-size:12.5px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
th{font-size:12.5px;color:var(--mute);font-weight:600}th small{display:block;color:var(--faint);font-weight:400;font-size:11.5px}
td.num,th.num{text-align:right}
td.what{white-space:normal;color:var(--mute);font-size:13.5px;min-width:260px}
.ok{color:var(--up)}.no{color:var(--down)}.dim{color:var(--faint)}.small{font-size:13px;margin:0}
ol.list{margin:0;padding-left:22px;columns:2 360px;column-gap:32px}ol.list li{margin:0 0 6px;break-inside:avoid}
ul.how{margin:0;padding-left:20px;max-width:1100px}ul.how li{margin:0 0 7px}ul.how code{overflow-wrap:anywhere}
code{font-size:.9em;background:var(--soft);padding:1px 5px;border-radius:5px}
@media (max-height:820px){body{padding:10px 14px;gap:8px}.panel{padding:12px 16px;gap:9px}.verdict{font-size:15px}.card .v{font-size:20px}th,td{padding:5px 10px}ul.how li{margin:0 0 4px}}
@media (max-width:760px),(max-height:560px){body{overflow:auto;height:auto}.panel{overflow:visible}.table-wrap{overflow-x:auto}td.what{min-width:220px}}
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><span class="date">${esc(s.sub)}</span></header>
<div class="tabs" role="tablist">${tabs.map(([id, name], i) => `<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${id}">${i + 1} · ${name}</button>`).join('')}</div>
${tabs.map(([id], i) => `<main class="panel" id="p-${id}"${i ? ' hidden' : ''}>${panels[id]}</main>`).join('\n')}
<script>
const tabs = [...document.querySelectorAll('[data-tab]')];
const show = (id) => { tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id))); document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== 'p-' + id; }); try { history.replaceState(null, '', '#' + id); } catch {} };
tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; const n = Number(e.key); if (n >= 1 && n <= tabs.length) show(tabs[n - 1].dataset.tab); });
const fromHash = () => { if (tabs.some((b) => '#' + b.dataset.tab === location.hash)) show(location.hash.slice(1)); };
addEventListener('hashchange', fromHash);
fromHash();
</script>
</body>
</html>
`;
}
