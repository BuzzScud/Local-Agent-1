// Builds the round-3 results page: every try at the chart bug (the symbol list
// hidden behind the EMA legend) and the 28-task check, in the launch style.
// Reads the raw results kept on this Mac; a run that has no result file yet
// shows as "not run".
//   node models/evals/reports/report-round3.mjs
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../docs/tools/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // the repo
const RES = join(root, 'models/bonsai-2-27b/results');
const R3 = join(RES, 'chart-bug-round3-2026-09-26');
const load = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (s) => (s == null ? null : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);
const LIMIT = 1500; // the 25 minute cap of a run

/* ---------- the chart bug runs ---------- */
// The files a fix can go in. Opening one of them is "reached the right code".
const RIGHT = /desks\/chart\/(index\.html|tv\/legend\.js|tv\/tv\.css)/;
// Naming the cause takes all three in one thought: the head strip sits at level 4, the
// legend is part of it, and the two are tied together (a stacking context, the same level,
// which paints on top). The rule alone, quoted from a search, is not the cause.
const CAUSE = { test: (t) => /\.hud[^\n]{0,80}z-index\s*:?\s*4/.test(t) && /tv-lg|legend/i.test(t) && /stacking context|same (level|z-index|layer)|paints? (on top|over|above)|later in the (DOM|page)/i.test(t) };

function analyse(r) {
  const ev = r.events ?? [];
  const tools = ev.filter((e) => e.type === 'tool');
  const calls = ev.filter((e) => e.type === 'assistant');
  const notes = ev.filter((e) => e.type === 'note');
  const at = (e) => (e ? e.at / 1000 : null);
  const tps = r.tps || 10.7;
  const model = calls.reduce((t, e) => t + (e.secs ?? 0), 0);
  const writing = calls.reduce((t, e) => t + Math.max((e.tokens ?? 0) / tps, e.thinkSecs ?? 0), 0);
  const edits = tools.filter((t) => /^(Update|Edit|Write)$/.test(t.label) && !t.error);
  return {
    secs: r.secs, pass: r.judge?.code === 0, timedOut: !!r.timedOut, stopped: r.reason === 'error' && !r.timedOut, stuck: r.reason === 'stuck',
    ctx: r.ctx, helper: r.helper, steps: r.steps ?? tools.length, asked: (r.asked ?? []).length, ctxUsed: r.ctxUsed ?? null,
    file: at(tools.find((t) => t.label === 'Read' && RIGHT.test(String(t.arg)))),
    cause: at(calls.find((e) => CAUSE.test(`${e.reasoning ?? ''} ${e.text ?? ''}`))),
    nudge: at(notes.find((n) => /named the cause/.test(n.text))),
    edit: at(edits[0]), edits: edits.length,
    trims: notes.filter((n) => /Trimmed old tool output/.test(n.text)).length,
    summaries: ev.filter((e) => e.type === 'compacted').length + notes.filter((n) => /outgrew the model/.test(n.text)).length,
    rereads: notes.filter((n) => /Trimmed old tool output/.test(n.text)).map((n) => { const c = calls.find((e) => e.at > n.at); return c ? Math.round(c.secs - Math.max((c.tokens ?? 0) / tps, c.thinkSecs ?? 0)) : 0; }),
    split: calls.length > 1 ? { reading: Math.round(model - writing), writing: Math.round(writing), other: Math.max(0, Math.round(r.secs - model)) } : null,
    diff: (r.diff ?? '').trim(),
    final: (r.finalText ?? '').trim(),
  };
}
const run = (file) => { const r = load(join(R3, file)); return r ? analyse(r) : null; };

// Round 2's High run has no result file, only its log and the report written that night.
const ROUND2_HIGH = { secs: LIMIT, pass: false, timedOut: true, stopped: false, stuck: false, ctx: 16384, helper: true, steps: 17, asked: 3, ctxUsed: null,
  file: 177, cause: 490, causeLost: 520, nudge: null, edit: null, edits: 0, trims: 0, summaries: 1, rereads: null, split: null, diff: '', final: '' };

const RUNS = [
  { key: 'h16', name: 'High · old code · 16k', when: 'Round 2 · 25 Sep night', given: 'words only', code: '9efa9bc', d: ROUND2_HIGH, color: '--c-third' },
  { key: 'h32old', name: 'High · old code · 32k', when: 'Control · tonight', given: 'words only', code: '9efa9bc', d: run('result-A-high-main32.json'), color: '--c-before' },
  { key: 'hstop', name: 'High · new code · 32k', when: 'This morning · stopped by you', given: 'words only', code: 'c5c4172', d: run('result-A-high-new.json'), color: '--c-after', stoppedByUser: true },
  { key: 'hnew', name: 'High · new code · 32k', when: 'Tonight · full run', given: 'words only', code: 'c5c4172', d: run('result-A-high-new-r2.json'), color: '--c-after', lead: true },
  { key: 'offnew', name: 'Low · new code · 32k', when: 'Control · tonight', given: 'words only', code: 'c5c4172', d: run('result-A-off-new.json'), color: '--c-fourth' },
  { key: 'offchk', name: 'Low · old code · 32k', when: 'This morning', given: 'words + the failing check', code: '9efa9bc', d: run('result-B-off-main.json'), color: '--c-before' },
  { key: 'offhead', name: 'Low · today\'s main · 32k', when: 'Tonight', given: 'words + the failing check', code: '7595055', d: run('result-B-off-head.json'), color: '--c-after' },
];
const R = Object.fromEntries(RUNS.map((r) => [r.key, r]));
const ran = RUNS.filter((r) => r.d);

