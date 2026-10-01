// The New model check (the Arena → New model check, `/test modelcheck`): what a model added to
// /model does with Agentic Coder's own requests, through the app's real client (the same
// streaming, thinking split and tool-call reading a reply gets). Made on 30 Sep 2026 for K2
// Horizon 7B, whose engine (IFM's llama.cpp) knows its design but not its tags: the check shows
// whether its tool calls come back as real calls or are read from the text, and whether its
// thinking stays apart at each level. Runs on any model in /model.
// The checks: it loads (and what memory it took) · the chat template takes the app's request at
// every thinking level · a plain answer with thinking off · a tool call with thinking off · a
// tool call at each thinking level, its thinking kept apart · the thinking cap stops it · (when it
// has one) its other tool-call format · reading and writing speed.
// Pass: every check passes (the speeds are measured, not judged).
//   node models/evals/tools/model-check.mjs --model k2 [--ctx 16384] [--url http://127.0.0.1:PORT]
//   --url: on a server that is already up (nothing loads or stops; no memory reading)
//   --no-record: a look only; no line in the test record and no results page
//   --rebuild <a run's folder>: draws that run's page again from its saved results
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, availableBytes, footprintOf, engineOf, recordTest, codeLabel, thinkingKwargs, SERVER_PROCESS } from '../../index.mjs';
import { streamChat, toolSchemas, systemPrompt, toolCallInText } from '../../../terminal/index.mjs';
import { DOCS_DIR, docsPath } from '../../../docs/tools/to-docs.mjs';
import { buildModelCheckPage } from './model-check-page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[opt('model', DEFAULT_MODEL)];
if (!model) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }
const CAP = 256; // the thinking cap the cap check asks for, in tokens
const pad = (n) => String(n).padStart(2, '0');
const TAGS = /<\/?(?:ifm\|)?think[a-z_]*>|<\|?channel\|?>|<\/?tool_call>|<\/?ifm\|tool_calls?>/; // a tag left in the open

function writePage(out, rows, s) {
  const at = new Date(s.started);
  writeFileSync(docsPath(s.page), buildModelCheckPage({
    title: `New model check · ${s.name}`,
    dateline: `${at.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${pad(at.getHours())}:${pad(at.getMinutes())} · code ${s.code} · ${s.ctx.toLocaleString('en-US')} tokens of context`,
    s, rows, raw: [relative(root, out)],
  }));
}

if (args.includes('--rebuild')) {
  const dir = opt('rebuild');
  const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  if (!s.page) { console.error(`${dir} has no results page to draw again`); process.exit(2); }
  writePage(dir, JSON.parse(readFileSync(join(dir, 'rows.json'), 'utf8')), s);
  console.log(`results page drawn again: ${s.page}`);
  process.exit(0);
}

const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const out = opt('out') ?? join(modelFolder(model), 'results', `model-check-${stamp}`);
mkdirSync(out, { recursive: true });

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { if (stopping) process.exit(130); stopping = true; console.log('stopping: keeping the checks done so far…'); });

// The app's own request: its instructions and tools, on a copy of the demo project.
const cwd = mkdtempSync(join(tmpdir(), 'agentic-model-check-'));
cpSync(join(root, 'terminal', 'demo-project'), cwd, { recursive: true });
const system = systemPrompt({ cwd, git: 'test' });
const tools = toolSchemas();
const levels = (model.thinkingLevels ?? []).filter((l) => l.effort);

