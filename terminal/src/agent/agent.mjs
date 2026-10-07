// The agent loop: send the conversation to the model, stream what comes
// back, run the tool it asks for (asking you first when needed), feed the
// result back, and repeat until it answers without a tool.
import { EventEmitter } from 'node:events';
import { endpointOf } from '../../../models/index.mjs';
import { focusedInstructions, readInstructions } from './instructions.mjs';
import { EXPLORE_TOOLS, resolvePath, toolSchemas } from './tools.mjs';
import { ownBy, protectedBy, testRunOf } from './permissions.mjs';
import { gitSummary, isHomeFolder, notesRoom, projectNotes, promptSetOf, systemPrompt, testCommand } from './prompt.mjs';
import { lookSecs } from './look.mjs';
import { guidePath, guidesList, harnessOf, readGuides, readHelperAgents, readSkills, rulesSetOf, skillPath, skillsList, toolUseFor } from './prompt-files.mjs';
import { homedir } from 'node:os';
import { isCodeProject } from '../flows/index.mjs';
import { LEAN_AUTO, LEAN_AUTO_NOTE, OPT_IN_HOOKS, hooksOn, leanForModel, leanPrompt, wayOf, wayPrompt } from './way.mjs';
import { SeenFiles } from './seen.mjs';
import { upFrontFor } from './room.mjs';
import { readResults, testsFailed } from '../flows/results.mjs';
import { runCommand } from '../tools/run.mjs';
import { Jobs, took } from '../tools/jobs.mjs';
import { complete } from '../flows/llm.mjs';
import { changedLines } from '../tools/edit.mjs';
import { helpersOn } from './helpers.mjs';
import { useOf } from './helper-models.mjs';
import { CHECK_INS, FULL, HELPER_STEPS, MAX_STEPS, OWN_HELPER_CTX, RESULT_MAX, TRIM_AT, budgetFromEnv, helperPrompt, helperToolFilter, newConversation, tokensOf } from './agent-said.mjs';
export { MAX_CALLS, MCP_BACKS, THINK_BUDGET_SECS, STEP_DOWN_CAP, RESULT_MAX, filesNamed, isLooping, AUTO, asksTheUser, announcesNextStep, claimsAlreadyThere, asksForWork, aboutTheCode, fullPathsIn, filesInAnswer, CHECK_IT, looksGood, wantsCheck, missingParts, claimsAllGood, claimsFound, severalAsks, wantsDesktop, claimsDone, keyLines, namesAFix, KEEP_FROM, keptPart, keptWriteNote, CALL_MARK, beforeCall, leakedThinking, leakedCall, toolCallInText, bareCallInText, safeArgs, READ_TIP, CHECK_INS, helperPrompt, helperToolFilter, requestReminder, planReminder } from './agent-said.mjs';
import { McpPart } from './agent-mcp.mjs';
import { MemoryPart } from './agent-memory.mjs';
import { ReadPart } from './agent-read.mjs';
import { PagesPart } from './agent-pages.mjs';
import { ChecksPart } from './agent-checks.mjs';
import { RoomPart } from './agent-room.mjs';
import { StepPart } from './agent-step.mjs';
import { UndoPart } from './agent-undo.mjs';
import { ModelPart } from './agent-model.mjs';
import { WorkPart } from './agent-work.mjs';

