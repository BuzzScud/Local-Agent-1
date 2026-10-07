// The Agent's MCP side (agent.mjs): the servers' tools taken for a conversation, shown by name or
// through the Mcp tool, and a call to one run, with a server's own questions.
// Its methods are put on Agent.prototype by agent.mjs, so this is the Agent: every this.x() is the agent's own.
import { randomUUID } from 'node:crypto';
import { endpointOf } from '../../../models/index.mjs';
import { EXPLORE_TOOLS } from './tools.mjs';
import { decide } from './permissions.mjs';
import { MCP_TOOL, argLines, argsPreview, catalogStamp, checkArgs, describeEntry, describeServer, findEntry, gateCall, mcpBrief, mcpPlan, mcpRule, mcpToolDefs, resultParts, resultText, unwrapArgs } from './mcp.mjs';
import { pictureFor } from '../tools/mcp.mjs';
import { MCP_WAIT_MS } from './agent-said.mjs';

export class McpPart {
  // settled: only when no server is still starting (before the model's warm-up, so what it reads
  // ahead holds the tools; a server not there yet must not be shut out of the conversation for that).
  async mcpTake({ settled = false } = {}) {
    if (!this.mcp || this.isHelper || (this.mcpFrozen && !this.mcpStale)) return;
    if (settled && this.mcp.status().some((s) => s.state === 'starting')) return;
    const late = await this.mcp.ready(MCP_WAIT_MS);
    const entries = this.mcp.catalog();
    const stamp = catalogStamp(entries);
    const had = this.mcpFrozen?.stamp ?? catalogStamp([]);
    this.mcpStale = false;
    this.mcpFrozen = { entries, stamp, notes: this.mcp.notes?.() ?? {}, connectors: (this.mcp.connectors?.() ?? []).map(({ name, url }) => ({ name, url })) };
    this.mcpPlans = new Map();
    if (late.length) this.emit('note', { text: `MCP: ${late.join(', ')} ${late.length === 1 ? 'is' : 'are'} still starting, so ${late.length === 1 ? 'its' : 'their'} tools are not in this conversation. They join at the next one (/clear), or when you save in /mcp.`, tone: 'warn' });
    if (had !== stamp && this.messages.length > 1) this.emit('note', { text: 'The MCP tools changed (/mcp): the model reads the conversation again with the new list.', tone: 'dim' });
    // The MCP guide and TOOLS.md's MCP lines are in the instructions only while a tool is offered
    // (a prompt this app built; a caller's own is left as it is).
    if ((this.mcpInPrompt ?? '') !== this.mcpPrompt() && typeof this.messages[0]?.content === 'string' && this.messages[0].content.includes('\nTool use\n')) this.refreshNotes();
  }
  // The tools a retry offers (mcpFocus: requestHits of the request): the ones the request's note
  // named, by their own definitions, and Mcp for those reached through it; nothing else, so "that tool
  // is not available" cannot be the answer. Only for that one step: the next has the whole list again.
  mcpFocusTools(hits) {
    const names = new Set(hits.flatMap((h) => h.tools.map((e) => e.name)));
    const gate = hits.some((h) => h.gated || !h.tools.length);
    const defs = this.mcpDefs().filter((t) => names.has(t.function.name) || (gate && t.function.name === MCP_TOOL));
    return defs.length ? defs : this.tools();
  }
  // The MCP tools this agent may use, of the conversation's list: every one that is on; an explore
  // helper those the user marked as reading; one of the user's helper agents those its file names.
  // off: with the ones switched off too (a call to one is told it is off, not that it does not exist).
  mcpEntries({ off = false } = {}) {
    // On the Claude API a server handed to Anthropic's connector is Anthropic's to call, not this app's.
    const theirs = endpointOf(this.url)?.kind === 'claude' ? new Set((this.mcpFrozen?.connectors ?? []).map((s) => s.name)) : null;
    const all = (this.mcpFrozen?.entries ?? []).filter((e) => (off || e.on) && !theirs?.has(e.server));
    if (!this.toolFilter) return all;
    return this.toolFilter === EXPLORE_TOOLS ? all.filter((e) => e.reads) : all.filter((e) => this.toolFilter.has(e.name));
  }
  mcpOn() { return this.mcpEntries().length > 0; }
  // The servers Anthropic's connector calls in this conversation (the Claude API only), each with its token as it is now.
  mcpConnectors() {
    if (endpointOf(this.url)?.kind !== 'claude' || !this.mcpFrozen?.connectors?.length || this.isHelper) return [];
    const now = new Map((this.mcp?.connectors?.() ?? []).map((s) => [s.name, s]));
    return this.mcpFrozen.connectors.map((s) => now.get(s.name) ?? s);
  }
  // What the instructions say of the MCP tools: '' (none on), or the servers' list (agent/mcp.mjs
  // mcpBrief), which also brings TOOLS.md's MCP lines.
  mcpPrompt() {
    const entries = this.mcpEntries();
    if (!entries.length) return '';
    return mcpBrief(entries, { listed: this.mcpListed(), notes: this.mcpFrozen?.notes ?? {} });
  }
  // The tools listed inside the Mcp tool (by name only), of this conversation's plan.
  mcpListed() {
    this.mcpDefs();
    return this.mcpPlans?.get(`${endpointOf(this.url)?.kind === 'claude' ? 'claude' : 'other'}|${this.ctx}`)?.plan?.listed ?? [];
  }
  // As tool definitions (agent/mcp.mjs mcpPlan): by name, by name and one line with the Mcp tool,
  // or deferred on the Claude API. Worked out once per conversation, kind of server and context
  // size, so the list a model is sent stays the same, letter for letter (another context size, or
  // another kind of server, has the model read everything again anyway).
  mcpDefs() {
    if (!this.mcpFrozen) return [];
    const kind = endpointOf(this.url)?.kind === 'claude' ? 'claude' : 'other';
    const key = `${kind}|${this.ctx}`;
    const plans = (this.mcpPlans ??= new Map());
    if (!plans.has(key)) { const plan = mcpPlan(this.mcpEntries(), { kind, ctx: this.ctx }); plans.set(key, { plan, defs: mcpToolDefs(plan, { kind }) }); }
    return plans.get(key).defs;
  }

