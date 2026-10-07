// The results page of the UI component battle (components.mjs): one
// self-contained HTML file for a day, built from every model's saved runs, with
// the pictures and the pages themselves inside it. Six tabs that each fit the
// window (seven when the studio part ran): the verdict, the card pick, the
// battle (Gemma against Qwen with the folder on), before and after (the folder
// off against on), the design studio against the cards, every problem the
// layout check found, and how it was run. The picture tabs are a blind vote:
// which model (or which side) made a picture shows only once you
// have voted on it. Votes are kept in the browser (localStorage), not in the file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const ARM = { on: 'full', off: 'today', studio: 'studio' };
const ARM_NAME = { on: 'Folder on', off: 'Folder off', studio: 'Studio on' };
const img = (dir, f) => {
  if (!f) return '';
  try { return `data:image/${f.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(join(dir, f)).toString('base64')}`; } catch { return ''; }
};
// Which side a picture goes on: the same every build, and no pattern to learn.
const flip = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 2) === 1; };

// One side (folder on or off) of one model's runs, over the requests given.
function side(runs, arm, ids) {
  const rs = runs.filter((r) => r.arm === ARM[arm] && ids.includes(r.page));
  const measured = rs.filter((r) => r.problems);
  return {
    runs: rs.length, made: rs.filter((r) => r.file).length, clean: measured.filter((r) => !r.problems.length).length, measured: measured.length,
    problems: measured.reduce((s, r) => s + r.problems.length, 0), carried: rs.filter((r) => r.cards).length,
    pieces: rs.filter((r) => /^Design studio\b/.test(r.cards ?? '')).length,
    secs: rs.length ? rs.reduce((s, r) => s + r.secs, 0) / rs.length : null,
  };
}

// What one model's run says: both sides, and whether the folder is working on
// it by the rule (a fitting card for every request, carried on every folder-on
// run, and no more layout problems with the folder on: counted on the requests
// that have a measured page on both sides).
export function modelSummary({ picks = [], runs = [], requests }) {
  const ids = requests.map((p) => p.id);
  const on = side(runs, 'on', ids), off = side(runs, 'off', ids);
  const measured = (arm, id) => runs.find((r) => r.arm === ARM[arm] && r.page === id && r.problems);
  const both = ids.filter((id) => measured('on', id) && measured('off', id));
  const sum = (arm) => both.reduce((s, id) => s + measured(arm, id).problems.length, 0);
  const picked = picks.filter((k) => ids.includes(k.id));
  const picksOk = picked.length > 0 && picked.every((k) => k.pass);
  const carriedAll = on.runs > 0 && on.carried === on.runs;
  const noWorse = both.length > 0 && sum('on') <= sum('off');
  // The studio part: against the folder-on pages, on the requests measured on both (no rule: a look).
  const studio = side(runs, 'studio', ids);
  const pair = ids.filter((id) => measured('studio', id) && measured('on', id));
  const over = (arm) => pair.reduce((s, id) => s + measured(arm, id).problems.length, 0);
  return { on, off, studio, both: both.length, onBoth: sum('on'), offBoth: sum('off'), picksOk, carriedAll, noWorse, working: picksOk && carriedAll && noWorse,
    studioPair: pair.length, studioBoth: over('studio'), onStudioBoth: over('on') };
}

// "Design examples: your rules/rules + fable/widget (≈1,500 tokens)." → the card names
// ("Design studio: your rules/rules + studio/cards/stat-card (…)" → with the pieces).
const carriedCards = (note) => (note ? String(note).replace(/^Design (?:examples|studio)[^:]*:\s*/, '').replace(/\s*\(≈[^)]*\)\.?\s*$/, '').split(' + ').map((x) => x.trim()).filter(Boolean) : []);

