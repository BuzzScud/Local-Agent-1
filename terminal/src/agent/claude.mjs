// The chat when the remote is the Claude API (/remote, Server: Claude API):
// the agent's conversation (OpenAI format: role system / user / assistant with
// tool_calls / tool) becomes one Messages API request, and Claude's stream
// comes back as the same events as every other kind (client.mjs).
//   - Its thinking blocks are kept, by the reply they came with, and sent back
//     unchanged with it, as the API asks. The app trims old tool output, so on
//     a model that binds thinking to the conversation a block that no longer
//     matches is dropped rather than refused (block_binding: drop_block).
//   - Effort Low asks for effort low (a model that always thinks thinks
//     little); High thinks first and shows its summarized thinking.
//   - Nothing about sampling is sent (current models refuse it); a JSON answer
//     is held to its schema where the model can; the conversation is cached.
//   - A model that declines a request is retried on Anthropic's fallback
//     model where that is offered (fallbacks: 'default').
import { claudeSdk, claudeClient, claudeCaps } from '../../../models/index.mjs';

// Thinking blocks by the reply they came with: its first tool call's id, or its text.
const THOUGHTS = new Map();
const MAX_THOUGHTS = 400;
const replyKey = (toolIds, text) => (toolIds[0] ? `tool:${toolIds[0]}` : `text:${String(text ?? '').trim()}`);
function remember(key, blocks) {
  if (!blocks.length) return;
  THOUGHTS.delete(key);
  THOUGHTS.set(key, blocks);
  if (THOUGHTS.size > MAX_THOUGHTS) THOUGHTS.delete(THOUGHTS.keys().next().value);
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('') : '');
const argsOf = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }; } catch { return { raw: String(s ?? '') }; } };

// A JSON schema as structured outputs take it: every object closed
// (additionalProperties: false) and no size or number limits (not supported).
const NOT_SUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties'];
export function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) if (!NOT_SUPPORTED.includes(k)) out[k] = strictSchema(v);
  if (out.type === 'object' || out.properties) { out.additionalProperties = false; out.properties ??= {}; }
  return out;
}

// Every tool_use answered by a tool_result in the next user turn (one the
// agent never ran gets "(not run)"), and no tool_result without its tool_use:
// the API refuses either.
function pairTools(msgs) {
  const out = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const prev = out.at(-1);
    if (m.role === 'user') {
      const asked = new Set(prev?.role === 'assistant' ? prev.content.filter((b) => b.type === 'tool_use').map((b) => b.id) : []);
      const content = m.content.filter((b) => b.type !== 'tool_result' || asked.has(b.tool_use_id));
      const answered = new Set(content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id));
      const missing = [...asked].filter((id) => !answered.has(id)).map((id) => ({ type: 'tool_result', tool_use_id: id, content: '(not run)', is_error: true }));
      // tool_result blocks first, then the rest of the user's turn
      const results = [...missing, ...content.filter((b) => b.type === 'tool_result')];
      const rest = content.filter((b) => b.type !== 'tool_result');
      if (results.length || rest.length) out.push({ role: 'user', content: [...results, ...rest] });
      continue;
    }
    // an assistant turn that asked for tools and was not answered before the next assistant turn
    if (prev?.role === 'assistant') {
      const ids = prev.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
      if (ids.length) out.push({ role: 'user', content: ids.map((id) => ({ type: 'tool_result', tool_use_id: id, content: '(not run)', is_error: true })) });
    }
    out.push(m);
  }
  const last = out.at(-1);
  if (last?.role === 'assistant') {
    const ids = last.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    // Current models take no prefill: the request always ends with the user's turn.
    out.push({ role: 'user', content: ids.length ? ids.map((id) => ({ type: 'tool_result', tool_use_id: id, content: '(not run)', is_error: true })) : [{ type: 'text', text: 'Continue.' }] });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(The conversation so far:)' }] });
  return out;
}

