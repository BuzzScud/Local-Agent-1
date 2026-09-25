// Start-up and memory soak with the real model.
//  A. Cold starts: start the server, restore (or read) the warm-up, say hello,
//     stop — N times. Does the restore happen every time, and how fast?
//  B. One long conversation (questions that make it read big files) that fills
//     the 32k memory, sampling the server's memory, the Mac's free memory and
//     swap every 30 s. Does it stay under the estimate; does the Mac swap?
//   node evals/soak.mjs [--starts 10] [--minutes 40] [--out file.json]
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL } from '../src/server/models.mjs';
import { ModelServer } from '../src/server/server.mjs';
import { needBytes, availableBytes } from '../src/server/memory.mjs';
import { warmUp } from '../src/server/warmup.mjs';
import { runHeadless } from '../src/headless.mjs';
import { Agent } from '../src/agent/agent.mjs';
import { systemPrompt, projectNotes, gitSummary } from '../src/agent/prompt.mjs';
import { toolSchemas } from '../src/agent/tools.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const model = MODELS[DEFAULT_MODEL];
const gb = (b) => Math.round(b / 1e7) / 100;
const swapUsed = () => { try { const t = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' }); return Number(/used = ([\d.]+)M/.exec(t)?.[1] ?? 0); } catch { return null; } };
const freePct = () => { try { return Number(/free percentage: (\d+)%/.exec(execFileSync('memory_pressure', { encoding: 'utf8' }))?.[1]); } catch { return null; } };
const out = { at: new Date().toISOString(), estimateGb32k: gb(needBytes(model, 32768)), starts: [], conversation: { turns: [], samples: [] } };

// A. Cold starts
const project = mkdtempSync(join(tmpdir(), 'bonsai-soak-'));
cpSync(join(root, 'demo-project'), join(project, 'demo'), { recursive: true });
for (let i = 1; i <= Number(opt('starts', 10)); i++) {
  const srv = new ModelServer(model);
  const t0 = Date.now();
  let row = { n: i };
  try {
    const st = await srv.start({ ctx: 32768, share: false });
    row.loadSecs = (Date.now() - t0) / 1000;
    const system = systemPrompt({ cwd: join(project, 'demo'), notes: projectNotes(join(project, 'demo')).text, git: gitSummary(join(project, 'demo')) });
    const t1 = Date.now();
    const w = await warmUp({ url: srv.url, model, system, tools: toolSchemas(), thinking: false, slot: 0 });
    row.warmSecs = (Date.now() - t1) / 1000;
    row.restored = w.restored;
    if (w.fallback) row.fallback = w.fallback;
    const t2 = Date.now();
    const r = await runHeadless({ prompt: 'hello', cwd: join(project, 'demo'), url: srv.url, model, thinking: false, ctx: 32768, slots: st.slots > 1 ? { main: 0, side: 1 } : undefined });
    row.replySecs = (Date.now() - t2) / 1000;
    row.reply = r.finalText.slice(0, 80);
    row.totalSecs = (Date.now() - t0) / 1000;
    row.footprintGb = gb(srv.footprintBytes());
  } catch (e) { row.error = String(e.message ?? e); }
  await srv.stop();
  out.starts.push(row);
  console.log(`start ${i}: ${row.error ? `ERROR ${row.error}` : `load ${row.loadSecs}s · warm-up ${row.warmSecs}s (${row.restored ? 'restored' : 'read'}) · hello ${row.replySecs}s · total ${row.totalSecs}s`}`);
}

// B. One long conversation that fills the memory
const src = join(project, 'bonsai-code');
mkdirSync(src);
for (const p of ['src', 'test', 'README.md', 'package.json']) cpSync(join(root, p), join(src, p), { recursive: true });
const srv = new ModelServer(model);
const st = await srv.start({ ctx: 32768, share: false });
const system = systemPrompt({ cwd: src, notes: projectNotes(src).text, git: gitSummary(src) });
await warmUp({ url: srv.url, model, system, tools: toolSchemas(), thinking: false, slot: 0 });
const agent = new Agent({ url: srv.url, model, cwd: src, system, thinking: false, ctx: 32768, mode: 'plan', flows: true, slots: st.slots > 1 ? { main: 0, side: 1 } : undefined, ask: async () => ({ choice: 'no' }) });
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
  'Read src/server/server.mjs and src/server/warmup.mjs: how is the model server started and warmed up?',
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
for (const q of QUESTIONS) {
  if (Date.now() > deadline) break;
  const t0 = Date.now();
  let error = null;
  try { await agent.send(q, { signal: stop.signal }); } catch (e) { error = String(e.message ?? e); }
  if (stop.signal.aborted) error = error ?? 'stopped at the time limit';
  out.conversation.turns.push({ q: q.slice(0, 70), secs: Math.round((Date.now() - t0) / 1000), ctxUsed: agent.ctxUsed, error, notes: events.filter((e) => e.type === 'note' && e.at >= t0).map((e) => e.text.slice(0, 120)), compacted: events.some((e) => e.type === 'compacted' && e.at >= t0) });
  console.log(`turn: ${q.slice(0, 50)}… ${Math.round((Date.now() - t0) / 1000)}s ctx ${agent.ctxUsed}${error ? ` ERROR ${error}` : ''}`);
}
clearInterval(timer);
clearTimeout(stopTimer);
sample();
await srv.stop();
out.conversation.swapGrowthMb = swapUsed() - swap0;
out.conversation.peakTotalGb = Math.max(...out.conversation.samples.map((s) => s.totalGb));
out.conversation.toolErrors = events.filter((e) => e.type === 'tool' && e.error).length;
const file = opt('out', join(here, `soak-${out.at.replace(/[:.]/g, '-')}.json`));
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`peak ${out.conversation.peakTotalGb} GB (estimate ${out.estimateGb32k}) · swap +${out.conversation.swapGrowthMb} MB · saved ${file}`);
