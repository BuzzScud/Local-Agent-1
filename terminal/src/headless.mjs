// Runs one prompt start to finish without the terminal UI: used by the
// practice-task runner and by `coding -p "…"`.
import { Agent } from './agent/agent.mjs';
import { UserHooks } from './agent/user-hooks.mjs';
import { applyLimits, applySearch, testLimits } from './app/limits.mjs';
import { systemPrompt, projectNotes, gitSummary, SESSION_MARK, notesRoom } from './agent/prompt.mjs';
import { wayEnv, wayOf, hooksOn, hooksEnv, leanFrom, leanEnv } from './agent/way.mjs';
import { warmUp, Embedder, embedderReady } from '../../models/index.mjs';
import { openMemory } from './agent/facts.mjs';
import { saveLessons, worthSaving } from './agent/lessons.mjs';
import { helpersOn } from './agent/helpers.mjs';
import { llmCalls } from './flows/llm.mjs';
import { AgentsRun } from './agent/agents-run.mjs';
import { agentDriver } from './agent/agents-driver.mjs';

// memory: true uses the memory (facts brought back, lessons saved when the
// run ends); { home, embedder, save } sets where it lives and how. Off by
// default, so a practice run is the same every time. save: 'after' leaves
// the save to the caller (the result's save()), for a run whose files are
// checked first.
// helpers: the context helpers (agent/helpers.mjs); by default what
// AGENTIC_HELPERS says (unset: all). embedder: the small model for the code
// search when the memory is off. prewarm: the code search is built before the
// prompt (not timed), as the app has it built by the time you ask.
// images: pictures to send with the prompt; canSee: the server can look at them (its vision add-on).
// way: who decides ('app' or 'model', agent/way.mjs); given (or AGENTIC_WAY), it wins over the
// limits' Who decides row. hooks: the app's checks on while the model decides (AGENTIC_HOOKS wins).
export async function runHeadless({ images = [], canSee = false, visionOn = null, prompt, cwd, url, model, thinking, effort, ctx, autoApprove = false, approve, answers, signal, onEvent = () => {}, flows = true, slots, warm = false, memory = false, limits = null, rank = true, helpers, embedder = null, prewarm = false, permissions = null, design, thinkBudgetSecs, way, hooks, web = null, subagents = false, agents = false, mode = null, askUser = null, more = null, keepProgress = false, mcp = null, userHooks = false, workRoom = 0, steering = null, maxSteps = null, rewind = null, lean = false }) {
  // memory.claude: true (or a folder) also brings Claude's notes that fit a request.
  const mem = memory ? { embedder: embedder ?? (embedderReady() ? new Embedder() : null), save: true, ...(memory === true ? {} : memory) } : null;
  if (mem) { try { openMemory(cwd, { home: mem.home }); } catch { /* the run goes on without it */ } }
  // Files ranked by meaning before the first step (agent/rank.mjs), as in the
  // app with the memory on; rank: false leaves it to the request's words. The
  // same small model serves the code search of the context helpers.
  const on = helpersOn(helpers);
  const own = !mem?.embedder && !embedder && (rank || on.has('rag')) && embedderReady() ? new Embedder() : null;
  const ranker = rank && !mem?.embedder ? embedder ?? own : null;
  const system = systemPrompt({ cwd, notes: projectNotes(cwd, notesRoom(), { memory: Boolean(mem), home: mem?.home }).text, git: gitSummary(cwd) });
  // Your own hooks (user-hooks.mjs): coding -p passes userHooks: true; the benches pass none, so their runs measure the same every time.
  let hooksNote = () => {};
  const ownHooks = userHooks && process.env.AGENTIC_USER_HOOKS !== 'off' ? new UserHooks({ cwd, onNote: (text, tone) => hooksNote(text, tone) }) : null;
  const agent = new Agent({
    userHooks: ownHooks,
    // mode: the window's mode, for a loop's run (/loop); otherwise auto-approve is Accept edits, and Manual without it.
    url, model, cwd, system, thinking, effort, ctx, mode: mode ?? (autoApprove ? 'edits' : 'ask'), flows: flows !== false, slots, memory: mem, ranker, keepProgress,
    // A loop's run: notes typed meanwhile, read at its next step, and the copies its undo puts back (rewind.mjs).
    steering, rewind,
    // Its time for thinking (agent.mjs): the practice runs give their time limit; else as the app.
    ...(thinkBudgetSecs != null ? { thinkBudgetSecs } : {}),
    // What you saved with /permissions (coding -p passes it; the practice bench does not, so its runs measure the same every time).
    permissions,
    // The design examples and the layout check (agent/design.mjs): as saved
    // (coding -p passes them). The benches pass none, so their runs measure
    // the same every time: off, unless AGENTIC_DESIGN / AGENTIC_LAYOUT say on.
    design: design ?? { auto: false, check: false },
    helpers: on, embedder: mem?.embedder ?? embedder ?? own,
    way: wayOf(way ?? wayEnv() ?? 'app'), hooks: hooksEnv() !== undefined ? hooksOn(hooksEnv()) : hooksOn(hooks ?? []),
    // The lean harness (way.mjs): --lean or settings.json, AGENTIC_LEAN over both.
    lean: leanEnv() !== undefined ? leanFrom() : Boolean(lean),
    // The web tools (/web) and helpers (the Agent tool): coding -p passes them; the benches pass
    // none, so their runs measure the same every time. mcp: the hub of the user's MCP servers
    // (coding -p passes it; a tool asks, or --yes allows; a project's own servers are never
    // started by a run with nobody there to be asked).
    web, subagents, mcp,
    // Starting over from its notes: the instructions come back from their saved reading.
    rewarm: warm && slots ? (sig) => warmUp({ sessionMark: SESSION_MARK, url, model, system: agent.messages[0].content, tools: agent.tools(), thinking, effort: agent.effort, slot: slots.main, signal: sig }) : undefined,
    // approve(req) → false says no to one request even when auto-approving.
    // answers(question, req) → the reply to one of Agentic Coder's questions (null = no answer);
    // set answers.steers = true to also answer its plans (req.kind 'plan') and check-ins ('checkin').
    // askUser(req) → the answer to anything that asks, from whoever watches the run (a loop's
    // board, app/loop-run.mjs); null leaves it to the rules below.
    ask: async (req) => {
      if (askUser) { const r = await askUser(req); if (r) return r; }
      if (req.name === 'Ask') {
        // A question of an MCP server's own (agent.mjs mcpAsked): answered only by someone who is
        // there; with nobody, it is declined, never guessed.
        if (req.kind === 'mcp') { const text = answers ? await answers(req.args.question, req) : null; return text != null ? { choice: 'answer', text: String(text) } : { choice: 'no' }; }
        // A plan to confirm or a check-in goes to answers only when it steers
        // (answers.steers = true); otherwise the plan is approved and the
        // check-in carries on, as when no one is watching.
        // A "stuck" question with no one to steer is skipped: the run goes on as
        // before (the old limits stop it), so practice results stay comparable.
        if (req.kind === 'stuck' && !answers?.steers) return { choice: 'skip' };
        const steering = req.kind === 'plan' || req.kind === 'checkin' || req.kind === 'stuck';
        if (steering && !answers?.steers) return autoApprove ? { choice: 'answer', text: req.kind === 'plan' ? 'yes' : 'keep going' } : { choice: 'no' };
        const text = answers ? await answers(req.args.question, req) : null;
        if (text != null) return { choice: 'answer', text: String(text) };
        return autoApprove ? { choice: 'answer', text: 'I do not know. If the files do not tell you, stop and tell me what you found; do not invent anything.' } : { choice: 'no' };
      }
      return { choice: autoApprove && (!approve || approve(req)) ? 'yes' : 'no' };
    },
  });
  // /remote's Clean up at (settings.json remoteCleanAt): only for a model on another machine (agent.mjs cleanCap).
  agent.workRoom = workRoom;
  // The limits /effort saved (coding -p passes them; the practice bench does
  // not), with its Search rows: the embedder, the retriever and the reranker.
  // A run from the Tests page's control panel brings its settings (AGENTIC_TEST_SETTINGS) when none are passed.
  limits ??= testLimits(model);
  if (limits) { applyLimits(agent, limits); applySearch(agent, limits); }
  // A loop's own steps a run (its rules) over /effort's Steps per request.
  if (maxSteps) agent.maxSteps = maxSteps;
  // A way given to the run (bench --way, coding -p --way, AGENTIC_WAY) wins over the limits' row.
  if (way ?? wayEnv()) agent.setWay(way ?? wayEnv());
  // coding -p started the server itself: restore (or read) the instructions first (the prompt and tools of its way).
  // The MCP tools are taken before the instructions are read ahead, so that reading holds them.
  await agent.mcpTake().catch(() => {});
  if (warm && slots) await warmUp({ sessionMark: SESSION_MARK, url, model, system: agent.messages[0].content, tools: agent.tools(), thinking, effort: agent.effort, slot: slots.main, signal }).catch(() => {});
  const log = [];
  let finalText = '';
  for (const type of ['assistant', 'tool', 'note', 'todos', 'compacted', 'tries-done', 'route', 'sorted', 'memory', 'context', 'settled', 'steered']) {
    agent.on(type, (ev) => {
      log.push({ type, ...ev, at: Date.now() });
      if (type === 'assistant' && ev.final) finalText = ev.text;
      onEvent(type, ev);
    });
  }
  hooksNote = (text, tone) => agent.emit('note', { text, tone });
  // A step under way (a helper's progress): to onEvent only, not the log.
  agent.on('tool-running', (ev) => onEvent('tool-running', ev));
  // The turn's own counts (steps, reads, thinking): the last turn-end wins.
  let counts = {};
  agent.on('turn-end', (ev) => { counts = ev; });
  // The code search built before the clock starts (a first build of a
  // 40-file project takes ~30 s; the app builds it in the background).
  let indexed = null;
  if (prewarm) {
    const index = agent.codeSearch();
    if (index) { const i0 = Date.now(); await index.build({ signal }); indexed = { parts: index.parts.length, secs: (Date.now() - i0) / 1000, state: index.state }; }
  }
  const calls0 = llmCalls.n;
  const t0 = Date.now();
  agent.canSee = canSee;
  // A picture the model reads by itself: its vision turned on then (coding -p reloads the model).
  // It can look at the screen then too (the Screen tool, offered to a model that can see).
  if (visionOn) { agent.visionOn = () => visionOn(agent); agent.mayLook = () => true; }
  let reason;
  await agent.startSession('startup');
  if (agents) {
    // coding -p --agents: the /agents run (agents-run.mjs) with nobody to ask. The interview and the plan
    // take the first answer, a NO-GO is fixed, a task that will not pass is left open; a step on the stop
    // list is allowed with --yes (autoApprove) and refused without it. Its log comes out as notes.
    const run = new AgentsRun({ request: prompt, driver: agentDriver(agent) });
    let told = 0;
    run.on('state', (s) => {
      while (told < s.log.length) { const e = s.log[told++]; onEvent('note', { text: `/agents · ${e.who}: ${e.text}`, tone: e.tone === 'bad' || e.tone === 'warn' ? 'warn' : 'dim' }); }
      const g = s.gate;
      if (!g || g.seen) return;
      g.seen = true;
      const n = g.kind !== 'stop' || g.title === 'NO-GO' ? 0 : /won't pass/.test(g.title) ? 1 : autoApprove ? 1 : 0;
      onEvent('note', { text: `/agents asks: ${g.title} → ${g.opts[n]}`, tone: 'dim' });
      setTimeout(() => run.answer(n), 0);
    });
    signal?.addEventListener('abort', () => run.stop(), { once: true });
    const s = await run.start();
    reason = s.verdict?.kind === 'go' ? 'done' : 'stopped';
    finalText = [run.verdictLine(), ...(s.report ?? [])].join('\n');
  } else reason = await agent.send(canSee || !images.length ? prompt : `${prompt}\n\n(Pictures were named, but this model is not looking at pictures.)`, { signal, images: canSee && images.length ? images : undefined });
  // more() → a message that arrived while it worked (a note typed to a loop's run), sent when the turn ends.
  if (more && !agents) { for (let next = more(); next != null && !signal?.aborted; next = more()) reason = await agent.send(String(next), { signal }); }
  await agent.endSession('exit');
  // Background jobs end with the run (nothing is left to wake for them).
  const left = agent.jobs.running();
  if (left.length) { agent.jobs.stopAll(); agent.emit('note', { text: `Stopped ${left.length === 1 ? 'a background job' : `${left.length} background jobs`} as the run ended: ${left.map((j) => `${j.id} (${j.command})`).join(', ')}`, tone: 'dim' }); }
  const secs = (Date.now() - t0) / 1000;
  // What the run taught goes into the memory before it ends.
  let saved = null;
  const save = async () => {
    if (!mem || !worthSaving(agent.lessons)) return null;
    try { return await saveLessons({ url, model, slot: slots?.side, cwd, home: mem.home, lessons: agent.lessons, messages: agent.messages, embedder: mem.embedder }); } catch { return null; /* a save that fails never fails the run */ }
  };
  // (When the model decides it saved what it chose with Remember as it worked: no save at the end.)
  if (mem?.save === true && !signal?.aborted && agent.way !== 'model') { saved = await save(); if (saved) onEvent('saved', saved); }
  if (mem?.embedder && !memory?.embedder && !embedder) await mem.embedder.stop({ keep: true }).catch(() => {});
  await own?.stop({ keep: true }).catch(() => {});
  // An embedder or reranker the Search rows made (applySearch) stays loaded for the next run.
  if (agent.embedder && agent.embedder !== own && agent.embedder !== mem?.embedder && agent.embedder !== embedder) await agent.embedder.stop({ keep: true }).catch(() => {});
  await agent.reranker?.stop({ keep: true }).catch(() => {});
  const given = log.filter((e) => e.type === 'context' && e.title === 'Helpers').flatMap((e) => e.items.filter((x) => !x.skipped));
  return {
    saved, save, lessons: agent.lessons,
    reason, finalText, log, messages: agent.messages, secs,
    // How the helpers searched (/effort's Search rows, from the limits given).
    search: { embedder: agent.embedder ? agent.embedder.model?.id ?? 'on' : 'off', retriever: agent.search.retriever, reranker: agent.reranker?.model?.id ?? 'off' },
    steps: log.filter((e) => e.type === 'tool').length,
    // The model's own work: its steps (a helper's step is not one), and every
    // call it answered (the steps, the focused paths' drafts, the checks).
    // (Agentic Coder's own steps: a focused path's, the plan question, "Work in …?", the check it runs at the end.)
    ownSteps: log.filter((e) => e.type === 'tool' && !e.given && !/^(flow|plan|project|check)_/.test(String(e.id ?? ''))).length,
    modelCalls: agent.stats.requests + (llmCalls.n - calls0),
    // Who decided, and the hooks that were on (they run only while the model decides).
    way: agent.way, hooks: agent.lean ? [] : [...agent.hooks], lean: agent.lean,
    helpers: [...on], helperItems: given.length, helperTokens: given.reduce((s, x) => s + (x.tokens ?? 0), 0), indexed,
    asked: log.filter((e) => e.type === 'tool' && e.label === 'Ask').map((e) => ({ question: String(e.arg), answer: e.view?.text ?? null })),
    toolErrors: log.filter((e) => e.type === 'tool' && e.error).length,
    outTokens: agent.stats.outTokens, tps: agent.stats.tps, ctxUsed: agent.ctxUsed,
    replies: counts.steps ?? 0, reads: counts.reads ?? 0, readFirst: counts.readFirst ?? 0, thinkTokens: counts.thinkTokens ?? 0, stuckAsks: counts.stuckAsks ?? 0,
    // Past half its time for thinking, it thought only briefly (agent.mjs steppedDown).
    steppedDown: agent.steppedAt != null,
  };
}
