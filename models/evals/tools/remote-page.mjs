// The results page of the remote check (remote-check.mjs): one self-contained
// HTML file for the DOCS folder, opened from the run's line in the hub's Tests
// tab. Tabs that fit the window: Result · The checks · How it was measured.
//   buildRemotePage({ summary, rows, prev, raw }) → html
//     rows  [{ id, name, ok, detail, secs }]; prev: the run before on the same model ({ s, rows }) or null
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = (x) => (x == null ? '—' : `${x < 10 ? x.toFixed(1) : Math.round(x)} s`);

export function buildRemotePage({ summary: s, rows, prev = null, raw = [] }) {
  const title = `Remote check · ${s.name}`;
  const before = prev ? Object.fromEntries(prev.rows.map((r) => [r.id, r])) : {};
  const failed = rows.filter((r) => !r.ok);
  const verdict = s.stopped
    ? `Stopped after ${s.checks} of ${s.of} checks: ${s.passed} passed.`
    : s.pass
      ? `Yes: all ${s.of} checks passed. A model served by <b>coding serve</b> behind its key was used as a remote, the llama.cpp way and the OpenAI-compatible way, and a wrong key was refused.`
      : `No: ${failed.length} of ${s.of} checks failed (${failed.map((r) => esc(r.name)).join('; ')}).`;
  const card = (k, v, sub, dir) => `<div class="card"><div class="k">${esc(k)} · ${esc(dir)}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`;
  const cards = [
    card('Checks passed', `${s.passed} of ${s.of}`, prev ? `before: ${prev.s.passed} of ${prev.s.of}` : 'no run before this one', 'higher is better'),
    card('Model loaded by coding serve', sec(s.loadSecs), prev ? `before: ${sec(prev.s.loadSecs)}` : `${Math.round(16384 / 1024)}k context`, 'lower is faster'),
    card('An answer through the remote', sec(s.answerSecs), `median of the coding -p runs${prev ? ` · before: ${sec(prev.s.answerSecs)}` : ''}`, 'lower is faster'),
  ].join('');
  const table = `<table><thead><tr><th>#</th><th>Check</th><th>Result</th><th class="num">Seconds<small>lower is faster</small></th>${prev ? '<th class="num">Before<small>seconds</small></th>' : ''}<th>What it showed</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="dim">${i + 1}</td><td><b>${esc(r.name)}</b></td><td class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓ passed' : '✗ failed'}</td><td class="num">${sec(r.secs)}</td>${prev ? `<td class="num dim">${before[r.id] ? `${sec(before[r.id].secs)}${before[r.id].ok ? '' : ' ✗'}` : '—'}</td>` : ''}<td class="what" title="${esc(r.detail)}">${esc(r.detail)}</td></tr>`).join('')}</tbody></table>`;
  const how = [
    `<b>coding serve --local</b> loaded ${esc(s.name)} at 16k in a throwaway home whose engine and model files are links to the ones in ~/.agentic-coder, on port ${s.port}, with a new API key (made by serve, kept in a file readable by you only).`,
    'Agentic Coder ran from a second throwaway home with /remote on (127.0.0.1, that port, the key) and asked through <b>coding -p</b>, first as a llama.cpp server, then as an OpenAI-compatible one (only the standard fields sent). Effort Low, no memory, no helpers.',
    'The questions: “What is 6 times 7?” (it must say 42) and “What is the secret word in README.md?” (it must read the file and say pineapple).',
    'A wrong key must end the run with an error that says the key was not accepted, and no answer.',
    'A window in the serving home, with /remote off, must use the served model with its key, not load a second copy.',
    'serve then gets ctrl+c: its model server and its registry file must be gone.',
    'Not in it: the SSH tunnel (it needs ssh into this Mac, usually off; a stand-in ssh tests it in the unit tests), https with a certificate, and a server on another machine.',
    `Nothing in ~/.agentic-coder was written but this run’s line in the test record. The Mac’s load at the end: ${s.load}. Code: ${esc(s.code)}.`,
    ...(raw.length ? [`Raw results, on this Mac: ${raw.map((r) => `<code>${esc(r)}</code>`).join(', ')} (serve’s output there has the key taken out).`] : []),
  ];
  const tabs = [['result', 'Result'], ['checks', 'The checks'], ['how', 'How it was measured']];
  const panels = {
    result: `<p class="verdict">${verdict}</p><div class="chips"><span class="chip ${s.pass ? 'ok' : 'no'}">${s.pass ? '✓' : '✗'} pass: all ${s.of} checks</span><span class="chip">${esc(s.sub)}</span></div><div class="cards">${cards}</div><ol class="list">${rows.map((r) => `<li><span class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'}</span> ${esc(r.name)} <span class="dim">· ${sec(r.secs)}</span></li>`).join('')}</ol><p class="dim small">Tab 2 has what each check showed.</p>`,
    checks: `<div class="table-wrap">${table}</div>`,
    how: `<ul class="how">${how.map((h) => `<li>${h}</li>`).join('')}</ul>`,
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
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;table-layout:auto}
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
