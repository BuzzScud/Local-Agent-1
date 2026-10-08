// Streams one chat completion from llama-server (OpenAI format) and turns the
// SSE chunks into simple events: reasoning, text, tool-call pieces, done.
// A remote (/remote) is asked the same way, with its API key; an
// OpenAI-compatible one (not llama.cpp) gets only the standard fields, an
// Ollama service its own chat (streamOllama: the only one that takes a context
// size), and the Claude API goes through Anthropic's own Messages API (claude.mjs).
// A server that answers with an error throws one carrying its status: it is up,
// it said no (the agent connects again only when the connection itself broke).
// Bun's fetch gives up on a request that receives nothing for 6 minutes ("The operation
// timed out.", before the first word or mid-reply); a busy service or a long conversation
// read again takes longer, so the model's requests turn that off (timeout: false). Esc
// still stops them (signal).
import { thinkingKwargs, thinkingLevel, endpointOf, authHeaders, isOutOfMemory } from '../../../models/index.mjs';
import { streamClaude } from './claude.mjs';
import { openAIMessages, ollamaMessages } from './images.mjs';
import { splitThink } from './think-tags.mjs';
import { withBusyRetry, retryAfterHeader, isBusy } from './busy.mjs';
import { noteServed, noteSpill } from './profile-meters.mjs';
import { recordSpend } from './spend.mjs';
import { qwenRawFits, renderQwen35, callOpening } from './qwen-raw.mjs';

// What only llama.cpp's server reads: the slot, its prompt cache, the
// thinking switch and cap, its extra sampling. Not sent to another kind.
const LLAMA_ONLY = ['cache_prompt', 'id_slot', 'chat_template_kwargs', 'thinking_budget_tokens', 'top_k', 'min_p', 'repeat_penalty', 'typical_p', 'n_probs'];
// Standard fields a server may still refuse (an older one, or a model that
// cannot think): named in its error, they are left out of the next call to it.
const OPTIONAL = ['usage', 'reasoning_effort', 'parallel_tool_calls', 'stream_options', 'presence_penalty', 'frequency_penalty', 'top_p', 'temperature', 'seed'];
// Ollama names the ability, not the field: "\"llama3.2:3b\" does not support thinking".
// Only those words leave the tools out (a 400 about one tool's name must not):
// the model is then asked without them, and answers in words.
const ABILITY = { thinking: 'reasoning_effort', tools: 'tools' };
// What each model refused, by address and model: one service runs many models
// (Ollama), and one that cannot think says nothing about the next.
const refused = new Map(); // `${url} ${model}` → the fields that model refused
const refusedKey = (url, model) => `${url ?? ''}\u0000${model ?? ''}`;
// An error the server answered with (its status kept, and how long it asked to wait: busy.mjs),
// and the one for a model that does not fit (noRoom: summarizing the conversation would not make it fit).
const serverError = (text, status, res) => Object.assign(new Error(text), { status, ...(res?.headers?.get?.('retry-after') ? { retryAfter: retryAfterHeader(res.headers.get('retry-after')) } : {}) });
const roomError = (ep, status) => Object.assign(serverError(`the service has no room to load ${ep.model} (out of GPU memory): /model picks another, or /effort a smaller Context`, status), { noRoom: true });

// The body as an OpenAI-compatible server takes it (exported for the tests).
export function openaiBody(body, { model, effort, thinking, url } = {}) {
  const out = { ...body, model };
  for (const k of LLAMA_ONLY) delete out[k];
  if (thinking && effort) out.reasoning_effort = effort;
  for (const k of refused.get(refusedKey(url, model)) ?? []) {
    if (k === 'max_tokens' && out.max_tokens !== undefined) { out.max_completion_tokens = out.max_tokens; delete out.max_tokens; }
    else if (k === 'tools') { delete out.tools; delete out.tool_choice; delete out.parallel_tool_calls; }
    else delete out[k];
  }
  return out;
}

