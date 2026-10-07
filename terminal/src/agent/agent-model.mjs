// The Agent's talk with the model (agent.mjs): one reply streamed, a plain chat, the last word, and how
// much it thinks (the step-down and the cap).
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { endpointOf } from '../../../models/index.mjs';
import { streamChat } from './client.mjs';
import { isBusy } from './busy.mjs';
import { display } from './tools.mjs';
import { SERVICE_REPLY } from './room.mjs';
import { oldThinking } from '../flows/llm.mjs';
import { replyTiming } from './timing.mjs';
import { CALL_STOPS, CALL_UNREADABLE, STEP_DOWN_CAP, STUCK_WORD, auto, beforeCall, isLooping, kTok, leakedThinking, replyRoom, tokensOf, toolCallInText } from './agent-said.mjs';

export class ModelPart {
  // Past half this request's time for thinking (THINK_BUDGET_SECS): true, and the first time a
  // note says so. Never with thinking off, a budget of 0, or AGENTIC_THINK=old.
  // Not while steps are failing in a row (4 Oct 2026, the owner's pick: it stepped down right after a
  // script failed, and three quick fixes in a row failed too); it steps down after one that works.
  // Nor on a service that takes no thinking cap (capsThinking): there it could only say so.
  steppedDown() {
    if (!this.thinking || !(this.thinkBudgetSecs > 0) || !this.requestStarted || oldThinking() || !this.capsThinking()) return false;
    if (Date.now() - this.requestStarted < this.thinkBudgetSecs * 500) return false;
    if (this.turn?.errorsInRow > 0) return false;
    if (this.steppedAt == null) {
      this.steppedAt = Date.now();
      this.emit('note', { text: `Half of the ${Math.round(this.thinkBudgetSecs / 60)} minutes for this request used: thinking briefly from here, to finish in time`, tone: 'dim', fold: true });
    }
    return true;
  }

  // The same step-down on an Ollama service, which takes no cap: past half the request's time its replies are
  // asked for with thinking off (about 1.3 s there for the switch). 5 Oct 2026: Qwen3.6 thought two to three
  // minutes in single steps, 12 of its 25 minutes, and ran out of time in four runs of six. Not while steps
  // are failing in a row, as above. (gpt-oss cannot stop thinking: off is its lowest level.)
  serviceSteppedDown() {
    if (!this.thinking || !(this.thinkBudgetSecs > 0) || !this.requestStarted || oldThinking() || !endpointOf(this.url)?.ollama) return false;
    if (Date.now() - this.requestStarted < this.thinkBudgetSecs * 500) return false;
    if (this.turn?.errorsInRow > 0) return false;
    if (this.steppedAt == null) {
      this.steppedAt = Date.now();
      this.emit('note', { text: `Half of the ${Math.round(this.thinkBudgetSecs / 60)} minutes for this request used: thinking is off from here, to finish in time`, tone: 'dim', fold: true });
    }
    return true;
  }

  // Whether the service ends the thinking at a cap of ours (client.mjs thinking_budget_tokens): llama.cpp,
  // this Mac's server and `coding serve`, does; Ollama, OpenAI-style services and the Claude API take
  // none, and there Reply length holds the thinking and the answer (4 Oct 2026: a remote run showed
  // "39 of 64" after the step-down, a cap the service never had).
  capsThinking() {
    const ep = endpointOf(this.url);
    return !(ep?.ollama || ep?.kind === 'openai' || ep?.kind === 'claude');
  }

  // The effort of this turn's next reply. High is for working the problem out: once this turn
  // has changed a file, the steps left (run the tests, report) think at Medium. Not for a model
  // whose template writes the effort at the very top of the prompt (effortAtTop, Bonsai): there
  // a new effort is a new prompt from its first word, so the server reads the whole conversation
  // again (1 Oct 2026, Bonsai at 16k: 3 minutes each time, three times in one turn). The notes
  // call takes the same, so the conversation it reads is the one already read.
  stepEffort() {
    return this.effort === 'high' && this.turn?.changed && !this.model?.effortAtTop && !this.levelInPrompt() ? 'medium' : this.effort;
  }
  // gpt-oss on an Ollama service: its thinking level is written into the system message (the
  // harmony format's "Reasoning: …"), so a new level is a new prompt from its first lines and the
  // service reads the whole conversation again, as with effortAtTop above.
  levelInPrompt() {
    const ep = endpointOf(this.url);
    return Boolean(ep?.ollama && /gpt-?oss/i.test(`${ep.family ?? ''} ${this.turn?.use?.model ?? ep.model ?? ''}`));
  }

