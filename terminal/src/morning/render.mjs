// The morning brief page. One day = the day's commits drawn as terrain, three
// short acts, then Needs attention and Resolved. The page holds every saved
// day: it opens on the newest, and the calendar in the top-left corner goes
// back to any earlier morning. The drawing comes from the facts only, never
// from the words. Everything gathered is escaped; links must be https.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import FONT from './fraunces-600.woff2.b64.txt' with { type: 'text' };
import { ACTS, ACT_TIMES, clustersOf, dayOf, myCommits, shapeOf } from './day.mjs';
import { pick } from './sort.mjs';
import { plainWords } from './words.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const safeHref = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

const W = 840, H = 170, PAD = 14, BASE = 146;
const CENTRES = [140, 420, 700];

// ---- one day -----------------------------------------------------------------------------
export function buildDay(facts, words) {
  const d = dayOf(facts);
  const mine = myCommits(facts);
  const shape = shapeOf(mine);
  const xOf = (h) => {
    const i = h < 12 ? 0 : h < 18 ? 1 : 2;
    const [a, b] = ACTS[i];
    const span = (W - 2 * PAD) / 3;
    return PAD + i * span + ((h - a) / (b - a)) * span;
  };
  // Elevation = load: a soft bump per commit, weighted by its size and saturating, so a busy
  // day reads as a ridge rather than a spike; no commits → still water
  const RISE = { HEAVY: 104, NORMAL: 74, OPEN: 30 }[shape];
  const bumps = mine.map((c) => ({ x: xOf(c.h), w: 1 + Math.min(2, Math.log10(1 + c.adds + c.dels) / 2) }));
  const wobble = (x) => 0.7 * Math.sin(x * 0.19) + 0.45 * Math.sin(x * 0.053 + 1.3) + 0.3 * Math.sin(x * 0.41 + 0.4);
  const yAt = (x) => BASE - RISE * (1 - Math.exp(-bumps.reduce((s, b) => s + b.w * Math.exp(-((x - b.x) ** 2) / 450), 0) / 3)) + wobble(x);

  const terrain = () => {
    const pts = [];
    for (let x = 0; x <= W; x += 3) pts.push([x, yAt(x)]);
    // Catmull-Rom through the samples → a smooth cubic curve
    let path = `M${pts[0][0]},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
      path += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0]},${p2[1].toFixed(1)}`;
    }
    return path;
  };
  // One dot per cluster, on the line: ink when every commit in it is pushed, grey when not
  const dots = () => clustersOf(mine).map((cl) => {
    const x = cl.reduce((s, c) => s + xOf(c.h), 0) / cl.length;
    const lines = cl.reduce((s, c) => s + c.adds + c.dels, 0);
    const r = Math.min(13, 6 + (cl.length - 1) * 1.1 + Math.min(3, lines / 800));
    return `<circle cx="${x.toFixed(1)}" cy="${yAt(x).toFixed(1)}" r="${r.toFixed(1)}" fill="var(${cl.every((c) => c.pushed) ? '--ink' : '--grey'})"/>`;
  }).join('');

  // Motifs: at most one per act, and one of them in clay
  const ray = (x, y, a, r1, r2, c) => {
    const t = (a * Math.PI) / 180;
    return `<line x1="${(x + r1 * Math.cos(t)).toFixed(1)}" y1="${(y + r1 * Math.sin(t)).toFixed(1)}" x2="${(x + r2 * Math.cos(t)).toFixed(1)}" y2="${(y + r2 * Math.sin(t)).toFixed(1)}" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`;
  };
  const MOTIF = {
    moon: (x, y, c) => `<path d="M${x + 4},${y - 12} A12,12 0 1 0 ${x + 4},${y + 12} A9.5,12 0 1 1 ${x + 4},${y - 12} Z" fill="none" stroke="${c}" stroke-width="1.7" stroke-linejoin="round"/>`,
    sun: (x, y, c) => `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${c}" stroke-width="1.7"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ray(x, y, a, 13, 18, c)).join('')}`,
    sunrise: (x, _y, c) => {
      const y = yAt(x) - 2;
      return `<path d="M${x - 12},${y} A12,12 0 0 1 ${x + 12},${y}" fill="none" stroke="${c}" stroke-width="1.7"/>${[200, 240, 270, 300, 340].map((a) => ray(x, y, a, 16, 21, c)).join('')}`;
    },
    birds: (x, y, c) => [[0, 0, 1], [16, -7, 0.8], [30, 3, 0.7]].map(([dx, dy, k]) => {
      const bx = x - 12 + dx, by = y + dy, w = 7 * k;
      return `<path d="M${bx - w},${by - 3 * k} Q${bx - w / 2},${by - 5 * k} ${bx},${by} Q${bx + w / 2},${by - 5 * k} ${bx + w},${by - 3 * k}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`;
    }).join(''),
    flag: (x, _y, c) => {
      const y = yAt(x);
      return `<line x1="${x}" y1="${y.toFixed(1)}" x2="${x}" y2="${(y - 34).toFixed(1)}" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/><path d="M${x},${(y - 34).toFixed(1)} L${x + 17},${(y - 28).toFixed(1)} L${x},${(y - 22).toFixed(1)} Z" fill="${c}" stroke="${c}" stroke-width="1.2" stroke-linejoin="round"/>`;
    },
  };
  const defaultMotifs = () => {
    const m = [null, null, null];
    if (mine.some((c) => c.h < 4)) m[0] = { kind: 'moon' };
    else if (mine.some((c) => c.h >= 4 && c.h < 7.5)) m[0] = { kind: 'sunrise' };
    if (mine.some((c) => c.h >= 22)) m[2] = { kind: 'moon' };
    if (facts.projects.some((p) => p.deploy?.waiting?.length) || words.attention?.length) m[2] = { kind: 'flag' };
    ACTS.forEach(([a, b], i) => { if (!m[i] && !mine.some((c) => c.h >= a && c.h < b)) m[i] = { kind: 'birds' }; });
    if (!m.some(Boolean)) m[1] = { kind: 'sun' };
    const at = m.findIndex((x) => x?.kind === 'flag');
    m[at >= 0 ? at : m.findIndex(Boolean)].accent = true;
    return m;
  };
  const motifs = (list) => {
    let clay = false;
    return list.map((m, i) => {
      if (!m || !MOTIF[m.kind]) return '';
      const accent = m.accent && !clay;
      if (accent) clay = true;
      return MOTIF[m.kind](m.x ?? (m.kind === 'flag' ? 796 : CENTRES[i]), m.y ?? (m.kind === 'birds' ? 44 : 36), accent ? 'var(--clay)' : 'var(--ink)');
    }).join('');
  };

  // The lists
  const sentence = (item) => {
    const href = safeHref(item.sourceHref ?? item.href);
    return esc(item.text).replace(/\[\[(.+?)\]\]/, (_, phrase) => (href ? `<a href="${href}">${phrase}</a>` : phrase));
  };
  const list = (heading, items, withButtons) => {
    if (!items?.length) return '';
    return `<section><h2>${esc(heading)}</h2><ol>${items.map((it) => {
      const href = safeHref(it.href);
      const title = href ? `<a class="title" href="${href}">${esc(it.title)}</a>` : `<span class="title">${esc(it.title)}</span>`;
      const seed = withButtons && it.button?.seed ? `https://claude.ai/new?q=${encodeURIComponent(it.button.seed)}&surface=cowork&composer=mini` : null;
      return `<li><div>${title}<p>${sentence(it)}</p>${seed ? `<div><a class="btn" href="${seed}">${esc(it.button.label)}</a></div>` : ''}</div></li>`;
    }).join('')}</ol></section>`;
  };
  const nothing = !words.attention?.length && !words.resolved?.length;
  const lists = nothing ? `<p class="calm">${esc(words.nothing ?? 'Nothing needs you this morning.')}</p>`
    : list('Needs attention', words.attention, words.buttons === true) + list('Resolved', words.resolved, false);
  const sections = (words.sections ?? []).filter((x) => x.items?.length || x.prose)
    .map((x) => (x.items?.length ? list(x.heading, x.items, false) : `<section><h2>${esc(x.heading)}</h2><p class="prose">${esc(x.prose)}</p></section>`)).join('');

  const top = `<p class="date">${esc(d.label)}</p>
