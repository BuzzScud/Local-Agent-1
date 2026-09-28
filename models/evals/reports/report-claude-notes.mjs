// Builds the results page of the Claude's-notes round (28 Sep 2026): does the
// right note come back, do real questions about the user's own work get the
// right answer with the notes and without, and do the 28 practice tasks
// still pass with the memory and the notes on. Reads the raw results kept on
// this Mac; a run with no result file yet shows as "not run". The requests
// of the checks name the user's own notes, so the page shows counts and the
// misses, not the list.
//   node models/evals/reports/report-claude-notes.mjs
// From a worktree: BONSAI_DOCS=~/Desktop/bonsai-code/'bonsai-code DOCS'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../docs/to-docs.mjs';
import { CLAUDE_RULES, notesCount, notesDir, readNotes, leftOut } from '../../../terminal/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const here = join(root, 'models/bonsai-2-27b/results');
const RES = process.env.BONSAI_RESULTS ?? (existsSync(join(here, 'claude-notes-2026-09-28')) ? here : join(homedir(), 'Desktop/bonsai-code/models/bonsai-2-27b/results'));
const R = join(RES, 'claude-notes-2026-09-28');
const load = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEXT = load(join(R, 'page-text.json')) ?? {};
const T = (k, d = '') => TEXT[k] ?? d;
const sum = (a) => a.reduce((t, v) => t + v, 0);
const pct = (b, a) => (b ? `${a - b > 0 ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '');

/* ---------- what was measured ---------- */
const words = load(join(R, 'recall-words.json'));
const meaning = load(join(R, 'recall-meaning.json'));
// The questions. Whether the fact is in the answer was judged when it was
// given, on the whole answer (the file keeps its start only). One thing is
// judged again here: an answer that starts as a guess ("I have no evidence…
// a few possibilities") does not count, whatever it names on the way.
const judge = (file) => {
  const run = load(join(R, file));
  const set = load(join(R, 'claude-questions-set.json'))?.questions ?? [];
  if (!run) return null;
  for (const r of run.rows) { const q = set[r.n - 1]; if (q?.not && new RegExp(q.not, 'i').test(r.answer.slice(0, 400))) r.right = false; }
  for (const way of ['without', 'with']) { const rows = run.rows.filter((r) => r.way === way); run[way] = { right: rows.filter((r) => r.right).length, of: rows.length, secs: rows.reduce((s, r) => s + r.secs, 0), steps: rows.reduce((s, r) => s + r.steps, 0) }; }
  return run;
};
const asked = judge('questions-v2.json') ?? judge('questions.json');
const askedFirst = judge('questions-v1.json');
// The last wording of what goes with a note was asked with the notes only:
// its rows take the place of the run before it.
const last = judge('questions-v3.json');
if (asked && last?.with.of) {
  asked.rows = [...asked.rows.filter((r) => r.way === 'without'), ...last.rows.filter((r) => r.way === 'with')];
  asked.with = last.with;
}
function taskLog(file) {
  const out = [];
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return out; }
  for (const m of text.matchAll(/^(PASS|FAIL)\s+think=\S+\s+(?:rep(\d+)\s+)?(\d+)-(\S+)\s+(\d+)s\s+(\d+) steps\s+(\d+) errors\s*(.*)$/gm)) out.push({ pass: m[1] === 'PASS', n: +m[3], task: `${m[3]}-${m[4]}`, secs: +m[5], steps: +m[6], why: m[8].trim() });
  return out;
}
const before = taskLog(join(RES, 'step3-2026-09-27', 'tasks-after-pass1.log'));
const afterFirst = taskLog(join(R, 'tasks-with-notes.log'));
const after = existsSync(join(R, 'tasks-with-notes-v2.log')) && taskLog(join(R, 'tasks-with-notes-v2.log')).length ? taskLog(join(R, 'tasks-with-notes-v2.log')) : afterFirst;
// The three writing tasks again, three runs each, on the last wording.
const again = taskLog(join(R, 'tasks-with-notes-v3.log'));
const names = [...new Set([...before, ...after].map((r) => r.task))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
const TASKS = names.map((task) => ({ task, b: before.find((r) => r.task === task) ?? null, a: after.find((r) => r.task === task) ?? null }));
const both = TASKS.filter((t) => t.a && t.b);

// Claude's notes as they are on this Mac today: how many, of which kind, how many left out.
const dir = notesDir();
const count = dir ? notesCount(dir) : { all: 0, used: 0, leftOut: [] };
const kinds = {};
for (const n of dir ? readNotes(dir) : []) { const k = n.type; kinds[k] ??= { all: 0, out: 0 }; kinds[k].all++; if (leftOut(n)) kinds[k].out++; }
const KIND = { feedback: 'How you like things done', user: 'About you', project: 'Your projects (Bonsai, the desks, side apps, studies)', reference: 'How something is done on this Mac' };

/* ---------- the tables ---------- */
const cell = (v, best, q) => `<td${best ? ' class="best"' : ''}>${v}${q ? `<span class="q">${esc(q)}</span>` : ''}</td>`;
const na = '<td class="na">—<span class="q">not run</span></td>';
const recallRows = [
  ['Requests that one note answers', 'the right note came back, of 30', (r) => r.right, (r) => `${r.right} of ${r.of}`, false],
  ['Requests that need no note', 'a note came back anyway, of 20', (r) => r.wrong, (r) => `${r.wrong} of ${r.ofNone}`, true],
  ['Time', 'thousandths of a second a request', (r) => Math.round(r.msEach), (r) => `${Math.round(r.msEach)} ms`, true],
].map(([area, measure, get, fmt, lower]) => {
  const cols = [words, meaning];
  const vals = cols.map((c) => (c ? get(c) : null));
  const nums = vals.filter((v) => v != null);
  const top = nums.length ? (lower ? Math.min(...nums) : Math.max(...nums)) : null;
  const same = nums.every((v) => v === nums[0]);
  const d = vals[0] != null && vals[1] != null ? vals[1] - vals[0] : null;
  return `<tr><td class="bench"><b>${esc(area)}</b><span>${esc(measure)}</span></td>${cols.map((c, i) => (c ? cell(fmt(c), vals[i] === top && !same) : na)).join('')}${d == null ? '<td class="sep na">—</td>' : `<td class="sep delta ${d === 0 ? '' : (lower ? d < 0 : d > 0) ? 'up' : 'down'}">${d === 0 ? 'same' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`}</td>`}</tr>`;
}).join('');