export function buildBattlePage({ dirs, date, requests, rule }) {
  const models = [];
  for (const d of dirs) {
    let runs = [];
    let pick = null;
    try { runs = JSON.parse(readFileSync(join(d, 'runs.json'), 'utf8')); } catch { continue; }
    try { pick = JSON.parse(readFileSync(join(d, 'pick.json'), 'utf8')); } catch { /* an older run */ }
    if (!runs.length) continue;
    models.push({ id: runs[0].model, name: runs[0].name, dir: d, runs, pick, effort: runs[0].effort, code: runs[0].code });
  }
  if (!models.length) return null;
  models.sort((a, b) => a.name.localeCompare(b.name));
  const reqs = requests.filter((p) => models.some((m) => m.runs.some((r) => r.page === p.id)));
  if (!reqs.length) return null;
  for (const m of models) m.s = modelSummary({ picks: m.pick?.picks ?? [], runs: m.runs, requests: reqs });
  const picks = models.find((m) => m.pick)?.pick ?? null;
  const pickOf = (id) => picks?.picks.find((k) => k.id === id) ?? null;
  const runOf = (m, id, arm) => m.runs.find((r) => r.page === id && r.arm === ARM[arm]) ?? null;
  const label = (p) => `${p.n != null ? `${p.n} · ` : ''}${p.name ?? p.id}`;

  // What the two picture tabs draw from: every run, its pictures and its page.
  const data = { key: `agentic-ui-battle-${date}`, models: models.map((m) => ({ id: m.id, name: m.name })), requests: reqs.map((p) => ({ id: p.id, label: label(p) })), runs: {}, battle: [], before: [], studio: [] };
  const hasStudio = models.some((m) => m.s.studio.runs);
  const ARMS = hasStudio ? ['on', 'off', 'studio'] : ['on', 'off'];
  for (const m of models) {
    for (const p of reqs) {
      for (const arm of ARMS) {
        const r = runOf(m, p.id, arm);
        if (!r) continue;
        const keep = join(m.dir, ARM[arm], p.id);
        let html = '';
        try { if (r.file) html = readFileSync(join(keep, r.file.split('/').pop()), 'utf8'); } catch { /* the page is gone: the pictures stay */ }
        data.runs[`${m.id}|${p.id}|${arm}`] = {
          made: Boolean(r.file), problems: r.problems ? r.problems.length : null, secs: Math.round(r.secs), time: r.reason === 'time', cards: carriedCards(r.cards),
          desktop: img(keep, r.shots?.desktop), phone: img(keep, r.shots?.phone), html,
        };
      }
    }
  }
  const has = (m, id, arm) => Boolean(data.runs[`${m.id}|${id}|${arm}`]);
  if (models.length >= 2) {
    const [a, b] = models;
    for (const p of reqs) if (has(a, p.id, 'on') && has(b, p.id, 'on')) data.battle.push({ id: `battle|${p.id}`, req: p.id, sides: flip(`${date}|${p.id}|battle`) ? [`${b.id}|${p.id}|on`, `${a.id}|${p.id}|on`] : [`${a.id}|${p.id}|on`, `${b.id}|${p.id}|on`] });
  }
  for (const m of models) for (const p of reqs) if (has(m, p.id, 'on') && has(m, p.id, 'studio')) data.studio.push({ id: `studio|${m.id}|${p.id}`, req: p.id, model: m.id, sides: flip(`${date}|${p.id}|${m.id}|studio`) ? [`${m.id}|${p.id}|studio`, `${m.id}|${p.id}|on`] : [`${m.id}|${p.id}|on`, `${m.id}|${p.id}|studio`] });
  for (const m of models) for (const p of reqs) if (has(m, p.id, 'on') && has(m, p.id, 'off')) data.before.push({ id: `before|${m.id}|${p.id}`, req: p.id, model: m.id, sides: flip(`${date}|${p.id}|${m.id}`) ? [`${m.id}|${p.id}|off`, `${m.id}|${p.id}|on`] : [`${m.id}|${p.id}|on`, `${m.id}|${p.id}|off`] });

  // 1 · The verdict.
  const verdicts = models.map((m) => {
    const s = m.s;
    if (!s.on.runs) return `<b>${esc(m.name)}</b>: the folder-on part has not run yet.`;
    const why = [
      s.picksOk ? 'every request got a fitting card' : 'a request got no fitting card',
      s.carriedAll ? `all ${s.on.runs} folder-on runs carried their cards` : `only ${s.on.carried} of ${s.on.runs} folder-on runs carried the cards`,
      !s.both ? 'there is no pair of measured pages to compare yet' : `the folder-on pages have ${s.onBoth} layout problem${s.onBoth === 1 ? '' : 's'} against ${s.offBoth} with it off`,
    ];
    const word = !s.off.runs || !s.both ? 'not decided yet' : s.working ? 'the folder is working' : 'the folder is not working';
    const studio = !s.studio.runs ? '' : ` <b>The studio</b>: ${s.studio.clean} of ${s.studio.runs} pages with no layout problems${s.studioPair ? `, ${s.studioBoth} problem${s.studioBoth === 1 ? '' : 's'} in all against ${s.onStudioBoth} with the cards on the same requests` : ''}; pieces went along on ${s.studio.pieces} of ${s.studio.runs} runs.`;
    return `<b>${esc(m.name)}</b>: ${word}. ${`${why.slice(0, -1).join(', ')}, and ${why.at(-1)}`.replace(/^./, (c) => c.toUpperCase())}.${studio}`;
  });
  const chips = models.flatMap((m) => [
    { text: `${m.name}: a fitting card for every request`, ok: m.s.picksOk },
    { text: `${m.name}: cards on ${m.s.on.carried} of ${m.s.on.runs} folder-on runs`, ok: m.s.on.runs ? m.s.carriedAll : null },
    { text: `${m.name}: layout problems on ${m.s.onBoth} ≤ off ${m.s.offBoth}`, ok: m.s.both ? m.s.noWorse : null },
    ...(m.s.studio.runs ? [{ text: `${m.name}: studio problems ${m.s.studioBoth} ≤ cards ${m.s.onStudioBoth}`, ok: m.s.studioPair ? m.s.studioBoth <= m.s.onStudioBoth : null }] : []),
  ]);
  const cols = models.flatMap((m) => ARMS.map((arm) => ({ m, arm, s: m.s[arm] })));
  const ROWS = [
    ['Pages made', 'higher is better', (c) => (c.s.runs ? c.s.made : null), (c) => `${c.s.made} of ${c.s.runs}`, 'max'],
    ['Pages with no layout problems', 'higher is better', (c) => (c.s.runs ? c.s.clean : null), (c) => `${c.s.clean} of ${c.s.runs}`, 'max'],
    ['Layout problems in all', 'lower is better', (c) => (c.s.measured ? c.s.problems : null), (c) => String(c.s.problems), 'min'],
    ['Time a page', 'lower is better', (c) => c.s.secs, (c) => mmss(c.s.secs), 'min'],
    ['Runs that carried the design cards', `on: every run · off: none${hasStudio ? ' · studio: its pieces' : ''}`, (c) => (c.s.runs ? c.s.carried : null), (c) => `${c.s.carried} of ${c.s.runs}`, null],
  ];
  const table = `<div class="wrap"><table><thead><tr><th rowspan="2">Measure</th>${models.map((m) => `<th class="n grp" colspan="${ARMS.length}">${esc(m.name)}</th>`).join('')}</tr>
<tr>${cols.map((c) => `<th class="n">${ARM_NAME[c.arm]}</th>`).join('')}</tr></thead><tbody>${ROWS.map(([name, dir, v, show, want]) => {
    const vals = cols.map(v).filter((x) => x != null);
    const best = want && vals.length ? (want === 'max' ? Math.max(...vals) : Math.min(...vals)) : null;
    const ties = cols.filter((c) => v(c) === best).length;
    return `<tr><td class="bench"><b>${esc(name)}</b> <span>· ${esc(dir)}</span></td>${cols.map((c) => `<td class="n${best != null && v(c) === best && ties < cols.length ? ' best' : ''}">${v(c) == null ? '<span class="dim">not run</span>' : esc(show(c))}</td>`).join('')}</tr>`;
  }).join('')}
<tr><td class="bench"><b>Your vote: the better looking page</b> <span>· higher is better</span></td>${cols.map((c) => `<td class="n" data-votecell="${esc(c.m.id)}|${c.arm}"><span class="dim">no votes yet</span></td>`).join('')}</tr>
</tbody></table></div>`;

  // 2 · The card pick.
  const inRun = (m, p) => {
    const r = runOf(m, p.id, 'on');
    if (!r) return '<span class="tag idle">not run</span>';
    const got = carriedCards(r.cards);
    if (!got.length) return '<span class="tag bad">no cards carried</span>';
    const want = pickOf(p.id)?.sent ?? [];
    const same = want.length === got.length && want.every((c) => got.includes(c));
    return same ? '<span class="tag ok">carried, the same cards</span>' : `<span class="tag warn">carried other cards</span><div class="sub">${esc(got.join(' + '))}</div>`;
  };
  const pickTable = `<div class="wrap"><table><thead><tr><th>Request</th><th>Seen as a page request</th><th>Rules card</th><th>Example card</th><th>Look</th><th>Other cards that fit</th><th class="n">Sent along</th>${models.map((m) => `<th>In ${esc(m.name)}’s run</th>`).join('')}</tr></thead><tbody>${reqs.map((p) => {
    const k = pickOf(p.id);
    if (!k) return `<tr><td><b>${esc(label(p))}</b></td><td colspan="6"><span class="dim">no card pick saved for this request</span></td>${models.map((m) => `<td>${inRun(m, p)}</td>`).join('')}</tr>`;
    return `<tr><td><b>${esc(label(p))}</b></td><td>${k.page ? '<span class="tag ok">yes</span>' : '<span class="tag bad">no</span>'}</td><td class="nw">${k.rules.length ? esc(k.rules.join(', ')) : '<span class="dim">none</span>'}</td>
<td class="nw">${k.example ? `${esc(k.example)} ${k.fits ? '<span class="tag ok">fits its words</span>' : '<span class="tag warn">fallback card</span>'}` : '<span class="tag bad">none</span>'}</td><td class="nw">${k.look ? esc(k.look) : '<span class="dim">none asked for</span>'}</td>
<td class="small">${k.more.length ? esc(k.more.join(', ')) : '<span class="dim">none</span>'}</td><td class="n">${k.chars ? `${k.chars.toLocaleString('en-US')} characters` : '<span class="dim">nothing</span>'}</td>${models.map((m) => `<td>${inRun(m, p)}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
  const folder = picks?.folder ? picks.folder.map((s) => `${s.set} ${s.cards}`).join(' · ') : '';

  // 5 · Every problem.
  const rows = models.flatMap((m) => reqs.flatMap((p) => ARMS.map((arm) => ({ m, p, arm, r: runOf(m, p.id, arm) })))).filter((x) => x.r);
  const problems = `<div class="wrap tall"><table><thead><tr><th>Model</th><th>Request</th><th>Part</th><th class="n">Time</th><th>What the layout check found in the page it ended with</th></tr></thead><tbody>${rows.map(({ m, p, arm, r }) => `<tr><td>${esc(m.name)}</td><td>${esc(label(p))}</td><td class="nw">${ARM_NAME[arm]}</td><td class="n">${mmss(r.secs)}${r.reason === 'time' ? '<div class="sub">stopped at the limit</div>' : ''}</td><td class="wrapcell">${!r.file ? '<span class="tag bad">no page made</span>' : r.problems == null ? `<span class="tag idle">not measured</span> ${esc(r.skipped)}` : r.problems.length ? `<ol>${r.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<span class="tag ok">no problems</span>'}${r.layoutNotes?.length ? `<div class="sub">During the run: ${esc(r.layoutNotes.join(' '))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`;

  // 6 · How it was run.
  const when = models.flatMap((m) => m.runs.map((r) => r.at)).sort()[0];
  const how = [
    `${models.map((m) => `${esc(m.name)}${m.effort === 'high' ? ', thinking on at High' : ', thinking off'}`).join(' · ')}. One model at a time, each request in an empty folder, the way <code>coding -p</code> runs it, with the tests’ settings (32k of memory unless the Tests page’s panel changed it).`,
    '<b>Part 1 · Card pick</b> needs no model: the app’s own code says whether a request is a page request and which cards go along.',
    '<b>Part 2 · Folder on</b>: the cards of every set and the layout check, which sends what it finds back to the model once. <b>Part 3 · Folder off</b>: neither.',
    ...(hasStudio ? ['<b>Part 4 · Studio on</b>: the design studio’s pieces that fit the request (real code with Tailwind classes, in your colours) in the example card’s place, the rules card, the CSS for the page’s classes built into it after every change, and the layout check. Its vote is against the folder-on page.'] : []),
    'Every page was then measured the same way, whichever part made it: opened in headless Chrome at 1440×900, on a 390-wide phone and in dark mode, and checked for sideways scroll, text that overlaps, runs out of its box or is too faint, script errors, and a missing charset or viewport line. The pictures are 900×620 and a 390-wide phone.',
    `The rules, written before the first run: a page passes when one was made and the layout check finds nothing; the folder is working on a model when there is ${esc(rule)}; the battle gives a point for a clean folder-on page and a point for your vote.`,
    `Code: ${[...new Set(models.map((m) => m.code))].map((c) => `<code>${esc(c)}</code>`).join(', ')}. First run ${esc(new Date(when).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }))}. Raw results: ${models.map((m) => `<code>${esc(m.dir.split('/models/')[1] ? `models/${m.dir.split('/models/')[1]}` : m.dir)}</code>`).join(' · ')}.`,
  ];

  const tabs = [['verdict', 'The verdict'], ['pick', 'Card pick'], ['battle', 'The battle'], ['before', 'Before and after'], ...(hasStudio ? [['studio', 'Studio vs cards']] : []), ['problems', 'Every problem'], ['how', 'How it was run']];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>UI component battle</title>
<style>
:root{color-scheme:light dark;--bg:#f7f6f2;--card:#fff;--ink:#1c1b18;--mute:#6b675e;--line:#e3dfd5;--soft:#efece4;--best:#f3d9cc;--bestInk:#8a3a1c;--ok-bg:#e3f2e6;--ok:#1e6b34;--warn-bg:#fbf0d9;--warn:#7a5200;--bad-bg:#fbe3e0;--bad:#9a2a1c;--idle-bg:#eeede7;--idle:#55544f;--go:#1f4fd1;--goInk:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--ok-bg:#1f3a26;--ok:#8fd4a2;--warn-bg:#3a2e12;--warn:#f0cf87;--bad-bg:#442220;--bad:#ffb3a8;--idle-bg:#2a2a27;--idle:#bdbcb4;--go:#8fb0ff;--goInk:#10131c}}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1640px;margin:0 auto;padding:16px 20px 20px}
header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}h1{font-size:21px;margin:0;font-weight:680}.dateline{color:var(--mute);font-size:13px}
nav{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 12px}
button{font:inherit;color:var(--ink)}
nav button{font-size:14px;padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--card);cursor:pointer}
nav button[aria-selected=true]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
[hidden]{display:none!important}
h2{font-size:21px;margin:0 0 6px;font-weight:650}h3{font-size:15px;margin:12px 0 4px}
.lead{font-size:15.5px;max-width:1240px;margin:0 0 5px}.dim{color:var(--mute)}.small{font-size:13.5px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px}
.wrap{overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}.wrap.tall{max-height:calc(100vh - 176px)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:7px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-size:13px;color:var(--mute);font-weight:600;background:var(--soft);position:sticky;top:0}thead th.grp{text-align:center;color:var(--ink)}
tr:last-child td{border-bottom:0}.n{text-align:right;white-space:nowrap}
td.bench b{font-weight:600}td.bench span{color:var(--mute);font-size:12.5px}
td.best{background:var(--best);color:var(--bestInk);font-weight:700}
.nw{white-space:nowrap}.wrapcell ol{margin:0;padding-left:18px}.wrapcell li{margin:2px 0}.sub{color:var(--mute);font-size:13px;margin-top:3px}
.tag{display:inline-block;font-size:12.5px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
.tag.ok{background:var(--ok-bg);color:var(--ok)}.tag.warn{background:var(--warn-bg);color:var(--warn)}.tag.bad{background:var(--bad-bg);color:var(--bad)}.tag.idle{background:var(--idle-bg);color:var(--idle)}
.bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 8px;min-height:32px}.bar>span{color:var(--mute);font-size:13px;margin-right:2px}.bar .gap{width:14px}.bar .right{margin-left:auto;color:var(--mute);font-size:13px}
.pill{font-size:13px;padding:4px 11px;border-radius:8px;border:1px solid var(--line);background:var(--card);cursor:pointer}
.pill[aria-pressed=true]{border-color:var(--ink);font-weight:650}.pill .dot{display:inline-block;width:7px;height:7px;border-radius:50%;border:1px solid var(--mute);margin-right:6px;vertical-align:1px}.pill .dot.on{background:var(--ok);border-color:var(--ok)}
.pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.fig{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;min-width:0}
.fig.won{border-color:var(--ok);box-shadow:0 0 0 1px var(--ok)}
.fig figcaption{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;min-height:28px}.fig figcaption b{font-size:15px}.fig figcaption .t{color:var(--mute);font-size:13px}.fig figcaption .live{margin-left:auto}
.shots{display:grid;grid-template-columns:minmax(0,900fr) minmax(0,286fr);gap:8px;align-items:start}
.desk{position:relative;aspect-ratio:900/620;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff}
.desk img{position:absolute;inset:0;width:100%;height:100%;display:block}
.desk iframe{position:absolute;left:0;top:0;width:900px;height:620px;border:0;transform-origin:0 0;background:#fff}
.phone{aspect-ratio:390/844;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff;max-height:100%}
.phone img{width:100%;height:100%;display:block}
.none{display:grid;place-items:center;color:var(--mute);font-size:13px;height:100%;background:var(--soft)}
.vote{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:10px;min-height:38px}
.vote button{padding:7px 16px;border-radius:9px;border:1px solid var(--line);background:var(--card);cursor:pointer;font-weight:600;font-size:14px}
.vote button[aria-pressed=true]{background:var(--go);color:var(--goInk);border-color:var(--go)}
.vote .say{color:var(--mute);font-size:13.5px;flex-basis:100%;text-align:center;min-height:20px}
.lock{background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:34px 20px;text-align:center;color:var(--mute)}
.how{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 28px;max-width:1500px}.how ul{margin:0;padding-left:18px}.how li{margin:5px 0}
.prompt{font-size:13px;color:var(--mute);margin:2px 0 8px}
.linkish{background:none;border:0;padding:0;color:var(--go);cursor:pointer;text-decoration:underline;font-size:13px}
@media (max-width:900px){.pairs,.how{grid-template-columns:1fr}.wrap.tall{max-height:none}}
</style></head><body><main>
<header><h1>UI component battle</h1><span class="dateline">${esc(new Date(when).toLocaleDateString('en-US', { dateStyle: 'medium' }))} · ${esc(models.map((m) => m.name).join(' against '))} · ${reqs.length} request${reqs.length === 1 ? '' : 's'}, the design folder on and off</span></header>
<nav role="tablist">${tabs.map(([id, name], i) => `<button role="tab" data-t="${id}" aria-selected="${i === 0}">${i + 1} · ${name}</button>`).join('')}</nav>
<section id="verdict">
<h2>Is the design folder working, and who builds the better component?</h2>
${verdicts.map((v) => `<p class="lead">${v}</p>`).join('')}
<p class="lead" id="score">${models.length < 2 ? `<b>The battle</b> needs both models: run the test on ${esc(models[0].id === 'gemma' ? 'Qwen' : 'Gemma')} too.` : '<b>The battle</b> (folder on): <span class="dim">drawn by the page’s script.</span>'}</p>
<div class="chips">${chips.map((c) => `<span class="tag ${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'idle'}">${c.ok === true ? '✓' : c.ok === false ? '✗' : '·'} ${esc(c.text)}</span>`).join('')}</div>
${table}
<p class="sub">The best cell of a row is marked. A vote is yours: tabs 3 and 4 show the pictures without saying who made them. <button class="linkish" id="clear">Clear my votes</button></p>
</section>
<section id="pick" hidden>
<h2>Part 1 · Which cards does each request get?</h2>
<p class="lead">No model runs here. The app decides from the request’s own words whether it is a page request, then sends the rules card and the one example card that fits best${folder ? ` <span class="dim">(the folder: ${esc(folder)})</span>` : ''}. The last columns say whether the real run then carried those cards.</p>
${pickTable}
</section>
<section id="battle" hidden>
<h2>Part 2 · The battle: the same request, the design folder on</h2>
<div id="battle-body"></div>
</section>
<section id="before" hidden>
<h2>Part 3 · Before and after: the same model, the folder off and on</h2>
<div id="before-body"></div>
</section>
${hasStudio ? `<section id="studio" hidden>
<h2>Part 4 · The design studio against the cards: the same model and request</h2>
<div id="studio-body"></div>
</section>
` : ''}<section id="problems" hidden><h2>Everything the layout check found, page by page</h2>${problems}</section>
<section id="how" hidden><h2>How it was run</h2><div class="how">
<ul>${how.map((x) => `<li>${x}</li>`).join('')}</ul>
<div><h3 style="margin-top:0">The requests, word for word</h3>${reqs.map((p) => `<div><b>${esc(label(p))}</b><p class="prompt">${esc(p.prompt)}</p></div>`).join('')}</div>
</div></section>
</main>
<script type="application/json" id="data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
(function(){
  var D=JSON.parse(document.getElementById('data').textContent);
  var $=function(s,el){return (el||document).querySelector(s);},$$=function(s,el){return [].slice.call((el||document).querySelectorAll(s));};
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
  var mmss=function(s){return Math.floor(s/60)+':'+('0'+Math.round(s%60)).slice(-2);};
  var modelName=function(id){var m=D.models.filter(function(x){return x.id===id;})[0];return m?m.name:id;};
  var reqLabel=function(id){var r=D.requests.filter(function(x){return x.id===id;})[0];return r?r.label:id;};
  // The votes: { pairId: 0 | 1 | 'tie' }, kept in this browser.
  var V={};try{V=JSON.parse(localStorage.getItem(D.key)||'{}')||{};}catch(e){}
  var save=function(){try{localStorage.setItem(D.key,JSON.stringify(V));}catch(e){}};
  var voted=function(p){return Object.prototype.hasOwnProperty.call(V,p.id);};

  var tabs=$$('[role=tab]');
  function show(id){tabs.forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.t===id));});$$('main>section').forEach(function(s){s.hidden=s.id!==id;});try{history.replaceState(null,'','#'+id);}catch(e){}window.scrollTo(0,0);fit();}
  tabs.forEach(function(b){b.onclick=function(){show(b.dataset.t);};});
  addEventListener('keydown',function(e){if(e.metaKey||e.ctrlKey||e.altKey)return;var n=parseInt(e.key,10);if(n>=1&&n<=tabs.length)show(tabs[n-1].dataset.t);var i=tabs.map(function(b){return b.getAttribute('aria-selected');}).indexOf('true');if(e.key==='ArrowRight'&&tabs[i+1])show(tabs[i+1].dataset.t);if(e.key==='ArrowLeft'&&tabs[i-1])show(tabs[i-1].dataset.t);});

  // One picture tab: a row of choices, two pictures, a vote.
  var S={battle:{req:null,live:{}},before:{req:null,model:null,live:{}},studio:{req:null,model:null,live:{}}};
  var ARMN={on:'Folder on',off:'Folder off',studio:'Studio on'};
  function figure(kind,pair,i){
    var key=pair.sides[i],r=D.runs[key],open=voted(pair),parts=key.split('|'),won=open&&V[pair.id]===i;
    var who=kind==='battle'?modelName(parts[0]):ARMN[parts[2]];
    var name=open?'<b>'+esc(who)+'</b>':'<b>'+(i===0?'Left':'Right')+'</b>';
    var facts=!open?'':(r.made?(r.problems==null?'<span class="tag idle">not measured</span>':r.problems===0?'<span class="tag ok">no layout problems</span>':'<span class="tag warn">'+r.problems+' layout problem'+(r.problems===1?'':'s')+'</span>'):'')+'<span class="t">'+mmss(r.secs)+(r.time?', stopped at the limit':'')+'</span>'+(parts[2]==='on'?'<span class="t">· '+(r.cards.length?esc(r.cards.join(' + ')):'no cards carried')+'</span>':'');
    var live=S[kind].live[key];
    var desk=!r.made?'<div class="none">no page made</div>':live&&r.html?'<iframe sandbox="allow-scripts" title="'+(i===0?'Left':'Right')+' page, live" data-live="'+esc(key)+'"></iframe>':r.desktop?'<img alt="'+(i===0?'Left':'Right')+' page at 900 by 620" src="'+r.desktop+'">':'<div class="none">no picture</div>';
    var phone=!r.made?'<div class="none">—</div>':r.phone?'<img alt="'+(i===0?'Left':'Right')+' page on a phone" src="'+r.phone+'">':'<div class="none">no picture</div>';
    return '<figure class="fig'+(won?' won':'')+'"><figcaption>'+name+facts+(r.made&&r.html?'<button class="pill live" data-live-btn="'+esc(key)+'" aria-pressed="'+(live?'true':'false')+'">'+(live?'Show the picture':'Try it live')+'</button>':'')+'</figcaption><div class="shots"><div class="desk">'+desk+'</div><div class="phone">'+phone+'</div></div></figure>';
  }
  function voteBar(kind,pair){
    var v=V[pair.id],open=voted(pair);
    var say=!open?(kind==='battle'?'Which one is the better component? The models’ names show once you vote.':kind==='studio'?'Which one looks better? Which side had the design studio shows once you vote.':'Which one looks better? Which side had the design folder shows once you vote.')
      :v==='tie'?'You called it a tie.':'You picked '+(kind==='battle'?esc(modelName(pair.sides[v].split('|')[0])):ARMN[pair.sides[v].split('|')[2]].toLowerCase())+'.';
    return '<div class="vote"><button data-vote="0" aria-pressed="'+(v===0)+'">◀ Left is better</button><button data-vote="tie" aria-pressed="'+(v==='tie')+'">About the same</button><button data-vote="1" aria-pressed="'+(v===1)+'">Right is better ▶</button><div class="say">'+say+'</div></div>';
  }
  function draw(kind){
    var body=$('#'+kind+'-body'),pairs=D[kind],st=S[kind];
    if(!body)return;
    if(!pairs.length){body.innerHTML='<div class="lock">'+(kind==='battle'?'A battle needs the folder-on page of both models for a request. Run the test on the other model too.':kind==='studio'?'Nothing to compare yet: a request needs a page with the folder on and one with the studio on.':'Nothing to compare yet: a request needs a page with the folder on and one with it off.')+'</div>';return;}
    var reqs=D.requests.filter(function(r){return pairs.some(function(p){return p.req===r.id;});});
    if(!st.req||!reqs.some(function(r){return r.id===st.req;}))st.req=reqs[0].id;
    var mine=pairs.filter(function(p){return p.req===st.req;});
    if(kind!=='battle'&&(!st.model||!mine.some(function(p){return p.model===st.model;})))st.model=mine[0].model;
    var pair=kind==='battle'?mine[0]:mine.filter(function(p){return p.model===st.model;})[0];
    var done=pairs.filter(voted).length;
    var dot=function(on){return '<span class="dot'+(on?' on':'')+'"></span>';};
    var bar='<div class="bar"><span>Request</span>'+reqs.map(function(r){var ps=pairs.filter(function(p){return p.req===r.id;});return '<button class="pill" data-req="'+esc(r.id)+'" aria-pressed="'+(r.id===st.req)+'">'+dot(ps.every(voted))+esc(r.label)+'</button>';}).join('');
    // The battle's own vote first: this tab names the models.
    var gate=kind!=='battle'?D.battle.filter(function(p){return p.req===st.req;})[0]:null;
    var locked=gate&&!voted(gate);
    if(kind!=='battle'&&!locked)bar+='<span class="gap"></span><span>Model</span>'+mine.map(function(p){return '<button class="pill" data-model="'+esc(p.model)+'" aria-pressed="'+(p.model===st.model)+'">'+dot(voted(p))+esc(modelName(p.model))+'</button>';}).join('');
    bar+='<span class="right">'+done+' of '+pairs.length+' voted</span></div>';
    body.innerHTML=bar+(locked?'<div class="lock">Vote on <b>'+esc(reqLabel(st.req))+'</b> in the battle first: this tab names the models, and that would give the battle away.<br><br><button class="pill" data-go="battle">Go to the battle</button></div>'
      :'<div class="pairs">'+figure(kind,pair,0)+figure(kind,pair,1)+'</div>'+voteBar(kind,pair));
    $$('[data-req]',body).forEach(function(b){b.onclick=function(){st.req=b.dataset.req;draw(kind);};});
    $$('[data-model]',body).forEach(function(b){b.onclick=function(){st.model=b.dataset.model;draw(kind);};});
    $$('[data-go]',body).forEach(function(b){b.onclick=function(){S.battle.req=st.req;draw('battle');show('battle');};});
    $$('[data-vote]',body).forEach(function(b){b.onclick=function(){var v=b.dataset.vote;V[pair.id]=v==='tie'?'tie':Number(v);save();draw(kind);if(kind==='battle'){draw('before');draw('studio');}tally();};});
    $$('[data-live-btn]',body).forEach(function(b){b.onclick=function(){var k=b.dataset.liveBtn;st.live[k]=!st.live[k];draw(kind);};});
    $$('iframe[data-live]',body).forEach(function(f){f.srcdoc=D.runs[f.dataset.live].html;});
    fit();
  }
  // A live page is 900×620, scaled to its box.
  function fit(){$$('.desk iframe').forEach(function(f){var w=f.parentNode.clientWidth;if(w)f.style.transform='scale('+(w/900)+')';});}
  addEventListener('resize',fit);

  // The score and the vote row of the table.
  function tally(){
    var cells={};
    D.before.forEach(function(p){if(!voted(p))return;['on','off'].forEach(function(arm){var k=p.model+'|'+arm;cells[k]=cells[k]||{won:0,of:0};cells[k].of++;});if(V[p.id]!=='tie'){var arm=p.sides[V[p.id]].split('|')[2];cells[p.model+'|'+arm].won++;}});
    // The studio's cell: its wins against the folder-on page.
    D.studio.forEach(function(p){if(!voted(p))return;var k=p.model+'|studio';cells[k]=cells[k]||{won:0,of:0,vs:'against the cards'};cells[k].of++;if(V[p.id]!=='tie'&&p.sides[V[p.id]].split('|')[2]==='studio')cells[k].won++;});
    $$('[data-votecell]').forEach(function(td){var c=cells[td.dataset.votecell];td.innerHTML=c?c.won+' of '+c.of+(c.vs?' <span class="dim">'+c.vs+'</span>':''):'<span class="dim">no votes yet</span>';});
    var score=$('#score');
    if(score&&D.models.length>=2){
      var pts={},clean={},votes={};D.models.forEach(function(m){pts[m.id]=0;clean[m.id]=0;votes[m.id]=0;});
      D.battle.forEach(function(p){p.sides.forEach(function(k,i){var id=k.split('|')[0];if(D.runs[k].made&&D.runs[k].problems===0){clean[id]++;pts[id]++;}if(voted(p)&&V[p.id]===i){votes[id]++;pts[id]++;}});});
      var done=D.battle.filter(voted).length,a=D.models[0],b=D.models[1];
      var lead=pts[a.id]===pts[b.id]?'level':esc((pts[a.id]>pts[b.id]?a:b).name)+' ahead';
      score.innerHTML=!D.battle.length?'<b>The battle</b> (folder on): no request has a folder-on page from both models yet.'
        :'<b>The battle</b> (folder on): '+esc(a.name)+' '+pts[a.id]+' · '+esc(b.name)+' '+pts[b.id]+', '+lead+'. Clean pages '+clean[a.id]+' · '+clean[b.id]+', your votes '+votes[a.id]+' · '+votes[b.id]+' ('+done+' of '+D.battle.length+' voted'+(done<D.battle.length?': tab 3':'')+').';
    }
  }
  var clear=$('#clear');if(clear)clear.onclick=function(){V={};save();draw('battle');draw('before');draw('studio');tally();};
  draw('battle');draw('before');draw('studio');tally();
  var h=(location.hash||'').slice(1);show(document.getElementById(h)&&$('[data-t="'+h+'"]')?h:'verdict');
})();
</script>
</body></html>
`;
}
