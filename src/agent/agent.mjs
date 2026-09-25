// The agent loop: send the conversation to the model, stream what comes
// back, run the tool it asks for (asking you first when needed), feed the
// result back, and repeat until it answers without a tool.
import { EventEmitter } from 'node:events';
import { streamChat } from './client.mjs';
import { toolSchemas, parseArgs, display, prepare, execute, resolvePath } from './tools.mjs';
import { decide, commandPrefix } from './permissions.mjs';
import { testCommand } from './prompt.mjs';
import { runFlows } from '../flows/index.mjs';
import { readResults } from '../flows/results.mjs';
import { runCommand } from '../tools/run.mjs';
import { complete } from '../flows/llm.mjs';
import { diffLines } from '../tools/edit.mjs';

const MAX_STEPS = 40;
const tokensOf = (s) => Math.ceil((s?.length ?? 0) / 3.6);

// A reply that keeps repeating a short piece ("// // // //") is a known
// failure of low-bit models; catch it while it streams.
export function isLooping(text) {
  const tail = text.slice(-240);
  if (tail.length < 120) return false;
  for (let unit = 1; unit <= 12; unit++) {
    const piece = tail.slice(-unit);
    if (!piece.trim()) continue;
    let reps = 0;
    for (let i = tail.length - unit; i >= 0 && tail.slice(i, i + unit) === piece; i -= unit) reps++;
    if (reps * unit >= 100 && reps >= 10) return true;
  }
  return false;
}

// A reply whose last sentence says what it is about to do ("Let me fix the
// median function in stats.mjs.") instead of doing it.
export function announcesNextStep(text) {
  const last = text.trim().split(/(?<=[.!?:])\s+(?=[A-Z])/).pop() ?? '';
  return /\b(I will|I'll|I am going to|I'm going to|Let me|Let's|I need to|I should|First,? I|Next,? I|Now,? I)\b/i.test(last);
}

// A tool call written as text instead of a real call: <tool_call>{...}</tool_call>
export function toolCallInText(text) {
  // The 27B's own format: <tool_call><function=Name><parameter=key>value</parameter>…</function></tool_call>
  const x = /<tool_call>\s*<function=([^>\s]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/.exec(text);
  if (x) {
    const args = {};
    for (const p of x[2].matchAll(/<parameter=([^>\s]+)>\n?([\s\S]*?)\n?<\/parameter>/g)) args[p[1]] = paramValue(p[2]);
    return { name: x[1], args: JSON.stringify(args), before: text.slice(0, x.index).trim() };
  }
  // JSON inside the tags, as other Qwen-style models write it.
  const m = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[1]);
    if (typeof j.name !== 'string') return null;
    return { name: j.name, args: typeof j.arguments === 'string' ? j.arguments : JSON.stringify(j.arguments ?? {}), before: text.slice(0, m.index).trim() };
  } catch { return null; }
}

// A parameter value is text unless it is clearly JSON (a number, true/false,
// null, an object or a list).
function paramValue(v) {
  if (/^\s*(-?\d+(\.\d+)?|true|false|null|\{[\s\S]*\}|\[[\s\S]*\])\s*$/.test(v)) {
    try { return JSON.parse(v); } catch {}
  }
  return v;
}

// The chat template needs each call's arguments as a JSON object; a call the
// model garbled would make every later request fail, so keep "{}" instead.
export function safeArgs(args) {
  try {
    const j = JSON.parse(args || '{}');
    return j && typeof j === 'object' && !Array.isArray(j) ? JSON.stringify(j) : '{}';
  } catch { return '{}'; }
}

export class Agent extends EventEmitter {
  constructor({ url, model, cwd, system, thinking = true, effort, ctx = 32768, mode = 'ask', ask, waitForServer, verify = true, flows = true, maxTries = 8, slots }) {
    super();
    Object.assign(this, { url, model, cwd, thinking, effort: effort ?? model?.thinkingEffort, ctx, mode, ask, waitForServer, verify, flows, maxTries });
    // When Bonsai Code started the server itself it has two slots: the
    // conversation stays in 0, side requests (sorting, tries) use 1.
    this.slots = slots ?? null;
    // How this project runs its tests; used to check a change before calling it done.
    this.testCmd = verify ? testCommand(cwd) : null;
    this.messages = [{ role: 'system', content: system }];
    this.allowedPrefixes = new Set();
    this.readFiles = new Set(); // files read (or written) in this conversation
    this.todos = null;
    this.ctxUsed = tokensOf(system) + 1200; // system + tool definitions, until the server reports
    this.busy = false;
    this.stats = { tps: null, pps: null, outTokens: 0, requests: 0 };
  }