const qs = asked ? [...new Set(asked.rows.map((r) => r.n))].map((n) => ({ n, q: asked.rows.find((r) => r.n === n).q, off: asked.rows.find((r) => r.n === n && r.way === 'without'), on: asked.rows.find((r) => r.n === n && r.way === 'with') })) : [];
const verdict = (r) => (r ? `<td class="${r.right ? 'ok' : 'bad'}">${r.right ? 'right' : 'not right'}<span class="q">${r.secs} s · ${r.steps} step${r.steps === 1 ? '' : 's'}${r.reason !== 'done' ? ` · ${esc(r.reason)}` : ''}</span></td>` : na);
const askedRows = qs.map((x) => `<tr><td class="bench"><b>${esc(x.q)}</b>${x.on?.notes?.length ? `<span>the note that came along: ${esc(x.on.notes.map((n) => n.replace(/-/g, ' ')).join(', '))}</span>` : ''}</td>${verdict(x.off)}${verdict(x.on)}<td class="words">${esc((x.on?.answer ?? '').replace(/\s+/g, ' ').slice(0, 260))}${(x.on?.answer ?? '').length > 260 ? '…' : ''}</td></tr>`).join('');

const taskRows = TASKS.map((t) => {
  const pass = (r) => (r == null ? '<td class="na">—</td>' : `<td class="${r.pass ? 'ok' : 'bad'}">${r.pass ? 'pass' : 'fail'}</td>`);
  const secs = t.a && t.b ? `<td class="${t.b.secs < t.a.secs ? 'best' : ''}">${t.b.secs} s</td><td class="${t.a.secs <= t.b.secs ? 'best' : ''}">${t.a.secs} s</td>` : `<td>${t.b ? `${t.b.secs} s` : '—'}</td><td class="na">${t.a ? `${t.a.secs} s` : '—'}</td>`;
  const d = t.a && t.b ? t.a.secs - t.b.secs : null;
  return `<tr><td class="bench"><b>${esc(t.task)}</b>${t.a && !t.a.pass ? `<span class="q" style="color:var(--down)">${esc(t.a.why)}</span>` : ''}</td>${pass(t.b)}${pass(t.a)}${secs}${d == null ? '<td class="sep na">—</td>' : `<td class="sep delta ${d < 0 ? 'up' : d > 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d} s<span class="q">${pct(t.b.secs, t.a.secs)}</span></td>`}</tr>`;
}).join('');
const totalB = sum(both.map((t) => t.b.secs)), totalA = sum(both.map((t) => t.a.secs));