export class Agent extends EventEmitter {
  // whenFull: what happens when the conversation fills the model's memory.
  // 'notes' (the default): it writes down where it is and carries on from
  // its notes. 'trim': old tool output is emptied first (the way before
  // 2026-09-27; AGENTIC_WHEN_FULL=trim).
  // memory: what Agentic Coder remembers from one day to the next (facts.mjs).
  // rewarm: puts the saved reading of the instructions back in the model's
  // memory (the app and `coding -p` pass it), so a conversation that starts
  // over from its notes does not read the instructions again.
  constructor({ url, model, cwd, system, thinking = true, effort, ctx = 32768, mode = 'ask', ask, waitForServer, verify = true, flows = true, maxTries = 8, testTimeoutMs = 120_000, checkIns = CHECK_INS, confirmPlan = true, slots, trimAt = TRIM_AT, fullAt = FULL, maxSteps = MAX_STEPS, bash = null, whenFull = process.env.AGENTIC_WHEN_FULL === 'trim' ? 'trim' : 'notes', rewarm, memory = null, ranker = null, helpers = null, embedder = null, indexDir, search = null, reranker = null, permissions = null, rewind = null, design, thinkBudgetSecs = budgetFromEnv(), way = 'app', hooks = null, web = null, subagents = true, home = homedir(), openPage = null, pageAsk = false, instructions = null, keepProgress = false, mcp = null, userHooks = null, steering = null, lean = false }) {
    super();
    // Who decides (way.mjs): 'app' as before, or 'model'; and the app's checks switched on as
    // hooks for when the model decides (on App they all run, as they always have).
    // The lean harness (way.mjs leanFrom): the model decides, and none of the app's checks run. LEAN_AUTO: on
    // for a Claude model, off for any other, looked at again at each message (leanNow). wayChosen: /effort's
    // Who decides, which comes back when lean goes off.
    this.leanAuto = lean === LEAN_AUTO;
    this.lean = this.leanAuto ? leanForModel(model) : Boolean(lean);
    this.wayChosen = wayOf(way);
    this.way = this.lean ? 'model' : this.wayChosen;
    this.hooks = hooksOn(hooks ?? []);
    // /web: { search: 'off' | 'brave' | 'tavily', fetch, claude } (null: no web tools, as in a practice run).
    this.web = web;
    // The Agent tool (helpers): "subagents": false in settings.json leaves it out.
    this.subagents = subagents !== false;
    // /mcp: the hub of the user's MCP servers (tools/mcp.mjs), or null (a practice run, a test): no MCP tools.
    this.mcp = mcp;
    Object.assign(this, { url, model, cwd, thinking, effort: effort ?? model?.thinkingEffort, ctx, mode, ask, waitForServer, verify, flows, maxTries, testTimeoutMs, checkIns, confirmPlan, trimAt, fullAt, maxSteps, bash, whenFull, rewarm, permissions, thinkBudgetSecs });
    // The small model that ranks files by meaning (rank.mjs): the memory's,
    // or one given on its own (the practice bench runs without the memory).
    this.ranker = ranker;
    // The memory (facts.mjs, recall.mjs): { embedder, home }. Without it
    // nothing is brought back and nothing is learned (tests, practice runs).
    this.memory = memory || null;
    // The context helpers (helpers.mjs): none unless given; the app and
    // `coding -p` pass them (/helpers, AGENTIC_HELPERS). Given, they also
    // switch Read first (prefetchRanked): 1 the files a request names, 3 the
    // files closest by meaning. Not given (tests, other callers), Read first
    // works as it always has.
    this.helpersGiven = helpers != null;
    this.helpers = helpers == null ? new Set() : helpersOn(helpers);
    // The small model that compares meanings: the memory's, shared with the
    // file ranking and the code search.
    this.embedder = embedder ?? memory?.embedder ?? ranker ?? null;
    this.codeIndex = null;
    this.indexDir = indexDir; // where the code search keeps its index (tests: a throwaway folder)
    // /effort's Search rows (search.mjs): Retriever 'meaning' or 'hybrid', and
    // the reranker when it is on (models/runtime/rerank.mjs). Neither given,
    // every search chooses by meaning alone, as it always has.
    this.search = { retriever: 'meaning', ...(search ?? {}) };
    this.reranker = reranker;
    // /rewind (app/rewind.mjs): copies of the project around each message and command.
    this.rewind = rewind;
    // The home folder its Desktop is in (a test gives a folder of its own),
    // and the screen's way to open a finished page in the browser: given by
    // the app only, so coding -p and the tests never open or offer anything
    // (deliverDesktop).
    this.home = home;
    this.openPage = openPage;
    // A loop's run (/loop): changes that leave fewer tests failing, and none newly failing, stay (putBackWhy).
    this.keepProgress = Boolean(keepProgress);
    // steering() → the notes typed to a loop's run while it works (loop-run.mjs): each goes on the end of
    // the next step's result, so it is read now rather than when the turn ends ('steered' says so).
    this.steering = steering;
    // Someone is at the screen to look at a saved page (askPage): the app says so; coding -p,
    // the benches and the tests check pages by themselves, as before.
    this.pageAsk = pageAsk;
    // The design examples and the layout check (design.mjs): settings.json's
    // "design" as saved; AGENTIC_DESIGN, AGENTIC_DESIGN_SETS and AGENTIC_LAYOUT win over it.
    this.designSaved = design ?? {};
    this.lessons = []; // what happened in each turn, for the next save (lessons.mjs)
    // When Agentic Coder started the server itself it has two slots: the
    // conversation stays in 0, side requests (sorting, tries) use 1.
    this.slots = slots ?? null;
    // How this project runs its tests; used to check a change before calling it done.
    this.testCmd = verify ? testCommand(cwd) : null;
    this.messages = [{ role: 'system', content: leanPrompt(wayPrompt(system, this.way), this.lean) }];
    this.conversation = newConversation(); // its own first line on an Ollama service (client.mjs ownStart)
    this.workingInstructions = readInstructions().sections;
    // The instructions set (prompt-files.mjs): a prompt built for the other set than this
    // model's (the app and coding -p build the local one) is built again here, once. A helper
    // gets its parent's row, so the prompt it was given (the parent's set) is kept.
    this.instructionsSet = instructions ?? null;
    this.rulesSetUsed = promptSetOf(system);
    this.promptStampUsed = this.rulesSetUsed === this.rulesSet() ? this.promptStamp() : null;
    if (this.promptStampUsed === null && typeof system === 'string') this.refreshNotes();
    this.allowedPrefixes = new Set();
    this.readFiles = new SeenFiles(); // files read (or written) in this conversation
    // Background commands (Bash with background: true): each one's end is news for the model (jobEnded).
    this.jobs = new Jobs({ onEnd: (job) => this.jobEnded(job) });
    this.jobNews = []; // jobs that ended by themselves, not yet told
    // Your own hooks (user-hooks.mjs UserHooks): commands of yours at seven moments, beside the app's checks.
    this.userHooks = userHooks;
    this.sessionContext = null; // what a SessionStart hook printed, for the next message
    this.todos = null;
    this.ctxUsed = tokensOf(this.messages[0].content) + 1200; // system + tool definitions, until the server reports
    this.busy = false;
    this.sending = false;
    this.stats = { tps: null, pps: null, outTokens: 0, requests: 0 };
  }