/* ---------- the 28-task check ---------- */
const bar = load(join(RES, 'runs/2026-09-25-fast/after/summary.json'))?.results ?? [];
const nowFile = join(R3, 'bench-off-main-7595055/summary.json');
const now = load(nowFile)?.results ?? [];
const num = (t) => Number(t.split('-')[0]);
const taskNames = [...new Set([...bar, ...now].map((r) => r.task))].sort((a, b) => num(a) - num(b));
const TASKS = taskNames.map((t) => ({ task: t, n: num(t), prompt: existsSync(join(root, 'models/evals/bench/tasks', t, 'task.txt')) ? readFileSync(join(root, 'models/evals/bench/tasks', t, 'task.txt'), 'utf8').trim() : '',
  b: bar.find((r) => r.task === t) ?? null, a: now.find((r) => r.task === t) ?? null }));
const passes = (rows) => rows.filter((r) => r.pass).length;
const total = (rows) => rows.reduce((s, r) => s + r.secs, 0);
const BUDGETS = [15, 30, 60, 120, 240, 480];
const curve = (name, rows) => ({ name, n: rows.length, pts: BUDGETS.map((b) => { const done = rows.filter((r) => r.pass && r.secs <= b).length; return { b, done, pct: rows.length ? Math.round((done / rows.length) * 1000) / 10 : 0 }; }) });

/* ---------- words that depend on the results ---------- */
const TEXT = load(join(R3, 'page-text.json')) ?? {};
const T = (k, d = '') => TEXT[k] ?? d;

