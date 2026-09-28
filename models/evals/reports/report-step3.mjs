// Builds the step 3 results page (the round of 27 Sep 2026): the chart bug
// before and after, the 28 practice tasks before and after, and the five
// parts that were built. Reads the raw results kept on this Mac; a run that
// has no result file yet shows as "not run". In the launch style.
//   node models/evals/reports/report-step3.mjs
// From a worktree: BONSAI_DOCS=~/Desktop/bonsai-code/'bonsai-code DOCS' (the
// results are looked for in ~/Desktop/bonsai-code when this tree has none).
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../docs/tools/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const here = join(root, 'models/bonsai-2-27b/results');
const RES = (process.env.AGENTIC_RESULTS ?? process.env.BONSAI_RESULTS) ?? (existsSync(join(here, 'step3-2026-09-27')) ? here : join(homedir(), 'Desktop/bonsai-code/models/bonsai-2-27b/results'));
const S3 = join(RES, 'step3-2026-09-27');
const OLD = join(RES, 'fable-harness-2026-09-27');
const load = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mmss = (s) => (s == null ? null : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);
const TEXT = load(join(S3, 'page-text.json')) ?? {};
const T = (k, d = '') => TEXT[k] ?? d;
const LIMIT = 1500; // the 25 minute cap of a try

/* ---------- the chart bug tries ---------- */
const RIGHT = /desks\/chart\/(index\.html|tv\/legend\.js|tv\/tv\.css)/;
function analyse(r) {
  const ev = r.events ?? [];
  const tools = ev.filter((e) => e.type === 'tool');
  const calls = ev.filter((e) => e.type === 'assistant');
  const notes = ev.filter((e) => e.type === 'note');
  const at = (e) => (e ? e.at / 1000 : null);
  const tps = 10.7;
  const reread = (t) => { const c = calls.find((e) => e.at > t); return c ? Math.max(0, Math.round(c.secs - Math.max((c.tokens ?? 0) / tps, c.thinkSecs ?? 0))) : null; };
  const trims = notes.filter((n) => /Trimmed old tool output/.test(n.text)).map((n) => ({ at: at(n), cost: reread(n.at) }));
  const wrote = ev.filter((e) => e.type === 'compacted').map((e) => ({ at: at(e), inPlace: !!e.inPlace, cost: Math.round((e.secs ?? 0) + (reread(e.at) ?? 0)) }));
  const edits = tools.filter((t) => /^(Update|Edit|Write)$/.test(t.label) && !t.error);
  return {
    secs: r.secs, pass: !!r.pass, timedOut: !!r.timedOut, reason: r.reason, steps: r.steps ?? tools.length,
    page: at(tools.find((t) => t.label === 'Browser' && !t.error)),
    check: at(tools.find((t) => t.label === 'Test' && !t.error)),
    // With a check made, the browser named the lines: there was no search for the code.
    file: tools.some((t) => t.label === 'Test' && !t.error) ? null : at(tools.find((t) => (t.label === 'Read' || t.label === 'Search') && RIGHT.test(`${t.arg} ${t.view?.content ?? ''}`.slice(0, 4000)))),
    edit: at(edits[0]), edits: edits.length, changed: (r.changed ?? []).map((c) => c.replace(/^\S+\s+/, '')),
    trims, wrote, memory: [...trims, ...wrote].sort((a, b) => a.at - b.at),
    lost: [...trims, ...wrote].reduce((t, m) => t + (m.cost ?? 0), 0),
    diff: (r.diff ?? '').trim(), final: (r.finalText ?? '').trim(), made: r.made ?? [],
  };
}
const tries = (dir) => { try { return readdirSync(dir).filter((f) => /^result-rep\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(10), 10) - parseInt(b.slice(10), 10)).map((f) => analyse(load(join(dir, f)))); } catch { return []; } };
const GROUPS = [
  { key: 'before', name: 'Before', when: 'old code · step by step', sub: 'the words alone, 27 Sep afternoon', color: '--c-before', d: tries(join(OLD, 'chart/before')) },
  { key: 'loop', name: 'Step by step', when: 'new code · check first off', sub: 'the words alone, tonight', color: '--c-third', d: tries(join(S3, 'chart/loop-new')) },
  { key: 'first', name: 'Check first', when: 'new code', sub: 'the words alone, tonight', color: '--c-after', d: [...tries(join(S3, 'chart/check-first')), ...tries(join(S3, 'chart/check-first-all'))] },
];
const G = Object.fromEntries(GROUPS.map((g) => [g.key, g]));
// The second version of the notes, measured on a shorter try (13 minutes): only its memory fills are used.
const NOTES2 = tries(join(S3, 'chart/loop-notes2'));
const FILLS = [
  { name: 'Before', how: 'old output emptied, everything after it read again', color: '--c-before', costs: G.before.d.flatMap((t) => t.trims.map((m) => m.cost)).filter((v) => v != null) },
  { name: 'Notes, first version', how: 'notes written, then the whole new conversation read from the start', color: '--c-third', costs: G.loop.d.flatMap((t) => t.wrote.map((m) => m.cost)) },
  { name: 'Notes, second version', how: 'the unread output held back, the instructions restored from their saved reading', color: '--c-after', costs: NOTES2.flatMap((t) => t.wrote.map((m) => m.cost)) },
];
const fixed = (g) => g.d.filter((t) => t.pass).length;
const avg = (a) => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);