  setSystem(system) { this.messages[0] = { role: 'system', content: system }; }
  setMode(mode) { this.mode = mode; this.emit('mode', mode); }
  reset(system) { this.messages = [{ role: 'system', content: system ?? this.messages[0].content }]; this.todos = null; this.readFiles = new Set(); this.ctxUsed = tokensOf(this.messages[0].content) + 1200; }

  get maxResultChars() { return Math.max(4000, Math.floor(this.ctx * 0.15 * 3.6)); }

  // What the focused paths (src/flows) need from the agent.
  flowContext(signal) {
    let seq = 0;
    const tool = (label, arg, view, error) => this.emit('tool', { id: `flow_${++seq}`, name: label, label, arg, view, error });
    return {
      url: this.url, model: this.model, slot: this.slots?.side, cwd: this.cwd, testCmd: this.testCmd ?? testCommand(this.cwd), signal, maxTries: this.maxTries,
      emit: (name, ev) => this.emit(name, ev),
      ask: (req) => this.ask(req),
      mode: () => this.mode,
      setMode: (m) => this.setMode(m),
      tool,
      note: (text, tone = 'dim') => this.emit('note', { text, tone }),
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
          const d = diffLines(before, after).hunk.map((l) => `${l.type}${l.text}`).join('\n').slice(0, 3000);
          const r = await complete({ url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0.2, maxTokens: 70, system: 'You describe code changes in one short plain sentence.', user: `The change to ${rel}:\n${d}\n\nIn one short sentence, what does this change do?` });
          const one = r.text.trim().split('\n')[0].replace(/^["']|["']$/g, '');
          return one ? `${one.replace(/\.?$/, '.')} ` : '';
        } catch { return ''; }
      },
    };
  }