// The field a 400 names as not taken, when it is one we can leave out.
export function refusedField(status, text, body) {
  if (status !== 400 && status !== 422) return null;
  if (/max_tokens/.test(text) && /max_completion_tokens/.test(text) && body.max_tokens !== undefined) return 'max_tokens';
  const ability = /does not support (thinking|tools)\b/.exec(text)?.[1];
  if (ability && body[ABILITY[ability]] !== undefined) return ABILITY[ability];
  return OPTIONAL.find((k) => body[k] !== undefined && new RegExp(`\\b${k}\\b`).test(text)) ?? null;
}

// toolChoice 'none' keeps the tool list in the prompt (so the saved reading of
// the instructions still matches) but lets the model only write text.
// parallel: the model may send several calls in one reply (when the model decides, agent/way.mjs).
// A model whose thinking comes between tags of its own (thinkTags: K2 Horizon)
// has it sorted from its answer on the way (think-tags.mjs).
// A remote that says it is busy is asked again after a wait (busy.mjs): { type: 'busy' } events
// come meanwhile. The wait is shared by every window on the same service (its label).
// use: another model on the same Ollama service for this one call (a /subagents helper):
// { model, numCtx, thinks, tools, family, keepAlive }, laid over the service's endpoint.
// use: another model for this one call (/subagents' helpers on an Ollama service; on the Claude API, the model alone: /btw's lowest one).
// A profile (profiles.mjs) adds its server (use.url, the call goes there), its name (meters) and its
// backup (spill): none of them is the endpoint's. An OpenAI-style service takes another of its models by name too.
const endpointFor = (url, use) => {
  const ep = endpointOf(url);
  if (!ep || !use) return ep;
  const { url: _u, profile: _p, spill: _s, ...u } = use;
  return ep.ollama ? { ...ep, ...u } : u.model && (ep.kind === 'claude' || ep.kind === 'openai') ? { ...ep, model: u.model } : ep;
};

// The conversation's profile, for the calls the agent makes on its model without naming one (a summary,
// the cases, the second look, a check): its backup, its cool-down and its meter, as its steps have them.
// The agent registers it by its address when it follows a profile (agent-model.mjs followProfile).
const routed = new Map(); // address → () => { profile, spill } | { use, profile }
const bare = (url) => String(url ?? '').replace(/\/+$/, '');
export function routeCalls(url, extras) { if (extras) routed.set(bare(url), extras); else routed.delete(bare(url)); }

export async function* streamChat(args) {
  if (!args.profile && !args.use && !args.spill && !args.spilled && routed.size) {
    const x = routed.get(bare(args.url))?.();
    if (x?.use || x?.spill || x?.profile) args = { ...args, ...x };
  }
  // A profile on another server than the conversation's: the call goes to its address.
  if (args.use?.url && args.use.url !== args.url) args = { ...args, url: args.use.url };
  const sp = args.spill ?? args.use?.spill;
  if (sp?.to && !args.spilled) { yield* spilling(args, sp); return; }
  const profile = args.profile ?? args.use?.profile;
  if (profile) { yield* metered(args, profile); return; }
  yield* streamOne(args);
}

// A profile's request, on its meter (profile-meters.mjs): the wait to its first word, its speed, its cost.
async function* metered(args, profile) {
  const t0 = Date.now();
  let first = null;
  for await (const ev of streamOne(args)) {
    if (first === null && ev.type !== 'busy') first = Date.now();
    if (ev.type === 'done') {
      const writing = first ? (Date.now() - first) / 1000 : 0;
      const n = ev.timings?.predicted_n ?? ev.usage?.completion_tokens ?? 0;
      noteServed(profile, { waitS: first ? (first - t0) / 1000 : null, tps: ev.timings?.predicted_per_second ?? (n > 20 && writing > 0.2 ? n / writing : null), usd: ev.usd ?? null });
    }
    yield ev;
  }
}

