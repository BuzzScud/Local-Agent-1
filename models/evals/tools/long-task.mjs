// Where does the time go in a long task, and what does the model read twice?
// (Step 3 probe, 29 Sep 2026: "long tasks get slow" and "forgets what it read".)
// Runs one long, read-heavy question with the real model the way `coding -p`
// does (runHeadless, the limits /effort saved, the helpers, the saved warm-up),
// in a copy of terminal/src, and records every request the agent sends with the
// server's own numbers: words it reused from memory (cache_n), words it read
// new (prompt_n), words it wrote (predicted_n) and how long each took. The
// memory events (notes, trims, summaries) and every tool call are kept beside
// them. Unlike reread.mjs it needs no chat-template markers, so it works on
// any model.
//   node models/evals/tools/long-task.mjs --model gemma [--minutes 20] [--out file.json] [--record]
// One big model at a time: it refuses to start while another is loaded.
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, contextCheck, hasDraft, recordTest, codeLabel } from '../../index.mjs';
import { runHeadless, loadSettings, readLimits, modelWithLimits } from '../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const base0 = MODELS[opt('model', DEFAULT_MODEL)];
if (!base0) { console.error(`no model "${opt('model')}"; one of: ${Object.keys(MODELS).join(', ')}`); process.exit(2); }

// The same question for every model: it needs five files, two of them long, so
// a 32k memory fills before the answer is done.
export const TASK = 'Explain, step by step, what happens from the moment I press Enter in the prompt box until the model\'s reply is on the screen. Read the files involved (src/cli.jsx, src/app/App.jsx, src/agent/agent.mjs, src/agent/client.mjs and src/agent/tools.mjs) and name the functions in the order they run, with the file and line number of each.';

// Your limits as /effort saved them (context, thinking cap, steps, trim points),
// and your effort; the same for every model, so the runs compare.
const settings = loadSettings(root);
const limits = readLimits(settings, base0);
const model = modelWithLimits(base0, limits);
const ctx = Number(opt('ctx', limits.context || 32768));
const thinking = opt('effort', settings.effort ?? 'high') !== 'low';
const effort = thinking ? 'high' : undefined;

// Looked up read-only (scanServers would also stop servers it finds left over).
const running = spawnSync('ps', ['-axwwo', 'command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /^\/\S*llama-server\s/.test(l));
const big = Object.values(MODELS).filter((m) => running.some((l) => l.includes(`/${m.file} `)));
if (big.length) { console.error(`refused: ${big.map((m) => m.name).join(', ')} is loaded (one big model at a time). Quit Agentic Coder, run coding stop, then try again.`); process.exit(3); }
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
console.log(`${model.name} · ${Math.round(ctx / 1024)}k memory · ${thinking ? 'High' : 'Low'} effort · thinking cap ${model.thinkingBudget.toLocaleString('en-US')}`);
// Right after another model stopped, its memory takes up to a minute to come back.
if (!contextCheck(model, ctx, { draft: hasDraft(model) }).fits) console.log('waiting for memory to free up (up to 2 minutes)…');
for (let i = 0; i < 24 && !contextCheck(model, ctx, { draft: hasDraft(model) }).fits; i++) await new Promise((r) => setTimeout(r, 5000));
const fit = contextCheck(model, ctx, { draft: hasDraft(model) });
if (!fit.fits) { console.error(`refused: ${fit.note}`); process.exit(4); }

const base = mkdtempSync(join(tmpdir(), 'agentic-longtask-'));
const src = join(base, 'agentic-coder');
mkdirSync(src);
for (const [from, to] of [['terminal/src', 'src'], ['README.md', 'README.md'], ['package.json', 'package.json']]) cpSync(join(root, from), join(src, to), { recursive: true });

// Keeps the Mac awake until this run ends (its own process group, so Control-C
// in Terminal does not stop it early).
try { spawn('caffeinate', ['-i', '-w', String(process.pid)], { detached: true, stdio: 'ignore' }).unref(); } catch {}
console.log('loading the model…');
const l0 = Date.now();
const srv = new ModelServer(model);
const stopAll = async () => { try { await srv.stop(); } catch {} };
// Control-C once stops the question and keeps what it has; twice quits at once.
const ac = new AbortController();
process.on('SIGINT', async () => {
  if (!ac.signal.aborted) { console.log('\nstopping: saving what it has so far (Control-C again quits without saving)…'); ac.abort(); return; }
  await stopAll(); process.exit(130);
});
process.on('uncaughtException', async (e) => { console.error(e); await stopAll(); process.exit(1); });
process.on('unhandledRejection', () => {}); // a stopped request's leftovers
const st = await srv.start({ ctx, share: false, lingerSecs: 0 });
const slots = st.slots > 1 ? { main: 0, side: 1 } : undefined;
console.log(`loaded in ${Math.round((Date.now() - l0) / 1000)} s · getting ready (its instructions, the code search)…`);

// Every request to the model's server, with the server's timings. A streamed
// reply is split in two: the agent reads one copy, this reads the other.
const t0 = Date.now();
const sent = [];
const calls = new Map(); // tool_call id → { name, args, outChars, firstReq }
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith(srv.url) || init?.method !== 'POST') return realFetch(url, init);
  let body = {};
  try { body = JSON.parse(init.body ?? '{}'); } catch {}
  const rec = { i: sent.length, path: u.slice(srv.url.length).split('?')[0], slot: body.id_slot ?? null, tools: Boolean(body.tools), toolChoice: body.tool_choice ?? null, messages: body.messages?.length ?? null, start: Date.now() - t0 };
  sent.push(rec);
  for (const m of body.messages ?? []) {
    for (const c of m.tool_calls ?? []) if (!calls.has(c.id)) calls.set(c.id, { name: c.function?.name, args: c.function?.arguments, firstReq: rec.i });
    if (m.role === 'tool' && calls.has(m.tool_call_id) && calls.get(m.tool_call_id).outChars == null) calls.get(m.tool_call_id).outChars = String(m.content ?? '').length;
  }
  const res = await realFetch(url, init);
  const keep = (text) => { rec.end = Date.now() - t0; const m = [...String(text).matchAll(/"timings":(\{[^}]*\})/g)].pop(); if (m) { try { rec.timings = JSON.parse(m[1]); } catch {} } };
  if (!res.body) { rec.end = Date.now() - t0; return res; }
  const [a, b] = res.body.tee();
  new Response(b).text().then(keep, () => { rec.end = Date.now() - t0; rec.stopped = true; });
  return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers });
};

