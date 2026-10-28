// The Agent's loop (agent.mjs): one message worked through, step after step, until it answers.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { endpointOf } from '../../../models/index.mjs';
import { sameStepNote } from './questions.mjs';
import { oldSteps, parseArgs } from './tools.mjs';
import { isReadOnly } from './permissions.mjs';
import { isHomeFolder } from './prompt.mjs';
import { sortBug } from './rules.mjs';
import { pickSkill, readSkills } from './prompt-files.mjs';
import { mathIndex, sortMath } from './expertise.mjs';
import { isSmallTalk, routeByRules } from '../flows/index.mjs';
import { clarify } from '../flows/clarify.mjs';
import { isFollowUp } from '../flows/words.mjs';
import { isMemoryRequest } from './memory.mjs';
import { IMAGE_TOKENS } from './images.mjs';
import { RESTARTED_PROMPT } from './self.mjs';
import { MCP_TOOL, callHint, isMcpCall, mcpCallInText } from './mcp.mjs';
import { CALL_MARK, EXPLAIN, LOOK_TOOLS, MAX_CALLS, MCP_BACKS, READ_TIP, SAME_STEP, asksTheUserDirectly, auto, bareCallInText, beforeCall, cutCallNote, kTok, keptPart, keptWriteNote, keyLines, safeArgs, toolCallInText } from './agent-said.mjs';

export class WorkPart {
  async work(text, { signal, images, wake = false } = {}) {
    this.warmCtl?.abort(); // the last answer's warm-up (agent-model.mjs warmNext): this message takes over
    this.loadChanges();
    this.busy = true;
    const started = Date.now();
    const turnStart = this.messages.length;
    ({ text, images } = await this.picturesFirst(text, images, signal));
    this.messages.push({ role: 'user', content: text, ...(images?.length ? { images } : {}) });
    if (images?.length) this.ctxUsed += images.length * IMAGE_TOKENS;
    if (this.happened) this.happened.message = this.messages.at(-1);
    this.emit('turn-start', { started });
    // The model decides (way.mjs): no word rules pick a path for it, not even for a greeting.
    // Only the loop below runs.
    const decides = this.way === 'model' || wake;
    if (!decides && isSmallTalk(text)) { this.happened.small = true; return this.chat(text, started, signal); }
    // "update memory" / "remember that …": saved straight to the memory file, never a question about where,
    // whoever decides (9 Oct 2026, the owner's pick: qwen3-coder-next deciding answered "update memory"
    // twice with a find command written out and never run, and nothing was saved).
    if (!wake && isMemoryRequest(text)) { this.happened.small = true; return this.updateMemory(text, started, signal); }
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
    // one goes into it once you say yes (src/agent/projects.mjs). Not the app's own note after a restart
    // (14 Oct 2026): its words "Agentic Coder" named the app's repo, so a window restarted in the home
    // folder stopped on "Work in …/agentic-coder?" with the reply's timer running, and looked frozen.
    const into = text === RESTARTED_PROMPT ? null : await this.offerProject(text, signal);
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
    // (The model that decides calls them itself: Rename and TestFirst.) A model that takes none (models/runtime/
    // remote.mjs OWN_REMOTES focused: false, Bonsai 2 9B) goes straight to step by step.
    this.carried = null;
    if (!decides && !follow && this.flows && this.mode !== 'plan' && !images?.length && !skill && this.model?.focused !== false) {
      const ended = await this.focusedPaths(text, started, signal);
      if (ended) return ended;
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
      // Its task type and skill as /profiles names them (profiles.mjs): with the model deciding, the word rules' sort.
      type: kind ?? (follow ? this.lastRoute?.kind : routeByRules(text)?.kind) ?? null, skillSlug: skill?.slug ?? null,
      // A helper agent of yours with a model of its own (runHelper): every step on that model.
      ...(this.ownUse ? { use: this.ownUse } : {}) };
    const lookFloor = await this.turnNotes(text, request, signal, { follow, kind, bug, skill, math });
    let lookBacks = 0;
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
      // The step limit (/effort's Steps): reached with the work not done, it asks you whether to keep
      // going (as many steps again) when someone can answer; else it stops, as before.
      let stepLimit = this.maxSteps || Infinity; // 0: no limit, as /effort's Steps
      for (let step = 0; ; step++) {
        if (step >= stepLimit) {
          const more = this.checkIns && typeof this.ask === 'function' && !this.isHelper ? await this.limitAsk(step, signal) : null;
          if (more?.stop === 'interrupted') { reason = 'interrupted'; break; }
          if (!more?.more) { reason = 'limit'; this.emit('note', { text: `Stopped after ${step} steps (/effort moves this).`, tone: 'warn' }); break; }
          stepLimit += this.maxSteps || Infinity;
          if (more.text) this.messages.push({ role: 'user', content: more.text });
        }
        if (signal?.aborted) { reason = 'interrupted'; break; }
        // Its profile first (profile-router.mjs): a change made since the last step moves it here.
        await this.followProfile();
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
          const st = { reason, nudges, stopBacks, checks, cuts, lookBacks, verified, doneUnchanged, unlooked, unreal, lostChecked, layoutSends, layoutDone, looked, pageReads, reviewed, desktopSent, correctedAlready, blankRetry, leakBacks };
          let next;
          try { next = await this.answerChecks(st, { text, signal, images, started, turnStart, again, skill, request, toolsUsed, lookFloor, turn, assistant }); } finally { ({ reason, nudges, stopBacks, checks, cuts, lookBacks, verified, doneUnchanged, unlooked, unreal, lostChecked, layoutSends, layoutDone, looked, pageReads, reviewed, desktopSent, correctedAlready, blankRetry, leakBacks } = st); }
          if (next === 'continue') continue;
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
          // Fix + review first (agent-pages.mjs polishPage): what is broken or looks off goes back once each.
          const fix = await this.polishPage(signal);
          if (signal?.aborted) { reason = 'interrupted'; break; }
          if (fix) { this.messages.push({ role: 'user', content: auto(fix) }); continue; }
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
    // A model on a service with the local set (Bonsai 2 9B) has that cache too (28 Oct 2026).
    if (this.remoteSet() || this.model?.remote) this.bakeTurnNotes();
    await this.stillBroken(reason);
    await this.deliverDesktop(reason);
    if (reason !== 'interrupted') this.warmNext();
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, steps: t.steps ?? 0, reads: (t.readsRun ?? 0) + (t.given ?? 0), readFirst: t.ranked?.files?.length ?? 0, thinkTokens: t.thinkTokens ?? 0, tokens: t.tokens ?? 0, stuckAsks: t.stuckAsks ?? 0, made: this.madeSummary() });
    return reason;
  }
}
