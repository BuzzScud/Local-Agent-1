// The Agent's loop (agent.mjs): one message worked through, step after step, until it answers.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { endpointOf } from '../../../models/index.mjs';
import { readInstructions, replaceInstructionBlock } from './instructions.mjs';
import { ASK_NOTE, questionLines, sameStepNote, wantsQuestions } from './questions.mjs';
import { casesBack, isTestPath, untested } from './cases.mjs';
import { oldSteps, parseArgs } from './tools.mjs';
import { readFileSync } from 'node:fs';
import { isReadOnly } from './permissions.mjs';
import { isHomeFolder } from './prompt.mjs';
import { kindText, sortBug } from './rules.mjs';
import { LOOK_BACKS, LOOK_NOTE, LOOK_NOTE_DATA, lookBackNote } from './look.mjs';
import { pageReadOn } from './page-read.mjs';
import { pickSkill, readSkills, skillNote } from './prompt-files.mjs';
import { mathIndex, mathNotes, sortMath } from './expertise.mjs';
import { designNotes, designSettings, isDesignRequest, mixTurn, pickCards } from './design.mjs';
import { pickPieces, studioNotes } from './studio.mjs';
import { pagesToCheck } from '../flows/layoutcheck.mjs';
import { basename, join, relative } from 'node:path';
import { isSmallTalk, routeByRules, runFlows } from '../flows/index.mjs';
import { LEAN_NOTE } from './way.mjs';
import { STOP_BACKS } from './user-hooks.mjs';
import { clarify } from '../flows/clarify.mjs';
import { isFollowUp, wantsDesktop } from '../flows/words.mjs';
import { checkInText } from '../flows/fix.mjs';
import { SERVICE_REPLY } from './room.mjs';
import { tallies } from '../flows/llm.mjs';
import { isMemoryRequest } from './memory.mjs';
import { alwaysRules } from './facts.mjs';
import { IMAGE_TOKENS } from './images.mjs';
import { describePictures, describedNote } from './helper-models.mjs';
import { MCP_TOOL, callHint, isMcpCall, mcpCallInText, requestHits, requestNote } from './mcp.mjs';
import { BYPASS_OPEN, CALL_MARK, CORRECTS, EXPLAIN, LAYOUT_ROUNDS, LOOK_TOOLS, MAX_CALLS, MCP_BACKS, MENTIONS_WALL, READ_TIP, SAME_STEP, aboutTheCode, announcesNextStep, asksForWork, asksTheUser, asksTheUserDirectly, auto, bareCallInText, beforeCall, claimsAllGood, claimsAlreadyThere, claimsDone, claimsFound, cutCallNote, emptyCutNote, kTok, keptPart, keptWriteNote, keyLines, safeArgs, searchWords, tokensOf, toolCallInText, webAddresses, writesCodeInstead } from './agent-said.mjs';

