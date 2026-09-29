// Plays the practice tasks against the real model and checks each result.
//   node models/evals/bench/run.mjs [--think on|off|both] [--effort medium|high] [--set 28 | --only 1,3] [--ctx 32768] [--reps 3] [--out dir] [--stop-at HH:MM] [--memory] [--no-rank]
// --set 28: the 28 practice tasks that grade a model (29, the notes page, is an extra); its line in
// the test record is a full run of the 28. --only picks tasks by number (a part of the set).
// Control-C (or SIGTERM, the hub's Stop) ends the task under way, skips the rest, and still saves
// and records what ran, as stopped.
//     [--helpers all|off|scout,medic,oracle,sentry] [--flows on|off]
// --helpers: the context helpers (terminal/src/agent/helpers.mjs), by codename
// or by id (named,tests,rag,lsp); default what
// AGENTIC_HELPERS says (unset: all). "off" is the way before them. With the code
// search on, each task's copy is indexed before its clock starts.
// --flows off: no focused paths, every task step by step (where the model
// makes every Read and test run itself).
// A task with a home.txt runs with its project as the home folder (HOME points
// there for the run), so a request about the Desktop works as in the app.
// --memory: with Agentic Coder's memory on (a throwaway one, empty at the start):
// the rules that are always read, facts brought back, and a save after each
// task, once its files were checked. Does the memory make anything worse?
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, Embedder, embedderReady } from '../../index.mjs';
import { runHeadless, openMemory, CLAUDE_RULES, helpersOn, CODENAMES, codenameOf } from '../../../terminal/index.mjs';
import { recordTest, codeLabel } from '../record.mjs';
import { pickTasks } from './pick-tasks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const thinkModes = { on: [true], off: [false], both: [false, true] }[opt('think', 'both')];
const only = opt('only', null)?.split(',');
const ctx = Number(opt('ctx', 32768));
const perTaskMs = Number(opt('timeout', 900)) * 1000; // the 27B writes ~10 tokens/s
const reps = Number(opt('reps', 1));
const effort = opt('effort', undefined); // with --think on: medium (default) or high
// Stop starting new tasks after this time (HH:MM, local), for overnight runs.
const stopAt = opt('stop-at', null);
const pastStop = () => { if (!stopAt) return false; const [h, m] = stopAt.split(':').map(Number); const now = new Date(); const t = new Date(now); t.setHours(h, m, 0, 0); if (t < new Date(Date.now() - 12 * 3600e3)) t.setDate(t.getDate() + 1); return now >= t && now - t < 12 * 3600e3; };
// --model <id>: which model folder to run (default: the app's default model).
const base = MODELS[opt('model', DEFAULT_MODEL)];
if (!base) { console.error(`no model ${opt('model')}; models: ${Object.keys(MODELS).join(', ')}`); process.exit(1); }
// --temp / --budget try other settings without touching the app's defaults.
const temp = opt('temp', null);
const budget = opt('budget', null);
const model = { ...base,
  sampling: temp ? { ...base.sampling, temperature: Number(temp) } : base.sampling,
  thinkingSampling: temp ? { ...base.thinkingSampling, temperature: Number(temp) } : base.thinkingSampling,
  thinkingBudget: budget ? Number(budget) : base.thinkingBudget };

