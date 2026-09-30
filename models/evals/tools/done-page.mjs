// The results page of the done check (done-check.mjs): one self-contained HTML file for the DOCS
// folder, opened from the run's line in the hub's Tests tab. Tabs that fit the window:
// Result · one tab a job (before, what happened now, the page it left, to click) · How it was measured.
//   buildDonePage({ title, dateline, s, rows, jobs, raw, pageOf }) → html
//     s     the run's summary.json; rows its rows (one a job: pass, why, fired, events, pages)
//     pageOf(id, rel) → the page a job left, as text (shown in a frame), or null
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

// The steps worth reading: what you sent, what it wrote, what it said, and the app's warnings.
function steps(events) {
  const out = [];
  for (const e of events ?? []) {
    if (e.type === 'send') out.push({ t: e.t, who: 'You', text: e.n > 1 ? 'Sent the same request again, in the same conversation.' : 'Sent the request.' });
    else if (e.type === 'tool' && /^(Write|Update)$/.test(e.label)) out.push({ t: e.t, who: 'Qwen', text: `${e.label === 'Write' ? 'Wrote' : 'Changed'} ${cut(e.arg, 60)}${e.error ? ' (refused)' : ''}`, tone: e.error ? 'no' : '' });
    else if (e.type === 'assistant' && e.final) out.push({ t: e.t, who: 'Qwen', text: `Said: “${cut(e.text, 240)}”` });
    else if (e.type === 'note' && e.tone === 'warn') out.push({ t: e.t, who: 'App', text: cut(e.text, 240), tone: 'warn' });
  }
  return out;
}