<h1>${esc(words.headline)}</h1>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`The day's commits drawn as terrain: ${mine.length} commits`)}">
<path d="${terrain()}" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
${dots()}
${motifs(words.motifs ?? defaultMotifs())}
</svg>
<div class="acts">${ACTS.map((_, i) => `<div class="act"><b>${esc(words.acts?.[i]?.time ?? ACT_TIMES[i])}</b><p>${esc(words.acts?.[i]?.text ?? '')}</p></div>`).join('')}</div>`;
  return {
    key: d.key, label: d.label, short: d.short, shape, commits: mine.length,
    html: `<div class="band top"><div class="inner">${top}</div></div>\n<div class="band bottom"><div class="inner">${lists}${sections}</div></div>`,
  };
}

// ---- the page ----------------------------------------------------------------------------
const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
const CSS = `@font-face{font-family:"Fraunces";font-weight:600;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${FONT.trim()}) format("woff2")}
:root{--bg:#FCFCFB;--wash:#F9F9F7;--edge:#E1E1DF;--ink:#2E2C27;--soft:#6B6A63;--grey:#B4B3A8;--hair:#E4E3DC;--clay:#C6613F;--clay-hover:#AE5133;--on-clay:#FCFCFB;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#1C1B19;--wash:#22211E;--edge:#383631;--ink:#ECEAE3;--soft:#A9A79E;--grey:#67655E;--hair:#34322E;--clay:#D2714F;--clay-hover:#E0845F;--on-clay:#1C1B19}}
*{box-sizing:border-box}
html,body{margin:0}
body{position:relative;background:var(--bg);color:var(--soft);font:15px/1.55 ${SANS};-webkit-font-smoothing:antialiased}
.top{background:var(--wash);border-bottom:1px solid var(--edge)}
.inner{max-width:860px;margin:0 auto;padding:56px 32px 44px}
.bottom .inner{padding-top:44px;padding-bottom:64px}
.date{font-size:13px;letter-spacing:.01em;margin:0 0 10px}
h1{font-family:"Fraunces",Georgia,serif;font-weight:600;font-size:40px;line-height:1.16;letter-spacing:-.012em;color:var(--ink);margin:0 0 26px;text-wrap:balance}
svg{display:block;width:100%;height:auto;overflow:visible}
.acts{display:grid;grid-template-columns:repeat(3,1fr);margin-top:16px}
.act{padding:2px 18px 0;border-left:1px solid var(--hair);min-width:0}
.act:first-child{border-left:0;padding-left:0}
.act b{display:block;color:var(--ink);font-size:14px;font-weight:600;margin-bottom:4px}
.act p{margin:0;font-size:14px;line-height:1.5}
h2{font:600 15px/1.3 ${SANS};color:var(--ink);margin:0 0 8px}
section+section{margin-top:40px}
ol{list-style:none;margin:0;padding:0;counter-reset:n}
li{display:grid;grid-template-columns:30px 1fr;padding:14px 0;border-top:1px solid var(--hair);counter-increment:n}
li::before{content:counter(n);color:var(--grey);font-size:14px;font-variant-numeric:tabular-nums;padding-top:1px}
.title{font-weight:600;color:var(--ink);text-decoration:none}
a.title:hover{text-decoration:underline;text-underline-offset:3px}
li p,.prose{margin:3px 0 0;line-height:1.55}
li p a{color:var(--soft);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px}
.btn{display:inline-block;margin-top:10px;background:var(--clay);border:1px solid var(--clay);color:var(--on-clay);border-radius:8px;padding:9px 16px;font:500 13px/1.2 ${SANS};text-decoration:none}
.btn:hover{background:var(--clay-hover);border-color:var(--clay-hover)}
.calm{margin:0;color:var(--ink)}
.cal{position:absolute;z-index:5;top:54px;left:28px;font:12px/1 ${SANS}}
.cal-toggle{display:none;align-items:center;gap:7px;margin:0;padding:5px 7px;border:0;border-radius:7px;background:none;color:var(--soft);font:13px/1 ${SANS};cursor:pointer}
.cal-toggle:hover,.cal.open .cal-toggle{background:var(--hair);color:var(--ink)}
.cal-toggle svg{width:15px;height:15px;flex:none}
.cal-panel{width:196px}
.cal-head{display:flex;align-items:center;justify-content:space-between;height:24px;margin-bottom:6px}
.cal-month{color:var(--ink);font-weight:600;font-size:13px}
.cal-head button{width:24px;height:24px;border:0;border-radius:6px;background:none;color:var(--soft);font:16px/1 ${SANS};cursor:pointer}
.cal-head button:hover:not(:disabled){background:var(--hair);color:var(--ink)}
.cal-head button:disabled{color:var(--grey);opacity:.5;cursor:default}
.cal-grid{display:grid;grid-template-columns:repeat(7,28px)}
.cal-grid .wd{height:20px;line-height:20px;text-align:center;color:var(--grey);font-size:10.5px}
.cal-grid .d{position:relative;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;color:var(--grey);font-variant-numeric:tabular-nums;text-decoration:none}
.cal-grid a.d{color:var(--ink);font-weight:600}
.cal-grid a.d::after{content:"";position:absolute;bottom:3px;left:50%;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;background:var(--soft)}
.cal-grid a.d:hover{background:var(--hair)}
.cal-grid a.d.on{box-shadow:inset 0 0 0 1.5px var(--ink)}
.cal-note{margin:10px 0 0;color:var(--grey);font-size:11.5px;line-height:1.4}
@media (max-width:1299px){
  .cal{top:14px;left:max(25px,calc((100% - 860px) / 2 + 25px))}
  .cal-toggle{display:inline-flex}
  .cal-panel{display:none;position:absolute;top:34px;left:-6px;width:auto;padding:12px 12px 10px;border:1px solid var(--hair);border-radius:10px;background:var(--bg);box-shadow:0 10px 30px rgba(0,0,0,.10)}
  .cal.open .cal-panel{display:block}
}
@media (max-width:640px){
  .inner{padding:44px 16px 32px}
  .cal{left:9px;top:10px}
  h1{font-size:30px}
  .acts{grid-template-columns:1fr}
  .act{border-left:0;border-top:1px solid var(--hair);padding:12px 0}
  .act:first-child{border-top:0;padding-top:4px}
}`;

const CAL_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';

// The calendar from the list of saved days; it follows #YYYY-MM-DD and swaps the day in
const SCRIPT = `(() => {
  const days = JSON.parse(document.getElementById('days').textContent);
  const keys = days.map((d) => d.key), byKey = Object.fromEntries(days.map((d) => [d.key, d]));
  const latest = keys[keys.length - 1];
  const view = document.getElementById('view'), cal = document.getElementById('cal');
  const grid = cal.querySelector('.cal-grid'), monthEl = cal.querySelector('.cal-month');
  const prev = cal.querySelector('[data-step="-1"]'), next = cal.querySelector('[data-step="1"]');
  const toggle = cal.querySelector('.cal-toggle'), toggleLabel = cal.querySelector('.cal-toggle span');
  const monthName = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const shift = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const first = keys[0].slice(0, 7), last = latest.slice(0, 7);
  let shown = latest, month = last;
  const wanted = () => { const k = decodeURIComponent(location.hash.slice(1)); return byKey[k] ? k : latest; };
  const close = () => { cal.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };
  function draw() {
    monthEl.textContent = monthName(month);
    prev.disabled = month <= first; next.disabled = month >= last;
    const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
    const lead = new Date(y, m, 1).getDay(), count = new Date(y, m + 1, 0).getDate();
    let html = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w) => '<span class="wd">' + w + '</span>').join('');
    for (let i = 0; i < lead; i++) html += '<span></span>';
    for (let d = 1; d <= count; d++) {
      const k = month + '-' + String(d).padStart(2, '0');
      html += byKey[k]
        ? '<a class="d' + (k === shown ? ' on' : '') + '" href="#' + k + '" title="' + byKey[k].label + '"' + (k === shown ? ' aria-current="date"' : '') + '>' + d + '</a>'
        : '<span class="d">' + d + '</span>';
    }
    grid.innerHTML = html;
  }
  function show() {
    const k = wanted();
    if (k !== shown) { view.replaceChildren(document.getElementById('d-' + k).content.cloneNode(true)); shown = k; window.scrollTo(0, 0); }
    month = k.slice(0, 7);
    toggleLabel.textContent = byKey[k].short;
    close();
    draw();
  }
  prev.addEventListener('click', () => { month = shift(month, -1); draw(); });
  next.addEventListener('click', () => { month = shift(month, 1); draw(); });
  toggle.addEventListener('click', (e) => { e.stopPropagation(); toggle.setAttribute('aria-expanded', String(cal.classList.toggle('open'))); });
  document.addEventListener('click', (e) => { if (!cal.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const i = keys.indexOf(wanted()) + (e.key === 'ArrowLeft' ? -1 : 1);
    if (keys[i]) location.hash = keys[i];
  });
  window.addEventListener('hashchange', show);
  show();
})();`;

export function pageHtml(days, { calendar = true } = {}) {
  const latest = days.at(-1);
  const n = days.length;
  const cal = calendar ? `<div class="cal" id="cal">
