// The results page for the step 3 long-task probe (long-task.mjs): where a
// long task's time goes, how the model slows as its memory fills, and what it
// read twice, for each model that has a run. Reads the newest run of each
// model from models/<model>/results/long-task-2026-09-29/ and writes one
// self-contained page.
//   node models/evals/tools/long-task-page.mjs [--out file.html]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MODELS, modelFolder } from '../../index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const ROUND = 'long-task-2026-09-29';
// Gemma pages live in gemma-docs/ inside the repo's "cli docs" folder (on this Mac only, not in git).
const OUT = opt('out', join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'cli docs', 'gemma-docs', 'test', 'gemma-vs-qwen-long-task-2026-09-29.html'));
const TOL = 64; // words a step may lose off its end (the reply as the template writes it back) and still count as only adding on

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const n0 = (x) => Math.round(x).toLocaleString('en-US');
const f1 = (x) => (Math.round(x * 10) / 10).toLocaleString('en-US');
const k1 = (x) => `${f1(x / 1000)}k`;
const kctx = (c) => `${Math.round(c / 1024)}k`; // a memory size as /effort shows it (32,768 → 32k)
const mmss = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

function newest(model) {
  const dir = join(modelFolder(model), 'results', ROUND);
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => /^run-.*\.json$/.test(x)).sort().pop();
  return f ? { ...JSON.parse(readFileSync(join(dir, f), 'utf8')), file: join('models', model.folder, 'results', ROUND, f) } : null;
}