  // A turn stopped as stuck still answers the user: one short reply without tools, saying
  // what it found, what blocked it and what to try. Without a usable reply (it wrote a call,
  // nothing, or the service failed), the app says what the turn did. Before (3 Oct 2026) the
  // user got only the warning line after five minutes of work.
  async lastWord(why, signal) {
    if (signal?.aborted) return;
    let text = '';
    let turn = null;
    try {
      this.messages.push({ role: 'user', content: auto(STUCK_WORD(why)) });
      turn = await this.generate(signal, { textOnly: true, maxTokens: 700 });
      if (!turn.aborted) text = beforeCall(turn.text ?? '').trim();
      if (turn.calls?.length || toolCallInText(text)) text = '';
    } catch (e) { if (signal?.aborted || e.name === 'AbortError') return; }
    if (signal?.aborted) return;
    if (!text) {
      const did = (this.happened?.did ?? []).slice(-6).map((d) => `- ${d.replace(/\s+/g, ' ').slice(0, 120)}`);
      text = `I stopped because ${why}, before I had an answer.${did.length ? `\nThe last steps:\n${did.join('\n')}` : ''}\nTell me where to look or what to try, or rephrase the task.`;
    }
    this.messages.push({ role: 'assistant', content: text });
    this.emit('assistant', { text, reasoning: turn?.reasoning ?? '', secs: turn?.secs ?? 0, thinkSecs: turn?.thinkSecs ?? 0, tokens: turn?.tokens ?? 0, final: true });
  }

