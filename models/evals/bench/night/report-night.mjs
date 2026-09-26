// Builds bonsai-night-<date>.html in the DOCS folder from an overnight results folder.
//   node models/evals/bench/night/report-night.mjs models/bonsai-2-27b/results/night/<date>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsPath } from '../../../../docs/to-docs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..'); // the repo
const dir = process.argv[2];
const day = basename(dir);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const load = (f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } };
const status = load('status.json') ?? { steps: {} };
const fmtS = (s) => (s == null ? '—' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const problems = [];

// Practice tasks
const LEVELS = ['off', 'medium', 'high'];
const practice = {};
for (const lv of LEVELS) { const s = load(join(`practice-${lv}`, 'summary.json')); if (s) practice[lv] = s.results; }
const taskNames = [...new Set(Object.values(practice).flat().map((r) => r.task))].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
const cell = (rs) => {
  if (!rs?.length) return '<td class="muted">not run</td>';
  const passed = rs.filter((r) => r.pass).length;
  const marks = rs.map((r) => `<i class="${r.pass ? 'ok' : 'no'}" title="${esc(r.pass ? `passed in ${r.secs}s` : `${r.why} (${r.secs}s)`)}">${r.pass ? '✓' : '✗'}</i>`).join('');
  const avg = rs.reduce((s, r) => s + r.secs, 0) / rs.length;
  const why = rs.find((r) => !r.pass)?.why;
  const tests = rs.some((r) => (r.tries ?? []).some((t) => t.startsWith('Writing tests')));
  return `<td><b class="marks">${marks}</b> <span class="muted">${passed}/${rs.length} · ${fmtS(avg)}</span>${why ? `<div class="why">${esc(why)}</div>` : ''}${tests && /writing|question/.test(rs[0].task) ? '<div class="why">wrote tests for it</div>' : ''}</td>`;
};
const practiceRows = taskNames.map((t) => {
  const byLv = Object.fromEntries(LEVELS.map((lv) => [lv, (practice[lv] ?? []).filter((r) => r.task === t)]));
  const route = Object.values(byLv).flat()[0]?.route ?? '';
  for (const lv of LEVELS) { const rs = byLv[lv]; if (rs.length && !rs.some((r) => r.pass)) problems.push(`Practice task ${t} never passed with thinking ${lv} (${rs[0].why})`); }
  return `<tr><th>${esc(t)}<div class="muted">${esc(route)}</div></th>${LEVELS.map((lv) => cell(byLv[lv])).join('')}</tr>`;
}).join('');
const levelTotals = LEVELS.map((lv) => { const rs = practice[lv] ?? []; return rs.length ? `${rs.filter((r) => r.pass).length} of ${rs.length} · ${fmtS(rs.reduce((s, r) => s + r.secs, 0) / rs.length)} each` : 'not run'; });

// Trigger words
const wq = load('words-quick.json');
const wr = load('words-real.json');
if (wq?.bad?.length) problems.push(`Trigger words (quick): ${wq.bad.length} requests went to the wrong place`);
for (const r of wr?.rows ?? []) if (!r.ok) problems.push(`Trigger words: "${r.prompt.slice(0, 60)}" — ${r.fails.join('; ')}`);
const wordRows = (wr?.rows ?? []).map((r) => `<tr><td>${r.n}</td><td>${esc(r.folder)}</td><td>${esc(r.prompt)}</td><td>${esc(r.route)}</td><td>${fmtS(r.secs)}</td><td>${r.ok ? '<b class="ok">OK</b>' : `<b class="no">✗</b> ${esc(r.fails.join('; '))}`}${(r.tries ?? []).length ? `<div class="why">${esc(r.tries.join(' · '))}</div>` : ''}${r.bash?.length ? `<div class="why">commands: ${esc(r.bash.map((b) => `${b.cmd.slice(0, 50)}${b.error ? ' (blocked/failed)' : ''}`).join(' · '))}</div>` : ''}</td></tr>`).join('');

// Start-up and memory
const soak = load('soak.json');
const starts = soak?.starts ?? [];
const okStarts = starts.filter((s) => !s.error);
const avg = (k) => (okStarts.length ? okStarts.reduce((s, x) => s + (x[k] ?? 0), 0) / okStarts.length : null);
if (starts.some((s) => s.error)) problems.push(`Start-up: ${starts.filter((s) => s.error).length} of ${starts.length} cold starts failed`);
if (okStarts.some((s) => !s.restored)) problems.push(`Start-up: ${okStarts.filter((s) => !s.restored).length} cold starts read the instructions instead of restoring them`);
const conv = soak?.conversation;
if (conv && conv.peakTotalGb > soak.estimateGb32k) problems.push(`Memory: peaked at ${conv.peakTotalGb} GB, above the app's estimate (${soak.estimateGb32k} GB)`);
if (conv?.swapGrowthMb > 500) problems.push(`Memory: the Mac swapped ${conv.swapGrowthMb} MB during the long conversation`);
for (const t of conv?.turns ?? []) if (t.error) problems.push(`Long conversation: "${t.q}" — ${t.error}`);

// Speed
const speed = load('speed.json');
const bench = speed?.bench ?? [];
const base = Object.fromEntries(bench.filter((b) => b.label.startsWith('today')).map((b) => [b.test, b.tps]));
const labels = [...new Set(bench.map((b) => b.label))];
const pct = (v, b) => (v && b ? `${v >= b ? '+' : ''}${Math.round((v / b - 1) * 100)}%` : '');
const speedRows = labels.map((l) => {
  const g = (t) => bench.find((b) => b.label === l && b.test === t)?.tps;
  const err = bench.find((b) => b.label === l && b.error)?.error;
  return `<tr><th>${esc(l)}</th>${err ? `<td colspan="3" class="no">${esc(err.slice(0, 120))}</td>` : ['pp512', 'pp2048', 'tg128'].map((t) => `<td>${g(t) ?? '—'} <span class="muted">${l.startsWith('today') ? '' : pct(g(t), base[t])}</span></td>`).join('')}</tr>`;
}).join('');
const wins = labels.filter((l) => !l.startsWith('today')).map((l) => { const g = (t) => bench.find((b) => b.label === l && b.test === t)?.tps; return { l, read: g('pp2048') / base.pp2048 - 1, write: g('tg128') / base.tg128 - 1 }; }).filter((x) => x.read > 0.05 || x.write > 0.05);
const rereadRows = (speed?.reread ?? []).map((r) => r.error ? `<tr><th>batch ${r.ub}</th><td colspan="4" class="no">${esc(r.error)}</td></tr>` : `<tr><th>batch ${r.ub}${r.ub === 512 ? ' (today)' : ''}</th><td>${r.firstTokens} tokens in ${fmtS(r.firstSecs)}</td><td>~${r.avgReread} tokens</td><td>~${r.avgSecs} s</td><td>${r.serverGb ?? '—'} GB</td></tr>`).join('');

// Re-reading probe
const rr = load('reread.json');
const rrSteps = rr?.steps ?? [];
const broken = rrSteps.filter((x) => !x.extendsPrevious);
if (rr && broken.length) problems.push(`Speed: ${broken.length} of ${rrSteps.length} conversation steps changed an earlier part of the prompt, forcing a re-read (${rr.totalRereadTokens.toLocaleString()} tokens re-read for ${rr.totalWrittenTokens.toLocaleString()} written)`);
const rrRows = rrSteps.map((x) => `<tr><td>${x.step}</td><td>${x.extendsPrevious ? '<span class="ok">only added</span>' : `<span class="no">changed</span> message ${x.changedMessage?.index ?? '?'} (${esc(x.changedMessage?.role ?? '?')})`}</td><td>${x.rereadTokens ?? '—'}</td><td>${x.readSecs ?? '—'} s</td><td>${x.wroteTokens ?? '—'}</td><td class="why">${x.around ? `before: ${esc(x.around.previous.slice(80, 220))}<br>after: ${esc(x.around.next.slice(80, 220))}` : ''}</td></tr>`).join('');

// Screens
const screens = readdirSync(dir).filter((f) => /^screens-\d+x\d+\.json$/.test(f)).map((f) => load(f)).filter(Boolean).sort((a, b) => a.cols - b.cols);
for (const s of screens) for (const c of s.checks ?? []) if (!c.ok) problems.push(`Screens at ${s.cols}×${s.rows}: ${c.moment} — ${c.what}`);
const screenJson = JSON.stringify(Object.fromEntries(screens.map((s) => [`${s.cols}x${s.rows}`, { cols: s.cols, rows: s.rows, screens: s.screens }])));

// Steps
for (const [n, s] of Object.entries(status.steps ?? {})) { if (s.skipped) problems.push(`Step ${n} was skipped: ${s.skipped}`); else if (s.error || (s.code !== 0 && s.code != null) || s.signal) problems.push(`Step ${n} ended badly (${s.error ?? s.signal ?? `code ${s.code}`}); see ${n}.log`); }
const stepRows = Object.entries(status.steps ?? {}).map(([n, s]) => `<tr><th>${esc(n)}</th><td>${s.skipped ? `skipped: ${esc(s.skipped)}` : s.error ? `error: ${esc(s.error)}` : `${s.code === 0 ? 'done' : `code ${s.code ?? s.signal}`} · ${fmtS(s.secs)}`}</td><td class="muted">${esc(s.finished?.slice(11, 16) ?? '')}</td></tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bonsai night check ${esc(day)}</title>
<style>
  :root { --page:#f3f3f1; --ink:#1d1d1f; --muted:#6b6b70; --line:#d9d9d6; --card:#fff; --soft:#e4f1e1; --chip:#ecece9; --ok:#2e7d32; --no:#b3261e; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; --no:#ff8a80; } }
  :root[data-theme="dark"] { --page:#101011; --ink:#ececee; --muted:#9a9aa0; --line:#2c2c30; --card:#18181a; --soft:#1c2a1c; --chip:#232326; --ok:#87d787; --no:#ff8a80; }
  * { box-sizing:border-box; } html, body { margin:0; background:var(--page); color:var(--ink); }
  body { font:14px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1160px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:28px 0 10px; }
  .sub, .muted { color:var(--muted); } .why { color:var(--muted); font-size:12px; }
  code { font:12.5px ui-monospace, Menlo, monospace; background:var(--chip); padding:1px 5px; border-radius:4px; }
  .stats { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 12px; } .stat b { display:block; font-size:21px; } .stat span { color:var(--muted); font-size:12.5px; }
  .tw { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; font-size:13px; }
  th, td { text-align:left; padding:7px 10px; border-top:1px solid var(--line); vertical-align:top; } thead th { border-top:0; color:var(--muted); font-size:12px; }
  .ok { color:var(--ok); } .no { color:var(--no); } .marks i { font-style:normal; margin-right:3px; } .marks i.ok { color:var(--ok); } .marks i.no { color:var(--no); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; } .card ul { margin:0; padding-left:18px; } .card li { margin:4px 0; }
  .bar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px; } .seg { display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  .seg button { font:inherit; border:0; background:var(--card); color:var(--muted); padding:6px 12px; cursor:pointer; } .seg button[aria-pressed="true"] { background:var(--soft); color:var(--ink); font-weight:600; }
  .winwrap { overflow-x:auto; padding:6px 0 12px; } .win { border-radius:10px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.35); width:max-content; margin:0 auto; }
  .screen { background:#171717; color:#fff; color-scheme:dark; padding:3px 5px; font:11px/13px "SF Mono", ui-monospace, Menlo, monospace; white-space:pre; overflow:hidden; }
  .screen div { height:13px; } .screen .g { display:inline-block; width:1ch; text-align:center; }
  @media (max-width:760px) { .stats { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } }
</style>
</head>
<body>
<main>
  <h1>Bonsai Code night check · ${esc(day)}</h1>
  <p class="sub">Report only: nothing was changed. Ran ${esc(status.started?.slice(11, 16) ?? '')}–${esc(status.finished?.slice(11, 16) ?? '…')} UTC on the real Bonsai 2 27B. Results: <code>evals/night/${esc(day)}/</code>.</p>

  <div class="stats">
    <div class="stat"><b>${LEVELS.map((lv) => { const rs = practice[lv] ?? []; return rs.length ? `${Math.round(100 * rs.filter((r) => r.pass).length / rs.length)}%` : '—'; }).join(' · ')}</b><span>practice tasks passed, thinking off · medium · high</span></div>
    <div class="stat"><b>${wr ? `${wr.ok} of ${wr.total}` : '—'}</b><span>trigger-word requests with the real model OK (quick layer: ${wq ? `${wq.ok}/${wq.total}` : '—'})</span></div>
    <div class="stat"><b>${avg('totalSecs') ? `${avg('totalSecs').toFixed(1)} s` : '—'}</b><span>cold start to a "hello" reply (${okStarts.filter((s) => s.restored).length} of ${starts.length} restored)</span></div>
    <div class="stat"><b>${conv ? `${conv.peakTotalGb} GB` : '—'}</b><span>peak memory in a full conversation (estimate ${soak?.estimateGb32k ?? '—'} GB; swap +${conv?.swapGrowthMb ?? '—'} MB)</span></div>
  </div>

  <h2>Problems found (${problems.length})</h2>
  <div class="card">${problems.length ? `<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : 'None.'}</div>

  <h2>Practice tasks</h2>
  <div class="tw"><table><thead><tr><th>Task</th><th>Thinking off</th><th>Medium</th><th>High</th></tr></thead><tbody>${practiceRows}</tbody>
  <tfoot><tr><th>All</th>${levelTotals.map((t) => `<td><b>${esc(t)}</b></td>`).join('')}</tr></tfoot></table></div>

  <h2>Speed-up candidates (measured against today's settings)</h2>
  <div class="tw"><table><thead><tr><th>Setting</th><th>Reading 512 (tok/s)</th><th>Reading 2,048</th><th>Writing 128</th></tr></thead><tbody>${speedRows || '<tr><td colspan="4">not run</td></tr>'}</tbody></table></div>
  <p class="muted">${wins.length ? `More than 5% faster than today: ${wins.map((w) => `${esc(w.l)} (reading ${Math.round(w.read * 100)}%, writing ${Math.round(w.write * 100)}%)`).join('; ')}.` : 'Nothing was more than 5% faster than today\'s settings.'} ${speed?.ptq1?.skipped ? `Smaller file: skipped (${esc(speed.ptq1.skipped)}).` : speed?.ptq1?.error ? `Smaller file: ${esc(speed.ptq1.error)}.` : speed?.ptq1 ? `Smaller file downloaded in ${fmtS(speed.ptq1.downloadSecs)}, measured, and deleted (${speed.ptq1.deleted ? 'confirmed' : 'NOT deleted'}).` : ''}</p>
  <div class="tw"><table><thead><tr><th>Re-reading per conversation turn</th><th>First read</th><th>Re-read each turn</th><th>Time each turn</th><th>Server memory</th></tr></thead><tbody>${rereadRows || '<tr><td colspan="5">not run</td></tr>'}</tbody></table></div>

  <h2>Why each step re-reads (one real question, every request compared)</h2>
  <p class="muted">${rr ? `${rr.requests} requests in ${fmtS(rr.secs)}: ${rr.totalRereadTokens.toLocaleString()} tokens re-read, ${rr.totalWrittenTokens.toLocaleString()} written; ${rr.stepsThatExtend} of ${rrSteps.length} steps only added to the previous prompt (those can continue where the last left off).` : 'not run'}</p>
  <div class="tw"><table><thead><tr><th>Step</th><th>Earlier prompt</th><th>Re-read</th><th>Reading time</th><th>Wrote</th><th>Where it first differed</th></tr></thead><tbody>${rrRows}</tbody></table></div>

  <h2>Trigger words with the real model</h2>
  <div class="tw"><table><thead><tr><th>#</th><th>Folder</th><th>Request</th><th>Went to</th><th>Time</th><th>Result</th></tr></thead><tbody>${wordRows || '<tr><td colspan="6">not run</td></tr>'}</tbody></table></div>

  <h2>Start-up and memory</h2>
  <div class="card"><ul>
    <li>${starts.length} cold starts: load ${avg('loadSecs')?.toFixed(1) ?? '—'} s, restore + this project's details ${avg('warmSecs')?.toFixed(1) ?? '—'} s, "hello" ${avg('replySecs')?.toFixed(1) ?? '—'} s on average; ${okStarts.filter((s) => s.restored).length} restored, ${starts.filter((s) => s.error).length} failed.</li>
    <li>Long conversation: ${conv?.turns?.length ?? 0} questions, context used up to ${Math.max(0, ...(conv?.turns ?? []).map((t) => t.ctxUsed ?? 0)).toLocaleString()} tokens, ${(conv?.turns ?? []).filter((t) => t.compacted).length} summaries to free memory, ${conv?.toolErrors ?? 0} tool errors; peak ${conv?.peakTotalGb ?? '—'} GB; the Mac's free memory went as low as ${Math.min(100, ...(conv?.samples ?? []).map((s) => s.freePct ?? 100))}%.</li>
  </ul></div>
  <div class="tw" style="margin-top:10px"><table><thead><tr><th>Question</th><th>Time</th><th>Context used</th><th>Notes</th></tr></thead><tbody>${(conv?.turns ?? []).map((t) => `<tr><td>${esc(t.q)}</td><td>${fmtS(t.secs)}</td><td>${(t.ctxUsed ?? 0).toLocaleString()}${t.compacted ? ' · summarized' : ''}</td><td class="why">${esc([t.error, ...(t.notes ?? [])].filter(Boolean).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="4">not run</td></tr>'}</tbody></table></div>

  <h2>Screens at several sizes</h2>
  ${screens.length ? `<div class="bar"><span class="seg" id="sizes">${screens.map((s, i) => `<button data-v="${s.cols}x${s.rows}" aria-pressed="${i === 0}">${s.cols}×${s.rows}</button>`).join('')}</span><span class="seg" id="moments">${[['starting', 'Starting'], ['slash', '"/" menu'], ['model', '/model'], ['hello', 'Reply']].map(([k, l], i) => `<button data-v="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</span></div>
  <div class="winwrap"><div class="win"><div class="screen" id="screen"></div></div></div>
  <div class="tw"><table><thead><tr><th>Size</th><th>Checks</th></tr></thead><tbody>${screens.map((s) => `<tr><th>${s.cols}×${s.rows}</th><td>${(s.checks ?? []).map((c) => `<span class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'}</span> ${esc(c.moment)}: ${esc(c.what)}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">not run</p>'}

  <h2>Steps</h2>
  <div class="tw"><table><tbody>${stepRows}</tbody></table></div>
</main>
<script>
(() => {
  const all = ${screenJson};
  const el = document.getElementById('screen'); if (!el) return;
  const st = { size: Object.keys(all)[0], moment: 'starting' };
  const show = () => { const s = all[st.size]; el.style.width = 'calc(' + s.cols + 'ch + 10px)'; el.style.height = (s.rows * 13 + 6) + 'px'; el.innerHTML = s.screens[st.moment] || '<div>(not reached)</div>';
    for (const b of document.querySelectorAll('#sizes button')) b.setAttribute('aria-pressed', String(b.dataset.v === st.size));
    for (const b of document.querySelectorAll('#moments button')) b.setAttribute('aria-pressed', String(b.dataset.v === st.moment)); };
  document.querySelectorAll('#sizes button').forEach((b) => b.onclick = () => { st.size = b.dataset.v; show(); });
  document.querySelectorAll('#moments button').forEach((b) => b.onclick = () => { st.moment = b.dataset.v; show(); });
  show();
})();
</script>
</body>
</html>
`;
const target = docsPath(`tests/bonsai-night-${day}.html`);
writeFileSync(target, html);
console.log(`wrote ${target} (${problems.length} problems listed)`);