// One request through the app's client: what it thought, said, and called (as a real call, or
// written in the text and read the way the app reads it), with the server's counts.
async function ask(url, user, { thinking = false, effort, m = model, thinkCap, maxTokens = 2048, extra } = {}) {
  const t = performance.now();
  const ev = { reasoning: '', text: '', calls: [], timings: null, usage: null, finish: null };
  for await (const e of streamChat({ url, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tools, thinking, effort, model: m, sampling: thinking ? m.thinkingSampling ?? m.sampling : m.sampling, maxTokens, thinkCap, extra })) {
    if (e.type === 'reasoning') ev.reasoning += e.text;
    else if (e.type === 'text') ev.text += e.text;
    else if (e.type === 'tool') { if (!ev.calls[e.index]) ev.calls[e.index] = { name: e.name, args: '' }; if (e.name) ev.calls[e.index].name = e.name; ev.calls[e.index].args += e.args ?? ''; }
    else if (e.type === 'done') { ev.timings = e.timings; ev.usage = e.usage; ev.finish = e.finish; }
  }
  ev.secs = (performance.now() - t) / 1000;
  const real = ev.calls.filter(Boolean)[0];
  const inText = real ? null : toolCallInText(ev.text) ?? (!ev.text.trim() ? toolCallInText(ev.reasoning) : null);
  ev.call = real ? { name: real.name, args: real.args, how: 'a real call' } : inText ? { name: inText.name, args: inText.args, how: 'written in the text, read by the app' } : null;
  return ev;
}
const readsPackage = (c) => c?.name === 'Read' && /package\.json/.test(c.args ?? '');
const short = (s, n = 90) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const CALL_ASK = 'Use the Read tool to read package.json in this project, then tell me its name field. Do not answer before you have read it.';

