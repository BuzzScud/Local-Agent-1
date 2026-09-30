// Edited copy vs original (the Arena's checks → Edited copy vs original, `/test edited`): does a
// model's edited copy (the Weights tab's Save the copy) still answer what the model itself answers,
// and what do the words you changed do? The same questions go to the original and then to the copy,
// each on a server of its own, one after the other (one big model at a time), at temperature 0 with
// thinking off, so a difference in an answer comes from the edits:
//   · six fixed questions, each with a word its answer must hold (a sum, a capital, a pattern, what a
//     line of code prints, a word spelt backwards, a question that reads the word "Tokyo"): they
//     catch a copy that broke;
//   · one for each word the edits change (a row of the word table or of the output, up to six):
//     "Repeat this…", which reads the word and has to write it again;
//   · a writing-speed prompt, tokens a second: an edit does not change the speed.
// Pass (the rule of 30 Sep 2026): the copy answers every fixed question the original answers.
// Your words are measured, not graded: changing a word is what an edit to it is for.
// It writes its results page into the DOCS folder (tests/) and its line in the test record.
//   node models/evals/tools/edited-check.mjs --model gemma [--no-record]
//   --url-original URL --url-edited URL: ask servers that are already up (no model is loaded or stopped)
//   --out DIR: the raw answers go there (else models/<model>/results/edited-check-<stamp>/)
//   --no-record: a look only; no line in the test record and no results page
import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { MODELS, MODELS_DIR, ModelServer, modelFolder, contextCheck, hasDraft, readEdited, editedModel, thinkingKwargs, recordTest, codeLabel } from '../../index.mjs';
import { weightsCore } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const look = args.includes('--no-record');
const pad = (n) => String(n).padStart(2, '0');
const now = new Date(); const t0 = Date.now();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const CTX = 8192; // the longest question is under 100 tokens and an answer at most 200
const MAX_WORDS = 6;

const id = opt('model');
const base = MODELS[id];
if (!base) { console.error(`pick a model: --model ${Object.keys(MODELS).join(' or ')}`); process.exit(2); }
const manifest = readEdited(id);
const copy = editedModel(id);
if (!manifest || !copy) { console.error(`${base.name} has no edited copy on this Mac: make one on the Weights tab (Save the copy), then run this again.`); process.exit(2); }

// The six fixed questions: cheap, each answered in a word, the same for every model and every run.
export const CHECKS = [
  { q: 'What is 17 × 23? Answer with only the number.', want: '391', short: '17 × 23' },
  { q: 'What is the capital of Japan? Answer with one word.', want: 'tokyo', short: 'the capital of Japan' },
  { q: 'Complete the pattern with one number only: 2, 4, 8, 16, …', want: '32', short: '2, 4, 8, 16, …' },
  { q: "What does this print? console.log([1,2,3].map(x=>x*2).join('-')) Answer with only the output.", want: '2-4-6', short: 'what a line of code prints' },
  { q: "Spell the word 'weight' backwards. Answer with only the letters.", want: 'thgiew', short: '“weight” backwards' },
  // this one READS the word " Tokyo": an edit to that row of the word table shows here
  { q: 'Is Tokyo a big city, and which country is it in? Answer with the country only.', want: 'japan', short: 'Tokyo’s country' },
];
const SPEED_PROMPT = 'Write a JavaScript function that parses a CSV line into fields, handling quoted fields with commas inside. Just the code.';

