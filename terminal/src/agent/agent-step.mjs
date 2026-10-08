// One step of the Agent (agent.mjs): a tool call checked, asked about, mended and run, and the model's
// own tools (Map, CodeSearch, Rename, TestFirst, Remember).
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { PROVIDER_NAMES, searchKey } from '../tools/web.mjs';
import { EXPLORE_TOOLS, WHOLE_MAX, arrivedNote, desktopDefault, display, execute, needsSight, needsText, normalizeArgs, parseArgs, patchOps, plainFetch, plainRead, prepare, resolvePath, sentArgs, syntaxError, toolNameOf } from './tools.mjs';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { repoMap } from '../tools/repomap.mjs';
import { decide, isReadOnly, offerFor, testRunOf } from './permissions.mjs';
import { isHomeFolder } from './prompt.mjs';
import { folderKind } from './folder.mjs';
import { filesMade, madeNote } from './made.mjs';
import { commandWithScripts, inScripts } from './scripts.mjs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { isCodeProject, runKind } from '../flows/index.mjs';
import { changedNote, changesText } from './seen.mjs';
import { toolInput } from './user-hooks.mjs';
import { readResults, testsFailed } from '../flows/results.mjs';
import { tallies } from '../flows/llm.mjs';
import { toolTiming } from './timing.mjs';
import { autoCheck } from './auto-check.mjs';
import { screenAccess } from '../tools/screen.mjs';
import { nearParts, openPart, partFor, partsOf, readLadder } from './ladder.mjs';
import { MAP_DIR } from '../tools/codemap.mjs';
import { CUT } from '../tools/codeindex.mjs';
import { MCP_TOOL, findEntry, isMcpCall, madeUpCall } from './mcp.mjs';
import { CODE_SEARCH_CHARS, CUT_MARK, MODEL_TOOLS, countLine, failsOf, leakedCall, planLine, runLine, tokensOf } from './agent-said.mjs';
import { rawQwenCall } from './client.mjs';
import { readCallText } from './qwen-raw.mjs';
import { HOME } from '../../../models/index.mjs';

export class StepPart {
  // A Write with its content but no path: the content is kept, the call in the
  // conversation shrinks to one line, and the next Write that sends only a path
  // writes the kept content. On 28 Sep Gemma wrote a whole notes page this way
  // twice (2,157 and 3,085 tokens); each time it was told only 'Write needs
  // "path".', and the first draft filled its memory and was lost at the restart.
  keepWrite(call, parsed) {
    const sent = sentArgs('Write', call.args) ?? {};
    const content = typeof sent.content === 'string' && sent.content.length ? sent.content : null;
    const path = sent.path !== undefined && sent.path !== null && String(sent.path).trim() ? String(sent.path) : null;
    if (content && !path) {
      this.keptWrite = { content };
      const lines = content.split('\n').length;
      this.shrinkCall(call.id, JSON.stringify({ content: `[${lines} lines, kept by Agentic Coder]` }));
      const named = this.fileNamed();
      return {
        error: `${needsText('Write', 'path')} Your content (${lines} lines) is kept, so do not write it again: send Write with only "path"${named ? ` (the request names "${named}")` : ''}, and the kept content is written there.`,
        shown: `Write needs "path"; its ${lines} lines are kept until it names the file`,
      };
    }
    if (path && !content && this.keptWrite) return { args: { path, content: this.keptWrite.content }, fromKept: true };
    // A Write with its path and no content at all, nothing kept: the content was most likely written
    // and lost on the way. Qwen3.6 on the service (8 Oct 2026) wrote for 38 s and nothing arrived, then
    // sent Write of README.md twice with only "path"; told to send "content", it sent the same call.
    if (path && (sent.content === undefined || sent.content === null) && parsed.error === needsText('Write', 'content')) {
      return {
        error: 'Write needs "content": the full file content. Your call arrived with only "path": the text of the file was lost on the way (a long file in one call can be dropped by the model server), so the same call again loses it again. Write a short first version of the file now (under 80 lines: its outline and first part), then add the rest with Edit, one part at a time.',
        shown: 'Write came without its content (lost on the way); asked for a short first version',
      };
    }
    return parsed;
  }