export function buildDonePage({ title, dateline = '', s, rows = [], jobs = {}, raw = '', pageOf = () => null }) {
  const verdict = `${s.passed} of ${s.total} job${s.total === 1 ? '' : 's'} left you without a false “done”.${s.stopped ? ' The run was stopped before the end.' : ''}`;
  const card = (r) => `<div class="card"><div class="k">${esc(r.id)} · ${esc(jobs[r.id]?.name)}</div><div class="v ${r.pass ? 'ok' : 'no'}">${r.pass ? 'Pass' : 'Fail'}</div><div class="s">${esc(r.why)}</div></div>`;
  const fired = (r) => [
    r.fired?.doneCheck ? '“done, nothing changed” sent it back' : null,
    r.fired?.nothingNote ? 'the “Nothing was changed” note showed' : null,
    r.fired?.deadSentBack ? 'a dead button was sent back' : null,
    r.fired?.stillBroken ? 'the “Still broken” line had the last word' : null,
  ].filter(Boolean);
  // What the run shows, in plain lines: which new checks acted, and any "fixed" the page check did not agree with.
  const left = rows.map((r) => ({ id: r.id, note: (r.events ?? []).filter((e) => e.type === 'note' && /problems? left/.test(e.text ?? '')).at(-1) })).filter((x) => x.note);
  const shows = [
    rows.some((r) => fired(r).length) ? `The new checks acted in ${rows.filter((r) => fired(r).length).map((r) => r.id).join(', ')}.` : 'Neither new check had to act this run: no page had a dead button, and on the second ask Qwen wrote the page again instead of answering “Done”.',
    left.length ? `Qwen said it fixed something the page check still found afterwards in ${left.map((x) => x.id).join(' and ')}: ${left.map((x) => `${x.id} · ${cut(x.note.text.replace(/^Layout check, [^:]+: \d+ problems? left \([\d.]+ s\): /, '').replace(/\.$/, ''), 110)}`).join('; ')}. ${rows.some((r) => r.fired?.stillBroken) ? 'The turn then ended with the page check’s own “Still broken” line, after Qwen’s answer.' : 'This run came before the “Still broken” line was built, so only a small note said so.'}` : null,
    'One run a job is an example, not a rate: Qwen’s pages change from run to run.',
  ].filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('');
  const chips = rows.map((r) => `<span class="chip">${esc(r.id)}: ${esc(fired(r).join(' · ') || 'no new check fired')}</span>`).join('');
  const tab = (r) => {
    const page = r.pages?.[0];
    const html = page ? pageOf(r.id, page.page) : null;
    const list = steps(r.events).map((x) => `<li class="${x.tone ?? ''}"><span class="t">${mmss(x.t)}</span><span class="who ${x.who.toLowerCase()}">${x.who}</span><span>${esc(x.text)}</span></li>`).join('');
    const probs = page ? (page.problems.length ? `<ul class="probs">${page.problems.slice(0, 4).map((p) => `<li>${esc(cut(p, 200))}</li>`).join('')}</ul>` : '<p class="ok small">The page check finds nothing wrong with it.</p>') : '';
    return `<section class="panel" id="job-${r.id}" hidden>
<p class="verdict"><b class="${r.pass ? 'ok' : 'no'}">${r.pass ? 'Pass' : 'Fail'}</b> · ${esc(r.why)}</p>
<div class="cols">
<div class="col"><h2>Before (29–30 Sep, no new checks)</h2><p class="before">${esc(jobs[r.id]?.before)}</p>
<h2>Now, step by step <small>${mmss(r.secs ?? 0)} in all</small></h2><ol class="steps">${list || '<li>No steps were saved.</li>'}</ol></div>
<div class="col"><h2>The page it left${page ? ` <small>${esc(page.page)} · click it, it is the real file</small>` : ''}</h2>
${html ? `<iframe title="The page Qwen made" sandbox="allow-scripts" srcdoc="${esc(html)}"></iframe>${probs}` : '<p class="before">No page was saved.</p>'}</div>
</div></section>`;
  };
  const method = [
    'Three jobs where Qwen said “done” and it was not true, sent again the same way: your own saved prompts from the Test builder, in a fresh empty folder that is also the home folder, so a page saved “to the Desktop” lands inside it.',
    `Thinking on at High and ${Math.round(s.ctx / 1024)}k of context, the design folder and the page check on, the way the app has them. Plans and questions are answered the way a battle answers them. Each job stops at 15 minutes.`,
    'The new checks: when Qwen says the work is done but no file changed in that message, it is sent back once, and if it still claims it, a note under its answer says nothing was changed. The page check now clicks every button in a hidden browser; one that changes nothing, even after the other buttons and with the empty boxes filled in, goes back to Qwen once. And when the page check still finds a problem after Qwen’s fix, the turn ends with a “Still broken” line after Qwen’s answer.',
    'After each job the page it left is checked again, clicks included, and that is what A and C are graded on.',
    'Pass (the rule written before the first run): A · the page has no button that changes nothing. B · on the second ask a file changes, or the answer does not claim it was done now, or the note shows. C · the page has no problem from the page check. Since 30 Sep evening a problem the turn’s last line names (“Still broken: …”, the page check’s own word after a “fixed” it does not agree with) no longer counts against A or C: you were told.',
    'One run a job: Qwen’s output changes from run to run, so this is an example, not a rate. That the checks catch the 29–30 Sep cases is shown apart from Qwen, on the recorded pages and with a stand-in model.',
    `Raw results: <code>${esc(raw)}</code>`,
  ].map((m) => `<li>${m}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#f7f6f2;--card:#ffffff;--ink:#1c1b18;--mute:#6b675e;--faint:#a19c90;--line:#e3dfd5;--soft:#efece4;--up:#1d7a46;--down:#b3261e;--warn:#8a5a00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--up:#5fd08f;--down:#ff8a80;--warn:#f0b75a}}
:root[data-theme="dark"]{--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--up:#5fd08f;--down:#ff8a80;--warn:#f0b75a}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;padding:14px 16px;gap:10px;overflow:hidden}
header{flex:none;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px}
h1{font-size:21px;margin:0;letter-spacing:-.01em}.date{color:var(--mute);font-size:13px}
h2{font-size:13px;margin:0 0 6px;color:var(--mute);font-weight:600}h2 small{font-weight:400;color:var(--faint)}
.tabs{flex:none;display:flex;flex-wrap:wrap;gap:6px}
.tabs button{font:inherit;font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.panel{flex:1;min-height:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;overflow:hidden;display:flex;flex-direction:column;gap:12px}
.panel[hidden]{display:none}
.verdict{font-size:17px;margin:0;max-width:1100px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--soft);color:var(--mute)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:10px;padding:10px 14px}.card .k{color:var(--mute);font-size:12.5px}.card .v{font-size:24px;font-weight:700}.card .s{color:var(--mute);font-size:13px}
.ok{color:var(--up)}.no{color:var(--down)}.small{font-size:13px;margin:0}
.cols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}
.col{min-height:0;display:flex;flex-direction:column}
.before{margin:0 0 12px;padding:8px 12px;background:var(--soft);border-radius:8px;font-size:14px}
ol.steps{list-style:none;margin:0;padding:0;overflow:auto;min-height:0;flex:1}
ol.steps li{display:grid;grid-template-columns:42px 44px minmax(0,1fr);gap:8px;padding:5px 0;border-bottom:1px solid var(--line);font-size:13.5px}
ol.steps li.warn span:last-child{color:var(--warn)}ol.steps li.no span:last-child{color:var(--down)}
.t{color:var(--faint);font-variant-numeric:tabular-nums}.who{font-size:12px;font-weight:600;color:var(--mute)}.who.app{color:var(--warn)}
iframe{flex:1;min-height:220px;width:100%;border:1px solid var(--line);border-radius:10px;background:#fff}
ul.probs{margin:8px 0 0;padding-left:18px;font-size:13px;color:var(--down)}
ul.how{margin:0;padding-left:20px;max-width:1100px}ul.how li{margin:0 0 6px}ul.how code{overflow-wrap:anywhere}
code{font-size:.9em;background:var(--soft);padding:1px 5px;border-radius:5px}
@media (max-width:760px),(max-height:520px){body{overflow:auto;height:auto}.panel{overflow:visible}.cols{grid-template-columns:1fr}ol.steps{overflow:visible}iframe{min-height:420px}}
</style>
</head>
<body>
<header><h1>${esc(title)}</h1><span class="date">${esc(dateline)}</span></header>
<nav class="tabs" role="tablist">
<button role="tab" aria-selected="true" data-tab="result">Result</button>
${rows.map((r) => `<button role="tab" aria-selected="false" data-tab="job-${r.id}">${esc(r.id)} · ${esc(jobs[r.id]?.name)}</button>`).join('\n')}
<button role="tab" aria-selected="false" data-tab="how">How it was measured</button>
</nav>
<section class="panel" id="result"><p class="verdict">${esc(verdict)}</p><div class="cards">${rows.map(card).join('')}</div><div class="chips">${chips}</div><h2>What this shows</h2><ul class="how">${shows}</ul></section>
${rows.map(tab).join('\n')}
<section class="panel" id="how" hidden><ul class="how">${method}</ul></section>
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