// A profile with a backup (profiles.mjs spillAfter): when its server says it is busy, or sends nothing
// for sp.after seconds, this request goes to the backup instead (sp.to(why) gives its { url, use,
// model, name }), with a 'spill' event first. Once the first word has come, the request stays.
async function* spilling(args, sp) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  args.signal?.addEventListener('abort', onAbort, { once: true });
  if (args.signal?.aborted) ctl.abort();
  const it = streamChat({ ...args, spill: null, use: args.use?.spill ? { ...args.use, spill: undefined } : args.use, profile: args.profile ?? args.use?.profile, signal: ctl.signal })[Symbol.asyncIterator]();
  let timer = null;
  const late = sp.after > 0 ? new Promise((ok) => { timer = setTimeout(() => ok({ late: true }), sp.after * 1000); timer.unref?.(); }) : null;
  const next = it.next();
  next.catch(() => {});
  let first;
  try { first = await (late ? Promise.race([next, late]) : next); } catch (e) {
    if (args.signal?.aborted || !isBusy(e)) { clearTimeout(timer); args.signal?.removeEventListener('abort', onAbort); throw e; }
    first = { busy: e };
  }
  clearTimeout(timer);
  const why = first.late ? `no first word in ${sp.after} s` : first.busy || first.value?.type === 'busy' ? 'its server said it is busy' : null;
  if (!why) {
    try {
      if (!first.done) yield first.value;
      for (let r = await it.next(); !r.done; r = await it.next()) yield r.value;
    } finally { args.signal?.removeEventListener('abort', onAbort); }
    return;
  }
  ctl.abort();
  it.return?.().catch?.(() => {});
  args.signal?.removeEventListener('abort', onAbort);
  const to = await sp.to(why);
  // No backup to go to (it is the same, or it cannot be reached): this request waits as before.
  if (!to) { yield* streamChat({ ...args, spill: null, use: args.use ? { ...args.use, spill: undefined } : args.use }); return; }
  noteSpill(sp.name);
  yield { type: 'spill', from: sp.name, to: to.name, why };
  yield* streamChat({ ...args, url: to.url, use: to.use, model: to.model ?? args.model, profile: to.name, spill: null, spilled: true });
}

async function* streamOne(args) {
  const ep = endpointFor(args.url, args.use);
  const once = () => {
    const tags = args.model?.thinkTags;
    if (!tags?.length || ep?.kind === 'claude') return streamRaw(args);
    return splitThink(streamRaw(args), tags, { thinking: Boolean(args.thinking) });
  };
  if (!ep?.remote) { yield* once(); return; }
  // Each answer's cost goes on the meter (spend.mjs), whoever asked: the conversation, a flow, a side job.
  for await (const ev of withBusyRetry(once, { key: ep.label ?? args.url, signal: args.signal })) {
    if (ev.type === 'done' && ev.usage) { const usd = recordSpend(ep, ev.usage); yield usd == null ? ev : { ...ev, usd }; continue; }
    yield ev;
  }
}

