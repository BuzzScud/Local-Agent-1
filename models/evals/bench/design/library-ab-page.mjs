// The results page of the design library's before/after (library-ab.mjs): one self-contained page in
// docs/tests/, tabs that fit the window (1 · Verdict, a tab of pages for each service, a blind vote, the
// library, notes), the pictures inside it, no address and no home path. With --record (or record: true)
// its line goes in the test record.
//   node models/evals/bench/design/library-ab-page.mjs <results folder> [<results folder>…] [--record]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { recordTest, codeLabel } from '../../../index.mjs';
import { studioDir, readManifest, libraryDir, librarySummary, readLooks } from '../../../../terminal/index.mjs';
import { docsPath } from '../../../../docs/tools/to-docs.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const mmss = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
// The rule, written before the runs: after holds when it makes at least as many pages, with fewer layout
// problems on them, and takes at most 25% more time a page.
export const RULE = 'after holds when it makes at least as many pages, has fewer layout problems, and takes at most 25% more time a page';

export function readRuns(dir) {
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  const rows = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  return { dir, run, rows };
}

export function sums(rows, arm) {
  const r = rows.filter((x) => x.arm === arm);
  const made = r.filter((x) => x.page);
  return {
    runs: r.length,
    made: made.length,
    clean: made.filter((x) => Array.isArray(x.problems) && !x.problems.length).length,
    problems: made.reduce((n, x) => n + (x.problems?.length ?? 0), 0),
    secs: median(r.map((x) => x.secs)),
    sentBack: r.filter((x) => x.pageBack).length,
  };
}

export function verdictOf(rows) {
  const b = sums(rows, 'before');
  const a = sums(rows, 'after');
  const holds = a.made >= b.made && a.problems < b.problems && (b.secs == null || a.secs == null || a.secs <= b.secs * 1.25);
  return { before: b, after: a, holds };
}

const picture = (dir, rel) => {
  if (!rel) return null;
  const f = join(dir, rel);
  if (!existsSync(f)) return null;
  return `data:image/${/\.png$/.test(f) ? 'png' : 'jpeg'};base64,${readFileSync(f).toString('base64')}`;
};