// ---------- the words the edits change ----------
// A "file" the way the Weights tab's reader wants one, over a path on disk.
const fileOf = (p) => { const size = statSync(p).size; return { name: basename(p), size, slice: (a, b) => ({ arrayBuffer: async () => { const fd = openSync(p, 'r'); try { const n = Math.max(0, Math.min(b, size) - a); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, a); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + n); } finally { closeSync(fd); } } }) }; };
const WORD_TABLES = ['token_embd.weight', 'output.weight'];
// The rows of the word table (or the output) an edit changes, in the order the edits come.
function wordRows(edits) {
  const out = [];
  const add = (tensor, r) => { if (WORD_TABLES.includes(tensor) && Number.isInteger(r) && !out.some((x) => x.row === r)) out.push({ row: r, tensor }); };
  for (const e of edits) {
    if (e.op === 'scale' || e.op === 'set') add(e.tensor, e.row);
    else if (e.op === 'range') for (let r = e.from; r <= Math.min(e.to, e.from + MAX_WORDS); r++) add(e.tensor, r);
    else if (e.op === 'copy') add(e.tensor, e.to);
    else if (e.op === 'swap') { add(e.tensor, e.a); add(e.tensor, e.b); }
  }
  return out.slice(0, MAX_WORDS);
}
const Core = weightsCore();
const copyPath = join(MODELS_DIR, copy.file);
const head = await Core.parseHeader(fileOf(copyPath)); // the copy keeps the original's word list
const tokens = head.tokens ?? [], kind = head.kv['tokenizer.ggml.model'];
// a special token: <start_of_turn>, <|im_end|>, [multimodal] (the reader does not keep the token types)
const special = (w) => /^<\|?[^<>\s]*\|?>$|^\[[^\]\s]+\]$/.test(w);
const shown = (s) => s.replace(/\n/g, '↵').replace(/\t/g, '⇥');
const words = wordRows(manifest.edits).map(({ row, tensor }) => {
  const text = row < tokens.length ? Core.tokenText(tokens[row], kind) : '';
  const word = text.trim();
  // a special token (<start_of_turn>, <|im_end|>) or a bit of space has nothing to write back
  const plain = word.length > 0 && !special(word) && !/[\u0000-\u001f]/.test(word);
  return { row, tensor, text, word, check: plain, q: plain ? `Repeat this exactly, and write nothing else: ${word}` : null, want: plain ? word.toLowerCase() : null, short: `“${shown(text)}”` };
});

// ---------- asking ----------
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: keeping the answers so far…'); });
const post = async (url, path, body) => {
  const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};