/* ---------- the 28 practice tasks ---------- */
function taskLog(file) {
  const out = [];
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return out; }
  for (const m of text.matchAll(/^(PASS|FAIL)\s+think=\S+\s+(?:rep(\d+)\s+)?(\d+)-(\S+)\s+(\d+)s\s+(\d+) steps\s+(\d+) errors\s*(.*)$/gm)) out.push({ pass: m[1] === 'PASS', rep: +(m[2] ?? 1), n: +m[3], task: `${m[3]}-${m[4]}`, secs: +m[5], steps: +m[6], why: m[8].trim() });
  return out;
}
const before = taskLog(join(OLD, 'tasks-before.log'));
const after = taskLog(join(S3, 'tasks-after-pass1.log'));
const names = [...new Set([...before, ...after].map((r) => r.task))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
const TASKS = names.map((task) => {
  const b = before.filter((r) => r.task === task);
  const a = after.filter((r) => r.task === task);
  return { task, n: parseInt(task, 10), b: b.length ? { pass: b.filter((r) => r.pass).length, of: b.length, secs: Math.round(avg(b.map((r) => r.secs))) } : null, a: a.length ? { pass: a.filter((r) => r.pass).length, of: a.length, secs: Math.round(avg(a.map((r) => r.secs))), why: a.find((r) => !r.pass)?.why } : null };
});
const both = TASKS.filter((t) => t.a && t.b);
const sum = (a) => a.reduce((t, v) => t + v, 0);

/* ---------- figures ---------- */
const figure = ({ from, title, legend, svg, table, cap, wide }) => `<figure><div class="from">${esc(from)}</div><h3>${esc(title)}</h3><div class="legend">${legend}</div><div class="scroll${wide ? ' wide' : ''}">${svg}</div>${table ? `<details class="pts"><summary>The numbers</summary><div class="wrap">${table}</div></details>` : ''}<figcaption>${cap}</figcaption></figure>`;
const MARKS = [['page', 'Opened the page in a browser', '--c-after'], ['check', 'Made the check', '--c-fourth'], ['file', 'Opened a file the fix can go in', '--c-before'], ['edit', 'First change', '--c-third']];
const shape = (k, x, y, col) => (k === 'page' ? `<circle cx="${x}" cy="${y}" r="5.5" fill="var(${col})" stroke="var(--card)" stroke-width="2"/>`
  : k === 'check' ? `<path d="M${x} ${y - 7} L${x + 7} ${y} L${x} ${y + 7} L${x - 7} ${y} Z" fill="var(${col})" stroke="var(--card)" stroke-width="2"/>`
  : k === 'file' ? `<path d="M${x} ${y - 7} L${x + 7} ${y + 6} L${x - 7} ${y + 6} Z" fill="var(${col})" stroke="var(--card)" stroke-width="2"/>`
  : `<rect x="${x - 5.5}" y="${y - 5.5}" width="11" height="11" rx="2" fill="var(${col})" stroke="var(--card)" stroke-width="2"/>`);
function timeline(rows) {
  const W = 860, L = 190, Rt = 132, Tp = 14, rowH = 50, H = Tp + rows.length * rowH + 34;
  const X = (s) => L + (Math.min(s, LIMIT) / LIMIT) * (W - L - Rt);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="What each try reached, and when" style="max-width:none">`;
  for (let m = 0; m <= 25; m += 5) s += `<line class="grid" x1="${X(m * 60)}" x2="${X(m * 60)}" y1="${Tp}" y2="${H - 30}"/><text x="${X(m * 60)}" y="${H - 16}" text-anchor="middle">${m} min</text>`;
  rows.forEach((r, i) => {
    const d = r.d, y = Tp + i * rowH + 30;
    s += `<text class="lbl" x="${L - 14}" y="${y - 3}" text-anchor="end" style="font-weight:600;font-size:12px">${esc(r.name)}</text><text x="${L - 14}" y="${y + 11}" text-anchor="end">${esc(r.when)}</text>`;
    s += `<line x1="${X(0)}" x2="${X(d.secs)}" y1="${y}" y2="${y}" stroke="var(--faint)" stroke-width="2" stroke-linecap="round"/>`;
    for (const m of d.memory) s += `<g><title>${esc(r.name)} · memory filled at ${mmss(m.at)}: ${m.inPlace ? 'notes written' : 'old output emptied'}${m.cost != null ? `, ${mmss(m.cost)} lost` : ''}</title><line x1="${X(m.at)}" x2="${X(m.at)}" y1="${y - 9}" y2="${y + 9}" stroke="var(--down)" stroke-width="2" stroke-dasharray="3 2"/></g>`;
    const end = d.pass ? `✓ fixed · ${mmss(d.secs)}` : `✗ not fixed · ${mmss(d.secs)}`;
    s += `<line x1="${X(d.secs)}" x2="${X(d.secs)}" y1="${y - 8}" y2="${y + 8}" stroke="var(--ink)" stroke-width="2"/><text class="lbl" x="${X(d.secs) + 8}" y="${y + 4}" style="font-weight:600">${end}</text>`;
    let lastX = -99;
    MARKS.map(([k, name, col]) => ({ k, name, col, t: d[k] })).filter((m) => m.t != null).sort((a, b) => a.t - b.t).forEach((m) => {
      const x = X(m.t);
      // Marks closer than a label is wide keep their shape and lose their label (it is in "The numbers").
      const room = x - lastX >= 40; if (room) lastX = x;
      s += `<g><title>${esc(r.name)} · ${esc(m.name)} at ${mmss(m.t)}</title>${shape(m.k, x, y, m.col)}${room ? `<text class="lbl" x="${x}" y="${y - 12}" text-anchor="middle" style="font-size:10px">${mmss(m.t)}</text>` : ''}</g>`;
    });
  });
  s += '</svg>';
  const legend = `${MARKS.map(([k, name, col]) => `<span><svg viewBox="-9 -9 18 18" style="width:16px;height:16px;margin:0;display:inline-block">${shape(k, 0, 0, col)}</svg>${esc(name)}</span>`).join('')}<span><svg viewBox="-9 -9 18 18" style="width:16px;height:16px;margin:0;display:inline-block"><line x1="0" x2="0" y1="-8" y2="8" stroke="var(--down)" stroke-width="2" stroke-dasharray="3 2"/></svg>Memory filled</span>`;
  const cell = (v) => (v == null ? '<td class="na">—</td>' : `<td>${mmss(v)}</td>`);
  const table = `<table><thead><tr><th></th>${MARKS.map(([, n]) => `<th>${esc(n)}</th>`).join('')}<th>Memory filled</th><th>Ended</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}<span class="c">${esc(r.when)}</span></td>${MARKS.map(([k]) => cell(r.d[k])).join('')}<td>${r.d.memory.length ? r.d.memory.map((m) => mmss(m.at)).join(', ') : '—'}</td><td>${r.d.pass ? 'fixed' : 'not fixed'} · ${mmss(r.d.secs)}</td></tr>`).join('')}</tbody></table>`;
  return figure({ from: 'chart-runs.mjs · the events of each try', title: 'What each try reached, and when', legend, svg: s, table, wide: true, cap: T('CAP_TIMELINE', 'One row per try, all on the same 25-minute clock. The mark at the right end is where the try ended.') });
}