// One run → the numbers the page shows.
export function analyse(run) {
  const given = new Set(run.events.filter((e) => e.type === 'tool' && e.given).map((e) => e.id));
  const reqs = run.requests.filter((q) => q.timings && q.end != null);
  const main = reqs.filter((q) => q.tools && q.toolChoice !== 'none' && (q.slot ?? 0) === 0);
  const firstMain = main[0]?.start ?? 0;
  const last = new Map(); // slot → the previous request's prompt length
  const steps = [];
  let reread = 0; let rereadSecs = 0; let readNewSecs = 0;
  for (const q of reqs) {
    const t = q.timings;
    const slot = q.slot ?? 0;
    const prompt = (t.cache_n ?? 0) + (t.prompt_n ?? 0);
    const prev = last.get(slot);
    last.set(slot, { prompt, wrote: t.predicted_n ?? 0 });
    // Only adding on: the server reused all of the previous prompt. Otherwise
    // something earlier changed (a trim, notes, a shortened thought) and what
    // came after it was read again; what is new is the reply written back and
    // the outputs of the calls that first show up in this request.
    let again = 0;
    if (prev && q.path.includes('chat') && (t.cache_n ?? 0) < prev.prompt - TOL) {
      const fresh = prev.wrote + run.calls.filter((c) => c.firstReq === q.i).reduce((s, c) => s + (c.outChars ?? 0) / 3.6, 0);
      again = Math.max(0, Math.min(t.prompt_n ?? 0, (t.prompt_n ?? 0) - fresh));
    }
    const rps = t.prompt_per_second || 1;
    reread += again; rereadSecs += again / rps; readNewSecs += Math.max(0, (t.prompt_n ?? 0) - again) / rps;
    if (main.includes(q)) {
      const call = run.calls.find((c) => c.firstReq > q.i && !given.has(c.id)) ?? null; // the call it made here shows up in the next request
      steps.push({ i: q.i, start: q.start, end: q.end, depth: prompt + (t.predicted_n ?? 0), prompt, readNew: (t.prompt_n ?? 0) - again, reread: again, wrote: t.predicted_n ?? 0,
        readSecs: (t.prompt_ms ?? 0) / 1000, writeSecs: (t.predicted_ms ?? 0) / 1000, readTps: t.prompt_n > 200 ? t.prompt_per_second : null, writeTps: t.predicted_n > 30 ? t.predicted_per_second : null, reused: t.cache_n ?? 0,
        tool: call ? `${call.name}${call.args ? ` ${shortArgs(call)}` : ''}` : null });
    }
  }
  // Tool time: from the end of one step to the start of the next main request.
  for (let s = 0; s < steps.length; s++) steps[s].after = s + 1 < steps.length ? Math.max(0, (steps[s + 1].start - steps[s].end) / 1000) : 0;
  const wall = run.wall;
  const modelSecs = reqs.reduce((s, q) => s + ((q.timings.prompt_ms ?? 0) + (q.timings.predicted_ms ?? 0)) / 1000, 0);
  const writeSecs = reqs.reduce((s, q) => s + (q.timings.predicted_ms ?? 0) / 1000, 0);
  const think = run.result?.outTokens ? Math.min(1, (run.result.thinkTokens ?? 0) / run.result.outTokens) : 0;
  const startSecs = firstMain / 1000;
  const split = {
    start: startSecs,
    readNew: readNewSecs,
    reread: rereadSecs,
    think: writeSecs * think,
    write: writeSecs * (1 - think),
  };
  split.tools = Math.max(0, wall - Object.values(split).reduce((a, b) => a + b, 0));
  // Memory events: notes written in place, summaries, trims.
  const notes = run.events.filter((e) => e.type === 'compacted');
  const trims = run.events.filter((e) => e.type === 'note' && /^Trimmed/.test(e.text));
  // Reads: which file parts it read, and which it read again.
  const reads = run.calls.filter((c) => c.name === 'Read').map((c) => { let a = {}; try { a = JSON.parse(c.args ?? '{}'); } catch {} return { id: c.id, path: a.path, key: `${a.path}|${a.offset ?? ''}|${a.limit ?? ''}|${a.find ?? ''}`, part: a.find ? `around "${a.find}"` : a.offset ? `lines ${a.offset}–${a.offset + (a.limit ?? 150) - 1}` : 'from the top', at: reqs.find((r) => r.i === c.firstReq)?.start ?? 0, given: given.has(c.id), words: Math.round((c.outChars ?? 0) / 3.6) }; });
  const seen = new Map(); const twice = [];
  for (const r of reads) {
    if (seen.has(r.key)) twice.push({ ...r, first: seen.get(r.key), afterNotes: notes.some((e) => e.at > seen.get(r.key).at && e.at < r.at) });
    else seen.set(r.key, r);
  }
  const fullAt = run.ctx * run.limits.trimAt - (run.thinking ? 2048 + run.thinkingBudget : 2048);
  const tps = (list, k) => list.map((s) => s[k]).filter(Boolean);
  const first3 = (k) => { const v = tps(steps.slice(0, 4), k); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const last3 = (k) => { const v = tps(steps.slice(-4), k); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return { run, steps, split, wall, modelSecs, notes, trims, reads, twice, reread, fullAt, maxDepth: Math.max(0, ...steps.map((s) => s.depth)),
    writeStart: first3('writeTps'), writeEnd: last3('writeTps'), readStart: first3('readTps'), readEnd: last3('readTps') };
}

function shortArgs(c) {
  let a = {}; try { a = JSON.parse(c.args ?? '{}'); } catch { return ''; }
  if (c.name === 'Read') return `${a.path ?? ''}${a.find ? ` · "${a.find}"` : a.offset ? ` · ${a.offset}+${a.limit ?? ''}` : ''}`;
  if (c.name === 'Search') return `"${a.pattern ?? ''}"`;
  if (c.name === 'Bash') return String(a.command ?? '').slice(0, 40);
  return String(a.path ?? a.pattern ?? '').slice(0, 40);
}

// --runs a.json,b.json: build from these files instead of each model's newest run.
const given = opt('runs', null)?.split(',').map((f) => JSON.parse(readFileSync(f, 'utf8')));
const runs = given
  ? given.map((run) => ({ m: MODELS[run.model], run: { ...run, file: run.file ?? '(given file)' } }))
  : Object.values(MODELS).filter((m) => ['gemma', 'qwen'].includes(m.id)).map((m) => ({ m, run: newest(m) })).filter((x) => x.run);
if (!runs.length) { console.error('no long-task runs yet'); process.exit(1); }
const A = runs.map(({ m, run }) => ({ m, cls: m.id, ...analyse(run) }));
const settings = A[0].run;

// ── pieces ──
const PARTS = [
  ['start', 'Getting ready', 'the instructions, the code search, the files read first'],
  ['readNew', 'Reading new words', 'tool outputs and its own replies, read once'],
  ['reread', 'Reading again', 'words it had already read, after memory changed'],
  ['think', 'Thinking', 'its thinking, word by word'],
  ['write', 'Writing', 'its replies and tool calls'],
  ['tools', 'Tools + app', 'running the tools, sorting, the app between steps'],
];
const timeBar = (a) => {
  const segs = PARTS.map(([k, label]) => ({ k, label, s: a.split[k] })).filter((x) => x.s > 0.5);
  return `<div class="tb">${segs.map((x) => `<span class="seg p-${x.k}" style="flex:${x.s}" title="${esc(x.label)}: ${n0(x.s)} s"></span>`).join('')}</div>`;
};
const partRows = () => PARTS.map(([k, label, sub]) => `<tr><th><span class="sw p-${k}"></span>${label}<small>${sub}</small></th>${A.map((a) => `<td><b>${mmss(a.split[k])}</b> <small>${pct(a.split[k], a.wall)}%</small></td>`).join('')}</tr>`).join('');

// A line chart: x and y from each model's steps.
function chart({ x, y, xLabel, yLabel, w = 620, h = 300, xMax, yMax, lines = [], xFmt = (v) => k1(v), yFmt = (v) => f1(v), marks = [] }) {
  const L = 52; const R = 16; const T = 14; const B = 40;
  const X = (v) => L + ((w - L - R) * v) / xMax;
  const Y = (v) => T + (h - T - B) * (1 - v / yMax);
  const ticks = (max, n = 5) => { const step = niceStep(max / n); const out = []; for (let v = 0; v <= max + 1e-9; v += step) out.push(v); return out; };
  let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(yLabel)} by ${esc(xLabel)}">`;
  for (const v of ticks(yMax)) svg += `<line class="grid" x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`;
  for (const v of ticks(xMax, 6)) svg += `<text class="ax" x="${X(v)}" y="${h - B + 18}" text-anchor="middle">${xFmt(v)}</text>`;
  svg += `<text class="ax" x="${(L + w - R) / 2}" y="${h - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
  for (const l of lines) svg += `<line class="ref" x1="${l.x != null ? X(l.x) : L}" x2="${l.x != null ? X(l.x) : w - R}" y1="${l.y != null ? Y(l.y) : T}" y2="${l.y != null ? Y(l.y) : h - B}"/><text class="reflab" x="${l.x != null ? X(l.x) + 6 : w - R - 4}" y="${l.y != null ? Y(l.y) - 6 : T + 12}" text-anchor="${l.x != null ? 'start' : 'end'}">${esc(l.label)}</text>`;
  for (const a of A) {
    const pts = a.steps.map((s) => [x(s, a), y(s, a)]).filter(([px, py]) => px != null && py != null);
    if (pts.length > 1) svg += `<polyline class="ln ${a.cls}" points="${pts.map(([px, py]) => `${X(px).toFixed(1)},${Y(py).toFixed(1)}`).join(' ')}"/>`;
    for (const [px, py] of pts) svg += `<circle class="pt ${a.cls}" cx="${X(px).toFixed(1)}" cy="${Y(py).toFixed(1)}" r="4"/>`;
  }
  for (const m of marks) svg += `<path class="mk ${m.cls}" d="M${X(m.x) - 7},${Y(m.y) - 13} h14 l-7,9 z"/>`;
  return `${svg}</svg>`;
}
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(raw)); const r = raw / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; }

// Per step: a column of seconds, split into reading, reading again, writing, tools.
function stepStrip(a, secsMax, w = 1260, h = 118) {
  const L = 40; const B = 20; const T = 6;
  const n = Math.max(1, a.steps.length);
  const gap = 3; const bw = Math.max(4, (w - L - n * gap) / n);
  const Y = (v) => ((h - T - B) * v) / secsMax;
  let svg = `<svg class="chart strip" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(a.m.name)}: seconds per step">`;
  for (const v of [0, secsMax / 2, secsMax]) svg += `<line class="grid" x1="${L}" x2="${w}" y1="${h - B - Y(v)}" y2="${h - B - Y(v)}"/><text class="ax" x="${L - 6}" y="${h - B - Y(v) + 4}" text-anchor="end">${n0(v)}s</text>`;
  a.steps.forEach((s, j) => {
    const x = L + j * (bw + gap);
    let yb = h - B;
    const readNewS = s.readSecs * (s.readNew / Math.max(1, s.readNew + s.reread));
    for (const [k, v] of [['readNew', readNewS], ['reread', s.readSecs - readNewS], ['write', s.writeSecs], ['tools', s.after]]) {
      const hh = Y(Math.min(v, secsMax)); if (hh < 0.5) continue;
      yb -= hh; svg += `<rect class="p-${k}" x="${x.toFixed(1)}" y="${yb.toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}"><title>Step ${j + 1}${s.tool ? ` → ${esc(s.tool)}` : ''}: read ${n0(s.readNew)} new, ${n0(s.reread)} again, wrote ${n0(s.wrote)}; ${n0(s.readSecs + s.writeSecs + s.after)} s</title></rect>`;
    }
    if (n <= 40 && (j + 1) % (n > 20 ? 5 : 1) === 0) svg += `<text class="ax" x="${(x + bw / 2).toFixed(1)}" y="${h - 5}" text-anchor="middle">${j + 1}</text>`;
  });
  for (const e of a.notes) {
    const j = a.steps.findIndex((s) => s.start > e.at); if (j < 0) continue;
    const x = L + j * (bw + gap) - gap / 2;
    svg += `<line class="evt" x1="${x}" x2="${x}" y1="${T}" y2="${h - B}"/>`;
  }
  return `${svg}</svg>`;
}

