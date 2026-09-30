// The results page of the design before/after test (run.mjs): one
// self-contained HTML file in docs/gemma-docs/test/, built from every
// model's saved runs for that day, with the screenshots inside it. Four tabs
// that each fit the window: the verdict and the table, the pages side by side,
// every problem the check found, and how it was run.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const PAGE_OUT = (root, date) => join(root, 'docs', 'gemma-docs', 'test', `design-examples-results-${date}.html`);

// models/<model>/results/design-bench-<date>/ for every model that has one.
export function resultsDirs(root, date) {
  const models = join(root, 'models');
  return readdirSync(models).map((m) => join(models, m, 'results', `design-bench-${date}`)).filter((d) => existsSync(join(d, 'runs.json')));
}

const ARM_ORDER = ['today', 'cards', 'full', 'opus', 'fable'];
const ARM_LABEL = { today: 'Today (no cards)', cards: 'Cards, all sets', full: 'Cards + layout check', opus: 'Opus cards only', fable: 'Fable cards only' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const img = (dir, f) => {
  if (!f) return '';
  try { return `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(join(dir, f)).toString('base64')}`; } catch { return ''; }
};

function summary(runs) {
  const done = runs.filter((r) => r.problems);
  const avg = (f) => (done.length ? done.reduce((s, r) => s + f(r), 0) / done.length : null);
  return {
    runs: runs.length, made: runs.filter((r) => r.file).length, clean: done.filter((r) => !r.problems.length).length, measured: done.length,
    problems: avg((r) => r.problems.length), secs: runs.length ? runs.reduce((s, r) => s + r.secs, 0) / runs.length : null,
    sideways: done.filter((r) => r.problems.some((p) => /scrolls sideways|cut off at the edge/.test(p))).length,
    faint: done.filter((r) => r.problems.some((p) => /too faint/.test(p))).length,
    errors: done.filter((r) => r.problems.some((p) => /reports an error/.test(p))).length,
    head: done.filter((r) => r.problems.some((p) => /no <meta/.test(p))).length,
  };
}

export function buildPage({ dirs, out }) {
  const all = [];
  for (const d of dirs) { try { for (const r of JSON.parse(readFileSync(join(d, 'runs.json'), 'utf8'))) all.push({ ...r, dir: join(d, r.arm, r.page) }); } catch {} }
  if (!all.length) return null;
  const models = [...new Set(all.map((r) => r.name))];
  const arms = ARM_ORDER.filter((a) => all.some((r) => r.arm === a));
  const pages = [...new Set(all.map((r) => r.page))];
  const by = (model, arm) => all.filter((r) => r.name === model && r.arm === arm);
  const S = Object.fromEntries(models.map((m) => [m, Object.fromEntries(arms.map((a) => [a, summary(by(m, a))]))]));

  // The verdict: the arm with the most clean pages against today, per model.
  const verdicts = models.map((m) => {
    const t = S[m].today;
    const best = arms.filter((a) => a !== 'today').sort((a, b) => S[m][b].clean - S[m][a].clean || (S[m][a].problems ?? 99) - (S[m][b].problems ?? 99))[0];
    if (!t || !best) return `${m}: only one arm was run, so there is nothing to compare yet.`;
    const b = S[m][best];
    const word = b.clean > t.clean ? 'better' : b.clean < t.clean ? 'worse' : (b.problems ?? 0) < (t.problems ?? 0) ? 'a little better' : 'no better';
    return `${m}: ${word} with ${ARM_LABEL[best].toLowerCase()}. ${b.clean} of ${b.measured} pages came out with no layout problems, against ${t.clean} of ${t.measured} today (${(t.problems ?? 0).toFixed(1)} → ${(b.problems ?? 0).toFixed(1)} problems a page).`;
  });

  const ROWS = [
    ['Pages with no layout problems', 'higher is better', (s) => s.clean, (s) => `${s.clean} of ${s.measured}`, 'max'],
    ['Layout problems a page', 'lower is better', (s) => s.problems, (s) => (s.problems == null ? '—' : s.problems.toFixed(1)), 'min'],
    ['Pages that scroll sideways or are cut off', 'lower is better', (s) => s.sideways, (s) => String(s.sideways), 'min'],
    ['Pages with text too faint to read', 'lower is better', (s) => s.faint, (s) => String(s.faint), 'min'],
    ['Pages with a script error', 'lower is better', (s) => s.errors, (s) => String(s.errors), 'min'],
    ['Pages missing charset or viewport', 'lower is better', (s) => s.head, (s) => String(s.head), 'min'],
    ['Time a page', 'lower is better', (s) => s.secs, (s) => (s.secs == null ? '—' : mmss(s.secs)), 'min'],
  ];
  const table = (m) => `<div class="wrap"><table><thead><tr><th>${esc(m)}</th>${arms.map((a) => `<th class="n">${esc(ARM_LABEL[a])}</th>`).join('')}</tr></thead><tbody>${ROWS.map(([name, dir, v, show, want]) => {
    const vals = arms.map((a) => v(S[m][a])).filter((x) => x != null);
    const best = vals.length ? (want === 'max' ? Math.max(...vals) : Math.min(...vals)) : null;
    const ties = arms.filter((a) => v(S[m][a]) === best).length;
    return `<tr><td class="bench"><b>${esc(name)}</b> <span>· ${esc(dir)}</span></td>${arms.map((a) => `<td class="n${best != null && v(S[m][a]) === best && ties < arms.length ? ' best' : ''}">${esc(show(S[m][a]))}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;

  const gallery = models.map((m) => pages.map((p) => `<div class="gal" data-model="${esc(m)}" data-page="${esc(p)}" hidden><div class="shots" style="--n:${arms.length}">${arms.map((a) => {
    const r = all.find((x) => x.name === m && x.arm === a && x.page === p);
    if (!r) return `<figure class="shot"><figcaption><b>${esc(ARM_LABEL[a])}</b><span>not run</span></figcaption></figure>`;
    const n = r.problems?.length;
    return `<figure class="shot"><figcaption><b>${esc(ARM_LABEL[a])}</b><span class="tag ${n === 0 ? 'ok' : n == null ? 'idle' : 'warn'}">${r.file ? (n == null ? 'not measured' : n === 0 ? 'no problems' : `${n} problem${n === 1 ? '' : 's'}`) : 'no page made'}</span><span class="t">${mmss(r.secs)}</span></figcaption>
      <div class="pair">${r.shots?.desktop ? `<img class="d" alt="${esc(`${p}, ${ARM_LABEL[a]}, at 1440 px`)}" src="${img(r.dir, r.shots.desktop)}">` : '<div class="none">no picture</div>'}${r.shots?.phone ? `<img class="p" alt="${esc(`${p}, ${ARM_LABEL[a]}, on a phone`)}" src="${img(r.dir, r.shots.phone)}">` : ''}</div></figure>`;
  }).join('')}</div></div>`).join('')).join('');

  const problems = `<div class="wrap tall"><table><thead><tr><th>Model</th><th>Page</th><th>Arm</th><th>What the check found</th></tr></thead><tbody>${all.sort((a, b) => a.name.localeCompare(b.name) || pages.indexOf(a.page) - pages.indexOf(b.page) || ARM_ORDER.indexOf(a.arm) - ARM_ORDER.indexOf(b.arm)).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.page)}</td><td>${esc(ARM_LABEL[r.arm])}</td><td class="wrapcell">${!r.file ? '<span class="tag idle">no page made</span>' : r.problems == null ? `<span class="tag idle">not measured</span> ${esc(r.skipped)}` : r.problems.length ? `<ol>${r.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<span class="tag ok">no problems</span>'}${r.layoutNotes?.length ? `<div class="sub">During the run: ${esc(r.layoutNotes.join(' '))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`;

  const when = all.map((r) => r.at).sort()[0]?.slice(0, 10) ?? '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design examples: before and after</title>
<style>
:root{color-scheme:light dark;--bg:#f7f6f2;--card:#fff;--ink:#1c1b18;--mute:#6b675e;--line:#e3dfd5;--soft:#efece4;--best:#f3d9cc;--bestInk:#8a3a1c;--ok-bg:#e3f2e6;--ok:#1e6b34;--warn-bg:#fbf0d9;--warn:#7a5200;--idle-bg:#eeede7;--idle:#55544f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--ok-bg:#1f3a26;--ok:#8fd4a2;--warn-bg:#3a2e12;--warn:#f0cf87;--idle-bg:#2a2a27;--idle:#bdbcb4}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1640px;margin:0 auto;padding:18px 20px 24px}
header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}h1{font-size:21px;margin:0;font-weight:680}.dateline{color:var(--mute);font-size:13px}
nav{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 14px}
nav button{font:inherit;font-size:14px;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
nav button[aria-selected=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
[hidden]{display:none!important}
h2{font-size:22px;margin:0 0 6px;font-weight:650}.lead{font-size:16px;max-width:1000px;margin:0 0 6px}.lead+.lead{margin-top:0}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,760px),1fr));gap:12px;margin-top:10px}
.wrap{overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}.wrap.tall{max-height:calc(100vh - 170px)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:7px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-size:13px;color:var(--mute);font-weight:600;background:var(--soft);position:sticky;top:0}
tr:last-child td{border-bottom:0}.n{text-align:right;white-space:nowrap}
td.bench{white-space:nowrap}td.bench b{font-weight:600}td.bench span{color:var(--mute);font-size:12.5px}
td.best{background:var(--best);color:var(--bestInk);font-weight:700}
.wrapcell ol{margin:0;padding-left:18px}.wrapcell li{margin:2px 0}.sub{color:var(--mute);font-size:13px;margin-top:4px}
.tag{display:inline-block;font-size:12.5px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
.tag.ok{background:var(--ok-bg);color:var(--ok)}.tag.warn{background:var(--warn-bg);color:var(--warn)}.tag.idle{background:var(--idle-bg);color:var(--idle)}
.pick{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 10px}.pick span{color:var(--mute);font-size:13px;margin-right:4px}
.pick button{font:inherit;font-size:13px;padding:4px 11px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.pick button[aria-pressed=true]{border-color:var(--ink);font-weight:600}
.shots{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:12px}
.shot{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;min-width:0}
.shot figcaption{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}.shot figcaption .t{color:var(--mute);font-size:13px;margin-left:auto}
.pair{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:8px;align-items:start}
.pair img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block}
.none{color:var(--mute);font-size:13px;padding:30px 0;text-align:center}
.how{max-width:1100px}.how li{margin:4px 0}.prompt{font-size:13.5px;color:var(--mute)}
@media (max-width:900px){.shots{grid-template-columns:1fr}}
</style></head><body><main>
<header><h1>Design examples: before and after</h1><span class="dateline">${esc(when)} · ${esc(models.join(' and '))} · ${arms.length} arm${arms.length === 1 ? '' : 's'} × ${pages.length} pages</span></header>
<nav role="tablist">
<button role="tab" data-t="verdict" aria-selected="true">1 · The verdict</button><button role="tab" data-t="side">2 · Side by side</button><button role="tab" data-t="problems">3 · Every problem</button><button role="tab" data-t="how">4 · How it was run</button>
</nav>
<section id="verdict">
<h2>Did the pages get better?</h2>
${verdicts.map((v) => `<p class="lead">${esc(v)}</p>`).join('')}
<div class="cols">${models.map(table).join('')}</div>
</section>
<section id="side" hidden>
<h2>The same request, each arm</h2>
<div class="pick"><span>Model</span>${models.map((m, i) => `<button data-m="${esc(m)}" aria-pressed="${i === 0}">${esc(m)}</button>`).join('')}</div>
<div class="pick"><span>Page</span>${pages.map((p, i) => `<button data-p="${esc(p)}" aria-pressed="${i === 0}">${esc(p)}</button>`).join('')}</div>
${gallery}
</section>
<section id="problems" hidden><h2>Everything the layout check found, page by page</h2>${problems}</section>
<section id="how" hidden><div class="how">
<h2>How it was run</h2>
<p class="lead">Each request ran in an empty folder with the real model, the way <code>coding -p</code> runs it, once per arm. Every page was then measured the same way, whatever the arm: opened in headless Chrome at 1440×900, on a 390-wide phone and in dark mode, and checked for sideways scroll, text that overlaps, runs out of its box or is too faint, script errors, and a missing charset or viewport line.</p>
<ul>${arms.map((a) => `<li><b>${esc(ARM_LABEL[a])}</b></li>`).join('')}</ul>
<h3>The requests (your own, from Agentic Coder's history)</h3>
<ol>${pages.map((p) => { const r = all.find((x) => x.page === p); return `<li><b>${esc(p)}</b>${r?.cards ? ` <span class="prompt">· cards used: ${esc(r.cards.replace(/^Design examples: /, ''))}</span>` : ''}</li>`; }).join('')}</ol>
<p class="prompt">Raw results: ${dirs.map((d) => esc(d.split('/models/')[1] ? `models/${d.split('/models/')[1]}` : d)).join(' · ')}</p>
</div></section>
</main>
<script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('[role=tab]'));
  function show(id){tabs.forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.t===id));});[].slice.call(document.querySelectorAll('main>section')).forEach(function(s){s.hidden=s.id!==id;});try{history.replaceState(null,'','#'+id);}catch(e){}window.scrollTo(0,0);}
  tabs.forEach(function(b){b.onclick=function(){show(b.dataset.t);};});
  addEventListener('keydown',function(e){var n=parseInt(e.key,10);if(n>=1&&n<=tabs.length)show(tabs[n-1].dataset.t);var i=tabs.findIndex(function(b){return b.getAttribute('aria-selected')==='true';});if(e.key==='ArrowRight'&&tabs[i+1])show(tabs[i+1].dataset.t);if(e.key==='ArrowLeft'&&tabs[i-1])show(tabs[i-1].dataset.t);});
  var m=null,p=null;
  function gal(){[].slice.call(document.querySelectorAll('.gal')).forEach(function(g){g.hidden=!(g.dataset.model===m&&g.dataset.page===p);});}
  [].slice.call(document.querySelectorAll('[data-m]')).forEach(function(b){if(b.getAttribute('aria-pressed')==='true')m=b.dataset.m;b.onclick=function(){m=b.dataset.m;[].slice.call(document.querySelectorAll('[data-m]')).forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});gal();};});
  [].slice.call(document.querySelectorAll('[data-p]')).forEach(function(b){if(b.getAttribute('aria-pressed')==='true')p=b.dataset.p;b.onclick=function(){p=b.dataset.p;[].slice.call(document.querySelectorAll('[data-p]')).forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});gal();};});
  gal();
  var h=(location.hash||'').slice(1);show(document.getElementById(h)?h:'verdict');
})();
</script>
</body></html>
`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}