const minutes = Number(opt('minutes', 20));
const timer = setTimeout(() => ac.abort(), minutes * 60_000);
const events = [];
let r = null;
let error = null;
console.log(`asking the question · stops by itself after ${minutes} minutes · Control-C stops early and keeps what it has`);
try {
  r = await runHeadless({
    prompt: TASK, cwd: src, url: srv.url, model, ctx, thinking, effort, flows: true, slots, warm: Boolean(slots), limits,
    memory: false, rank: true, prewarm: true, signal: ac.signal,
    onEvent: (type, ev) => {
      const at = Date.now() - t0;
      if (type === 'tool') events.push({ at, type, id: ev.id, name: ev.name, arg: String(ev.arg ?? '').slice(0, 200), given: Boolean(ev.given), error: Boolean(ev.error) });
      else if (type === 'note') events.push({ at, type, text: ev.text });
      else if (type === 'compacted') events.push({ at, type, inPlace: Boolean(ev.inPlace), secs: ev.secs ?? null, freed: ev.freed ?? null, summary: String(ev.summary ?? '').slice(0, 1500) });
      else if (type === 'context') events.push({ at, type, title: ev.title, tokens: ev.tokens ?? null, items: ev.items?.length ?? null });
      if (type === 'tool') process.stdout.write(`${mmss(at)}  ${ev.given ? '(given) ' : ''}${ev.name} ${String(ev.arg ?? '').slice(0, 80)}\n`);
      if (type === 'note' || type === 'compacted') process.stdout.write(`${mmss(at)}  · ${ev.text ?? 'notes written; carrying on from them'}\n`);
    },
  });
} catch (e) { error = e.message; }
clearTimeout(timer);
await new Promise((res) => setTimeout(res, 1500)); // the last stream's timings
globalThis.fetch = realFetch;
await stopAll();

const wall = (Date.now() - t0) / 1000;
const out = {
  at: new Date().toISOString(), code: codeLabel(root), model: model.id, name: model.name, ctx, thinking, effort: effort ?? 'low', thinkingBudget: model.thinkingBudget,
  limits: { trimAt: limits.trimAt, summarizeAt: limits.summarizeAt, steps: limits.steps, tries: limits.tries }, helper: st.draft ?? hasDraft(model), slots: st.slots,
  task: TASK, minutes, wall, error, aborted: ac.signal.aborted,
  result: r && { reason: r.reason, secs: r.secs, finalText: r.finalText, replies: r.replies, reads: r.reads, readFirst: r.readFirst, thinkTokens: r.thinkTokens, outTokens: r.outTokens, ctxUsed: r.ctxUsed, modelCalls: r.modelCalls, helperTokens: r.helperTokens, indexed: r.indexed },
  requests: sent, calls: [...calls].map(([id, c]) => ({ id, ...c })), events,
};
const file = opt('out', join(modelFolder(model), 'results', 'long-task-2026-09-29', `run-${out.at.replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
const main = sent.filter((q) => q.tools && q.timings);
const sum = (k) => main.reduce((s, q) => s + (q.timings?.[k] ?? 0), 0);
const full = events.filter((e) => e.type === 'compacted').length;
console.log(`${out.aborted ? 'stopped' : error ? 'failed' : 'done'} after ${mmss(wall * 1000)} · ${main.length} steps · reading ${mmss(sum('prompt_ms'))} · writing ${mmss(sum('predicted_ms'))} · memory filled ${full} time${full === 1 ? '' : 's'}${error ? ` · ${error}` : ''}`);
console.log(`saved ${relative(root, file)}`);
if (args.includes('--record')) {
  recordTest({ kind: 'other', name: 'Long task: where the time goes (step 3)', code: out.code, model: model.id, effort: out.effort, ctx, secs: wall,
    result: out.aborted ? 'stopped' : error ? 'fail' : 'pass', note: `${main.length} steps; ${Math.round(sum('prompt_ms') / 1000)} s reading, ${Math.round(sum('predicted_ms') / 1000)} s writing; ${events.filter((e) => e.type === 'compacted').length} notes when memory filled`, raw: relative(root, file) });
}
process.exit(0);