// ── the verdict, from the numbers ──
const line = (a) => {
  const rr = pct(a.split.reread, a.wall);
  const slow = a.writeStart && a.writeEnd ? pct(a.writeStart - a.writeEnd, a.writeStart) : null;
  return { rr, slow };
};
const worst = A.map((a) => ({ a, ...line(a) }));
const anyNotes = A.some((a) => a.notes.length);
const twiceAll = A.reduce((s, a) => s + a.twice.length, 0);
const rrMax = Math.max(...worst.map((x) => x.rr));
const verdict = `${A.map((a) => `${a.m.name.split(' ')[0]} took <b>${mmss(a.wall)}</b>`).join(' and ')} on the same long question at your settings. `
  + `Reading words it had already read cost ${worst.map((x) => `${x.rr}% of ${x.a.m.name.split(' ')[0]}'s time`).join(' and ')}${rrMax < 10 ? ', so re-reading is <b>not</b> where the time goes' : ', which is worth cutting'}. `
  + `${worst.filter((x) => x.slow != null).map((x) => `${x.a.m.name.split(' ')[0]} wrote ${x.slow}% slower at the end than at the start`).join('; ')}${worst.some((x) => x.slow != null) ? ', because a fuller memory makes every word slower' : ''}. `
  + `${anyNotes ? `Memory counted as full at <b>${k1(A[0].fullAt)} words</b>, under half of its ${kctx(settings.ctx)}, because your ${n0(settings.thinkingBudget)}-word thinking cap keeps room free for one long reply.` : 'Memory never filled in this run.'} `
  + `${twiceAll ? `It read ${twiceAll} file part${twiceAll === 1 ? '' : 's'} a second time.` : 'It never read the same part of a file twice.'}`;