/* ---------- charts, drawn here as SVG ---------- */
const niceStep = (span, n) => { const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
const figure = ({ from, title, legend, svg, cap, table, wide }) => `<figure>${from ? `<div class="from">${esc(from)}</div>` : ''}<h3>${esc(title)}</h3>${legend ? `<div class="legend">${legend}</div>` : ''}<div class="scroll${wide ? ' wide' : ''}">${svg}</div>${cap ? `<figcaption>${cap}</figcaption>` : ''}${table ? `<details class="pts" open><summary>The numbers</summary><div class="wrap">${table}</div></details>` : ''}</figure>`;

// One row per run on a shared clock: what it reached, and when.
const MARKS = [
  ['file', 'reached the right code', '--c-before'],
  ['cause', 'named the cause', '--c-after'],
  ['nudge', 'told to act on it', '--c-third'],
  ['edit', 'made the change', '--c-fourth'],
];
const shape = (k, x, y, col) => (k === 'file' ? `<circle cx="${x}" cy="${y}" r="5" fill="var(--card)" stroke="var(${col})" stroke-width="2.5"/>`
  : k === 'cause' ? `<circle cx="${x}" cy="${y}" r="6" fill="var(${col})" stroke="var(--card)" stroke-width="2"/>`
  : k === 'nudge' ? `<path d="M${x} ${y - 7} L${x + 7} ${y} L${x} ${y + 7} L${x - 7} ${y} Z" fill="var(${col})" stroke="var(--card)" stroke-width="2"/>`
  : `<rect x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" rx="2" fill="var(${col})" stroke="var(--card)" stroke-width="2"/>`);
function timeline(rows) {
  const W = 860, L = 214, Rt = 118, Tp = 14, rowH = 62, H = Tp + rows.length * rowH + 34;
  const X = (s) => L + (s / LIMIT) * (W - L - Rt);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="What each run reached, and when" style="max-width:none">`;
  for (let m = 0; m <= 25; m += 5) s += `<line class="grid" x1="${X(m * 60)}" x2="${X(m * 60)}" y1="${Tp}" y2="${H - 30}"/><text x="${X(m * 60)}" y="${H - 16}" text-anchor="middle">${m} min</text>`;
  rows.forEach((r, i) => {
    const d = r.d, y = Tp + i * rowH + 38;
    s += `<text class="lbl" x="${L - 14}" y="${y - 4}" text-anchor="end" style="font-weight:600;font-size:12px">${esc(r.name)}</text><text x="${L - 14}" y="${y + 10}" text-anchor="end">${esc(r.when)}</text>`;
    s += `<line x1="${X(0)}" x2="${X(d.secs)}" y1="${y}" y2="${y}" stroke="var(--faint)" stroke-width="2" stroke-linecap="round"/>`;
    const end = d.pass ? `✓ fixed · ${mmss(d.secs)}` : r.stoppedByUser ? `stopped · ${mmss(d.secs)}` : `✗ not fixed · ${mmss(d.secs)}`;
    s += `<line x1="${X(d.secs)}" x2="${X(d.secs)}" y1="${y - 8}" y2="${y + 8}" stroke="var(--ink)" stroke-width="2"/><text class="lbl" x="${X(d.secs) + 8}" y="${y + 4}" style="font-weight:600">${end}</text>`;
    let lastX = -99, level = 0;
    MARKS.map(([k, name, col]) => ({ k, name, col, t: d[k] })).filter((m) => m.t != null).sort((a, b) => a.t - b.t).forEach((m) => {
      const x = X(m.t);
      level = x - lastX < 58 ? (level + 1) % 2 : 0; lastX = x;
      s += `<g><title>${esc(r.name)} · ${esc(m.name)} at ${mmss(m.t)}</title>${shape(m.k, x, y, m.col)}<text class="lbl" x="${x}" y="${y - 13 - level * 12}" text-anchor="middle" style="font-size:10.5px">${mmss(m.t)}</text></g>`;
    });
    if (d.causeLost) s += `<g><title>${esc(r.name)} · memory filled at ${mmss(d.causeLost)}; the summary lost the cause</title><text x="${X(d.causeLost) + 12}" y="${y + 19}" style="font-size:10.5px">memory filled ${mmss(d.causeLost)}, cause lost</text></g>`;
  });
  s += '</svg>';
  const legend = MARKS.map(([k, name, col]) => `<span><svg viewBox="-9 -9 18 18" style="width:16px;height:16px;margin:0;display:inline-block">${shape(k, 0, 0, col)}</svg>${esc(name)}</span>`).join('');
  const cell = (v, q) => (v == null ? `<td class="na">—${q ? `<span class="c">${esc(q)}</span>` : ''}</td>` : `<td>${mmss(v)}</td>`);
  const table = `<table><thead><tr><th></th>${MARKS.map(([, n]) => `<th>${esc(n)}</th>`).join('')}<th>ended</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}<span class="c">${esc(r.when)}</span></td>${MARKS.map(([k]) => cell(r.d[k], k === 'cause' && r.d.edit != null ? 'went straight to the fix' : 'never')).join('')}<td>${mmss(r.d.secs)}<span class="c">${r.d.pass ? 'fixed' : r.stoppedByUser ? 'stopped by you' : r.d.stuck ? 'stopped itself' : 'time limit'}</span></td></tr>`).join('')}</tbody></table>`;
  return figure({ from: 'run-tries.mjs · the events of each run', title: 'What each run reached, and when', legend, svg: s, table, wide: true,
    cap: T('CAP_TIMELINE', 'One row per run, all on the same 25-minute clock. The mark at the right end is where the run ended.') });
}