// The engine as the lines say it: llama.cpp (whose build), or MLX for a model on the MLX engine.
const engineName = engineOf(model).python ? 'MLX (mlx-server.py)' : `${engineOf(model).id}'s llama.cpp`;
const rows = [];
function row(id, name, pass, detail, extra = {}) {
  rows.push({ id, name, pass, detail, ...extra });
  console.log(`${pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

let url = opt('url'), srv = null;
const t0 = Date.now();
let ctx = Number(opt('ctx', 0)) || null;
let memory = null;
if (!url) {
  const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => SERVER_PROCESS.test(l));
  const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
  if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
  // Memory a model just let go comes back over a minute or so: wait up to 2 minutes for it.
  const fitsAt = (c) => contextCheck(model, c).fits;
  if (!ctx && !fitsAt(16_384)) console.log('waiting for memory to free up (up to 2 minutes)…');
  for (let i = 0; i < 24 && !fitsAt(ctx ?? 16_384); i++) await new Promise((r) => setTimeout(r, 5000));
  ctx ??= model.ctxWant ?? (fitsAt(32_768) ? 32_768 : 16_384);
  const fit = contextCheck(model, ctx);
  if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }
  try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  console.log(`${model.name} on ${engineOf(model).id} (${engineOf(model).tag}) · ${ctx.toLocaleString('en-US')} tokens of context · loading…`);
  const freeBefore = availableBytes();
  srv = new ModelServer(model);
  process.on('uncaughtException', async (e) => { console.error(e); try { await srv.stop(); } catch {} process.exit(1); });
  try {
    await srv.start({ ctx, share: false, lingerSecs: 0, helper: false });
  } catch (e) {
    row('load', 'It loads', false, `the server did not start: ${short(e.message, 200)}`);
  }
  if (srv.url) {
    url = srv.url;
    const pid = srv.child?.pid;
    memory = { takenGB: +((freeBefore - availableBytes()) / 1e9).toFixed(2), footprintGB: pid ? +(footprintOf(pid) / 1e9).toFixed(2) : null };
    row('load', 'It loads', true, `on ${engineName} in ${Math.round((Date.now() - t0) / 1000)} s; free memory went down ${memory.takenGB} GB${memory.footprintGB ? `, the server's own footprint ${memory.footprintGB} GB` : ''}`, { secs: (Date.now() - t0) / 1000, memory });
  }
} else {
  ctx ??= 32_768;
  console.log(`${model.name} · on ${url}`);
}

if (url && !stopping) {
  // The template takes the app's whole request (instructions, tools) at every level.
  const bad = [];
  for (const lv of [{ id: 'off', label: 'thinking off', effort: null }, ...levels]) {
    try {
      const r = await fetch(`${url}/apply-template`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: 'hi' }], tools, chat_template_kwargs: thinkingKwargs(model, Boolean(lv.effort), lv.effort ?? undefined) }) });
      const j = await r.json();
      if (!r.ok || !j.prompt) bad.push(`${lv.label}: ${short(j.error?.message ?? r.status)}`);
    } catch (e) { bad.push(`${lv.label}: ${short(e.message)}`); }
  }
  row('template', 'Its template takes the app\'s request', !bad.length, bad.length ? bad.join('; ') : `at ${['thinking off', ...levels.map((l) => l.label)].join(', ')}: the instructions and all ${tools.length} tools`);
}

if (url && !stopping) {
  const a = await ask(url, 'Reply with just the word: ready', { maxTokens: 64 }).catch((e) => ({ error: e.message }));
  const ok = !a.error && /ready/i.test(a.text) && !TAGS.test(a.text) && !a.reasoning.trim();
  row('answer', 'A plain answer, thinking off', ok, a.error ? a.error : `"${short(a.text, 60)}"${a.reasoning.trim() ? ` · but it thought: "${short(a.reasoning, 60)}"` : ''}${TAGS.test(a.text) ? ' · a tag was left in the answer' : ''} · ${a.secs.toFixed(1)} s`);
}

if (url && !stopping) {
  const a = await ask(url, CALL_ASK).catch((e) => ({ error: e.message }));
  const ok = !a.error && readsPackage(a.call);
  row('call-off', 'A tool call, thinking off', ok, a.error ? a.error : a.call ? `${a.call.name}(${short(a.call.args, 60)}) · ${a.call.how}` : `no call; it said "${short(a.text, 80)}"`, { how: a.call?.how ?? null });
}

for (const lv of levels) {
  if (!url || stopping) break;
  const a = await ask(url, CALL_ASK, { thinking: true, effort: lv.id, maxTokens: 4096 }).catch((e) => ({ error: e.message }));
  const leak = !a.error && (TAGS.test(a.text.replace(/<\/?ifm\|tool_calls?>[\s\S]*$/, '')) || TAGS.test(a.reasoning));
  const ok = !a.error && readsPackage(a.call) && a.reasoning.trim().length > 0 && !leak;
  const tokens = Math.round(a.reasoning?.length / 3.6 || 0);
  row(`call-${lv.id}`, `A tool call at ${lv.label}, its thinking apart`, ok, a.error ? a.error : `${a.call ? `${a.call.name}(${short(a.call.args, 50)}) · ${a.call.how}` : 'no call'} · thought about ${tokens} tokens${a.reasoning.trim() ? '' : ' (none came apart)'}${leak ? ' · a tag was left in the open' : ''} · ${a.secs.toFixed(1)} s`, { how: a.call?.how ?? null, thinkTokens: tokens });
}

if (url && !stopping && levels.length) {
  // A question that needs far more thinking than the cap, so the cap has to end it: the server
  // ends the thinking with its message (--reasoning-budget-message) and the model must answer.
  const top = levels.at(-1);
  const a = await ask(url, 'What is 48317 × 29673? Work it out digit by digit in your thinking and check every step twice before you answer. Then answer with just the number.', { thinking: true, effort: top.id, thinkCap: CAP, maxTokens: 2048 }).catch((e) => ({ error: e.message }));
  const tokens = Math.round(a.reasoning?.length / 3.6 || 0);
  const said = /I have thought enough/.test(a.reasoning ?? '') || /I have thought enough/.test(a.text ?? '');
  const reached = said || tokens >= CAP * 0.9;
  // Ended at the cap (a little over is the closing message), and it went on: an answer, or a
  // tool call (with the app's tools it often acts, e.g. Bash to work the sum out; seen 30 Sep 2026).
  const went = a.text?.trim() ? `answered "${short(a.text, 40)}"` : a.call ? `called ${a.call.name} (${a.call.how})` : 'said nothing';
  const ok = !a.error && reached && tokens <= CAP * 1.6 + 40 && (a.text.trim().length > 0 || Boolean(a.call));
  row('cap', `The thinking cap stops it (${CAP} tokens at ${top.label})`, ok, a.error ? a.error : `${reached ? `the cap ended its thinking at about ${tokens} tokens${said ? ' (the server\'s closing message is in it)' : ''}` : `not shown: it stopped thinking by itself at about ${tokens} tokens, under the cap`}, then ${went} · ${a.secs.toFixed(1)} s`, { thinkTokens: tokens, capSaid: said });
}

const other = model.templateKwargs?.tool_call_format ? ['json', 'xml', 'xml_typed'].find((f) => f !== model.templateKwargs.tool_call_format) : null;
if (url && !stopping && other) {
  const m = { ...model, templateKwargs: { ...model.templateKwargs, tool_call_format: other } };
  const a = await ask(url, CALL_ASK, { m }).catch((e) => ({ error: e.message }));
  row('format', `Its other tool-call format (${other})`, !a.error && readsPackage(a.call), a.error ? a.error : a.call ? `${a.call.name}(${short(a.call.args, 60)}) · ${a.call.how}` : `no call; it said "${short(a.text, 80)}"`, { how: a.call?.how ?? null });
}

let speed = null;
if (url && !stopping) {
  // Reading: the app's instructions and tools, not cached. Writing: a small module, thinking off.
  const r = await ask(url, 'Say OK.', { maxTokens: 8, extra: { cache_prompt: false } }).catch(() => null);
  const w = await ask(url, 'Write a JavaScript module money.mjs that exports formatMoney(cents, currency) and parseMoney(text), with a short comment on each. Only the code.', { maxTokens: 400, extra: { cache_prompt: false } }).catch(() => null);
  speed = { read: r?.timings?.prompt_per_second ? +r.timings.prompt_per_second.toFixed(1) : null, write: w?.timings?.predicted_per_second ? +w.timings.predicted_per_second.toFixed(1) : null, readTokens: r?.timings?.prompt_n ?? null, writeTokens: w?.timings?.predicted_n ?? null };
  row('speed', 'Reading and writing speed', null, `reads ${speed.read ?? '?'} tokens a second (${speed.readTokens ?? '?'} tokens of instructions and tools) · writes ${speed.write ?? '?'} (${speed.writeTokens ?? '?'} tokens of code)`, { speed });
}

if (srv) { try { await srv.stop(); } catch {} }
const judged = rows.filter((r) => r.pass !== null);
const passed = judged.filter((r) => r.pass).length;
const full = !stopping && rows.some((r) => r.id === 'speed');
const pass = full && passed === judged.length;
const secs = (Date.now() - t0) / 1000;
const look = args.includes('--no-record');
const docs = !look && existsSync(DOCS_DIR);
const summary = {
  model: model.id, name: model.name, engine: engineOf(model).tag, code: codeLabel(), started: new Date(t0).toISOString(), finished: new Date().toISOString(), secs,
  ctx, passed, total: judged.length, pass, stopped: !full, memory, speed, cap: CAP,
  page: docs ? `tests/agentic-coder-model-check-${model.id}-${stamp}.html` : '',
};
writeFileSync(join(out, 'rows.json'), JSON.stringify(rows, null, 2));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
if (look) console.log('a look only: no results page, no line in the test record');
else if (docs) { writePage(out, rows, summary); console.log(`results page: ${summary.page}`); }
else console.log(`no results page: the DOCS folder is not here (${DOCS_DIR})`);
if (!look) recordTest({
  kind: 'other', name: 'New model check', model: model.id, ctx, passed, total: judged.length, secs, part: !full,
  result: !full ? 'stopped' : pass ? 'pass' : 'fail',
  note: `${passed} of ${judged.length} checks on ${model.name} (${engineName})${speed ? `; reads ${speed.read ?? '?'} tokens/s, writes ${speed.write ?? '?'}` : ''}${memory ? `; took ${memory.takenGB} GB` : ''}. Failed: ${judged.filter((r) => !r.pass).map((r) => r.name).join('; ') || 'none'}.`,
  raw: relative(root, out), page: summary.page,
});
console.log(`New model check on ${model.name}: ${passed} of ${judged.length} · ${pass ? 'PASSED' : full ? 'FAILED' : 'STOPPED'}`);
process.exit(0);