export class WorkPart {
  async work(text, { signal, images, wake = false } = {}) {
    // A hub save applies between tasks; in-flight requests keep their snapshot.
    const instructions = readInstructions();
    this.workingInstructions = instructions.sections;
    const before = this.messages[0].content;
    const after = replaceInstructionBlock(before, instructions.sections);
    if (after !== before) {
      this.setSystem(after);
      this.ctxUsed += tokensOf(after) - tokensOf(before);
      this.emit('note', { text: 'Updated working instructions loaded.', tone: 'dim' });
    }
    // A save of AGENTS.md, TOOLS.md or SKILLS.md (the hub's Prompt files) applies between tasks too.
    // Not in a helper: its one task keeps the prompt it was handed (the parent's, with its part).
    if (!this.isHelper && this.promptFilesChanged()) {
      const was = this.rulesSetUsed;
      this.refreshNotes();
      this.emit('note', { text: was === this.rulesSetUsed ? 'Updated prompt files loaded (AGENTS.md, TOOLS.md, SKILLS.md).' : this.setNote(), tone: 'dim' });
    }
    this.busy = true;
    const started = Date.now();
    const turnStart = this.messages.length;
    // A picture this model cannot see, and a Pictures helper on the service: it describes
    // the picture first, and the words go in its place (/subagents, 2 Oct 2026).
    const lookUse = images?.length && !this.canSee ? this.helperUse('pictures') : undefined;
    if (lookUse) {
      this.emit('note', { text: `Pictures: ${lookUse.model} looks at ${images.length === 1 ? 'the picture' : `the ${images.length} pictures`} first…`, tone: 'dim' });
      try {
        const d = await describePictures({ url: this.url, use: lookUse, images, question: text, signal });
        this.emit('note', { text: `Pictures: ${lookUse.model} described ${images.length === 1 ? 'it' : 'them'} (${d.secs.toFixed(0)} s): ${d.text.replace(/\s+/g, ' ').slice(0, 160)}${d.text.length > 160 ? '…' : ''}`, tone: 'dim' });
        text = `${text}\n\n${describedNote(images, lookUse.model, d.text)}`;
      } catch (e) {
        if (signal?.aborted) throw e;
        this.emit('note', { text: `Pictures: ${lookUse.model} could not look (${e.message}); the message goes with a line saying a picture was attached.`, tone: 'warn' });
        text = `${text}\n\n(The user attached ${images.length === 1 ? 'a picture' : `${images.length} pictures`} (${images.map((i) => i.path).join(', ')}), but this model is not looking at pictures now.)`;
      }
      images = undefined;
    }
    this.messages.push({ role: 'user', content: text, ...(images?.length ? { images } : {}) });
    if (images?.length) this.ctxUsed += images.length * IMAGE_TOKENS;
    if (this.happened) this.happened.message = this.messages.at(-1);
    this.emit('turn-start', { started });
    // The model decides (way.mjs): no word rules pick a path for it, not even for a greeting or
    // "update memory" (it answers, or saves with Remember). Only the loop below runs.
    const decides = this.way === 'model' || wake;
    if (!decides && isSmallTalk(text)) { this.happened.small = true; return this.chat(text, started, signal); }
    // "update memory" / "remember that …": saved straight to the memory file, never a question about where.
    if (!decides && isMemoryRequest(text)) { this.happened.small = true; return this.updateMemory(text, started, signal); }
    this.lastRoute = null;
    this.lastHelpers = []; // what the helpers bring to this request (/helpers shows it)
    this.sortShown = this.mode === 'plan' || decides; // a plan is never sorted, nor a request the model decides: no line
    const stopNow = (reason) => {
      this.busy = false;
      this.emit('flow-step', null);
      if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
      this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000 });
      return reason;
    };
    // Started outside a project (the home folder, say): a request that names
    // one goes into it once you say yes (src/agent/projects.mjs).
    const into = await this.offerProject(text, signal);
    if (into?.stop) return stopNow(into.stop);
    // A short line that continues the last turn ("can you add it to my
    // desktop?", "why") is clear with the conversation in view and means
    // little without it: no question first and no focused path, which both
    // read the line alone. It goes on step by step.
    const follow = !decides && isFollowUp(text, this.messages.slice(0, turnStart).some((m) => m.role === 'assistant'));
    // The task a short follow-up stands for ("try again", "try again another way"): the last request
    // that was not one; the request reminder says both.
    const prior = this.messages.slice(0, turnStart).some((m) => m.role === 'assistant');
    const again = prior && (isFollowUp(text, true) || (String(text).trim().split(/\s+/).length <= 6 && /\b(?:again|retry|another way)\b/i.test(text)));
    if (!this.isHelper && !wake) this.task = again && this.task ? this.task : text;
    if (follow) this.sorted('follow-up');
    // The saved facts that fit the request come along with it. They are
    // written into the request itself, so the conversation read so far stays
    // as it was (a note that came and went would make the model read the
    // last turn again).
    this.claudeCame = false;
    this.claudeSaid = '';
    try { await this.remember(text, turnStart, signal); } catch (e) { if (signal?.aborted || e.name === 'AbortError') return stopNow('interrupted'); }
    // An unclear request gets one question first (src/flows/clarify.mjs); the
    // answer joins the conversation and travels with the request. (The model that
    // decides asks with its own Ask tool, when it wants to.)
    if (!decides && !follow && this.flows && this.mode !== 'plan' && !images?.length) {
      try {
        const c = await clarify(this.flowContext(signal), text);
        if (c?.stop) return stopNow(c.stop);
        if (c) {
          this.messages.push({ role: 'assistant', content: c.question });
          this.messages.push({ role: 'user', content: c.answer });
          // The answer is the real request: it goes first, so the paths sort on it.
          text = `${c.answer}\n\n(This answers the question "${c.question}" about the request: ${text})`;
        }
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') return stopNow('interrupted');
        this.emit('note', { text: `Could not check the request first (${e.message}); starting anyway.`, tone: 'dim' });
      }
    }
    // A skill from SKILLS.md whose words the request uses (prompt-files.mjs): its steps go with
    // the request on both ways. On App the work goes step by step with them, not down a focused
    // path. Model way used to get only the list and had to Read the skill itself.
    let skill = null;
    if (!follow) { try { skill = pickSkill(text, readSkills(undefined, this.rulesSetUsed ?? this.rulesSet())); } catch {} }
    // First the focused paths (rename / fix / change); the loop handles the rest.
    // (The model that decides calls them itself: Rename and TestFirst.)
    this.carried = null;
    if (!decides && !follow && this.flows && this.mode !== 'plan' && !images?.length && !skill) {
      // Every focused call's tokens, for the done line (the loop counts its own).
      const counted = { steps: 0, tokens: 0, thinkTokens: 0 };
      const tally = ({ tokens, thought }) => { counted.steps++; counted.tokens += tokens + thought; counted.thinkTokens += thought; this.stats.outTokens += tokens + thought; };
      tallies.add(tally);
      const fctx = this.flowContext(signal);
      try {
        const r = await runFlows(fctx, text);
        if (r) {
          this.emit('flow-step', null);
          this.messages.push({ role: 'assistant', content: r.summary });
          this.emit('assistant', { text: r.summary, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
          this.busy = false;
          this.happened.flow = { done: r.done, summary: String(r.summary ?? '').slice(0, 300) };
          const reason = signal?.aborted ? 'interrupted' : r.declined ? 'declined' : 'done';
          if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
          tallies.delete(tally);
          this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, flow: true, done: r.done, steps: counted.steps, reads: 0, thinkTokens: counted.thinkTokens, tokens: counted.tokens });
          return reason;
        }
        tallies.delete(tally);
        this.carriedNotes = [...fctx.notes]; // notes a path read before it handed over go with the first step
      } catch (e) {
        tallies.delete(tally);
        this.carriedNotes = [...fctx.notes]; // notes a path read before it gave up go with the first step
        this.emit('flow-step', null);
        if (signal?.aborted || e.name === 'AbortError') {
          this.busy = false;
          this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
          this.emit('turn-end', { reason: 'interrupted', secs: (Date.now() - started) / 1000 });
          return 'interrupted';
        }
        this.emit('note', { text: `The focused path failed (${e.message}); working step by step instead.`, tone: 'warn' });
      }
    }
    // kindFor: what a /agents step is (agents-driver.mjs), so its words are not sorted again.
    const kind = follow || decides ? undefined : this.kindFor ?? this.lastRoute?.kind ?? routeByRules(text)?.kind;
    this.sorted(kind, skill ? { skill: skill.name } : undefined); // no focused path ran (or none exists here): step by step
    // A bug brings the steps for its kind (terminal/rules/bug-fixing.md). They
    // go with this turn's requests to the model, not into the conversation.
    const bug = kind === 'fix' ? sortBug(text) : null;
    // The user's own math notes (src/agent/expertise.mjs) come only when asked
    // for with /math, as Claude Code reads nothing beyond the project unasked.
    // Matching them to every request by its words sent ordinary requests
    // there: "pages" and "top" in a notes.html request picked "Pages at the
    // top of MATH" and the model went looking through the folder (2026-09-26).
    let math = null;
    if (this.mathForce) {
      try {
        math = sortMath(text, { min: 1 });
        if (!math) { const index = mathIndex(); math = index?.areas?.length ? { browse: true, index } : null; }
      } catch {}
    }
    this.mathForce = false;
    const request = this.messages.at(-1);
    let reason = 'done';
    let repeatKey = null;
    let repeatOut = '';
    let repeats = 0;
    let errorsInRow = 0;
    let nudges = 0;
    let stopBacks = 0; // your Stop hooks' send-backs this message
    let checks = 0;
    let cuts = 0; // replies cut off at the reply limit mid-tool-call
    let toolsUsed = 0; // tool calls run for this message: a nudge is only for work already under way
    this.turn = { changed: false, testedAfterChange: false, created: [], asked: [], diffs: '', looked: [], since: Date.now(), planOk: false,
      // What the follow-through checks keep (4 Oct 2026): walls met, files seen only as an outline, the check runs.
      walls: [], outlined: new Set(), checks: [],
      // From the home folder, the folder the request names (offerProject): look-first, real-files and did-you-mean use it.
      workFolder: isHomeFolder(this.cwd, this.home) ? this.namedFolder ?? null : null,
      // The request's words steer which lines of a long file a Read shows first.
      request: typeof request?.content === 'string' ? request.content : '',
      requestMsg: request,
      task: this.task ?? null,
      // The request (and a question and answer before it): kept word for word when the conversation is summarized.
      opening: this.messages.slice(turnStart).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls)),
      fixing: kind === 'fix', question: kind === 'question', findings: [], nudged: 0, looksAtNudge: 0, reads: new Map(), stuckSteps: new Set(),
      // A helper agent of yours with a model of its own (runHelper): every step on that model.
      ...(this.ownUse ? { use: this.ownUse } : {}) };
    if (asksForWork(this.turn.request) && wantsDesktop(this.turn.request)) this.desktopAsked = true;
    // A request about what one of the user's MCP servers reaches: a line naming its tools (mcp.mjs requestNote).
    // Not for a message that brings a server's data with it (a resource you attached: @server:uri), or
    // that is a server's own prompt (/server:prompt).
    const mcpSays = this.mcpFrozen && request?.role === 'user' && typeof request.content === 'string' && !this.fromServer && !/<resource server="/.test(text) ? requestNote(text, this.mcpEntries(), { listed: this.mcpListed() }) : '';
    if (mcpSays) this.turn.mcp = { request, notes: mcpSays, hits: requestHits(text, this.mcpEntries(), { listed: this.mcpListed() }) };
    // Look first (look.mjs): a minimum of looking before the answer, on every task that goes step
    // by step here; not a follow-up (it continues a turn that already looked), not in the home
    // folder (a general question there needs no files), not for a helper (it is part of the looking),
    // not for a request that names one of your MCP servers (its answer is there, not in the project).
    // A folder that is not a code project (folder.mjs, 4 Oct 2026): what it says about itself (its
    // README, its manifest) goes with the first request there, and the names the request uses are
    // matched against it; when the folder does not settle which one is meant, you are asked.
    const folder = !follow && !this.isHelper && request?.role === 'user' && typeof request.content === 'string' ? await this.folderNotes(text, request, signal) : null;
    // Your standing rules ([always] facts) with the request itself, on a model on another machine: they are
    // in the instructions' Memory lines too, far above a long conversation (4 Oct 2026: a 29-step run's
    // answer went against "explain simply… no file names or code unless asked").
    if (this.model?.remote && this.memory && !this.isHelper && request?.role === 'user' && typeof request.content === 'string') {
      let rules = [];
      try { rules = alwaysRules(this.cwd, { home: this.memory.home ?? this.home }); } catch { /* no memory to read */ }
      if (rules.length) this.turn.rules = { request, notes: `Your standing rules, for this answer too:\n${rules.map((r) => `- ${r}`).join('\n')}` };
    }
    // A request that asks to be asked: the questions as choices in the window (questions.mjs ASK_NOTE).
    if (!this.isHelper && request?.role === 'user' && typeof request.content === 'string' && wantsQuestions(text)) this.turn.asks = { request, notes: ASK_NOTE };
    // A message that corrects it: Remember what was wrong, when it will matter again (rememberHint).
    if (request?.role === 'user' && typeof request.content === 'string' && CORRECTS.test(String(text).trim())) {
      const hint = this.rememberHint('corrected');
      if (hint) this.turn.fixNote = { request, notes: hint.replace(/^\(|\)$/g, '') };
    }
    const lookFloor = !follow && !this.isHelper && !isHomeFolder(this.cwd) && !this.turn.mcp?.hits.some((x) => x.named) ? this.lookSecsNow : 0;
    let lookBacks = 0;
    // said once a session, and again only after it was off (7 Oct 2026: it was printed every turn)
    if (!this.isHelper && !follow) { if (this.lean && !this.leanSaid) this.emit('note', { text: LEAN_NOTE, tone: 'dim', fold: true }); this.leanSaid = this.lean; }
    if (lookFloor && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.look = { request, notes: folder?.kind === 'data' ? LOOK_NOTE_DATA : LOOK_NOTE };
      this.emit('note', { text: `Looking first: at least ${lookFloor} s of searching and reading before it answers (/effort Look first).`, tone: 'dim', fold: true });
    }
    if (bug && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.bug = { request, steps: kindText(bug), kind: bug };
      // A check the request names scores the change instead of the whole suite
      // (the bug steps, step 7); for a kind the suite cannot see, with no
      // check named, the suite is not run at all — it would only mislead.
      this.turn.check = checkInText(text);
    }
    if (skill && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.skill = { request, notes: skillNote(skill), name: skill.name };
      this.turn.fence = new Set(skill.fence ?? []);
      this.ctxUsed += tokensOf(this.turn.skill.notes);
      const fence = skill.fence?.length ? `; fence: ${skill.fence.join(', ')}` : '';
      this.emit('note', { text: `Skill: ${skill.name} (SKILLS.md; its words here: ${skill.matched.join(', ')}${fence}; ≈${tokensOf(this.turn.skill.notes).toLocaleString('en-US')} tokens).`, tone: 'dim', skill: skill.name });
    }
    // A check the fix path made and what the browser found (flows/pagecheck.mjs).
    if (this.carried && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.carried = { request, notes: this.carried.note };
      this.turn.check = this.carried.check;
      this.carried = null;
    }
    // A web address in the request, with WebFetch on: a line saying it is a page to read, not a
    // file here. Qwen looked for "http://…/notes" in the project with Search, List and Read, and ran
    // curl, twice in seven (the Web check, 30 Sep 2026).
    const urls = webAddresses(text);
    if (urls.length && this.webTools()?.fetch && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.web = { request, urls, notes: `${urls.length === 1 ? 'The request names a web page' : 'The request names web pages'} (${urls.slice(0, 3).join(', ')}): read ${urls.length === 1 ? 'it' : 'them'} with WebFetch. ${urls.length === 1 ? 'It is' : 'They are'} not a file in the project.` };
    }
    // Bypass permissions: the prompt's rules say commands stay in the folder, offline. They are
    // kept word for word (the service's cache), so the request says what is true while it is on.
    if (this.mode === 'bypass' && request?.role === 'user' && typeof request.content === 'string') {
      // With where the user's own folders are: it does not know their name, and guessed /Users/Shared/Desktop (5 Oct 2026).
      this.turn.open = { request, notes: `${BYPASS_OPEN} The user's home folder is ${this.home}; their Desktop is ${this.desktopDir}.` };
    }
    if (math && request?.role === 'user' && typeof request.content === 'string') {
      try {
        this.turn.math = { request, notes: mathNotes(math, text) };
        this.emit('note', { text: math.browse ? 'Using the math notes (~/Desktop/MATH).' : `Using the math notes: ${math.area.name} (~/Desktop/MATH).`, tone: 'dim' });
      } catch {}
    }
    // The design examples (src/agent/design.mjs): with a request to make or
    // restyle a page, screen or widget, or any request sent with /design; never
    // with a question, a bug fix or a rename.
    const design = designSettings(this.designSaved);
    const forced = this.designForce;
    this.designForce = false;
    // UI design · writes (/subagents): a page request runs on that helper, when it is not the main model.
    if (this.turn && (forced || (!['question', 'fix', 'rename'].includes(kind) && isDesignRequest(text)))) {
      const writer = this.helperUse('designWrite');
      if (writer) { this.turn.use = { ...writer, keepAlive: undefined }; this.emit('note', { text: `UI design: ${writer.model} writes this page.`, tone: 'dim' }); }
    }
    if ((forced || (design.auto && !['question', 'fix', 'rename'].includes(kind) && isDesignRequest(text))) && request?.role === 'user' && typeof request.content === 'string') {
      try {
        // The design studio's pieces (studio.mjs) that fit take the example
        // card's place; the rules card still comes. No piece fits: the cards as before.
        const studio = design.studio ? studioNotes(pickPieces(text)) : null;
        // mix: opus and fable take turns, one page request each.
        const style = !studio && design.style === 'mix' ? mixTurn() : design.style;
        const pick = pickCards(text, { sets: design.sets, style });
        const cards = designNotes(studio ? { ...pick, examples: [], more: [], look: null } : pick);
        const notes = cards || studio ? { text: [cards?.text, studio?.text].filter(Boolean).join('\n\n'), names: [...(cards?.cards ?? []).map((c) => c.file.replace(/\.md$/i, '')), ...(studio?.pieces ?? []).map((p) => `studio/${p.file.replace(/^components\//, '').replace(/\.html?$/i, '')}`)] } : null;
        if (notes) {
          this.turn.design = { request, notes: notes.text, cards: notes.names };
          if (studio) this.turn.studio = { pieces: studio.pieces.map((p) => p.file) };
          this.ctxUsed += tokensOf(notes.text);
          // `design` names the cards for the screen (it folds them into the line under your message).
          this.emit('note', { text: `Design ${studio ? 'studio' : 'examples'}${!studio && design.style === 'mix' ? ` (mix: ${style}'s turn)` : !studio && design.style !== 'auto' ? ` (${style})` : ''}: ${notes.names.join(' + ')} (≈${tokensOf(notes.text).toLocaleString('en-US')} tokens).`, tone: 'dim', design: notes.names });
        } else if (forced) this.emit('note', { text: 'No design examples found (the "design examples" folder is missing or has no cards in the sets that are on).', tone: 'warn' });
      } catch {}
    }
    // The opening read (opening.mjs): on the remote set, the memory whole and where the project
    // stands, before the first step of a conversation, on either way; again after it was trimmed away.
    this.giveOpening(text);
    this.giveMaps(text);
    // A question about code: what it is about is read now, in one go, instead
    // of letting the model find, list and read it a piece at a time.
    // The model that decides looks for itself (Map, CodeSearch, List, Search, Read).
    if (!decides) {
      this.prefetchMap();
      if (kind === 'question' || (!kind && EXPLAIN.test(text))) await this.prefetch(text);
      else if (!follow && kind !== 'rename') await this.prefetchRanked(text, signal);
      // What the other helpers bring (helpers.mjs): the failing tests and the
      // changes, the closest parts of long files by meaning, where names are used.
      try { await this.bringHelpers(text, kind, signal); } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') return stopNow('interrupted');
        this.emit('note', { text: `The helpers could not bring what they found (${e.message}); starting without it.`, tone: 'dim' });
      }
    }
    let verified = false;
    let doneUnchanged = false; // sent back once for saying done with nothing changed
    let unlooked = false; // sent back once for answering about the code without a look of its own
    let unreal = false; // sent back once for naming files that are not in the project
    let lostChecked = false;
    let layoutSends = 0; // what the layout check found, sent back at most LAYOUT_ROUNDS times
    let layoutDone = false;
    let looked = false; // UI design · checks: a picture of the page looked at once (/subagents)
    let pageReads = 0; // What a reader sees (page-read.mjs): read, and once more after a send-back
    let reviewed = false; // the second opinion: once per message (/subagents)
    let desktopSent = false; // sent back once to move a page asked for on the Desktop
    let correctedAlready = false;
    let blankRetry = false;
    let leakBacks = 0; // a reply that was only thinking written out as text, sent back (twice at most)
    let mcpBacks = 0; // a request about an MCP server's data, answered with no MCP tool tried (MCP_BACKS)
    try {
      for (let step = 0; step < this.maxSteps; step++) {
        if (signal?.aborted) { reason = 'interrupted'; break; }
        await this.fitContext(signal);
        const turn = await this.generate(signal);
        // Counted for the done line: each reply is a step; its thinking share
        // of the tokens is estimated from the characters it wrote.
        if (!turn.aborted) {
          this.turn.steps = (this.turn.steps ?? 0) + 1;
          this.turn.tokens = (this.turn.tokens ?? 0) + (turn.tokens ?? 0);
          const all = turn.reasoning.length + turn.text.length + turn.calls.reduce((n, c) => n + (c.args?.length ?? 0), 0);
          this.turn.thinkTokens = (this.turn.thinkTokens ?? 0) + (all ? Math.round((turn.tokens ?? 0) * turn.reasoning.length / all) : 0);
        }
        if (turn.aborted) {
          // Keep what it had written so far on screen (not in the conversation).
          if (turn.reasoning || turn.text) this.emit('assistant', { text: turn.text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: false, partial: true });
          reason = 'interrupted';
          break;
        }
        if (turn.looping) {
          this.messages.push({ role: 'assistant', content: turn.text.slice(0, 200) });
          this.messages.push({ role: 'user', content: auto('Your last reply started repeating itself. Try again, briefly.') });
          this.emit('reply-dropped');
          this.emit('note', { text: 'The model started repeating itself; asked it to try again.', tone: 'warn' });
          continue;
        }
        let calls = turn.calls;
        let text = turn.text;
        if (!calls.length) {
          // A call written as text, or (thinking mode) written inside the thinking.
          // Bare JSON naming one of its tools (older models on an Ollama service) counts too.
          const inText = toolCallInText(turn.text) ?? (!turn.text.trim() ? toolCallInText(turn.reasoning) : null) ?? bareCallInText(turn.text, (this.tools() ?? []).map((t) => t.function?.name ?? t.name));
          if (inText) { calls = [{ id: `call_${Date.now()}`, name: inText.name, args: inText.args }]; text = turn.text.trim() ? inText.before : ''; }
          // An MCP tool's call written the way code calls a function: mcp__warehouse__stock_level(item="mug").
          const written = !inText && this.mcpFrozen ? mcpCallInText(turn.text, this.mcpEntries()) : null;
          if (written) { calls = [{ id: `call_${Date.now()}`, name: MCP_TOOL, args: JSON.stringify(written.call) }]; text = written.before; }
        }
        // Only the first call runs, so only the first is kept in the history
        // (otherwise the model waits for results that never come). When the model
        // decides, every call of the reply runs, in order (at most MAX_CALLS), and so
        // they do for a model on another machine on either way (the remote set's TOOLS.md
        // asks for the reads of a step together: one round trip to the service, not three).
        calls = calls.slice(0, decides || this.remoteSet() ? MAX_CALLS : 1);
        // A call cut off by the reply limit (finish 'length'): running it can
        // only give "not valid JSON", and the old error told the model to send
        // the same too-big call again. Instead: build the file in parts.
        const cutCall = turn.finish === 'length' && (calls[0] ?? (CALL_MARK.test(text) ? { name: /<function=([^>\s]+)>|<ifm\|tool_call>\s*([^\s<{]+)/.exec(text)?.slice(1).find(Boolean) ?? 'the last', args: text } : null));
        if (cutCall) {
          cuts++;
          if (cuts >= 3) {
            reason = 'stuck';
            this.emit('note', { text: 'Three replies in a row were cut off mid-call, so it stopped. Ask for the file in smaller pieces.', tone: 'warn' });
            break;
          }
          const p = /"path"\s*:\s*"([^"]+)"|<parameter=path>\s*\n?([^\n<]+)|<ifm\|arg_key>path<\/ifm\|arg_key>\s*(?:<ifm\|arg_type>[^<]*<\/ifm\|arg_type>\s*)?<ifm\|arg_value>([^\n<]+)/.exec(cutCall.args ?? '');
          const path = p?.[1] ?? (p?.[2] ?? p?.[3])?.trim();
          const thought = beforeCall(turn.reasoning).trim();
          // Its row on the screen ("Writing … lines") goes: the reply will not be run as it is.
          this.emit('reply-dropped');
          const size = `cut at ${kTok(turn.tokens)} of ${kTok(this.lastRoom ?? turn.tokens)} tokens`;
          // A Write cut off with a good part of the file in it: that part is saved through
          // the usual Write (it asks and checks as ever) and the model carries on from its
          // last line. On 1 Oct Bonsai lost a 211-line try this way, then wrote it all again.
          const kept = cutCall.name === 'Write' && path ? keptPart(cutCall.args) : null;
          if (kept) {
            const id = cutCall.id ?? `call_${Date.now()}`;
            const args = JSON.stringify({ path, content: kept.content });
            this.messages.push({ role: 'assistant', content: beforeCall(text), ...(thought ? { reasoning_content: thought } : {}), tool_calls: [{ id, type: 'function', function: { name: 'Write', arguments: args } }] });
            this.emit('note', { text: `File too long for one reply (${size}): saving its first ${kept.lines} lines, then carrying on from there`, tone: 'dim' });
            const out = await this.runTool({ id, name: 'Write', args }, signal);
            this.messages.push({ role: 'tool', tool_call_id: id, content: out.text });
            this.messages.push({ role: 'user', content: auto(out.error ? cutCallNote('Write', path) : keptWriteNote(path, kept)) });
            if (!out.error) cuts = 0; // a step landed: cut-off replies are no longer "in a row"
            continue;
          }
          this.messages.push({ role: 'assistant', content: beforeCall(text), ...(thought ? { reasoning_content: thought } : {}) });
          this.messages.push({ role: 'user', content: auto(cutCallNote(cutCall.name, path)) });
          this.emit('note', { text: `${cutCall.name === 'Write' || cutCall.name === 'Edit' ? 'File too long' : 'Call too long'} for one reply (${size}): asked it to ${cutCall.name === 'Write' || cutCall.name === 'Edit' ? `build ${path ?? 'the file'} in parts` : 'do it in smaller pieces'}`, tone: 'dim' });
          continue;
        }
        // A reply that puts a question to you ends the turn, even with a tool
        // call in it: the call is dropped and Agentic Coder waits for your answer.
        // Not an Ask: its question is the one put to you, with its choices (4 Oct 2026: an outline that ends
        // "which do you prefer?" with an Ask call would have lost the Ask).
        if (calls.length && text.trim() && asksTheUserDirectly(text) && !calls.some((c) => c.name === 'Ask')) calls = [];
        const assistant = { role: 'assistant', content: text };
        const thought = beforeCall(turn.reasoning).trim();
        if (thought) assistant.reasoning_content = thought;
        if (calls.length) assistant.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: safeArgs(c.args) } }));
        this.messages.push(assistant);
        const lines = keyLines(`${thought}\n${text}`);
        for (const l of lines) if (!this.turn.findings.includes(l)) this.turn.findings.push(l);
        this.turn.findings = this.turn.findings.slice(-6);
        // A request about what an MCP server holds (its note, turn.mcp), answered with no MCP tool tried:
        // the answer cannot have come from the server (Qwen3.6, 3 Oct 2026: "42 mugs were sold" with no
        // call; "I do not have access to mcp__shop__logo" while holding it). On both ways, as the leaked
        // thinking is, and its words are not shown. Sent back MCP_BACKS times, each for one step with only
        // that tool and thinking on (mcpFocus), the second with how the tool is called; then the answer is
        // replaced by a line saying it did not come from the server (the owner's pick, 3 Oct 2026).
        // Only when the request names the server itself, and nothing else was looked at: an answer from
        // the project's own files (Read, Search, a command) is not made up, and a word that is only in
        // a tool's name ("add a test", a tool named add) is no sign the request is the server's.
        if (!calls.length && this.turn.mcp?.hits.some((h) => h.named) && !this.turn.mcpTried && !this.turn.lookedElsewhere && !(turn.leaked && !text.trim())) {
          const { hits } = this.turn.mcp;
          const servers = `${hits.length === 1 ? 'server' : 'servers'} ${hits.map((h) => `"${h.server}"`).join(' and ')}`;
          const theirs = hits.length === 1 ? 'its' : 'their';
          if (mcpBacks < MCP_BACKS) {
            mcpBacks++;
            this.emit('assistant', { text: '', reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: false });
            this.emit('note', { text: `It answered without calling the MCP tool the request is about (that answer is not shown); asked it ${mcpBacks === 1 ? 'again' : 'a second time'}, with only that tool and thinking on.`, tone: 'dim' });
            this.turn.mcpFocus = hits;
            const how = hits.flatMap((h) => h.tools.map((e) => callHint(e, { gated: h.gated })));
            this.messages.push({ role: 'user', content: auto(mcpBacks === 1
              ? `You answered without calling an MCP tool, so your answer did not come from the user's server. ${this.turn.mcp.notes}`
              : `Your answer still did not come from the user's MCP ${servers}: none of ${theirs} tools was called. It is in your tools now: ${how.length ? how.join('; ') : `${MCP_TOOL}, with a tool's name from its list`}. Call it now, then answer from what it returns.`) });
            continue;
          }
          const why = /\b(not|cannot|can['’]?t|unable|no access|unavailable)\b/i.test(text) ? ` It said: "${text.replace(/\s+/g, ' ').trim().slice(0, 200)}"` : '';
          text = `I couldn't get this from your MCP ${servers}: none of ${theirs} tools was called, so there is no answer from ${hits.length === 1 ? 'it' : 'them'}.${why}`;
          assistant.content = text;
          this.emit('note', { text: 'Its own answer is not shown: it did not come from your MCP server.', tone: 'warn' });
        }
        this.emit('assistant', { text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: !calls.length });
        if (!calls.length) {
          // Thinking that came out as the reply's text (leakedThinking) and nothing else: not an
          // answer. Qwen3.6 ended hard task 32 this way, mid-task (3 Oct 2026). A technical
          // recovery, so on both ways.
          if (turn.leaked && !text.trim() && leakBacks < 2) {
            leakBacks++;
            this.emit('note', { text: 'The reply was only thinking, written out as text; asked it to take the next step.', tone: 'dim' });
            this.messages.push({ role: 'user', content: auto('Your last reply was only your thinking, with no tool call and no answer. Take the next step now with a tool, or give your answer.') });
            continue;
          }
          // A reply that asks you something ends the turn: it waits for you.
          // The questions the request asked for, written as text: back once to put them in Ask, the outline kept.
          if (this.turn.asks && !this.turn.askedUser && !this.turn.askBack && questionLines(text) >= 2) {
            this.turn.askBack = true;
            this.emit('note', { text: 'It wrote its questions as text; asked it to put them in the picker (Ask).', tone: 'warn' });
            this.messages.push({ role: 'user', content: auto(`You wrote your questions as text. Put them to the user with the Ask tool now: each with 2 to 4 choices, up to 5 questions in one Ask. Keep the rest of your answer as it is; do not write it again.`) });
            continue;
          }
          // An answer to a question from Claude's notes in place of the request: back once with the request.
          const chasedNow = !this.turn.noteChased ? this.noteChaseDue(`${turn.reasoning ?? ''}\n${text}`) : '';
          if (chasedNow) { this.messages.push({ role: 'user', content: auto(chasedNow.replace(/^\(|\)$/g, '')) }); continue; }
          if (asksTheUser(text)) break;
          // Small models often announce the next step mid-task ("Now I will
          // update main().") and stop. Tell them to go ahead, at most twice per
          // message, and only once work is under way (a tool already ran).
          if (nudges < 2 && toolsUsed > 0 && this.hook('next-step') && announcesNextStep(text)) {
            nudges++;
            this.messages.push({ role: 'user', content: auto('You said what you will do next but did not do it. If you meant to, do it now with the tools; if you are waiting for the user, stop.') });
            continue;
          }
          // Look before answering (a model on another machine, in a project, aboutTheCode): an answer
          // with no look of its own goes back once with the words to search for; a request for work
          // that made a file is not held to it (a new file needs no look). The second time it is
          // let through with a line under it (the owner's pick).
          // A reply cut off at the limit with nothing in it is no answer: the cut handling below has it.
          const lookHeld = this.model?.remote && !this.isHelper && (!isHomeFolder(this.cwd) || Boolean(this.turn.workFolder)) && !(!text.trim() && turn.finish === 'length');
          // Files the app read for it before its first step count as a look (App reads ahead); the opening
          // read and the maps do not (they say where things are, not what is in them).
          const sawCode = this.turn.lookedOwn || (this.turn.given ?? 0) > 0 || this.turn.shown;
          if (lookHeld && this.hook('look-first') && !sawCode && !this.turn.changed && aboutTheCode(this.turn.request)) {
            if (!unlooked) {
              unlooked = true;
              const words = searchWords(this.turn.request);
              this.emit('note', { text: 'It answered without looking at the project; asked it to search first.', tone: 'dim' });
              this.messages.push({ role: 'user', content: auto(`You answered without looking at this project's files. Do not answer about the code from memory: Search for the names in the request${words.length ? ` (for example ${words.map((w) => `"${w}"`).join(', ')})` : ''}, Read what the search finds, then answer from what you saw, naming the files.`) });
              continue;
            }
            this.emit('note', { text: 'Answered without looking at the project\'s files: check it before you rely on it.', tone: 'warn' });
          }
          // The page the request names, never tried (Look before answering): the answer goes back once, with the
          // tool to use; the second time a line under it says the page was not read.
          if (this.turn.web?.urls?.length && !this.turn.fetched && !this.isHelper && this.hook('look-first') && text.trim()) {
            if (!this.turn.webBack) {
              this.turn.webBack = true;
              this.emit('note', { text: `It answered without reading ${this.turn.web.urls[0]}; told it to read the page with WebFetch.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`You answered without reading ${this.turn.web.urls.slice(0, 3).join(', ')}. WebFetch is one of your tools here and this address is allowed: call it now, then answer from what the page shows. If it fails, tell the user exactly what it answered; do not say you cannot reach the internet without trying.`) });
              continue;
            }
            this.emit('note', { text: `Answered without reading ${this.turn.web.urls[0]}: what it says about that page is not from the page.`, tone: 'warn' });
          }
          // Files that exist: an answer that names files not in the project (and not made this
          // message, nor named in the request) goes back once; the second time, a line says which.
          if (lookHeld && this.hook('real-files')) {
            const missing = this.missingFiles(text);
            if (missing.length) {
              if (!unreal) {
                unreal = true;
                this.emit('note', { text: `It named files that are not in the project (${missing.slice(0, 3).join(', ')}); asked it to check.`, tone: 'dim' });
                this.messages.push({ role: 'user', content: auto(`These files are not in this project: ${missing.join(', ')}. Search for what you meant (Search or List), and answer only with files you have seen in a tool's result.`) });
                continue;
              }
              this.emit('note', { text: `It named files that are not in this project: ${missing.slice(0, 5).join(', ')}.`, tone: 'warn' });
            }
          }
          // Look first: an answer before the minimum, with nothing changed yet, goes back to look
          // further, with what it has looked at so far (at most LOOK_BACKS times a message).
          const lookedFor = (Date.now() - started) / 1000;
          if (lookFloor && lookedFor < lookFloor && lookBacks < LOOK_BACKS && !this.turn.changed && turn.finish !== 'length') {
            lookBacks++;
            this.emit('note', { text: `Answered after ${Math.round(lookedFor)} s of the ${lookFloor} s minimum (/effort Look first); asked it to look further first.`, tone: 'dim' });
            this.messages.push({ role: 'user', content: auto(lookBackNote(this.lookedSince(turnStart))) });
            continue;
          }
          // A skill's check fence: one command before the turn may end. The steps say
          // so too; the loop is what holds it when that sentence loses.
          if (this.turn.fence?.has('check') && !this.turn.ranCommand && asksForWork(this.turn.request) && (this.turn.checkNudges ?? 0) < 2) {
            this.turn.checkNudges = (this.turn.checkNudges ?? 0) + 1;
            this.emit('note', { text: 'This skill requires a command before it is done; asked it to run one.', tone: 'warn' });
            this.messages.push({ role: 'user', content: auto('This skill is not done until a command has checked the work. Run that command with Bash, then answer.') });
            continue;
          }
          // It says the work is done, but nothing changed in this message: no
          // Edit, no Write, and no command that could have written instead
          // (an ls or a git log could not: 3 Oct 2026, that one let it through).
          // Sent back once; if it still claims it with nothing changed, a note
          // under the answer says so. So is an answer that is the change written
          // out as code (Qwen3.6 on hard task 30, the model deciding): nothing
          // was changed, and the user cannot apply it from there.
          const t = this.turn;
          const codeInstead = writesCodeInstead(text);
          if (!t.changed && !t.question && !t.carried && !t.wroteByCommand && this.hook('said-done') && asksForWork(t.request) && (claimsDone(text) || codeInstead)) {
            if (!doneUnchanged) {
              doneUnchanged = true;
              this.emit('note', { text: codeInstead ? 'It wrote the change in its answer, but no file changed; asked it to make the change.' : 'It says the work is done, but no file changed; asked it to look again.', tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(codeInstead ? 'You wrote the change in your answer, but no file was changed: the user cannot apply it from there. Make the change now with Edit or Write, then check it.' : 'You said the work is done, but no file was changed in this message. If the request needs a change, make it now with the tools. If it was really done before this message, say which file has it and that nothing changed now, in one or two sentences.') });
              continue;
            }
            this.emit('note', { text: 'Nothing was changed for this request: no file was written or edited.', tone: 'warn' });
          }
          // It created a file this turn, then says the work was already there.
          if (this.turn.created.length && this.hook('already') && claimsAlreadyThere(text)) {
            const files = this.turn.created.join(', ');
            if (!correctedAlready) {
              correctedAlready = true;
              this.messages.push({ role: 'user', content: auto(`You created ${files} in this turn; it did not exist before. Answer again in 1-3 sentences: say that you created it, what it does, and how you checked it. Do not say it was already there.`) });
              continue;
            }
            this.emit('note', { text: `Note: ${files} did not exist before; Agentic Coder created it just now.`, tone: 'warn' });
          }
          // Answer matches results: it says all passed or it works, but its last run of the checks failed
          // (4 Oct 2026: "All 24 formulas passed" after "Results: 22 passed, 2 failed", exit code 1). Back
          // once with that run's own line; if it still says so, a line under the answer does.
          const lastCheck = this.turn.checks.at(-1);
          if (lastCheck?.failed && claimsAllGood(text) && this.hook('results')) {
            const said = `\`${lastCheck.cmd}\`${lastCheck.counts ? ` printed "${lastCheck.counts}"` : ''}${lastCheck.code ? ` and ended with exit code ${lastCheck.code}` : ''}`;
            if (!this.turn.resultsBack) {
              this.turn.resultsBack = true;
              this.emit('note', { text: `Its answer says everything passed, but its last check run did not (${lastCheck.counts || `exit code ${lastCheck.code}`}); sent it back.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`Your answer says it all passed or works, but your last run of the checks did not: ${said}. Answer again from that run: what passed, what failed and why, in plain words. If you fixed it since, run the checks again first and answer from that run.`) });
              continue;
            }
            this.emit('note', { text: `Check this answer: its last check run did not pass (${lastCheck.counts || `exit code ${lastCheck.code}`}).`, tone: 'warn' });
          }
          // Stop when blocked: it met a wall (a login, an address or path you gave that is not there) and
          // its answer neither asked you nor says so. Back once to say it and ask; then a line names it.
          const wallMet = this.turn.walls[0];
          if (wallMet && !this.turn.askedUser && !MENTIONS_WALL.test(text) && this.hook('blocked')) {
            if (!this.turn.wallBack) {
              this.turn.wallBack = true;
              this.emit('note', { text: `Its answer leaves out what blocked it (${wallMet.why}); sent it back to say so and ask you.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`Your answer leaves out what blocked you: ${wallMet.why}. Say it plainly at the start of your answer, say what you did instead (if anything), and ask the user how they want to go on.`) });
              continue;
            }
            this.emit('note', { text: `Not said in the answer: ${wallMet.why}.`, tone: 'warn' });
          }
          // Read before claiming, at the end: the answer says it found what it needs while files it leans
          // on were seen only as outlines. Back once to read the part; the step-by-step line (followDue)
          // covers the replies before.
          if (!this.turn.readFirstSent && this.turn.outlined.size && claimsFound(text) && this.hook('read-first')) {
            this.turn.readFirstSent = true;
            const names = [...this.turn.outlined].slice(0, 3).map((f) => basename(f));
            this.emit('note', { text: `It says it found what it needs, but saw only the outline of ${names.join(', ')}; sent it back to read the part.`, tone: 'warn' });
            this.messages.push({ role: 'user', content: auto(`You wrote that you found or have what you need, but of ${names.join(', ')} you have seen only the outline: its parts and line numbers, none of its text. Read the part you need (offset and limit, or find), then answer from what it says.`) });
            continue;
          }
          // A blank answer (seen once after "hello"): ask for one, once.
          if (!text.trim() && turn.finish !== 'length' && !blankRetry && this.hook('empty')) {
            blankRetry = true;
            this.emit('note', { text: 'The model gave an empty answer; asked it to reply.', tone: 'dim' });
            this.messages.push({ role: 'user', content: auto('Reply to the user now, in one to three sentences.') });
            continue;
          }
          // With the hook off, the empty answer stands, and the screen says why it is blank.
          if (!text.trim() && turn.finish !== 'length' && !blankRetry && !this.hook('empty')) this.emit('note', { text: 'The model ended with an empty answer (the Empty reply hook would send it back: /hooks on empty).', tone: 'dim' });
          if (!text.trim() && turn.finish === 'length') {
            // Cut off after a few words: the memory was full, not the thinking too long.
            if (turn.tokens < 200) {
              this.messages.pop();
              await this.compact(signal);
              continue;
            }
            // Counted with the cut-off calls: told the same thing three times running, it stops
            // (it was sent back with no end: three in a row on 3 Oct, until you pressed esc).
            cuts++;
            const size = `${kTok(turn.tokens)} of ${kTok(this.lastRoom ?? turn.tokens)} tokens`;
            if (cuts >= 3) {
              reason = 'stuck';
              this.emit('note', { text: `Three replies in a row were cut off at the reply limit (${size}), so it stopped. Raise Reply length in /effort, or ask for the file in smaller pieces.`, tone: 'warn' });
              break;
            }
            // Cut at your own Reply length (/effort) while the context has room for twice as much:
            // this step once more with that room, for the rest of the message (4 Oct 2026: Qwen3.6
            // at 8.2k thought for 3½ minutes and none of its page arrived; "build it in parts" made
            // one write many steps). Ollama's limit holds the thinking and the answer together.
            const own = this.model?.replyTokens;
            const more = Math.min(SERVICE_REPLY, Math.floor(this.ctx * this.trimAt) - this.estNow());
            if (own && !this.turn.roomUp && more >= own * 2) {
              this.turn.roomUp = more;
              this.messages.pop();
              this.emit('note', { text: `The reply was cut off at your Reply length (${size}) before anything arrived; this step goes again with ${kTok(more)} of room. Raise Reply length in /effort to keep it.`, tone: 'warn' });
              continue;
            }
            // The thinking took the room: think less. Little or no thinking (a model that cannot
            // think, like qwen3-coder-next): it was writing a call, most likely a file, and Ollama
            // hands back nothing of a tool call cut at the limit, so "think less" was the wrong advice.
            if (tokensOf(turn.reasoning) >= turn.tokens * 0.6) {
              this.messages.push({ role: 'user', content: auto('You ran out of room while thinking. Think less and take the next step.') });
              this.emit('note', { text: `The model ran out of room while thinking (${size}); asked it to act.`, tone: 'warn' });
            } else {
              this.messages.push({ role: 'user', content: auto(emptyCutNote()) });
              this.emit('note', { text: `The reply was cut off at the limit (${size}) and nothing of it arrived, most likely a file too long for one reply: asked it to build the file in parts.`, tone: 'warn' });
            }
            continue;
          }
          // It says it is done after changing files but never ran the tests:
          // run them (through the normal permission prompt); if they fail, send
          // it back to fix them. At most twice per message.
          const checkCmd = this.turn.check ?? (this.turn.bug?.kind && !this.turn.bug.kind.testsSeeIt ? null : this.testCmd);
          // Only a file on the Desktop changed: the project's tests cannot see it (3 Oct: a helper's
          // .md for the Desktop started the whole suite, more than 10 minutes on this Mac).
          const onlyAway = this.turn.changedAway && !this.turn.changedHere && !this.turn.check;
          if (checkCmd && this.turn.changed && !onlyAway && !this.turn.testedAfterChange && checks < 2 && this.hook('tests')) {
            checks++;
            const call = { id: `check_${Date.now()}`, name: 'Bash', args: JSON.stringify({ command: checkCmd, description: this.turn.check ? 'Run the check the request names' : 'Check the change with the project’s tests' }) };
            assistant.tool_calls = [{ id: call.id, type: 'function', function: { name: 'Bash', arguments: call.args } }];
            this.emit('note', { text: `Checking the change: ${checkCmd}`, tone: 'dim' });
            const out = await this.runTool(call, signal);
            const checkMsg = { role: 'tool', tool_call_id: call.id, content: out.text, ...(out.images?.length ? { images: out.images } : {}) };
            this.messages.push(checkMsg);
            if (out.stop) { reason = out.stop; break; }
            if (out.error) {
              this.noteError(out.text, checkMsg);
              this.messages.push({ role: 'user', content: auto(`${this.turn.check ? 'The named check fails' : 'The tests fail'} (output above). Find what is wrong in your change, fix it with Edit, then run ${this.turn.check ? 'the check' : 'the tests'} again.`) });
              continue;
            }
          }
          // Nothing lost: it changed files and says it is done, but a function
          // the request never names is gone (practice task 14: perimeter()
          // replaced area() instead of going beside it). Once per message.
          if (this.turn.changed && !lostChecked && !signal?.aborted && this.hook('lost')) {
            lostChecked = true;
            const lost = this.lostSinceStart();
            if (lost) {
              this.emit('note', { text: `Removed without being asked: ${lost}.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`Your changes removed ${lost}, and the request does not ask for that. Put it back with Edit and keep what you added, unless the request really needs it gone; then say why in one sentence.`) });
              continue;
            }
          }
          // A page it made or changed: opened in a browser and measured
          // (flows/layoutcheck.mjs). What is broken goes back; after the fix
          // it looks again, and what is left goes back once more
          // (LAYOUT_ROUNDS); after that the turn ends with "Still broken".
          // Asking first (askPage), it looks only when you said "Check it", further down.
          if (this.turn.changed && !layoutDone && !signal?.aborted && this.hook('layout') && (!this.askFirst() || layoutSends >= LAYOUT_ROUNDS)) {
            const found = await this.checkLayout(layoutSends > 0, { send: layoutSends < LAYOUT_ROUNDS });
            if (found && layoutSends < LAYOUT_ROUNDS) {
              layoutSends++;
              this.messages.push({ role: 'user', content: auto(found) });
              continue;
            }
            layoutDone = true;
          }
          // A page asked for "on my desktop" saved somewhere else, when the
          // Desktop is inside this folder: back once, with the command that
          // moves it (Qwen, 30 Sep: "download it to my desktop" became
          // ~/media-player-card.html, a cp onto itself, and "ready on your
          // Desktop"). Outside this folder, the end of the turn offers a copy.
          if (this.turn.changed && !desktopSent && !signal?.aborted && this.hook('desktop') && this.desktopInside() && asksForWork(this.turn.request) && wantsDesktop(this.turn.request)) {
            const away = this.pagesOffDesktop();
            if (away.length) {
              desktopSent = true;
              const shq = (p) => (/^[\w./-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
              const moves = away.map((p) => `mv ${shq(relative(this.cwd, p.abs))} ${shq(relative(this.cwd, this.desktopTarget(p.abs)))}`);
              const names = away.map((p) => this.tilde(p.abs)).join(' and ');
              this.emit('note', { text: `Asked for on the Desktop, but ${names} ${away.length === 1 ? 'is' : 'are'} not there; asked it to move ${away.length === 1 ? 'it' : 'them'}.`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`The request asks for the file on the Desktop, but ${names} ${away.length === 1 ? 'is' : 'are'} not on the Desktop. Move ${away.length === 1 ? 'it' : 'them'} there with Bash: ${moves.join(', then ')}. Then say where ${away.length === 1 ? 'it is' : 'they are'} now, with the full path, in one sentence.`) });
              continue;
            }
          }
          // What a reader sees (page-read.mjs): each page this message wrote, opened before the answer
          // stands; one mostly empty to a reader goes back once, and is read again after its fix.
          if ((pageReads === 0 || (pageReads === 1 && this.turn.pageSentBack)) && !signal?.aborted && this.hook('page-read') && pageReadOn()) {
            pageReads++;
            const back = await this.readPages({ send: pageReads === 1 });
            if (back) { this.turn.pageSentBack = true; this.messages.push({ role: 'user', content: auto(back) }); continue; }
          }
          // A page this message changed, and asking first: it is yours to look at before any check
          // (askPage), now that the model says it is done and the page is where it was asked for.
          if ((this.turn.changed || this.madePages().length) && !layoutDone && !signal?.aborted && this.askFirst() && layoutSends < LAYOUT_ROUNDS) {
            const pages = pagesToCheck(this.cwd, [...(this.turn.startTexts?.keys() ?? []), ...this.madePages()]);
            if (pages.length) {
              const a = await this.askPage(pages, signal, { again: layoutSends > 0 });
              if (a.end) { reason = a.end; break; }
              if (a.send) { if (a.fix) layoutSends++; this.messages.push({ role: 'user', content: a.send }); continue; }
              layoutDone = true;
            }
          }
          // UI design · checks (/subagents): a picture of a page it built, looked at by a
          // helper that sees; what looks off goes back once (after the measured layout check).
          if (this.turn.changed && !looked && !signal?.aborted && !this.turn.pageAsked && this.helperUse('designCheck')) {
            looked = true;
            const found = await this.lookAtPages(signal);
            if (found) { this.messages.push({ role: 'user', content: auto(found) }); continue; }
          }
          // The request's cases (cases.mjs): each case of its plan needs a test file changed in this message
          // that tries its example. Back twice with the ones still untested; then a line names them.
          if (this.turn.changed && this.model?.remote && this.hook('cases') && !this.turn.casesDone && !signal?.aborted) {
            const cases = this.turn.cases ?? [];
            if (cases.length) {
              const tests = [...(this.turn.wrote?.keys() ?? [])].filter(isTestPath).map((rel) => { try { return readFileSync(join(this.cwd, rel), 'utf8'); } catch { return ''; } }).join('\n');
              const missing = untested(cases, tests);
              if (!missing.length) this.turn.casesDone = true;
              else if ((this.turn.casesBacks ?? 0) < 2) {
                this.turn.casesBacks = (this.turn.casesBacks ?? 0) + 1;
                this.emit('note', { text: `${missing.length} of the ${cases.length} cases in its plan have no test yet: sent back (${this.turn.casesBacks} of 2).`, tone: 'warn' });
                this.messages.push({ role: 'user', content: auto(casesBack(missing)) });
                continue;
              } else {
                this.turn.casesDone = true;
                this.emit('note', { text: `Untested cases from its plan: ${missing.map((c) => c.example).join(' · ')}`, tone: 'warn' });
              }
            }
          }
          // Case review (cases.mjs): once a message, when the cases have their tests or their send-backs are
          // used up, a call of its own reads the changed code against each case; what reads wrong goes back once.
          if (this.turn.changed && this.model?.remote && this.hook('case-review') && !this.turn.caseReviewed && this.turn.cases?.length && !signal?.aborted) {
            this.turn.caseReviewed = true;
            const read = await this.reviewCases(signal);
            if (read && !signal?.aborted) { this.messages.push({ role: 'user', content: auto(read) }); continue; }
          }
          // It changed files and says it is done: does the work cover every
          // part of the request? Once per message; a miss sends it back. Not
          // after you were asked to look at the page yourself (askPage).
          if (this.turn.changed && this.verify && !verified && !signal?.aborted && this.hook('done') && !this.turn.pageAsked) {
            verified = true;
            const miss = await this.verifyDone(text, signal);
            if (miss) {
              this.emit('note', { text: `Not finished: ${miss}`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`A quick check (it can be wrong) thinks this may be missing: ${miss}. Look once. If it is actually fine, say so in one sentence and stop; otherwise fix it with the tools, run the tests if there are any, then report.`) });
              continue;
            }
          }
          // Second opinion (/subagents): another model on the service reads the request and
          // the diff; what it finds goes back once. It can be wrong, and the model is told so.
          // /agents asks it at its own moments instead (agents-run.mjs: reviewInTurn off).
          if (this.turn.changed && !reviewed && !signal?.aborted && this.turn.diffs && this.reviewInTurn !== false && this.helperUse('review')) {
            reviewed = true;
            const found = await this.secondOpinion(signal);
            if (found) { this.messages.push({ role: 'user', content: auto(found) }); continue; }
          }
          // Second look (second-look.mjs): the answer against what happened, once a message, after real work.
          if (!signal?.aborted && text.trim()) {
            const back = await this.lookDue(text, signal);
            if (signal?.aborted) { reason = 'interrupted'; break; }
            if (back) { this.messages.push({ role: 'user', content: auto(back) }); continue; }
          }
          // Your Stop hooks (user-hooks.mjs): exit 2 sends it back to work with what the hook says,
          // STOP_BACKS times at most in one message (stop_hook_active says it was sent back already).
          if (this.userHooks?.has('Stop') && !this.isHelper && !signal?.aborted && stopBacks < STOP_BACKS) {
            const r = await this.userHooks.run('Stop', { stop_hook_active: stopBacks > 0, last_assistant_message: text }, { signal, permissionMode: this.mode });
            if (r.block) {
              stopBacks++;
              this.emit('note', { text: `Your stop hook sent it back: ${(r.reason || 'it said no').split('\n')[0].slice(0, 160)}`, tone: 'dim' });
              this.messages.push({ role: 'user', content: auto(`A hook of the user's says the work is not done: ${r.reason || 'it said no'}. Carry on, then report.`) });
              continue;
            }
          }
          break;
        }
        // One call at a time on App (the prompt asks for it; extra calls were dropped
        // above); when the model decides, each call of the reply in order, each with its
        // own result. A call that ends the turn (you said no, you stopped it) ends the
        // rest too: they get a result that says so, as the conversation needs one each.
        let out = null;
        let stopped = null;
        let landed = false;
        const wrote = []; // the Writes of this reply that saved (a page among them: askPage)
        // Several helpers in one reply on the Claude API run side by side (each has its own
        // conversation there); on this Mac one after the other, on the server's side slot.
        const together = calls.length > 1 && calls.every((c) => c.name === 'Agent') && endpointOf(this.url)?.kind === 'claude' ? Promise.all(calls.map((c) => this.runTool(c, signal))) : null;
        for (const [ci, c] of calls.entries()) {
          if (stopped || signal?.aborted) {
            this.messages.push({ role: 'tool', tool_call_id: c.id, content: stopped ? 'Not run: a call before it in the same reply ended the turn.' : 'Interrupted.' });
            continue;
          }
          toolsUsed++;
          out = together ? (await together)[ci] : await this.runTool(c, signal);
          // It looked at something besides an MCP server (a file, a search, a command): see the MCP send-back above.
          if (!out.error && !isMcpCall(c.name) && !['List', 'TodoWrite', 'Ask'].includes(c.name)) this.turn.lookedElsewhere = true;
          if (c.name === 'Read' && !out.error) this.turn.readsRun = (this.turn.readsRun ?? 0) + (out.readKeys?.length || 1);
          // A look of its own at the project (lookFirst below): a read, a search, a list, a command that only reads.
          if (!out.error && (LOOK_TOOLS.has(c.name) || (c.name === 'Bash' && isReadOnly(String(parseArgs('Bash', c.args).args?.command ?? ''))))) this.turn.lookedOwn = true;
          if (!out.error) { cuts = 0; landed = true; } // a step landed: cut-off replies are no longer "in a row"
          if (!out.error && c.name === 'Write') wrote.push(c);
          // A background job that ended meanwhile is told with this step's result.
          const news = this.takeJobNews();
          // One file a reply, twice in a row, when the model decides (6 Oct 2026: Qwen3.6 on the service read
          // seven files in seven replies, ~1.5 s each, though its tools say Read takes several): once a
          // message, a line on the end of that result says so.
          const oneRead = calls.length === 1 && c.name === 'Read' && !out.error && !(out.readKeys?.length > 1);
          this.turn.readsInRow = oneRead ? (this.turn.readsInRow ?? 0) + 1 : 0;
          const readTip = oneRead && this.way === 'model' && this.turn.readsInRow >= 2 && !this.turn.readTip && !oldSteps() ? READ_TIP : '';
          if (readTip) this.turn.readTip = true;
          const result = { role: 'tool', tool_call_id: c.id, content: `${news ? `${out.text}\n\n(Meanwhile: ${news})` : out.text}${readTip}`, ...(out.images?.length ? { images: out.images } : {}) };
          this.messages.push(result);
          if (out.error) this.noteError(out.text, result);
          else if (/^(?:Rules\/)?SKILLS\//.test(String(out.text))) result.keep = 'skill';
          if (out.images?.length) this.ctxUsed += out.images.length * IMAGE_TOKENS;
          for (const r of out.readKeys ?? (out.readKey ? [out] : [])) this.turn.reads.set(r.readKey, { msg: result, mtime: r.mtime, ...(r.next ? { outline: Boolean(r.outline), next: r.next, total: r.total } : {}) });
          if (out.stop) stopped = out.stop;
        }
        if (stopped) { reason = stopped; break; }
        if (signal?.aborted) { reason = 'interrupted'; break; }
        // Its plan and your request, with this step's result, when it has not seen them for a while,
        // and the line that brings it back when the check says it moved off (on the end, so the
        // conversation before it is not read again).
        const plan = this.planDue(calls);
        const chased = this.noteChaseDue(`${turn.reasoning ?? ''}\n${text ?? ''}`);
        const asked = chased ? '' : this.requestDue();
        const nudge = await this.driftDue(signal);
        if (signal?.aborted) { reason = 'interrupted'; break; }
        const cases = await this.casesDue(calls, signal);
        if (signal?.aborted) { reason = 'interrupted'; break; }
        const follow = this.followDue(calls, text);
        // A loop's notes: those a focused path read before it handed over (carriedNotes), then any typed since.
        const stepped = this.messages.at(-1)?.role === 'tool';
        const fresh = stepped ? this.steering?.() ?? [] : [];
        const typed = [...(stepped ? this.carriedNotes?.splice(0) ?? [] : []), ...fresh];
        const said = typed.length ? `(A note from the user, sent while you worked: ${typed.join(' · ')})` : '';
        const extra = [plan, chased, asked, nudge, cases, ...follow, said].filter(Boolean);
        if (extra.length && this.messages.at(-1)?.role === 'tool') {
          this.messages.at(-1).content += `\n\n${extra.join('\n')}`;
          if (fresh.length) this.emit('steered', { notes: fresh });
          if (plan) this.emit('note', { text: `Reminded it of its plan: ${plan.match(/\d+ of \d+ steps done/)[0]}`, tone: 'dim' });
          if (asked) this.emit('note', { text: 'Reminded it of your request', tone: 'dim', fold: true });
        }
        // A page saved for this request: the turn stops here, the page opens, and you are asked
        // before anything checks it (askPage). Once a message; after that the end of it asks.
        const page = wrote.length && !this.turn.pageAsked && this.askFirst() ? this.savedPage(wrote) : null;
        if (page) {
          const a = await this.askPage([page], signal, { saved: true });
          if (a.end) { reason = a.end; break; }
          if (a.send) { if (a.fix) layoutSends++; this.messages.push({ role: 'user', content: a.send }); continue; }
        }
        // The check-ins and the "make the change now" note look at the reply's last call.
        const call = calls.at(-1);
        const steer = this.hook('checkin') ? await this.checkIn(call, signal) : null;
        const checkedIn = Boolean(steer?.asked);
        if (steer?.stop) { reason = steer.stop; break; }
        if (steer?.text) this.messages.push({ role: 'user', content: steer.text });
        else {
          const go = this.hook('next-step') ? this.actNow(call, lines) : null;
          if (go) {
            this.messages.push({ role: 'user', content: auto(go) });
            this.emit('note', { text: 'It named the cause; asked it to make the change now.', tone: 'dim' });
          }
        }
        const key = calls.map((c) => `${c.name}:${c.args}`).join('\n');
        // A Read moved on to a long file's next part (runTool) got new lines: not a repeat.
        const paged = this.turn.paged;
        this.turn.paged = false;
        // A command that says something new is not the same step again (a job watched, a list after a change).
        // Numbers apart: a test run's times differ every run, and the same failing run is the same step.
        const outText = String(out?.text ?? '');
        const sameWords = (a, b) => a.replace(/\d+(?:\.\d+)?/g, '#') === b.replace(/\d+(?:\.\d+)?/g, '#');
        const saidNew = key === repeatKey && calls.length === 1 && calls[0].name === 'Bash' && !sameWords(outText, repeatOut);
        repeats = key === repeatKey && !paged && !saidNew ? repeats + 1 : 0;
        repeatKey = key;
        repeatOut = outText;
        // Looking again is not being stuck yet: a model reads a file twice to have it fresh, and the third Read
        // gives the text again (runTool). For looks the question, and the stop after it, come one step later.
        const askAt = calls.length && calls.every((c) => LOOK_TOOLS.has(c.name)) ? 3 : 2;
        // A reply of only TodoWrite calls that failed is not one more error in a row: a plan sent in the
        // wrong shape harms no work (4 Oct 2026: Qwen3.6 was stopped by five of them, the repeat stop still holds).
        errorsInRow = landed ? 0 : calls.length && calls.every((c) => c.name === 'TodoWrite') ? errorsInRow : errorsInRow + 1;
        this.turn.errorsInRow = errorsInRow;
        if (repeats > askAt || errorsInRow >= 5) {
          reason = 'stuck';
          this.emit('note', { text: repeats > askAt ? 'It kept repeating the same step, so it stopped. Try rephrasing the task, or give it a hint.' : 'Five tool errors in a row, so it stopped. Try rephrasing the task, or give it a hint.', tone: 'warn' });
          await this.lastWord(repeats > askAt ? 'you kept repeating the same step' : 'five steps in a row failed', signal);
          break;
        }
        // The same step a second time: the app says why nothing changed, to the model and in that step's own
        // words (sameStepNote), and you are not asked (5 Oct 2026, the owner's picks: before, the second time
        // asked you at once, with one choice, Keep going, which let it do the same again).
        if (repeats === 1) {
          const plan = this.turn.planAt != null ? this.todos ?? [] : [];
          const said = sameStepNote(call?.name, outText, plan.find((x) => x.status === 'pending')?.text ?? '');
          if (said) this.messages.push({ role: 'user', content: auto(said) });
        }
        // Stuck: the same step a third time (a look: a fourth), or three errors in a row, and it asks you,
        // with ways out as choices. An answer starts the counts over; a step asked about once is not asked
        // about again in this message (Read of one file six times asked three times in a minute, 2 Oct).
        // With no one to answer (coding -p, the practice bench) it carries on and the limits above stop it.
        const repeatAsk = repeats === askAt && !this.turn.stuckSteps.has(key);
        if ((repeatAsk || errorsInRow === 3) && this.checkIns && !checkedIn && this.hook('stuck')) {
          const s2 = await this.stuckAsk(repeatAsk ? 'repeat' : 'errors', call, out, signal, { tries: repeats + 1 });
          if (s2?.stop) { reason = s2.stop; break; }
          if (s2?.text) this.messages.push({ role: 'user', content: s2.text });
          if (repeatAsk && s2?.text) this.turn.stuckSteps.add(key);
          if (s2?.text) { repeats = 0; repeatKey = null; errorsInRow = 0; }
        }
        if (repeats === askAt) this.messages.push({ role: 'user', content: auto(SAME_STEP) });
        if (step === this.maxSteps - 1) { reason = 'limit'; this.emit('note', { text: `Stopped after ${this.maxSteps} steps (/effort moves this).`, tone: 'warn' }); }
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: e.message, tone: 'error' }); }
    } finally {
      this.busy = false;
      try {
        const why = this.putBackWhy(reason);
        // A bench that scores part of the work (AGENTIC_PUT_BACK=off; the model shootout, 4 Oct 2026):
        // the changes stay to be scored, and the note says what the app would have done.
        if (why && process.env.AGENTIC_PUT_BACK === 'off') this.emit('note', { text: `${why}: the app would put this message's changes back; they stay to be scored (AGENTIC_PUT_BACK=off).`, tone: 'dim' });
        else if (why) {
          const { back, left } = this.putBack();
          if (back.length) this.emit('note', { text: `${why}, so this message's changes were put back: ${back.join(', ')}.`, tone: 'warn' });
          if (left.length) this.emit('note', { text: `Not put back, because they changed after the last edit: ${left.join(', ')}.`, tone: 'warn' });
        }
      } catch (e) { this.emit('note', { text: `Could not put the changes back (${e.message}).`, tone: 'warn' }); }
      this.turn?.scratch?.dispose();
    }
    if (reason === 'interrupted') {
      this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    }
    const t = this.turn ?? {};
    // The prompt cache of a model on another machine: the notes that went with this request stay
    // in it, written in, so the next message starts from the same text the service has cached. Left
    // to come and go, they changed the request and the service read everything after it again.
    if (this.remoteSet()) this.bakeTurnNotes();
    await this.stillBroken(reason);
    await this.deliverDesktop(reason);
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, steps: t.steps ?? 0, reads: (t.readsRun ?? 0) + (t.given ?? 0), readFirst: t.ranked?.files?.length ?? 0, thinkTokens: t.thinkTokens ?? 0, tokens: t.tokens ?? 0, stuckAsks: t.stuckAsks ?? 0, made: this.madeSummary() });
    return reason;
  }
}