const withMemory = args.includes('--memory');
// --no-rank: no ranking of files by meaning before the first step (by words only).
const withRank = !args.includes('--no-rank');
const helpers = helpersOn(opt('helpers', undefined));
// The helpers on, by codename (Scout, Medic, Oracle, Sentry) for the lines printed and the test record.
const codes = (sep) => [...helpers].map((h) => CODENAMES[h]).join(sep) || 'off';
// What the Helpers line brought, counted by codename: "Scout 1, Medic 2".
const byCode = (items) => Object.entries(Object.groupBy(items.filter((x) => !x.skipped), (x) => codenameOf(x.from))).map(([c, xs]) => `${c} ${xs.length}`).join(', ');
const flowsOn = opt('flows', 'on') !== 'off';
// --claude (with --memory): Claude's notes are looked in as well, where they are.
const withClaude = withMemory && args.includes('--claude');
const memoryHome = withMemory ? mkdtempSync(join(tmpdir(), 'agentic-eval-memory-')) : null;
const saves = [];
// One small model for the whole run, stopped with it (the memory's, and the code search's).
const embedder = (withMemory || helpers.has('rag')) && embedderReady() ? new Embedder() : null;
let tasks;
try { tasks = pickTasks(readdirSync(join(here, 'tasks')), { only, set: opt('set', null) }); } catch (e) { console.error(e.message); process.exit(1); }
const server = new ModelServer(model);
// Stop: the task under way is cut short (and left out), the rest are skipped, the model is
// stopped, and what ran is saved and recorded as stopped. A second Control-C quits at once.
let stopping = false;
let taskAc = null;
const stop = (sig) => {
  if (stopping) { if (sig === 'SIGINT') server.stop().finally(() => process.exit(130)); return; }
  stopping = true;
  console.log(`\nstopping: the task under way ends now and the rest are skipped; what ran is saved and recorded as stopped${sig === 'SIGINT' ? ' (Control-C again quits without saving)' : ''}`);
  taskAc?.abort();
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
const started = await server.start({ ctx });
const slots = started.slots > 1 ? { main: 0, side: 1 } : undefined;
console.log(`server up on ${server.url}, ctx ${ctx}, thinking budget ${model.thinkingBudget}${temp ? `, temperature ${temp}` : ''}; helpers: ${codes(', ')}; focused paths: ${flowsOn ? 'on' : 'off'}`);
const results = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tdir = opt('out', join(modelFolder(base), 'results', 'runs', stamp));
mkdirSync(tdir, { recursive: true });
try {
  runs: for (const thinking of thinkModes) for (let rep = 1; rep <= reps; rep++) {
    for (const task of tasks) {
      if (stopping) break runs;
      if (pastStop()) { console.log(`stop time ${stopAt} reached; not starting ${task}`); continue; }
      const dir = mkdtempSync(join(tmpdir(), `agentic-eval-${task}-`));
      const work = join(dir, 'project');
      cpSync(join(here, 'tasks', task, 'project'), work, { recursive: true });
      writeFileSync(join(dir, 'started'), '');
      spawnSync('sleep', ['1']);
      const prompt = readFileSync(join(here, 'tasks', task, 'task.txt'), 'utf8').trim();
      // answers.json: [{ match: regex, reply }] — what "the user" says to Agentic Coder's questions.
      const answerRows = existsSync(join(here, 'tasks', task, 'answers.json')) ? JSON.parse(readFileSync(join(here, 'tasks', task, 'answers.json'), 'utf8')) : [];
      const answers = (q) => { const hit = answerRows.find((r) => new RegExp(r.match, 'i').test(q)); process.stdout.write(`    ? ${q}\n      → ${hit ? hit.reply : '(no answer given)'}\n`); return hit ? hit.reply : 'I do not know. If the files do not tell you, stop and tell me what you found; do not invent anything.'; };
      // With Claude's notes, the fifteen lines boiled down from them are in the instructions, as in the app.
      if (withClaude) { try { openMemory(work, { home: memoryHome, rules: CLAUDE_RULES }); } catch {} }
      // A task about the home folder (home.txt): its project is the home folder for the run.
      const asHome = existsSync(join(here, 'tasks', task, 'home.txt'));
      const realHome = process.env.HOME;
      if (asHome) process.env.HOME = work;
      const ac = new AbortController();
      taskAc = ac;
      if (stopping) ac.abort(); // a stop that came while the task was set up
      const timer = setTimeout(() => ac.abort(), perTaskMs);
      let run;
      try {
        run = await runHeadless({ prompt, cwd: work, url: server.url, model, thinking, effort, ctx, autoApprove: true, answers, signal: ac.signal, slots, warm: !!slots, rank: withRank, flows: flowsOn, helpers, embedder, prewarm: true,
          memory: withMemory ? { home: memoryHome, save: 'after', embedder, claude: withClaude } : false,
          onEvent: (type, ev) => { if (type === 'tool') process.stdout.write(`    ${ev.error ? '✗' : ev.given ? '+' : '·'} ${ev.label}(${String(ev.arg).slice(0, 50)})\n`); if (type === 'note') process.stdout.write(`    ! ${ev.text}\n`); if (type === 'context' && ev.title === 'Helpers') process.stdout.write(`    + helpers brought ${ev.items.filter((x) => !x.skipped).length} (${ev.tokens} tokens: ${byCode(ev.items)})${ev.items.some((x) => x.skipped) ? `; left out: ${ev.items.filter((x) => x.skipped).map((x) => `${x.text} (${x.skipped})`).join('; ')}` : ''}\n`); } });
      } catch (e) { run = { reason: `crash: ${e.message}`, finalText: '', secs: perTaskMs / 1000, steps: 0, toolErrors: 0, outTokens: 0 }; }
      clearTimeout(timer);
      taskAc = null;
      // Stopped part way: this task did not get its chance, so it is left out, not failed.
      if (stopping) { if (asHome) process.env.HOME = realHome; rmSync(dir, { recursive: true, force: true }); break runs; }
      writeFileSync(join(dir, 'answer.txt'), run.finalText ?? '');
      writeFileSync(join(dir, 'asked.txt'), (run.asked ?? []).map((a) => a.question).join('\n'));
      writeFileSync(join(tdir, `${task}-think-${thinking ? 'on' : 'off'}${reps > 1 ? `-rep${rep}` : ''}.json`), JSON.stringify({ task, thinking, reason: run.reason, messages: run.messages ?? [], log: run.log ?? [] }, null, 1));
      const check = spawnSync('/bin/zsh', [join(here, 'tasks', task, 'check.sh')], { cwd: work, encoding: 'utf8', timeout: 60_000 });
      if (asHome) process.env.HOME = realHome;
      const pass = check.status === 0;
      const route = (run.log ?? []).find((e) => e.type === 'route')?.kind ?? 'step by step';
      const tries = (run.log ?? []).filter((e) => e.type === 'tries-done').map((e) => `${e.label}: ${(e.marks ?? []).join('')}`);
      const row = { task, thinking, level: thinking ? (effort ?? 'medium') : 'off', route, tries, asked: run.asked ?? [], rep, pass, why: pass ? '' : (check.stdout + check.stderr).trim().split('\n').pop(), reason: run.reason, secs: Math.round(run.secs), steps: run.steps, toolErrors: run.toolErrors, outTokens: run.outTokens, replies: run.replies ?? null, reads: run.reads ?? null, readFirst: run.readFirst ?? null, thinkTokens: run.thinkTokens ?? null, stuckAsks: run.stuckAsks ?? null, tps: run.tps ? Math.round(run.tps * 10) / 10 : null, answer: (run.finalText ?? '').slice(0, 300),
        // The model's own work (a helper's step is not one) and what the helpers brought.
        flows: flowsOn, helpers: run.helpers ?? [...helpers], ownSteps: run.ownSteps ?? null, modelCalls: run.modelCalls ?? null, helperItems: run.helperItems ?? 0, helperTokens: run.helperTokens ?? 0, indexed: run.indexed ?? null };
      // The memory's save comes after the check: its own files are not the task's.
      if (withMemory && run.save) { const s = await run.save(); if (s) { row.saved = s.added.map((f) => `${f.kind}: ${f.text}`); row.refused = s.refused.map((r) => r.why); row.saveSecs = Math.round(s.secs); saves.push(s); } }
      results.push(row);
      console.log(`${pass ? 'PASS' : 'FAIL'}  think=${thinking ? 'on ' : 'off'}${reps > 1 ? ` rep${rep}` : ''}  ${task.padEnd(16)} ${String(row.secs).padStart(4)}s  ${row.steps} steps (${row.ownSteps ?? '?'} its own)  ${row.modelCalls ?? '?'} model calls  ${row.toolErrors} errors${row.helperTokens ? `  +${row.helperTokens} helper tokens` : ''}  ${row.reads ?? '-'} reads  ~${row.thinkTokens ?? '-'} thinking  ${row.why}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  await embedder?.stop({ keep: false }).catch(() => {});
  await server.stop();
}
const file = join(tdir, 'summary.json');
if (withMemory) console.log(`memory: ${saves.length} saves, ${saves.reduce((n, s) => n + s.added.length, 0)} facts saved, ${saves.length ? Math.round(saves.reduce((n, s) => n + s.secs, 0) / saves.length) : 0} s a save`);
writeFileSync(file, JSON.stringify({ memory: withMemory, helpers: [...helpers], flows: flowsOn, ctx, reps, effort: effort ?? null, temp: temp ? Number(temp) : null, budget: model.thinkingBudget, stoppedAt: pastStop() ? stopAt : null, stopped: stopping, results }, null, 2));
for (const thinking of thinkModes) {
  const rs = results.filter((r) => r.thinking === thinking);
  console.log(`thinking ${thinking ? 'on ' : 'off'}: ${rs.filter((r) => r.pass).length}/${rs.length} passed, ${Math.round(rs.reduce((s, r) => s + r.secs, 0))}s total, ${rs.reduce((s, r) => s + (r.modelCalls ?? 0), 0)} model calls, ${rs.reduce((s, r) => s + (r.ownSteps ?? 0), 0)} own steps`);
  const failed = rs.filter((r) => !r.pass).map((r) => r.task);
  if (rs.length) recordTest({ kind: 'tasks', model: base.id, name: `The ${only ? `${tasks.length} picked` : tasks.length} practice tasks${reps > 1 ? `, ${reps} runs each` : ''}${withMemory ? `, with the memory on${withClaude ? " and Claude's notes" : ''}` : ''}, helpers ${codes('+')}${flowsOn ? '' : ', step by step'}`, code: codeLabel(join(here, '..', '..', '..')), effort: thinking ? (effort ?? 'medium') : 'low', ctx,
    passed: rs.length - failed.length, total: rs.length, secs: rs.reduce((s, r) => s + r.secs, 0), result: pastStop() || stopping ? 'stopped' : undefined, part: Boolean(only), note: failed.length ? `failed: ${failed.join(', ')}` : '', raw: tdir.replace(`${join(here, '..', '..', '..')}/`, '') });
}
console.log(`saved ${file}`);
// Nothing is left to wait for (a connection kept open to a server would hold the run).
process.exit(0);