const ask = async (url, model, q, maxNew = 60) => {
  const j = await post(url, '/v1/chat/completions', { messages: [{ role: 'user', content: q }], max_tokens: maxNew, temperature: 0, chat_template_kwargs: thinkingKwargs(model, false) });
  return { text: String(j.choices?.[0]?.message?.content ?? '').trim(), tps: j.timings?.predicted_per_second ?? null };
};
const holds = (text, want) => text.toLowerCase().replace(/[*_`]/g, '').includes(want);

// One side: its server (unless one is named), the speed prompt, the six, your words.
async function side(label, model, url) {
  const s = { label, name: model.name, file: model.file, loadSecs: null, tps: null, answers: [], words: [], broke: null };
  let srv = null; const a0 = Date.now();
  try {
    if (!url) {
      for (let i = 0; i < 24 && !contextCheck(model, CTX, { draft: hasDraft(model) }).fits; i++) { if (!i) console.log('waiting for memory to free up (up to 2 minutes)…'); await new Promise((r) => setTimeout(r, 5000)); }
      const fit = contextCheck(model, CTX, { draft: hasDraft(model) });
      if (!fit.fits) throw new Error(fit.note);
      console.log(`${label}: loading ${model.file}…`);
      srv = new ModelServer(model);
      await srv.start({ ctx: CTX, share: false, lingerSecs: 0 });
      url = srv.url; s.loadSecs = (Date.now() - a0) / 1000;
      console.log(`${label}: loaded in ${Math.round(s.loadSecs)} s`);
    }
    if (!stopping) { const sp = await ask(url, model, SPEED_PROMPT, 200); s.tps = sp.tps; console.log(`${label}: writing ${sp.tps ? sp.tps.toFixed(1) : '?'} tokens a second`); }
    for (const c of CHECKS) {
      if (stopping) break;
      const a = await ask(url, model, c.q); const pass = holds(a.text, c.want);
      s.answers.push({ q: c.q, want: c.want, got: a.text.slice(0, 200), pass });
      console.log(`${pass ? 'PASS' : 'FAIL'} ${label} · ${c.short} → ${JSON.stringify(a.text.slice(0, 60))}`);
    }
    for (const w of words) {
      if (stopping) break;
      if (!w.check) { s.words.push({ row: w.row, got: null, pass: null }); console.log(`ASKED ${label} · ${w.short} (row ${w.row}): a special token or a space, nothing to write back`); continue; }
      const a = await ask(url, model, w.q, 20); const pass = holds(a.text, w.want);
      s.words.push({ row: w.row, got: a.text.slice(0, 120), pass });
      console.log(`${pass ? 'PASS' : 'FAIL'} ${label} · repeat ${w.short} (row ${w.row}) → ${JSON.stringify(a.text.slice(0, 40))}`);
    }
  } catch (e) { s.broke = e.message; console.error(`${label}: ${e.message}`); }
  finally { if (srv) { try { await srv.stop(); } catch {} await new Promise((r) => setTimeout(r, 1500)); } } // let Metal give the memory back
  return s;
}

const urls = { original: opt('url-original'), edited: opt('url-edited') };
if (!urls.original || !urls.edited) {
  // Looked up read-only (scanServers would also stop servers it finds left over).
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
  const big = [...Object.values(MODELS), copy].filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
}
console.log(`Edited copy vs original · ${base.name} · ${manifest.edits.length} edit${manifest.edits.length === 1 ? '' : 's'} saved ${new Date(manifest.saved).toLocaleString('en-GB')} · ${CHECKS.length} fixed questions${words.length ? ` + ${words.length} of your words` : ''}, on each`);
const original = await side('original', base, urls.original);
const edited = stopping || original.broke ? { label: 'edited', name: copy.name, file: copy.file, loadSecs: null, tps: null, answers: [], words: [], broke: original.broke ? 'not run: the original did not finish' : null } : await side('edited', copy, urls.edited);

// ---------- the result ----------
const count = (xs) => xs.filter((x) => x.pass).length;
const tps = (x) => (x ? x.toFixed(1) : '?');
const lost = original.answers.filter((a, i) => a.pass && edited.answers[i] && !edited.answers[i].pass).length;
const full = !stopping && !original.broke && !edited.broke && original.answers.length === CHECKS.length && edited.answers.length === CHECKS.length && edited.words.length === words.length;
const pass = full && lost === 0;
const wordsChanged = words.filter((w, i) => original.words[i] && edited.words[i] && original.words[i].got !== edited.words[i].got).length;
const code = codeLabel(); const secs = (Date.now() - t0) / 1000;
const out = opt('out') ?? join(modelFolder(base), 'results', `edited-check-${stamp}`); mkdirSync(out, { recursive: true }); // modelFolder is the model's own folder, whole
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: id, name: base.name, copy: copy.file, code, started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs, ctx: CTX,
  edits: manifest.edits, saved: manifest.saved, checks: CHECKS.length, original: count(original.answers), edited: count(edited.answers), lost,
  words: words.length, wordsOriginal: count(original.words), wordsEdited: count(edited.words), wordsChanged, pass, stopped: !full,
  why: original.broke || edited.broke || (stopping ? 'stopped' : null),
  page: docs ? `tests/agentic-coder-edited-copy-check-${id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(out, 'answers.json'), JSON.stringify({ checks: CHECKS, words, original, edited }, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writeFileSync(docsPath(summary.page), page(summary)); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'Edited copy vs original', model: id, ctx: CTX, passed: summary.edited, total: CHECKS.length, secs, part: !full,
  bar: 'the copy answers every fixed question the original answers', result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `The copy answered ${summary.edited} of ${CHECKS.length} fixed questions, the original ${summary.original}${lost ? ` (${lost} the original answers, the copy does not)` : ''}.${words.length ? ` Your words written back: ${summary.wordsEdited} of ${words.length} by the copy, ${summary.wordsOriginal} by the original.` : ' No word of the word table was edited.'} Writing ${tps(original.tps)} → ${tps(edited.tps)} tokens a second.${summary.why ? ` Stopped: ${summary.why}.` : ''}`,
  raw: relative(root, out), page: summary.page,
});
console.log(`Edited copy vs original on ${base.name}: the copy ${summary.edited} of ${CHECKS.length}, the original ${summary.original} · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(original.broke || edited.broke ? 1 : 0);

// ---------- the results page: tabs that fit the window ----------
function page(s) {
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = new Date(s.finished).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const verdict = s.stopped ? `Stopped: ${esc(s.why || 'before every question was asked')}` : s.pass ? `The copy still answers: ${s.edited} of ${s.checks} fixed questions, as the original (${s.original})` : `The copy lost ${s.lost} of the fixed questions the original answers`;
  const tile = (label, value, dir) => `<div class="tile"><span class="k">${label}</span><b>${value}</b><small>${dir}</small></div>`;
  const said = (a) => (!a ? '<td class="dim">not asked</td>' : a.pass == null ? '<td class="dim">nothing to check</td>' : `<td class="${a.pass ? 'ok' : 'bad'}">${esc(a.got) || '<i>nothing</i>'}</td>`);
  const tensorName = (t) => (t === 'token_embd.weight' ? 'word table' : t === 'output.weight' ? 'output' : t.replace(/^blk\.(\d+)\.(.+?)(\.weight)?$/, '$2 · layer $1').replace(/\.weight$/, ''));
  const rowName = (e, r) => { const w = words.find((x) => x.row === r && x.tensor === e.tensor); return w ? `“${esc(shown(w.text))}”` : `row ${r.toLocaleString('en-US')}`; };
  const by = (k) => (k === 0 ? 'off' : k === 0.5 ? '×½' : `×${k}`);
  const editText = (e) => `${esc(tensorName(e.tensor))} · ${e.op === 'scale' ? `${rowName(e, e.row)} ${by(e.k)}` : e.op === 'range' ? `rows ${e.from}–${e.to} ${by(e.k)}` : e.op === 'set' ? `${rowName(e, e.row)}, column ${e.col} → ${e.value}` : e.op === 'col' ? `column ${e.col} ${by(e.k)}` : e.op === 'copy' ? `${rowName(e, e.from)} → ${rowName(e, e.to)}` : `${rowName(e, e.a)} ⇄ ${rowName(e, e.b)}`}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Edited copy check</title><style>
:root { --page: #f9f9f7; --surface: #fcfcfb; --line: #e3e2dc; --ink: #0b0b0b; --ink2: #52514e; --ink3: #8a887f; --ok: #1c8558; --bad: #b3261e; --mono: ui-monospace, "SF Mono", Menlo, monospace; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #0d0d0d; --surface: #1a1a19; --line: #34342f; --ink: #fff; --ink2: #c3c2b7; --ink3: #8f8e86; --ok: #4fc38d; --bad: #ff8b82; color-scheme: dark; } }
:root[data-theme="dark"] { --page: #0d0d0d; --surface: #1a1a19; --line: #34342f; --ink: #fff; --ink2: #c3c2b7; --ink3: #8f8e86; --ok: #4fc38d; --bad: #ff8b82; color-scheme: dark; }
* { box-sizing: border-box; } body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 14px 24px; } h1 { font-size: 21px; margin: 0; } h3 { font-size: 14px; margin: 0 0 6px; } .dateline { color: var(--ink3); font-size: 13px; }
nav { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 12px; } nav button { font: inherit; padding: 6px 13px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; } nav button[aria-selected="true"] { background: var(--ink); color: var(--page); border-color: var(--ink); }
[hidden] { display: none !important; } .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.verdict { font-size: 17px; font-weight: 650; margin: 0 0 10px; } .verdict.ok { color: var(--ok); } .verdict.bad { color: var(--bad); }
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; } .tile { display: flex; flex-direction: column; gap: 2px; } .tile b { font-size: 22px; } .tile .k { color: var(--ink2); font-size: 13px; } .tile small { color: var(--ink3); font-size: 11.5px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; table-layout: fixed; } th, td { text-align: left; padding: 5px 10px; border-top: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; } thead th { border-top: none; color: var(--ink3); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; } td.ok { color: var(--ok); } td.bad { color: var(--bad); font-weight: 600; } td.dim { color: var(--ink3); } code { font-family: var(--mono); font-size: 12px; } .small { color: var(--ink3); font-size: 12px; }
p, ol, ul { color: var(--ink2); max-width: 900px; } ul { margin: 4px 0; padding-left: 20px; }
@media (max-width: 800px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } main { padding: 12px 16px; } }
</style></head><body><main>
<h1>Edited copy vs original</h1><div class="dateline">${esc(when)} · code ${esc(s.code)} · ${esc(s.name)} and its edited copy · thinking off, temperature 0</div>
<nav role="tablist"><button role="tab" data-v="result" aria-selected="true">1 · The result</button><button role="tab" data-v="edits" aria-selected="false">2 · The edits</button><button role="tab" data-v="how" aria-selected="false">3 · How it is checked</button></nav>
<section data-v="result"><p class="verdict ${s.pass ? 'ok' : 'bad'}">${verdict}</p>
<div class="tiles card">${tile('Fixed questions, the copy', `${s.edited} of ${s.checks}`, `the original: ${s.original} · as many = pass`)}${tile('Lost by the copy', s.lost, 'answered by the original, not by the copy · 0 = pass')}${tile('Your words written back', s.words ? `${s.wordsEdited} of ${s.words}` : '—', s.words ? `the original: ${s.wordsOriginal} · fewer = the edit changed the word` : 'no word of the word table was edited')}${tile('Writing speed', `${tps(original.tps)} → ${tps(edited.tps)}`, 'tokens a second, original → copy · about the same = expected')}</div>
<div class="card"><table><thead><tr><th style="width:30%">Question</th><th style="width:12%">Wants</th><th>The original said</th><th>The copy said</th></tr></thead><tbody>${CHECKS.map((c, i) => `<tr><td>${esc(c.q)}</td><td><code>${esc(c.want)}</code></td>${said(original.answers[i])}${said(edited.answers[i])}</tr>`).join('')}${words.map((w, i) => `<tr><td>${w.q ? esc(w.q) : `${esc(w.short)}: a special token or a space`}<div class="small">your word · ${esc(tensorName(w.tensor))} row ${w.row.toLocaleString('en-US')}</div></td><td>${w.want ? `<code>${esc(w.want)}</code>` : '—'}</td>${said(original.words[i])}${said(edited.words[i])}</tr>`).join('')}</tbody></table></div></section>
<section data-v="edits" hidden><div class="card"><h3>The ${s.edits.length} edit${s.edits.length === 1 ? '' : 's'} in the copy <span class="small">· saved ${esc(new Date(s.saved).toLocaleString('en-GB'))} · <code>${esc(s.copy)}</code></span></h3><ul>${s.edits.map((e) => `<li>${editText(e)}</li>`).join('')}</ul></div></section>
<section data-v="how" hidden><div class="card"><ol>
<li>The copy is the file the Weights tab’s <b>Save the copy</b> wrote: the original with your edits in it. The original is never changed.</li>
<li>The original is loaded on a server of its own, asked every question, and stopped; then the copy the same way. One big model at a time, ${CTX.toLocaleString('en-US')} tokens of memory, thinking off, temperature 0: the same question gets the same answer, so a different answer comes from the edits.</li>
<li>Six fixed questions, each with a word its answer must hold. They are the same for every model and every run: they catch a copy that broke. The last one reads the word “Tokyo”, so an edit to that word shows there too.</li>
<li>Your words: for each row of the word table or the output that an edit changes (up to ${MAX_WORDS}), “Repeat this exactly, and write nothing else: …”. It has to read the word and write it again. A special token or a bit of space is shown, not asked.</li>
<li>Pass: the copy answers every fixed question the original answers. Your words are measured, not graded: changing what a word does is what an edit to it is for.</li>
<li>The raw answers are on this Mac in <code>${esc(relative(root, out))}/</code>.</li></ol></div></section>
</main><script>(function () { const tabs = [...document.querySelectorAll('[role="tab"]')], views = [...document.querySelectorAll('section[data-v]')]; const show = (v) => { if (!tabs.some((t) => t.dataset.v === v)) v = tabs[0].dataset.v; tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.v === v))); views.forEach((x) => { x.hidden = x.dataset.v !== v; }); try { history.replaceState(null, '', '#' + v); } catch {} }; tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.v))); document.addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; const at = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'); const to = /^[1-3]$/.test(e.key) ? Number(e.key) - 1 : e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : -1; if (to >= 0 && to < tabs.length) show(tabs[to].dataset.v); }); if (location.hash.length > 1) show(location.hash.slice(1)); window.addEventListener('hashchange', () => show(location.hash.slice(1))); })();</script></body></html>`;
}