function launchTable(services) {
  const rows = [
    ['Pages made', 'higher is better', (s) => s.made, (s) => `${s.made} of ${s.runs}`, 'high'],
    ['Clean pages', 'no layout problem · higher is better', (s) => s.clean, (s) => `${s.clean}`, 'high'],
    ['Layout problems', 'on the pages made · lower is better', (s) => s.problems, (s) => `${s.problems}`, 'low'],
    ['Time a page', 'the middle run · lower is better', (s) => s.secs, (s) => mmss(s.secs), 'low'],
    ['Sent back to write it', 'answered with no page · lower is better', (s) => s.sentBack, (s) => `${s.sentBack}`, 'low'],
  ];
  const head = services.map((s) => `<th colspan="2">${esc(s.run.label)} <span class="dim">${esc(s.run.model)}</span></th>`).join('');
  const sub = services.map(() => '<th class="b">Before</th><th class="a">After</th>').join('');
  const body = rows.map(([name, dir, val, show, way]) => `<tr><td><b>${esc(name)}</b><div class="dim">${esc(dir)}</div></td>${services.map((s) => {
    const v = verdictOf(s.rows);
    const x = val(v.before), y = val(v.after);
    const best = x == null || y == null || x === y ? null : (way === 'high' ? (y > x ? 'a' : 'b') : (y < x ? 'a' : 'b'));
    return `<td class="${best === 'b' ? 'best' : ''} num">${show(v.before)}</td><td class="${best === 'a' ? 'best' : ''} num">${show(v.after)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="launch"><thead><tr><th></th>${head}</tr><tr><th></th>${sub}</tr></thead><tbody>${body}</tbody></table>`;
}

function pagesTab(s) {
  const ids = [...new Set(s.rows.map((r) => r.id))];
  const cards = ids.map((id) => {
    const pair = ['before', 'after'].map((arm) => s.rows.find((r) => r.id === id && r.arm === arm));
    const name = pair.find(Boolean)?.name ?? id;
    const kind = pair.find(Boolean)?.kind ?? '';
    const half = (r, arm) => {
      if (!r) return `<div class="half"><div class="thumb none">not run</div><p class="cap ${arm[0]}">${arm === 'before' ? 'Before' : 'After'}</p></div>`;
      const src = picture(s.dir, r.shot);
      const probs = r.problems ?? [];
      const chip = !r.page ? '<span class="chip bad">no page</span>' : probs.length ? `<span class="chip wait">${probs.length} problem${probs.length === 1 ? '' : 's'}</span>` : '<span class="chip good">clean</span>';
      const tip = esc([r.page ? `${r.page}` : 'no page made', ...probs.map((p) => `• ${p}`), r.design ? `Design: ${r.design}` : '', r.pageBack ? 'Sent back once to write the page.' : ''].filter(Boolean).join('\n'));
      return `<div class="half"><button class="thumb" data-full="${src ? 'y' : ''}" data-tip="${tip}" aria-label="${esc(`${name}, ${arm}`)}">${src ? `<img src="${src}" alt="">` : '<span class="none">no picture</span>'}</button><p class="cap ${arm[0]}">${arm === 'before' ? 'Before' : 'After'} ${chip} <span class="dim">${mmss(r.secs)}</span></p></div>`;
    };
    return `<article class="pc"><h3>${esc(name)} <span class="dim">${esc(kind)}</span></h3><div class="pair">${half(pair[0], 'before')}${half(pair[1], 'after')}</div></article>`;
  }).join('');
  return `<div class="grid4">${cards}</div>`;
}

// Pairs for the blind vote: both arms made a picture. Which side is which is fixed by the pair's name.
function votePairs(services) {
  const out = [];
  for (const s of services) {
    for (const id of [...new Set(s.rows.map((r) => r.id))]) {
      const b = s.rows.find((r) => r.id === id && r.arm === 'before');
      const a = s.rows.find((r) => r.id === id && r.arm === 'after');
      const pb = b && picture(s.dir, b.shot), pa = a && picture(s.dir, a.shot);
      if (!pb || !pa) continue;
      const flip = [...`${s.run.label}${id}`].reduce((n, c) => n + c.charCodeAt(0), 0) % 2 === 1;
      out.push({ key: `${s.run.label}:${id}`, title: `${a.name} · ${s.run.label}`, left: flip ? pa : pb, right: flip ? pb : pa, leftIs: flip ? 'after' : 'before' });
    }
  }
  return out;
}

function libraryTab() {
  const dir = studioDir();
  const sum = librarySummary(dir);
  const lib = libraryDir(dir);
  const m = lib ? readManifest(lib) : { pieces: {} };
  const why = new Map();
  for (const p of Object.values(m.pieces)) {
    const k = p.needs ? "needs its library's own script" : Array.isArray(p.check) ? p.check[0].replace(/\s*\([^)]*\)/g, '').replace(/:.*$/, '').replace(/"[^"]*"/g, '').replace(/ at 1440×900| on a phone| in dark mode|^On a phone /g, '').replace(/\..*$/, '').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()) : null;
    if (k) why.set(k, (why.get(k) ?? 0) + 1);
  }
  const looks = readLooks(lib).sort((a, b) => a.name.localeCompare(b.name));
  const sources = sum.rows.filter((r) => r[0] !== 'Looks').map(([n, t]) => `<tr><td><b>${esc(n)}</b></td><td>${esc(t)}</td></tr>`).join('');
  const held = [...why].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, n]) => `<li><span class="num">${n}</span> ${esc(k)}</li>`).join('');
  const sw = looks.map((l) => `<div class="look" title="${esc(`${l.name} · ${l.mode}${l.font ? ` · ${l.font.split(',')[0]}` : ''}`)}"><span class="sw" style="background:${l.vars.paper};border-color:${l.vars.line}"><i style="background:${l.vars.accent}"></i><b style="color:${l.vars.ink}">Aa</b></span><span class="ln">${esc(l.name)}</span></div>`).join('');
  return `<div class="two"><section><h2>What was downloaded</h2><table class="src"><tbody>${sources}</tbody></table><h2>Kept but never picked</h2><ul class="held">${held || '<li>none</li>'}</ul><p class="dim">A piece is picked only when it passes the same browser check your own pieces pass (a desktop, a phone, dark mode). The rest stay in the folder, by path, for the model to read when it wants.</p></section><section><h2>${looks.length} looks <span class="dim">· "like Linear" in a request, or /design look linear</span></h2><div class="looks">${sw}</div></section></div>`;
}

const CSS = `:root{color-scheme:light dark;--bg:#f7f6f2;--card:#fff;--sub:#f1efe9;--text:#1c1b18;--text-2:#5f5b53;--line:#e3dfd5;--accent:#1f66bd;--b:#2563eb;--a:#c2410c;--good:#1f7a3d;--good-soft:#e3f2e7;--wait:#8a5a00;--wait-soft:#fbefd5;--bad:#b42318;--bad-soft:#fbe4e1}
@media (prefers-color-scheme:dark){:root{--bg:#15161a;--card:#1d1f24;--sub:#24262c;--text:#ecebe6;--text-2:#a4a19a;--line:#34363e;--accent:#6aa5ec;--b:#6ea8ff;--a:#ff9a5c;--good:#6fcf8f;--good-soft:#173523;--wait:#e8b04a;--wait-soft:#3a2c10;--bad:#f28b82;--bad-soft:#3d1a18}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{max-width:1440px;margin:0 auto;padding:14px 20px 8px;display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline;justify-content:space-between}h1{font-size:21px;margin:0}.dim{color:var(--text-2);font-weight:400}
nav{display:flex;flex-wrap:wrap;gap:6px}nav button{font:inherit;font-size:14px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}nav button[aria-selected=true]{background:var(--text);color:var(--card);border-color:var(--text)}nav button:focus-visible,.thumb:focus-visible,.vote button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{max-width:1440px;margin:0 auto;padding:4px 20px 20px}section.tab{display:none}section.tab.on{display:block}h2{font-size:17px;margin:14px 0 8px}h3{font-size:15px;margin:0 0 8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px;margin:8px 0 14px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.big{font-size:26px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}.grade{display:flex;gap:14px;align-items:center}
.launch{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}.launch th,.launch td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:left}.launch .num{text-align:right;font-variant-numeric:tabular-nums}.launch th.b{color:var(--b)}.launch th.a{color:var(--a)}.launch td.best{background:var(--good-soft);font-weight:650}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;background:var(--sub);color:var(--text)}.chip.good{background:var(--good-soft);color:var(--good)}.chip.wait{background:var(--wait-soft);color:var(--wait)}.chip.bad{background:var(--bad-soft);color:var(--bad)}
.grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px}.pc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px 12px}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.thumb{display:block;width:100%;aspect-ratio:16/10;padding:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--sub);cursor:zoom-in;color:var(--text-2);font:inherit}.thumb img{width:100%;height:100%;object-fit:cover;object-position:top}.thumb.none,.none{display:grid;place-items:center;cursor:default;font-size:13px}.cap{margin:4px 0 0;font-size:13px}.cap.b{color:var(--b)}.cap.a{color:var(--a)}
.vote{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.vote figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px}.vote img{width:100%;max-height:52vh;object-fit:contain;object-position:top;border-radius:8px;border:1px solid var(--line)}.vote .bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.vote button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}.vote button.main{background:var(--accent);color:#fff;border-color:var(--accent)}
.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:20px}.src{width:100%;border-collapse:collapse}.src td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}.held{margin:0;padding-left:18px}.held .num{display:inline-block;min-width:3ch;font-weight:650;font-variant-numeric:tabular-nums}
.looks{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px}.look{display:flex;align-items:center;gap:6px;font-size:12px;min-width:0}.sw{position:relative;flex:none;width:34px;height:24px;border:1px solid;border-radius:6px;display:grid;place-items:center}.sw i{position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-radius:50%}.sw b{font-size:11px}.ln{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.notes{max-width:980px}.notes li{margin:4px 0}
dialog{max-width:min(1200px,94vw);border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--text);padding:12px}dialog img{width:100%;border-radius:8px}dialog pre{white-space:pre-wrap;font:13px/1.4 inherit;margin:8px 0 0}
@media (max-width:900px){.two,.vote{grid-template-columns:minmax(0,1fr)}}`;

export async function buildLibraryPage(dirs, { record = false, out } = {}) {
  const services = dirs.map(readRuns);
  const day = new Date().toLocaleDateString('en-CA');
  const verdicts = services.map((s) => ({ s, v: verdictOf(s.rows) }));
  const pairs = votePairs(services);
  const glance = verdicts.map(({ s, v }) => `<div class="card"><div class="grade"><span class="big" style="color:${v.holds ? 'var(--good)' : 'var(--wait)'}">${v.holds ? 'Holds' : 'Not yet'}</span><span><b>${esc(s.run.label)}</b> <span class="dim">${esc(s.run.model)}</span><br><span class="dim">${v.after.made} of ${v.after.runs} pages after (${v.before.made} before) · ${v.after.problems} layout problems after (${v.before.problems} before; fewer is better) · ${mmss(v.after.secs)} a page after (${mmss(v.before.secs)} before)</span></span></div></div>`).join('');
  const tabs = [
    ['verdict', 'Verdict', `<div class="cards">${glance}</div><div class="chips"><span class="chip">The rule, set before the runs: ${esc(RULE)}</span><span class="chip">${services[0]?.run.prompts?.length ?? 0} requests a service · one run each</span></div>${launchTable(services)}<p class="dim">Before: ${esc(services[0]?.run.arms.find((a) => a.id === 'before')?.what ?? '')}. After: ${esc(services[0]?.run.arms.find((a) => a.id === 'after')?.what ?? '')}. Every page measured by the same layout check (a desktop, a phone, dark mode, every button clicked). Click a picture on the next tabs for its problems.</p>`],
    ...services.map((s) => [`pages-${s.run.label.replace(/\W+/g, '-')}`, `Pages · ${s.run.label}`, pagesTab(s)]),
    ['vote', 'Blind vote', pairs.length ? `<p class="dim">Which page looks better? The names show after your vote. Your votes stay in this browser.</p><div id="vote"></div>` : '<p>No pair with a picture on both sides.</p>'],
    ['library', 'The library', libraryTab()],
    ['notes', 'Notes', `<div class="notes"><h2>How this was measured</h2><ul><li>Each request ran with <code>coding -p</code> in an empty folder and a throwaway home on a model on another machine, once with the code before the library and once with this code; 15 minutes at most a run.</li><li>Before used the design examples as they were (the four cards this round added left out); after used the library's pieces and looks, the taste, slide deck, poster and diagram cards, and the fixes (a page asked for and none written goes back once to write it; a closed &lt;details&gt; no longer reads as overlapping text; "pricing page" means pricing).</li><li>Layout problems are what a browser measures (text over text, too faint, too small, sideways scrolling on a phone, script errors). They are not taste: the pictures and the blind vote are for that.</li><li>One run each: a single run of a model says little; the Arena's "Design library before/after" runs it again.</li></ul><h2>Qwen3.6 on the shared service</h2><ul><li>This afternoon, 9 of 10 Qwen3.6 runs made no page, before and after alike. Its replies belonged to other requests: a media-player request was answered with a boarding-pass plan written 8 minutes earlier (in the arm whose code never writes plans), and a file card was written into another user's project folder on the same service.</li><li>That is the service mixing requests, not this app: worth checking how that server shares its model between users.</li></ul></div>`],
  ];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design library before/after</title><style>${CSS}</style></head>
