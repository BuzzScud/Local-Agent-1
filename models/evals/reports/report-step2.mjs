// Builds the step 2 results page: how a request is sorted before any work
// starts, on the code before (main) and after the 2026-09-27 rules. Reads the
// raw results kept on this Mac; a run with no result file yet shows as "not run".
//   node models/evals/reports/report-step2.mjs [--from <results folder>]
// The results folder holds: sort-rows.json (every line, sorted both ways),
// picklist-rows.json (the question with answers to pick, on the 27B),
// words-before.json / words-after.json (the 28 real requests), first-before.json /
// first-after.json (seconds until the work starts), snapshots.json (the screen).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../docs/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const FROM = opt('from', join(root, 'models/bonsai-2-27b/results/step2-sort-2026-09-27'));
const load = (name) => (existsSync(join(FROM, name)) ? JSON.parse(readFileSync(join(FROM, name), 'utf8')) : null);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tidy = (s) => String(s).replaceAll(homedir(), '~').replace(/\s+/g, ' ').trim();
const cut = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const one = (n) => (n == null || Number.isNaN(n) ? '–' : n.toFixed(1));
const whole = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
const median = (list) => { const a = list.filter((x) => x != null).sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const sum = (list) => list.reduce((a, b) => a + (b ?? 0), 0);

const rows = load('sort-rows.json') ?? [];
const pick = load('picklist-rows.json');
const wb = load('words-before.json');
const wa = load('words-after.json');
const fb = load('first-before.json');
const fa = load('first-after.json');
const shots = load('snapshots.json');
const meta = load('meta.json') ?? {};

/* ---------- sorting, by the rules alone ---------- */
const real = rows.filter((r) => r.set !== 'traps');
const traps = rows.filter((r) => r.set === 'traps');
const moved = real.filter((r) => r.changed);
const callsBefore = sum(real.map((r) => r.callsBefore));
const callsAfter = sum(real.map((r) => r.callsAfter));

const PATH = { chat: 'quick reply', quit: 'quits', memory: 'saves to memory', 'follow-up': 'continues the conversation', rename: 'rename shortcut', fix: 'fix shortcut', change: 'change shortcut', question: 'question, step by step', other: 'task, step by step', unsorted: 'the brain sorts it' };
const ASK = { fixed: 'asks you first', model: 'asks the brain “is this clear?”', where: 'asks you where you see it' };
const where = (s, project) => (project ? PATH[s.path] : s.path === 'unsorted' ? 'no rule fits: step by step' : ['rename', 'fix', 'change'].includes(s.path) ? `sorted as a ${s.path}, step by step here` : PATH[s.path]);
const say = (s, project = true) => (s.ask ? `${ASK[s.ask]}, then ${where(s, project)}` : where(s, project));
const SETS = { yours: ['Your own lines', 'typed into Bonsai, 25 Sep to 27 Sep'], tasks: ['Practice tasks', 'the 28 tasks of the test bench'], requests: ['Real requests', 'the 28 requests of the test bench'], traps: ['Trap lines', 'written by me to catch side effects'] };

/* ---------- the 28 real requests on the 27B ---------- */
const wRows = (wb?.rows ?? wa?.rows ?? []).map((b) => {
  const before = wb?.rows.find((r) => r.n === b.n) ?? null;
  const after = wa?.rows.find((r) => r.n === b.n) ?? null;
  const line = rows.find((r) => r.set === 'requests' && r.n === b.n);
  return { n: b.n, folder: b.folder, prompt: b.prompt, before, after, moved: !!line?.changed };
});
const wMoved = wRows.filter((r) => r.moved);
const wSame = wRows.filter((r) => !r.moved);
const secsOf = (list, k) => (list.length && list.every((r) => r[k]) ? sum(list.map((r) => r[k].secs)) : null);
const asked = (run) => (run ? sum(run.rows.map((r) => r.asked?.length ?? 0)) : null);

/* ---------- seconds until the work starts ---------- */
const prompts = [...new Set([...(fb?.rows ?? []), ...(fa?.rows ?? [])].map((r) => r.prompt))];
const fRows = prompts.map((p) => {
  const b = (fb?.rows ?? []).filter((r) => r.prompt === p);
  const a = (fa?.rows ?? []).filter((r) => r.prompt === p);
  const line = rows.find((r) => r.set !== 'traps' && r.text === p);
  return { prompt: p, moved: !!line?.changed, before: median(b.map((r) => r.secs)), after: median(a.map((r) => r.secs)), bAll: b.map((r) => r.secs), aAll: a.map((r) => r.secs), bHow: b[0]?.started, aHow: a[0]?.started, line: a[0]?.sorted };
});
const fMoved = fRows.filter((r) => r.moved);
const fSame = fRows.filter((r) => !r.moved);
const fMed = (list, k) => median(list.map((r) => r[k]));

/* ---------- the pick list ---------- */
const avg = (k) => (pick ? sum(pick.rows.map((r) => r[k].secs)) / pick.rows.length : null);
const T = { today: avg('today'), first: avg('pick'), kinds: avg('kinds'), map: avg('map') };

/* ---------- parts of the page ---------- */
const delta = (b, a, { lowerIsBetter = true, unit = '', digits = 1, pct: withPct = true } = {}) => {
  if (b == null || a == null) return '<td class="num">–</td>';
  const d = a - b;
  if (Math.abs(d) < 1e-9) return '<td class="num">same</td>';
  const good = lowerIsBetter ? d < 0 : d > 0;
  const pct = b && withPct ? ` (${d > 0 ? '+' : '−'}${Math.abs(Math.round((d / b) * 100))}%)` : '';
  return `<td class="num ${good ? 'good' : 'bad'}">${d > 0 ? '+' : '−'}${digits ? Math.abs(d).toFixed(digits) : whole(Math.abs(d))}${unit}${pct}</td>`;
};
const best = (b, a, lowerIsBetter = true) => (b == null || a == null || b === a ? ['', ''] : (lowerIsBetter ? a < b : a > b) ? ['', ' best'] : [' best', '']);
const launchRow = (area, measure, b, a, { lowerIsBetter = true, unit = '', digits = 1, note = '', pct = true, noBefore = false } = {}) => {
  const [cb, ca] = best(b, a, lowerIsBetter);
  const f = (v) => (v == null ? 'not run' : `${digits ? v.toFixed(digits) : whole(v)}${unit}`);
  return `<tr><td><b>${esc(area)}</b><small>${esc(measure)}</small></td><td class="num${noBefore ? '' : cb}">${noBefore ? '–' : f(b)}</td><td class="num${ca}">${f(a)}</td>${delta(b, a, { lowerIsBetter, unit, digits, pct })}<td class="why">${esc(note)}</td></tr>`;
};

const passB = wb ? wb.ok : null; const passA = wa ? wa.ok : null;
const launch = [
  launchRow('Sorting', `real requests that take the better path, of ${real.length}`, 0, moved.length, { lowerIsBetter: false, digits: 0, pct: false, noBefore: true, note: `0 take a worse one; ${traps.filter((r) => !r.changed).length} of ${traps.length} trap lines stay where they were` }),
  launchRow('Calls before work', `calls to the brain before any work starts, over the ${real.length} requests`, callsBefore, callsAfter, { digits: 0, note: 'the sort itself, or the “is this clear?” check' }),
  launchRow('Until the work starts', `seconds from Enter to the first step, the ${fMoved.length} requests the rules moved (median of 3)`, fMed(fMoved, 'before'), fMed(fMoved, 'after'), { unit: ' s', note: 'real 27B, the request stopped at its first step' }),
  launchRow('Until the work starts', `the same, ${fSame.length} requests the rules did not move`, fMed(fSame, 'before'), fMed(fSame, 'after'), { unit: ' s', note: 'a check: these should cost the same' }),
  launchRow('Real requests', 'of 28 done right, start to finish on the 27B', passB, passA, { lowerIsBetter: false, digits: 0, note: [wb && passB < wb.total ? `before failed: ${wb.rows.filter((r) => !r.ok).map((r) => `#${r.n}`).join(', ')}` : '', wa && passA < wa.total ? `after failed: ${wa.rows.filter((r) => !r.ok).map((r) => `#${r.n}`).join(', ')}` : ''].filter(Boolean).join(' · ') }),
  launchRow('Real requests', `seconds for the ${wMoved.length} the rules moved`, secsOf(wMoved, 'before'), secsOf(wMoved, 'after'), { unit: ' s', digits: 0, note: 'start to finish, one run each' }),
  launchRow('Real requests', `seconds for the other ${wSame.length}`, secsOf(wSame, 'before'), secsOf(wSame, 'after'), { unit: ' s', digits: 0, note: 'one run each: the brain’s own answers differ from run to run' }),
  launchRow('Questions', 'asked before or during the 28 requests', asked(wb), asked(wa), { digits: 0, note: '' }),
  launchRow('A question', `seconds until it is on screen, once it carries answers to pick (average of ${pick?.rows.length ?? 8})`, T.today, T.kinds, { unit: ' s', note: 'the price of the pick list' }),
  launchRow('Unit tests', 'both parts', meta.suiteBefore ?? null, meta.suiteAfter ?? null, { lowerIsBetter: false, digits: 0, pct: false, note: meta.suiteNote ?? '' }),
].join('\n');

const tile = (big, small) => `<div class="tile"><b>${big}</b><span>${small}</span></div>`;
const tiles = [
  tile(`${moved.length} of ${real.length}`, 'real requests sort better, none worse'),
  tile(`${callsBefore} → ${callsAfter}`, 'calls to the brain before work starts'),
  tile(fb && fa ? `${one(fMed(fMoved, 'before'))} → ${one(fMed(fMoved, 'after'))} s` : 'not run', 'from Enter to the first step, for the requests that moved'),
  tile(wb && wa ? `${passB} → ${passA} of 28` : 'not run', 'real requests done right on the 27B'),
].join('\n');

const lineRow = (r) => {
  const note = r.after.why === 'follow' ? (r.gap != null ? `came ${r.gap} min after the line before it` : 'typed after an earlier turn') : r.set === 'traps' && r.hasPrior ? 'typed after an earlier turn' : '';
  return `<tr data-set="${r.set}" data-changed="${r.changed ? 1 : 0}"><td class="num">${r.n}</td><td class="req"><span title="${esc(tidy(r.text))}">${esc(cut(tidy(r.text), 150))}</span>${note ? `<small>${esc(note)}</small>` : ''}</td><td>${esc(say(r.before, r.project))}</td><td class="${r.changed ? 'new' : ''}">${esc(say(r.after, r.project))}</td><td class="num">${r.callsBefore} → ${r.callsAfter}</td></tr>`;
};
const count = (set) => rows.filter((r) => r.set === set).length;

const wordRow = (r) => {
  const b = r.before; const a = r.after;
  const [cb, ca] = best(b?.secs, a?.secs);
  const mark = (x) => (x == null ? '' : x.ok ? '' : ` <span class="bad">failed: ${esc(x.fails.join('; '))}</span>`);
  return `<tr class="${r.moved ? 'movedrow' : ''}"><td class="num">${r.n}</td><td class="req">${esc(cut(tidy(r.prompt), 90))}<small>${r.folder === 'plain' ? 'a folder with no code' : r.folder === 'python' ? 'a Python project' : 'the demo project'}${r.moved ? ' · moved by the rules' : ''}</small></td>
<td>${esc(b?.route ?? '–')}${b?.asked?.length ? `<small>asked ${b.asked.length}</small>` : ''}${mark(b)}</td><td class="${r.moved ? 'new' : ''}">${esc(a?.route ?? '–')}${a?.asked?.length ? `<small>asked ${a.asked.length}</small>` : ''}${mark(a)}</td>
<td class="num${cb}">${b ? b.secs : '–'}</td><td class="num${ca}">${a ? a.secs : '–'}</td>${delta(b?.secs, a?.secs, { unit: ' s', digits: 0 })}</tr>`;
};

const firstRow = (r) => {
  const [cb, ca] = best(r.before, r.after);
  return `<tr class="${r.moved ? 'movedrow' : ''}"><td class="req">${esc(cut(r.prompt, 90))}<small>${r.moved ? 'moved by the rules' : 'not moved: a check'}${r.line ? ` · ${esc(r.line)}` : ''}</small></td>
<td class="num${cb}">${one(r.before)}<small>${r.bAll.map(one).join(' · ')}</small></td><td class="num${ca}">${one(r.after)}<small>${r.aAll.map(one).join(' · ')}</small></td>${delta(r.before, r.after, { unit: ' s' })}</tr>`;
};

const opts = (j) => (j?.options?.length ? `<ol>${j.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : '');
const pickRows = (pick?.rows ?? []).map((r) => `<tr><td class="req"><b>${esc(r.text)}</b><small>${esc(r.task.replace(/^\d+-/, '').replace(/-/g, ' '))} · ${r.files} files</small></td>
<td>${esc(r.today.json?.question ?? '')}<small>${one(r.today.secs)} s</small></td><td class="new">${esc(r.kinds.json?.question ?? '')}${opts(r.kinds.json)}<small>${one(r.kinds.secs)} s</small></td></tr>`).join('\n');

// The screen as the terminal drew it, from your first line on. A box that spans
// the whole terminal is drawn 72 wide here so it fits the page.
const screen = (text) => {
  const W = 72;
  const lines = String(text ?? '').split('\n').map((l) => l.replace(/\s+$/, ''));
  const from = lines.findIndex((l) => l.startsWith('> '));
  const kept = lines.slice(Math.max(0, from)).filter((l, i, a) => l || a[i - 1]);
  return kept.map((l) => {
    if (l.startsWith('╭')) return `╭${'─'.repeat(W - 2)}╮`;
    if (l.startsWith('╰')) return `╰${'─'.repeat(W - 2)}╯`;
    if (l.startsWith('│')) return `│${l.slice(1).replace(/│$/, '').trimEnd().padEnd(W - 2).slice(0, W - 2)}│`;
    return l;
  }).map(esc).join('\n');
};

const CHANGES = [
  ['Thanks and greetings are seen', 'More ways of saying hello, thanks and “I need help” get the quick reply.', 'its perfect , thank you', 'the full work loop', 'quick reply'],
  ['Follow-ups continue', 'A short line that points back (“it”, “that”, a lone “why”) carries on with the conversation: no question first, no shortcut.', 'can you add it to my desktop?', 'sorted as a code change', 'continues the conversation'],
  ['Plain commands skip the sort', 'Run, commit, install and git lines are sorted by a rule instead of by the brain.', 'run the tests', 'the brain sorts it', 'task, step by step'],
  ['No check when the rules are sure', 'A short request the rules already understand starts straight away.', 'rename test to check', 'asks the brain first', 'rename shortcut'],
  ['“Make me a page” goes step by step', 'Asking for a page or a file with no code named never takes the test-first path.', 'create a self contained html file… finance dashboard', 'sorted as a code change', 'sorted as a task, step by step'],
  ['The sort shows on screen', 'One dim line under your request says which path was picked. Esc stops it if it is wrong.', 'add a --json flag to export.mjs', 'nothing shown', 'Sorted as: change · shortcut'],
  ['Questions come with a pick list', 'Two or three likely answers from the brain, then “Type an answer”.', 'api', 'a question you answer by typing', 'a question with 3 answers to pick'],
  ['A sort test', `All ${rows.length} lines on this page are a test that runs with the unit tests, so a later rule change cannot quietly move them.`, 'every line below', 'checked by hand', 'checked on every test run'],
];
const changeCards = CHANGES.map(([title, line, ex, before, after], i) => `<div class="change"><div class="head"><i class="n">${i + 1}</i><b>${esc(title)}</b></div><p>${esc(line)}</p><div class="ex"><code>${esc(ex)}</code><span><s>${esc(before)}</s> → <b>${esc(after)}</b></span></div></div>`).join('\n');

const list = (items) => items.filter(Boolean).map((t) => `<li>${t}</li>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bonsai step 2 results</title>
<style>
:root{
  color-scheme:light dark;
  --bg:#f7f6f2;--card:#ffffff;--inner:#fbfaf7;--ink:#1c1b18;--mute:#6b675e;--faint:#a19c90;--line:#e3dfd5;--soft:#efece4;
  --t:#2a78d6;--m:#eb6834;--t-soft:rgba(42,120,214,.08);--m-soft:rgba(235,104,52,.09);--good:#1f8a4c;--bad:#c2452f;--best:rgba(31,138,76,.10);
  --term:#1b1c20;--term-ink:#e9e7e1;--term-dim:#9a978f;--term-line:#33353c;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#15161a;--card:#1d1f24;--inner:#23252b;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#34363e;--soft:#24262c;
    --t:#3987e5;--m:#e8743f;--t-soft:rgba(57,135,229,.13);--m-soft:rgba(232,116,63,.12);--good:#4fbf7f;--bad:#ee7b66;--best:rgba(79,191,127,.13);
    --term:#0f1013;--term-line:#2b2d34;
  }
}
:root[data-theme="dark"]{
  --bg:#15161a;--card:#1d1f24;--inner:#23252b;--ink:#ecebe6;--mute:#a4a19a;--faint:#6f6c66;--line:#34363e;--soft:#24262c;
  --t:#3987e5;--m:#e8743f;--t-soft:rgba(57,135,229,.13);--m-soft:rgba(232,116,63,.12);--good:#4fbf7f;--bad:#ee7b66;--best:rgba(79,191,127,.13);
  --term:#0f1013;--term-line:#2b2d34;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1240px;margin:0 auto;padding:26px 16px 48px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}
h2{font-size:21px;letter-spacing:-.01em;margin:40px 0 4px}
h2+p.sub{color:var(--mute);margin:0 0 12px;max-width:900px}
p{margin:0 0 10px}
code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.lede{color:var(--mute);max-width:900px;font-size:16px}
.lede b{color:var(--ink);font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px 15px;min-width:0}
.tile b{display:block;font-size:26px;letter-spacing:-.02em;line-height:1.15}
.tile span{display:block;color:var(--mute);font-size:13.5px;margin-top:4px}
.changes{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.change{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 15px 14px;min-width:0;display:flex;flex-direction:column}
.head{display:flex;align-items:center;gap:9px;margin-bottom:6px}
.n{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--ink);color:var(--bg);font-weight:600;font-size:12.5px;font-style:normal}
.head b{font-size:15px}
.change p{color:var(--mute);font-size:13.5px;margin:0 0 10px}
.ex{margin-top:auto;background:var(--inner);border:1px solid var(--soft);border-radius:10px;padding:8px 10px 9px;font-size:13px}
.ex code{display:block;color:var(--ink);margin-bottom:3px;overflow-wrap:anywhere}
.ex span{color:var(--mute)}
.ex s{text-decoration-color:var(--faint)}
.ex b{color:var(--ink);font-weight:600}
.screens{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.screens>div,.two>div{min-width:0}
.term{background:var(--term);color:var(--term-ink);border:1px solid var(--term-line);border-radius:14px;padding:14px 16px 16px;min-width:0;overflow-x:auto}
.term pre{margin:0;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre}
.cap{color:var(--mute);font-size:13px;margin:8px 2px 0}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.chip{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:7px 14px;border-radius:999px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.chip:hover{border-color:var(--faint)}
.chip.on{border-color:var(--t);background:linear-gradient(var(--t-soft),var(--t-soft)),var(--card)}
.wrap{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;vertical-align:top;padding:9px 12px;border-top:1px solid var(--soft)}
thead th{border-top:0;color:var(--mute);font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
td.num,th.num{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right}
td.num small{text-align:right}
td.req{min-width:240px;overflow-wrap:anywhere}
td.why{color:var(--mute);font-size:13px;min-width:180px}
td small{display:block;color:var(--faint);font-size:12px;margin-top:2px;font-weight:400}
td.new{background:var(--t-soft);color:var(--ink);font-weight:600}
td.best{background:var(--best);font-weight:600}
td.good,span.good{color:var(--good);font-weight:600}
td.bad,span.bad{color:var(--bad);font-weight:600}
span.bad{display:block;font-size:12px;margin-top:2px}
td ol{margin:4px 0 0;padding-left:20px;font-weight:400}
tr.group td{background:var(--inner);font-weight:600;color:var(--ink)}
tr.group td span{color:var(--mute);font-weight:400}
tr[hidden]{display:none}
ul.plain{margin:0;padding:0;list-style:none;background:var(--card);border:1px solid var(--line);border-radius:14px}
ul.plain li{padding:10px 16px;border-top:1px solid var(--soft);font-size:14px;color:var(--mute)}
ul.plain li:first-child{border-top:0}
li b{color:var(--ink);font-weight:600}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.two h2{margin-top:36px}
details{margin-top:10px}
summary{cursor:pointer;color:var(--mute);font-size:13.5px;padding:4px 2px}
details .wrap{margin-top:8px}
.foot{color:var(--faint);font-size:12.5px;margin-top:32px}
.foot a{color:inherit}
@media (max-width:1080px){.changes{grid-template-columns:repeat(2,1fr)}.tiles{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.screens,.two{grid-template-columns:1fr}.two h2{margin-top:28px}}
@media (max-width:560px){h1{font-size:26px}.changes{grid-template-columns:1fr}.tile b{font-size:22px}}
</style>
</head>
<body>
<main>
<h1>Step 2: built and measured</h1>
<p class="lede">How Bonsai sorts a request before any work starts. Eight changes, built in a worktree of their own and measured on the real 27B. <b>Nothing is committed: main is as it was.</b></p>

<div class="tiles">
${tiles}
</div>

<h2>Before and after</h2>
<p class="sub">Before is main (${esc(meta.before ?? '8fde96e')}). After is the step 2 worktree. The better cell is tinted; the last number column is my own subtraction.</p>
<div class="wrap">
<table>
<thead><tr><th>Measure</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th><th>Note</th></tr></thead>
<tbody>
${launch}
</tbody>
</table>
</div>

<h2>The eight changes</h2>
<p class="sub">Each with one real line: where it went before, and where it goes now.</p>
<div class="changes">
${changeCards}
</div>

<h2>What the screen shows</h2>
<p class="sub">The real app in a real terminal, as the screen test drives it. The brain’s words here are scripted by the test; the box, the numbers and the dim lines are the app’s own.</p>
<div class="screens">
  <div>
    <div class="term"><pre>${shots ? screen(shots.asking) : 'not run'}</pre></div>
    <p class="cap">A lone word: the question arrives with answers to pick. “Type an answer” and “Stop here” are the app’s usual last two lines. The box is drawn narrower here than on a full-width terminal.</p>
  </div>
  <div>
    <div class="term"><pre>${shots ? screen(shots.followed) : 'not run'}</pre></div>
    <p class="cap">The pick is sorted and the line says where it went. The short line after it carries on with the conversation.</p>
  </div>
</div>

<h2>Seconds until the work starts</h2>
<p class="sub">From Enter to the first step of work (the first word of the reply, the first tool, or the question on screen), on the real 27B. Each request ran three times on each code and was stopped at its first step; the big number is the middle one, the three are under it.</p>
<div class="wrap">
<table>
<thead><tr><th>Request</th><th class="num">Before, s</th><th class="num">After, s</th><th class="num">Change</th></tr></thead>
<tbody>
${fRows.length ? fRows.map(firstRow).join('\n') : '<tr><td colspan="4">not run</td></tr>'}
</tbody>
</table>
</div>

<h2>The 28 real requests, start to finish</h2>
<p class="sub">The test bench’s real requests on the 27B, everything auto-approved in throwaway folders, one run on each code. The brain’s answers differ from run to run, so a single request’s seconds can move either way; the rows the rules moved are tinted.</p>
<div class="wrap">
<table>
<thead><tr><th class="num">#</th><th>Request</th><th>Sorted, before</th><th>Sorted, after</th><th class="num">Before, s</th><th class="num">After, s</th><th class="num">Change</th></tr></thead>
<tbody>
${wRows.length ? wRows.map(wordRow).join('\n') : '<tr><td colspan="7">not run</td></tr>'}
</tbody>
</table>
</div>

<h2>The pick list on the real model</h2>
<p class="sub">Eight short requests in four practice projects, asked of Bonsai 2 27B the old way and the new way, before anything was built. Every answer word for word. The old way averages ${one(T.today)} s, the pick list ${one(T.kinds)} s.</p>
<div class="wrap">
<table>
<thead><tr><th>Request</th><th>Before: a question you type an answer to</th><th>After: a question with answers to pick</th></tr></thead>
<tbody>
${pickRows}
</tbody>
</table>
</div>

<h2>Every request, before and after</h2>
<p class="sub">Where the rules send each line, with no model called. Before is the code on main; After is the built code, which the sort test checks line by line.</p>
<div class="chips" id="chips">
  <button class="chip on" data-f="changed">Changed · ${moved.length}</button>
  <button class="chip" data-f="all">All · ${rows.length}</button>
  <button class="chip" data-f="yours">Your own lines · ${count('yours')}</button>
  <button class="chip" data-f="tasks">Practice tasks · ${count('tasks')}</button>
  <button class="chip" data-f="requests">Real requests · ${count('requests')}</button>
  <button class="chip" data-f="traps">Trap lines · ${count('traps')}</button>
</div>
<div class="wrap">
<table id="all">
<thead><tr><th class="num">#</th><th>Request</th><th>Before</th><th>After</th><th class="num">Model calls</th></tr></thead>
<tbody>
${Object.entries(SETS).map(([k, [name, what]]) => `<tr class="group" data-set="${k}" data-group="1"><td colspan="5">${esc(name)} <span>· ${esc(what)}</span></td></tr>\n${rows.filter((r) => r.set === k).map(lineRow).join('\n')}`).join('\n')}
</tbody>
</table>
</div>
<p class="cap">Model calls = calls to the brain before any work starts: the sort itself (inside a code project) or the “is this clear?” check. Your own lines were typed in your home folder, which is not a code project: the shortcuts are off there, so a line sorted as a change still goes step by step.</p>

<div class="two">
<div>
<h2>What I got wrong on the way</h2>
<ul class="plain">
${list(meta.wrong ?? [])}
</ul>
</div>
<div>
<h2>Limits you should know</h2>
<ul class="plain">
${list(meta.limits ?? [])}
</ul>
</div>
</div>

<div class="two">
<div>
<h2>What was changed</h2>
<ul class="plain">
${list(meta.changed ?? [])}
</ul>
</div>
<div>
<h2>What is real on this page</h2>
<ul class="plain">
${list(meta.real ?? [])}
</ul>
</div>
</div>

<p class="foot">bonsai-step-2-results-2026-09-27.html · built by models/evals/reports/report-step2.mjs from models/bonsai-2-27b/results/step2-sort-2026-09-27 · the plan this was built from: <a href="bonsai-step-2-plan-2026-09-27.html">bonsai-step-2-plan</a> · the harness in simple words: <a href="../diagrams/bonsai-harness-simple-2026-09-27.html">bonsai-harness-simple</a></p>
</main>
<script>
(function(){
  var chips = [].slice.call(document.querySelectorAll('#chips .chip'));
  var trs = [].slice.call(document.querySelectorAll('#all tbody tr'));
  function show(f){
    var seen = {};
    trs.forEach(function(tr){
      if (tr.getAttribute('data-group')) return;
      var ok = f === 'all' || (f === 'changed' ? tr.getAttribute('data-changed') === '1' && tr.getAttribute('data-set') !== 'traps' : tr.getAttribute('data-set') === f);
      tr.hidden = !ok;
      if (ok) seen[tr.getAttribute('data-set')] = true;
    });
    trs.forEach(function(tr){ if (tr.getAttribute('data-group')) tr.hidden = !seen[tr.getAttribute('data-set')]; });
    chips.forEach(function(c){ c.classList.toggle('on', c.getAttribute('data-f') === f); });
  }
  chips.forEach(function(c){ c.addEventListener('click', function(){ show(c.getAttribute('data-f')); }); });
  show('changed');
})();
</script>
</body>
</html>
`;
const out = docsPath('reports/bonsai-step-2-results-2026-09-27.html');
writeFileSync(out, html);
console.log(`wrote ${out.replace(homedir(), '~')}`);
console.log(`sorting ${moved.length} of ${real.length} moved · calls ${callsBefore} → ${callsAfter} · first step ${one(fMed(fMoved, 'before'))} → ${one(fMed(fMoved, 'after'))} s · real requests ${passB ?? '–'} → ${passA ?? '–'} of 28`);