// The request (exported for the tests). drop: fields a model refused before, left out.
export function claudeParams({ model, messages, tools, toolChoice = 'auto', thinking, effort, maxTokens, extra = {}, drop = new Set(), parallel = false }) {
  const caps = claudeCaps(model);
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).filter(Boolean).join('\n\n');
  const turns = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = turns.at(-1);
    // Two assistant turns in a row become one; thinking may only lead a turn, so the second's is left out.
    if (last?.role === role) last.content.push(...(role === 'assistant' ? blocks.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') : blocks));
    else turns.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') { const t = textOf(m.content); if (t.trim()) push('user', [{ type: 'text', text: t }]); }
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: textOf(m.content) || '(no output)' }]);
    else if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).filter((c) => c?.id && c.function?.name);
      const text = textOf(m.content);
      const blocks = [...(THOUGHTS.get(replyKey(calls.map((c) => c.id), text)) ?? [])];
      if (text.trim()) blocks.push({ type: 'text', text });
      for (const c of calls) blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input: argsOf(c.function.arguments) });
      if (blocks.some((b) => b.type === 'text' || b.type === 'tool_use')) push('assistant', blocks);
    }
  }
  const think = Boolean(thinking);
  const params = {
    model,
    // Room for the thinking on top of the answer asked for.
    max_tokens: Math.min(64_000, Math.max(1024, (maxTokens ?? 4096) + (think ? 16_000 : caps.alwaysThinks || caps.binding ? 4000 : 0) + (caps.budget && think ? 4096 : 0))),
    messages: pairTools(turns),
    ...(system ? { system } : {}),
  };
  if (!drop.has('cache')) params.cache_control = { type: 'ephemeral' };
  if (tools?.length) {
    params.tools = tools.map((t) => ({ name: t.function.name, description: t.function.description ?? '', input_schema: t.function.parameters ?? { type: 'object', properties: {} }, ...(drop.has('eager') ? {} : { eager_input_streaming: true }) }));
    // Several calls a reply only when the model decides (agent/way.mjs), as with the local models.
    params.tool_choice = toolChoice === 'none' ? { type: 'none' } : { type: 'auto', disable_parallel_tool_use: !parallel };
  }
  if (!drop.has('thinking')) {
    if (caps.adaptive && (think || caps.alwaysThinks || caps.binding)) {
      params.thinking = { type: 'adaptive', display: think ? 'summarized' : 'omitted', ...(caps.binding && !drop.has('binding') ? { block_binding: { prefix_mismatch_behavior: 'drop_block' } } : {}) };
    } else if (caps.budget && think) params.thinking = { type: 'enabled', budget_tokens: 4096 };
  }
  const config = {};
  if (caps.effort && !drop.has('effort')) config.effort = think ? (effort === 'medium' ? 'medium' : 'high') : 'low';
  const schema = extra?.response_format?.json_schema?.schema;
  if (schema && caps.structured && !drop.has('format')) config.format = { type: 'json_schema', schema: strictSchema(schema) };
  if (Object.keys(config).length) params.output_config = config;
  const stops = (extra?.stop ?? []).filter((x) => String(x).trim());
  if (stops.length) params.stop_sequences = stops;
  const betas = [];
  if (params.thinking?.block_binding) betas.push('thinking-binding-controls-2026-08-01');
  if (caps.fallbacks && !drop.has('fallbacks')) { params.fallbacks = 'default'; betas.push('server-side-fallback-2026-07-01'); }
  if (betas.length) params.betas = betas;
  return params;
}

// Which field a 400 names, when it is one a model may not take: it is left
// out from then on for that model (Haiku 4.5 and effort, say).
const REFUSED = new Map(); // model → Set of fields
function refusedField(message, params) {
  const m = String(message ?? '');
  if (params.fallbacks && /fallback/i.test(m)) return 'fallbacks';
  if (params.thinking?.block_binding && /block_binding|prefix_mismatch/i.test(m)) return 'binding';
  if (params.thinking && /thinking|budget_tokens|adaptive/i.test(m)) return 'thinking';
  if (params.output_config?.effort && /effort/i.test(m)) return 'effort';
  if (params.output_config?.format && /format|json_schema|schema/i.test(m)) return 'format';
  if (params.tools?.[0]?.eager_input_streaming && /eager_input_streaming/i.test(m)) return 'eager';
  if (params.cache_control && /cache_control/i.test(m)) return 'cache';
  return null;
}