async function* streamRaw({ url, messages, tools, toolChoice = 'auto', thinking, effort, model, sampling, maxTokens, thinkCap, slot, signal, extra, parallel = false, use, conversation }) {
  const ep = endpointFor(url, use);
  // The Claude API speaks its own Messages API (claude.mjs).
  if (ep?.kind === 'claude') { yield* streamClaude({ url, ep, messages, tools, toolChoice, thinking, effort, maxTokens, signal, extra, parallel }); return; }
  if (ep?.ollama) { yield* streamOllama({ url, ep, messages: ownStartOn(ep) ? ownStart(messages, conversation) : messages, tools, toolChoice, thinking, effort, model, sampling, maxTokens, signal, extra }); return; }
  let body = {
    model: 'coding',
    // Pictures beside the text go in as the server takes them (images.mjs).
    messages: openAIMessages(messages),
    stream: true,
    max_tokens: maxTokens,
    ...sampling,
    chat_template_kwargs: thinkingKwargs(model, Boolean(thinking), effort),
    stream_options: { include_usage: true },
    cache_prompt: true,
  };
  // Which of the server's slots keeps this conversation (see server.mjs).
  if (slot !== undefined) body.id_slot = slot;
  // A smaller thinking cap for this call than the server's --reasoning-budget
  // (llama-server ends the thinking there, as it does at the server's cap).
  if (thinking && thinkCap) body.thinking_budget_tokens = thinkCap;
  if (tools?.length) { body.tools = tools; body.tool_choice = toolChoice; body.parallel_tool_calls = Boolean(parallel); }
  if (extra) Object.assign(body, extra);
  // The effort the model's level carries; a level without one (a model that cannot think) sends none.
  if (ep?.kind === 'openai') body = openaiBody(body, { model: ep.model, effort: body.chat_template_kwargs?.reasoning_effort ?? (thinking && !model?.thinkingLevels?.length ? effort : null), thinking, url });
  // A service whose model list carries prices (OpenRouter) says what each answer cost when asked
  // (its usage accounting): the cost meter's own figure (spend.mjs).
  if (ep?.kind === 'openai' && ep.price) body.usage = { include: true };
  let res;
  for (let tries = 0; ; tries++) {
    res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST', signal, timeout: false, headers: { 'content-type': 'application/json', ...authHeaders(url) }, body: JSON.stringify(body),
    });
    if (res.ok) break;
    const text = await res.text().catch(() => '');
    const field = ep?.kind === 'openai' && tries < 4 ? refusedField(res.status, text, body) : null;
    if (field) {
      const k = refusedKey(url, ep.model);
      refused.set(k, new Set([...(refused.get(k) ?? []), field]));
      body = openaiBody(body, { model: ep.model, url });
      continue;
    }
    if (ep && isOutOfMemory(text)) throw roomError(ep, res.status);
    if (ep && (res.status === 401 || res.status === 403)) throw serverError(`the remote model (${ep.label ?? url}) did not accept the API key (${res.status}); change it in /remote`, res.status);
    throw serverError(`${ep ? `remote model server (${ep.label ?? url})` : 'model server'} ${res.status}: ${text.slice(0, 300)}`, res.status, res);
  }
  const decoder = new TextDecoder();
  let buf = '';
  let finish = null;
  let usage = null;
  let timings = null;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw serverError(`model server: ${j.error.message ?? JSON.stringify(j.error)}`, res.status);
      if (j.usage) usage = j.usage;
      if (j.timings) timings = j.timings;
      const ch = j.choices?.[0];
      if (!ch) continue;
      const d = ch.delta ?? {};
      // llama.cpp and vLLM call the thinking reasoning_content; OpenRouter and Ollama, reasoning.
      const thought = d.reasoning_content || (typeof d.reasoning === 'string' ? d.reasoning : '');
      if (thought) yield { type: 'reasoning', text: thought };
      if (d.content) yield { type: 'text', text: d.content };
      for (const tc of d.tool_calls ?? []) {
        yield { type: 'tool', index: tc.index ?? 0, id: tc.id, name: tc.function?.name, args: tc.function?.arguments ?? '' };
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  yield { type: 'done', finish, usage, timings };
}

// A conversation's own first line on an Ollama service (conversation: the agent's id for it, new with
// /clear). Qwen3.6 35B there (qwen35moe: three layers in four are recurrent) answered from another
// conversation that had the same instructions: mid-task, its thinking turned to "fix report.py", another
// practice task's request (3 Oct 2026, in 5 of 9 hard tasks). With a first line of their own, two
// conversations share no start the service could take one's saved state for. Such a model reads the
// instructions again for each conversation anyway, so this costs nothing there.
// AGENTIC_OWN_START: on (the default: every model of an Ollama service, as since 3 Oct 2026) · off ·
// auto (only the model kinds where the mixing was seen, OWN_START_KINDS). The line costs a model that
// can reuse a conversation's saved start that reuse, and "costs nothing" was measured on one kind
// only: the switch is there so the cost can be measured on the others (the fix plan's M2).
export const OWN_START_KINDS = ['qwen35moe'];
export function ownStartOn(ep, env = process.env) {
  const v = String(env.AGENTIC_OWN_START ?? 'on').toLowerCase();
  if (['off', '0', 'false'].includes(v)) return false;
  if (v !== 'auto') return true;
  return OWN_START_KINDS.includes(String(ep?.family ?? '').toLowerCase());
}
export function ownStart(messages, conversation) {
  if (!conversation || messages?.[0]?.role !== 'system' || typeof messages[0].content !== 'string') return messages;
  return [{ ...messages[0], content: `Conversation ${conversation}.\n${messages[0].content}` }, ...messages.slice(1)];
}