const cards = (a) => `<div class="cards">
<div class="card"><span>Whole task</span><b>${mmss(a.wall)}</b><small>min:s · lower = better${a.run.aborted ? ' · hit the cap' : ''}</small></div>
<div class="card"><span>Steps</span><b>${a.steps.length}</b><small>${a.run.result?.reason === 'done' || a.run.result?.reason === 'end' ? 'finished' : esc(a.run.result?.reason ?? a.run.error ?? '—')}</small></div>
<div class="card"><span>Memory full</span><b>${a.notes.length}×</b><small>fewer = better</small></div>
<div class="card"><span>Read again</span><b>${pct(a.split.reread, a.wall)}%</b><small>lower = better</small></div>
</div>`;

const depthMax = Math.max(...A.map((a) => a.maxDepth), settings.ctx * 0.5);
const writeMax = Math.max(...A.flatMap((a) => a.steps.map((s) => s.writeTps ?? 0))) * 1.15 || 20;
const readMax = Math.max(...A.flatMap((a) => a.steps.map((s) => s.readTps ?? 0))) * 1.15 || 200;
const timeMax = Math.max(...A.map((a) => a.wall)) / 60;
const secsMax = niceStep(Math.max(...A.flatMap((a) => a.steps.map((s) => s.readSecs + s.writeSecs + s.after))) / 2) * 2;