// The error in plain words, shaped so the agent does what it does for any
// server: a connection lost is retried (reconnect), a full context is summarized.
function friendly(e, Anthropic) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new Error(`the remote model (Claude API) did not accept the API key (${e.status}); change it in /remote`);
  if (e instanceof Anthropic.RateLimitError) return new Error('the Claude API is rate limiting this key (429): wait a moment, then ask again');
  if (e instanceof Anthropic.APIConnectionError) return new Error(`fetch failed: the Claude API could not be reached (${e.message})`);
  if (e instanceof Anthropic.BadRequestError && /too long|too many tokens|context/i.test(e.message)) return new Error(`the conversation exceeds the model's context window (${e.message.slice(0, 200)})`);
  if (e instanceof Anthropic.APIError) return new Error(`Claude API ${e.status ?? ''}: ${String(e.message).slice(0, 300)}`);
  return e;
}

const FINISH = { end_turn: 'stop', stop_sequence: 'stop', tool_use: 'tool_calls', max_tokens: 'length', pause_turn: 'stop', refusal: 'stop' };

// One reply, streamed as the events client.mjs yields for every kind.
export async function* streamClaude({ url, ep, messages, tools, toolChoice, thinking, effort, maxTokens, signal, extra, parallel = false }) {
  const Anthropic = await claudeSdk();
  const client = await claudeClient(url, ep.key);
  const refused = REFUSED.get(ep.model) ?? new Set();
  for (let tries = 0; ; tries++) {
    const params = claudeParams({ model: ep.model, messages, tools, toolChoice, thinking, effort, maxTokens, extra, drop: refused, parallel });
    let started = false;
    try {
      const stream = client.beta.messages.stream(params, { signal });
      const tool = new Map(); // content block index → tool index
      let wrote = false;
      let usageIn = null, usageOut = 0, finish = null;
      for await (const ev of stream) {
        started = true;
        if (ev.type === 'message_start') usageIn = ev.message?.usage ?? null;
        else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          tool.set(ev.index, tool.size);
          yield { type: 'tool', index: tool.get(ev.index), id: ev.content_block.id, name: ev.content_block.name, args: '' };
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta;
          if (d.type === 'text_delta' && d.text) { wrote = true; yield { type: 'text', text: d.text }; }
          else if (d.type === 'thinking_delta' && d.thinking) yield { type: 'reasoning', text: d.thinking };
          else if (d.type === 'input_json_delta' && d.partial_json && tool.has(ev.index)) yield { type: 'tool', index: tool.get(ev.index), args: d.partial_json };
        } else if (ev.type === 'message_delta') {
          finish = ev.delta?.stop_reason ?? finish;
          usageOut = ev.usage?.output_tokens ?? usageOut;
        }
      }
      const final = await stream.finalMessage();
      // Its thinking goes back with this reply next time, unchanged.
      const thoughts = final.content.filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking');
      const ids = final.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
      const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      remember(replyKey(ids, text), thoughts);
      if (final.stop_reason === 'refusal' && !wrote) yield { type: 'text', text: `(Claude declined this request${final.stop_details?.category ? `: ${final.stop_details.category}` : ''}. Say it another way, or pick another model in /remote.)` };
      const u = final.usage ?? {};
      const inTok = (u.input_tokens ?? usageIn?.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      yield { type: 'done', finish: FINISH[final.stop_reason ?? finish] ?? 'stop', usage: { prompt_tokens: inTok, completion_tokens: u.output_tokens ?? usageOut }, timings: null };
      return;
    } catch (e) {
      if (signal?.aborted) throw e;
      const field = !started && tries < 4 && e instanceof Anthropic.BadRequestError ? refusedField(e.message, params) : null;
      if (field) { refused.add(field); REFUSED.set(ep.model, refused); continue; }
      throw friendly(e, Anthropic);
    }
  }
}