const misses = (meaning?.detail ?? []).filter((d) => d.want?.length && !d.right);
const missRows = misses.map((d, i) => `<tr><td class="bench"><b>${esc(d.q)}</b></td><td class="words">${d.got.length ? esc(d.got.map((g) => g.id.replace(/-/g, ' ')).join(', ')) : 'nothing'}</td><td class="words">${(TEXT.MISSES ?? [])[i] ?? ''}</td></tr>`).join('');

const css = `
:root{--bg:#f7f6f2;--card:#ffffff;--ink:#1c1b18;--mute:#6b675e;--faint:#a19c90;--line:#e3dfd5;--soft:#efece4;--best:#f3d9cc;--bestInk:#8a3a1c;--up:#1d7a46;--down:#b3261e;--c-before:#2a78d6;--c-after:#eb6834;--c-third:#1baf7a;--c-fourth:#eda100}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80;--c-before:#3987e5;--c-after:#d95926;--c-third:#199e70;--c-fourth:#c98500}}
:root[data-theme="dark"]{--bg:#15161a;--card:#1d1f24;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#2e3037;--soft:#24262c;--best:#4a2b1f;--bestInk:#ffb899;--up:#5fd08f;--down:#ff8a80;--c-before:#3987e5;--c-after:#d95926;--c-third:#199e70;--c-fourth:#c98500}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1120px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}h2{font-size:21px;letter-spacing:-.01em;margin:44px 0 6px}h3{font-size:16px;margin:0 0 2px}p{margin:0 0 10px}a{color:inherit;text-underline-offset:3px}
.lede{color:var(--mute);max-width:780px}.sub{color:var(--mute);font-size:14px;margin-bottom:14px;max-width:840px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 6px}nav a{font-size:13px;text-decoration:none;padding:5px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--mute)}nav a:hover{color:var(--ink);border-color:var(--faint)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:22px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.card .name{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px}.dot{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block}
.card dl{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:12px 0 0;font-size:14px}.card dt{color:var(--mute)}.card dd{margin:0;font-variant-numeric:tabular-nums}
.card p,.card li{font-size:14px;color:var(--mute);margin:8px 0 0}.card ul{margin:4px 0 0;padding-left:18px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}tr:last-child td{border-bottom:none}
thead th{font-size:13px;color:var(--mute);font-weight:600;background:var(--soft);white-space:normal;min-width:104px}thead th span{display:block;font-weight:400;font-size:12px}
td.bench{white-space:normal;min-width:210px}td.bench b{display:block;font-weight:600}td.bench span{color:var(--mute);font-size:13px}
td.words{white-space:normal;min-width:220px;max-width:340px;font-size:14px}
td .q{display:block;color:var(--mute);font-size:12px;white-space:normal;max-width:420px;font-weight:400}
td.best{background:var(--best);color:var(--bestInk);font-weight:700}td.best .q{color:var(--bestInk)}td.na{color:var(--faint)}
td.delta{font-weight:600}td.delta.up{color:var(--up)}td.delta.down{color:var(--down)}th.sep,td.sep{border-left:1px solid var(--line)}
td.ok{color:var(--up);font-weight:600}td.bad{color:var(--down);font-weight:600}
.notes{margin:12px 2px 0;color:var(--mute);font-size:13px;max-width:900px}.notes p{margin:0 0 7px}.notes sup{font-weight:700;color:var(--ink)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:16px;margin-top:14px}.charts.one{grid-template-columns:1fr}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 16px 12px;min-width:0}figcaption{color:var(--mute);font-size:13px;margin-top:8px;max-width:860px}
.from{font-size:12px;color:var(--faint);margin-bottom:6px}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:var(--mute);margin:8px 0 4px}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:14px;height:10px;border-radius:3px;display:inline-block}.legend i.line{width:16px;height:0;border-top:2.5px solid;border-radius:0}
.scroll{overflow-x:auto}.scroll svg{min-width:440px}.scroll.wide svg{min-width:720px}
svg{display:block;width:100%;max-width:620px;height:auto;overflow:visible;margin:0 auto}svg text{fill:var(--mute);font-size:11px;font-family:inherit}svg .grid{stroke:var(--line);stroke-width:1}svg .axis{stroke:var(--faint);stroke-width:1}svg .lbl{fill:var(--ink)}
.pts table{font-size:12.5px}.pts .wrap{margin-top:10px}.pts th,.pts td{padding:6px 9px}details.pts summary{cursor:pointer;color:var(--mute);font-size:12.5px;margin-top:8px}.pts td .c,td .c{display:block;color:var(--mute);font-weight:400;font-size:11.5px}.pts td:first-child{white-space:nowrap;font-weight:600}
.hero{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;display:grid;grid-template-columns:auto 1fr;gap:6px 28px;align-items:center;margin-top:22px}.hero .g{font-size:72px;line-height:1;font-weight:800;letter-spacing:-.04em;grid-row:span 2;font-variant-numeric:tabular-nums}.hero .v{font-size:16px;max-width:820px}.hero .w{color:var(--mute);font-size:14px;max-width:820px}
pre{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;overflow-x:auto;font:12.5px/1.5 ui-monospace,Menlo,monospace;margin:10px 0;white-space:pre-wrap;word-break:break-word}.del{color:var(--down)}.add{color:var(--up)}
.foot{margin-top:40px;color:var(--mute);font-size:13px}.foot li{margin:3px 0}code{font:12.5px ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:4px}
@media (max-width:600px){h1{font-size:25px}th,td{padding:8px 10px}.hero{grid-template-columns:1fr}.hero .g{font-size:56px;grid-row:auto}}
`;