<body><header><h1>Design library: before and after <span class="dim">· ${esc(day)} · ${services.map((s) => esc(s.run.label)).join(' and ')} · code ${esc(codeLabel())}</span></h1><nav role="tablist">${tabs.map(([id, name], i) => `<button role="tab" id="t-${id}" aria-controls="${id}" aria-selected="${i === 0}">${i + 1} · ${esc(name)}</button>`).join('')}</nav></header>
<main>${tabs.map(([id, , body], i) => `<section class="tab${i === 0 ? ' on' : ''}" id="${id}" role="tabpanel" aria-labelledby="t-${id}">${body}</section>`).join('')}</main>
<dialog id="dlg"><form method="dialog" style="text-align:right"><button>Close</button></form><img id="dlg-img" alt=""><pre id="dlg-tip"></pre></dialog>
<script>
const PAIRS=${JSON.stringify(pairs)};
const tabs=[...document.querySelectorAll('nav button')],panes=[...document.querySelectorAll('section.tab')];
function show(i){i=(i+tabs.length)%tabs.length;tabs.forEach((t,j)=>t.setAttribute('aria-selected',j===i));panes.forEach((p,j)=>p.classList.toggle('on',j===i));try{history.replaceState(null,'','#'+panes[i].id)}catch(e){}}
tabs.forEach((t,i)=>t.addEventListener('click',()=>show(i)));
addEventListener('keydown',e=>{if(e.target.closest('input,textarea')||document.querySelector('dialog[open]'))return;const i=tabs.findIndex(t=>t.getAttribute('aria-selected')==='true');if(/^[1-9]$/.test(e.key)&&+e.key<=tabs.length)show(+e.key-1);if(e.key==='ArrowRight')show(i+1);if(e.key==='ArrowLeft')show(i-1)});
const at=panes.findIndex(p=>'#'+p.id===location.hash);if(at>=0)show(at);
document.querySelectorAll('.thumb').forEach(b=>b.addEventListener('click',()=>{const img=b.querySelector('img');if(!img)return;document.getElementById('dlg-img').src=img.src;document.getElementById('dlg-tip').textContent=b.dataset.tip;document.getElementById('dlg').showModal()}));
const KEY='library-vote-${day}';let votes={};try{votes=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
let k=0;const box=document.getElementById('vote');
function tally(){const v=Object.values(votes);return {after:v.filter(x=>x==='after').length,before:v.filter(x=>x==='before').length,same:v.filter(x=>x==='same').length}}
function draw(){if(!box)return;const p=PAIRS[k],mine=votes[p.key],t=tally();const name=(side)=>mine?(' · '+(side==='L'?p.leftIs:(p.leftIs==='after'?'before':'after'))):'';
box.innerHTML='<div class="bar"><b>'+(k+1)+' of '+PAIRS.length+' · '+p.title+'</b><span class="chip">After won '+t.after+' · Before won '+t.before+' · Same '+t.same+'</span><button id="pv">← Back</button><button id="nx">Next →</button></div><div class="vote"><figure><img src="'+p.left+'" alt="Page A"><figcaption><button class="main" data-v="L">A is better'+name('L')+'</button></figcaption></figure><figure><img src="'+p.right+'" alt="Page B"><figcaption><button class="main" data-v="R">B is better'+name('R')+'</button></figcaption></figure></div><div class="bar"><button data-v="S">About the same</button>'+(mine?'<span class="chip good">You picked '+(mine==='same'?'the same':mine)+'</span>':'')+'</div>';
box.querySelectorAll('[data-v]').forEach(b=>b.addEventListener('click',()=>{const v=b.dataset.v;votes[p.key]=v==='S'?'same':v==='L'?p.leftIs:(p.leftIs==='after'?'before':'after');try{localStorage.setItem(KEY,JSON.stringify(votes))}catch(e){}draw()}));
document.getElementById('pv').onclick=()=>{k=(k-1+PAIRS.length)%PAIRS.length;draw()};document.getElementById('nx').onclick=()=>{k=(k+1)%PAIRS.length;draw()};}
if(PAIRS.length)draw();
</script></body></html>
`;
  const file = out ?? docsPath(`tests/agentic-coder-design-library-${day}.html`);
  writeFileSync(file, html.split(homedir()).join('~')); // no home path on a page (bun run docs checks)
  let line = null;
  if (record) {
    const held = verdicts.filter((x) => x.v.holds).length;
    line = recordTest({
      kind: 'other', name: 'Design library before/after', model: services.map((s) => s.run.model).join(', '), passed: held, total: services.length,
      secs: services.reduce((n, s) => n + s.rows.reduce((m, r) => m + (r.secs ?? 0), 0), 0),
      note: verdicts.map(({ s, v }) => `${s.run.label}: ${v.after.made}/${v.after.runs} pages, ${v.after.problems} problems after vs ${v.before.made}/${v.before.runs}, ${v.before.problems} before`).join('; '),
      raw: services[0]?.dir, page: `tests/${basename(file)}`, bar: RULE,
    });
  }
  return { page: file, line, verdicts: verdicts.map(({ s, v }) => ({ label: s.run.label, ...v })) };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dirs = argv.filter((a) => !a.startsWith('--'));
  if (!dirs.length) { console.error('give the results folders (docs/private/design-runs/library-…)'); process.exit(2); }
  const r = await buildLibraryPage(dirs, { record: argv.includes('--record') });
  for (const v of r.verdicts) console.log(`${v.holds ? 'PASS' : 'FAIL'} ${v.label}: ${v.after.made}/${v.after.runs} pages, ${v.after.problems} problems, ${mmss(v.after.secs)} a page after · ${v.before.made}/${v.before.runs}, ${v.before.problems}, ${mmss(v.before.secs)} before`);
  console.log(`page: ${r.page}`);
}
