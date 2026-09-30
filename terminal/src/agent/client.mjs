// Streams one chat completion from llama-server (OpenAI format) and turns the
// SSE chunks into simple events: reasoning, text, tool-call pieces, done.
// A remote (/remote) is asked the same way, with its API key; an
// OpenAI-compatible one (not llama.cpp) gets only the standard fields, and
// the Claude API goes through Anthropic's own Messages API (claude.mjs).
import { thinkingKwargs, endpointOf, authHeaders } from '../../../models/index.mjs';
import { streamClaude } from './claude.mjs';
import { openAIMessages } from './images.mjs';

// What only llama.cpp's server reads: the slot, its prompt cache, the
// thinking switch and cap, its extra sampling. Not sent to another kind.
const LLAMA_ONLY = ['cache_prompt', 'id_slot', 'chat_template_kwargs', 'thinking_budget_tokens', 'top_k', 'min_p', 'repeat_penalty', 'typical_p', 'n_probs'];
// Standard fields a server may still refuse (an older one, or a model that
// cannot think): named in its error, they are left out of the next call to it.
const OPTIONAL = ['reasoning_effort', 'parallel_tool_calls', 'stream_options', 'presence_penalty', 'frequency_penalty', 'top_p', 'temperature', 'seed'];
const refused = new Map(); // url → the fields that server refused

// The body as an OpenAI-compatible server takes it (exported for the tests).
export function openaiBody(body, { model, effort, thinking, url } = {}) {
  const out = { ...body, model };
  for (const k of LLAMA_ONLY) delete out[k];
  if (thinking && effort) out.reasoning_effort = effort;
  for (const k of refused.get(url) ?? []) {
    if (k === 'max_tokens' && out.max_tokens !== undefined) { out.max_completion_tokens = out.max_tokens; delete out.max_tokens; } else delete out[k];
  }
  return out;
}

// The field a 400 names as not taken, when it is one we can leave out.
export function refusedField(status, text, body) {
  if (status !== 400 && status !== 422) return null;
  if (/max_tokens/.test(text) && /max_completion_tokens/.test(text) && body.max_tokens !== undefined) return 'max_tokens';
  return OPTIONAL.find((k) => body[k] !== undefined && new RegExp(`\\b${k}\\b`).test(text)) ?? null;
}

// toolChoice 'none' keeps the tool list in the prompt (so the saved reading of
// the instructions still matches) but lets the model only write text.
// parallel: the model may send several calls in one reply (when the model decides, agent/way.mjs).
export async function* streamChat({ url, messages, tools, toolChoice = 'auto', thinking, effort, model, sampling, maxTokens, thinkCap, slot, signal, extra, parallel = false }) {
  const ep = endpointOf(url);
  // The Claude API speaks its own Messages API (claude.mjs).
  if (ep?.kind === 'claude') { yield* streamClaude({ url, ep, messages, tools, toolChoice, thinking, effort, maxTokens, signal, extra, parallel }); return; }
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
  if (ep?.kind === 'openai') body = openaiBody(body, { model: ep.model, effort: body.chat_template_kwargs?.reasoning_effort ?? (thinking ? effort : null), thinking, url });
  let res;
  for (let tries = 0; ; tries++) {
    res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json', ...authHeaders(url) }, body: JSON.stringify(body),
    });
    if (res.ok) break;
    const text = await res.text().catch(() => '');
    const field = ep?.kind === 'openai' && tries < 4 ? refusedField(res.status, text, body) : null;
    if (field) {
      refused.set(url, new Set([...(refused.get(url) ?? []), field]));
      body = openaiBody(body, { model: ep.model, url });
      continue;
    }
    if (ep && (res.status === 401 || res.status === 403)) throw new Error(`the remote model (${ep.label ?? url}) did not accept the API key (${res.status}); change it in /remote`);
    throw new Error(`${ep ? `remote model server (${ep.label ?? url})` : 'model server'} ${res.status}: ${text.slice(0, 300)}`);
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
      if (j.error) throw new Error(`model server: ${j.error.message ?? JSON.stringify(j.error)}`);
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