const steps = (TEXT.HOW ?? []).map(([t, d], i) => `<div class="card"><div class="name"><span class="num">${i + 1}</span>${esc(t)}</div><p>${d}</p></div>`).join('');
const notes = (TEXT.NOTES ?? []).map((n, i) => `<p><sup>${i + 1}</sup> ${n}</p>`).join('');
const kindRows = Object.entries(kinds).sort((a, b) => b[1].all - a[1].all).map(([k, v]) => `<tr><td class="bench"><b>${esc(KIND[k] ?? k)}</b></td><td>${v.all}</td><td>${v.all - v.out}</td><td>${v.out}</td></tr>`).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bonsai reads Claude's notes</title><style>${css}
.num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--soft);font-size:13px;flex:none}
ol.rules{margin:0;padding:18px 22px 18px 44px;background:var(--card);border:1px solid var(--line);border-radius:14px;columns:2;column-gap:36px}ol.rules li{margin:0 0 9px;break-inside:avoid;font-size:14.5px}
@media (max-width:760px){ol.rules{columns:1}}
.cards.two{grid-template-columns:repeat(2,minmax(0,1fr))}.cards.four{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:900px){.cards.four{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:620px){.cards.two,.cards.four{grid-template-columns:1fr}}
</style></head><body><main>
<h1>${T('TITLE', "Bonsai reads Claude's notes")}</h1>
<p class="lede">${T('LEDE', '')}</p>
<nav><a href="#glance">At a glance</a><a href="#how">How it works</a><a href="#rules">The 15 lines</a><a href="#what">What is in the notes</a><a href="#find">Finding the right note</a><a href="#asked">Real questions</a><a href="#tasks">The 28 practice tasks</a><a href="#notes">Notes</a><a href="#sources">Where the numbers come from</a></nav>

<div class="hero"><div class="g">${T('HERO', '—')}</div><div class="v">${T('HERO_V', '')}</div><div class="w">${T('HERO_W', '')}</div></div>

<section id="glance"><div class="cards two">
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-after)"></span>Finding the right note</div><dl>
    <dt>By words alone</dt><dd>${words ? `${words.right} of ${words.of} right · ${words.wrong} of ${words.ofNone} wrong` : 'not run'}</dd>
    <dt>By meaning and words</dt><dd>${meaning ? `<b>${meaning.right} of ${meaning.of} right · ${meaning.wrong} of ${meaning.ofNone} wrong</b>` : 'not run'}</dd>
    ${T('CARD_FIND', '')}</dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-before)"></span>Questions about your own work</div><dl>
    <dt>Bonsai as it is on main</dt><dd>${asked ? `${asked.without.right} of ${asked.without.of} right · ${asked.without.secs} s` : 'not run'}</dd>
    <dt>With Claude's notes</dt><dd>${asked ? `<b style="color:var(${asked.with.right > asked.without.right ? '--up' : '--ink'})">${asked.with.right} of ${asked.with.of} right</b> · ${asked.with.secs} s` : 'not run'}</dd>
    ${askedFirst ? `<dt>The first version</dt><dd>${askedFirst.with.right} of ${askedFirst.with.of} right · ${askedFirst.with.secs} s</dd>` : ''}
    ${T('CARD_ASKED', '')}</dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-fourth)"></span>The 28 practice tasks</div><dl>
    <dt>Without a memory</dt><dd>${before.length ? `${before.filter((r) => r.pass).length} of ${before.length} pass · ${sum(before.map((r) => r.secs)).toLocaleString()} s` : 'not run'}</dd>
    <dt>Memory and notes on</dt><dd>${after.length ? `${after.filter((r) => r.pass).length} of ${after.length} pass · ${sum(after.map((r) => r.secs)).toLocaleString()} s` : 'not run'}</dd>
    ${afterFirst.length && after !== afterFirst ? `<dt>The first version</dt><dd>${afterFirst.filter((r) => r.pass).length} of ${afterFirst.length} pass · ${sum(afterFirst.map((r) => r.secs)).toLocaleString()} s</dd>` : ''}
    ${again.length ? `<dt>The 3 writing tasks again</dt><dd>${again.filter((r) => r.pass).length} of ${again.length} pass<br><span style="color:var(--mute);font-size:13px">3 runs each, the last wording</span></dd>` : ''}
    ${T('CARD_TASKS', '')}</dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-third)"></span>What is still open</div>${T('CARD_OPEN', '')}</div>