  // Which set (prompt-files.mjs rulesSetOf): null follows settings.json "instructions" (auto by
  // default: the remote set for a model on another machine). Read before each message, so a switch
  // of model or of the saved choice applies then. A helper is handed its parent's set.
  instructionsSet = null;
  rulesSet() { return rulesSetOf(this.instructionsSet, this.model); }
  // The memory goes with the rules when it is on, as it did when the conversation started
  // (App.jsx, headless.mjs): a practice run without it never reads the user's own.
  notesFrom() { return { memory: Boolean(this.memory), home: this.memory?.home }; }
  // The prompt of this way: the model's own tool lines when it decides (way.mjs wayPrompt).
  setSystem(system) { this.messages[0] = { role: 'system', content: leanPrompt(wayPrompt(system, this.way), this.lean) }; }
  // The tools the model is offered: the app's eight, and its own five when it decides.
  tools() {
    const agents = this.agentsOn();
    const all = toolSchemas(this.way, this.webTools(), { agents, screen: this.screenOn(), helpers: agents ? this.helperAgents() : [] });
    // CodeSearch only when it can run (4 Oct 2026: qwen3-coder-next called it twice, was told twice
    // "the code search is off here", and those two errors helped stop it at five in a row).
    // The same for the four never called in 40 runs on a service (5 Oct 2026): Map not in the home
    // folder, Rename and TestFirst in a folder of code, Remember with a memory. The folder is looked at
    // once a conversation, so the list does not move under it; a call to one left out still runs.
    const here = this.toolPlace?.cwd === this.cwd ? this.toolPlace : (this.toolPlace = { cwd: this.cwd, home: isHomeFolder(this.cwd), code: isCodeProject(this.cwd) });
    const off = new Set([
      ...(this.codeSearchOff() ? ['CodeSearch'] : []),
      ...(here.home ? ['Map'] : []),
      ...(here.code ? [] : ['Rename', 'TestFirst']),
      ...(this.memory ? [] : ['Remember']),
    ]);
    const can = (t) => !off.has(t.function.name);
    const own = (this.toolFilter ? all.filter((t) => this.toolFilter.has(t.function.name)) : all).filter(can);
    // The tools of the user's MCP servers go last, in one order, so the list above them never moves.
    const mcp = this.mcpDefs();
    return mcp.length ? [...own, ...mcp] : own;
  }
  // ---- MCP tools (agent/mcp.mjs; the servers themselves: tools/mcp.mjs) ----
  // A conversation's MCP tools are taken once, before its first message, and kept until the next
  // conversation: a server that changes its tools, or one that connects late, would otherwise
  // change the top of the prompt, and a model on a service would read the whole conversation
  // again (15.7 s for 15.6k tokens, measured 3 Oct 2026). What you change yourself in /mcp
  // (mcpStale) is taken at your next message, with a line saying so.
  mcpFrozen = null;
  mcpStale = false;
  mcpPrints = new Map(); // "don't ask again this session": tool id → the fingerprint it was given for
  // The Agent tool (a helper, tools.mjs AGENT_TOOL_DEF): when the model decides, on the Claude
  // API, and on the remote set once you have a helper agent file (prompt-files.mjs ownDir);
  // never inside a helper; "subagents": false in settings.json leaves it out.
  agentsOn() { return !this.isHelper && this.subagents !== false && (this.way === 'model' || endpointOf(this.url)?.kind === 'claude' || this.helperAgents().length > 0); }
  // Your helper agents (prompt-files.mjs readHelperAgents): read from their folder each time, so a
  // new file is offered at the next step. None inside a helper, none on the local set.
  helperAgents() { return this.isHelper ? [] : readHelperAgents(this.rulesSetUsed ?? this.rulesSet()); }
  // The Screen tool (tools/screen.mjs): on a Mac, for a model that can look at pictures now or
  // once its vision is turned on (visionOn); "screen": false in settings.json leaves it out.
  // mayLook: the app says whether this model can turn its vision on (App.jsx).
  screenOn() { return process.platform === 'darwin' && this.screen !== false && !this.isHelper && Boolean(this.canSee || this.mayLook?.()); }
  // The web tools on offer (/web): WebSearch with a search service, WebFetch with reading pages.
  // On the Claude API both are Anthropic's own (claude.mjs), unless /web's Claude row is off.
  webTools() {
    const w = this.web;
    if (!w) return null;
    if (endpointOf(this.url)?.kind === 'claude') return w.claude === false ? null : { search: 'claude', fetch: true };
    return { search: w.search && w.search !== 'off' ? w.search : null, fetch: w.fetch !== false };
  }
  // Whether one of the app's checks runs (way.mjs HOOKS): always on App, when switched on on Model.
  // On the lean harness (way.mjs) none runs.
  hook(id) { return this.lean ? false : OPT_IN_HOOKS.has(id) ? this.hooks.has(id) : this.way !== 'model' || this.hooks.has(id); }
  // /subagents (helper-models.mjs): the helper model for a job on an Ollama service, as
  // the endpoint override a call takes, or undefined (the job is off, its model is the
  // main one, or this is not an Ollama service). helperJobs is set by the app.
  helperUse(id) { return !this.isHelper && endpointOf(this.url)?.ollama ? useOf(this.helperJobs?.[id], id) : undefined; }
  sideUse() { return this.helperUse('side'); }
  // /effort's Who decides row: the next message goes the new way. The prompt and the tools
  // change with it, so the next reply reads the instructions again (the app warms them up).
  setWay(way, hooks) {
    // Lean is the model deciding: while it is on, Who decides stays Model (/hooks full ends it); the way
    // chosen here is kept for when it goes off (leanNow).
    this.wayChosen = wayOf(way);
    const next = this.lean ? 'model' : this.wayChosen;
    if (hooks !== undefined) this.hooks = hooksOn(hooks ?? []);
    if (next === this.way) return false;
    const before = tokensOf(this.messages[0].content);
    this.way = next;
    this.messages[0] = { role: 'system', content: wayPrompt(this.messages[0].content, next) };
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.emit('way', next);
    return true;
  }
  // The lean harness on or off (/hooks lean · /hooks full): from the next message. On, Who decides is Model.
  setLean(on) {
    const next = Boolean(on);
    if (next === this.lean) return false;
    this.lean = next;
    if (next && this.way !== 'model') { const chosen = this.wayChosen; this.setWay('model'); this.wayChosen = chosen; }
    const before = tokensOf(this.messages[0].content);
    this.messages[0] = { role: 'system', content: leanPrompt(this.messages[0].content, next) };
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.emit('lean', next);
    return true;
  }  // With nothing chosen (LEAN_AUTO), lean follows the model at each message: on for a Claude model, off for
  // any other (way.mjs leanForModel). A note says so when it comes on.
  // Off again, Who decides goes back to what /effort chose (the app's /hooks full does the same).
  leanNow() {
    if (!this.leanAuto || !this.setLean(leanForModel(this.model))) return;
    if (this.lean) this.emit('note', { text: LEAN_AUTO_NOTE, tone: 'dim' });
    else this.setWay(this.wayChosen);
  }