const BUDGETS = [15, 30, 60, 120, 240, 480];
const budgetLabel = (b) => (b < 60 ? `${b}s` : `${b / 60}m`);
const curve = (rows) => ({ n: rows.length, pts: BUDGETS.map((b) => { const done = rows.filter((r) => r.pass && r.secs <= b).length; return { b, done, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 }; }) });
function curves(series, lead) {
  const W = 560, H = 300, L = 46, Rt = 14, Tp = 12, B = 40;
  const x0 = BUDGETS[0] / 1.3, x1 = BUDGETS[BUDGETS.length - 1] * 1.3;
  const X = (v) => L + ((Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0))) * (W - L - Rt);
  const Y = (v) => Tp + (1 - v / 100) * (H - Tp - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tasks done within a time budget">`;
  for (let v = 0; v <= 100; v += 20) s += `<line class="grid" x1="${L}" x2="${W - Rt}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 7}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`;
  BUDGETS.forEach((v) => { s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${Tp}" y2="${H - B}" stroke-dasharray="2 3"/><text x="${X(v)}" y="${H - B + 15}" text-anchor="middle">${budgetLabel(v)}</text>`; });
  s += `<line class="axis" x1="${L}" x2="${W - Rt}" y1="${H - B}" y2="${H - B}"/><text x="${(L + W - Rt) / 2}" y="${H - 6}" text-anchor="middle">Time budget per task (log scale)</text><text transform="translate(11 ${(Tp + H - B) / 2}) rotate(-90)" text-anchor="middle">Tasks done within the budget (%)</text>`;
  [...series.filter((c) => c.key !== lead), ...series.filter((c) => c.key === lead)].forEach((c) => {
    const isLead = c.key === lead;
    s += `<polyline fill="none" stroke="var(${c.color})" stroke-width="${isLead ? 2.6 : 1.8}" stroke-linejoin="round" points="${c.pts.map((p) => `${X(p.b)},${Y(p.pct)}`).join(' ')}"/>`;
    c.pts.forEach((p) => {
      s += `<circle cx="${X(p.b)}" cy="${Y(p.pct)}" r="${isLead ? 4.2 : 3.4}" fill="var(${c.color})" stroke="var(--card)" stroke-width="1.5"><title>${esc(c.name)} · within ${budgetLabel(p.b)}: ${p.pct}% (${p.done} of ${c.n})</title></circle>`;
      if (isLead) s += `<text class="lbl" x="${X(p.b)}" y="${Y(p.pct) - 9}" text-anchor="middle" style="font-weight:600;font-size:10px">${p.pct}</text>`;
    });
  });
  s += '</svg>';
  const best = BUDGETS.map((b, i) => Math.max(...series.map((c) => c.pts[i].pct)));
  const table = `<table><thead><tr><th></th>${BUDGETS.map((b) => `<th>${budgetLabel(b)}</th>`).join('')}</tr></thead><tbody>${series.map((c) => `<tr><td><span class="dot" style="background:var(${c.color});margin-right:6px"></span>${esc(c.name)}</td>${c.pts.map((p, i) => `<td${p.pct === best[i] ? ' style="font-weight:700"' : ''}>${p.pct}%<span class="c">${p.done} of ${c.n}</span></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return figure({ from: 'models/evals/bench/run.mjs · the 28 practice tasks, effort Low', title: 'Practice tasks done within a time budget', svg: s, table,
    legend: series.map((c) => `<span><i class="line" style="border-color:var(${c.color})"></i>${esc(c.name)}</span>`).join(''), cap: T('CAP_CURVES', 'A line further up and to the left is better.') });
}

// What one memory fill costs, each way: a bar per way, a dot per fill.
function fillBars() {
  const rows = FILLS.filter((f) => f.costs.length);
  const W = 860, L = 214, Rt = 70, Tp = 8, rowH = 46, H = Tp + rows.length * rowH + 34;
  const x1 = Math.ceil(Math.max(...rows.flatMap((r) => r.costs)) / 60) * 60;
  const X = (v) => L + (v / x1) * (W - L - Rt);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Seconds lost each time memory filled" style="max-width:none">`;
  for (let v = 0; v <= x1 + 1e-9; v += 60) s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${Tp}" y2="${H - 30}"/><text x="${X(v)}" y="${H - 16}" text-anchor="middle">${v / 60} min</text>`;
  rows.forEach((r, i) => {
    const y = Tp + i * rowH + 12, a = avg(r.costs);
    s += `<text class="lbl" x="${L - 14}" y="${y + 8}" text-anchor="end" style="font-weight:600;font-size:12px">${esc(r.name)}</text><text x="${L - 14}" y="${y + 22}" text-anchor="end">${r.costs.length} fill${r.costs.length === 1 ? '' : 's'}</text>`;
    s += `<rect x="${X(0)}" y="${y}" width="${Math.max(2, X(a) - X(0))}" height="16" rx="3" fill="var(${r.color})"><title>${esc(r.name)}: ${mmss(a)} on average</title></rect><text class="lbl" x="${X(a) + 8}" y="${y + 12}" style="font-weight:600">${mmss(a)}</text>`;
    r.costs.forEach((c) => { s += `<circle cx="${X(c)}" cy="${y + 25}" r="3.2" fill="var(${r.color})" stroke="var(--card)" stroke-width="1.2"><title>${esc(r.name)}: one fill, ${mmss(c)}</title></circle>`; });
  });
  s += '</svg>';
  const table = `<table><thead><tr><th></th><th>Fills measured</th><th>Average</th><th>Each one</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}<span class="c">${esc(r.how)}</span></td><td>${r.costs.length}</td><td>${mmss(avg(r.costs))}</td><td>${r.costs.map(mmss).join(' · ')}</td></tr>`).join('')}</tbody></table>`;
  return figure({ from: 'chart-runs.mjs · the seconds of every model call around each fill', title: 'Minutes lost each time memory filled', svg: s, table, wide: true,
    legend: rows.map((r) => `<span><i style="background:var(${r.color})"></i>${esc(r.name)}</span>`).join(''), cap: T('CAP_FILLS', 'The bar is the average; each dot under it is one fill. Shorter is better.') });
}

/* ---------- the launch table ---------- */
// [area, measure, footnote, value of a group, how it is written, lower is better, the words under it]
const ROWS = [
  ['The bug', 'Tries that fixed it, as judged in the browser', '1', (g) => (g.d.length ? fixed(g) / g.d.length : null), (v, g) => `${fixed(g)} of ${g.d.length}`, false, (g) => (fixed(g) ? `fixed in ${g.d.filter((t) => t.pass).map((t) => mmss(t.secs)).join(', ')}` : 'none')],
  ['Time', 'Minutes a try took', '2', (g) => avg(g.d.map((t) => t.secs)), (v) => mmss(v), true, (g) => (g.d.length > 1 ? `from ${mmss(Math.min(...g.d.map((t) => t.secs)))} to ${mmss(Math.max(...g.d.map((t) => t.secs)))}` : '')],
  ['Finding the code', 'Tries that were shown, or named, the lines that set the layers', '3', (g) => (g.d.length ? g.d.filter((t) => t.check != null).length / g.d.length : null), (v, g) => `${g.d.filter((t) => t.check != null).length} of ${g.d.length}`, false, (g) => (g.d.some((t) => t.check != null) ? `by the browser, at ${g.d.filter((t) => t.check != null).map((t) => mmss(t.check)).join(', ')}` : `a file the fix can go in was opened in ${g.d.filter((t) => t.file != null).length} of ${g.d.length}`)],
  ['Making the change', 'Tries that changed a file', '', (g) => (g.d.length ? g.d.filter((t) => t.edits).length / g.d.length : null), (v, g) => `${g.d.filter((t) => t.edits).length} of ${g.d.length}`, false, () => ''],
  ['Memory', 'Times its memory filled, a try', '4', (g) => avg(g.d.map((t) => t.memory.length)), (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)), true, (g) => { const t = sum(g.d.map((x) => x.trims.length)), w = sum(g.d.map((x) => x.wrote.length)); return [t ? `${t} time${t === 1 ? '' : 's'} old output emptied` : '', w ? `${w} time${w === 1 ? '' : 's'} notes written` : ''].filter(Boolean).join(', '); }],
  ['Memory', 'Minutes lost each time it filled', '5', (g) => avg(g.d.flatMap((t) => t.memory.map((m) => m.cost)).filter((v) => v != null)), (v) => mmss(v), true, () => ''],
  ['Work', 'Steps a try took', '', (g) => avg(g.d.map((t) => t.steps)), (v) => String(Math.round(v)), null, () => ''],
];
const launchRows = ROWS.map(([area, measure, fn, get, fmt, lower, qual]) => {
  const vals = GROUPS.map((g) => (g.d.length ? get(g) : undefined));
  const nums = vals.filter((v) => v != null);
  const top = lower == null || !nums.length ? null : lower ? Math.min(...nums) : Math.max(...nums);
  const allSame = nums.every((v) => v === nums[0]);
  const cells = GROUPS.map((g, i) => {
    const v = vals[i];
    if (v === undefined) return `<td class="na">—<span class="q">${esc(T('NOT_RUN', 'not run'))}</span></td>`;
    if (v == null) return '<td class="na">—<span class="q">never</span></td>';
    const q = qual(g);
    return `<td${top != null && v === top && !allSame ? ' class="best"' : ''}>${fmt(v, g)}${q ? `<span class="q">${esc(q)}</span>` : ''}</td>`;
  }).join('');
  const b = vals[0], a = vals[2];
  let delta = '<td class="sep na">—</td>';
  if (b != null && a != null && lower != null) {
    const d = a - b, good = lower ? d < 0 : d > 0;
    const txt = /Minutes/.test(measure) ? `${d > 0 ? '+' : '−'}${mmss(Math.abs(d))}` : /Tries/.test(measure) ? `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} points` : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
    delta = `<td class="sep delta ${d === 0 ? '' : good ? 'up' : 'down'}">${d === 0 ? 'same' : txt}</td>`;
  }
  return `<tr><td class="bench"><b>${esc(area)}</b><span>${esc(measure)}${fn ? `<sup>${fn}</sup>` : ''}</span></td>${cells}${delta}</tr>`;
}).join('');

/* ---------- the task table ---------- */
const pct = (b, a) => (b ? `${a - b > 0 ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : '');
const taskRows = TASKS.map((t) => {
  const pass = (r) => (r == null ? '<td class="na">—</td>' : `<td class="${r.pass === r.of ? 'ok' : 'bad'}">${r.pass} of ${r.of}</td>`);
  const secs = t.a && t.b ? `<td class="${t.b.secs < t.a.secs ? 'best' : ''}">${t.b.secs} s</td><td class="${t.a.secs <= t.b.secs ? 'best' : ''}">${t.a.secs} s</td>` : `<td>${t.b ? `${t.b.secs} s` : '—'}</td><td class="na">${t.a ? `${t.a.secs} s` : '—'}</td>`;
  const d = t.a && t.b ? t.a.secs - t.b.secs : null;
  return `<tr><td class="bench"><b>${esc(t.task)}</b>${t.a && t.a.pass < t.a.of ? `<span class="q" style="color:var(--down)">${esc(t.a.why)}</span>` : ''}</td>${pass(t.b)}${pass(t.a)}${secs}${d == null ? '<td class="sep na">—</td>' : `<td class="sep delta ${d < 0 ? 'up' : d > 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d} s<span class="q">${pct(t.b.secs, t.a.secs)}</span></td>`}</tr>`;
}).join('');
const totalB = sum(both.map((t) => t.b.secs)), totalA = sum(both.map((t) => t.a.secs));

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
const diffHtml = (d) => esc(d).split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).map((l) => (l.startsWith('+') ? `<span class="add">${l}</span>` : l.startsWith('-') ? `<span class="del">${l}</span>` : l)).join('\n');
const best = G.first.d.find((t) => t.pass) ?? G.first.d[0];
const clockRows = [
  ...G.before.d.map((d, i) => ({ name: `Before · try ${i + 1}`, when: G.before.when, d })),
  ...G.loop.d.map((d, i) => ({ name: `Step by step · try ${i + 1}`, when: G.loop.when, d })),
  ...G.first.d.map((d, i) => ({ name: `Check first · try ${i + 1}`, when: G.first.when, d })),
];
const parts = (TEXT.PARTS ?? []).map(([name, what, measured, costs]) => `<tr><td class="bench"><b>${esc(name)}</b></td><td class="words">${what}</td><td class="words">${measured}</td><td class="words">${costs}</td></tr>`).join('');
const notes = (TEXT.NOTES ?? []).map((n, i) => `<p><sup>${i + 1}</sup> ${n}</p>`).join('');
// Tries that left the very same change are shown once.
const changes = [];
for (const g of GROUPS) g.d.forEach((d, i) => { if (!d.diff) return; const same = changes.find((c) => c.g === g && c.d.diff === d.diff && c.d.pass === d.pass); if (same) same.tries.push(i + 1); else changes.push({ g, d, tries: [i + 1] }); });
const fixes = changes.map((x) => `<h3 style="margin-top:16px">${esc(x.g.name)} · ${x.tries.length > 1 ? `tries ${x.tries.slice(0, -1).join(', ')} and ${x.tries.at(-1)}, the same change each time` : `try ${x.tries[0]}`} <span style="color:var(--mute);font-weight:400;font-size:13px">${esc(x.g.when)} · ${x.d.pass ? 'judged fixed' : 'judged NOT fixed'}</span></h3><pre>${diffHtml(x.d.diff.length > 2400 ? `${x.d.diff.slice(0, 2400)}\n…` : x.d.diff)}</pre>`).join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bonsai Code step 3 results</title><style>${css}</style></head><body><main>
<h1>${T('TITLE', 'Bonsai Code, step 3: the results')}</h1>
<p class="lede">${T('LEDE', '')}</p>
<nav><a href="#glance">At a glance</a><a href="#parts">What was built</a><a href="#launch">Launch table</a><a href="#clock">On the clock</a><a href="#memory">Memory</a><a href="#found">What the browser found</a><a href="#tasks">The 28 practice tasks</a><a href="#notes">Notes</a><a href="#sources">Where the numbers come from</a></nav>

<div class="hero"><div class="g">${T('HERO', best?.pass ? mmss(best.secs) : '—')}</div><div class="v">${T('HERO_V', '')}</div><div class="w">${T('HERO_W', '')}</div></div>

<section id="glance"><div class="cards">
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-after)"></span>The chart bug, from its words</div><dl>
    ${GROUPS.map((g) => `<dt>${esc(g.name)}<br><span style="font-size:12px">${esc(g.when)}</span></dt><dd>${g.d.length ? `<b style="color:var(${fixed(g) ? '--up' : '--down'})">${fixed(g)} of ${g.d.length} fixed</b><br><span style="color:var(--mute);font-size:13px">${mmss(avg(g.d.map((t) => t.secs)))} a try</span>` : 'not run'}</dd>`).join('')}
    ${T('CARD_BUG', '')}</dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-before)"></span>The 28 practice tasks</div><dl>
    <dt>Before · 5 runs each</dt><dd>${before.filter((r) => r.pass).length} of ${before.length} pass · ${Math.round(sum(before.map((r) => r.secs)) / Math.max(1, new Set(before.map((r) => r.rep)).size)).toLocaleString()} s a run</dd>
    <dt>Tonight · new code</dt><dd>${after.length ? `${after.filter((r) => r.pass).length} of ${after.length} pass · ${sum(after.map((r) => r.secs)).toLocaleString()} s` : 'not run'}</dd>
    ${T('CARD_TASKS', '')}</dl></div>
  <div class="card"><div class="name"><span class="dot" style="background:var(--c-third)"></span>What is still open</div>${T('CARD_OPEN', '')}</div>