</div></section>

<section id="how"><h2>How it works</h2>
<p class="sub">${T('HOW_SUB', '')}</p>
<div class="cards four" style="margin-top:6px">${steps}</div></section>

<section id="rules"><h2>The 15 lines, for you to read</h2>
<p class="sub">${T('RULES_SUB', '')}</p>
<ol class="rules">${CLAUDE_RULES.map((r) => `<li>${esc(r.text)}</li>`).join('')}</ol></section>

<section id="what"><h2>What is in the notes</h2>
<p class="sub">${T('WHAT_SUB', '')}</p>
<div class="wrap"><table><thead><tr><th>Kind of note</th><th>Notes</th><th>Bonsai may read</th><th>Left out<span>sign-ins, servers, secrets</span></th></tr></thead><tbody>${kindRows}
<tr><td class="bench"><b>All of them</b></td><td>${count.all}</td><td>${count.used}</td><td>${count.leftOut.length}</td></tr></tbody></table></div></section>

<section id="find"><h2>Finding the right note</h2>
<p class="sub">${T('FIND_SUB', '')}</p>
<div class="wrap"><table><thead><tr><th></th><th>By words alone<span>no model</span></th><th>By meaning and words<span>the small model BGE-M3</span></th><th class="sep">Change<span>my own subtraction</span></th></tr></thead><tbody>${recallRows}</tbody></table></div>
${missRows ? `<h3 style="margin-top:22px">The ${misses.length} it missed</h3><div class="wrap" style="margin-top:8px"><table><thead><tr><th>The request</th><th>What came back</th><th>Why</th></tr></thead><tbody>${missRows}</tbody></table></div>` : ''}</section>