const twiceRows = A.flatMap((a) => a.twice.map((t) => `<tr><td><span class="dot ${a.cls}" title="${esc(a.m.name)}"></span><span class="mono">${esc(t.path)}</span></td><td>${esc(t.part)}</td><td>${mmss(t.first.at / 1000)} → ${mmss(t.at / 1000)}</td><td>${t.afterNotes ? '<span class="tag bad">after its notes</span>' : '<span class="tag">no</span>'}</td><td>${n0(t.words)}</td></tr>`));
const readRows = A.map((a) => `<tr><th><span class="dot ${a.cls}"></span>${esc(a.m.name)}</th><td>${a.reads.length}</td><td>${new Set(a.reads.map((r) => r.path)).size}</td><td>${a.twice.length}</td><td>${a.twice.filter((t) => t.afterNotes).length}</td><td>${n0(a.twice.reduce((s, t) => s + t.words, 0))}</td></tr>`).join('');

const legend = `<div class="legend">${A.map((a) => `<span><b class="l${a.cls[0]}"></b>${esc(a.m.name)}</span>`).join('')}</div>`;
const partsLegend = `<div class="legend">${PARTS.map(([k, label]) => `<span><i class="sw p-${k}"></i>${label}</span>`).join('')}</div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Long task: where the time goes</title>
<style>
:root{--bg:#fcfcfb;--ink:#1d1d1b;--ink2:#5c5b57;--mut:#8a8984;--line:#e4e3de;--card:#ffffff;--gemma:#2a78d6;--qwen:#eb6834;--win:#e8f3e8;--grid:#ecebe7;
--p-start:#c9c8c2;--p-readNew:#4b9b6a;--p-reread:#d6453d;--p-think:#8b6fd6;--p-write:#3a3a36;--p-tools:#d9b25c}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#1a1a19;--ink:#ecebe7;--ink2:#b3b2ad;--mut:#8a8984;--line:#34342f;--card:#222220;--gemma:#3987e5;--qwen:#d95926;--win:#1f3322;--grid:#2c2c29;--p-start:#55554f;--p-readNew:#5bb07c;--p-reread:#e5605a;--p-think:#9c85e6;--p-write:#d8d7d2;--p-tools:#c9a24d}}
:root[data-theme=dark]{--bg:#1a1a19;--ink:#ecebe7;--ink2:#b3b2ad;--mut:#8a8984;--line:#34342f;--card:#222220;--gemma:#3987e5;--qwen:#d95926;--win:#1f3322;--grid:#2c2c29;--p-start:#55554f;--p-readNew:#5bb07c;--p-reread:#e5605a;--p-think:#9c85e6;--p-write:#d8d7d2;--p-tools:#c9a24d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:1400px;margin:0 auto;padding:18px 24px 24px}
h1{font-size:21px;line-height:1.25;margin:0}
.sub{color:var(--ink2);margin:2px 0 12px;font-size:14px}
h2{font-size:16px;margin:0 0 8px}
h2 small{font-weight:400;color:var(--mut);font-size:13px}
.tabbox{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.tabbar{display:flex;gap:4px;padding:6px 8px 0;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.tabbar::-webkit-scrollbar{display:none}
.tabbar button{appearance:none;border:0;background:none;font:inherit;font-size:14px;color:var(--ink2);padding:9px 14px 10px;border-radius:8px 8px 0 0;cursor:pointer;white-space:nowrap;position:relative}
.tabbar button:hover{color:var(--ink);background:var(--bg)}
.tabbar button[aria-selected=true]{color:var(--ink);font-weight:600}
.tabbar button[aria-selected=true]::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--ink)}
.tabbar button:focus-visible{outline:2px solid var(--gemma);outline-offset:-2px}
.tabpanel{padding:18px 20px}
.lead{color:var(--ink2);margin:0 0 12px;max-width:980px}
.verdict{font-size:16px;margin:0 0 16px;max-width:1150px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.who{display:flex;align-items:center;gap:8px;font-weight:600;margin:0 0 8px}
.dot{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:0}
.dot.gemma{background:var(--gemma)}.dot.qwen{background:var(--qwen)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 12px}
.card{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.card span{display:block;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
.card b{display:block;font-size:22px;font-variant-numeric:tabular-nums;margin:1px 0}
.card small{color:var(--ink2);font-size:12px}
.tb{display:flex;gap:2px;height:22px;border-radius:6px;overflow:hidden;background:var(--grid)}
.seg{height:100%}
.p-start{background:var(--p-start);fill:var(--p-start)}.p-readNew{background:var(--p-readNew);fill:var(--p-readNew)}.p-reread{background:var(--p-reread);fill:var(--p-reread)}
.p-think{background:var(--p-think);fill:var(--p-think)}.p-write{background:var(--p-write);fill:var(--p-write)}.p-tools{background:var(--p-tools);fill:var(--p-tools)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
table{width:100%;border-collapse:collapse;background:var(--bg);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:7px 12px;text-align:left;vertical-align:top;border-top:1px solid var(--line);font-variant-numeric:tabular-nums;font-size:14px}
thead th{border-top:0;font-size:13px;color:var(--ink2);font-weight:600}
tbody th{font-weight:500}
th small{display:block;color:var(--mut);font-weight:400;font-size:12px}
td small{color:var(--ink2);font-size:12px}
.parts th:first-child{width:330px}
.parts th,.parts td{padding:5px 12px}
.parts th small{display:inline;margin-left:8px}
.chart{width:100%;height:auto;background:var(--bg);border:1px solid var(--line);border-radius:12px;display:block}
.chart .grid{stroke:var(--grid)}.chart .ax{fill:var(--mut);font-size:12px}
.chart .ref{stroke:var(--mut);stroke-dasharray:4 4}.chart .reflab{fill:var(--ink2);font-size:12px;paint-order:stroke;stroke:var(--bg);stroke-width:4px;stroke-linejoin:round}
.chart .ln{fill:none;stroke-width:2.5}.chart .ln.gemma{stroke:var(--gemma)}.chart .ln.qwen{stroke:var(--qwen)}
.chart .pt{stroke:var(--bg);stroke-width:1.5}.chart .pt.gemma{fill:var(--gemma)}.chart .pt.qwen{fill:var(--qwen)}
.chart .mk.gemma{fill:var(--gemma)}.chart .mk.qwen{fill:var(--qwen)}
.chart .evt{stroke:var(--p-reread);stroke-width:2;stroke-dasharray:3 3}
.legend{display:flex;gap:6px 16px;font-size:13px;color:var(--ink2);margin:8px 0 0;flex-wrap:wrap}
.legend b{display:inline-block;width:18px;height:3px;vertical-align:4px;margin-right:6px}
.legend .lg{background:var(--gemma)}.legend .lq{background:var(--qwen)}
.legend .tri{display:inline-block;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:9px solid var(--ink2);margin-right:6px;vertical-align:0}
.legend .dash{display:inline-block;width:16px;border-top:2px dashed var(--p-reread);margin-right:6px;vertical-align:3px}
.cap{color:var(--ink2);font-size:13px;margin:6px 0 0}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--grid);color:var(--ink2)}
.tag.bad{background:#f6dcd3;color:#7a2a0e}.tag.ok{background:var(--win);color:var(--ink)}
.mono{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace}
.twice th,.twice td{white-space:nowrap;padding:5px 10px}.twice th small{display:inline;margin-left:6px}
.reads th{white-space:nowrap}.reads th,.reads td{padding:6px 10px}
.notes{color:var(--ink2);font-size:14px;padding-left:18px;margin:0}
.notes li{margin:4px 0}
.task{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:14px;margin:0 0 12px}
.src{font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mut);word-break:break-all;margin:10px 0 0}
.stack{display:grid;gap:12px}
@media (max-width:760px){.pair{grid-template-columns:1fr}.cards{grid-template-columns:1fr 1fr}.tabpanel{padding:12px}main{padding:14px 16px}.parts th:first-child{width:auto}th,td{padding:6px 8px}}
</style></head><body><main>
<h1>Long task: where the time goes</h1>
<p class="sub">Step 3 of Agentic Coder (the coding model, its runtime and its context builder) · ${A.map((a) => esc(a.m.name)).join(' and ')} · your settings: ${kctx(settings.ctx)} memory, ${settings.thinking ? 'High' : 'Low'} effort, thinking cap ${n0(settings.thinkingBudget)} · 29 Sep 2026</p>
<div class="tabbox">
<div class="tabbar" role="tablist" aria-label="Sections">
<button role="tab" id="t-verdict" aria-controls="p-verdict" aria-selected="true">1 · Verdict</button>
<button role="tab" id="t-slow" aria-controls="p-slow" aria-selected="false" tabindex="-1">2 · Why long tasks get slow</button>
<button role="tab" id="t-memory" aria-controls="p-memory" aria-selected="false" tabindex="-1">3 · When memory fills</button>
<button role="tab" id="t-steps" aria-controls="p-steps" aria-selected="false" tabindex="-1">4 · Step by step</button>
<button role="tab" id="t-notes" aria-controls="p-notes" aria-selected="false" tabindex="-1">5 · How it was measured</button>
</div>

<section class="tabpanel" role="tabpanel" id="p-verdict" aria-labelledby="t-verdict">
<p class="verdict">${verdict}</p>
<div class="pair">${A.map((a) => `<div><p class="who"><span class="dot ${a.cls}"></span>${esc(a.m.name)}</p>${cards(a)}${timeBar(a)}</div>`).join('')}</div>
${partsLegend}
<h2 style="margin-top:16px">Where the time went <small>· min:s and share of the whole task · lower = better on every row</small></h2>
<table class="parts"><thead><tr><th></th>${A.map((a) => `<th><span class="dot ${a.cls}"></span>${esc(a.m.name)}</th>`).join('')}</tr></thead><tbody>${partRows()}</tbody></table>
</section>

<section class="tabpanel" role="tabpanel" id="p-slow" aria-labelledby="t-slow" hidden>
<p class="lead">Every step, the model works over everything in its memory. The more words it holds, the slower it writes and reads the next ones. Each dot is one step; left = little in memory, right = a lot.</p>
<div class="pair">
<div><h2>Writing speed <small>· words a second · higher = faster</small></h2>${chart({ x: (s) => s.prompt, y: (s) => s.writeTps, xLabel: 'words in memory', yLabel: 'writing speed', xMax: depthMax, yMax: writeMax })}
<p class="cap">${A.filter((a) => a.writeStart && a.writeEnd).map((a) => `${esc(a.m.name.split(' ')[0])}: ${f1(a.writeStart)} → ${f1(a.writeEnd)} words/s (first four steps → last four)`).join(' · ')}</p></div>
<div><h2>Reading speed <small>· words a second · higher = faster</small></h2>${chart({ x: (s) => s.prompt, y: (s) => s.readTps, xLabel: 'words in memory', yLabel: 'reading speed', xMax: depthMax, yMax: readMax, yFmt: (v) => n0(v) })}
<p class="cap">${A.filter((a) => a.readStart && a.readEnd).map((a) => `${esc(a.m.name.split(' ')[0])}: ${n0(a.readStart)} → ${n0(a.readEnd)} words/s`).join(' · ')} · steps that read under 200 new words are left out (too short to time)</p></div>
</div>
${legend}
</section>

<section class="tabpanel" role="tabpanel" id="p-memory" aria-labelledby="t-memory" hidden>
<div class="pair">
<div><h2>Words in memory, step by step <small>· the task's clock in minutes</small></h2>${chart({ x: (s) => s.end / 60000, y: (s) => s.depth, xLabel: 'minutes into the task', yLabel: 'words in memory', xMax: timeMax, yMax: Math.max(settings.ctx, ...A.map((a) => a.maxDepth)) * 1.02, xFmt: (v) => f1(v), yFmt: (v) => k1(v), lines: [{ y: A[0].fullAt, label: `counts as full here: ${k1(A[0].fullAt)} (room kept for one reply)` }, { y: settings.ctx * settings.limits.trimAt, label: `trim at ${Math.round(settings.limits.trimAt * 100)}%` }], marks: A.flatMap((a) => a.notes.map((e) => ({ cls: a.cls, x: e.at / 60000, y: (a.steps.filter((s) => s.end <= e.at).pop()?.depth ?? 0) }))) })}
<div class="legend">${A.map((a) => `<span><b class="l${a.cls[0]}"></b>${esc(a.m.name)}</span>`).join('')}<span><i class="tri"></i>memory full: it wrote notes and started over from them</span></div></div>
<div><h2>What it read, and what it read twice</h2>
<table class="reads"><thead><tr><th></th><th>Reads</th><th>Files</th><th>Twice <small>fewer = better</small></th><th>After notes</th><th>Words twice</th></tr></thead><tbody>${readRows}</tbody></table>
${twiceRows.length ? `<table class="twice" style="margin-top:12px"><thead><tr><th>File <small>blue = Gemma · orange = Qwen</small></th><th>Part</th><th>First → again</th><th>Memory filled between?</th><th>Words</th></tr></thead><tbody>${twiceRows.slice(0, 6).join('')}</tbody></table>${twiceRows.length > 6 ? `<p class="cap">and ${twiceRows.length - 6} more (all in the run files)</p>` : ''}` : '<p class="cap">No file part was read twice.</p>'}
<p class="cap">"Same part" = the same file with the same lines or search word. Reading a different part of a file already read is not counted: that is new reading.</p>
</div>
</div>
</section>

<section class="tabpanel" role="tabpanel" id="p-steps" aria-labelledby="t-steps" hidden>
<p class="lead">One column per step, in seconds: reading, writing, then the tools and the app until the next step. A dashed red line is where memory filled and it started over from its notes.</p>
<div class="stack">${A.map((a) => `<div><p class="who"><span class="dot ${a.cls}"></span>${esc(a.m.name)} <small class="tag">${a.steps.length} steps</small></p>${stepStrip(a, secsMax)}</div>`).join('')}</div>
<div class="legend">${PARTS.filter(([k]) => ['readNew', 'reread', 'write', 'tools'].includes(k)).map(([k, label]) => `<span><i class="sw p-${k}"></i>${label}</span>`).join('')}<span><i class="dash"></i>memory full</span><span>hover a column for its numbers</span></div>
</section>

<section class="tabpanel" role="tabpanel" id="p-notes" aria-labelledby="t-notes" hidden>
<div class="pair"><div>
<h2>The question <small>· the same for both, in a copy of Agentic Coder's own code</small></h2>
<p class="task">${esc(settings.task)}</p>
<h2>Settings</h2>
<ul class="notes">
<li>Your saved limits from /effort: ${kctx(settings.ctx)} memory, thinking cap ${n0(settings.thinkingBudget)}, trim at ${Math.round(settings.limits.trimAt * 100)}%, summarize at ${Math.round(settings.limits.summarizeAt * 100)}%, ${settings.limits.steps} steps. ${settings.thinking ? 'High' : 'Low'} effort for both.</li>
<li>Run the way <span class="mono">coding -p</span> runs a request (runHeadless): the helpers on, files ranked first, the saved start-up, each model's speed helper on. Memory (facts it remembers) off, so the run is the same each time.</li>
<li>One run each, stopped at ${settings.minutes} minutes if not done: a measurement of where the time goes, not a grade of the answer.</li>
</ul></div><div>
<h2>How the numbers were taken</h2>
<ul class="notes">
<li>Every request the agent sent to the model's server was recorded with the server's own timings: words reused from memory, words read new, words written, and the time for each.</li>
<li><b>Reading again</b>: a step whose memory did not simply grow (the server reused less than it held before). Its new words are the reply written back plus the tool outputs that first appear in it; the rest was read again.</li>
<li><b>Thinking vs writing</b> is split by the task's own count of thinking words.</li>
<li><b>Tools + app</b> is what is left of the clock: running tools, the code search, and the app between steps.</li>
<li>"Words" are the model's tokens: about ¾ of an English word, or 3–4 characters of code.</li>
</ul>
<h2 style="margin-top:12px">Did they finish?</h2>
<ul class="notes">${A.map((a) => `<li><span class="dot ${a.cls}"></span>${esc(a.m.name)}: ${a.run.aborted ? `stopped at the ${settings.minutes}-minute cap` : esc(a.run.result?.reason ?? a.run.error ?? '—')}, ${n0(a.run.result?.outTokens ?? 0)} words written (${n0(a.run.result?.thinkTokens ?? 0)} of them thinking).</li>`).join('')}</ul>
</div></div>
<p class="src">Built by models/evals/tools/long-task-page.mjs from ${A.map((a) => esc(a.run.file)).join(' and ')} (code ${esc(settings.code)}).</p>
</section>
</div>
<script>
(() => {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const show = (t, focus) => {
    for (const x of tabs) { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !on; }
    if (focus) t.focus();
    try { history.replaceState(null, '', '#' + t.id.slice(2)); } catch {}
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t));
    t.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length], true); } });
  });
  document.addEventListener('keydown', (e) => { if (e.target.closest?.('input,textarea') || e.metaKey || e.ctrlKey || e.altKey) return; const n = Number(e.key); if (n >= 1 && n <= tabs.length) show(tabs[n - 1], true); });
  const want = tabs.find((t) => '#' + t.id.slice(2) === location.hash);
  if (want) show(want);
})();
</script>
</main></body></html>
`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT.replace(homedir(), '~')} (${A.map((a) => `${a.m.id}: ${a.steps.length} steps, ${n0(a.wall)} s`).join('; ')})`);