  // A call asked for again (8 Oct 2026, the owner's pick: "read calls ourselves"). Ollama's parser leaves out a
  // part of a call it cannot read, without a word: Qwen3.6's Writes came with only "path", its Edits without
  // "old_text". In Ollama's raw mode (client.mjs rawQwenCall) the model writes the same call once more, from
  // the step's own thinking and words, and it is read here (qwen-raw.mjs readCallText). Answers { call, found }:
  // call when it now has what was missing (its arguments replace the ones in the conversation), found the names
  // that came; null where it does not apply. What came is kept in logs/qwen-reread.jsonl: it shows whether
  // the model or the parser lost the text.
  async rereadCall(call, missing, signal) {
    const at = this.messages.findIndex((m) => m.role === 'assistant' && m.tool_calls?.some((t) => t.id === call.id));
    const ask = this.lastAsk;
    const def = ask?.tools?.find((t) => t.function?.name === call.name);
    if (at < 1 || !def) return null;
    const msg = this.messages[at];
    const started = Date.now();
    const r = await rawQwenCall({ url: this.url, conversation: this.conversation, messages: this.withTurnNotes(this.messages.slice(0, at)), tools: ask.tools, thinking: ask.thinking, effort: ask.effort, model: this.model, sampling: ask.sampling, maxTokens: ask.maxTokens, reasoning: msg.reasoning_content ?? '', before: typeof msg.content === 'string' ? msg.content : '', name: call.name, signal,
      onStart: () => this.emit('note', { text: `Its ${call.name} came without "${missing}": asking the model for that call once more and reading it here…`, tone: 'dim' }) });
    if (!r) return null;
    const args = readCallText(r.text, def);
    const json = JSON.stringify(args);
    const whole = !parseArgs(call.name, json, this.way).error;
    const found = Object.keys(args);
    try {
      mkdirSync(join(HOME, 'logs'), { recursive: true });
      appendFileSync(join(HOME, 'logs', 'qwen-reread.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), model: this.model?.remote?.model ?? null, tool: call.name, missing, sent: call.args.slice(0, 2000), raw: r.text.slice(0, 20000), found, whole, tokens: r.tokens, finish: r.finish, secs: Math.round((Date.now() - started) / 1000) })}\n`);
    } catch { /* the log is for looking back; the step goes on without it */ }
    this.emit('note', whole
      ? { text: `Its ${call.name} came without "${missing}"; asked for it once more and read it here: it was whole (${found.join(', ')}), so it runs.`, tone: 'warn' }
      : { text: `Its ${call.name} came without "${missing}"; asked for it once more and read it here: ${found.length ? `still no "${missing}" (it came with ${found.join(', ')})` : 'nothing came'}.`, tone: 'warn' });
    if (!whole) return { call: null, found };
    // The conversation holds the call as it really was, so later steps read the whole of it.
    const c = msg.tool_calls.find((t) => t.id === call.id);
    this.ctxUsed += Math.max(0, tokensOf(json) - tokensOf(c.function.arguments ?? ''));
    c.function.arguments = json;
    return { call: { ...call, args: json }, found };
  }

  // Replace a call's arguments in the conversation (the model reads the shorter
  // version from then on) and take the saved tokens off the count.
  shrinkCall(id, args) {
    for (let i = this.messages.length - 1; i > 0; i--) {
      const c = this.messages[i].tool_calls?.find((t) => t.id === id);
      if (!c) continue;
      this.ctxUsed = Math.max(0, this.ctxUsed - Math.max(0, tokensOf(c.function.arguments) - tokensOf(args)));
      c.function.arguments = args;
      return;
    }
  }

  // The first file name the request itself names ("notes.html"), if any.
  fileNamed() {
    return /(?:^|[\s"'`(])([\w.-]+\.(?:html?|md|txt|csv|json|jsx?|mjs|cjs|tsx?|css|py|sh|rb|go|rs|java|swift|ya?ml|toml|xml|svg))\b/i.exec(this.turn?.request ?? '')?.[1] ?? null;
  }

  // A step, with your hooks around it: PreToolUse may stop it (the model is told why), allow it
  // without a question or make it ask; PostToolUse may tell the model something after it. A hook
  // that changed a file the model has seen (a formatter after an Edit) is said with the lines.
  // Each tool's time (agent/timing.mjs), once: a step that runs another (a List of a file as a Read) counts once.
  async runTool(call, signal) {
    if (this.toolsTiming) return this.hookedTool(call, signal);
    this.toolsTiming = true;
    const start = Date.now();
    let out;
    try { out = await this.hookedTool(call, signal); return out; } finally {
      this.toolsTiming = false;
      this.emit('timing', toolTiming({ name: toolNameOf(call.name, this.way), start, error: Boolean(out?.error) }));
    }
  }
  async hookedTool(call, signal) {
    const hooks = this.userHooks;
    const name = toolNameOf(call.name, this.way);
    if (!hooks || (!hooks.has('PreToolUse', name) && !hooks.has('PostToolUse', name))) return this.runStep(call, signal);
    const args = parseArgs(name, call.args, this.way).args ?? {};
    const input = toolInput(name, args, this.cwd);
    let pre = null;
    if (hooks.has('PreToolUse', name)) {
      pre = await hooks.run('PreToolUse', { tool_name: name, tool_input: input }, { tool: name, signal, permissionMode: this.mode });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (pre.block) {
        const why = pre.reason || 'it said no';
        this.emit('tool', { id: call.id, name, ...display(name, args), view: { kind: 'denied', message: `your hook: ${why.split('\n')[0].slice(0, 160)}` }, error: true });
        return { text: `A hook of the user's stopped this ${name}: ${why}. Do something else, or ask the user.`, error: true };
      }
    }
    const out = await this.runStep({ ...call, pre }, signal);
    if (out.error || out.stop || signal?.aborted || !hooks.has('PostToolUse', name)) return out;
    const r = await hooks.run('PostToolUse', { tool_name: name, tool_input: input, tool_response: { output: String(out.text ?? '').slice(0, 20_000), ...(input.file_path ? { filePath: input.file_path } : {}) } }, { tool: name, signal, permissionMode: this.mode });
    if (r.block || r.reason) out.text += `\n\n(A hook of the user's says: ${r.reason || 'something is wrong with this step'})`;
    if ((name === 'Edit' || name === 'Write') && input.file_path) {
      const ch = this.readFiles.changed(input.file_path);
      if (ch) {
        const rel = relative(this.cwd, input.file_path);
        const lines = changesText(ch);
        out.text += lines ? `\n(A hook of the user's changed ${rel} after this ${name}; this counts as reading it:\n${lines})` : `\n(A hook of the user's changed ${rel} after this ${name}: Read it again before you Edit it.)`;
        if (lines) this.readFiles.add(input.file_path, ch.now);
      }
    }
    return out;
  }

  // Two slips of an edit, set right (4 Oct 2026, eight runs: "Edit needs path" and "Write needs content",
  // three times each, a step lost every time): a Write with old_text and new_text and no content is the
  // Edit it means; an Edit with no path goes to the one file the model has seen that holds old_text.
  mendEdit(call) {
    let raw;
    try { raw = JSON.parse(call.args || '{}'); } catch { return call; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return call;
    const e = normalizeArgs('Edit', raw, this.way);
    let name = call.name;
    if (name === 'Write' && normalizeArgs('Write', raw, this.way).content === undefined && typeof e.old_text === 'string' && typeof e.new_text === 'string') name = 'Edit';
    // An Edit with the whole file and no old text (content, not new_text: a few new lines sent alone must never
    // replace a file) is the Write it means; Write's own rules still decide (read first, nothing broken).
    if (name === 'Edit' && e.old_text === undefined && e.new_text === undefined && typeof normalizeArgs('Write', raw, this.way).content === 'string' && e.path) return { ...call, name: 'Write' };
    if (name !== 'Edit' || e.path || typeof e.old_text !== 'string' || !e.old_text.trim()) return name === call.name ? call : { ...call, name };
    const holds = this.readFiles.paths().filter((abs) => { try { return readFileSync(abs, 'utf8').includes(e.old_text); } catch { return false; } });
    return holds.length === 1 ? { ...call, name, args: JSON.stringify({ ...raw, path: relative(this.cwd, holds[0]) }) } : { ...call, name };
  }

  // gpt-oss's own way to change files (4 Oct 2026: gpt-oss:120b sent apply_patch three times, was told
  // there is no such tool, and was stopped): each hunk runs as an Edit and each new file as a Write
  // (tools.mjs patchOps), so their checks and questions hold; the first that fails ends it.
  async applyPatch(call, signal) {
    let raw = {};
    try { raw = JSON.parse(call.args || '{}'); } catch { raw = { patch: call.args }; }
    const ops = patchOps(typeof raw === 'string' ? raw : raw.patch ?? raw.input ?? raw.diff ?? '');
    if (!ops.length) {
      this.emit('tool', { id: call.id, name: 'Edit', label: 'Update', arg: '', view: { kind: 'error', message: 'A patch with no change in it' }, error: true });
      return { text: 'The patch has no change in it. Change a file with Edit (path, old_text, new_text), or make one with Write.', error: true };
    }
    const said = [];
    for (const [i, op] of ops.entries()) {
      const where = ops.length > 1 ? `Change ${i + 1} of ${ops.length}${op.args?.path ? ` (${op.args.path})` : ''}: ` : '';
      if (op.error) return { text: `${where}${op.error}${i ? ` The ${i} before it went in.` : ''}`, error: true };
      const out = await this.runStep({ id: `${call.id}-${i}`, name: op.name, args: JSON.stringify(op.args) }, signal);
      if (out.error || out.stop) return { ...out, text: `${where}${out.text}${i ? ` The ${i} before it went in.` : ''}` };
      said.push(`${where}${out.text}`);
    }
    return { text: said.join('\n') };
  }

  async runStep(call, signal) {
    call = { ...call, name: toolNameOf(call.name, this.way) };
    // A tool of an MCP server: by its name here, through Mcp, or by the tool's own name when
    // that is no tool of the app's and only one server has it (runMcp).
    if (this.mcpFrozen && (isMcpCall(call.name) || (!this.tools().some((t) => t.function.name === call.name) && findEntry(this.mcpEntries(), call.name).entry))) return this.runMcp(call, signal);
    // A wrapper of its own making with a server's tool inside ("call_mcp", agent/mcp.mjs madeUpCall):
    // run through Mcp, as the call it means.
    if (this.mcpFrozen && !this.tools().some((t) => t.function.name === call.name)) {
      let raw = null;
      try { raw = JSON.parse(call.args || '{}'); } catch { /* not one */ }
      const made = madeUpCall(call.name, raw);
      if (made && findEntry(this.mcpEntries(), made.tool).entry) return this.runMcp({ ...call, name: MCP_TOOL, args: JSON.stringify(made) }, signal);
    }
    if (call.name === 'apply_patch') return this.applyPatch(call, signal);
    if (call.name === 'Edit' || call.name === 'Write') call = this.mendEdit(call);
    let parsed = parseArgs(call.name, call.args, this.way);
    // A Write or Edit without a field it needs, from Qwen 3.5 or 3.6 on an Ollama service: the call is asked for
    // once more in raw mode and read here, where nothing is left out unsaid (rereadCall). Whole now: it runs.
    let reread = null;
    if (parsed.error && parsed.missing && (call.name === 'Write' || call.name === 'Edit')) {
      reread = await this.rereadCall(call, parsed.missing, signal).catch(() => null);
      if (reread?.call) { call = reread.call; parsed = parseArgs(call.name, call.args, this.way); }
    }
    if (call.name === 'Write') parsed = this.keepWrite(call, parsed);
    // Still missing something: the model is told what did arrive, so a name it got wrong is not taken for text
    // lost on the way (arrivedNote), and whether a second read found it.
    if (parsed.error && parsed.missing) {
      const came = arrivedNote(call.name, call.args, this.way);
      if (came) parsed = { ...parsed, error: `${parsed.error} ${came.text}`, shown: `${call.name} needs "${parsed.missing}" · ${came.shown}` };
    }
    if (parsed.error && reread && !reread.call) parsed = { ...parsed, error: `${parsed.error} (Agentic Coder asked for this call once more and read it itself: ${reread.found.length ? `it came with ${reread.found.join(', ')} again` : 'nothing came'}.)` };
    const shown = display(call.name, parsed.args ?? {});
    const id = call.id;
    if (parsed.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: parsed.shown ?? parsed.error }, error: true });
      // A name that is no tool at all, with MCP tools on: they are named too (Qwen3.6 made up
      // "Shop_get_note", was told only the app's tools, and said the server was not there).
      const mcpNames = /^There is no tool called/.test(parsed.error) && this.mcpFrozen ? this.mcpDefs().map((t) => t.function.name) : [];
      return { text: mcpNames.length ? `${parsed.error} And the MCP tools: ${mcpNames.slice(0, 12).join(', ')}${mcpNames.length > 12 ? ', …' : ''}.` : parsed.error, error: true };
    }
    const args = parsed.args;
    // A helper refuses a tool it was not given (an explore helper does not change anything).
    if (this.toolFilter && !this.toolFilter.has(call.name)) {
      // A helper agent file's own list of tools: say which it has.
      const reads = this.toolFilter === EXPLORE_TOOLS;
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: reads ? 'this helper only reads' : `not one of this helper's tools` }, error: true });
      return { text: reads ? `${call.name} is not one of this helper's tools: it only reads. Report what should change instead.` : `${call.name} is not one of this helper's tools (it has ${[...this.toolFilter].join(', ') || 'none'}). Do the work with those, or report what should be done instead.`, error: true };
    }
    // A command that names one of the conversation's MCP tools ("claude mcp__shop__create_ticket …":
    // Qwen3.6 in the window, 3 Oct 2026, which then waited on your yes): the tool is no program, so
    // nothing runs and it is told how the tool is called.
    if (call.name === 'Bash' && this.mcpFrozen) {
      const named = this.mcpEntries().find((e) => String(args.command ?? '').includes(e.name));
      if (named) {
        const gated = this.mcpListed().some((e) => e.name === named.name);
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: `${named.name} is an MCP tool, not a command` }, error: true });
        return { text: `Nothing ran: ${named.name} is a tool of the user's MCP server "${named.server}", not a command. Call it as a tool${gated ? `: ${MCP_TOOL} with "tool": "${named.name}" and its "arguments"` : ', with its arguments as JSON'}.`, error: true };
      }
    }
    // A folder that is not there before the command ("cd /testbed && npm test", "cd /Users/gkane && …": six
    // times in eight runs, 4 Oct 2026, each refused as outside the project): the command runs here, and says so.
    if (call.name === 'Bash' && typeof args.command === 'string') {
      const m = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*(\S[\s\S]*)$/.exec(args.command);
      const there = m?.[1].replace(/^["']|["']$/g, '');
      if (m && isAbsolute(there) && !existsSync(there)) {
        const out = await this.runStep({ ...call, args: JSON.stringify({ ...args, command: m[2] }) }, signal);
        if (typeof out?.text === 'string') out.text = `(There is no ${there} on this machine. You are already in the project folder, so the command ran here; leave the cd out.)\n${out.text}`;
        return out;
      }
    }
    if (call.name === 'Agent') return this.runHelper(id, args, shown, signal);
    if (call.name === 'Ask') { if (this.turn) this.turn.askedUser = true; return this.askUser(id, args, shown, signal); }
    // List of a file: it is read (4 Oct 2026: "Listed docs/map/docs.md · 0 paths").
    if (call.name === 'List' && typeof args.path === 'string' && !args.pattern) {
      let file = false;
      try { file = statSync(resolvePath(this.cwd, args.path).abs).isFile(); } catch {}
      if (file) return this.runTool({ id, name: 'Read', args: JSON.stringify({ path: args.path }) }, signal);
    }
    // A plain read in a command on a model on another machine (cat, head, tail, sed -n, grep -r, rg, ls,
    // find -name): run as Read, Search or List (tools.mjs plainRead), so a long file comes in parts with an
    // outline and a profile, and it counts as a look (4 Oct 2026: a 35 KB file came back cut, twice).
    let reading = call.name === 'Bash' && this.model?.remote ? plainRead(args.command, this.cwd) : null;
    // A range of a short file (sed -n '95,120p', tail -n 3) runs as typed: Read gives a short file whole,
    // from line 1 and unnumbered, so the lines asked for get lost (4 Oct 2026: Qwen3.6 asked for lines
    // 95-120 of a 183-line file, got all 183, and spent 40 steps hunting line 101 with od and xxd).
    if (reading?.name === 'Read' && reading.args.offset > 1) {
      try {
        const text = readFileSync(resolvePath(this.cwd, reading.args.path).abs, 'utf8');
        if (text.split('\n').length <= (this.model?.harness?.read?.whole ?? WHOLE_MAX) && text.length <= (this.maxResultChars ?? 12000)) reading = null;
      } catch { /* Read says what is wrong */ }
    }
    if (reading) {
      const out = await this.runTool({ id, name: reading.name, args: JSON.stringify(reading.args) }, signal);
      if (typeof out?.text === 'string') out.text = `(Run as ${reading.name}: the app's own tool shows a long file in parts, with an outline. Use ${reading.name} yourself.)\n${out.text}`;
      return out;
    }
    // A plain curl or wget of a page outside Bypass, with WebFetch on: run as WebFetch, since commands reach
    // the internet only in Bypass (tools.mjs plainFetch); asked about as WebFetch is.
    const fetching = call.name === 'Bash' && this.mode !== 'bypass' && this.webTools()?.fetch ? plainFetch(args.command) : null;
    if (fetching) {
      this.emit('note', { text: `A plain fetch of ${fetching}: run as WebFetch (commands reach the internet only in Bypass).`, tone: 'dim', fold: true });
      const out = await this.runTool({ id, name: 'WebFetch', args: JSON.stringify({ url: fetching }) }, signal);
      if (typeof out?.text === 'string') out.text = `(Run as WebFetch: commands reach the internet only in Bypass permissions. Call WebFetch yourself for a page.)\n${out.text}`;
      return out;
    }
    // Read of a web address, with WebFetch on: read as the page it is (asked about as WebFetch is).
    if (call.name === 'Read' && typeof args.path === 'string' && /^https?:\/\//i.test(args.path.trim()) && this.webTools()?.fetch) return this.runTool({ id, name: 'WebFetch', args: JSON.stringify({ url: args.path.trim(), ...(args.find ? { find: args.find } : {}), ...(args.offset ? { offset: args.offset } : {}) }) }, signal);
    // The model's own tools when it decides (Map, CodeSearch, Rename, TestFirst, Remember),
    // and a Read of several files, one Read each, in one result.
    if (MODEL_TOOLS.has(call.name)) return this.runModelTool(call.name, args, shown, id, signal);
    if (call.name === 'Read' && Array.isArray(args.paths) && !args.path) return this.readMany(id, args.paths, signal);
    // A question changes nothing. (A practice question once tested an idea by
    // writing a scratch file inside the project, 2026-09-26.) Edit and Write
    // are turned away; a command that is not plain reading runs in a
    // throwaway copy of the project (below).
    if (this.turn?.question && (call.name === 'Edit' || call.name === 'Write')) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: 'A question changes no files' }, error: true });
      return { text: 'This is a question, so no file is changed. Answer it from what you have read. If a change is needed, say which one, and the user can ask for it.', error: true };
    }
    // A skill's read fence. The steps may say "do not edit"; this is what holds.
    if (this.turn?.fence?.has('read') && (call.name === 'Edit' || call.name === 'Write')) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: 'This skill only reads' }, error: true });
      return { text: 'This skill only reads. Edit and Write are turned off for it. Answer from what you have read.', error: true };
    }
    // A picture, or a scanned PDF, the model reads by itself while it is not looking at pictures:
    // its vision is turned on first where it can be (visionOn: the window's reload, or coding -p's),
    // as when you attach one. Without it, Read says to ask you to attach it.
    if (call.name === 'Read' && !this.canSee && this.visionOn && needsSight(this.cwd, args)) { try { await this.visionOn(); } catch { /* Read says why it cannot see */ } }
    if (call.name === 'Screen' && !this.canSee && this.visionOn) { try { await this.visionOn(); } catch { /* the picture goes with a line saying it cannot be seen */ } }
    // checks: the lsp helper also checks JSX, TypeScript and a page's scripts before an edit lands.
    const env = { cwd: this.cwd, home: this.home, jobs: this.jobs, rulesSet: this.rulesSetUsed ?? 'local', notes: () => this.notesView(), rewrite: (abs) => this.readFiles.has(abs), agents: this.agentsOn(), mcp: this.mcpOn(), permissionsNow: () => ({ mode: this.mode, rules: this.savedRules(), session: this.allowedPrefixes }), signal, maxResultChars: this.maxResultChars, bash: this.bash, read: this.model?.harness?.read, canSee: Boolean(this.canSee), onScreenSetup: () => this.emit('screen-setup', {}), web: { search: this.web?.search, key: () => searchKey(this.web?.search) }, request: this.turn?.request ?? '', searches: this.turn?.searches ?? [], blocked: this.hook('blocked'), workFolder: this.turn?.workFolder ?? null, checks: this.helpers.has('lsp'), setTodos: (t) => { this.todos = t; this.emit('todos', t); }, todos: () => this.todos, outsideOk: (name, abs) => this.mode === 'bypass' || this.desktopOpen(name, abs) };
    // A new file goes to the Desktop unless the request says where (tools.mjs desktopDefault); a new code
    // file at the top of a code project is asked about once a message. AGENTIC_DESKTOP_DEFAULT=off: as before (the tests).
    // The page the request names, not read yet (Look before answering; 5 Oct 2026: asked to scrape a link, Qwen3.6
    // called no web tool, wrote a "mockup" of what the page might hold to three places, and said it could not reach
    // the internet). A file is not written about a page nobody read: twice, then it is let through.
    if (this.turn?.web?.urls?.length && !this.turn.fetched && !this.isHelper) {
      const t = this.turn;
      if (call.name === 'Bash' && t.web.urls.some((u) => String(args.command ?? '').includes(u.replace(/^https?:\/\//, '').split('/')[0]))) t.fetched = true;
      else if ((call.name === 'Write' || call.name === 'Edit') && this.hook('look-first') && (t.webHeld ?? 0) < 2) {
        t.webHeld = (t.webHeld ?? 0) + 1;
        if (t.webHeld === 1) this.emit('note', { text: `It began to write before reading ${t.web.urls[0]}: told it to read the page first.`, tone: 'warn' });
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: 'The page was not read yet' }, error: true });
        return { text: `Nothing was written: you have not read ${t.web.urls.slice(0, 3).join(', ')} yet. WebFetch is one of your tools and this address is allowed: read the page with it first, then write from what it shows. Never write what a page might say from memory. If WebFetch fails, tell the user exactly what it answered.`, error: true };
      }
    }
    // A Desktop in a command that is not this user's ("curl -o /Users/Shared/Desktop/x.html …"): their own, said so.
    if (call.name === 'Bash' && typeof args.command === 'string' && process.env.AGENTIC_DESKTOP_DEFAULT !== 'off' && !this.isHelper && this.turn) {
      const req = String(this.turn.task ?? this.turn.request ?? '');
      let was = '';
      const fixed = args.command.replace(/\/(?:Users|home)\/([^/\s'"]+)\/Desktop(?=[/\s'"]|$)/g, (all, user) => (all === this.desktopDir || req.includes(`${user}/Desktop`) ? all : (was ||= all, this.desktopDir)));
      if (was) {
        this.emit('note', { text: `${was} is not your Desktop: the command uses yours, ${this.tilde(this.desktopDir)}.`, tone: 'warn' });
        const out = await this.runStep({ ...call, args: JSON.stringify({ ...args, command: fixed }) }, signal);
        if (typeof out?.text === 'string') out.text = `(${was} is not this user's Desktop; the command ran with their own, ${this.desktopDir}. Use that path from here on.)\n${out.text}`;
        return out;
      }
    }
    let notYours = '';
    if (call.name === 'Write' && typeof args.path === 'string' && process.env.AGENTIC_DESKTOP_DEFAULT !== 'off' && !this.isHelper && this.turn) {
      const t = this.turn;
      let where = null;
      try { where = desktopDefault(args.path, { cwd: this.cwd, home: this.home, request: t.task ?? t.request ?? '', code: (this.folderKinds?.get(this.cwd) ?? folderKind(this.cwd)) === 'code' }); } catch {}
      if (where?.ask && !t.whereChoice) {
        const question = `Where should ${where.name} go?`;
        const qid = `where_${Date.now()}`;
        const q = { question, options: ['Your Desktop', `This project (${basename(this.cwd)})`], about: ['A new file on the Desktop, where your pages and documents go.', 'Beside the project\'s own files.'], typeLabel: 'Somewhere else…', typeAbout: 'Name the folder.' };
        this.emit('tool-ask', { id: qid, name: 'Ask', label: 'Ask', arg: question });
        const a = await this.ask({ id: qid, name: 'Ask', kind: 'where', args: q, prepared: {}, label: 'Ask', arg: question });
        const said = String(a.text ?? a.feedback ?? '').trim();
        t.whereChoice = /desktop/i.test(said) ? 'desktop' : said ? 'project' : 'project';
        if (said) this.emit('tool', { id: qid, name: 'Ask', label: 'Ask', arg: question, view: { kind: 'answer', question, text: said } });
      }
      if (where?.ask && t.whereChoice === 'desktop') where = { to: join(this.desktopDir, args.path) };
      if (where?.to) {
        args.path = where.to;
        this.desktopAsked = true; // the Desktop's opening for a new file (desktopOpen)
        t.desktopDefaulted = this.tilde(where.to);
        if (where.notYours) {
          const desk = where.notYours.endsWith('/Desktop');
          notYours = `(${where.notYours} is not ${desk ? "this user's Desktop" : "a folder of this user's"}, so the file is on their own Desktop: ${this.tilde(where.to)}. Use that path from here on.)`;
          this.emit('note', { text: `${where.notYours} is not ${desk ? 'your Desktop' : 'a folder of yours'}: written to your own Desktop, ${this.tilde(where.to)}.`, tone: 'warn' });
        }
        else this.emit('note', { text: `New file on your Desktop: ${this.tilde(where.to)} (new files go there unless you say where).`, tone: 'dim', fold: true });
      }
    }
    let prepared;
    try { prepared = prepare(call.name, args, env); } catch (e) { prepared = { error: `${call.name} failed: ${e.code ?? e.message}` }; }
    if (prepared.error) {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: prepared.error }, error: true });
      return { text: prepared.error, error: true };
    }
    // /agents' stop list (agents-guards.mjs): a step on it asks you first, and a no turns it away.
    if (this.toolGuard) {
      const stop = await this.toolGuard({ name: call.name, args, before: prepared.before ?? '', cwd: this.cwd });
      if (stop) {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: stop.denied }, error: true });
        return { text: stop.text, error: true };
      }
    }
    // Tool-call text in what would be written (leakedCall): turned back, so the
    // file never gets it, and the model sends the call again without it.
    if (call.name === 'Write' || call.name === 'Edit') {
      // prepared.before: the file as it is now (empty for a new one).
      const leak = leakedCall(call.name === 'Write' ? args.content : args.new_text, prepared.before ?? args.old_text ?? '');
      if (leak) {
        const msg = `Nothing was written: line ${leak.line} of your ${call.name === 'Write' ? 'content' : 'new_text'} is "${leak.text}", which is tool-call text, not part of the file (the end of your call got into it). Send the ${call.name} again with only the file's own text, and make any next call separately.`;
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: `Turned back: line ${leak.line} is tool-call text (${leak.text})` }, error: true });
        return { text: msg, error: true };
      }
    }
    // Like Claude Code: an existing file must be read before it is edited, so
    // old_text is copied from what is really there.
    if (call.name === 'Edit' && prepared.abs && !this.readFiles.has(prepared.abs)) {
      const msg = `Read ${prepared.rel} first, then copy old_text from it exactly.`;
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: msg }, error: true });
      return { text: msg, error: true };
    }
    // Like Claude Code: a file that changed on disk since the model saw it (a command, a
    // formatter, you, another session) is not changed from the old copy. The lines that changed
    // are shown, and that counts as seeing it again (seen.mjs); too many, and it reads it again.
    if ((call.name === 'Edit' || call.name === 'Write') && prepared.abs && !prepared.created) {
      const ch = this.readFiles.changed(prepared.abs);
      if (ch) {
        const note = changedNote(prepared.rel, ch, call.name);
        if (note.shown) this.readFiles.add(prepared.abs, ch.now);
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'error', message: `${prepared.rel} changed since it was read: ${note.shown ? 'shown the changes' : 'asked to read it again'}` }, error: true });
        return { text: note.text, error: true };
      }
    }
    const at = args.path ? resolvePath(this.cwd, args.path) : null;
    const away = Boolean(at && !at.inside && this.desktopOpen(call.name, at.abs)); // on the Desktop (desktopOpen)
    const inside = at ? at.inside || away : true;
    const rules = this.savedRules();
    let d = decide(call.name, args, { mode: this.mode, allowedPrefixes: this.allowedPrefixes, inside, cwd: this.cwd, rules, rel: at?.realRel ? [at.rel, at.realRel] : at?.rel });
    // Your PreToolUse hook's answer (runTool): allow skips the question, ask asks; a hard stop still holds.
    if (call.pre?.allow && d.decision !== 'deny') d = { decision: 'allow' };
    else if (call.pre?.ask && d.decision !== 'deny') d = { ...d, decision: 'ask' };
    // Auto (/mode): the rules left this step open, so the model checks it against your
    // request first (auto-check.mjs): it runs, or it asks you with the check's reason.
    if (d.decision === 'check') {
      this.emit('auto-check', { id, name: call.name, ...shown });
      const r = await autoCheck({ url: this.url, model: this.model, slot: this.slots?.side, request: this.turn?.request ?? '', name: call.name, args, cwd: this.cwd, signal });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      this.emit('note', { text: `Auto ${r.run ? 'let it run' : 'asks you'}: ${r.reason} (${(r.ms / 1000).toFixed(1)} s)`, tone: 'dim', auto: { run: r.run, failed: Boolean(r.failed) } });
      d = r.run ? { decision: 'allow' } : { ...d, decision: 'ask', autoReason: r.reason };
    }
    // The screen while macOS does not allow pictures yet: no question first, straight to the
    // tool, which takes nothing and says how to set it up (/screen setup).
    if (call.name === 'Screen' && d.decision === 'ask' && !screenAccess()) d = { decision: 'allow' };
    if (d.decision === 'deny') {
      this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'denied', message: d.reason }, error: true });
      const where = args.path ?? /^(.+?) is outside the project folder/.exec(String(d.reason))?.[1];
      return { text: `Not allowed: ${d.reason}. ${this.noteNames(where) ? "If the note that came with the request answers it, answer from the note now; do not look for the files it names." : 'Do something else.'}`, error: true };
    }
    // Edits on auto-accept: the first one of a message is shown as a plan first (not in Bypass, where nothing asks).
    if (d.decision !== 'ask' && (call.name === 'Edit' || call.name === 'Write') && this.turn && !this.turn.planOk && this.confirmPlan && this.mode !== 'bypass' && this.hook('plan')) {
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
      this.userHooks?.fire('Notification', { message: `Agentic Coder needs your permission to use ${call.name}`, notification_type: 'permission_prompt' });
      const answer = await this.ask({ id, name: call.name, args, prepared, ...shown, ...(d.once ? { once: true } : {}), ...(d.protectedBy ? { protectedBy: d.protectedBy } : {}), ...(d.rule ? { rule: d.rule } : {}), ...(d.autoReason ? { autoReason: d.autoReason } : {}), ...(call.name === 'WebSearch' ? { service: PROVIDER_NAMES[this.web?.search] } : {}) });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (answer.choice === 'no') {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
        return { text: `The user said no to this${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}`, error: true, stop: answer.feedback ? null : 'declined' };
      }
      if (answer.choice === 'always') {
        // A commit asks every time (d.once): a "yes" to it is never remembered.
        // What is remembered is the rule for the first part of the command nothing covers yet.
        if (call.name === 'Bash') { const o = d.once ? null : offerFor(args.command, { saved: rules?.allow, session: this.allowedPrefixes, protect: rules?.protect }); if (o) this.allowedPrefixes.add(o.rule); }
        // The web: that site (or searches) without asking, for the rest of this session.
        else if (d.rule) this.allowedPrefixes.add(d.rule);
        else if (!d.once) this.setMode('edits');
      }
      // You saw this change and said yes: that was the plan question.
      if ((call.name === 'Edit' || call.name === 'Write') && this.turn) this.turn.planOk = true;
    }
    // The same part of a file read again while the first read is still in the
    // conversation and the file has not changed: it points back instead of
    // adding the same text twice.
    let readKey = null;
    let mtime = null;
    let paged = null; // the line a repeated Read of an outlined file was moved on to
    if (call.name === 'Read' && this.turn?.reads) {
      const abs = resolvePath(this.cwd, args.path).abs;
      readKey = `${abs}|${args.offset ?? ''}|${args.limit ?? ''}|${args.find ?? ''}`;
      try { mtime = statSync(abs).mtimeMs; } catch {}
      const seen = this.turn.reads.get(readKey);
      // The answer before was a long file's outline, not its lines: "it is above" was not
      // true, and Qwen3.6 went round seven times between the outline and that line until it
      // was stopped as stuck (3 Oct 2026). Asked again with no offset, it gets the file's next
      // part, and the step counts as new. The same for one part asked for twice (the same
      // offset and limit): Qwen3.6 read lines 1-100 of a report twice and the stuck question
      // came up (4 Oct 2026, the owner's pick: give the next part instead).
      if (seen?.next && seen.mtime === mtime && !args.find && seen.next <= (seen.total ?? Infinity) && this.messages.includes(seen.msg) && !String(seen.msg.content).startsWith('[older output removed')) {
        paged = { from: seen.next, outline: seen.outline };
        args.offset = paged.from;
        this.turn.paged = true;
      } else
      // Asked a second time, it is pointed back; asked a third time, it gets
      // the text again: at Low the model once asked four times in 20 seconds,
      // was pointed back each time, and stopped as stuck.
      if (seen && seen.mtime === mtime && this.messages.includes(seen.msg) && !String(seen.msg.content).startsWith('[older output removed') && !seen.pointed) {
        seen.pointed = true;
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'same' } });
        return { text: `You already read this part of ${shown.arg ?? args.path} and it has not changed since; it is above. Use it, or read a different part${args.find ? '' : ' (pass find with a word or name to see the lines around it)'}.` };
      }
    }
    const t0 = Date.now();
    this.emit('tool-running', { id, name: call.name, ...shown });
    let out;
    const aside = call.name === 'Bash' && this.turn?.question && !isReadOnly(args.command);
    // /rewind: the text before the model's edit, and a copy around its commands.
    if ((call.name === 'Edit' || call.name === 'Write') && prepared.abs) this.rewind?.edited(prepared.abs, prepared.created ? null : prepared.before);
    try {
      out = aside ? await this.runAside(args.command, signal)
        : call.name === 'Bash' && this.rewind ? await this.rewind.around(() => execute(call.name, args, prepared, env))
        : await execute(call.name, args, prepared, env);
    } catch (e) { out = { text: `${call.name} failed: ${e.code ?? e.message}`, error: true, view: { kind: 'error', message: e.code ?? e.message } }; }
    // A command the fence stopped, in a message a note of Claude's came with: back to the note.
    if (out.error && /outside the project folder/.test(String(out.text)) && String(args.command ?? args.path ?? '').split(/[\s'"]+/).some((w) => w.includes('/') && this.noteNames(w))) out.text += ' If the note that came with the request answers it, answer from the note now.';
    if (readKey && !out.error) {
      Object.assign(out, { readKey, mtime });
      // An outline, or one part of a long file: a repeat of the same Read moves on (see above).
      const shownLines = out.view?.kind === 'read' && !args.find ? out.view.lines ?? 0 : 0;
      if (out.view?.outline) Object.assign(out, { outline: true, next: 1, total: out.view.total });
      else if (paged) {
        Object.assign(out, { outline: paged.outline, next: paged.from + shownLines, total: out.view?.total });
        out.text = `${paged.outline ? `(You asked for ${args.path} again without an offset. The answer before had only its outline, so here is its next part.` : `(You asked for the same part of ${args.path} again; it is above, so here is the part after it.`} For another part, pass offset and limit.)\n${out.text}`;
      } else if (shownLines && out.view.total > shownLines) Object.assign(out, { next: (args.offset ?? 1) + shownLines, total: out.view.total });
    }
    // Files seen only as an outline (with none of their lines), and walls met (Read before claiming, Stop when blocked).
    if (this.turn) {
      if (call.name === 'Read' && !out.error && args.path) {
        const abs = resolvePath(this.cwd, args.path).abs;
        if (out.view?.outline && !out.view?.matched) { if (!this.turn.readSome?.has(abs)) this.turn.outlined.add(abs); }
        else if (!out.view?.outline) { this.turn.outlined.delete(abs); (this.turn.readSome ??= new Set()).add(abs); }
      }
      if (call.name === 'Bash' && this.turn.outlined.size) for (const f of [...this.turn.outlined]) if (String(args.command ?? '').includes(basename(f))) this.turn.outlined.delete(f);
      if (call.name === 'WebFetch') this.turn.fetched = true;
      (this.turn.callLog ??= []).push({ function: { name: call.name, arguments: JSON.stringify(args ?? {}) } });
      // The app's own words for a step that failed (never a page's or a command's output): the second look's facts.
      if (out.error) (this.turn.errors ??= []).push(call.name === 'Bash' ? `${runLine(args.command)} ended with exit code ${out.view?.code ?? '?'}` : `${call.name}: ${String(out.text).split('\n')[0].split(' What it said')[0].slice(0, 160)}`);
      if (out.wall && !this.turn.walls.some((w) => w.url === out.wall.url)) {
        this.turn.walls.push({ ...out.wall, step: this.turn.steps ?? 0 });
        const hint = this.rememberHint('wall');
        if (hint) out.text += `\n${hint}`;
        this.emit('note', { text: `Blocked: ${out.wall.why}. Told it to ask you rather than do something else.`, tone: 'warn' });
      }
    }
    // What this step did, for which facts the turn really used (usedFacts).
    if (this.happened && this.happened.did.length < 60) this.happened.did.push(`${call.name} ${args.path ?? args.command ?? args.pattern ?? ''}`.slice(0, 300));
    if (!out.error && call.name === 'Read') this.readFiles.add(resolvePath(this.cwd, args.path).abs);
    // This message's searches, newest first: a Read of a long file shows what they found in it.
    if (this.turn && !out.error && call.name === 'Search' && args.pattern) this.turn.searches = [args.pattern, ...(this.turn.searches ?? []).filter((p) => p !== args.pattern)].slice(0, 3);
    if (!out.error && (call.name === 'Edit' || call.name === 'Write') && prepared.abs) this.readFiles.add(prepared.abs, prepared.after);
    if (this.turn && !out.error && (call.name === 'Edit' || call.name === 'Write')) {
      this.keepOriginal(prepared);
      this.turn.changed = true;
      this.turn.testedAfterChange = false;
      this.turn.edits = (this.turn.edits ?? 0) + 1;
      this.happened?.files.add(prepared.rel);
      // A file on the Desktop: it may be read and edited again; one in the project is what the tests check.
      if (away) { (this.desktopMade ??= new Set()).add(prepared.abs); this.turn.changedAway = true; } else this.turn.changedHere = true;
      // Each file as it was before this message's first change to it, for the
      // nothing-lost check at the end (lostSinceStart). A new file has none.
      this.turn.startTexts ??= new Map();
      if (!this.turn.startTexts.has(prepared.rel)) this.turn.startTexts.set(prepared.rel, prepared.created ? null : prepared.before);
      // What changed this turn, for the check at the end (verifyDone).
      const hunk = (out.view?.hunk ?? []).filter((l) => l.type !== ' ').map((l) => `${l.type}${l.text}`).join('\n');
      // Up to 6,000 characters a file, 16,000 in all; anything longer is
      // marked as cut here, so the check never takes the cut for the file's end
      // (a 1,500-character cut once made a finished story look "cut off at 'sti'").
      const piece = hunk.length > 6000 ? `${hunk.slice(0, 6000)}\n${CUT_MARK}` : hunk;
      if (this.turn.diffs.length < 16000) this.turn.diffs += `${prepared.rel}:\n${piece}\n`;
    }
    if (this.turn && !out.error && call.name === 'Write' && prepared.created && !this.turn.created.includes(prepared.rel)) this.turn.created.push(prepared.rel);
    // The design studio's build (studio.mjs): a page written from the studio's
    // pieces, or one built before, gets the CSS for its Tailwind classes built
    // into it, so it opens with a double-click and no internet.
    if (!out.error && (call.name === 'Edit' || call.name === 'Write') && prepared.abs && /\.html?$/i.test(prepared.abs)) {
      const note = await this.buildStudio(prepared);
      // The built styles are the app's own change: the file as it is now is what the model has seen.
      this.readFiles.add(prepared.abs);
      if (note) out.text += `\n${note}`;
    }
    // The lsp helper: a new file that does not parse is said in the same
    // reply, not found a few steps later by a test run or the browser.
    if (!out.error && call.name === 'Write' && prepared.abs && this.helpers.has('lsp')) {
      const broken = syntaxError(prepared.abs, prepared.after, { more: true });
      if (broken) {
        out.text += ` But it does not parse yet: ${broken}. Fix that with Edit before going on.`;
        this.emit('note', { text: `${prepared.rel} does not parse yet: ${broken}`, tone: 'warn' });
      }
    }
    if (notYours && !out.error && typeof out.text === 'string') out.text += `\n${notYours}`;
    // A Write that landed has used (or replaced) the kept content.
    if (!out.error && call.name === 'Write' && this.keptWrite) {
      if (parsed.fromKept) this.emit('note', { text: `Wrote the kept content to ${prepared.rel}; it was not written again.`, tone: 'dim' });
      this.keptWrite = null;
    }
    // A command may have written files the Edit and Write counts never see.
    if (this.turn && call.name === 'Bash') this.turn.ranCommand = true;
    // A long script it typed in is saved as SCRIPTS/… (scripts.mjs): it has seen it, so Edit may change it.
    if (call.name === 'Bash' && out.saved?.abs) this.readFiles.add(out.saved.abs);
    // The files a command wrote (made.mjs): said in its result, kept for the page checks and the second look.
    if (this.turn && call.name === 'Bash' && out.view?.kind === 'bash' && !out.view.timedOut && !isReadOnly(args.command)) {
      let made = [];
      // The Desktop is other sessions' too: what is new there counts when the command, its output or its script names it.
      try { made = filesMade(args.command, { since: t0, cwd: this.cwd, home: this.home, dirs: [this.cwd, this.turn.workFolder, this.desktopDir], shared: [this.desktopDir], said: out.text, ran: commandWithScripts(args.command, this.cwd) }).filter((f) => !inScripts(f.abs)); } catch {}
      if (made.length) {
        this.turn.madeByCommand ??= new Map();
        for (const f of made) this.turn.madeByCommand.set(f.abs, f.bytes);
        out.text += `\n${madeNote(made, (p) => this.tilde(p))}`;
      }
    }
    // One that could have written a file (not ls, git log, cat…): the "said done, nothing changed" check counts it as a change.
    if (this.turn && call.name === 'Bash' && !isReadOnly(args.command)) this.turn.wroteByCommand = true;
    // A run of the tests (the project's test command, this message's check, or a test runner): only
    // such a command is the check, never one that reads or searches a test file. It failed when its
    // runner counted a failure or it exited with an error; piped on into another command (… | tail)
    // with no counts in what came out, the result is not known (failed: null) and changes nothing,
    // so the app runs the tests itself before the message ends (checkCmd).
    const run = call.name === 'Bash' && out.view?.kind === 'bash' ? testRunOf(args.command, { testCmd: this.testCmd, check: this.turn?.check }) : null;
    const tests = run ? { failed: testsFailed(out.view.lines?.join('\n') ?? out.text, out.error ? 1 : 0, run) } : null;
    const known = tests && tests.failed !== null;
    // How many fail, when the runner counted them: a loop's run says it (loop-run.mjs), and a
    // debugging loop that is not getting closer waits for you (loops.mjs stuckWhy).
    const count = known ? failsOf(out.view?.lines?.join('\n') ?? out.text, tests.failed)?.failed : null;
    // Every run of checks this message (Answer matches results): a test run, or any command whose output
    // counts what passed and failed (a script of its own, written by a heredoc: 4 Oct 2026).
    if (this.turn && call.name === 'Bash' && out.view?.kind === 'bash') {
      const said = out.view.lines?.join('\n') ?? out.text;
      const counted = readResults(said, out.view.code ?? 0);
      if (run || counted.failed !== null) {
        const failed = run && tests.failed !== null ? tests.failed : counted.failed !== null ? counted.failed > 0 || (out.view.code ?? 0) !== 0 : (out.view.code ?? 0) !== 0;
        const before = this.turn.checks.at(-1);
        this.turn.checks.push({ cmd: runLine(args.command), code: out.view.code ?? 0, failed, counts: countLine(said), step: this.turn.steps ?? 0 });
        if (before?.failed && !failed) { const hint = this.rememberHint('fixed'); if (hint) out.text += `\n${hint}`; }
      }
    }
    if (Number.isFinite(count)) tests.count = count;
    if (this.keepProgress && this.turn && known && !this.turn.changed && !this.turn.failsBefore) this.turn.failsBefore = failsOf(out.view?.lines?.join('\n') ?? out.text, tests.failed);
    if (this.turn && known && this.turn.changed) {
      this.turn.testedAfterChange = true;
      this.turn.checkOk = !tests.failed;
      this.turn.checkFailed = tests.failed;
      // What still fails after the change, for a loop's run that may keep a half-fix.
      if (this.keepProgress) this.turn.failsAfter = failsOf(out.view?.lines?.join('\n') ?? out.text, tests.failed);
      if (this.happened) this.happened.check = { cmd: String(args.command).slice(0, 120), ok: !tests.failed };
    }
    this.emit('tool', { id, name: call.name, ...shown, view: out.view, error: out.error, secs: (Date.now() - t0) / 1000, ...(tests ? { tests } : {}) });
    return out;
  }

  // The model's own tools (tools.mjs MODEL_TOOL_DEFS): what the app did for it before its
  // first step, now when it asks. Rename and TestFirst change files, so plan mode refuses them
  // (as it refuses Edit); each change they make still asks as your mode says.
  async runModelTool(name, args, shown, id, signal) {
    const seen = (view, error = false) => this.emit('tool', { id, name, ...shown, view, error });
    const d = decide(name, args, { mode: this.mode });
    if (d.decision === 'deny') { seen({ kind: 'denied', message: d.reason }, true); return { text: `Not allowed: ${d.reason}.`, error: true }; }
    if (this.happened && this.happened.did.length < 60) this.happened.did.push(`${name} ${args.query ?? args.task ?? args.fact ?? (args.from ? `${args.from} ${args.to}` : '')}`.slice(0, 300));
    if (name === 'Map') {
      if (isHomeFolder(this.cwd)) { seen({ kind: 'error', message: 'No map of the home folder' }, true); return { text: 'There is no map of the home folder: it would list whatever code it meets first. List a folder, or work in a project folder.', error: true }; }
      // A part of the project's code map (docs/map/<part>.md, tools/codemap.mjs).
      if (args.part) {
        const ladder = readLadder(join(this.cwd, MAP_DIR));
        // A path for a part ("docs/map/docs/tools.md", "terminal/src/agent/x.mjs") means the part it is in (ladder.mjs partFor).
        const p = ladder ? openPart(ladder.dir, partFor(ladder, args.part) ?? args.part) : null;
        if (!p) { const all = ladder ? [...new Set(ladder.parts.map((x) => x.file.replace(/\.md$/, '')))] : []; const names = all.length <= 8 ? all : nearParts(ladder, args.part); seen({ kind: 'error', message: 'No such part' }, true); return { text: ladder ? `No part "${args.part}" in docs/map. ${all.length <= 8 ? 'Its parts' : 'Parts near it'}: ${names.join(', ')}${all.length <= 8 ? '' : ' (MAP.md lists the top ones)'}; a part names the parts inside it with an arrow.` : 'This project has no code map (docs/map). Map without a part lists its code files.', error: true }; }
        this.mapGiven = true;
        seen({ kind: 'list', count: partsOf(p.text).length, content: p.text });
        return { text: `docs/map/${p.file}:\n${p.text}` };
      }
      let map = null;
      try { map = repoMap(this.cwd, { maxChars: 4500, ladder: true }); } catch {}
      if (!map?.entries?.length) { seen({ kind: 'list', count: 0, content: '' }); return { text: 'No code files here. List shows what the folder holds.' }; }
      this.mapGiven = true;
      seen({ kind: 'list', count: map.entries.length, content: map.text });
      return { text: map.ladder ? map.text : `Code files in the project (lines: top-level names):\n${map.text}` };
    }
    if (name === 'CodeSearch') {
      const off = this.codeSearchOff();
      if (off) { seen({ kind: 'error', message: 'The code search is off' }, true); return { text: `The code search is off here: ${off}. Use Search with a word or name instead.`, error: true }; }
      let found = null;
      try { found = await this.findCode(args.query, signal); } catch (e) { if (signal?.aborted || e.name === 'AbortError') return { text: 'Interrupted.', stop: 'interrupted' }; }
      if (found?.waiting) { seen({ kind: 'search', count: 0, content: '' }); return { text: `The code search is still indexing${found.total ? ` (${found.done} of ${found.total} parts)` : ''}. Use Search with a word or name for now.` }; }
      const picked = (found?.parts ?? []).filter((p) => p.close >= CUT).slice(0, 8);
      if (!picked.length) { seen({ kind: 'search', count: 0, content: '' }); return { text: 'Nothing close to that in the code. Try other words, or Search for a name.' }; }
      let room = CODE_SEARCH_CHARS;
      const pieces = [];
      for (const p of picked) {
        let all;
        try { all = readFileSync(resolvePath(this.cwd, p.rel).abs, 'utf8').replace(/\n$/, '').split('\n'); } catch { continue; }
        const end = Math.min(p.end, all.length);
        const body = `${p.rel} (lines ${p.line}-${end} of ${all.length}) · ${p.name}:\n${all.slice(p.line - 1, end).join('\n')}`;
        if (body.length > room) { if (!pieces.length) pieces.push(`${body.slice(0, room)}\n… (cut; Read the file for the rest)`); break; }
        room -= body.length;
        pieces.push(body);
      }
      const list = picked.map((p) => `${p.rel}:${p.line} ${p.name}`).join('\n');
      seen({ kind: 'search', count: pieces.length, content: list });
      return { text: `The parts closest in meaning to "${args.query}", closest first:\n\n${pieces.join('\n\n')}` };
    }
    if (name === 'Remember') return this.rememberFact(args, seen);
    // Rename and TestFirst: the focused paths, run for the model (flows/index.mjs runKind).
    if (!isCodeProject(this.cwd)) { seen({ kind: 'error', message: 'Not a code project here' }, true); return { text: `${name} works in a project folder with code; here, do it yourself with Search, Read and Edit.`, error: true }; }
    seen({ kind: 'started' });
    const counted = { tokens: 0, thinkTokens: 0 };
    const tally = ({ tokens, thought }) => { counted.tokens += tokens + thought; counted.thinkTokens += thought; this.stats.outTokens += tokens + thought; };
    tallies.add(tally);
    const ctx = this.flowContext(signal);
    let said = '';
    const note = ctx.note;
    ctx.note = (text, tone) => { said = String(text); note(text, tone); };
    const filesBefore = this.happened?.files.size ?? 0;
    let out = null;
    this.carried = null;
    try {
      const kind = name === 'Rename' ? 'rename' : args.kind === 'fix' || args.kind === 'change' ? args.kind : /\b(fix|bug|broken|fails?|failing|crash(es)?|wrong|error)\b/i.test(args.task ?? '') ? 'fix' : 'change';
      out = await runKind(ctx, name === 'Rename' ? { kind, from: args.from, to: args.to } : { kind }, name === 'Rename' ? `rename ${args.from} to ${args.to}` : args.task);
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') return { text: 'Interrupted.', stop: 'interrupted' };
      said = `it failed (${e.message})`;
    } finally {
      tallies.delete(tally);
      this.emit('flow-step', null);
      if (this.turn) { this.turn.tokens = (this.turn.tokens ?? 0) + counted.tokens; this.turn.thinkTokens = (this.turn.thinkTokens ?? 0) + counted.thinkTokens; }
    }
    if ((this.happened?.files.size ?? 0) > filesBefore && this.turn) { this.turn.changed = true; this.turn.changedHere = true; this.turn.testedAfterChange = Boolean(out?.done); }
    // A check the fix path made for the change still to come (flows/pagecheck.mjs).
    const left = this.carried ? `\n${this.carried.note}` : '';
    if (this.carried?.check && this.turn) this.turn.check = this.carried.check;
    this.carried = null;
    if (out?.declined) return { text: out.summary, stop: 'declined' };
    if (out) {
      if (this.happened) this.happened.flow = { done: out.done, summary: String(out.summary ?? '').slice(0, 300) };
      return { text: `${out.summary}${out.done === false ? ' Its check did not pass: look at why before you report.' : ''}${left}` };
    }
    const why = said.replace(/;\s*working step by step instead\.?$/, '').replace(/\.$/, '') || 'it could not finish';
    return { text: `${name === 'Rename' ? 'Rename' : 'The test-first worker'} handed it back: ${why}. Carry on yourself with Read, Edit and the tests.${left}` };
  }
}