// An Ollama service (ep.ollama, set by connectRemote): its own /api/chat, the only
// one that takes a context size. num_ctx goes with every request (the model would
// otherwise be loaded again at the service's own), the thinking as `think` (true or
// false; gpt-oss its level, as it cannot turn it off), the tools only for a model
// that can use them. Its stream is one JSON object a line, and a tool call comes
// whole, so it becomes one tool event with all of its arguments.
const SAMPLING = ['temperature', 'top_p', 'top_k', 'min_p', 'repeat_penalty', 'presence_penalty', 'frequency_penalty', 'seed'];
async function* streamOllama({ url, ep, messages, tools, toolChoice, thinking, effort, model, sampling, maxTokens, signal, extra }) {
  const lv = thinkingLevel(model ?? {}, Boolean(thinking), effort);
  const gptoss = /gpt-?oss/i.test(`${ep.family ?? ''} ${ep.model}`);
  // A helper may say for itself whether it thinks (use.think: the second opinion does).
  const think = ep.think !== undefined ? ep.think : gptoss ? (lv.effort ?? 'low') : lv.effort ? true : ep.thinks ? false : undefined;
  const options = {};
  for (const k of SAMPLING) if (sampling?.[k] !== undefined) options[k] = sampling[k];
  if (maxTokens) options.num_predict = maxTokens;
  if (ep.numCtx) options.num_ctx = ep.numCtx;
  if (extra?.stop) options.stop = extra.stop;
  const body = {
    model: ep.model, messages: ollamaMessages(messages), stream: true, options,
    // How long the service keeps it loaded after this request (connectRemote: the main model for
    // as long as the window is open; a helper half an hour). Ollama's own is 5 minutes.
    ...(ep.keepAlive !== undefined ? { keep_alive: ep.keepAlive } : {}),
    ...(think !== undefined ? { think } : {}),
    ...(tools?.length && toolChoice !== 'none' && ep.tools !== false ? { tools } : {}),
    ...(extra?.response_format?.json_schema?.schema ? { format: extra.response_format.json_schema.schema } : {}),
  };
  // What this model refused before (an Ollama too old to list its abilities says so at the first ask).
  const k = refusedKey(url, ep.model);
  const drop = () => { for (const f of refused.get(k) ?? []) { if (f === 'tools') delete body.tools; if (f === 'reasoning_effort') delete body.think; } };
  drop();
  let res;
  for (let tries = 0; ; tries++) {
    res = await fetch(`${url}/api/chat`, { method: 'POST', signal, timeout: false, headers: { 'content-type': 'application/json', ...authHeaders(url) }, body: JSON.stringify(body) });
    if (res.ok) break;
    const text = await res.text().catch(() => '');
    const field = tries < 2 ? refusedField(res.status, text, { reasoning_effort: body.think, tools: body.tools }) : null;
    if (field) { refused.set(k, new Set([...(refused.get(k) ?? []), field])); drop(); continue; }
    if (isOutOfMemory(text)) throw roomError(ep, res.status);
    if (res.status === 401 || res.status === 403) throw serverError(`the remote model (${ep.label ?? url}) did not accept the API key (${res.status}); change it in /remote`, res.status);
    throw serverError(`remote model server (${ep.label ?? url}) ${res.status}: ${text.slice(0, 300)}`, res.status, res);
  }
  const decoder = new TextDecoder();
  let buf = '';
  let finish = null, usage = null, timings = null, calls = 0;
  const per = (n, ns) => (n && ns ? n / (ns / 1e9) : undefined);
  const ms = (ns) => (Number.isFinite(ns) ? ns / 1e6 : undefined);
  // One line of the stream as events (the last one also says how it ended and what it cost).
  const read = (line) => {
    if (!line.trim()) return [];
    let j;
    try { j = JSON.parse(line); } catch { return []; }
    if (j.error) { const why = typeof j.error === 'string' ? j.error : j.error.message ?? JSON.stringify(j.error); throw isOutOfMemory(why) ? roomError(ep, res.status) : serverError(`model server: ${why}`, res.status); }
    const evs = [];
    const m = j.message ?? {};
    if (m.thinking) evs.push({ type: 'reasoning', text: m.thinking });
    if (m.content) evs.push({ type: 'text', text: m.content });
    for (const tc of m.tool_calls ?? []) {
      const a = tc.function?.arguments;
      evs.push({ type: 'tool', index: calls, id: tc.id ?? `call_${Date.now().toString(36)}_${calls}`, name: tc.function?.name, args: typeof a === 'string' ? a : JSON.stringify(a ?? {}) });
      calls++;
    }
    if (j.done) {
      finish = j.done_reason === 'length' ? 'length' : calls ? 'tool_calls' : 'stop';
      usage = { prompt_tokens: j.prompt_eval_count ?? 0, completion_tokens: j.eval_count ?? 0 };
      // With what it spent, as llama.cpp names it (agent/timing.mjs): reading the conversation, writing, loading the model.
      timings = { prompt_n: j.prompt_eval_count, prompt_per_second: per(j.prompt_eval_count, j.prompt_eval_duration), predicted_n: j.eval_count, predicted_per_second: per(j.eval_count, j.eval_duration), prompt_ms: ms(j.prompt_eval_duration), predicted_ms: ms(j.eval_duration), load_ms: ms(j.load_duration) };
    }
    return evs;
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      yield* read(line);
    }
  }
  yield* read(buf);
  yield { type: 'done', finish, usage, timings };
}