  // A call to a tool of one of the user's MCP servers (agent/mcp.mjs): by its own name, or through
  // Mcp for a tool listed by name only (Mcp with only "tool" answers with that tool's arguments and
  // runs nothing). The steps: which tool, its arguments made to fit, whether it may run (asked
  // before a tool's first use; a tool that changed since you allowed it asks again; a question, or
  // a skill that only reads, asks even for an allowed tool you did not mark as reading; /agents'
  // stop list), then the call, and its answer as text and pictures, marked as data.
  async runMcp(call, signal) {
    const id = call.id;
    if (this.turn) this.turn.mcpTried = true;
    const fail = (shown, text, view) => { this.emit('tool', { id, name: call.name, ...shown, view: view ?? { kind: 'error', message: String(text).split('\n')[0].slice(0, 200) }, error: true }); return { text, error: true }; };
    let raw = null;
    try { raw = call.args && String(call.args).trim() ? JSON.parse(call.args) : {}; } catch { /* said below */ }
    const gate = call.name === MCP_TOOL;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail({ label: 'MCP', arg: call.name }, 'The arguments were not valid JSON. Write the call again with a valid JSON object.');
    const sent = gate ? gateCall(raw) : null;
    const asked = gate ? sent.asked : call.name;
    const found = findEntry(this.mcpEntries({ off: true }), asked);
    if (found.error) {
      // A helper asking for a tool it was not given: said as for the app's own tools.
      const other = this.toolFilter ? findEntry((this.mcpFrozen?.entries ?? []).filter((e) => e.on), asked).entry : null;
      return fail({ label: 'MCP', arg: String(asked ?? '') }, other ? `${other.name} is not one of this helper's tools${this.toolFilter === EXPLORE_TOOLS ? ': it only reads, and the user has not marked that tool as one that only reads' : ''}. Report what should be done instead.` : found.error, other ? { kind: 'denied', message: this.toolFilter === EXPLORE_TOOLS ? 'this helper only reads' : "not one of this helper's tools" } : undefined);
    }
    if (found.tools) {
      const text = describeServer(found.server, found.tools);
      this.emit('tool', { id, name: call.name, label: 'MCP', arg: `${found.server}'s tools`, view: { kind: 'list', count: found.tools.length, content: text } });
      return { text };
    }
    const entry = found.entry;
    let given = gate ? sent.given : unwrapArgs(entry, raw);
    const label = `${entry.server} · ${entry.tool}`;
    // Only "tool": its arguments, and nothing runs; a tool that takes none just runs (Qwen3.6 asked for
    // the logo tool's arguments three times over, was told "none" each time, and gave up: 3 Oct 2026).
    if (gate && given === undefined && !argLines(entry).length) given = {};
    if (gate && given === undefined) {
      const text = describeEntry(entry);
      this.emit('tool', { id, name: call.name, label, arg: 'its arguments', view: { kind: 'mcp', looked: true, lines: text.split('\n').length, content: text } });
      return { text };
    }
    const checked = checkArgs(entry, given);
    if (checked.error) return fail({ label, arg: '' }, checked.error);
    const args = checked.args;
    const shown = { label, arg: argsPreview(args) };
    // The tool as its server lists it now. One that is no longer the tool this conversation's list
    // was taken with, or the one you allowed, counts as changed: it asks again, and your "reads"
    // mark (made for the tool as it was) does not hold.
    const live = this.mcp.printOf(entry.server, entry.tool);
    const server = this.mcp.stateOf(entry.server);
    if (live === null && server?.state === 'connected') return fail(shown, `${entry.name} is gone: the MCP server "${entry.server}" no longer lists it. Use another tool, or tell the user.`);
    const now = live ?? entry.print;
    const rule = mcpRule(entry.server, entry.tool);
    const rules = this.savedRules();
    const has = (list) => [...(list ?? [])].some((r) => String(r).toLowerCase() === rule.toLowerCase());
    let savedPrint = has(rules?.allow) ? this.mcp.allowed?.print(entry.id) ?? null : null;
    // A rule typed in /permissions has no fingerprint yet: it takes the tool as it is at its first use.
    if (has(rules?.allow) && !savedPrint) { savedPrint = now; try { this.mcp.allowed?.remember(entry.id, now); } catch { /* it holds for this run */ } }
    const allowedNow = (has(rules?.allow) && savedPrint === now) || (has(this.allowedPrefixes) && this.mcpPrints.get(entry.id) === now);
    const moved = now !== entry.print;
    const changed = !allowedNow && (moved || has(rules?.allow) || has(this.allowedPrefixes));
    const reads = entry.reads && !moved;
    // A call by another form of the tool's name (shop__get_ticket) is judged as the tool it is.
    let d = decide(gate ? MCP_TOOL : entry.name, args, { mode: this.mode, allowedPrefixes: this.allowedPrefixes, rules, mcp: { server: entry.server, tool: entry.tool, reads, changed } });
    // A question changes nothing, and a skill that only reads stays that way: a tool you did not
    // mark as reading asks here even when a rule allows it (not in Bypass, where nothing asks).
    let note = null;
    if (!reads && d.decision === 'allow' && this.mode !== 'bypass' && (this.turn?.question || this.turn?.fence?.has('read'))) {
      note = this.turn?.question ? 'This was read as a question, and the tool is not one you marked as only reading.' : 'This skill only reads, and the tool is not one you marked as only reading.';
      d = { decision: 'ask', rule, once: true };
    }
    // /agents' stop list (agents-guards.mjs): a tool that may change things asks first while it
    // builds, and is turned away where a stage only reads.
    if (this.toolGuard) {
      const stop = await this.toolGuard({ name: entry.name, args, before: '', cwd: this.cwd, mcp: { server: entry.server, tool: entry.tool, reads } });
      if (stop) return fail(shown, stop.text, { kind: 'denied', message: stop.denied });
    }
    if (d.decision === 'deny') return fail(shown, `Not allowed: ${d.reason}. Do something else.`, { kind: 'denied', message: d.reason });
    if (d.decision === 'ask') {
      this.emit('tool-ask', { id, name: call.name, ...shown });
      this.userHooks?.fire('Notification', { message: `Agentic Coder needs your permission to use ${call.name}`, notification_type: 'permission_prompt' });
      const answer = await this.ask({ id, name: MCP_TOOL, args, ...shown, ...(d.once ? { once: true } : { rule }), mcp: { id: entry.id, server: entry.server, tool: entry.tool, name: entry.name, print: now, says: entry.says, changed, note, where: server?.where ?? null, runs: server?.runs ?? null } });
      if (signal?.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      if (answer.choice === 'no') {
        this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'declined', feedback: answer.feedback }, error: true });
        return { text: `The user said no to this${answer.feedback ? ` and wrote: ${answer.feedback}` : '. Wait for their next message.'}`, error: true, stop: answer.feedback ? null : 'declined' };
      }
      if (answer.choice === 'always' && !d.once) { this.allowedPrefixes.add(rule); this.mcpPrints.set(entry.id, now); }
    }
    const t0 = Date.now();
    this.emit('tool-running', { id, name: call.name, ...shown });
    let result;
    try {
      result = await this.mcp.call(entry.server, entry.tool, args, { signal, ask: (params) => this.mcpAsked(entry, params, signal) });
    } catch (e) {
      if (signal?.aborted || e.aborted) return { text: 'Interrupted.', stop: 'interrupted' };
      const down = this.mcp.stateOf(entry.server)?.state !== 'connected';
      return fail(shown, `${label} did not run: ${e.message}.${down ? ` The MCP server "${entry.server}" is not running now: its tools are not there until the user looks at it in /mcp. Go on with what you can do without it, and say so.` : ''}`, { kind: 'error', message: `${e.message}`.slice(0, 200) });
    }
    const parts = resultParts(result);
    // A picture, for a model that is not looking at pictures yet: its vision is turned on where it can be, as for Screen.
    if (parts.pictures.length && !this.canSee && this.visionOn) { try { await this.visionOn(); } catch { /* the result says the picture is not shown */ } }
    const images = this.canSee ? parts.pictures.map((pic, i) => pictureFor(pic, `${label}${parts.pictures.length > 1 ? `, picture ${i + 1}` : ''}`)).filter(Boolean) : [];
    if (this.happened && this.happened.did.length < 60) this.happened.did.push(`${entry.name} ${argsPreview(args, 200)}`.slice(0, 300));
    // A tool that may have changed something counts as a command run (the "nothing changed" checks).
    if (this.turn && !reads) this.turn.ranCommand = true;
    this.emit('tool', { id, name: call.name, ...shown, view: { kind: 'mcp', lines: parts.body ? parts.body.split('\n').length : 0, pictures: parts.pictures.length, shown: images.length, content: parts.body, ms: Date.now() - t0 }, error: parts.error });
    return { text: resultText(entry, parts, { max: this.maxResultChars, seen: images.length > 0 }), error: parts.error, ...(images.length ? { images } : {}) };
  }

  // A question of an MCP server's own while one of its tools runs (elicitation): it is the
  // server's question, shown as such, one line at a time; your answer goes to the server only.
  // { action: 'accept', content } · { action: 'decline' } · { action: 'cancel' }
  async mcpAsked(entry, params, signal) {
    if (!this.ask) return { action: 'decline' };
    const who = { kind: 'mcp', asker: entry.server, tool: entry.tool };
    const asked = async (question, options = []) => {
      const answer = await this.ask({ id: `mcp-ask-${randomUUID().slice(0, 8)}`, name: 'Ask', ...who, args: { question, options, about: [], recommended: -1, several: false }, prepared: {}, label: 'Ask', arg: question });
      if (signal?.aborted) return { stop: 'cancel' };
      return answer.choice === 'no' || answer.text === undefined ? { stop: 'decline' } : { text: String(answer.text).trim() };
    };
    // It wants a page opened (a sign-in, a payment): the address is shown; you open it yourself.
    if (params?.mode === 'url') {
      const got = await asked(`${String(params.message ?? 'Open this page to go on').trim()}\n${params.url}`, ['I opened it']);
      return got.stop ? { action: got.stop } : { action: 'accept' };
    }
    const props = Object.entries(params?.requestedSchema?.properties ?? {});
    if (!props.length) { const got = await asked(String(params?.message ?? 'Go on?').trim(), ['Yes']); return got.stop ? { action: got.stop } : { action: 'accept', content: {} }; }
    const content = {};
    for (const [key, p] of props) {
      const choices = Array.isArray(p?.enum) ? p.enum.map(String) : Array.isArray(p?.oneOf ?? p?.anyOf) ? (p.oneOf ?? p.anyOf).map((o) => String(o.const ?? o.title ?? '')).filter(Boolean) : p?.type === 'boolean' ? ['yes', 'no'] : [];
      const got = await asked(`${String(params.message ?? '').trim()}${props.length > 1 ? `\n${p?.title ?? key}${p?.description ? `: ${p.description}` : ''}` : ''}`.trim() || key, choices.slice(0, 8));
      if (got.stop) return { action: got.stop };
      content[key] = p?.type === 'boolean' ? /^(y|yes|true|1)$/i.test(got.text) : (p?.type === 'number' || p?.type === 'integer') && Number.isFinite(Number(got.text)) ? Number(got.text) : got.text;
    }
    return { action: 'accept', content };
  }
}