  // /effort's Rules room and Up-front reading: 0 = auto, a share of the context (room.mjs).
  // /effort's Look first (look.mjs): 'auto' follows Effort, 'off', or a number of seconds. The app
  // and coding -p set it from /effort (auto by default); a bare Agent (tests, the practice runs) does not look first.
  look = 'off';
  // /remote's Clean up at (settings.json "remoteCleanAt", 4 Oct 2026): on a model on another machine the
  // memory is cleaned up (notes, then a fresh start from them) as if it held only this many tokens. The
  // model keeps its whole memory, so one big file still fits. 0: its whole memory, as before.
  workRoom = 0;
  get cleanCap() { return this.workRoom > 0 && this.model?.remote ? Math.min(this.ctx, this.workRoom) : this.ctx; }
  get lookSecsNow() { return this.lean ? 0 : lookSecs(this.look, { thinking: this.thinking, effort: this.effort }); }
  rulesRoom = 0;
  upFront = 0;
  get notesRoomNow() { return this.rulesRoom || notesRoom(this.ctx); }
  get upFrontNow() { return this.upFront || upFrontFor(this.ctx); }
  // The rules or the context changed what the room comes to: the rules are read again once, before the next message.
  // So is the set (/effort's Instructions row, or a model on another machine now): said in a note.
  syncRules() {
    if (this.rulesSetUsed !== undefined && this.rulesSetUsed !== this.rulesSet()) {
      this.refreshNotes();
      this.emit('note', { text: this.setNote(), tone: 'dim' });
      return;
    }
    if (this.notesRoomUsed === undefined || this.notesRoomUsed === this.notesRoomNow) return;
    this.refreshNotes();
  }
  setNote() {
    return this.rulesSetUsed === 'remote' ? 'Remote instructions (terminal/rules/remote): HARNESS.md, TOOLS.md, the guides and the skills, for a model on another machine.' : 'Local instructions (terminal/rules), as on this Mac.';
  }
  // The rules changed (/rules): the next message reads them. The instructions
  // are read again once, as after a move to another folder.
  refreshNotes() {
    const before = tokensOf(this.messages[0].content);
    this.notesRoomUsed = this.notesRoomNow;
    this.promptStampUsed = this.promptStamp();
    this.rulesSetUsed = this.rulesSet();
    this.setSystem(systemPrompt({ cwd: this.cwd, notes: projectNotes(this.cwd, this.notesRoomUsed, this.notesFrom()).text, git: gitSummary(this.cwd), instructions: this.workingInstructions, set: this.rulesSetUsed, agents: this.agentsOn(), mcp: (this.mcpInPrompt = this.mcpPrompt()), web: Boolean(this.webTools()?.fetch) }));
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
  }
  // The prompt files as they are now: the rules files (AGENTS.md or CLAUDE.md, whole, without
  // the memory), TOOLS.md's Tool use lines and SKILLS.md's list (prompt-files.mjs). A change to
  // any of them, saved in the hub or anywhere else, is read before the next message. With them
  // the set this model gets, and on the remote set HARNESS.md and the guides' list.
  promptStamp() {
    try {
      const set = this.rulesSet();
      const agents = this.agentsOn();
      const mcp = this.mcpInPrompt ?? '';
      const remote = set === 'remote' ? `${JSON.stringify(harnessOf())}\u0000${guidesList(readGuides(set, { agents, mcp: Boolean(mcp) }), { path: guidePath(this.cwd) })}` : '';
      return `${set}\u0000${set === 'remote' ? agents : ''}\u0000${projectNotes(this.cwd, Infinity, { memory: false }).text}\u0000${toolUseFor(set, undefined, { mcp, web: Boolean(this.webTools()?.fetch) })}\u0000${skillsList(readSkills(undefined, set), { path: skillPath(this.cwd) })}\u0000${remote}`;
    } catch { return null; }
  }
  promptFilesChanged() {
    const now = this.promptStamp();
    if (now === null || now === this.promptStampUsed) return false;
    this.promptStampUsed = now;
    return true;
  }
  // Work in another folder from now on: its tests, its AGENTS.md, and the fence
  // around commands, which is always the folder Agentic Coder works in.
  moveTo(dir) {
    const before = tokensOf(this.messages[0].content);
    this.cwd = dir;
    this.rewind?.moved(dir);
    this.userHooks?.moveTo(dir);
    this.testCmd = this.verify ? testCommand(dir) : null;
    this.notesRoomUsed = this.notesRoomNow;
    this.rulesSetUsed = this.rulesSet();
    this.setSystem(systemPrompt({ cwd: dir, notes: projectNotes(dir, this.notesRoomUsed, this.notesFrom()).text, git: gitSummary(dir), instructions: this.workingInstructions, set: this.rulesSetUsed, agents: this.agentsOn(), mcp: (this.mcpInPrompt = this.mcpPrompt()), web: Boolean(this.webTools()?.fetch) }));
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.promptStampUsed = this.promptStamp();
    this.readFiles = new SeenFiles();
    this.mapGiven = false;
    this.lastRoute = null;
    this.codeIndex = null;
    this.emit('cwd', { cwd: dir });
  }
  setMode(mode) { this.mode = mode; this.emit('mode', mode); }
  // What you saved with /permissions for the folder Agentic Coder works in now:
  // { allow, never, protect }. `permissions` is a function of the folder (the app
  // and `coding -p` give one), so a move to another project switches the lists;
  // read at every call, so a rule saved in another window counts at once.
  savedRules() { return (typeof this.permissions === 'function' ? this.permissions(this.cwd) : this.permissions) ?? null; }
  reset(system) { for (const j of this.jobs.all) j.orphan = true; this.jobNews = []; this.conversation = newConversation(); this.messages = [{ role: 'system', content: system ?? this.messages[0].content }]; this.todos = null; this.readFiles = new SeenFiles(); this.mapGiven = false; this.keptWrite = null; this.desktopAsked = false; this.desktopMade = null; this.mcpFrozen = null; this.mcpPlans = null; this.toolPlace = null; this.timedTo = 0; this.cardsGiven = new Set(); this.task = null; this.ctxUsed = tokensOf(this.messages[0].content) + 1200; }
  // A new conversation (/clear) starts in the folder Agentic Coder was started
  // in: a yes to "Work in <project>?" lasts for its conversation only, and each
  // project can be offered again. True when it moved back.
  startOver(home) {
    this.reset();
    this.offered = null;
    if (!home || home === this.cwd) return false;
    this.moveTo(home);
    return true;
  }