// One call of a step asked for again on an Ollama service's Qwen 3.5 family, in Ollama's raw mode, so its
// parser does not stand between the model and us (qwen-raw.mjs): the prompt is the step's own (rendered as
// Ollama does), then the step's thinking and words and the opening of a call to `name`. Answers { text,
// tokens }: the call's parameters as the model wrote them, up to </function>; null where it does not apply
// (another model or service, a picture in the conversation: raw mode would need its placeholders).
export async function rawQwenCall({ url, conversation, messages, tools, thinking, effort, model, sampling, maxTokens, reasoning, before, name, signal, onStart }) {
  const ep = endpointOf(url);
  if (!qwenRawFits(ep)) return null;
  const sent = ollamaMessages(ownStartOn(ep) ? ownStart(messages, conversation) : messages);
  if (sent.some((m) => m.images?.length)) return null;
  // Whether the step thought, as streamOllama decided it (Ollama's renderer takes no value as yes).
  const lv = thinkingLevel(model ?? {}, Boolean(thinking), effort);
  const think = ep.think !== undefined ? ep.think : lv.effort ? true : ep.thinks ? false : undefined;
  const thinks = think === undefined ? true : Boolean(think);
  const prompt = renderQwen35(sent, tools ?? [], { thinking: thinks }) + callOpening({ thinking: thinks && Boolean(String(reasoning ?? '').trim()), reasoning, before, name });
  const options = { stop: ['</function>', '<|im_end|>'] };
  for (const k of SAMPLING) if (sampling?.[k] !== undefined) options[k] = sampling[k];
  if (maxTokens) options.num_predict = maxTokens;
  if (ep.numCtx) options.num_ctx = ep.numCtx;
  onStart?.();
  const res = await fetch(`${url}/api/generate`, { method: 'POST', signal, timeout: false, headers: { 'content-type': 'application/json', ...authHeaders(url) }, body: JSON.stringify({ model: ep.model, prompt, raw: true, stream: false, options, ...(ep.keepAlive !== undefined ? { keep_alive: ep.keepAlive } : {}) }) });
  if (!res.ok) throw serverError(`remote model server (${ep.label ?? url}) ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, res.status, res);
  const j = await res.json();
  return { text: String(j.response ?? ''), tokens: j.eval_count ?? 0, finish: j.done_reason ?? null };
}
