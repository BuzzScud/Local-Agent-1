// The agent loop: send the conversation to the model, stream what comes
// back, run the tool it asks for (asking you first when needed), feed the
// result back, and repeat until it answers without a tool.
import { EventEmitter } from 'node:events';
import { streamChat } from './client.mjs';
import { toolSchemas, parseArgs, display, prepare, execute, resolvePath, didYouMean } from './tools.mjs';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { outlineText } from '../tools/outline.mjs';
import { repoMap } from '../tools/repomap.mjs';
import { decide, commandPrefix } from './permissions.mjs';
import { testCommand, systemPrompt, projectNotes, gitSummary, isHomeFolder } from './prompt.mjs';
import { sortBug, kindText } from './rules.mjs';
import { findProjects, projectsNamed } from './projects.mjs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { runFlows, isSmallTalk, routeByRules } from '../flows/index.mjs';
import { clarify } from '../flows/clarify.mjs';
import { checkInText } from '../flows/fix.mjs';
import { readResults } from '../flows/results.mjs';
import { runCommand } from '../tools/run.mjs';
import { complete } from '../flows/llm.mjs';
import { diffLines } from '../tools/edit.mjs';

const MAX_STEPS = 40;
const TRIM_AT = 0.78; // share of the context that starts a trim
const TRIM_TO = 0.45; // …and where it stops
const FULL = 0.85; // past this share (with the reply room counted) trimming was not enough: summarize
// Room kept free for one reply: thinking (up to the server's reasoning budget)
// plus the answer. At 16k, a trim at 78% left too little, and a High reply
// ran into the end of the memory (chart bug, 25 Sep).
const replyRoom = (thinking) => (thinking ? 4096 : 2048);
// Its own thinking goes back with each step: the model's chat template shows
// every earlier step's thinking, and without it each step looked as if it had
// thought nothing, so it worked the cause out again (or lost it). The newest
// KEEP_THOUGHTS steps keep all of it; older ones keep only their key lines
// once memory runs short.
const KEEP_THOUGHTS = 3;
// A question that names files gets them read in one go (see prefetch).
const PREFETCH_MAX_LINES = 1000;
const PREFETCH_MAX_CHARS = 45000; // ~12,500 tokens, ~3½ minutes of reading
const MAP_MIN_FILES = 4; // fewer code files than this: no project map, the model just reads them
// Asking about code even when the request was not sorted (plan mode, a folder that is not a project).
const EXPLAIN = /\b(explain|describe|walk me through|summari[sz]e|what does|how does|what is in|tell me about)\b/i;