</div></section>

<section id="parts"><h2>What was built</h2>
<p class="sub">${T('PARTS_SUB', '')}</p>
<div class="wrap"><table><thead><tr><th>Part</th><th>What it does</th><th>What was measured</th><th>What it costs</th></tr></thead><tbody>${parts}</tbody></table></div></section>

<section id="launch"><h2>Chart bug launch table</h2>
<p class="sub">${T('LAUNCH_SUB', '')}</p>
<div class="wrap"><table><thead><tr><th></th>${GROUPS.map((g) => `<th>${esc(g.name)}<span>${esc(g.when)}</span><span>${g.d.length} ${g.d.length === 1 ? 'try' : 'tries'}</span></th>`).join('')}<th class="sep">Check first against before<span>my own subtraction</span></th></tr></thead><tbody>${launchRows}</tbody></table></div>
<div class="notes">${T('LAUNCH_NOTES', '')}</div></section>

<section id="clock"><h2>On the clock</h2>
<p class="sub">${T('CLOCK_SUB', '')}</p>
<div class="charts one">${clockRows.length ? timeline(clockRows) : ''}</div></section>

<section id="memory"><h2>When memory fills</h2>
<p class="sub">${T('MEMORY_SUB', '')}</p>
<div class="charts one">${FILLS.some((f) => f.costs.length) ? fillBars() : ''}</div></section>