// Where the seconds of a run went: the model reading its memory, the model writing, the rest.
const PARTS = [['reading', 'The model reading its memory', '--c-before'], ['writing', 'The model thinking and writing', '--c-after'], ['other', 'Tools and everything else', '--c-third']];
function splitBars(rows) {
  const W = 860, L = 214, Rt = 60, Tp = 8, rowH = 40, H = Tp + rows.length * rowH + 34;
  const step = 300, x1 = Math.ceil(Math.max(...rows.map((r) => r.d.secs)) / step) * step;
  const X = (v) => L + (v / x1) * (W - L - Rt);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Where the seconds went" style="max-width:none">`;
  for (let v = 0; v <= x1 + 1e-9; v += step) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${Tp}" y2="${H - 30}"/><text x="${X(v)}" y="${H - 16}" text-anchor="middle">${v / 60} min</text>`;
  rows.forEach((r, i) => {
    const y = Tp + i * rowH + 12; let x = 0;
    s += `<text class="lbl" x="${L - 14}" y="${y + 6}" text-anchor="end" style="font-weight:600;font-size:12px">${esc(r.name)}</text><text x="${L - 14}" y="${y + 19}" text-anchor="end">${esc(r.when)}</text>`;
    PARTS.forEach(([k, name, col]) => {
      const v = r.d.split[k]; if (!v) return;
      const w = Math.max(0, X(x + v) - X(x) - 2);
      s += `<rect x="${X(x)}" y="${y}" width="${w}" height="14" rx="3" fill="var(${col})"><title>${esc(r.name)} · ${esc(name)}: ${mmss(v)} (${Math.round((v / r.d.secs) * 100)}%)</title></rect>`;
      if (w > 44) s += `<text x="${X(x) + w / 2}" y="${y + 27}" text-anchor="middle" style="font-size:10.5px">${Math.round((v / r.d.secs) * 100)}%</text>`;
      x += v;
    });
  });
  s += '</svg>';
  const legend = PARTS.map(([, name, col]) => `<span><i style="background:var(${col})"></i>${esc(name)}</span>`).join('');
  const table = `<table><thead><tr><th></th>${PARTS.map(([, n]) => `<th>${esc(n)}</th>`).join('')}<th>Whole run</th><th>Words written</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}<span class="c">${esc(r.when)}</span></td>${PARTS.map(([k]) => `<td>${mmss(r.d.split[k])}<span class="c">${Math.round((r.d.split[k] / r.d.secs) * 100)}%</span></td>`).join('')}<td>${mmss(r.d.secs)}</td><td>${(r.raw?.outTokens ?? 0).toLocaleString()} tokens</td></tr>`).join('')}</tbody></table>`;
  return figure({ from: 'run-tries.mjs · seconds and tokens of every model call', title: 'Where the minutes went', legend, svg: s, table, wide: true, cap: T('CAP_SPLIT', '') });
}

const budgetLabel = (b) => (b < 60 ? `${b}s` : `${b / 60}m`);
function curves(series, lead) {
  const W = 560, H = 300, L = 46, Rt = 14, Tp = 12, B = 40;
  const x0 = BUDGETS[0] / 1.3, x1 = BUDGETS[BUDGETS.length - 1] * 1.3;
  const X = (v) => L + ((Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0))) * (W - L - Rt);
  const Y = (v) => Tp + (1 - v / 100) * (H - Tp - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tasks done within a time budget">`;
  for (let v = 0; v <= 100; v += 20) s += `<line class="grid" x1="${L}" x2="${W - Rt}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 7}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`;
  BUDGETS.forEach((v) => { s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${Tp}" y2="${H - B}" stroke-dasharray="2 3"/><text x="${X(v)}" y="${H - B + 15}" text-anchor="middle">${budgetLabel(v)}</text>`; });
  s += `<line class="axis" x1="${L}" x2="${W - Rt}" y1="${H - B}" y2="${H - B}"/><text x="${(L + W - Rt) / 2}" y="${H - 6}" text-anchor="middle">Time budget per task (seconds, log scale)</text><text transform="translate(11 ${(Tp + H - B) / 2}) rotate(-90)" text-anchor="middle">Tasks done within the budget (%)</text>`;
  [...series.filter((c) => c.key !== lead), ...series.filter((c) => c.key === lead)].forEach((c) => {
    const isLead = c.key === lead;
    s += `<polyline fill="none" stroke="var(${c.color})" stroke-width="${isLead ? 2.6 : 1.8}" stroke-linejoin="round" points="${c.pts.map((p) => `${X(p.b)},${Y(p.pct)}`).join(' ')}"/>`;
    c.pts.forEach((p) => {
      s += `<circle cx="${X(p.b)}" cy="${Y(p.pct)}" r="${isLead ? 4.2 : 3.4}" fill="var(${c.color})" stroke="var(--card)" stroke-width="1.5"><title>${esc(c.name)} · within ${budgetLabel(p.b)}: ${p.pct}% (${p.done} of ${c.n})</title></circle>`;
      if (isLead) s += `<text class="lbl" x="${X(p.b)}" y="${Y(p.pct) - 9}" text-anchor="middle" style="font-weight:600;font-size:10px">${budgetLabel(p.b)}</text>`;
    });
  });
  s += '</svg>';
  const best = BUDGETS.map((b, i) => Math.max(...series.map((c) => c.pts[i].pct)));
  const table = `<table><thead><tr><th></th>${BUDGETS.map((b) => `<th>${budgetLabel(b)}</th>`).join('')}</tr></thead><tbody>${series.map((c) => `<tr><td><span class="dot" style="background:var(${c.color});margin-right:6px"></span>${esc(c.name)}</td>${c.pts.map((p, i) => `<td${p.pct === best[i] ? ' style="font-weight:700"' : ''}>${p.pct}%<span class="c">${p.done} of ${c.n}</span></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return figure({ from: 'models/evals/bench/run.mjs · the 28 practice tasks, effort Low', title: 'Practice tasks done within a time budget', svg: s, table,
    legend: series.map((c) => `<span><i class="line" style="border-color:var(${c.color})"></i>${esc(c.name)}</span>`).join(''), cap: T('CAP_CURVES', 'A line further up and to the left is better.') });
}
function taskLines(rows) {
  const W = 560, H = 300, L = 44, Rt = 14, Tp = 12, B = 46;
  const max = Math.max(...rows.flatMap((r) => [r.b?.secs ?? 0, r.a?.secs ?? 0]));
  const step = niceStep(max, 5), y1 = Math.ceil(max / step) * step;
  const X = (i) => L + (i / (rows.length - 1)) * (W - L - Rt);
  const Y = (v) => Tp + (1 - v / y1) * (H - Tp - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Seconds per task, the bar and tonight">`;
  for (let v = 0; v <= y1 + 1e-9; v += step) s += `<line class="grid" x1="${L}" x2="${W - Rt}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 7}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`;
  s += `<line class="axis" x1="${L}" x2="${W - Rt}" y1="${H - B}" y2="${H - B}"/>`;
  rows.forEach((r, i) => { s += `<text x="${X(i)}" y="${H - B + 14}" text-anchor="middle" style="font-size:9.5px">${r.n}</text>`; });
  s += `<text x="${(L + W - Rt) / 2}" y="${H - 6}" text-anchor="middle">task number</text><text transform="translate(11 ${(Tp + H - B) / 2}) rotate(-90)" text-anchor="middle">seconds</text>`;
  [['b', 'The bar · 25 Sep', '--c-before', false], ['a', 'Tonight', '--c-after', true]].forEach(([k, name, col, lead]) => {
    const ps = rows.map((r, i) => ({ i, r, v: r[k]?.secs })).filter((p) => p.v != null);
    s += `<polyline fill="none" stroke="var(${col})" stroke-width="${lead ? 2.6 : 1.8}" stroke-linejoin="round" points="${ps.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')}"/>`;
    ps.forEach((p) => { s += `<circle cx="${X(p.i)}" cy="${Y(p.v)}" r="${lead ? 4.2 : 3.4}" fill="var(${col})" stroke="var(--card)" stroke-width="1.5"><title>${esc(p.r.task)} · ${name}: ${p.v} s${p.r[k].pass ? '' : ' · FAILED'}</title></circle>`; if (!p.r[k].pass) s += `<text class="lbl" x="${X(p.i)}" y="${Y(p.v) - 9}" text-anchor="middle" style="font-weight:700;font-size:10.5px">✗ ${p.r.n}</text>`; });
  });
  s += '</svg>';
  return figure({ from: 'models/evals/bench/run.mjs · effort Low, one run each', title: 'Seconds per task', svg: s,
    legend: '<span><i class="line" style="border-color:var(--c-before)"></i>The bar · 25 Sep</span><span><i class="line" style="border-color:var(--c-after)"></i>Tonight · today\'s main</span>', cap: T('CAP_LINES', 'One dot per task, in task order. ✗ marks a task that failed.') });
}

/* ---------- the launch table ---------- */
const COLS = ['h16', 'h32old', 'hnew', 'offnew', 'offchk', 'offhead'].map((k) => R[k]);
const D = (k) => R[k].d;
const val = (r, f) => (r.d ? f(r.d) : undefined);
// [area, measure, footnote, get, format, lowerIsBetter, qualifier]
const sum = (a) => a.reduce((t, v) => t + v, 0);
const ROWS = [
  ['The bug', 'Fixed, as judged in the browser', '1', (d) => (d.pass ? 1 : 0), (v) => (v ? 'Fixed' : 'Not fixed'), false, (d, r) => (d.pass ? `in ${mmss(d.secs)}` : d.timedOut ? 'ran into the 25 min limit' : d.stuck ? `stopped itself at ${mmss(d.secs)}, repeating one step` : '')],
  ['Finding the code', 'Minutes until it opened a file the fix can go in', '2', (d) => d.file, mmss, true, () => ''],
  ['Working out why', 'Minutes until it named the cause', '3', (d) => d.cause, mmss, true, (d) => (d.causeLost ? `lost again at ${mmss(d.causeLost)}` : d.nudge ? `told to act at ${mmss(d.nudge)}` : '')],
  ['Making the change', 'Files changed', '', (d) => d.edits, (v) => String(v), false, (d) => (d.edit != null ? `first change at ${mmss(d.edit)}` : '')],
  ['Memory', 'Times its memory filled and was summarized', '4', (d) => d.summaries, (v) => String(v), true, (d) => `${d.trims} trim${d.trims === 1 ? '' : 's'} of old output`],
  ['Memory', 'Minutes spent reading its whole memory again after a trim', '5', (d) => (d.rereads ? sum(d.rereads) : null), mmss, true, (d) => (d.rereads?.length ? `${d.rereads.length} time${d.rereads.length === 1 ? '' : 's'}: ${d.rereads.map(mmss).join(' + ')}` : d.rereads ? 'no trim' : ''), 'not recorded'],
  ['Memory', 'Memory in use at the end, in tokens', '4', (d) => d.ctxUsed, (v) => v.toLocaleString(), null, (d) => `of ${d.ctx.toLocaleString()}`, 'not recorded'],
  ['Work', 'Steps taken', '', (d) => d.steps, (v) => String(v), null, (d) => `${d.asked} question${d.asked === 1 ? '' : 's'} asked`],
];
const launchRows = ROWS.map(([area, measure, fn, get, fmt, lower, qual, none]) => {
  const vals = COLS.map((r) => (r.d ? get(r.d) : undefined));
  const nums = vals.filter((v) => v != null);
  const top = lower == null || !nums.length ? null : lower ? Math.min(...nums) : Math.max(...nums);
  const allSame = nums.every((v) => v === nums[0]);
  const cells = COLS.map((r, i) => {
    const v = vals[i];
    if (v === undefined) return `<td class="na">—<span class="q">${esc(T('NOT_RUN', 'not run'))}</span></td>`;
    const q = qual(r.d, r);
    if (v == null) return `<td class="na">—<span class="q">${esc(none ?? (measure.startsWith('Minutes until it named') && r.d.edit != null ? 'went straight to the fix' : 'never'))}</span></td>`;
    return `<td${top != null && v === top && !allSame ? ' class="best"' : ''}>${fmt(v)}${q ? `<span class="q">${esc(q)}</span>` : ''}</td>`;
  }).join('');
  const b = val(R.h32old, get), a = val(R.hnew, get);
  let delta = '<td class="sep na">—</td>';
  if (b != null && a != null && lower != null) {
    const d = a - b, good = lower ? d < 0 : d > 0;
    const txt = /Minutes/.test(measure) ? `${d > 0 ? '+' : d < 0 ? '−' : ''}${mmss(Math.abs(d))}` : `${d > 0 ? '+' : ''}${d}`;
    delta = `<td class="sep delta ${d === 0 ? '' : good ? 'up' : 'down'}">${d === 0 ? 'same' : txt}</td>`;
  }
  return `<tr><td class="bench"><b>${esc(area)}</b><span>${esc(measure)}${fn ? `<sup>${fn}</sup>` : ''}</span></td>${cells}${delta}</tr>`;
}).join('');

/* ---------- the task table ---------- */
const pct = (b, a) => (b ? `${a - b > 0 ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '');
const deltaCell = (b, a) => { if (b == null || a == null) return '<td class="sep na">—</td>'; const d = a - b; return `<td class="sep delta ${d < 0 ? 'up' : d > 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d} s<span class="q">${pct(b, a)}</span></td>`; };
const secsCells = (b, a) => (b == null || a == null ? `<td class="${b == null ? 'na' : ''}">${b != null ? `${b} s` : '—'}</td><td class="${a == null ? 'na' : ''}">${a != null ? `${a} s` : '—'}</td>` : `<td class="${b < a ? 'best' : ''}">${b.toLocaleString()} s</td><td class="${a <= b ? 'best' : ''}">${a.toLocaleString()} s</td>`);
const passCell = (r) => (r == null ? '<td class="na">—</td>' : `<td class="${r.pass ? 'ok' : 'bad'}">${r.pass ? 'pass' : 'fail'}</td>`);
const done = TASKS.filter((t) => t.a);
const both = TASKS.filter((t) => t.a && t.b);
const taskRows = TASKS.map((t) => `<tr><td class="bench"><b>${esc(t.task)}</b><span>${esc(t.prompt.length > 110 ? `${t.prompt.slice(0, 107)}…` : t.prompt)}</span>${t.a && !t.a.pass ? `<span class="q" style="color:var(--down)">${esc(t.a.why || t.a.reason)}</span>` : ''}</td><td>${esc(t.a?.route ?? t.b?.route ?? '')}</td>${passCell(t.b)}${passCell(t.a)}${secsCells(t.b?.secs, t.a?.secs)}${deltaCell(t.b?.secs, t.a?.secs)}</tr>`).join('');

/* ---------- the page ---------- */
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
.card p{font-size:14px;color:var(--mute);margin:8px 0 0}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}tr:last-child td{border-bottom:none}
thead th{font-size:13px;color:var(--mute);font-weight:600;background:var(--soft);white-space:normal;min-width:104px}thead th span{display:block;font-weight:400;font-size:12px}
td.bench{white-space:normal;min-width:210px}td.bench b{display:block;font-weight:600}td.bench span{color:var(--mute);font-size:13px}
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
.pts table{font-size:12.5px}.pts .wrap{margin-top:10px}.pts th,.pts td{padding:6px 9px}details.pts summary{cursor:pointer;color:var(--mute);font-size:12.5px;margin-top:8px}.pts td .c{display:block;color:var(--mute);font-weight:400;font-size:11.5px}.pts td:first-child{white-space:nowrap;font-weight:600}
.grade{display:flex;flex-direction:column;gap:14px;margin-top:22px}.grade .hero{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;display:grid;grid-template-columns:auto 1fr;gap:6px 28px;align-items:center}.grade .hero .g{font-size:84px;line-height:1;font-weight:800;letter-spacing:-.04em;grid-row:span 2}.grade .hero .v{font-size:16px;max-width:820px}.grade .hero .w{color:var(--mute);font-size:13.5px;max-width:820px;margin:0}td.g{font-weight:800;font-size:18px;width:64px}td.ev{white-space:normal;min-width:240px;font-size:13.5px}td.ev b{display:block;font-weight:600;font-size:14px;color:var(--ink)}@media (max-width:640px){.grade .hero{grid-template-columns:1fr}.grade .hero .g{grid-row:auto}}
pre{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 14px;overflow-x:auto;font:12.5px/1.5 ui-monospace,Menlo,monospace;margin:10px 0}.del{color:var(--down)}.add{color:var(--up)}
.foot{margin-top:40px;color:var(--mute);font-size:13px}.foot li{margin:3px 0}code{font:12.5px ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:4px}
@media (max-width:600px){h1{font-size:25px}th,td{padding:8px 10px}}
`;

const diffHtml = (d) => esc(d).split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).map((l) => (l.startsWith('+') ? `<span class="add">${l}</span>` : l.startsWith('-') ? `<span class="del">${l}</span>` : l)).join('\n');
const fixes = RUNS.filter((r) => r.d?.diff).map((r) => `<h3 style="margin-top:16px">${esc(r.name)} <span style="color:var(--mute);font-weight:400;font-size:13px">${esc(r.when)} · ${esc(r.given)} · ${r.d.pass ? 'judged fixed' : 'judged NOT fixed'}</span></h3><pre>${diffHtml(r.d.diff.length > 2400 ? `${r.d.diff.slice(0, 2400)}\n…` : r.d.diff)}</pre>`).join('');
const splitRows = RUNS.filter((r) => r.d?.split).map((r) => ({ ...r, raw: load(join(R3, { hstop: 'result-A-high-new.json', hnew: 'result-A-high-new-r2.json', h32old: 'result-A-high-main32.json', offnew: 'result-A-off-new.json', offhead: 'result-B-off-head.json', offchk: 'result-B-off-main.json' }[r.key] ?? '')) }));
const grades = (TEXT.GRADES ?? []).map(([area, sub, g, ev, lift]) => `<tr><td class="bench"><b>${esc(area)}</b><span>${esc(sub)}</span></td><td class="g">${esc(g)}</td><td class="ev">${ev}</td><td class="ev">${lift}</td></tr>`).join('');
const notes = (TEXT.NOTES ?? []).map((n, i) => `<p><sup>${i + 1}</sup> ${n}</p>`).join('');
const benchDone = done.length === 28;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bonsai Code round 3 results</title><style>${css}</style></head><body><main>
<h1>Bonsai Code, round 3: the results</h1>
<p class="lede">${T('LEDE', 'Every measured run of 26 Sep 2026: the tries at the chart bug (the symbol list hidden behind the EMA legend) and the 28-task check. Bonsai 2 27B on the M4. The highlighted cell in each row is the better one.')}</p>
<nav><a href="#grade">Grade</a><a href="#glance">At a glance</a><a href="#launch">Launch table</a><a href="#clock">On the clock</a><a href="#fixes">The changes it made</a><a href="#tasks">The 28-task check</a><a href="#notes">Notes</a><a href="#sources">Where the numbers come from</a></nav>

<section id="grade"><h2>The grade</h2>
<p class="sub">${T('GRADE_SUB', '')}</p>
<div class="grade">
  <div class="hero"><div class="g">${T('GRADE', '—')}</div><div class="v">${T('HERO_V', '')}</div><div class="w">${T('HERO_W', '')}</div></div>
  ${grades ? `<div class="wrap"><table><thead><tr><th>Area</th><th>Grade</th><th>The evidence</th><th>What lifts it</th></tr></thead><tbody>${grades}</tbody></table></div>` : ''}
</div></section>

<section id="glance"><div class="cards">
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-before)"></span>The chart bug</div><dl>
    ${RUNS.filter((r) => r.d && r.key !== 'h16').map((r) => `<dt>${esc(r.name.replace(' · 32k', ''))}<br><span style="font-size:12px">${esc(r.when)}</span></dt><dd>${r.d.pass ? `<b style="color:var(--up)">Fixed</b> in ${mmss(r.d.secs)}` : r.stoppedByUser ? `Stopped at ${mmss(r.d.secs)}, no change` : `<b style="color:var(--down)">Not fixed</b> · ${mmss(r.d.secs)}${r.d.edits ? ` · ${r.d.edits} change${r.d.edits === 1 ? '' : 's'}` : ' · no change'}`}</dd>`).join('')}</dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-after)"></span>The 28-task check</div><dl>
    <dt>The bar · 25 Sep</dt><dd>${passes(bar)} of ${bar.length} pass · ${total(bar).toLocaleString()} s</dd>
    <dt>Tonight · today's main</dt><dd>${done.length ? `${passes(now)} of ${now.length} pass · ${total(now).toLocaleString()} s` : 'not run'}${benchDone ? ` <span style="color:var(${total(now) <= total(bar) ? '--up' : '--down'})">(${pct(total(bar), total(now))})</span>` : done.length ? ` <span style="color:var(--mute)">(stopped after ${done.length})</span>` : ''}</dd>
    ${T('CARD_TASKS', '')}</dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-third)"></span>What is still open</div>${T('CARD_OPEN', '')}</div>
</div></section>

<section id="launch"><h2>Chart bug launch table</h2>
<p class="sub">${T('LAUNCH_SUB', 'Every run in one table. The highlighted cell in each row is the best; for minutes that is the smallest. The last column is my own subtraction: High on the new code against High on the old code, both at 32k.')}</p>
<div class="wrap"><table><thead><tr><th></th>${COLS.map((r) => `<th>${esc(r.name)}<span>${esc(r.when)}</span><span>${esc(r.given)}</span></th>`).join('')}<th class="sep">High: new vs old code<span>both at 32k</span></th></tr></thead><tbody>${launchRows}</tbody></table></div>
<div class="notes">${T('LAUNCH_NOTES', '')}</div></section>

<section id="clock"><h2>On the clock</h2>
<p class="sub">${T('CLOCK_SUB', '')}</p>
<div class="charts one">${timeline(ran)}${splitRows.length ? splitBars(splitRows) : ''}</div></section>

<section id="fixes"><h2>The changes it made</h2>
<p class="sub">${T('FIXES_SUB', 'Every change a run left in its test copy of MAIN2026, as the diff. MAIN2026 itself is untouched.')}</p>
${fixes || '<p class="sub">No run changed a file.</p>'}</section>

<section id="tasks"><h2>The 28-task check</h2>
<p class="sub">${T('TASKS_SUB', '')}</p>
${done.length ? `<div class="charts">${curves([{ key: 'bar', name: 'The bar · 25 Sep', color: '--c-before', ...curve('The bar · 25 Sep', bar) }, { key: 'now', name: `Tonight · today's main${benchDone ? '' : ` (${done.length} tasks)`}`, color: '--c-after', ...curve('Tonight', now) }], 'now')}${taskLines(TASKS)}</div>` : ''}
<div class="wrap" style="margin-top:16px"><table><thead><tr><th>Task</th><th>Path</th><th>The bar</th><th>Tonight</th><th>The bar</th><th>Tonight</th><th class="sep">Change</th></tr></thead><tbody>
${taskRows}
<tr><td class="bench"><b>${benchDone ? 'All 28' : `The ${both.length} tasks run on both sides`}</b></td><td></td><td class="ok">${passes(both.map((t) => t.b))} pass</td><td class="${passes(both.map((t) => t.a)) === both.length ? 'ok' : 'bad'}">${passes(both.map((t) => t.a))} pass</td>${secsCells(total(both.map((t) => t.b)), total(both.map((t) => t.a)))}${deltaCell(total(both.map((t) => t.b)), total(both.map((t) => t.a)))}</tr>
</tbody></table></div></section>

<section id="notes"><h2>Notes</h2><div class="notes">${notes}</div></section>

<section class="foot" id="sources"><h3 style="color:var(--ink)">Where the numbers come from</h3><ul>
<li>The chart bug runs: <code>models/bonsai-2-27b/results/chart-bug-round3-2026-09-26/</code> — one <code>result-*.json</code>, <code>events-*.jsonl</code> and <code>run-*.log</code> per run; the runner is <code>run-tries.mjs</code>, the judge <code>judge.mjs</code> (WebKit, 1715 × 1100). Results stay on this Mac, not in git.</li>
<li>Round 2's High run: <code>…/chart-bug-round2-2026-09-25/run-high.log</code> and that night's page.</li>
<li>The 28-task check: <code>…/chart-bug-round3-2026-09-26/bench-off-main-7595055/summary.json</code>; the bar: <code>…/results/runs/2026-09-25-fast/after/summary.json</code>.</li>
<li>The code under test is frozen in the same folder: <code>main-9efa9bc</code> (old), <code>new-c5c4172</code> (new), <code>main-7595055</code> (today's main).</li>
<li>This page: <code>node models/evals/reports/report-round3.mjs</code>; its words: <code>page-text.json</code> in the round-3 folder.</li></ul>
<p>Nothing on this page loads from the internet. Point at a mark to see its exact numbers.</p></section>
</main></body></html>`;

const out = docsPath('tests/bonsai-round-3-results-2026-09-26.html');
writeFileSync(out, html);
console.log(`wrote ${out.replace(homedir(), '~')} (${(html.length / 1024).toFixed(0)} KB)`);
if (!(process.env.AGENTIC_NO_DESKTOP ?? process.env.BONSAI_NO_DESKTOP)) { const desk = join(homedir(), 'Desktop', 'bonsai-round-3-results-2026-09-26.html'); copyFileSync(out, desk); console.log(`copied to ${desk.replace(homedir(), '~')}`); }