  // A tool result's room: 15% of the context, at most RESULT_MAX characters. At a service's 262k
  // context one Read of a report page brought 142,000 characters (4 Oct 2026), and every step after was slow.
  get maxResultChars() { return Math.min(RESULT_MAX, Math.max(4000, Math.floor(this.ctx * 0.15 * 3.6))); }

  // What the focused paths (src/flows) need from the agent.
  flowContext(signal) {
    const agent = this;
    let seq = 0;
    const tool = (label, arg, view, error) => {
      if (!error && (label === 'Update' || label === 'Write' || label === 'Create') && arg) this.happened?.files.add(String(arg));
      // A test run a path made: if this message goes on step by step, the
      // tests helper hands its result over instead of running them again.
      if (label === 'Bash' && view?.kind === 'bash' && this.happened) this.happened.testRun = { cmd: String(arg), out: (view.lines ?? []).join('\n'), code: view.code, secs: (view.ms ?? 0) / 1000 };
      // A run of the tests says so, with whether they failed (a loop's run reads it: loop-run.mjs).
      const run = label === 'Bash' && view?.kind === 'bash' ? testRunOf(arg, { testCmd: this.testCmd }) : null;
      const tests = run ? { failed: testsFailed((view.lines ?? []).join('\n'), view.code ?? (error ? 1 : 0), run) } : null;
      this.emit('tool', { id: `flow_${++seq}`, name: label, label, arg, view, error, ...(tests ? { tests } : {}) });
    };
    return {
      // The facts brought back for this request (recall.mjs), for the paths' own prompts.
      instructions: focusedInstructions(this.messages[0].content),
      memory: this.happened?.notes ?? '',
      // The helpers on (helpers.mjs), for the paths that use one.
      helpers: this.helpers,
      url: this.url, model: this.model, slot: this.slots?.side, sideSlots: this.slots?.sides ?? (this.slots?.side !== undefined ? [this.slots.side] : []), cwd: this.cwd, testCmd: this.testCmd ?? testCommand(this.cwd), testTimeoutMs: this.testTimeoutMs, signal, maxTries: this.maxTries,
      // A loop's run: notes typed while a path works go with its next try (flows/tries.mjs), and stay with the ones after.
      steering: this.steering ? () => this.steering() : null, notes: [],
      // Code and tests are written at the chat's thinking level (Off by default), read at each
      // call: past half the request's time it is off (steppedDown).
      get thinking() { return agent.thinking && !agent.steppedDown(); },
      effort: this.effort,
      // The memory's small model, which also ranks files by meaning (rank.mjs).
      embedder: this.searchEmbedder ?? this.ranker ?? this.memory?.embedder ?? null,
      emit: (name, ev) => {
        if (name === 'route') { this.lastRoute = ev; this.sorted(ev.kind, { shortcut: true }); }
        if (name === 'tries-done') this.happened?.tries.push({ label: ev.label, marks: (ev.marks ?? []).join(''), summary: ev.summary, failed: Boolean(ev.failed) });
        this.emit(name, ev);
      },
      ask: (req) => this.ask(req),
      confirm: (plan) => (this.confirmPlan && this.mode !== 'bypass' ? this.confirm(plan, signal) : { ok: true }),
      // The focused paths know two ways (flows/apply.mjs): edits asked about, or on auto-accept.
      // Auto and Bypass let edits inside the project through, as Accept edits does.
      mode: () => (this.mode === 'auto' || this.mode === 'bypass' ? 'edits' : this.mode),
      setMode: (m) => this.setMode(m),
      // A protected file always asks (permissions.mjs), even on auto-accept; in Bypass only the
      // app's own settings still do (the tool loop refuses those; here the path asks).
      protectedBy: (rel) => { const at = resolvePath(this.cwd, rel); return this.mode === 'bypass' ? ownBy([rel, at.realRel]) : protectedBy([rel, at.realRel], this.savedRules()?.protect); },
      tool,
      note: (text, tone = 'dim') => this.emit('note', { text, tone }),
      // What a path found before handing over to the step-by-step way: a check
      // to run after the change, and a note that goes with the request.
      carry: (found) => { this.carried = found; },
      plan: (steps) => {
        const items = steps.map((text) => ({ text, status: 'pending' }));
        tool('Plan', '', { kind: 'todos', items: items.map((i) => ({ ...i })) });
        return {
          step: (i) => { items.forEach((it, k) => { it.status = k < i ? 'done' : k === i ? 'in_progress' : 'pending'; }); this.emit('flow-step', { index: i, count: items.length, text: items[i].text }); },
          done: () => { items.forEach((it) => { it.status = 'done'; }); this.emit('flow-step', null); },
        };
      },
      runReal: async (cmd) => {
        const r = await runCommand(cmd, { cwd: this.cwd, maxLines: 80, signal });
        const res = readResults(r.lines.join('\n'), r.code);
        tool('Bash', cmd, { kind: 'bash', code: r.code, lines: r.lines, ms: r.ms }, !res.ok);
        return res;
      },
      // One short sentence on what a change does, for the summary.
      describe: async (rel, before, after) => {
        try {
          // Only the lines that really differ: a change in two places is not a rewrite.
          const d = changedLines(before, after).map((l) => `${l.type}${l.text}`).join('\n').slice(0, 3000);
          const r = await complete({ what: 'describing a change', url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0.2, maxTokens: 70, system: 'You describe code changes in one short plain sentence.', user: `The change to ${rel}:\n${d}\n\nIn one short sentence, what does this change do?` });
          const one = r.text.trim().split('\n')[0].replace(/^["']|["']$/g, '');
          return one ? `${one.replace(/\.?$/, '.')} ` : '';
        } catch { return ''; }
      },
    };
  }

  // One user message → as many model turns and tools as it takes. Around the
  // work itself, the memory: a message that corrects Agentic Coder counts against
  // the facts the last turn used, and when the turn ends what happened is
  // written down, for the facts' trust and for the next save.
  // shown: the message as you typed it (what /rewind lists and puts back).
  // images: pictures you attached ([{ path, mime, data, w, h }]), carried beside the text (images.mjs).
  // fromServer: the message is an MCP server's own prompt (/server:prompt): no MCP note goes with it.
  // wake: the app's own message for a background job that ended after the reply (jobWake): it carries
  // on the last turn, so nothing sorts it or reads ahead for it, as when the model decides.
  async send(text, { signal, shown, images, fromServer = null, wake = false } = {}) {
    this.sending = true;
    this.leanNow();
    // Your hooks for a message you send (not the app's own wake): exit 2 stops it; what one prints
    // goes with it, as does what a SessionStart hook printed.
    if (!wake && this.userHooks?.has('UserPromptSubmit')) {
      const r = await this.userHooks.run('UserPromptSubmit', { prompt: String(text) }, { signal, permissionMode: this.mode });
      if (r.block) {
        this.sending = false;
        this.emit('note', { text: `Your hook stopped this message, so it was not sent: ${r.reason || 'it said no'}`, tone: 'warn' });
        return 'blocked';
      }
      if (r.context) text = `${text}\n\n(From the user's hook: ${r.context})`;
    }
    if (this.sessionContext && !wake) { text = `${text}\n\n(From the user's hook at the start: ${this.sessionContext})`; this.sessionContext = null; }
    // Background jobs that ended while nothing was running ride with this message.
    const news = this.takeJobNews();
    if (news) text = `${text}\n\n(Meanwhile: ${news})`;
    this.fromServer = fromServer;
    this.corrected(text);
    this.turn = null;
    const happened = { at: new Date().toISOString(), request: String(text), recalled: [], notes: '', files: new Set(), tries: [], warnings: [], did: [] };
    this.happened = happened;
    this.requestStarted = Date.now(); // its time for thinking starts now (steppedDown)
    this.steppedAt = null;
    const warn = (ev) => { if (ev?.tone === 'warn' || ev?.tone === 'error') this.happened?.warnings.push(String(ev.text).slice(0, 200)); };
    this.on('note', warn);
    // The folder as it is before this message, for /rewind.
    let point = null;
    if (this.rewind) {
      const slow = setTimeout(() => this.emit('note', { text: 'Saving a copy of this folder first, for /rewind (only the first message waits for it)…', tone: 'dim' }), 1500);
      try { point = await this.rewind.begin({ cwd: this.cwd, text: shown ?? String(text), at: happened.at }); } catch { point = null; } finally { clearTimeout(slow); }
    }
    let reason;
    // This conversation's MCP tools, taken before its first message (mcpTake).
    try { await this.mcpTake(); } catch { /* no MCP tools in this conversation */ }
    try { reason = await this.work(text, { signal, images, wake }); } finally {
      this.sending = false;
      // A job that ended during the reply and was not told with a step: the app sends it now
      // (not after you stopped the reply: it goes with your next message then).
      if (this.jobNews.length && reason !== 'interrupted') setTimeout(() => { if (this.idle() && this.jobNews.length) this.emit('jobs-waiting', { count: this.jobNews.length }); }, 0);
      this.off('note', warn);
      if (point) { try { await this.rewind.finish(point, { files: happened.files, message: happened.message }); } catch { /* this message cannot be rewound */ } }
    }
    this.settle(reason);
    return reason;
  }

  // ---- background jobs (tools/jobs.mjs) ----
  // Nothing running: no reply, and no message on its way in.
  idle() { return !this.busy && !this.sending; }

  // A background job ended. One stopped (by the model, by you, at quit) or one of a conversation
  // that was cleared is only a line. One that ended by itself is news for the model: told with its
  // next step while a reply runs, and once nothing runs the app sends it as a message of its own
  // ('jobs-waiting', App.jsx), as Claude Code does (the owner's pick, 3 Oct 2026).
  jobEnded(job) {
    const how = job.stopped ? 'stopped' : `ended, exit code ${job.code ?? '?'}`;
    if (job.stopped !== 'model') this.emit('note', { text: `${job.id} ${how} after ${took(job.ended - job.started)}: ${job.command}`, tone: job.stopped || job.code === 0 ? 'dim' : 'warn' });
    if (job.stopped || job.orphan) return;
    this.jobNews.push(job);
    if (this.idle()) this.emit('jobs-waiting', { count: this.jobNews.length });
  }

  // The ended jobs not told yet, as one note (and from now on told); null when there are none.
  takeJobNews(lines = 10) {
    if (!this.jobNews.length) return null;
    return this.jobNews.splice(0).map((j) => {
      const last = this.jobs.tail(j, lines);
      return `background job ${j.id} (${j.command}) ended by itself: exit code ${j.code ?? '?'} after ${took(j.ended - j.started)}.${last.length ? ` Its last lines:\n${last.join('\n')}` : ''}`;
    }).join('\n\n');
  }

  // The message that wakes the model for jobs that ended after its reply: { text, shown } or null.
  jobWake() {
    const ids = this.jobNews.map((j) => j.id);
    const news = this.takeJobNews(20);
    if (!news) return null;
    return {
      text: `(From Agentic Coder, not the user: ${news})\nA background job you started ended after your last reply. Carry on with what it was for; if nothing is left to do, say so in one line.`,
      shown: `${ids.join(', ')} ended`,
    };
  }

  // ---- your hooks (user-hooks.mjs) ----
  // The window opens, comes back after /clear or /resume: what a SessionStart hook prints goes with
  // the next message. source: startup · resume · clear.
  async startSession(source = 'startup') {
    if (!this.userHooks?.has('SessionStart')) return;
    const r = await this.userHooks.run('SessionStart', { source }, { permissionMode: this.mode });
    if (r.context) this.sessionContext = r.context;
  }
  // The window closes, or /clear: SessionEnd, waited for at most ms. reason: quit · clear · exit.
  async endSession(reason = 'quit', ms = 5000) {
    if (!this.userHooks?.has('SessionEnd')) return;
    await Promise.race([this.userHooks.run('SessionEnd', { reason }), new Promise((r) => setTimeout(r, ms).unref?.())]);
  }

  // A helper (Agent): a second agent with a fresh conversation, the same model, folder, mode,
  // permissions and web, on the side slot when the server has one (the conversation's place
  // on the main slot stays), and no Agent of its own. Its steps show on one line as it goes;
  // only its report comes back. esc stops it with the rest.
  // One of your helper agents (kind = its name) gets its file's instructions, tools and model.
  async runHelper(id, args, shown, signal) {
    const asked = String(args.kind ?? '').toLowerCase();
    const own = this.helperAgents().find((h) => h.kind === asked) ?? null;
    const kind = own ? own.kind : asked === 'general' ? 'general' : 'explore';
    if (!own && shown.label !== 'Agent') shown = { ...shown, label: 'Explore' };
    // Its Model line: another model on the same Ollama service; anywhere else it runs on this one.
    // The main model by its own name is the main model (another size would load it again).
    const bare = (m) => String(m ?? '').toLowerCase().replace(/:latest$/, '');
    const otherModel = own && ![bare('main'), bare(endpointOf(this.url)?.model)].includes(bare(own.model)) ? own.model : null;
    const ownUse = otherModel && endpointOf(this.url)?.ollama ? { model: otherModel, numCtx: OWN_HELPER_CTX, keepAlive: '30m' } : undefined;
    const t0 = Date.now();
    const slot = this.slots ? { main: this.slots.side ?? this.slots.main } : undefined;
    const helper = new Agent({
      // On a model of its own it has that model's room (OWN_HELPER_CTX), so it summarizes in time.
      url: this.url, model: this.model, cwd: this.cwd, system: helperPrompt(this.messages[0].content, kind, own), thinking: this.thinking, effort: this.effort, ctx: ownUse ? Math.min(this.ctx, OWN_HELPER_CTX) : this.ctx,
      mode: this.mode, flows: false, verify: false, confirmPlan: false, checkIns: false, maxSteps: HELPER_STEPS, slots: slot, bash: this.bash,
      way: this.way, hooks: [...(this.hooks ?? [])], web: this.web, mcp: this.mcp, permissions: this.permissions, waitForServer: this.waitForServer, instructions: this.rulesSet(),
      // Its questions to you come one at a time, as the conversation's do (several helpers may ask at once on the Claude API).
      ask: (req) => (this.askLine = (this.askLine ?? Promise.resolve()).then(() => this.ask({ ...req, helper: kind }), () => this.ask({ ...req, helper: kind }))),
    });
    // Its tools: the app's, and of the MCP tools those its file names (mcp__github__get_* names several).
    const toolFilter = own ? helperToolFilter(own.tools, [...this.tools().map((t) => t.function.name), ...this.mcpEntries().map((e) => e.name)]) : kind === 'explore' ? EXPLORE_TOOLS : null;
    Object.assign(helper, { jobs: this.jobs, userHooks: this.userHooks, isHelper: true, parentTurn: () => this.turn, look: 'off', toolFilter, ownUse, canSee: this.canSee, visionOn: this.visionOn, allowedPrefixes: this.allowedPrefixes, setMode: () => {} });
    // The same MCP servers and this conversation's list of their tools (worked out for its own room), and what you allowed.
    if (this.mcpFrozen) Object.assign(helper, { mcpFrozen: this.mcpFrozen, mcpPlans: new Map(), mcpPrints: this.mcpPrints });
    // Its edits and commands can be put back with /rewind as part of your message (no point of its own).
    if (this.rewind) helper.rewind = { begin: async () => null, edited: (...a) => this.rewind.edited(...a), around: (fn) => this.rewind.around(fn) };
    const steps = [];
    let report = '';
    const say = (last) => this.emit('tool-running', { id, name: 'Agent', label: shown.label, arg: `${shown.arg} · ${steps.length} step${steps.length === 1 ? '' : 's'}${last ? ` · ${last}` : ''}` });
    // Its changes count as this message's, so "done" after them is not "nothing changed".
    const edited = new Set();
    helper.on('tool', (ev) => { if (!ev.error && ['Update', 'Write', 'Create'].includes(ev.label) && ev.arg) edited.add(String(ev.arg)); steps.push(`${ev.error ? '✗' : '⏺'} ${ev.label}(${String(ev.arg ?? '').slice(0, 80)})`); say(`${ev.label}(${String(ev.arg ?? '').slice(0, 50)})`); });
    helper.on('assistant', (ev) => { if (ev.final) report = String(ev.text ?? ''); });
    say('');
    let reason;
    try { reason = await helper.send(args.prompt, { signal }); } catch (e) { reason = 'error'; report ||= `It stopped: ${e.message}`; }
    const secs = (Date.now() - t0) / 1000;
    this.stats.requests += helper.stats.requests;
    if (edited.size && this.turn) {
      this.turn.changed = true;
      this.turn.changedHere = true;
      this.turn.testedAfterChange = false;
      for (const f of edited) this.happened?.files.add(f);
    }
    const done = reason === 'done' || reason === 'answered';
    const body = report.trim() || '(it ended without a report)';
    const view = { kind: 'agent', steps: steps.length, secs, reason, content: `${steps.join('\n')}${steps.length ? '\n\n' : ''}${body}` };
    if (signal?.aborted) { this.emit('tool', { id, name: 'Agent', ...shown, view: { ...view, reason: 'interrupted' }, error: true }); return { text: 'Interrupted.', stop: 'interrupted' }; }
    // You said no to one of its changes (with nothing more to say): the turn ends there, as it does for the conversation's own.
    if (reason === 'declined') { this.emit('tool', { id, name: 'Agent', ...shown, view: { ...view, reason: 'you said no' }, error: true }); return { text: 'The user said no to a change the helper wanted to make. Wait for their next message.', error: true, stop: 'declined' }; }
    this.emit('tool', { id, name: 'Agent', ...shown, view, error: !done && !report.trim() });
    const where = ownUse ? `, on ${ownUse.model}` : otherModel ? `, on this model: its Model line (${otherModel}) works on an Ollama service only` : '';
    return { text: `The ${kind} helper's report (${steps.length} step${steps.length === 1 ? '' : 's'}, ${Math.round(secs)} s${where}${done ? '' : `, it stopped: ${reason}`}):\n${body}`, error: !done && !report.trim() };
  }
}

// The Agent's other methods are in the agent-*.mjs files beside this one, a part each (7 Oct 2026: this file
// had grown to 5,221 lines, more than a model can read at once). They are put on Agent.prototype here, as
// they were written (getters stay getters), so every this.x() and every test works as before.
for (const part of [McpPart, MemoryPart, ReadPart, PagesPart, ChecksPart, RoomPart, StepPart, UndoPart, ModelPart, WorkPart]) {
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) {
    if (name === 'constructor') continue;
    if (Object.hasOwn(Agent.prototype, name)) throw new Error(`Agent.${name} is in two places`);
    Object.defineProperty(Agent.prototype, name, d);
  }
}