<button class="cal-toggle" type="button" aria-expanded="false" aria-controls="cal-panel" title="Earlier mornings">${CAL_ICON}<span>${esc(latest.short)}</span></button>
<div class="cal-panel" id="cal-panel" role="dialog" aria-label="Earlier mornings">
<div class="cal-head"><button type="button" data-step="-1" aria-label="Previous month">‹</button><span class="cal-month"></span><button type="button" data-step="1" aria-label="Next month">›</button></div>
<div class="cal-grid"></div>
<p class="cal-note">${esc(`${n === 1 ? 'One morning' : `${n} mornings`} saved${n > 1 ? ' · ← → step through them' : ''}`)}</p>
</div>
</div>` : '';
  const data = JSON.stringify(days.map((d) => ({ key: d.key, label: d.label, short: d.short }))).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Morning brief</title>
<style>
${CSS}
</style>
</head>
<body>
${cal}
<main id="view">
${latest.html}
</main>
${calendar ? `${days.map((d) => `<template id="d-${d.key}">${d.html}</template>`).join('\n')}\n<script type="application/json" id="days">${data}</script>\n<script>${SCRIPT}</script>` : ''}
</body>
</html>
`;
}

// ---- history -----------------------------------------------------------------------------
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// A second run for the same day wins; the earlier one moves to earlier/<its time>/
export function saveDay(config, facts, words, day) {
  const dir = join(config.history, day.key);
  mkdirSync(dir, { recursive: true });
  const prev = readJson(join(dir, 'facts.json'));
  if (prev?.generated && prev.generated !== facts.generated) {
    const earlier = join(dir, 'earlier', prev.generated.replace(/[:.]/g, '-'));
    mkdirSync(earlier, { recursive: true });
    for (const f of ['facts.json', 'words.json', 'brief.html']) if (existsSync(join(dir, f))) renameSync(join(dir, f), join(earlier, f));
  }
  writeFileSync(join(dir, 'facts.json'), JSON.stringify(facts, null, 2));
  writeFileSync(join(dir, 'words.json'), JSON.stringify(words, null, 2));
  writeFileSync(join(dir, 'brief.html'), pageHtml([day], { calendar: false }));
  return dir;
}

export function savedDays(config) {
  if (!existsSync(config.history)) return [];
  return readdirSync(config.history).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().flatMap((k) => {
    const facts = readJson(join(config.history, k, 'facts.json'));
    if (!facts?.projects) return [];
    const words = readJson(join(config.history, k, 'words.json')) ?? plainWords(facts, pick(facts, config));
    try { return [buildDay(facts, words)]; } catch { return []; }
  });
}

// Save this day (unless save: false), then write the page from every saved day.
// With no facts, the page is rebuilt from the history alone.
export function writeBrief({ config, facts, words, save = true, out = config.out }) {
  const current = facts ? buildDay(facts, words) : null;
  const saved = current && save ? saveDay(config, facts, words, current) : null;
  const days = savedDays(config).filter((x) => x.key !== current?.key);
  if (current) days.push(current);
  days.sort((a, b) => a.key.localeCompare(b.key));
  if (!days.length) throw new Error(`Nothing to draw: no facts and no saved days in ${config.history}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, pageHtml(days));
  return { out, saved, days: days.map((x) => x.key), day: current ?? days.at(-1) };
}