<section id="found"><h2>What the browser found</h2>
<p class="sub">${T('FOUND_SUB', '')}</p>
${T('FOUND_REPORT', '') ? `<pre>${esc(T('FOUND_REPORT'))}</pre>` : ''}
${fixes || '<p class="sub">No try changed a file.</p>'}</section>

<section id="tasks"><h2>The 28 practice tasks</h2>
<p class="sub">${T('TASKS_SUB', '')}</p>
${after.length ? `<div class="charts one">${curves([{ key: 'b', name: 'Before · 5 runs of each task', color: '--c-before', ...curve(before) }, { key: 'a', name: 'Tonight · new code, 1 run', color: '--c-after', ...curve(after) }], 'a')}</div>` : ''}
<div class="wrap" style="margin-top:16px"><table><thead><tr><th>Task</th><th>Before<span>passes of 5</span></th><th>Tonight<span>passes</span></th><th>Before<span>seconds, average</span></th><th>Tonight<span>seconds</span></th><th class="sep">Change</th></tr></thead><tbody>
${taskRows}
${both.length ? `<tr><td class="bench"><b>The ${both.length} tasks run on both sides</b></td><td class="ok">${sum(both.map((t) => t.b.pass))} of ${sum(both.map((t) => t.b.of))}</td><td class="${sum(both.map((t) => t.a.pass)) === sum(both.map((t) => t.a.of)) ? 'ok' : 'bad'}">${sum(both.map((t) => t.a.pass))} of ${sum(both.map((t) => t.a.of))}</td><td class="${totalB < totalA ? 'best' : ''}">${totalB.toLocaleString()} s</td><td class="${totalA <= totalB ? 'best' : ''}">${totalA.toLocaleString()} s</td><td class="sep delta ${totalA < totalB ? 'up' : totalA > totalB ? 'down' : ''}">${totalA - totalB > 0 ? '+' : ''}${totalA - totalB} s<span class="q">${pct(totalB, totalA)}</span></td></tr>` : ''}
</tbody></table></div></section>

