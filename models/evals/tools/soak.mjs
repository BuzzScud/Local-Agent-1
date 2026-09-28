// Start-up and memory soak with the real model.
//  A. Cold starts: start the server, restore (or read) the warm-up, say hello,
//     stop — N times. Does the restore happen every time, and how fast?
//  B. One long conversation (questions that make it read big files) that fills
//     the 32k memory, sampling the server's memory, the Mac's free memory and
//     swap every 30 s. Does it stay under the estimate; does the Mac swap?
//     With --fill the conversation is not trimmed until it holds --fill-to
//     tokens (default 30,000 of 32,768), then a side request (sorting, a
//     try) runs next to it: does the full memory still answer both?
//   node models/evals/tools/soak.mjs [--starts 10] [--minutes 40] [--fill] [--fill-to 30000] [--out file.json]
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, modelFolder } from '../../index.mjs';
import { ModelServer } from '../../index.mjs';
import { needBytes, availableBytes } from '../../index.mjs';
import { warmUp } from '../../index.mjs';
import { runHeadless, Agent, systemPrompt, projectNotes, gitSummary, SESSION_MARK, toolSchemas, complete } from '../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..'); // the repo
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[DEFAULT_MODEL];
const gb = (b) => Math.round(b / 1e7) / 100;
const swapUsed = () => { try { const t = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' }); return Number(/used = ([\d.]+)M/.exec(t)?.[1] ?? 0); } catch { return null; } };
const freePct = () => { try { return Number(/free percentage: (\d+)%/.exec(execFileSync('memory_pressure', { encoding: 'utf8' }))?.[1]); } catch { return null; } };
const out = { at: new Date().toISOString(), estimateGb32k: gb(needBytes(model, 32768)), starts: [], conversation: { turns: [], samples: [] } };

// A. Cold starts
const project = mkdtempSync(join(tmpdir(), 'agentic-soak-'));
cpSync(join(root, 'terminal', 'demo-project'), join(project, 'demo'), { recursive: true });
for (let i = 1; i <= Number(opt('starts', 10)); i++) {
  const srv = new ModelServer(model);
  const t0 = Date.now();
  let row = { n: i };
  try {
    const st = await srv.start({ ctx: 32768, share: false });
    row.loadSecs = (Date.now() - t0) / 1000;
    const system = systemPrompt({ cwd: join(project, 'demo'), notes: projectNotes(join(project, 'demo')).text, git: gitSummary(join(project, 'demo')) });
    const t1 = Date.now();
    const w = await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model, system, tools: toolSchemas(), thinking: false, slot: 0 });
    row.warmSecs = (Date.now() - t1) / 1000;
    row.restored = w.restored;
    if (w.fallback) row.fallback = w.fallback;
    const t2 = Date.now();
    const r = await runHeadless({ prompt: 'hello', cwd: join(project, 'demo'), url: srv.url, model, thinking: false, ctx: 32768, slots: st.slots > 1 ? { main: 0, side: 1 } : undefined });
    row.replySecs = (Date.now() - t2) / 1000;
    row.reply = r.finalText.slice(0, 80);
    // What happened on the way, so a blank or slow reply can be explained.
    row.blank = !r.finalText.trim();
    row.steps = r.log.filter((e) => e.type === 'tool').map((e) => `${e.label}(${String(e.arg ?? '').slice(0, 60)})${e.error ? ' ✗' : ''}`);
    row.notes = r.log.filter((e) => e.type === 'note').map((e) => e.text.slice(0, 120));
    row.reason = r.reason;
    row.totalSecs = (Date.now() - t0) / 1000;
    row.footprintGb = gb(srv.footprintBytes());
  } catch (e) { row.error = String(e.message ?? e); }
  await srv.stop();
  out.starts.push(row);
  console.log(`start ${i}: ${row.error ? `ERROR ${row.error}` : `load ${row.loadSecs}s · warm-up ${row.warmSecs}s (${row.restored ? 'restored' : 'read'}) · hello ${row.replySecs}s · total ${row.totalSecs}s`}`);
}

