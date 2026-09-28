// Before and after for the EDITED weights: the same questions and the same
// speed measure against the original model and the edited copy, one page
// with the answers side by side. Run it with Agentic Coder closed and the model
// stopped (coding stop): only one 27B fits in memory.
//   node models/evals/tools/edited-check.mjs [--ctx 16384] [--max-new 200]
// Writes models/evals/reports/edited-check-<day>.json and the page
// "Edited weights — before and after" into the DOCS folder under tests/.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, DEFAULT_MODEL, MODELS_DIR, modelPath, SERVER_BIN, serverArgs, scanServers, hasDraft, readEdited, editedModel } from '../../index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const CTX = opt('ctx', 16384), MAX_NEW = opt('max-new', 200);
const PORT = 17667;
const log = (s) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${s}`);

const manifest = readEdited();
if (!manifest) { console.error('No edited copy is saved (models/edited.json). Save edits from the Weights tab first.'); process.exit(1); }
const live = scanServers();
if (live.length) { console.error(`A model server is running (port ${live[0].port}). Close Agentic Coder and run "coding stop" first: only one 27B fits in memory.`); process.exit(1); }

const original = MODELS[DEFAULT_MODEL];
const edited = editedModel();

// Five quick checks: cheap, fixed, and answerable in a word. They catch a
// model that broke, not one that got slightly worse — the 28 practice tasks
// (bun run eval) are the full check.
const CHECKS = [
  { q: 'What is 17 × 23? Answer with only the number.', want: '391' },
  { q: 'What is the capital of Japan? Answer with one word.', want: 'tokyo' },
  { q: 'Complete the pattern with one number only: 2, 4, 8, 16, …', want: '32' },
  { q: "What does this print? console.log([1,2,3].map(x=>x*2).join('-')) Answer with only the output.", want: '2-4-6' },
  { q: "Spell the word 'weight' backwards. Answer with only the letters.", want: 'thgiew' },
  // This one READS the word " Tokyo": a word-table edit on that row shows here.
  { q: 'Is Tokyo a big city, and which country is it in? Answer with the country only.', want: 'japan' },
];
const SPEED_PROMPT = 'Write a JavaScript function that parses a CSV line into fields, handling quoted fields with commas inside. Just the code.';

const post = async (path, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};
const ask = async (q, maxNew = 60) => {
  const j = await post('/v1/chat/completions', { messages: [{ role: 'user', content: q }], max_tokens: maxNew, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
  return { text: j.choices?.[0]?.message?.content ?? '', tps: j.timings?.predicted_per_second ?? null };
};

async function measure(model, label) {
  log(`${label}: starting llama-server on ${model.file}…`);
  const draft = hasDraft(model);
  const child = spawn(SERVER_BIN, serverArgs(model, { ctx: CTX, port: PORT, draft }), { stdio: 'ignore' });
  const t0 = Date.now();
  try {
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw new Error(`the server exited while loading ${model.file}`);
      try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
      if (i > 900) throw new Error('the server did not become healthy in 3 minutes');
      await new Promise((r) => setTimeout(r, 200));
    }
    log(`${label}: loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s · helper ${draft ? 'on' : 'off'}`);
    const speed = await ask(SPEED_PROMPT, MAX_NEW);
    log(`${label}: writing ${speed.tps ? speed.tps.toFixed(1) : '?'} tokens/s`);
    const checks = [];
    for (const c of CHECKS) {
      const a = await ask(c.q);
      const pass = a.text.toLowerCase().includes(c.want.toLowerCase());
      checks.push({ q: c.q, want: c.want, got: a.text.trim().slice(0, 120), pass });
      log(`${label}: ${pass ? 'PASS' : 'FAIL'} — ${c.q.slice(0, 40)}… → ${a.text.trim().slice(0, 40)}`);
    }
    return { label, file: model.file, loadSecs: (Date.now() - t0) / 1000, tps: speed.tps, sample: speed.text.slice(0, 400), checks, passed: checks.filter((c) => c.pass).length };
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => { const t = setTimeout(() => { child.kill('SIGKILL'); r(); }, 5000); child.once('exit', () => { clearTimeout(t); r(); }); });
    await new Promise((r) => setTimeout(r, 1500)); // let Metal give the memory back
  }
}

const day = new Date().toISOString().slice(0, 10);
const results = { at: new Date().toISOString(), ctx: CTX, edits: manifest.edits, saved: manifest.saved, sides: [] };
results.sides.push(await measure(original, 'original'));
results.sides.push(await measure(edited, 'edited'));

const reports = join(here, '..', 'reports');
mkdirSync(reports, { recursive: true });
const jsonPath = join(reports, `edited-check-${day}.json`);
writeFileSync(jsonPath, JSON.stringify(results, null, 2));
log(`wrote ${jsonPath}`);

// ---------- the page ----------
const { docsPath } = await import(join(here, '..', '..', '..', 'docs', 'to-docs.mjs'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const [o, e] = results.sides;
const editLine = (ed) => ed.op === 'scale' ? `${ed.tensor} · row ${ed.row} ${ed.k === 0 ? 'off' : '×' + ed.k}` : ed.op === 'copy' ? `${ed.tensor} · row ${ed.from} → ${ed.to}` : `${ed.tensor} · rows ${ed.a} ⇄ ${ed.b}`;
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edited Weights Check</title>
<style>
:root { --page:#f7f6f2; --card:#fff; --line:#e3dfd5; --ink:#1c1b18; --ink2:#5b5850; --ink3:#8f8a7e; --good:#0a7d33; --bad:#b3261e; --mono:ui-monospace,"SF Mono",Menlo,monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page:#111110; --card:#1a1a19; --line:#34342f; --ink:#f4f3ee; --ink2:#c3c2b7; --ink3:#8f8e86; --good:#4cc26a; --bad:#f07a74; } }
:root[data-theme="dark"] { --page:#111110; --card:#1a1a19; --line:#34342f; --ink:#f4f3ee; --ink2:#c3c2b7; --ink3:#8f8e86; --good:#4cc26a; --bad:#f07a74; }
* { box-sizing: border-box; } body { margin:0; background:var(--page); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.wrap { max-width: 860px; margin:0 auto; padding:32px 20px 56px; } h1 { font-size:28px; margin:0 0 6px; } .sub { color:var(--ink2); }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; margin-top:16px; font-size:14px; }
th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; } tr:last-child td { border-bottom:none; }
thead th { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--ink3); }
.pass { color:var(--good); font-weight:600; } .fail { color:var(--bad); font-weight:600; }
code { font-family:var(--mono); font-size:.9em; } .small { font-size:13px; color:var(--ink3); } ul { margin:8px 0; padding-left:20px; }
</style></head><body><div class="wrap">
<h1>Edited weights — before and after</h1>
<p class="sub">${day} · the same questions to the original 27B and the edited copy, at temperature 0 · context ${CTX.toLocaleString()} · the quick check catches a broken model; the 28 practice tasks (<code>bun run eval</code>) are the full check.</p>
<h2 style="font-size:18px;margin-top:24px">The edits in the copy <span class="small">(saved ${esc(manifest.saved)})</span></h2>
<ul>${manifest.edits.map((ed) => `<li><code>${esc(editLine(ed))}</code></li>`).join('')}</ul>
<table><thead><tr><th>Measure</th><th>Original</th><th>Edited</th></tr></thead><tbody>
<tr><td>Writing speed</td><td>${o.tps ? o.tps.toFixed(1) + ' tokens/s' : '—'}</td><td>${e.tps ? e.tps.toFixed(1) + ' tokens/s' : '—'}${o.tps && e.tps ? ` <span class="small">(${((e.tps / o.tps - 1) * 100).toFixed(0)}%)</span>` : ''}</td></tr>
<tr><td>Load time</td><td>${o.loadSecs.toFixed(1)} s</td><td>${e.loadSecs.toFixed(1)} s</td></tr>
<tr><td>Quick check</td><td>${o.passed} of ${o.checks.length}</td><td>${e.passed} of ${e.checks.length}</td></tr>
</tbody></table>
<table><thead><tr><th>Question</th><th>Original said</th><th>Edited said</th></tr></thead><tbody>
${o.checks.map((c, i) => `<tr><td>${esc(c.q)}<div class="small">wants “${esc(c.want)}”</div></td><td class="${c.pass ? 'pass' : 'fail'}">${esc(c.got)}</td><td class="${e.checks[i].pass ? 'pass' : 'fail'}">${esc(e.checks[i].got)}</td></tr>`).join('')}
</tbody></table>
<p class="small">One self-contained file · raw run in models/evals/reports/edited-check-${day}.json</p>
</div></body></html>`;
const pagePath = docsPath(join('tests', `agentic-coder-edited-before-after-${day}.html`));
writeFileSync(pagePath, page);
log(`wrote ${pagePath}`);
log(`done: original ${o.passed}/${o.checks.length} at ${o.tps ? o.tps.toFixed(1) : '?'} tok/s · edited ${e.passed}/${e.checks.length} at ${e.tps ? e.tps.toFixed(1) : '?'} tok/s`);
