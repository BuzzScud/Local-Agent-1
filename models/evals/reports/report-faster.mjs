// The "make Gemma feel faster" before/after page (28 Sep 2026): two practice
// runs of the same tasks, one on the code before (9350bba) and one with the
// speed helpers, ranked reads and the sooner stuck question. Win rule: total
// minutes and median steps go down, and no task that passed before fails.
//   node models/evals/reports/report-faster.mjs <before dir> <after dir> [out.html]
// Each dir holds the summary.json that models/evals/bench/run.mjs writes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const [beforeDir, afterDir, outArg] = process.argv.slice(2);
if (!beforeDir || !afterDir) { console.error('usage: report-faster.mjs <before dir> <after dir> [out.html]'); process.exit(1); }
const out = outArg ?? join(homedir(), 'Desktop', 'gemma-docs', 'test', 'gemma-faster-results-2026-09-28.html');
const load = (d) => JSON.parse(readFileSync(join(d, 'summary.json'), 'utf8'));
const B = load(beforeDir);
const A = load(afterDir);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const median = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const mins = (s) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
const num = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US'));
const tasks = [...new Set([...B.results, ...A.results].map((r) => r.task))];
const rows = tasks.map((task) => {
  const b = B.results.filter((r) => r.task === task);
  const a = A.results.filter((r) => r.task === task);
  const avg = (rs, f) => (rs.length ? rs.reduce((n, r) => n + (r[f] ?? 0), 0) / rs.length : null);
  return {
    task,
    bPass: b.filter((r) => r.pass).length, aPass: a.filter((r) => r.pass).length, n: Math.max(b.length, a.length),
    bSecs: avg(b, 'secs'), aSecs: avg(a, 'secs'),
    bSteps: avg(b, 'steps'), aSteps: avg(a, 'steps'),
    aReads: a.some((r) => r.reads != null) ? avg(a, 'reads') : null,
    aFirst: a.some((r) => r.readFirst != null) ? avg(a, 'readFirst') : null,
    bTps: avg(b, 'tps'), aTps: avg(a, 'tps'),
    aThink: a.some((r) => r.thinkTokens != null) ? avg(a, 'thinkTokens') : null,
  };
});
const tB = rows.reduce((n, r) => n + (r.bSecs ?? 0), 0);
const tA = rows.reduce((n, r) => n + (r.aSecs ?? 0), 0);
const mB = median(B.results.map((r) => r.steps));
const mA = median(A.results.map((r) => r.steps));
const lost = rows.filter((r) => r.aPass < r.bPass).map((r) => r.task);
const won = tA < tB && (mA ?? 0) <= (mB ?? 0) && !lost.length;
const pB = B.results.filter((r) => r.pass).length;
const pA = A.results.filter((r) => r.pass).length;
const verdict = won
  ? `Faster: ${mins(tB)} → ${mins(tA)} in all (${Math.round((1 - tA / tB) * 100)}% less), the median task took ${num(mB)} → ${num(mA)} steps, and every task that passed before still passes.`
  : `The win rule did not hold: ${mins(tB)} → ${mins(tA)} in all, median steps ${num(mB)} → ${num(mA)}${lost.length ? `, and ${lost.join(', ')} passed before but not after` : ''}.`;
const tag = (a, b, lowerIsBetter = true) => (a == null || b == null ? '' : (lowerIsBetter ? a < b : a > b) ? ' good' : (lowerIsBetter ? a > b : a < b) ? ' bad' : '');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gemma Faster Results</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a64;--line:#e4e1d8;--card:#fff;--good:#1f7a4d;--goodbg:#e3f3ea;--bad:#a13a2a;--badbg:#f8e3df}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--mute:#a09f98;--line:#33322e;--card:#1f1e1b;--good:#7fd4a4;--goodbg:#1d3328;--bad:#f0a090;--badbg:#3a1f1a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 80px}h1{font-size:30px;margin:0 0 12px}h2{font-size:22px;margin:40px 0 10px;padding-top:6px;border-top:1px solid var(--line)}
.lead{font-size:18px}.mute{color:var(--mute)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:22px 0}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card b{display:block;font-size:22px}.card span{font-size:14px;color:var(--mute)}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:8px 7px;border-bottom:1px solid var(--line);white-space:nowrap}th{font-size:12.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);font-weight:600}
td.good{color:var(--good);font-weight:600}td.bad{color:var(--bad);font-weight:600}
.paths{font:13px/1.6 ui-monospace,Menlo,monospace;color:var(--mute);overflow-wrap:anywhere}
</style></head><body><main>
<h1>${won ? 'Gemma got faster' : 'Gemma faster: not yet'}</h1>
<p class="lead">${esc(verdict)}</p>
<div class="cards">
<div class="card"><b>${mins(tB)} → ${mins(tA)}</b><span>all tasks, before → after</span></div>
<div class="card"><b>${num(mB)} → ${num(mA)}</b><span>median steps a task</span></div>
<div class="card"><b>${pB} → ${pA}</b><span>tasks passed of ${A.results.length}</span></div>
</div>
<h2>Task by task</h2>
<div class="wrap"><table>
<tr><th>Task</th><th>Passed</th><th>Time</th><th>Steps</th><th>Writing (tok/s)</th><th>Reads after</th><th>Read first</th><th>Thinking after</th></tr>
${rows.map((r) => `<tr><td>${esc(r.task)}</td><td class="${r.aPass < r.bPass ? 'bad' : ''}">${r.bPass} → ${r.aPass} of ${r.n}</td><td class="${tag(r.aSecs, r.bSecs)}">${mins(r.bSecs)} → ${mins(r.aSecs)}</td><td class="${tag(r.aSteps, r.bSteps)}">${num(r.bSteps)} → ${num(r.aSteps)}</td><td class="${tag(r.aTps, r.bTps, false)}">${r.bTps ? r.bTps.toFixed(1) : '—'} → ${r.aTps ? r.aTps.toFixed(1) : '—'}</td><td>${num(r.aReads)}</td><td>${num(r.aFirst)}</td><td>${r.aThink == null ? '—' : `~${num(Math.round(r.aThink))}`}</td></tr>`).join('\n')}
</table></div>
<p class="mute">Steps = every tool event, including the files read first, so the “after” column is not flattered by them. Writing speed is the server's own count for the last reply of each run. Reads and thinking are only counted by the new code, so "before" has none. One run each is noisy: one slow task is not proof on its own.</p>
<h2>What changed between the two runs</h2>
<ul>
<li>Speed helpers on: Google's MTP guesses one word ahead and n-grams copy what is already on screen; Gemma checks the guesses and keeps only what it agrees with.</li>
<li>The files a request is about are read before the first step, found by meaning.</li>
<li>Stuck sooner: the same step twice or three errors in a row asks you (the practice bench has no one to ask, so it carries on as before).</li>
<li>Thinking is unchanged: on at High for every step, as you chose.</li>
</ul>
<p class="paths">before ${esc(beforeDir)} · after ${esc(afterDir)} · ctx ${esc(A.ctx)} · effort ${esc(A.effort ?? '')} · thinking cap ${esc(A.budget)} · built by models/evals/reports/report-faster.mjs</p>
</main></body></html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${won ? 'WIN' : 'NO WIN'}: ${verdict}\nsaved ${out}`);
