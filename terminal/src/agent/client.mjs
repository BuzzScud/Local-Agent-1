// Streams one chat completion from llama-server (OpenAI format) and turns the
// SSE chunks into simple events: reasoning, text, tool-call pieces, done.
import { thinkingKwargs } from '../../../models/index.mjs';

// toolChoice 'none' keeps the tool list in the prompt (so the saved reading of
// the instructions still matches) but lets the model only write text.
export async function* streamChat({ url, messages, tools, toolChoice = 'auto', thinking, effort, model, sampling, maxTokens, slot, signal, extra }) {
  const body = {
    model: 'coding',
    messages,
    stream: true,
    max_tokens: maxTokens,
    ...sampling,
    chat_template_kwargs: thinkingKwargs(model, Boolean(thinking), effort),
    stream_options: { include_usage: true },
    cache_prompt: true,
  };
  // Which of the server's slots keeps this conversation (see server.mjs).
  if (slot !== undefined) body.id_slot = slot;
  if (tools?.length) { body.tools = tools; body.tool_choice = toolChoice; body.parallel_tool_calls = false; }
  if (extra) Object.assign(body, extra);
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`model server ${res.status}: ${text.slice(0, 300)}`);
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
      if (d.reasoning_content) yield { type: 'reasoning', text: d.reasoning_content };
      if (d.content) yield { type: 'text', text: d.content };
      for (const tc of d.tool_calls ?? []) {
        yield { type: 'tool', index: tc.index ?? 0, id: tc.id, name: tc.function?.name, args: tc.function?.arguments ?? '' };
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  yield { type: 'done', finish, usage, timings };
}

// Collects a whole streamed turn (used by tests and the non-interactive mode).
export async function collectTurn(stream, onEvent = () => {}) {
  const turn = { reasoning: '', text: '', calls: [], finish: null, usage: null, timings: null };
  for await (const ev of stream) {
    onEvent(ev);
    if (ev.type === 'reasoning') turn.reasoning += ev.text;
    else if (ev.type === 'text') turn.text += ev.text;
    else if (ev.type === 'tool') {
      const c = (turn.calls[ev.index] ??= { id: ev.id, name: '', args: '' });
      if (ev.id) c.id = ev.id;
      if (ev.name) c.name += ev.name;
      c.args += ev.args;
    } else if (ev.type === 'done') Object.assign(turn, { finish: ev.finish, usage: ev.usage, timings: ev.timings });
  }
  turn.calls = turn.calls.filter(Boolean);
  return turn;
}