  // A greeting or thanks: one short reply, no tools, no focused paths.
  async chat(said, started, signal) {
    let reason = 'done';
    try {
      await this.fitContext(signal);
      // Room to think first (at your effort level), then a short answer, then stop.
      const turn = await this.generate(signal, { textOnly: true, maxTokens: 900 });
      if (turn.aborted) {
        reason = 'interrupted';
        // Keep what it had written so far on screen, as the loop does.
        if (turn.reasoning || turn.text) this.emit('assistant', { text: turn.text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: false, partial: true });
      } else {
        // It should not call a tool here; if it writes one out anyway, or
        // nothing at all, keep a plain greeting instead.
        // (With tools off it once wrote "Hello!…" and then a Read call as text.)
        let text = beforeCall(turn.text).trim();
        if (turn.calls.length || toolCallInText(text) || !text) text = /\b(thanks|thank you|thx|ty)\b/i.test(said) ? 'You’re welcome.' : 'Hello! What would you like to work on?';
        this.messages.push({ role: 'assistant', content: text });
        this.emit('assistant', { text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: true });
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: e.message, tone: 'error' }); }
    } finally {
      this.busy = false;
    }
    if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000 });
    return reason;
  }

  // One model reply, streamed.
  async generate(signal, { retry = true, textOnly = false, maxTokens: cap, focus, noThink = false } = {}) {
    // A retry after an answer that skipped the MCP tool its request is about (mcpFocus): this one
    // step offers only that tool, and thinks (a model that cannot think answers without it).
    if (focus === undefined) { focus = this.turn?.mcpFocus ?? null; if (this.turn) this.turn.mcpFocus = null; }
    const thinking = (this.thinking || Boolean(focus)) && !noThink && !this.turn?.overThought && !this.serviceSteppedDown();
    const sampling = thinking ? this.model.thinkingSampling : this.model.sampling;
    // A model on a service with its own Reply length (/effort): up to that, never more than the
    // context has left under the trim line (at least the answer's 2,048).
    // One that cannot think (a single level: a remote's None) gets no room for thinking.
    // Auto on a service: SERVICE_REPLY, the same way (its thinking and its file both fit).
    const own = this.turn?.roomUp || this.model?.replyTokens || (this.model?.remote?.ollama ? SERVICE_REPLY : 0);
    const thinks = thinking && (this.model?.thinkingLevels?.length ?? 2) > 1;
    const maxTokens = cap ?? (own ? Math.max(2048, Math.min(own, Math.floor(this.ctx * this.trimAt) - this.estNow())) : replyRoom(thinks, this.model?.thinkingBudget));
    this.lastRoom = maxTokens;
    // fitContext keeps the answer's 2,048 and this much thinking free: in a tight
    // memory the thinking shrinks (thinkRoom), not the answer.
    const think = this.thinkRoom();
    const thinkCap = thinking && think < (this.model?.thinkingBudget ?? 2048) ? think : undefined;
    const effort = this.stepEffort();
    const t0 = Date.now();
    let firstToken = null;
    let thinkEnd = null;
    let measured = null; // the server's own speed for this request (llama.cpp, Ollama); none from the Claude API or OpenRouter
    let written = 0; // the tokens the service says it wrote, for timing one that sends no speed
    let served = null; // what the service says it spent on this reply (agent/timing.mjs)
    const turn = { reasoning: '', text: '', calls: [], finish: null, tokens: 0 };
    // The tokens added since the model's last reply (tool results, notes; not its own reply): all a perfect
    // cache would have to read. The whole conversation after a restart from notes, or a new one.
    const since = this.timedTo && this.messages[this.timedTo - 1] === this.timedLast ? this.timedTo : 0;
    const fresh = this.messages.slice(since).filter((m) => m.role !== 'assistant').reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')), 0);
    this.timedTo = this.messages.length;
    this.timedLast = this.messages.at(-1);
    const clock = (cut = null) => this.emit('timing', replyTiming({ start: t0, firstToken, timings: served, fresh, cut,
      out: served?.predicted_n || written || tokensOf(turn.reasoning + turn.text + turn.calls.filter(Boolean).map((c) => c.args).join('')),
      think: turn.reasoning ? tokensOf(turn.reasoning) : 0, thinkSecs: turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0 }));
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    // Stopped already (during the warm-up, say): the listener above never fires then, so the
    // request would go out and run to its end. It is not sent.
    if (signal?.aborted) local.abort();
    // The screen's meters: the most this reply may write, and its thinking cap.
    // whole: an Ollama service sends a tool call whole when it is written, so a long one streams nothing (screen.jsx says so).
    // The thinking meter's limit: where the service takes no cap, the reply's room, which holds it.
    // An Ollama service takes no thinking cap, so the app holds one itself: a reply that thinks past the
    // model's thinking budget is stopped and asked for once more with thinking off (5 Oct 2026: one reply
    // of Qwen3.6 thought for 14 minutes, 28.4k tokens, to the end of its reply room, in a 25-minute task).
    const serviceCap = thinking && endpointOf(this.url)?.ollama ? this.model?.thinkingBudget ?? 4096 : 0;
    this.emit('waiting', { room: maxTokens, thinkCap: !thinking ? 0 : serviceCap ? serviceCap : !this.capsThinking() ? maxTokens : this.steppedDown() ? STEP_DOWN_CAP : thinkCap ?? this.model?.thinkingBudget ?? 2048, whole: Boolean(endpointOf(this.url)?.ollama) });
    this.answering = (this.answering ?? 0) + 1;
    try {
      // Text only: the model may still start writing a call out as text, so the server stops there.
      const stream = streamChat({ url: this.url, conversation: this.conversation, messages: this.withTurnNotes(this.messages), tools: focus ? this.mcpFocusTools(focus) : this.tools(), toolChoice: textOnly ? 'none' : 'auto', extra: (() => { const conn = textOnly ? [] : this.mcpConnectors(); return textOnly || conn.length ? { ...(textOnly ? { stop: CALL_STOPS } : {}), ...(conn.length ? { mcpServers: conn } : {}) } : undefined; })(), thinking, effort, model: this.model, sampling, maxTokens, thinkCap, slot: this.slots?.main, signal: local.signal, parallel: this.way === 'model' && !textOnly, use: this.turn?.use });
      for await (const ev of stream) {
        if (ev.type !== 'done' && firstToken === null) firstToken = Date.now();
        if (ev.type === 'reasoning') {
          turn.reasoning += ev.text;
          this.emit('reasoning', { text: ev.text, all: turn.reasoning });
          if (isLooping(turn.reasoning)) { turn.looping = true; local.abort(); break; }
          if (serviceCap && turn.reasoning.length > serviceCap * 3 && tokensOf(turn.reasoning) > serviceCap) { turn.overThought = true; local.abort(); break; }
        } else if (ev.type === 'text') {
          if (thinkEnd === null && turn.reasoning) thinkEnd = Date.now();
          turn.text += ev.text;
          this.emit('text', { text: ev.text, all: turn.text });
          if (isLooping(turn.text)) { turn.looping = true; local.abort(); break; }
        } else if (ev.type === 'tool') {
          if (thinkEnd === null && turn.reasoning) thinkEnd = Date.now();
          const c = (turn.calls[ev.index] ??= { id: ev.id, name: '', args: '' });
          if (ev.id) c.id = ev.id;
          if (ev.name) c.name += ev.name;
          c.args += ev.args;
          this.emit('tool-writing', { name: c.name, args: c.args, tokens: tokensOf(c.args) });
          if (isLooping(c.args)) { turn.looping = true; local.abort(); break; }
        } else if (ev.type === 'busy') {
          // The service said "too many requests": the client waits and asks again (busy.mjs).
          const secs = Math.max(1, Math.round(ev.waitMs / 1000));
          this.emit('note', { text: ev.shared
            ? `Another window was told the service is busy: waiting ${secs} s with it, then asking (try ${ev.next} of ${ev.of}).`
            : `The service is busy: too many requests right now. Trying again in ${secs} s (try ${ev.next} of ${ev.of}). Your conversation stays as it is.`, tone: 'warn' });
          this.emit('busy', { waitMs: ev.waitMs, until: Date.now() + ev.waitMs, next: ev.next, of: ev.of });
        } else if (ev.type === 'server') {
          // A web search or page, or a search for tools, done on the server's side (the Claude API): shown as a finished step.
          this.emit('tool', { id: ev.id, name: ev.name, ...(ev.shown ?? display(ev.name, ev.args)), view: ev.view, error: ev.error });
        } else if (ev.type === 'done') {
          turn.finish = ev.finish;
          if (ev.usage) this.ctxUsed = (ev.usage.prompt_tokens ?? 0) + (ev.usage.completion_tokens ?? 0);
          written = ev.usage?.completion_tokens ?? 0;
          measured = ev.timings?.predicted_per_second ?? null;
          served = ev.timings ?? null;
          if (ev.timings) {
            this.stats.tps = ev.timings.predicted_per_second ?? this.stats.tps;
            if ((ev.timings.prompt_n ?? 0) > 50) this.stats.pps = ev.timings.prompt_per_second;
            turn.tokens = ev.timings.predicted_n ?? 0;
          }
        }
      }
    } catch (e) {
      if (!turn.looping && !turn.overThought) clock(signal?.aborted ? 'stopped' : 'failed');
      if (turn.looping || turn.overThought) { /* aborted on purpose */ }
      else if (signal?.aborted) {
        turn.secs = (Date.now() - t0) / 1000;
        turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
        return { ...turn, aborted: true };
      }
      // The connection broke (not an answer from the server: one that says no carries its status,
      // and a service's "llama-server process has terminated" is such an answer).
      else if (retry && !e.status && /fetch failed|ECONNREFUSED|socket|terminated/i.test(`${e.message} ${e.cause?.message ?? ''}`) && this.waitForServer) {
        this.emit('note', { text: this.model?.remote ? 'The remote model stopped answering; connecting again…' : 'The model server stopped; restarting it and trying again…', tone: 'warn' });
        await this.waitForServer();
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap, focus });
      // Nothing came for minutes and a limit on the way gave up (Bun's own fetch did after 6 minutes, "The
      // operation timed out.", until client.mjs turned it off: 4 Oct 2026, Qwen3.6 on a shared service with
      // a 165k-token conversation). Asked once more; a second time, it says so in words.
      } else if (e?.name === 'TimeoutError' || /operation timed out/i.test(e?.message ?? '')) {
        if (!retry) throw Object.assign(new Error('The model service sent nothing back in time, twice: it may be busy with other work, or the conversation too long for it to read again quickly (/compact shortens it).'), { cause: e });
        this.emit('note', { text: 'The model service sent nothing back for minutes (busy, or reading a long conversation again); asking once more…', tone: 'warn' });
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap, focus });
      // A tool call the service could not read (Ollama's parser: "XML syntax error on line 17:
      // unexpected EOF", Qwen3.6, 3 Oct 2026): the reply is lost, so the model is told and writes it again,
      // twice at most a message. Before, the message ended there as an error.
      } else if (CALL_UNREADABLE.test(e.message) && this.turn && (this.turn.unreadable ?? 0) < 2) {
        this.turn.unreadable = (this.turn.unreadable ?? 0) + 1;
        this.emit('note', { text: `The service could not read the tool call it wrote (${String(e.message).replace(/^model server:\s*/, '').slice(0, 120)}); asked it to send the call again.`, tone: 'warn' });
        this.messages.push({ role: 'user', content: auto('The service could not read the tool call in your last reply: its arguments were cut off or not valid. Send the call again, complete and valid.') });
        return this.generate(signal, { retry, textOnly, maxTokens: cap, focus });
      // A conversation too long for the model. Not a busy service: "Rate limit exceeded" is a 429,
      // already waited for and asked again (busy.mjs); summarizing would only lose the conversation.
      // Nor a model with no room on the service's GPU (its error ends "a smaller Context": 2 Oct 2026,
      // a CUDA out-of-memory summarized the conversation away and failed again).
      } else if (retry && !e.busy && !isBusy(e) && !e.noRoom && /context|exceed/i.test(e.message)) {
        this.emit('note', { text: 'The conversation outgrew the model’s memory; summarizing it and trying again…', tone: 'warn' });
        await this.compact(signal);
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap, focus });
      } else throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this.answering--;
    }
    if (turn.overThought) {
      clock('thought past the cap');
      this.stats.outTokens += tokensOf(turn.reasoning);
      // And the rest of this request with it off: thinking stopped at the cap is thrown away, and a model that
      // passes it once passes it again (5 Oct 2026: six capped replies in one run, about 100 s each, 10 of its 25 minutes).
      if (this.turn) this.turn.overThought = true;
      this.emit('note', { text: `It thought past ${kTok(serviceCap)} in one reply (the service takes no thinking cap): that reply is asked for again with thinking off, and so is the rest of this request.`, tone: 'dim' });
      return this.generate(signal, { retry, textOnly, maxTokens: cap, focus, noThink: true });
    }
    turn.calls = turn.calls.filter(Boolean).filter((c) => c.name);
    // Thinking written into the answer (<think>, Qwen's <|mask_start|>): it goes with the thinking.
    const leak = leakedThinking(turn.text);
    if (leak) { turn.reasoning = [turn.reasoning, leak.thought].filter(Boolean).join('\n'); turn.text = leak.text; turn.leaked = true; }
    turn.tokens ||= tokensOf(turn.reasoning + turn.text + turn.calls.map((c) => c.args).join(''));
    this.stats.outTokens += turn.tokens;
    this.stats.requests++;
    turn.secs = (Date.now() - t0) / 1000;
    turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
    clock(turn.looping ? 'repeating itself' : null);
    // The footer's gauges on a remote (app/remote-footer.mjs): the time to this request's first
    // token, and its speed, timed here when the service sends none; the last 8 speeds of the
    // model in use (speedsOf names it, so another model starts its own).
    if (firstToken) {
      this.stats.ttft = (firstToken - t0) / 1000;
      const writing = (Date.now() - firstToken) / 1000;
      const speed = measured ?? ((written || turn.tokens) > 20 && writing > 0.2 ? (written || turn.tokens) / writing : null);
      if (speed) {
        if (!measured) this.stats.tps = speed;
        const who = this.model?.remote?.model ?? this.model?.id ?? null;
        this.stats.speeds = [...(this.stats.speedsOf === who ? this.stats.speeds ?? [] : []), speed].slice(-8);
        this.stats.speedsOf = who;
      }
    }
    this.emit('stats', { ...this.stats, ctxUsed: this.ctxUsed, ctx: this.ctx, replyRoom: replyRoom(this.thinking, this.thinkRoom()) });
    return turn;
  }
}