<section id="asked"><h2>Real questions</h2>
<p class="sub">${T('ASKED_SUB', '')}</p>
${asked ? `<div class="wrap"><table><thead><tr><th>The question</th><th>Bonsai as it is on main</th><th>With Claude's notes</th><th>Its answer, with the notes</th></tr></thead><tbody>${askedRows}
<tr><td class="bench"><b>All ${asked.with.of}</b></td><td class="${asked.without.right === asked.without.of ? 'ok' : 'bad'}">${asked.without.right} of ${asked.without.of}<span class="q">${asked.without.secs} s · ${asked.without.steps} steps</span></td><td class="${asked.with.right === asked.with.of ? 'ok' : 'bad'}">${asked.with.right} of ${asked.with.of}<span class="q">${asked.with.secs} s · ${asked.with.steps} steps</span></td><td></td></tr></tbody></table></div>` : '<p class="sub">Not run yet.</p>'}</section>

<section id="tasks"><h2>The 28 practice tasks</h2>
<p class="sub">${T('TASKS_SUB', '')}</p>
<div class="wrap"><table><thead><tr><th>Task</th><th>Without a memory</th><th>Memory and notes on</th><th>Without<span>seconds</span></th><th>With<span>seconds</span></th><th class="sep">Change</th></tr></thead><tbody>
${taskRows}
${both.length ? `<tr><td class="bench"><b>The ${both.length} tasks run both ways</b></td><td class="ok">${both.filter((t) => t.b.pass).length} pass</td><td class="${both.every((t) => t.a.pass) ? 'ok' : 'bad'}">${both.filter((t) => t.a.pass).length} pass</td><td class="${totalB < totalA ? 'best' : ''}">${totalB.toLocaleString()} s</td><td class="${totalA <= totalB ? 'best' : ''}">${totalA.toLocaleString()} s</td><td class="sep delta ${totalA < totalB ? 'up' : totalA > totalB ? 'down' : ''}">${totalA - totalB > 0 ? '+' : ''}${totalA - totalB} s<span class="q">${pct(totalB, totalA)}</span></td></tr>` : ''}
</tbody></table></div></section>

<section id="notes"><h2>Notes</h2><div class="notes">${notes}</div></section>

<section class="foot" id="sources"><h3 style="color:var(--ink)">Where the numbers come from</h3><ul>
<li>This round's runs: <code>models/bonsai-2-27b/results/claude-notes-2026-09-28/</code> (<code>recall-words.json</code>, <code>recall-meaning.json</code>, <code>questions.json</code>, <code>tasks-with-notes.log</code>). The two sets of requests are there too and stay on this Mac: they name your own notes.</li>
<li>The practice tasks without a memory: <code>…/step3-2026-09-27/tasks-after-pass1.log</code>, a few hours earlier, the step 3 code.</li>
<li>The code: <code>~/worktrees/bonsai-claude-memory</code> (branch <code>claude-memory</code>, not committed), measured from the frozen copy <code>~/worktrees/claude-memory-frozen-1</code>.</li>
<li>This page: <code>node models/evals/reports/report-claude-notes.mjs</code>; its words: <code>page-text.json</code> in the results folder.</li></ul>
<p>Nothing on this page loads from the internet.</p></section>
</main></body></html>`;

const out = docsPath('reports/bonsai-claude-notes-2026-09-28.html');
writeFileSync(out, html);
console.log(`wrote ${out.replace(homedir(), '~')} (${(html.length / 1024).toFixed(0)} KB)`);
if (!process.env.BONSAI_NO_DESKTOP) { const desk = join(homedir(), 'Desktop', 'bonsai-claude-notes-2026-09-28.html'); copyFileSync(out, desk); console.log(`copied to ${desk.replace(homedir(), '~')}`); }
