// Real-use test of Bonsai 2 27B through llama-server with Bonsai Code's own settings.
// Usage: node realuse.mjs <port> <server pid>
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [port, pid] = process.argv.slice(2);
const url = `http://127.0.0.1:${port}`;
const out = {};
const footprint = () => {
  try {
    const t = execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8' });
    const m = /phys_footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(t) || /Footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(t);
    const peak = /phys_footprint_peak:\s*([\d.]+)\s*(KB|MB|GB)/.exec(t);
    const gb = (x) => x ? Number(x[1]) * { KB: 1e-6, MB: 1e-3, GB: 1 }[x[2]] : null;
    return { now: gb(m), peak: gb(peak), raw: t.split('\n').slice(0, 6).join(' | ') };
  } catch (e) { return { err: String(e.message).slice(0, 200) }; }
};
async function chat(body) {
  const t0 = Date.now();
  const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cache_prompt: false, ...body }) });
  const j = await r.json();
  return { ms: Date.now() - t0, status: r.status, j };
}
const file = readFileSync('/Users/you/Desktop/bonsai-code/src/server/server.mjs', 'utf8');
const tok = await (await fetch(`${url}/tokenize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: file }) })).json();
out.fileTokens = tok.tokens.length;
out.memAfterLoad = footprint();

// 1. One focused job: read the file (~2k tokens), write a new function. Thinking off.
const job = await chat({
  messages: [
    { role: 'system', content: 'You are a careful JavaScript programmer. Reply with code only, in one ```js block.' },
    { role: 'user', content: 'Here is src/server/server.mjs:\n```js\n' + file + '\n```\nAdd an exported function stopAll() that reads every entry in the server registry, stops each server whose process is alive, and deletes its registry file. Reply with only the new function.' },
  ],
  max_tokens: 400, temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0,
  chat_template_kwargs: { enable_thinking: false },
});
out.job = { ms: job.ms, timings: job.j.timings, finish: job.j.choices?.[0]?.finish_reason, text: job.j.choices?.[0]?.message?.content, reasoning: job.j.choices?.[0]?.message?.reasoning_content?.slice(0, 200) };
out.memAfterJob = footprint();

// 2. Tool-call check: does the server turn its tool-call format into a proper call?
const tools = [{ type: 'function', function: { name: 'Read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } }];
const tc = await chat({
  messages: [{ role: 'user', content: 'What does export.mjs print? Use the Read tool to look at it first.' }],
  tools, max_tokens: 200, temperature: 0.7, top_p: 0.8, top_k: 20, chat_template_kwargs: { enable_thinking: false },
});
out.toolCall = { ms: tc.ms, status: tc.status, calls: tc.j.choices?.[0]?.message?.tool_calls, text: tc.j.choices?.[0]?.message?.content, err: tc.j.error };

// 3. Forced JSON reply (the request sorter uses this).
const js = await chat({
  messages: [{ role: 'user', content: 'Sort this request into one kind: "rename getUser to fetchUser everywhere".' }],
  max_tokens: 60, temperature: 0, chat_template_kwargs: { enable_thinking: false },
  response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object', properties: { kind: { enum: ['question', 'rename', 'fix', 'change', 'other'] } }, required: ['kind'] } } },
});
out.json = { ms: js.ms, status: js.status, text: js.j.choices?.[0]?.message?.content, err: js.j.error };

// 4. Thinking at "medium" on a small task: how long does it think?
const th = await chat({
  messages: [{ role: 'user', content: 'Write a JavaScript function median(nums) that returns the median of an array of numbers (average the two middle values for even lengths). Code only.' }],
  max_tokens: 3000, temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.05,
  chat_template_kwargs: { enable_thinking: true, reasoning_effort: 'medium' },
});
const tm = th.j.choices?.[0]?.message;
out.thinking = { ms: th.ms, timings: th.j.timings, finish: th.j.choices?.[0]?.finish_reason, reasoningChars: tm?.reasoning_content?.length ?? 0, text: tm?.content?.slice(0, 600), err: th.j.error };
out.memEnd = footprint();
writeFileSync('realuse.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  fileTokens: out.fileTokens,
  memAfterLoad: out.memAfterLoad, memEnd: out.memEnd,
  job: { secs: out.job.ms / 1000, read_tps: out.job.timings?.prompt_per_second, write_tps: out.job.timings?.predicted_per_second, prompt_n: out.job.timings?.prompt_n, predicted_n: out.job.timings?.predicted_n, finish: out.job.finish },
  toolCall: { secs: out.toolCall.ms / 1000, calls: out.toolCall.calls, text: out.toolCall.text?.slice(0, 200), err: out.toolCall.err },
  json: out.json,
  thinking: { secs: out.thinking.ms / 1000, write_tps: out.thinking.timings?.predicted_per_second, predicted_n: out.thinking.timings?.predicted_n, reasoningChars: out.thinking.reasoningChars, finish: out.thinking.finish, err: out.thinking.err },
}, null, 2));