<section id="notes"><h2>Notes</h2><div class="notes">${notes}</div></section>

<section class="foot" id="sources"><h3 style="color:var(--ink)">Where the numbers come from</h3><ul>
<li>Tonight's tries and the practice run: <code>models/bonsai-2-27b/results/step3-2026-09-27/</code> (one <code>result-rep*.json</code> and <code>events-rep*.jsonl</code> per try; the runner is <code>chart-runs.mjs</code>, the judge is round 3's <code>judge.mjs</code>).</li>
<li>Before: <code>…/fable-harness-2026-09-27/chart/before/</code> (5 tries) and <code>tasks-before.log</code> (140 runs), both on the old code, this afternoon.</li>
<li>The code: <code>~/worktrees/bonsai-step3</code> (branch <code>step3</code>, not committed); what was measured is frozen in <code>~/worktrees/step3-frozen-a1</code> and <code>step3-frozen-b1</code>.</li>
<li>This page: <code>node models/evals/reports/report-step3.mjs</code>; its words: <code>page-text.json</code> in tonight's results folder.</li></ul>
<p>Nothing on this page loads from the internet. Point at a mark to see its exact numbers.</p></section>
</main></body></html>`;

const out = docsPath('reports/bonsai-step-3-results-2026-09-27.html');
writeFileSync(out, html);
console.log(`wrote ${out.replace(homedir(), '~')} (${(html.length / 1024).toFixed(0)} KB)`);
if (!(process.env.AGENTIC_NO_DESKTOP ?? process.env.BONSAI_NO_DESKTOP)) { const desk = join(homedir(), 'Desktop', 'bonsai-step-3-results-2026-09-27.html'); copyFileSync(out, desk); console.log(`copied to ${desk.replace(homedir(), '~')}`); }