// B. One long conversation that fills the memory
const src = join(project, 'agentic-coder');
mkdirSync(src);
for (const [from, to] of [['terminal/src', 'src'], ['terminal/test', 'test'], ['README.md', 'README.md'], ['package.json', 'package.json']]) cpSync(join(root, from), join(src, to), { recursive: true });
const srv = new ModelServer(model);
const st = await srv.start({ ctx: 32768, share: false });
const system = systemPrompt({ cwd: src, notes: projectNotes(src).text, git: gitSummary(src) });
await warmUp({ sessionMark: SESSION_MARK, url: srv.url, model, system, tools: toolSchemas(), thinking: false, slot: 0 });
const fill = args.includes('--fill');
const fillTo = Number(opt('fill-to', 30000));
const agent = new Agent({ url: srv.url, model, cwd: src, system, thinking: false, ctx: 32768, mode: 'plan', flows: true, slots: st.slots > 1 ? { main: 0, side: 1 } : undefined, ask: async () => ({ choice: 'no' }), ...(fill ? { trimAt: 0.99 } : {}) });
out.conversation.fill = fill ? { target: fillTo } : null;
const events = [];
for (const t of ['note', 'compacted', 'tool']) agent.on(t, (e) => events.push({ type: t, ...e, at: Date.now() }));
const swap0 = swapUsed();
const sample = () => out.conversation.samples.push({ at: Date.now(), serverGb: gb(srv.footprintBytes()), totalGb: gb(srv.footprintBytes() + model.bytes), freePct: freePct(), swapMb: swapUsed(), availableGb: gb(availableBytes()), ctxUsed: agent.ctxUsed });
sample();
const timer = setInterval(sample, 30_000);
const QUESTIONS = [
  'Read src/app/App.jsx and explain, step by step, what happens when the app starts.',
  'Read src/agent/agent.mjs and explain how one turn of the tool loop works.',
  'Read src/flows/change.mjs and explain the test-first path.',
  'Read src/flows/fix.mjs and explain how a fix is tried and checked.',
  'Read src/headless.mjs and src/agent/client.mjs: how does a request reach the model and come back?',
  'Read src/app/screen.jsx: what does the /model picker look like and which keys does it use?',
  'Read src/tools/edit.mjs: how does Edit forgive small mistakes?',
  'Read test/app.test.mjs: which screens are tested, and how?',
  'Read src/flows/index.mjs: which requests go to which path?',
  'Read src/agent/tools.mjs: list every tool and what it does.',
  'Read src/flows/tries.mjs and src/flows/units.mjs: how are big files handled?',
  'Read README.md and say what is out of date, if anything.',
  'Summarize everything you have read in this conversation in ten bullet points.',
  'Which three parts of this code would you simplify first, and why?',
];
const deadline = Date.now() + Number(opt('minutes', 40)) * 60_000;
const stop = new AbortController();
const stopTimer = setTimeout(() => stop.abort(), deadline - Date.now());
let peakCtx = 0;
for (const q of QUESTIONS) {
  if (Date.now() > deadline) break;
  if (fill && peakCtx >= fillTo) break;
  const t0 = Date.now();
  let error = null;
  try { await agent.send(q, { signal: stop.signal }); } catch (e) { error = String(e.message ?? e); }
  if (stop.signal.aborted) error = error ?? 'stopped at the time limit';
  out.conversation.turns.push({ q: q.slice(0, 70), secs: Math.round((Date.now() - t0) / 1000), ctxUsed: agent.ctxUsed, error, notes: events.filter((e) => e.type === 'note' && e.at >= t0).map((e) => e.text.slice(0, 120)), compacted: events.some((e) => e.type === 'compacted' && e.at >= t0) });
  peakCtx = Math.max(peakCtx, agent.ctxUsed);
  console.log(`turn: ${q.slice(0, 50)}… ${Math.round((Date.now() - t0) / 1000)}s ctx ${agent.ctxUsed}${error ? ` ERROR ${error}` : ''}`);
}
out.conversation.peakCtx = peakCtx;
// Full: does a side request (the kind sorting and tries make) still work next
// to it, and does the conversation still answer?
if (fill) {
  const f = out.conversation.fill;
  f.reached = peakCtx;
  sample();
  const t1 = Date.now();
  try {
    const r = await complete({ url: srv.url, model, slot: st.slots > 1 ? 1 : undefined, system: 'You answer in one word.', user: 'Say ok.', maxTokens: 8 });
    f.side = { ok: true, secs: (Date.now() - t1) / 1000, text: r.text.trim().slice(0, 40) };
  } catch (e) { f.side = { ok: false, secs: (Date.now() - t1) / 1000, error: String(e.message ?? e).slice(0, 300) }; }
  const t2 = Date.now();
  const before = events.length;
  try {
    await agent.send('In one sentence: which file did you read first in this conversation?', { signal: AbortSignal.timeout(10 * 60_000) });
    f.after = { ok: true, secs: (Date.now() - t2) / 1000, ctxUsed: agent.ctxUsed, notes: events.slice(before).filter((e) => e.type === 'note').map((e) => e.text.slice(0, 120)) };
  } catch (e) { f.after = { ok: false, secs: (Date.now() - t2) / 1000, error: String(e.message ?? e).slice(0, 300) }; }
  sample();
  console.log(`fill: reached ${peakCtx} tokens · side request ${f.side.ok ? `ok ${f.side.secs}s` : `FAILED ${f.side.error}`} · next question ${f.after.ok ? `ok ${f.after.secs}s` : `FAILED ${f.after.error}`}`);
}
clearInterval(timer);
clearTimeout(stopTimer);
sample();
await srv.stop();
out.conversation.swapGrowthMb = swapUsed() - swap0;
out.conversation.peakTotalGb = Math.max(...out.conversation.samples.map((s) => s.totalGb));
out.conversation.toolErrors = events.filter((e) => e.type === 'tool' && e.error).length;
const file = opt('out', join(modelFolder(model), 'results', `soak-${out.at.replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`peak ${out.conversation.peakTotalGb} GB (estimate ${out.estimateGb32k}) · swap +${out.conversation.swapGrowthMb} MB · saved ${file}`);
