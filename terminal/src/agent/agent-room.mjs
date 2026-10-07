// The Agent's room in memory (agent.mjs): what the conversation takes, trimming it, dropping older
// copies, notes when memory fills, and starting again from them.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { streamChat } from './client.mjs';
import { plainRead, resolvePath, toolNameOf } from './tools.mjs';
import { basename, relative } from 'node:path';
import { SeenFiles } from './seen.mjs';
import { replyTiming } from './timing.mjs';
import { AUTO, CALL_STOPS, CUT_MARK, KEEP_THOUGHTS, LEAST_THINK, NOTES_ROOM, NOTES_THINK, STEP_DOWN_CAP, TRIM_TO, auto, beforeCall, keyLines, planList, replyRoom, tokensOf } from './agent-said.mjs';

export class RoomPart {
  // What the conversation holds now, the two newest messages counted (they
  // may not be in ctxUsed yet).
  estNow() {
    return this.ctxUsed + this.messages.slice(-2).reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : ''), 0);
  }

  // The thinking the next reply may use: none with thinking off, STEP_DOWN_CAP
  // past half the request's time, else the model's cap, shrunk to what fits
  // under the trim line with the answer's 2,048 (but never below LEAST_THINK).
  thinkRoom(est = this.estNow()) {
    if (!this.thinking) return 0;
    const cap = this.steppedDown() ? STEP_DOWN_CAP : (this.model?.thinkingBudget ?? 2048);
    const fits = Math.floor(this.ctx * this.trimAt - est - 2048);
    return Math.max(Math.min(cap, LEAST_THINK), Math.min(cap, fits));
  }

  // What a restart from notes keeps: the instructions, the request and the
  // notes that go with it (design cards, a skill…), and the tools.
  keptTokens() {
    const opening = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m));
    return this.withTurnNotes([this.messages[0], ...opening]).reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : ''), 0) + 1300;
  }

  // /rewind: the conversation goes back to before messages[at] (a message
  // of yours). What the model knew from after it goes with it.
  cutBefore(at) {
    if (!(at > 0 && at < this.messages.length)) return false;
    this.messages.length = at;
    this.turn = null;
    this.todos = null;
    this.keptWrite = null;
    this.readFiles = new SeenFiles();
    this.mapGiven = this.messages.some((m) => m.role === 'tool' && String(m.content).startsWith('Code files in the project'));
    this.ctxUsed = this.messages.reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : '') + tokensOf(m.reasoning_content ?? ''), 0) + 1300;
    return true;
  }

  // Keep the conversation inside the model's memory: first empty old tool
  // outputs, then (if still too big) replace the history with a summary.
  // Emptying an old output makes the model re-read everything after it, so
  // it happens rarely and deeply: past trimAt, the oldest outputs go until
  // the conversation is under TRIM_TO. (Trimming just enough once emptied the
  // file the model had just read, so it read it again, step after step.)
  async fitContext(signal) {
    // The next reply needs its room too: at 16k, trimming without counting it
    // let a High reply run into the end of the memory mid-thought. The room is
    // the answer's 2,048 and the thinking that still fits (thinkRoom): in a
    // tight memory the thinking shrinks first, and nothing is cut while it fits.
    let est = this.estNow();
    const room = replyRoom(this.thinking, this.thinkRoom(est));
    // Where the cleanup starts: the model's whole memory, or /remote's Clean up at (cleanCap).
    const cap = this.cleanCap;
    if (est + room < cap * this.trimAt) return;
    // Notes and a summary both start over from what a restart keeps. When that
    // alone leaves no room for a reply, they free nothing and come back after
    // the very next step: at 16k a 7,300-token start wrote notes four times in
    // 18 minutes and changed nothing (countdown card, 1 Oct). Then only
    // trimming old output can help.
    const kept = this.keptTokens();
    const restartFits = kept + NOTES_ROOM + room < cap * this.trimAt;
    if (!restartFits && this.turn && !this.turn.toldTight) {
      this.turn.toldTight = true;
      this.emit('note', { text: `The ${Math.round(cap / 1024)}k memory is nearly all taken by this request's start (about ${kept.toLocaleString('en-US')} tokens: the instructions, the request and what came with it), so notes would free nothing; carrying on without them. ${cap < this.ctx ? 'A later Clean up at in /remote’s More' : 'A bigger memory in /effort'} gives it room.`, tone: 'warn' });
    }
    // On a model on another machine, older copies go first (dropSuperseded): what the conversation holds a
    // newer copy of frees room and loses nothing, where notes start the conversation over and the model reads
    // its files again. Only when that leaves real room (8% of the memory); else the notes, as before.
    if (this.model?.remote) {
      const d = this.dropSuperseded();
      if (d.freed) {
        est -= d.freed;
        this.ctxUsed = Math.max(0, this.ctxUsed - d.freed);
        const what = [d.reads ? `${d.reads} older read${d.reads === 1 ? '' : 's'} of ${d.files} file${d.files === 1 ? '' : 's'}` : '', d.writes ? `${d.writes} older version${d.writes === 1 ? '' : 's'} it wrote` : '', d.runs ? `${d.runs} older run${d.runs === 1 ? '' : 's'} of the same command` : ''].filter(Boolean).join(', ');
        this.emit('note', { text: `Memory: dropped what it has a newer copy of (${what}), about ${d.freed.toLocaleString('en-US')} tokens.`, tone: 'dim' });
        if (est + room < cap * (this.trimAt - 0.08)) return;
      }
    }
    // Notes first. Emptying old output makes the model read again everything
    // after it (measured: 186 to 261 s each time, up to half of a long try).
    // Its notes are written in the conversation it already holds, so only
    // the notes themselves are read afterwards.
    if (this.whenFull === 'notes' && restartFits && est + NOTES_ROOM + NOTES_THINK < this.ctx * 0.97 && await this.notesInPlace(signal)) return;
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
      if (est - freed < cap * TRIM_TO) break;
      const m = this.messages[i];
      if (keep.has(i) || m.keep || m.content.length <= 300) continue;
      freed += tokensOf(m.content);
      m.content = `[older output removed to save space: ${m.content.slice(0, 120).replace(/\n/g, ' ')}…]`;
    }
    est -= freed;
    this.ctxUsed = Math.max(0, this.ctxUsed - freed);
    if (freed) this.emit('note', { text: `Trimmed old tool output to save memory (about ${freed.toLocaleString()} tokens).`, tone: 'dim' });
    if (restartFits && est + room >= cap * this.fullAt) await this.compact(signal);
  }

  // Older copies of what the conversation holds a newer copy of (5 Oct 2026: in the hard task's runs a model
  // read one file five to twenty times, wrote it three to six times whole and ran the same tests ten times;
  // memory filled in most runs, the notes started the conversation over, and it read the files again):
  //  - an older Read of a file whose text came again later: the whole file, or the same lines;
  //  - an older whole version it wrote (a Write's content) of a file it wrote or read whole again later;
  //  - an older output of a command it ran again later, word for word.
  // The newest two outputs, a kept error and anything short stay. A dropped output starts as the trim's own
  // does ("[older output removed"), so a Read of it later is given the text again, not pointed back to it.
  dropSuperseded() {
    const calls = new Map();
    for (const m of this.messages) {
      if (m.role !== 'assistant') continue;
      for (const tc of m.tool_calls ?? []) {
        const f = tc.function ?? tc;
        let args = null;
        try { args = typeof f.arguments === 'string' ? JSON.parse(f.arguments || '{}') : f.arguments; } catch { /* a call that did not parse had no result worth keeping track of */ }
        if (args && typeof args === 'object') calls.set(tc.id, { name: toolNameOf(f.name, this.way), args, f });
      }
    }
    const STUB = '[older output removed';
    const text = (m) => (typeof m.content === 'string' ? m.content : '');
    const abs = (p) => { try { return resolvePath(this.cwd, String(p)).abs; } catch { return null; } };
    // What a Read's result holds, from its own first lines: the whole file ("x (60 lines):"), or lines a-b.
    const holds = (t) => {
      const head = t.split('\n').slice(0, 3).join('\n');
      const part = /\(lines (\d+)-(\d+) of \d+/.exec(head);
      if (part) return `${part[1]}-${part[2]}`;
      return /^(?:\([^\n]*\)\n)?[^\n]* \(\d+ lines?\):/.test(head) ? 'whole' : null;
    };
    const newest = new Set(this.messages.filter((m) => m.role === 'tool').slice(-2));
    const laterRead = new Map(); // file → the parts a later result holds
    const laterWrite = new Set(); // file → written whole again later
    const laterRun = new Set(); // command → ran again later
    const out = { freed: 0, reads: 0, files: 0, writes: 0, runs: 0 };
    const files = new Set();
    const resultOf = new Map(this.messages.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m]));
    for (let i = this.messages.length - 1; i > 0; i--) {
      const m = this.messages[i];
      if (m.role === 'tool') {
        const c = calls.get(m.tool_call_id);
        const t = text(m);
        // Not a copy of anything: dropped already, or the line that points back to an earlier Read.
        if (!c || !t || t.startsWith(STUB) || t.startsWith('You already read')) continue;
        const read = c.name === 'Read' ? c.args : c.name === 'Bash' && typeof c.args.command === 'string' ? (plainRead(c.args.command, this.cwd)?.name === 'Read' ? plainRead(c.args.command, this.cwd).args : null) : null;
        const file = read && typeof read.path === 'string' ? abs(read.path) : null;
        const cmd = c.name === 'Bash' && typeof c.args.command === 'string' ? c.args.command.trim() : null;
        const has = file ? holds(t) : null;
        const later = file ? laterRead.get(file) : null;
        const stale = (file && has && later && (later.has('whole') || later.has(has))) || (!file && cmd && laterRun.has(cmd));
        if (stale && !newest.has(m) && !m.keep && t.length > 300) {
          const said = file ? `an older copy of ${relative(this.cwd, file) || basename(file)}; its text is further down` : `an earlier run of ${cmd.split('\n')[0].slice(0, 80)}; its newest run is further down`;
          const stub = `${STUB} to save space: ${said}]`;
          out.freed += Math.max(0, tokensOf(t) - tokensOf(stub));
          m.content = stub;
          if (file) { out.reads++; files.add(file); } else out.runs++;
          continue;
        }
        if (file && has) laterRead.set(file, (later ?? new Set()).add(has));
        // A command that ran (not one turned away) counts as the newer run, however short its output.
        else if (!file && cmd && !m.keep && !/^(blocked|Nothing ran|The user said no)/i.test(t) && !/is outside the project folder/.test(t.slice(0, 200))) laterRun.add(cmd);
      } else if (m.role === 'assistant' && i < this.messages.length - 2) {
        for (const tc of [...(m.tool_calls ?? [])].reverse()) {
          const c = calls.get(tc.id);
          if (c?.name !== 'Write' || typeof c.args.path !== 'string' || typeof c.args.content !== 'string') continue;
          const file = abs(c.args.path);
          if (!file) continue;
          const landed = /^(Created|Updated) /.test(text(resultOf.get(tc.id) ?? {}));
          if (c.args.content.length > 1200 && (laterWrite.has(file) || laterRead.get(file)?.has('whole'))) {
            const stub = '[an older version of this file, removed to save space: it was written or read whole again later]';
            out.freed += Math.max(0, tokensOf(c.args.content) - tokensOf(stub));
            const slim = { ...c.args, content: stub };
            c.f.arguments = typeof c.f.arguments === 'string' ? JSON.stringify(slim) : slim;
            out.writes++;
          } else if (landed) laterWrite.add(file);
        }
      }
    }
    out.files = files.size;
    return out;
  }

  // Its notes, written by the model in the conversation it already holds
  // (nothing to read but the request for them), then the conversation starts
  // over from the request and the notes. False when no usable notes came.
  async notesInPlace(signal) {
    if (this.messages.length <= 3) return false;
    // Numbered within the request, so a fourth time reads as a fourth time.
    const n = this.turn ? (this.turn.fulls = (this.turn.fulls ?? 0) + 1) : 1;
    this.emit('note', { text: `Memory full (${n}): saving notes, then carrying on`, tone: 'dim' });
    this.emit('busy', { task: 'saving notes' });
    const t0 = Date.now();
    const ask = auto(`Your memory is nearly full. Write your notes now, in plain words and under 200 words, with no tool call: what you have done so far, the files and line numbers that matter, any cause you have already worked out (word for word), and the single next step.`);
    // The newest tool output came after the model's last reply: it has not
    // read it yet. Reading it only to summarize it away costs a whole step
    // (70 s for 130 lines of a page, measured), so it is held back from the
    // notes and follows them, as it is.
    const held = this.heldBack();
    const asked = held ? [...this.messages.slice(0, -held.length), held[0], { ...held[1], content: '(This output is kept for you: it comes back, whole, right after your notes.)' }] : this.messages;
    let summary = '';
    let called = false;
    const notesAt = Date.now();
    try {
      // Thinking stays on (turning it off would change the prompt and read it all
      // again) but is capped at NOTES_THINK, so the 700 tokens go to the notes. A service
      // has no such cap (Ollama: 4 Oct 2026, every note came out empty, the thinking took
      // all 828 tokens), and there turning it off for one step costs about 1.3 s.
      const remote = Boolean(this.model?.remote);
      const think = this.thinking && !remote;
      const sampling = think ? this.model.thinkingSampling : this.model.sampling;
      const notesCall = (tools) => streamChat({ url: this.url, conversation: this.conversation, messages: [...this.withTurnNotes(asked), { role: 'user', content: ask }], tools, toolChoice: 'none', extra: { stop: CALL_STOPS }, thinking: think, effort: this.stepEffort(), model: this.model, sampling, maxTokens: NOTES_ROOM + (remote ? 1024 : think ? NOTES_THINK : 0), thinkCap: NOTES_THINK, slot: this.slots?.main, signal });
      for await (const ev of notesCall(this.tools())) {
        if (ev.type === 'text') summary += ev.text;
        if (ev.type === 'tool') called = true;
      }
      // A model that answers with a tool call (Ollama does not hold it to toolChoice 'none'; gpt-oss's notes came
      // out empty every time, 4 Oct 2026) is asked once more with no tools: one more read of the conversation.
      if (called && beforeCall(summary).trim().length < 40) {
        summary = '';
        this.emit('note', { text: 'It answered the notes request with a tool call: asked again with no tools.', tone: 'dim' });
        for await (const ev of notesCall([])) if (ev.type === 'text') summary += ev.text;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      return false;
    } finally {
      this.emit('timing', replyTiming({ kind: 'call', what: 'notes when memory filled', start: notesAt, out: tokensOf(summary) }));
    }
    summary = beforeCall(summary).trim();
    if (summary.length < 40) {
      this.emit('note', { text: `Notes came out empty${called ? ' (it called a tool instead)' : summary ? ` (only "${summary.slice(0, 60)}")` : ''}: freeing memory another way`, tone: 'dim' });
      return false;
    }
    const before = this.ctxUsed;
    if (!this.restartFrom(summary, held)) return false;
    // The instructions are read from their saved state, not again from the start.
    try { await this.rewarm?.(signal); } catch (e) { if (signal?.aborted) throw e; }
    this.emit('compacted', { summary, inPlace: true, n: this.turn?.fulls ?? 1, secs: (Date.now() - t0) / 1000, freed: Math.max(0, before - this.ctxUsed) });
    return true;
  }

  // The newest tool call and its output, when the model has not read the
  // output yet: [the assistant's call, the tool's result], or null.
  heldBack() {
    const [call, result] = this.messages.slice(-2);
    if (result?.role !== 'tool' || call?.role !== 'assistant' || !call.tool_calls?.some((c) => c.id === result.tool_call_id)) return null;
    // A short output costs nothing to read; holding it back would only add a step.
    return tokensOf(String(result.content)) > 400 ? [call, result] : null;
  }

  // What it looked at and changed in this message, from Agentic Coder's own record:
  // a summary can forget a file, this list cannot.
  seenSoFar() {
    const t = this.turn;
    if (!t) return '';
    const tilde = (abs) => (abs.startsWith(`${this.cwd}/`) ? abs.slice(this.cwd.length + 1) : abs);
    const reads = new Map();
    for (const key of t.reads?.keys() ?? []) {
      const [abs, offset, limit, find] = key.split('|');
      const what = find ? `around "${find}"` : offset ? `lines ${offset}-${Number(offset) + Number(limit || 150) - 1}` : 'from the top';
      reads.set(tilde(abs), [...(reads.get(tilde(abs)) ?? []), what]);
    }
    const lines = [];
    if (reads.size) lines.push(`Files I have read: ${[...reads].slice(-12).map(([f, w]) => `${f} (${[...new Set(w)].slice(0, 4).join('; ')})`).join(', ')}.`);
    if (t.searches?.length) lines.push(`Searches I ran: ${t.searches.map((s) => `"${s}"`).join(', ')}.`);
    const changed = [...new Set((t.diffs.match(/^(\S[^\n]*):$/gm) ?? []).map((l) => l.slice(0, -1)))];
    if (changed.length) lines.push(`Files I have changed: ${changed.join(', ')}.`);
    if (this.keptWrite) lines.push(`Agentic Coder still keeps the content of my Write call that had no path (${this.keptWrite.content.split('\n').length} lines): I send Write with only "path" to save it, and do not write it again.`);
    return lines.length ? `\n\nFrom Agentic Coder's record of this message:\n${lines.map((l) => `- ${l}`).join('\n')}` : '';
  }

  // The conversation starts over from the request (word for word) and the
  // notes; `held` (heldBack) follows them.
  restartFrom(summary, held = null) {
    // The request stays word for word (the summary once became "the task" and
    // the model started the investigation over, in a folder it made up). The
    // notes are Agentic Coder's own, in its own mouth, not a message from the user.
    const capped = (s) => (s.length > 6000 ? `${s.slice(0, 6000)}\n${CUT_MARK}` : s);
    const opening = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m)).map((m) => ({ role: m.role, content: capped(String(m.content)) }));
    if (!opening.some((m) => m.role === 'user')) {
      const req = [...this.messages].reverse().find((m) => m.role === 'user' && typeof m.content === 'string' && !m.content.startsWith('[') && !m.content.startsWith(AUTO));
      if (req) opening.push({ role: 'user', content: capped(req.content) });
      else return false; // nothing to anchor on: leave the conversation as it is
    }
    const facts = this.turn?.findings?.length ? `\n\nWhat I have already worked out (I keep these):\n${this.turn.findings.map((f) => `- ${f}`).join('\n')}` : '';
    // Its plan of this message goes with the notes: the TodoWrite that held it is left behind.
    const steps = this.turn?.planAt != null ? planList(this.todos) : '';
    const plan = steps ? `\n\nMy plan, as I last wrote it with TodoWrite:\n${steps}` : '';
    if (plan) this.turn.planAt = this.turn.steps ?? 0;
    // The request's cases go with the notes too: the step's result that listed them is left behind
    // (4 Oct 2026: memory filled in three runs of four, and the list was gone from then on).
    const cases = this.turn?.cases?.length && !this.turn.casesDone ? `\n\nThe request's cases (before I answer, each needs a test that tries its example):\n${this.turn.cases.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}` : '';
    // The request is at the top again: its reminder counts from here.
    if (this.turn) this.turn.requestAt = this.turn.steps ?? 0;
    // The notes that go with the request (the steps for its kind of bug, a
    // check the fix path made) follow the request into the new conversation.
    for (const x of [this.turn?.bug, this.turn?.skill, this.turn?.look, this.turn?.math, this.turn?.design, this.turn?.carried].filter(Boolean)) {
      const i = (this.turn?.opening ?? []).filter((m) => this.messages.includes(m)).indexOf(x.request);
      if (i >= 0) x.request = opening[i];
    }
    this.messages = [this.messages[0], ...opening,
      // "Nothing is saved anywhere else": after its notes the model once went
      // looking for them on disk (ls ~/.claude/sessions, chart bug, 27 Sep).
      { role: 'assistant', content: `My memory filled up, so I wrote down where I am. My notes (all of them are here; nothing is saved anywhere else):\n${summary.trim()}${facts}${plan}${cases}${this.seenSoFar()}` },
      { role: 'user', content: auto(held
        ? 'Those are your own notes, and they may be imperfect. Pick up from them. The output of your last step follows; read it, then take the next step with the tools. Do not start the investigation over and do not re-read what the notes already answer.'
        : 'Those are your own notes, and they may be imperfect. Pick up from them: take the single next step now with the tools. Do not start the investigation over and do not re-read what the notes already answer.') },
      ...(held ?? []),
    ];
    if (this.turn) this.turn.opening = opening;
    this.mapGiven = false;
    this.ctxUsed = this.messages.reduce((n, m) => n + tokensOf(typeof m.content === 'string' ? m.content : '') + tokensOf(m.reasoning_content ?? ''), 0) + 1300;
    return true;
  }

  // How many messages you and the model have said. The opening read (giveOpening: two messages the
  // app put in) is not conversation, so on a remote one short exchange is still too short to
  // summarize, as it is on this Mac, where there is no opening read and the count is the same as before.
  said() { return this.messages.filter((m) => !m.opening && !m.maps && !(m.tool_calls ?? []).some((c) => /^(opening|maps)_/.test(String(c.id)))).length; }

  async compact(signal, { instructions } = {}) {
    if (this.said() <= 3) return;
    this.emit('note', { text: 'Summarizing the conversation to free memory…', tone: 'dim' });
    this.emit('busy', { task: 'summarizing' });
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
    // On a service with a Side jobs helper (/subagents) it writes the summary; if it cannot, the main model does.
    const side = this.sideUse();
    const sum = async (use) => { summary = ''; for await (const ev of streamChat({ url: this.url, messages: ask, thinking: false, sampling: this.model.sampling, maxTokens: 600, slot: this.slots?.side, signal, use })) if (ev.type === 'text') summary += ev.text; };
    try { await sum(side); } catch (e) {
      if (!side || signal?.aborted) throw e;
      this.emit('note', { text: `Side jobs: ${side.model} could not write the summary (${e.message}); the main model does.`, tone: 'dim' });
      await sum(undefined);
    }
    if (this.restartFrom(summary)) this.emit('compacted', { summary: summary.trim(), n: this.turn ? (this.turn.summaries = (this.turn.summaries ?? 0) + 1) : 1 });
  }
}
