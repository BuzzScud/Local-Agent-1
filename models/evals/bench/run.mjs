// Plays the practice tasks against the real model and checks each result.
//   node models/evals/bench/run.mjs [--think on|off|both] [--effort medium|high] [--set 28 | --only 1,3] [--ctx 32768] [--reps 3] [--out dir] [--stop-at HH:MM] [--memory] [--no-rank] [--prompt old|new] [--thinking old|new] [--no-record]
// --set 28: the 28 practice tasks that grade a model (29, the notes page, is an extra); its line in
// the test record is a full run of the 28. --set hard: the 10 hard ones (30–39, 2 Oct 2026) for the
// bigger models on a service. --only picks tasks by number (a part of the set).
// --instructions local|remote|auto: which set of prompt files the model gets (agent/prompt-files.mjs;
// auto, the default, is remote for a --remote model). Instructions local vs remote
// (models/evals/tools/remote-rules-ab.mjs) runs both.
// Control-C (or SIGTERM, the hub's Stop) ends the task under way, skips the rest, and still saves
// and records what ran, as stopped.
//     [--helpers all|off|scout,medic,oracle,sentry] [--flows on|off] [--way app|model]
//     [--remote <address> --remote-model <name> [--big on|off] [--remote-ctx <tokens>]] [--lean] [--keep]
// --remote claude: the Claude API as /remote saved it (settings.json "remotes.claude", its key from the
// Keychain), --remote-model for another Claude model. A paid model's cost is kept for each task
// (usd, from the cost meter: terminal/src/agent/spend.mjs) and added up on the summary line.
// --helpers: the context helpers (terminal/src/agent/helpers.mjs), by codename
// or by id (named,tests,rag,lsp); default what
// AGENTIC_HELPERS says (unset: all). "off" is the way before them. With the code
// search on, each task's copy is indexed before its clock starts.
// --flows off: no focused paths, every task step by step (where the model
// makes every Read and test run itself).
// --way model: the model decides, as in Claude Code (terminal/src/agent/way.mjs): no sorting, no
// reading ahead, its own tools (Map, CodeSearch, Rename, TestFirst, Remember), several calls a
// reply, and none of the app's checks (the hooks are off; AGENTIC_HOOKS turns some on). --way app
// (the default): as before. The row and summary.json name it; Who decides old vs new
// (models/evals/tools/way-ab.mjs) runs both.
// A task with a home.txt runs with its project as the home folder (HOME points
// there for the run), so a request about the Desktop works as in the app.
// --remote: the tasks on a model on another machine (an Ollama service or any OpenAI-compatible
// one, AGENTIC_REMOTE_KEY for its key) instead of one started here, at the context it is loaded at.
// --big on|off: big-model mode (models/runtime/remote.mjs BIG_HARNESS) for it, with /effort's
// defaults for that model, as the app runs it; off: today's defaults (models/evals/tools/big-ab.mjs runs both).
// --memory: with Agentic Coder's memory on (a throwaway one, empty at the start):
// the rules that are always read, facts brought back, and a save after each
// task, once its files were checked. Does the memory make anything worse?
// --prompt old|new: the system prompt from before 30 Sep 2026 (AGENTIC_PROMPT=old:
// no Work habits, notes unlabelled, 6,000 characters of notes) or today's; the
// record line and summary.json name it. --no-record: no line in the test record
// (Prompt old vs new, models/evals/tools/prompt-ab.mjs, records one line for both).
// --thinking old|new: how thinking is spent at High. old (AGENTIC_THINK=old): every try thinks and
// nothing steps down, as before 30 Sep 2026; new: think when it pays (terminal/src/flows/llm.mjs)
// and the step-down past half the task's time (agent.mjs; each task's time is its limit, --timeout).
// Thinking old vs new (models/evals/tools/think-ab.mjs) records one line for both.
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MODELS, DEFAULT_MODEL, ModelServer, modelFolder, Embedder, embedderReady, connectRemote } from '../../index.mjs';
import { runHeadless, openMemory, CLAUDE_RULES, helpersOn, CODENAMES, codenameOf, testSettings, readLimits, MODEL_HOOKS, timeLine, slowReads, loadSettings, windowSpend, LEAN_AUTO } from '../../../terminal/index.mjs';
// A run from the Tests page's control panel: its Context and Thinking cap (the rest reaches runHeadless).
const panel = testSettings();
import { recordTest, codeLabel } from '../record.mjs';
import { pickTasks } from './pick-tasks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const thinkModes = { on: [true], off: [false], both: [false, true] }[opt('think', 'both')];
const only = opt('only', null)?.split(',');
const ctx = Number(opt('ctx', panel?.context ?? 32768));
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
const budget = opt('budget', panel?.thinking ?? null);
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
const wayArg = opt('way', null);
// --lean: the lean harness (terminal agent/way.mjs): the model decides, and none of the app's checks run.
const leanArg = args.includes('--lean');
// --keep: each run's project as the model left it is kept beside the results (<task>-think-on[-repN]-files/), so a
// part that failed can be read afterwards (5 Oct 2026: tests that passed on wrong behaviour could not be looked at).
const keepArg = args.includes('--keep');
if (wayArg && !['app', 'model'].includes(wayArg)) { console.error(`--way app or model, not "${wayArg}"`); process.exit(1); }
// A run from the Arena's panel can set Who decides too (its row reaches runHeadless); --way wins.
const wayUsed = wayArg ?? (panel?.way === 'model' ? 'model' : 'app');
const promptArg = opt('prompt', null);
if (promptArg && !['old', 'new'].includes(promptArg)) { console.error(`--prompt old or new, not "${promptArg}"`); process.exit(1); }
if (promptArg === 'old') process.env.AGENTIC_PROMPT = 'old';
else if (promptArg === 'new') delete process.env.AGENTIC_PROMPT;
const promptUsed = process.env.AGENTIC_PROMPT === 'old' ? 'old' : 'new';
const instructionsArg = opt('instructions', null);
if (instructionsArg && !['local', 'remote', 'auto'].includes(instructionsArg)) { console.error(`--instructions local, remote or auto, not "${instructionsArg}"`); process.exit(1); }
// Auto unless named, so the choice saved in settings.json never changes what a run measures.
process.env.AGENTIC_INSTRUCTIONS = instructionsArg ?? 'auto';
const setArg = opt('set', null);
const thinkingArg = opt('thinking', null);
if (thinkingArg && !['old', 'new'].includes(thinkingArg)) { console.error(`--thinking old or new, not "${thinkingArg}"`); process.exit(1); }
if (thinkingArg === 'old') process.env.AGENTIC_THINK = 'old';
else if (thinkingArg === 'new') delete process.env.AGENTIC_THINK;
const thinkingUsed = process.env.AGENTIC_THINK === 'old' ? 'old' : 'new';
const noRecord = args.includes('--no-record');
// --claude (with --memory): Claude's notes are looked in as well, where they are.
const withClaude = withMemory && args.includes('--claude');
const memoryHome = withMemory ? mkdtempSync(join(tmpdir(), 'agentic-eval-memory-')) : null;
const saves = [];
// One small model for the whole run, stopped with it (the memory's, and the code search's).
const embedder = (withMemory || helpers.has('rag')) && embedderReady() ? new Embedder() : null;
let tasks;
try { tasks = pickTasks(readdirSync(join(here, 'tasks')), { only, set: opt('set', null) }); } catch (e) { console.error(e.message); process.exit(1); }
// --remote: a model on another machine stands in for the server here (nothing loads on this Mac).
const remoteAt = opt('remote', null);
const bigArg = opt('big', 'on');
if (!['on', 'off'].includes(bigArg)) { console.error(`--big on or off, not "${bigArg}"`); process.exit(1); }
let conn = null;
if (remoteAt) {
  const claude = remoteAt === 'claude' ? loadSettings().remotes?.claude : null;
  if (remoteAt === 'claude' && !claude) { console.error('--remote claude: no Claude API is saved in /remote'); process.exit(1); }
  const r = claude ? { ...claude, use: true, ...(opt('remote-model', '') ? { model: opt('remote-model') } : {}) }
    : { use: true, source: 'openai', kind: 'openai', connect: 'http', address: remoteAt, model: opt('remote-model', ''), key: Boolean(process.env.AGENTIC_REMOTE_KEY), ...(Number(opt('remote-ctx', 0)) ? { context: Number(opt('remote-ctx')) } : {}) };
  try { conn = await connectRemote(r); } catch (e) { console.error(`the remote at ${remoteAt} did not answer: ${e.message}`); process.exit(1); }
  if (bigArg === 'off') delete conn.model.harness;
}
const runOn = conn ? conn.model : model;
// The app's /effort defaults for that model (big-model mode's rows when it has it); a local run passes none, as before.
const limitsUsed = conn ? readLimits({}, runOn) : undefined;
const server = conn ? { url: conn.url, start: async () => ({ slots: 1, ctx: conn.ctx }), stop: async () => conn.stop() } : new ModelServer(model);
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
const ctxUsed = conn ? conn.ctx : ctx;
if (conn) console.log(`on the remote: ${conn.info.model} at ${remoteAt}, ${Math.round(conn.ctx / 1024)}k context; big-model mode ${runOn.harness ? 'on' : 'off'} (who decides ${limitsUsed.way}, ${limitsUsed.steps} steps, ${limitsUsed.tries} tries, ${limitsUsed.outputLines} output lines, Read ${runOn.harness?.read.whole ?? 150} lines whole)`);
console.log(`server up on ${server.url}, ctx ${ctxUsed}, thinking budget ${model.thinkingBudget}${temp ? `, temperature ${temp}` : ''}; helpers: ${codes(', ')}; focused paths: ${flowsOn ? 'on' : 'off'}; prompt: ${promptUsed}; thinking: ${thinkingUsed}; who decides: ${wayUsed}`);
const results = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const tdir = opt('out', conn ? join(here, '..', '..', 'remote', 'results', 'runs', stamp) : join(modelFolder(base), 'results', 'runs', stamp));
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
      const spent0 = windowSpend().usd;
      let run;
      try {
        run = await runHeadless({ prompt, cwd: work, url: server.url, model: runOn, thinking, effort, ctx: ctxUsed, lean: leanArg || LEAN_AUTO, limits: limitsUsed, subagents: Boolean(conn), hooks: conn ? MODEL_HOOKS : undefined, autoApprove: true, answers, signal: ac.signal, slots, warm: !!slots, rank: withRank, flows: flowsOn, helpers, embedder, prewarm: true, thinkBudgetSecs: perTaskMs / 1000, way: wayArg ?? undefined,
          memory: withMemory ? { home: memoryHome, save: 'after', embedder, claude: withClaude } : false,
          onEvent: (type, ev) => { if (type === 'tool') process.stdout.write(`    ${ev.error ? '✗' : ev.given ? '+' : '·'} ${ev.label}(${String(ev.arg).slice(0, 50)})\n`); if (type === 'note') process.stdout.write(`    ! ${ev.text}\n`); if (type === 'context' && ev.title === 'Helpers') process.stdout.write(`    + helpers brought ${ev.items.filter((x) => !x.skipped).length} (${ev.tokens} tokens: ${byCode(ev.items)})${ev.items.some((x) => x.skipped) ? `; left out: ${ev.items.filter((x) => x.skipped).map((x) => `${x.text} (${x.skipped})`).join('; ')}` : ''}\n`); } });
      } catch (e) { run = { reason: `crash: ${e.message}`, finalText: '', secs: perTaskMs / 1000, steps: 0, toolErrors: 0, outTokens: 0 }; }
      clearTimeout(timer);
      taskAc = null;
      // Stopped part way: this task did not get its chance, so it is left out, not failed.
      if (stopping) { if (asHome) process.env.HOME = realHome; rmSync(dir, { recursive: true, force: true }); break runs; }
      writeFileSync(join(dir, 'answer.txt'), run.finalText ?? '');
      writeFileSync(join(dir, 'asked.txt'), (run.asked ?? []).map((a) => a.question).join('\n'));
      writeFileSync(join(tdir, `${task}-think-${thinking ? 'on' : 'off'}${reps > 1 ? `-rep${rep}` : ''}.json`), JSON.stringify({ task, thinking, reason: run.reason, messages: run.messages ?? [], log: run.log ?? [], timeline: run.timeline ?? [] }, null, 1));
      const check = spawnSync('/bin/zsh', [join(here, 'tasks', task, 'check.sh')], { cwd: work, encoding: 'utf8', timeout: 60_000 });
      if (asHome) process.env.HOME = realHome;
      const pass = check.status === 0;
      const route = (run.log ?? []).find((e) => e.type === 'route')?.kind ?? (run.way === 'model' ? 'model decides' : 'step by step');
      const tries = (run.log ?? []).filter((e) => e.type === 'tries-done').map((e) => `${e.label}: ${(e.marks ?? []).join('')}`);
      const row = { task, thinking, level: thinking ? (effort ?? 'medium') : 'off', route, tries, asked: run.asked ?? [], rep, pass, why: pass ? '' : (check.stdout + check.stderr).trim().split('\n').pop(), reason: run.reason, secs: Math.round(run.secs), steps: run.steps, toolErrors: run.toolErrors, outTokens: run.outTokens, replies: run.replies ?? null, reads: run.reads ?? null, readFirst: run.readFirst ?? null, thinkTokens: run.thinkTokens ?? null, stuckAsks: run.stuckAsks ?? null, tps: run.tps ? Math.round(run.tps * 10) / 10 : null, answer: (run.finalText ?? '').slice(0, 300), checkOut: `${check.stdout ?? ''}${check.stderr ?? ''}`.trim().slice(-1500),
        // The model's own work (a helper's step is not one) and what the helpers brought.
        flows: flowsOn, way: run.way ?? wayUsed, helpers: run.helpers ?? [...helpers], ownSteps: run.ownSteps ?? null, modelCalls: run.modelCalls ?? null, helperItems: run.helperItems ?? 0, helperTokens: run.helperTokens ?? 0, indexed: run.indexed ?? null,
        // Past half its time it thought only briefly (the step-down, agent.mjs).
        steppedDown: Boolean(run.steppedDown),
        // Where its time went: writing, reading, tools, the app (terminal/src/agent/timing.mjs).
        time: run.time ?? null,
        // The lean harness (on Claude by itself unless --lean or a choice says otherwise: way.mjs LEAN_AUTO).
        lean: Boolean(run.lean),
        // What it cost on a paid service (null on a free one).
        usd: conn?.model?.price || windowSpend().usd > spent0 ? Math.round((windowSpend().usd - spent0) * 10000) / 10000 : null };
      // The memory's save comes after the check: its own files are not the task's.
      if (withMemory && run.save) { const s = await run.save(); if (s) { row.saved = s.added.map((f) => `${f.kind}: ${f.text}`); row.refused = s.refused.map((r) => r.why); row.saveSecs = Math.round(s.secs); saves.push(s); } }
      results.push(row);
      console.log(`${pass ? 'PASS' : 'FAIL'}  think=${thinking ? 'on ' : 'off'}${reps > 1 ? ` rep${rep}` : ''}  ${task.padEnd(16)} ${String(row.secs).padStart(4)}s  ${row.steps} steps (${row.ownSteps ?? '?'} its own)  ${row.modelCalls ?? '?'} model calls  ${row.toolErrors} errors${row.helperTokens ? `  +${row.helperTokens} helper tokens` : ''}  ${row.reads ?? '-'} reads  ~${row.thinkTokens ?? '-'} thinking${row.usd != null ? `  $${row.usd.toFixed(2)}` : ''}  ${row.why}`);
      if (row.time) { console.log(`      ${timeLine(row.time)}`); for (const r of slowReads(run.timeline ?? [])) console.log(`        slow read · ${r}`); }
      if (keepArg) { try { cpSync(work, join(tdir, `${task}-think-${thinking ? 'on' : 'off'}${reps > 1 ? `-rep${rep}` : ''}-files`), { recursive: true, filter: (src) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(src) }); } catch { /* the results stand without them */ } }
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  await embedder?.stop({ keep: false }).catch(() => {});
  await server.stop();
}
const file = join(tdir, 'summary.json');
if (withMemory) console.log(`memory: ${saves.length} saves, ${saves.reduce((n, s) => n + s.added.length, 0)} facts saved, ${saves.length ? Math.round(saves.reduce((n, s) => n + s.secs, 0) / saves.length) : 0} s a save`);
writeFileSync(file, JSON.stringify({ remote: conn ? { address: remoteAt, model: conn.info.model, big: Boolean(runOn.harness) } : null, lean: leanArg, memory: withMemory, helpers: [...helpers], flows: flowsOn, way: limitsUsed?.way ?? wayUsed, prompt: promptUsed, instructions: instructionsArg ?? 'auto', set: setArg, thinkingWay: thinkingUsed, ctx: ctxUsed, reps, effort: effort ?? null, temp: temp ? Number(temp) : null, budget: model.thinkingBudget, stoppedAt: pastStop() ? stopAt : null, stopped: stopping, results }, null, 2));
for (const thinking of thinkModes) {
  const rs = results.filter((r) => r.thinking === thinking);
  const usd = rs.some((r) => r.usd != null) ? rs.reduce((s, r) => s + (r.usd ?? 0), 0) : null;
  console.log(`thinking ${thinking ? 'on ' : 'off'}: ${rs.filter((r) => r.pass).length}/${rs.length} passed, ${Math.round(rs.reduce((s, r) => s + r.secs, 0))}s total, ${rs.reduce((s, r) => s + (r.modelCalls ?? 0), 0)} model calls, ${rs.reduce((s, r) => s + (r.ownSteps ?? 0), 0)} own steps${usd != null ? `, $${usd.toFixed(2)}` : ''}`);
  const failed = rs.filter((r) => !r.pass).map((r) => r.task);
  if (rs.length && !noRecord) recordTest({ kind: 'tasks', model: conn ? `remote:${conn.info.model}` : base.id, name: `The ${only ? `${tasks.length} picked` : tasks.length}${setArg === 'hard' ? ' hard' : ''} practice tasks${conn ? ` on ${conn.info.model} (remote), big-model mode ${runOn.harness ? 'on' : 'off'}` : ''}${reps > 1 ? `, ${reps} runs each` : ''}${withMemory ? `, with the memory on${withClaude ? " and Claude's notes" : ''}` : ''}, helpers ${codes('+')}${flowsOn ? '' : ', step by step'}${promptArg ? `, ${promptArg} prompt` : ''}${thinkingArg ? `, ${thinkingArg} thinking` : ''}${wayUsed === 'model' ? ', model decides' : ''}${leanArg || rs.some((r) => r.lean) ? ', lean harness' : ''}${instructionsArg && instructionsArg !== 'auto' ? `, ${instructionsArg} instructions` : ''}`, code: codeLabel(join(here, '..', '..', '..')), effort: thinking ? (effort ?? 'medium') : 'low', ctx: ctxUsed,
    passed: rs.length - failed.length, total: rs.length, secs: rs.reduce((s, r) => s + r.secs, 0), result: pastStop() || stopping ? 'stopped' : undefined, part: Boolean(only), note: failed.length ? `failed: ${failed.join(', ')}` : '', raw: tdir.replace(`${join(here, '..', '..', '..')}/`, '') });
}
console.log(`saved ${file}`);
// Nothing is left to wait for (a connection kept open to a server would hold the run).
process.exit(0);