// Files a request names ("explain src/app/App.jsx", "what does export.mjs do?"):
// existing files inside the project, at most three.
export function filesNamed(cwd, text) {
  const out = [];
  for (const m of text.matchAll(/(?:^|[\s`'"(])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z]\w{0,5})(?=$|[\s`'",:;!?)]|\.(?:\s|$))/g)) {
    let rel = m[1];
    let p = resolvePath(cwd, rel);
    if (!existsSync(p.abs)) {
      const alt = didYouMean(cwd, rel);
      if (alt.length !== 1) continue;
      rel = alt[0];
      p = resolvePath(cwd, rel);
    }
    if (!p.inside || !statSync(p.abs).isFile() || out.some((f) => f.abs === p.abs)) continue;
    out.push({ rel: p.rel, abs: p.abs });
    if (out.length === 3) break;
  }
  return out;
}
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

// A reply that asks the user something: a question anywhere (outside code)
// or a request for input ("Give me a little detail and I'll dig in"). Such a
// reply ends the turn and waits: no "go ahead", no follow-up checks.
// Bonsai's own notes go into the conversation where the user's words go, so
// each one says it is automatic: once, a note ("the story is cut off") was
// taken as the user's report and the model spent 20 minutes on it.
export const AUTO = '[Automatic note from Bonsai, not from the user]';
const CUT_MARK = '[… cut here by Bonsai for this check; the rest is in the file]';
const auto = (text) => `${AUTO} ${text}`;

// A question put to the user: a sentence ending in "?" that speaks to them
// ("Are you seeing it in TextEdit?", "Should I…?"), or a request for input.
// "Why does it fail? Let me read the test." is thinking aloud, not this.
export function asksTheUserDirectly(text) {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  if (prose.split(/(?<=[.!?])\s+/).some((q) => /\?\s*["'”’)*_]*$/.test(q.trim()) && /\b(you|your|yours|should I|shall I|do I|would I)\b/i.test(q))) return true;
  return /\b(give me|point me|tell me|let me know|could you|would you|can you|do you want|would you like|want me to|which (?:one|file|folder|project) do you|what would you like|up to you|your call)\b/i.test(prose);
}

export function asksTheUser(text) {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  if (/\?(\s|$|["'”’)*_])/.test(prose)) return true;
  return /\b(give me|point me|tell me|let me know|could you|would you|can you|do you want|would you like|want me to|shall I|which (?:one|file|folder|project) do you|what would you like|up to you|your call)\b/i.test(prose);
}

// A reply whose last sentence says what it is about to do ("Let me fix the
// median function in stats.mjs.") instead of doing it.
export function announcesNextStep(text) {
  const last = text.trim().split(/(?<=[.!?:])\s+(?=[A-Z])/).pop() ?? '';
  // An offer that waits for the user ("tell me and I'll dig in", "If you want,
  // I can…", "Let me know…") or a question is not a step it is about to take.
  if (/\?\s*$|\b(if you|tell me|let me know|would you like|do you want|want me to|shall I)\b/i.test(last)) return false;
  return /\b(I will|I'll|I am going to|I'm going to|Let me|Let's|I need to|I should|First,? I|Next,? I|Now,? I)\b/i.test(last);
}

// An answer saying the work was already there ("The --json flag is already in
// place"), which is false when this turn created the file.
export function claimsAlreadyThere(text) {
  return /\b(?:already|was already|were already)\s+(?:in place|there|exists?|present|implemented|supported|set up|done|works?|working|has|had|in the (?:file|project|code))\b|\b(?:is|are|was|were)\s+already\b/i.test(text ?? '');
}

// Sentences where it names a cause or a fix ("The .hud creates a stacking
// context…", "So the problem: .hud has z-index:4."): they survive trims and
// summaries word for word, and one that names a fix before anything changed
// gets a "make the change now" note (see actNow).
const CAUSE = /\b(?:root cause|the cause|caused by|so the (?:problem|issue|bug)|the (?:real |actual |whole )?(?:problem|issue|bug|reason) (?:is|was|here)\b|that(?:'s| is) (?:why|the (?:bug|problem|cause))|which is why|this is why|that explains|explains (?:why|the)|stacking context|(?:is|are|gets?) (?:covered|hidden|overridden|shadowed) by)/i;
const FIX = /\b(?:the fix(?: is|:| would be| should be| here)|so the fix|to fix (?:this|it)[,:]|fix it by|the (?:simplest|smallest|one-line|real|right) (?:fix|change)|the solution is|(?:I|we) (?:need|have|should|must) to (?:change|raise|increase|lower|set|move|add|remove|replace|swap)|(?:raising|increasing|lowering|changing|setting) \S+(?: \S+){0,6} (?:to|from) \S+(?: \S+){0,3} (?:fixes|would fix|should fix|solves))/i;
const HEDGE = /^(?:wait|hmm|maybe|perhaps|if\b|unless|or\b|let me|let's|actually,? let me|i wonder)/i;
export function keyLines(text, max = 4) {
  const prose = String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
  const out = [];
  for (const s of prose.split(/(?<=[.!?])\s+|\n+/)) {
    const t = s.trim().replace(/^[-*•]\s+/, '');
    if (t.length < 25 || t.length > 400 || HEDGE.test(t) || !(CAUSE.test(t) || FIX.test(t))) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(-max);
}
export const namesAFix = (line) => FIX.test(line) || /^so the (?:problem|issue|bug)|^the (?:root )?cause|^that(?:'s| is) the (?:bug|problem|cause)/i.test(line);

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

// Check-ins while exploring: every this many looks, or seconds, without a change.
export const CHECK_INS = { steps: 8, secs: 300 };
const LOOKS = new Set(['Read', 'Search', 'List', 'Glob', 'Grep', 'Bash']);

// One line saying what an edit will do, for the plan question.
export function planLine(name, args, prepared) {
  const cut = (x) => { const l = String(x ?? '').trim().split('\n'); const f = l[0].trim().slice(0, 100); return l.length > 1 || l[0].length > 100 ? `${f}…` : f; };
  if (name === 'Write') return `${prepared.created ? 'create' : 'rewrite'} ${prepared.rel ?? args.path}`;
  return `in ${prepared.rel ?? args.path}, change "${cut(args.old_text)}" to "${cut(args.new_text)}"`;
}

export class Agent extends EventEmitter {
  constructor({ url, model, cwd, system, thinking = true, effort, ctx = 32768, mode = 'ask', ask, waitForServer, verify = true, flows = true, maxTries = 8, testTimeoutMs = 120_000, checkIns = CHECK_INS, confirmPlan = true, slots, trimAt = TRIM_AT }) {
    super();
    Object.assign(this, { url, model, cwd, thinking, effort: effort ?? model?.thinkingEffort, ctx, mode, ask, waitForServer, verify, flows, maxTries, testTimeoutMs, checkIns, confirmPlan, trimAt });
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
  // Work in another folder from now on: its tests, its AGENTS.md, and the fence
  // around commands, which is always the folder Bonsai works in.
  moveTo(dir) {
    const before = tokensOf(this.messages[0].content);
    this.cwd = dir;
    this.testCmd = this.verify ? testCommand(dir) : null;
    this.setSystem(systemPrompt({ cwd: dir, notes: projectNotes(dir).text, git: gitSummary(dir) }));
    this.ctxUsed += tokensOf(this.messages[0].content) - before;
    this.readFiles = new Set();
    this.mapGiven = false;
    this.lastRoute = null;
    this.emit('cwd', { cwd: dir });
  }

  // Outside a project, a request naming one ("the chart bug in MAIN2026") asks
  // once whether to work there. Each project is offered once a session.
  async offerProject(text, signal) {
    const home = homedir();
    // Only from the home folder or its Desktop, Documents and Downloads.
    if (!isHomeFolder(this.cwd)) return null;
    this.projects ??= findProjects(home);
    this.offered ??= new Set();
    const found = projectsNamed(text, this.projects, this.cwd).filter((d) => !this.offered.has(d));
    if (!found.length || found.length > 4) return null;
    for (const d of found) this.offered.add(d);
    const tilde = (p) => (p === home ? '~' : p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);
    const one = found.length === 1;
    const question = `${one ? `Work in ${tilde(found[0])}?` : 'Work in which project?'} Bonsai then uses its tests and its AGENTS.md, and its commands can only change files there.`;
    const options = [...found.map((d) => (one ? `Yes, work in ${basename(d)}` : tilde(d))), `No, stay in ${tilde(this.cwd)}`];
    const id = `project_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', args: { question, options }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    const said = (answer.text ?? answer.feedback ?? '').trim();
    if (answer.choice === 'no' && !said) return { stop: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: said } });
    const pick = one ? (/^(yes|y|ok|okay|sure|yep|go)\b/i.test(said) ? found[0] : null) : found.find((d) => said === tilde(d) || said === d);
    if (!pick) return null;
    this.moveTo(pick);
    this.emit('note', { text: `Working in ${tilde(pick)} now: its tests and AGENTS.md, and commands can only change files there.`, tone: 'dim' });
    return { moved: pick };
  }

  // This turn's request with the steps for its kind of bug added (see send()).
  withBugSteps(messages) {
    const bug = this.turn?.bug;
    return bug ? messages.map((m) => (m === bug.request ? { ...m, content: `${m.content}\n\n(${bug.steps})` } : m)) : messages;
  }
  setMode(mode) { this.mode = mode; this.emit('mode', mode); }
  reset(system) { this.messages = [{ role: 'system', content: system ?? this.messages[0].content }]; this.todos = null; this.readFiles = new Set(); this.mapGiven = false; this.ctxUsed = tokensOf(this.messages[0].content) + 1200; }

  get maxResultChars() { return Math.max(4000, Math.floor(this.ctx * 0.15 * 3.6)); }

  // What the focused paths (src/flows) need from the agent.
  flowContext(signal) {
    let seq = 0;
    const tool = (label, arg, view, error) => this.emit('tool', { id: `flow_${++seq}`, name: label, label, arg, view, error });
    return {
      url: this.url, model: this.model, slot: this.slots?.side, sideSlots: this.slots?.sides ?? (this.slots?.side !== undefined ? [this.slots.side] : []), cwd: this.cwd, testCmd: this.testCmd ?? testCommand(this.cwd), testTimeoutMs: this.testTimeoutMs, signal, maxTries: this.maxTries,
      // Code and tests are written at the chat's thinking level (Off by default).
      thinking: this.thinking, effort: this.effort,
      emit: (name, ev) => { if (name === 'route') this.lastRoute = ev; this.emit(name, ev); },
      ask: (req) => this.ask(req),
      confirm: (plan) => (this.confirmPlan ? this.confirm(plan, signal) : { ok: true }),
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
    const turnStart = this.messages.length;
    this.messages.push({ role: 'user', content: text });
    this.emit('turn-start', { started });
    if (isSmallTalk(text)) return this.chat(text, started, signal);
    this.lastRoute = null;
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
    // An unclear request gets one question first (src/flows/clarify.mjs); the
    // answer joins the conversation and travels with the request.
    if (this.flows && this.mode !== 'plan') {
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
    const kind = this.lastRoute?.kind ?? routeByRules(text)?.kind;
    // A bug brings the steps for its kind (terminal/rules/bug-fixing.md). They
    // go with this turn's requests to the model, not into the conversation.
    const bug = kind === 'fix' ? sortBug(text) : null;
    const request = this.messages.at(-1);
    // A question about named files: read them now, in one go, instead of
    // letting the model find, list and read them a piece at a time.
    this.prefetchMap();
    if (kind === 'question' || (!kind && EXPLAIN.test(text))) this.prefetch(text);
    let reason = 'done';
    let repeatKey = null;
    let repeats = 0;
    let errorsInRow = 0;
    let nudges = 0;
    let checks = 0;
    let toolsUsed = 0; // tool calls run for this message: a nudge is only for work already under way
    this.turn = { changed: false, testedAfterChange: false, created: [], asked: [], diffs: '', looked: [], since: Date.now(), planOk: false,
      // The request (and a question and answer before it): kept word for word when the conversation is summarized.
      opening: this.messages.slice(turnStart).filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls)),
      fixing: kind === 'fix', findings: [], nudged: 0, looksAtNudge: 0, reads: new Map() };
    if (bug && request?.role === 'user' && typeof request.content === 'string') {
      this.turn.bug = { request, steps: kindText(bug), kind: bug };
      // A check the request names scores the change instead of the whole suite
      // (the bug steps, step 7); for a kind the suite cannot see, with no
      // check named, the suite is not run at all — it would only mislead.
      this.turn.check = checkInText(text);
    }
    let verified = false;
    let correctedAlready = false;
    let blankRetry = false;
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
          this.messages.push({ role: 'user', content: auto('Your last reply started repeating itself. Try again, briefly.') });
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
        // A reply that puts a question to you ends the turn, even with a tool
        // call in it: the call is dropped and Bonsai waits for your answer.
        if (calls.length && text.trim() && asksTheUserDirectly(text)) calls = [];
        const assistant = { role: 'assistant', content: text };
        const thought = turn.reasoning.split('<tool_call>')[0].trim();
        if (thought) assistant.reasoning_content = thought;
        if (calls.length) assistant.tool_calls = calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: safeArgs(c.args) } }));
        this.messages.push(assistant);
        const lines = keyLines(`${thought}\n${text}`);
        for (const l of lines) if (!this.turn.findings.includes(l)) this.turn.findings.push(l);
        this.turn.findings = this.turn.findings.slice(-6);
        this.emit('assistant', { text, reasoning: turn.reasoning, secs: turn.secs, thinkSecs: turn.thinkSecs, tokens: turn.tokens, final: !calls.length });
        if (!calls.length) {
          // A reply that asks you something ends the turn: it waits for you.
          if (asksTheUser(text)) break;
          // Small models often announce the next step mid-task ("Now I will
          // update main().") and stop. Tell them to go ahead, at most twice per
          // message, and only once work is under way (a tool already ran).
          if (nudges < 2 && toolsUsed > 0 && announcesNextStep(text)) {
            nudges++;
            this.messages.push({ role: 'user', content: auto('You said what you will do next but did not do it. If you meant to, do it now with the tools; if you are waiting for the user, stop.') });
            continue;
          }
          // It created a file this turn, then says the work was already there.
          if (this.turn.created.length && claimsAlreadyThere(text)) {
            const files = this.turn.created.join(', ');
            if (!correctedAlready) {
              correctedAlready = true;
              this.messages.push({ role: 'user', content: auto(`You created ${files} in this turn; it did not exist before. Answer again in 1-3 sentences: say that you created it, what it does, and how you checked it. Do not say it was already there.`) });
              continue;
            }
            this.emit('note', { text: `Note: ${files} did not exist before; Bonsai created it just now.`, tone: 'warn' });
          }
          // A blank answer (seen once after "hello"): ask for one, once.
          if (!text.trim() && turn.finish !== 'length' && !blankRetry) {
            blankRetry = true;
            this.emit('note', { text: 'The model gave an empty answer; asked it to reply.', tone: 'dim' });
            this.messages.push({ role: 'user', content: auto('Reply to the user now, in one to three sentences.') });
            continue;
          }
          if (!text.trim() && turn.finish === 'length') {
            // Cut off after a few words: the memory was full, not the thinking too long.
            if (turn.tokens < 200) {
              this.messages.pop();
              await this.compact(signal);
              continue;
            }
            this.messages.push({ role: 'user', content: auto('You ran out of room while thinking. Think less and take the next step.') });
            this.emit('note', { text: 'The model ran out of room while thinking; asked it to act.', tone: 'warn' });
            continue;
          }
          // It says it is done after changing files but never ran the tests:
          // run them (through the normal permission prompt); if they fail, send
          // it back to fix them. At most twice per message.
          const checkCmd = this.turn.check ?? (this.turn.bug?.kind && !this.turn.bug.kind.testsSeeIt ? null : this.testCmd);
          if (checkCmd && this.turn.changed && !this.turn.testedAfterChange && checks < 2) {
            checks++;
            const call = { id: `check_${Date.now()}`, name: 'Bash', args: JSON.stringify({ command: checkCmd, description: this.turn.check ? 'Run the check the request names' : 'Check the change with the project’s tests' }) };
            assistant.tool_calls = [{ id: call.id, type: 'function', function: { name: 'Bash', arguments: call.args } }];
            this.emit('note', { text: `Checking the change: ${checkCmd}`, tone: 'dim' });
            const out = await this.runTool(call, signal);
            this.messages.push({ role: 'tool', tool_call_id: call.id, content: out.text });
            if (out.stop) { reason = out.stop; break; }
            if (out.error) {
              this.messages.push({ role: 'user', content: auto(`${this.turn.check ? 'The named check fails' : 'The tests fail'} (output above). Find what is wrong in your change, fix it with Edit, then run ${this.turn.check ? 'the check' : 'the tests'} again.`) });
              continue;
            }
          }
          // It changed files and says it is done: does the work cover every
          // part of the request? Once per message; a miss sends it back.
          if (this.turn.changed && this.verify && !verified && !signal?.aborted) {
            verified = true;
            const miss = await this.verifyDone(text, signal);
            if (miss) {
              this.emit('note', { text: `Not finished: ${miss}`, tone: 'warn' });
              this.messages.push({ role: 'user', content: auto(`A quick check (it can be wrong) thinks this may be missing: ${miss}. Look once. If it is actually fine, say so in one sentence and stop; otherwise fix it with the tools, run the tests if there are any, then report.`) });
              continue;
            }
          }
          break;
        }
        // One call at a time (the prompt asks for it; extra calls are ignored).
        const call = calls[0];
        toolsUsed++;
        const out = await this.runTool(call, signal);
        const result = { role: 'tool', tool_call_id: call.id, content: out.text };
        this.messages.push(result);
        if (out.readKey) this.turn.reads.set(out.readKey, { msg: result, mtime: out.mtime });
        if (out.stop) { reason = out.stop; break; }
        const steer = await this.checkIn(call, signal);
        if (steer?.stop) { reason = steer.stop; break; }
        if (steer?.text) this.messages.push({ role: 'user', content: steer.text });
        else {
          const go = this.actNow(call, lines);
          if (go) {
            this.messages.push({ role: 'user', content: auto(go) });
            this.emit('note', { text: 'It named the cause; asked it to make the change now.', tone: 'dim' });
          }
        }
        const key = `${call.name}:${call.args}`;
        repeats = key === repeatKey ? repeats + 1 : 0;
        repeatKey = key;
        errorsInRow = out.error ? errorsInRow + 1 : 0;
        if (repeats >= 3 || errorsInRow >= 5) {
          reason = 'stuck';
          this.emit('note', { text: repeats >= 3 ? 'It kept repeating the same step, so it stopped. Try rephrasing the task, or give it a hint.' : 'Five tool errors in a row, so it stopped. Try rephrasing the task, or give it a hint.', tone: 'warn' });
          break;
        }
        if (repeats === 2) this.messages.push({ role: 'user', content: auto('You already did exactly this step. Do something different, or finish.') });
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

  // In a project with several code files, the loop starts from the project
  // map (each file with its names) as if it had listed the project itself:
  // one read instead of a List → Read → List round at ~60 tokens a second.
  prefetchMap() {
    // No map of the home folder: it lists whatever code it meets first, and the
    // model took that as "your codebase" (src/agent/prompt.mjs, isHomeFolder).
    if (this.mapGiven || isHomeFolder(this.cwd)) return;
    this.mapGiven = true;
    let map;
    try { map = repoMap(this.cwd, { maxChars: 4500 }); } catch { return; }
    if (map.entries.length < MAP_MIN_FILES) return;
    const id = `map_${Date.now()}`;
    this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'List', arguments: JSON.stringify({ path: '.', pattern: '**/*' }) } }] });
    this.messages.push({ role: 'tool', tool_call_id: id, content: `Code files in the project (lines: top-level names):\n${map.text}` });
    this.emit('tool', { id, name: 'List', label: 'List', arg: 'the project map', view: { kind: 'list', count: map.entries.length, content: map.text } });
  }

  // Puts the files a question names into the conversation as if the model
  // had read them: whole when they fit, otherwise their outline.
  prefetch(text) {
    let budget = PREFETCH_MAX_CHARS;
    for (const f of filesNamed(this.cwd, text)) {
      if (this.readFiles.has(f.abs) || budget <= 0) continue;
      let body;
      let view;
      try {
        const full = readFileSync(f.abs, 'utf8');
        if (full.includes('\u0000')) continue;
        const lines = full.split('\n').length;
        if (lines <= PREFETCH_MAX_LINES && full.length <= budget) {
          body = `${f.rel} (${lines} lines):\n${full}`;
          view = { kind: 'read', lines, total: lines, content: full };
          this.readFiles.add(f.abs);
        } else {
          body = outlineText(full, f.rel);
          view = { kind: 'read', outline: true, parts: body.split('\n').length - 2, lines: 0, total: lines, content: body };
        }
      } catch { continue; }
      budget -= body.length;
      const id = `read_${Date.now()}_${f.rel.length}`;
      this.messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ path: f.rel }) } }] });
      this.messages.push({ role: 'tool', tool_call_id: id, content: body });
      this.emit('tool', { id, name: 'Read', label: 'Read', arg: f.rel, view });
    }
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
        let text = turn.text.split('<tool_call>')[0].trim();
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
  async generate(signal, { retry = true, textOnly = false, maxTokens: cap } = {}) {
    const sampling = this.thinking ? this.model.thinkingSampling : this.model.sampling;
    const maxTokens = cap ?? replyRoom(this.thinking); // fitContext keeps this much free
    // High effort is for working the problem out. Once this turn has changed a
    // file, the steps left (run the tests, report) think briefly instead.
    const effort = this.effort === 'high' && this.turn?.changed ? 'medium' : this.effort;
    const t0 = Date.now();
    let firstToken = null;
    let thinkEnd = null;
    const turn = { reasoning: '', text: '', calls: [], finish: null, tokens: 0 };
    const local = new AbortController();
    const onAbort = () => local.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.emit('waiting');
    try {
      // Text only: the model may still start writing a call out as text, so the server stops there.
      const stream = streamChat({ url: this.url, messages: this.withBugSteps(this.messages), tools: toolSchemas(), toolChoice: textOnly ? 'none' : 'auto', extra: textOnly ? { stop: ['<tool_call>'] } : undefined, thinking: this.thinking, effort, model: this.model, sampling, maxTokens, slot: this.slots?.main, signal: local.signal });
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
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap });
      } else if (retry && /context|exceed/i.test(e.message)) {
        this.emit('note', { text: 'The conversation outgrew the model’s memory; summarizing it and trying again…', tone: 'warn' });
        await this.compact(signal);
        return this.generate(signal, { retry: false, textOnly, maxTokens: cap });
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
    if (call.name === 'Ask') return this.askUser(id, args, shown, signal);
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
    const d = decide(call.name, args, { mode: this.mode, allowedPrefixes: this.allowedPrefixes, inside, cwd: this.cwd });
    if (d.decision === 'deny') {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: d.reason }, error: true });
      return { text: `Not allowed: ${d.reason}. Do something else.`, error: true };
    }
    // Edits on auto-accept: the first one of a message is shown as a plan first.
    if (d.decision !== 'ask' && (call.name === 'Edit' || call.name === 'Write') && this.turn && !this.turn.planOk && this.confirmPlan) {
      const plan = planLine(call.name, args, prepared);
      const r = await this.confirm(plan, signal);
      if (r.stop) return { text: 'Interrupted.', stop: r.stop };
      if (!r.ok) {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'declined', feedback: r.feedback }, error: true });
        return { text: r.feedback ? `Not done: before this change the user wrote: ${r.feedback}\nDo that instead.` : 'The user said no to this change. Wait for their next message.', error: true, stop: r.feedback ? null : 'declined' };
      }
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
      // You saw this change and said yes: that was the plan question.
      if ((call.name === 'Edit' || call.name === 'Write') && this.turn) this.turn.planOk = true;
    }
    // The same part of a file read again while the first read is still in the
    // conversation and the file has not changed: it points back instead of
    // adding the same text twice.
    let readKey = null;
    let mtime = null;
    if (call.name === 'Read' && this.turn?.reads) {
      const abs = resolvePath(this.cwd, args.path).abs;
      readKey = `${abs}|${args.offset ?? ''}|${args.limit ?? ''}`;
      try { mtime = statSync(abs).mtimeMs; } catch {}
      const seen = this.turn.reads.get(readKey);
      if (seen && seen.mtime === mtime && this.messages.includes(seen.msg) && !String(seen.msg.content).startsWith('[older output removed')) {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'same' } });
        return { text: `You already read this part of ${shown.arg ?? args.path} and it has not changed since; it is above. Use it, or read a different part.` };
      }
    }
    const t0 = Date.now();
    this.emit('tool-running', { id, name: call.name, ...shown });
    let out;
    try { out = await execute(call.name, args, prepared, env); } catch (e) { out = { text: `${call.name} failed: ${e.code ?? e.message}`, error: true, view: { kind: 'error', message: e.code ?? e.message } }; }
    if (readKey && !out.error) Object.assign(out, { readKey, mtime });
    if (!out.error && call.name === 'Read') this.readFiles.add(resolvePath(this.cwd, args.path).abs);
    if (!out.error && (call.name === 'Edit' || call.name === 'Write') && prepared.abs) this.readFiles.add(prepared.abs);
    if (this.turn && !out.error && (call.name === 'Edit' || call.name === 'Write')) {
      this.turn.changed = true;
      this.turn.testedAfterChange = false;
      // What changed this turn, for the check at the end (verifyDone).
      const hunk = (out.view?.hunk ?? []).filter((l) => l.type !== ' ').map((l) => `${l.type}${l.text}`).join('\n');
      // Up to 6,000 characters a file, 16,000 in all; anything longer is
      // marked as cut here, so the check never takes the cut for the file's end
      // (a 1,500-character cut once made a finished story look "cut off at 'sti'").
      const piece = hunk.length > 6000 ? `${hunk.slice(0, 6000)}\n${CUT_MARK}` : hunk;
      if (this.turn.diffs.length < 16000) this.turn.diffs += `${prepared.rel}:\n${piece}\n`;
    }
    if (this.turn && !out.error && call.name === 'Write' && prepared.created && !this.turn.created.includes(prepared.rel)) this.turn.created.push(prepared.rel);
    if (this.turn && call.name === 'Bash' && this.turn.changed && (this.testCmd && args.command.includes(this.testCmd.split(' ').slice(-1)[0]) || this.turn.check && args.command.includes(this.turn.check.split(' ').slice(-1)[0]) || /\btest\b/.test(args.command))) this.turn.testedAfterChange = true;
    this.emit('tool', { id, name: call.name, ...shown, view: out.view, error: out.error, secs: (Date.now() - t0) / 1000 });
    return out;
  }

  // A forced-JSON check of the finished work against the request: null when
  // covered, otherwise what is missing (one short sentence). Best effort.
  async verifyDone(answer, signal) {
    const request = [...this.messages].reverse().find((m) => m.role === 'user' && !/^\[|^Not done yet|^Go ahead|^The tests fail|^You created|^Reply to the user|^You ran out/.test(m.content))?.content ?? '';
    if (!request.trim() || !this.turn.diffs.trim()) return null;
    try {
      const r = await complete({ url: this.url, model: this.model, slot: this.slots?.side, signal, temperature: 0, maxTokens: 120,
        system: 'You check whether a coding assistant did everything a request asked. Judge only from the request, the changes and its report.',
        user: `Request:\n${request.slice(0, 2000)}\n\nChanges made (diff lines, + added, - removed; a line ${CUT_MARK} means Bonsai shortened the change for this check, not that anything is missing):\n${this.turn.diffs.length > 16000 ? `${this.turn.diffs.slice(0, 16000)}\n${CUT_MARK}` : this.turn.diffs}\n\nIts report:\n${(answer ?? '').slice(0, 1000)}\n\nIs every part of the request done? If something the request asks for is missing from the changes, say what in one short sentence.`,
        schema: { type: 'object', properties: { done: { type: 'boolean' }, missing: { type: 'string' } }, required: ['done', 'missing'] } });
      if (!r.json || r.json.done || !r.json.missing?.trim()) return null;
      return r.json.missing.trim().slice(0, 200);
    } catch { return null; }
  }

  // Fixing a bug, it named the cause or the fix, then went on looking: a note
  // says to make the change now (once; again only after 4 more looks with no
  // change). In the chart bug's High run the cause was in its thinking at
  // 8 minutes and it never changed a line.
  actNow(call, lines) {
    const t = this.turn;
    if (!t?.fixing || t.changed || !LOOKS.has(call.name)) return null;
    t.looks = (t.looks ?? 0) + 1;
    if (t.nudged >= 2 || t.looks < 3 || (t.nudged && t.looks - t.looksAtNudge < 4)) return null;
    const line = lines.filter(namesAFix).at(-1);
    if (!line) return null;
    t.nudged++;
    t.looksAtNudge = t.looks;
    return `You wrote: "${line}" If that is the cause, stop looking and make the smallest change that fixes it now (Read the exact lines first if they are not above). If one thing is still unclear, check only that.`;
  }

  // A check-in while it explores: after CHECK_INS.steps looks (Read, Search,
  // List, Bash) or CHECK_INS.secs seconds with no change made, it says what
  // it has looked at and asks where to look. The answer steers the next step.
  async checkIn(call, signal) {
    const t = this.turn;
    if (!t || !this.checkIns || t.changed || !LOOKS.has(call.name)) return null;
    const shown = display(call.name, parseArgs(call.name, call.args).args ?? {});
    t.looked.push(`${call.name} ${shown.arg ?? ''}`.trim());
    const secs = (Date.now() - t.since) / 1000;
    if (t.looked.length < this.checkIns.steps && secs < this.checkIns.secs) return null;
    const seen = [...new Set(t.looked)];
    const list = seen.slice(-8).join('; ');
    const question = `I have looked at ${seen.length} thing${seen.length === 1 ? '' : 's'} (${Math.round(secs / 60)} min) and not changed anything yet. Latest: ${list}. Am I on the right track? Tell me where to look, or say "keep going".`;
    t.looked = [];
    t.since = Date.now();
    const id = `checkin_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'checkin', args: { question, options: ['Keep going'] }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    if (answer.choice === 'no' && !answer.feedback) return { stop: 'declined' }; // "Stop here"
    const text = (answer.text ?? answer.feedback ?? '').trim();
    if (!text) return null; // no answer: carry on
    t.asked.push(question);
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text } });
    if (/^(keep going|go on|continue|carry on|yes|ok|okay|y)\W*$/i.test(text)) return null;
    return { text: `[Check-in] You asked whether you are on the right track. The user answered: ${text}\nFollow that.` };
  }

  // One yes-or-steer question before changing files; yes (or "ok", "go")
  // allows the rest of this message's changes.
  async confirm(plan, signal) {
    const question = `Before I change anything: ${plan}. Go ahead? Say yes, or tell me what to do instead.`;
    const id = `plan_${Date.now()}`;
    this.emit('tool-ask', { id, name: 'Ask', label: 'Ask', arg: question });
    const answer = await this.ask({ id, name: 'Ask', kind: 'plan', args: { question, options: ['Yes'] }, prepared: {}, label: 'Ask', arg: question });
    if (signal?.aborted) return { stop: 'interrupted' };
    const text = (answer.text ?? '').trim();
    const yes = answer.choice === 'yes' || answer.choice === 'always' || /^(yes|y|ok|okay|go|go ahead|sure|do it|yep|👍)\W*$/i.test(text);
    if (yes) {
      if (this.turn) this.turn.planOk = true;
      this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || 'yes' } });
      return { ok: true };
    }
    if (answer.choice === 'no' && !answer.feedback && !text) return { ok: false, stop: 'declined' };
    this.emit('tool', { id, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: text || answer.feedback } });
    return { ok: false, feedback: text || answer.feedback };
  }

  // The model's Ask tool: the question goes through the same prompt as a
  // permission (or the answers hook when there is no screen).
  async askUser(id, args, shown, signal) {
    const options = Array.isArray(args.options) ? args.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 4) : [];
    this.emit('tool-ask', { id, name: 'Ask', ...shown });
    const answer = await this.ask({ id, name: 'Ask', args: { question: args.question, options }, prepared: {}, ...shown });
    if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
    if (answer.choice === 'no' || !answer.text?.trim()) {
      this.emit('tool', { id, name: 'Ask', ...shown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
      return { text: `The user did not answer${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}`, error: true, stop: answer.feedback ? null : 'declined' };
    }
    const text = answer.text.trim();
    this.turn?.asked?.push(args.question);
    this.emit('tool', { id, name: 'Ask', ...shown, view: { kind: 'answer', question: args.question, text } });
    return { text: `The user answered: ${text}` };
  }

  // Keep the conversation inside the model's memory: first empty old tool
  // outputs, then (if still too big) replace the history with a summary.
  // Emptying an old output makes the model re-read everything after it, so
  // it happens rarely and deeply: past trimAt, the oldest outputs go until
  // the conversation is under TRIM_TO. (Trimming just enough once emptied the
  // file the model had just read, so it read it again, step after step.)
  async fitContext(signal) {
    const pending = this.messages.slice(-2).reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : ''), 0);
    // The next reply needs its room too: at 16k, trimming without counting it
    // let a High reply run into the end of the memory mid-thought.
    const room = replyRoom(this.thinking);
    let est = this.ctxUsed + pending;
    if (est + room < this.ctx * this.trimAt) return;
    let freed = 0;
    // Old thinking first: every step before the newest KEEP_THOUGHTS keeps
    // only its cause/fix lines (keyLines); the rest served its step already.
    const thoughts = this.messages.filter((m) => m.role === 'assistant' && m.reasoning_content);
    for (const m of thoughts.slice(0, -KEEP_THOUGHTS)) {
      const kept = keyLines(m.reasoning_content, 3).join(' ');
      if (kept === m.reasoning_content) continue;
      freed += Math.max(0, tokensOf(m.reasoning_content) - tokensOf(kept));
      if (kept) m.reasoning_content = kept;
      else delete m.reasoning_content;
    }
    // Then old tool outputs, oldest first, down to TRIM_TO.
    const tools = this.messages.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i > 0);
    const keep = new Set(tools.slice(-2)); // the two newest outputs stay
    for (const i of tools) {
      if (est - freed < this.ctx * TRIM_TO) break;
      const m = this.messages[i];
      if (keep.has(i) || m.content.length <= 300) continue;
      freed += tokensOf(m.content);
      m.content = `[older output removed to save space: ${m.content.slice(0, 120).replace(/\n/g, ' ')}…]`;
    }
    est -= freed;
    this.ctxUsed = Math.max(0, this.ctxUsed - freed);
    if (freed) this.emit('note', { text: `Trimmed old tool output to save memory (about ${freed.toLocaleString()} tokens).`, tone: 'dim' });
    if (est + room >= this.ctx * FULL) await this.compact(signal);
  }

  async compact(signal, { instructions } = {}) {
    if (this.messages.length <= 3) return;
    this.emit('note', { text: 'Summarizing the conversation to free memory…', tone: 'dim' });
    const history = this.messages.slice(1).map((m) => {
      if (m.role === 'tool') return `TOOL RESULT: ${String(m.content).slice(0, 600)}`;
      if (m.role === 'assistant') return `YOU: ${m.reasoning_content ? `(thought: ${keyLines(m.reasoning_content, 2).join(' ').slice(0, 400)}) ` : ''}${m.content}${m.tool_calls ? ` [called ${m.tool_calls.map((c) => `${c.function.name} ${c.function.arguments.slice(0, 200)}`).join('; ')}]` : ''}`;
      return `USER: ${m.content}`;
    }).join('\n').slice(-40000);
    const ask = [
      { role: 'system', content: 'You summarize a coding session so it can continue with less memory.' },
      { role: 'user', content: `${history}\n\nWrite a summary under 200 words: what has been done, the files and line numbers that matter, any cause already worked out (word for word), and the single next step.${instructions ? ` ${instructions}` : ''}` },
    ];
    let summary = '';
    for await (const ev of streamChat({ url: this.url, messages: ask, thinking: false, sampling: this.model.sampling, maxTokens: 600, slot: this.slots?.side, signal })) {
      if (ev.type === 'text') summary += ev.text;
    }
    // The request stays word for word (the summary once became "the task" and
    // the model started the investigation over, in a folder it made up). The
    // notes are Bonsai's own, in its own mouth, not a message from the user.
    const capped = (s) => (s.length > 6000 ? `${s.slice(0, 6000)}\n${CUT_MARK}` : s);
    const opening = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m)).map((m) => ({ role: m.role, content: capped(String(m.content)) }));
    if (!opening.some((m) => m.role === 'user')) {
      const req = [...this.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[') && !m.content.startsWith(AUTO));
      if (req) opening.push({ role: 'user', content: capped(req.content) });
      else return; // nothing to anchor on: leave the conversation as it is
    }
    const facts = this.turn?.findings?.length ? `\n\nWhat I have already worked out (I keep these):\n${this.turn.findings.map((f) => `- ${f}`).join('\n')}` : '';
    this.messages = [this.messages[0], ...opening,
      { role: 'assistant', content: `My memory filled up, so I wrote down where I am. My notes:\n${summary.trim()}${facts}` },
      { role: 'user', content: auto('Those are your own notes, and they may be imperfect. Pick up from them: take the single next step now with the tools. Do not start the investigation over and do not re-read what the notes already answer.') },
    ];
    this.mapGiven = false;
    this.ctxUsed = this.messages.reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : '') + tokensOf(m.reasoning_content ?? ''), 0) + 1300;
    this.emit('compacted', { summary: summary.trim() });
  }
}