  // One user message → as many model turns and tools as it takes.
  async send(text, { signal } = {}) {
    this.busy = true;
    const started = Date.now();
    this.messages.push({ role: 'user', content: text });
    this.emit('turn-start', { started });
    // First the focused paths (rename / fix / change); the loop handles the rest.
    if (this.flows && this.mode !== 'plan') {
      try {
        const r = await runFlows(this.flowContext(signal), text);
        if (r) {
          this.emit('flow-step', null);
          this.messages.push({ role: 'assistant', content: r.summary });
          this.emit('assistant', { text: r.summary, reasoning: '', secs: 0, thinkSecs: 0, tokens: 0, final: true });
          this.busy = false;
          const reason = signal?.aborted ? 'interrupted' : r.declined ? 'declined' : 'done';
          if (reason === 'interrupted') this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
          this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000, flow: true, done: r.done });
          return reason;
        }
      } catch (e) {
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
    let reason = 'done';
    let repeatKey = null;
    let repeats = 0;
    let errorsInRow = 0;
    let nudges = 0;
    let checks = 0;
    this.turn = { changed: false, testedAfterChange: false };
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (signal?.aborted) { reason = 'interrupted'; break; }
        await this.fitContext(signal);
        const turn = await this.generate(signal);
        if (turn.aborted) {
          // Keep what it had written so far on screen (not in the conversation).
          if (turn.reasoning || turn.text) this.emit('assistant', { text: turn.text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: false, partial: true });
          reason = 'interrupted';
          break;
        }
        if (turn.looping) {
          this.messages.push({ role: 'assistant', content: turn.text.slice(0, 200) });
          this.messages.push({ role: 'user', content: 'Your last reply started repeating itself. Try again, briefly.' });
          this.emit('note', { text: 'The model started repeating itself; asked it to try again.', tone: 'warn' });
          continue;
        }
        let calls = turn.calls;
        let text = turn.text;
        if (!calls.length) {
          // A call written as text, or (thinking mode) written inside the thinking.
          const inText = toolCallInText(turn.text) ?? (!turn.text.trim() ? toolCallInText(turn.reasoning) : null);
          if (inText) { calls = [{ id: `call_${Date.now()}`, name: inText.name, args: inText.args }]; text = turn.text.trim() ? inText.before : ''; }
        }
        // Only the first call runs, so only the first is kept in the history
        // (otherwise the model waits for results that never come).
        calls = calls.slice(0, 1);
        const assistant = { role: 'assistant', content: text };
        if (calls.length) assistant.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: safeArgs(c.args) } }));
        this.messages.push(assistant);
        this.emit('assistant', { text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: !calls.length });
        if (!calls.length) {
          // Small models often announce the next step ("First, I will…") and
          // stop. Tell them to go ahead, at most twice per message.
          if (nudges < 2 && announcesNextStep(text)) {
            nudges++;
            this.messages.push({ role: 'user', content: 'Go ahead and do that now, using the tools.' });
            continue;
          }
          if (!text.trim() && turn.finish === 'length') {
            this.messages.push({ role: 'user', content: 'You ran out of room while thinking. Think less and take the next step.' });
            this.emit('note', { text: 'The model ran out of room while thinking; asked it to act.', tone: 'warn' });
            continue;
          }
          // It says it is done after changing files but never ran the tests:
          // run them (through the normal permission prompt); if they fail, send
          // it back to fix them. At most twice per message.
          if (this.testCmd && this.turn.changed && !this.turn.testedAfterChange && checks < 2) {
            checks++;
            const call = { id: `check_${Date.now()}`, name: 'Bash', args: JSON.stringify({ command: this.testCmd, description: 'Check the change with the project’s tests' }) };
            assistant.tool_calls = [{ id: call.id, type: 'function', function: { name: 'Bash', arguments: call.args } }];
            this.emit('note', { text: `Checking the change: ${this.testCmd}`, tone: 'dim' });
            const out = await this.runTool(call, signal);
            this.messages.push({ role: 'tool', tool_call_id: call.id, content: out.text });
            if (out.stop) { reason = out.stop; break; }
            if (out.error) {
              this.messages.push({ role: 'user', content: 'The tests fail (output above). Find what is wrong in your change, fix it with Edit, then run the tests again.' });
              continue;
            }
          }
          break;
        }
        // One call at a time (the prompt asks for it; extra calls are ignored).
        const call = calls[0];
        const out = await this.runTool(call, signal);
        this.messages.push({ role: 'tool', tool_call_id: call.id, content: out.text });
        if (out.stop) { reason = out.stop; break; }
        const key = `${call.name}:${call.args}`;
        repeats = key === repeatKey ? repeats + 1 : 0;
        repeatKey = key;
        errorsInRow = out.error ? errorsInRow + 1 : 0;
        if (repeats >= 3 || errorsInRow >= 5) {
          reason = 'stuck';
          this.emit('note', { text: repeats >= 3 ? 'It kept repeating the same step, so it stopped. Try rephrasing the task, or give it a hint.' : 'Five tool errors in a row, so it stopped. Try rephrasing the task, or give it a hint.', tone: 'warn' });
          break;
        }
        if (repeats === 2) this.messages.push({ role: 'user', content: 'You already did exactly this step. Do something different, or finish.' });
        if (step === MAX_STEPS - 1) { reason = 'limit'; this.emit('note', { text: `Stopped after ${MAX_STEPS} steps.`, tone: 'warn' }); }
      }
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') reason = 'interrupted';
      else { reason = 'error'; this.emit('note', { text: e.message, tone: 'error' }); }
    } finally {
      this.busy = false;
    }
    if (reason === 'interrupted') {
      this.messages.push({ role: 'user', content: '[The user interrupted you. Wait for their next message.]' });
    }
    this.emit('turn-end', { reason, secs: (Date.now() - started) / 1000 });
    return reason;
  }

  // One model reply, streamed.
  async generate(signal, { retry = true } = {}) {
    const sampling = this.thinking ? this.model.thinkingSampling : this.model.sampling;
    const maxTokens = this.thinking ? 4096 : 2048;
    const t0 = Date.now();
    let firstToken = null;
    let thinkEnd = null;
    const turn = { reasoning: '', text: '', calls: [], finish: null, tokens: 0 };
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.emit('waiting');
    try {
      const stream = streamChat({ url: this.url, messages: this.messages, tools: toolSchemas(), thinking: this.thinking, effort: this.effort, model: this.model, sampling, maxTokens, slot: this.slots?.main, signal: local.signal });
      for await (const ev of stream) {
        if (ev.type !== 'done' && firstToken === null) firstToken = Date.now();
        if (ev.type === 'reasoning') {
          turn.reasoning += ev.text;
          this.emit('reasoning', { text: ev.text, all: turn.reasoning });
          if (isLooping(turn.reasoning)) { turn.looping = true; local.abort(); break; }
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
        } else if (ev.type === 'done') {
          turn.finish = ev.finish;
          if (ev.usage) this.ctxUsed = (ev.usage.prompt_tokens ?? 0) + (ev.usage.completion_tokens ?? 0);
          if (ev.timings) {
            this.stats.tps = ev.timings.predicted_per_second ?? this.stats.tps;
            if ((ev.timings.prompt_n ?? 0) > 50) this.stats.pps = ev.timings.prompt_per_second;
            turn.tokens = ev.timings.predicted_n ?? 0;
          }
        }
      }
    } catch (e) {
      if (turn.looping) { /* aborted on purpose */ }
      else if (signal?.aborted) {
        turn.secs = (Date.now() - t0) / 1000;
        turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
        return { ...turn, aborted: true };
      }
      else if (retry && /fetch failed|ECONNREFUSED|socket|terminated/i.test(`${e.message} ${e.cause?.message ?? ''}`) && this.waitForServer) {
        this.emit('note', { text: 'The model server stopped; restarting it and trying again…', tone: 'warn' });
        await this.waitForServer();
        return this.generate(signal, { retry: false });
      } else if (retry && /context|exceed/i.test(e.message)) {
        this.emit('note', { text: 'The conversation outgrew the model’s memory; summarizing it and trying again…', tone: 'warn' });
        await this.compact(signal);
        return this.generate(signal, { retry: false });
      } else throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    turn.calls = turn.calls.filter(Boolean).filter((c) => c.name);
    turn.tokens ||= tokensOf(turn.reasoning + turn.text + turn.calls.map((c) => c.args).join(''));
    this.stats.outTokens += turn.tokens;
    this.stats.requests++;
    turn.secs = (Date.now() - t0) / 1000;
    turn.thinkSecs = turn.reasoning ? ((thinkEnd ?? Date.now()) - (firstToken ?? t0)) / 1000 : 0;
    this.emit('stats', { ...this.stats, ctxUsed: this.ctxUsed, ctx: this.ctx });
    return turn;
  }

  async runTool(call, signal) {
    const parsed = parseArgs(call.name, call.args);
    const shown = display(call.name, parsed.args ?? {});
    const id = call.id;
    if (parsed.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: parsed.error }, error: true });
      return { text: parsed.error, error: true };
    }
    const args = parsed.args;
    const env = { cwd: this.cwd, signal, maxResultChars: this.maxResultChars, setTodos: (t) => { this.todos = t; this.emit('todos', t); } };
    let prepared;
    try { prepared = prepare(call.name, args, env); } catch (e) { prepared = { error: `${call.name} failed: ${e.code ?? e.message}` }; }
    if (prepared.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: prepared.error }, error: true });
      return { text: prepared.error, error: true };
    }
    // Like Claude Code: an existing file must be read before it is edited, so
    // old_text is copied from what is really there.
    if (call.name === 'Edit' && prepared.abs && !this.readFiles.has(prepared.abs)) {
      const msg = `Read ${prepared.rel} first, then copy old_text from it exactly.`;
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: msg }, error: true });
      return { text: msg, error: true };
    }
    const inside = args.path ? resolvePath(this.cwd, args.path).inside : true;
    const d = decide(call.name, args, { mode: this.mode, allowedPrefixes: this.allowedPrefixes, inside });
    if (d.decision === 'deny') {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: d.reason }, error: true });
      return { text: `Not allowed: ${d.reason}. Do something else.`, error: true };
    }
    if (d.decision === 'ask') {
      this.emit('tool-ask', { id, name: call.name, ...shown });
      const answer = await this.ask({ id, name: call.name, args, prepared, ...shown });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (answer.choice === 'no') {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
        return { text: `The user said no to this${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}`, error: true, stop: answer.feedback ? null : 'declined' };
      }
      if (answer.choice === 'always') {
        if (call.name === 'Bash') this.allowedPrefixes.add(commandPrefix(args.command));
        else this.setMode('edits');
      }
    }
    const t0 = Date.now();
    this.emit('tool-running', { id, name: call.name, ...shown });
    let out;
    try { out = await execute(call.name, args, prepared, env); } catch (e) { out = { text: `${call.name} failed: ${e.code ?? e.message}`, error: true, view: { kind: 'error', message: e.code ?? e.message } }; }
    if (!out.error && call.name === 'Read') this.readFiles.add(resolvePath(this.cwd, args.path).abs);
    if (!out.error && (call.name === 'Edit' || call.name === 'Write') && prepared.abs) this.readFiles.add(prepared.abs);
    if (this.turn && !out.error && (call.name === 'Edit' || call.name === 'Write')) { this.turn.changed = true; this.turn.testedAfterChange = false; }
    if (this.turn && call.name === 'Bash' && this.turn.changed && (this.testCmd && args.command.includes(this.testCmd.split(' ').slice(-1)[0]) || /\btest\b/.test(args.command))) this.turn.testedAfterChange = true;
    this.emit('tool', { id, name: call.name, ...shown, view: out.view, error: out.error, secs: (Date.now() - t0) / 1000 });
    return out;
  }

  // Keep the conversation inside the model's memory: first empty old tool
  // outputs, then (if still too big) replace the history with a summary.
  async fitContext(signal) {
    const pending = this.messages.slice(-2).reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : ''), 0);
    let est = this.ctxUsed + pending;
    if (est < this.ctx * 0.72) return;
    let freed = 0;
    for (let i = 1; i < this.messages.length - 6; i++) {
      const m = this.messages[i];
      if (m.role === 'tool' && m.content.length > 300) {
        freed += tokensOf(m.content);
        m.content = `[older output removed to save space: ${m.content.slice(0, 120).replace(/\n/g, ' ')}…]`;
      }
    }
    est -= freed;
    this.ctxUsed = Math.max(0, this.ctxUsed - freed);
    if (freed) this.emit('note', { text: `Trimmed old tool output to save memory (about ${freed.toLocaleString()} tokens).`, tone: 'dim' });
    if (est >= this.ctx * 0.8) await this.compact(signal);
  }

  async compact(signal, { instructions } = {}) {
    if (this.messages.length <= 3) return;
    this.emit('note', { text: 'Summarizing the conversation to free memory…', tone: 'dim' });
    const history = this.messages.slice(1).map((m) => {
      if (m.role === 'tool') return `TOOL RESULT: ${String(m.content).slice(0, 600)}`;
      if (m.role === 'assistant') return `YOU: ${m.content}${m.tool_calls ? ` [called ${m.tool_calls.map((c) => `${c.function.name} ${c.function.arguments.slice(0, 200)}`).join('; ')}]` : ''}`;
      return `USER: ${m.content}`;
    }).join('\n').slice(-40000);
    const ask = [
      { role: 'system', content: 'You summarize a coding session so it can continue with less memory.' },
      { role: 'user', content: `${history}\n\nWrite a summary under 200 words: the user's task, what has been done, files changed, and what is left.${instructions ? ` ${instructions}` : ''}` },
    ];
    let summary = '';
    for await (const ev of streamChat({ url: this.url, messages: ask, thinking: false, sampling: this.model.sampling, maxTokens: 600, slot: this.slots?.side, signal })) {
      if (ev.type === 'text') summary += ev.text;
    }
    this.messages = [this.messages[0], { role: 'user', content: `Summary of the work so far:\n${summary.trim()}` }, { role: 'assistant', content: 'Understood. I will continue from here.' }];
    this.ctxUsed = tokensOf(this.messages[0].content) + tokensOf(summary) + 1300;
    this.emit('compacted', { summary: summary.trim() });
  }
}
