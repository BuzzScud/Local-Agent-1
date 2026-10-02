// A pretend Ollama service for the /subagents tests: its own API (/api/version, /api/tags,
// /api/ps, /api/show, /api/generate, /api/chat, /api/embed, /v1/models), with models that
// behave differently when given tools:
//   coder:30b      the main model: calls Read, Edit and Bash as asked (real tool calls)
//   jsontext:14b   writes its calls as bare JSON in the text (as Qwen 2.5 Coder can)
//   words:7b       lists "tools" but answers in words
//   tiny:3b        the small helper (summaries, /btw)
//   thinker:35b    thinks and sees: the second opinion and the page check
//   llava:latest   sees, no tools: the pictures helper
//   embed:latest   embeddings
// Every request is kept in `seen` ({ path, body }), so a test can say who was asked what.
import { createServer } from 'node:http';

export const FAKE_MODELS = [
  { name: 'coder:30b', family: 'qwen3moe', params: '30.5B', caps: ['completion', 'tools'], ctx: 262144, size: 18.6e9, at: '2026-07-01', loaded: 131072 },
  { name: 'jsontext:14b', family: 'qwen2', params: '14.8B', caps: ['completion', 'tools'], ctx: 32768, size: 9.0e9, at: '2025-12-24' },
  { name: 'words:7b', family: 'llama', params: '8.0B', caps: ['completion', 'tools'], ctx: 131072, size: 4.9e9, at: '2025-11-03' },
  { name: 'tiny:3b', family: 'llama', params: '3.2B', caps: ['completion', 'tools'], ctx: 131072, size: 2.0e9, at: '2025-11-03' },
  { name: 'thinker:35b', family: 'qwen35moe', params: '36.0B', caps: ['completion', 'tools', 'thinking', 'vision'], ctx: 262144, size: 23.9e9, at: '2026-06-15' },
  { name: 'llava:latest', family: 'llama', params: '7B', caps: ['completion', 'vision'], ctx: 32768, size: 4.7e9, at: '2025-11-02' },
  { name: 'embed:latest', family: 'gemma3', params: '307.58M', caps: ['embedding'], ctx: 2048, size: 0.6e9, at: '2026-06-16' },
];

const lastUser = (msgs) => [...(msgs ?? [])].reverse().find((m) => m.role === 'user');
const call = (name, args) => ({ function: { name, arguments: args } });

// What a model answers a chat: { content, tool_calls }.
export function answerOf(body, { review = 'LGTM', look = 'LGTM', describe = 'A login form. The Save button is cut off on the right.' } = {}) {
  const m = body.model;
  const u = lastUser(body.messages);
  const said = String(u?.content ?? '');
  const sys = String(body.messages?.find((x) => x.role === 'system')?.content ?? '');
  if (/describe pictures/i.test(sys)) return { content: describe };
  if (/review a code change/i.test(sys)) return { content: review };
  if (/check how a web page looks/i.test(sys)) return { content: look };
  if (/summarize a coding session/i.test(sys)) return { content: `Summary by ${m}.` };
  if (body.tools?.length && /Read the file notes\.txt|spelling mistake|echo ok/.test(said)) {
    const want = /Read the file/.test(said) ? ['Read', { path: 'notes.txt' }] : /spelling/.test(said) ? ['Edit', { path: 'notes.txt', old_text: 'Hello wrold', new_text: 'Hello world' }] : ['Bash', { command: 'echo ok' }];
    if (m === 'words:7b') return { content: 'Sure, I can help with that file.' };
    if (m === 'jsontext:14b') return { content: JSON.stringify({ name: want[0], arguments: want[1] }) };
    return { content: '', tool_calls: [call(...want)] };
  }
  // The main model's small task: fix the typo in notes.txt with Edit, then say so; a second opinion's note answered.
  const last = body.messages?.at(-1);
  // (Read first, as the agent asks, then Edit, then say so.)
  if (body.tools?.length && /fix the typo in notes\.txt/i.test(said)) {
    const after = body.messages.slice(body.messages.lastIndexOf(u));
    const did = after.filter((x) => x.role === 'assistant').flatMap((x) => x.tool_calls ?? []).map((c) => c.function?.name);
    if (!did.includes('Read')) return { content: '', tool_calls: [call('Read', { path: 'notes.txt' })] };
    if (!did.includes('Edit')) return { content: '', tool_calls: [call('Edit', { path: 'notes.txt', old_text: 'Hello wrold', new_text: 'Hello world' })] };
    return { content: 'Fixed the typo in notes.txt.' };
  }
  if (/Another model read your change/.test(said)) return { content: 'Checked: the second line is right now.' };
  return { content: `From ${m}.` };
}

export const fakeOllama = (opts = {}) => new Promise((ok) => {
  const loaded = new Map(FAKE_MODELS.filter((m) => m.loaded).map((m) => [m.name, m.loaded]));
  const seen = [];
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const body = b ? JSON.parse(b) : {};
    seen.push({ path: req.url, body });
    const json = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const m = FAKE_MODELS.find((x) => x.name === body.model);
    const details = (x) => ({ family: x.family, parameter_size: x.params, quantization_level: 'Q4_K_M' });
    if (req.url === '/api/version') return json(200, { version: '0.32.12' });
    if (req.url === '/api/tags') return json(200, { models: FAKE_MODELS.map((x) => ({ name: x.name, size: x.size, digest: `d-${x.name}`, modified_at: `${x.at}T12:00:00Z`, details: details(x) })) });
    // opts.gpu: the share of each loaded model in GPU memory (the footer's GPU gauge; under 1 it spills onto the CPU).
    if (req.url === '/api/ps') return json(200, { models: [...loaded].map(([name, ctx]) => { const size = FAKE_MODELS.find((x) => x.name === name).size; return { name, size, size_vram: Math.round(size * (opts.gpu ?? 1)), context_length: ctx }; }) });
    if (req.url === '/api/show') return m ? json(200, { details: details(m), model_info: { [`${m.family}.context_length`]: m.ctx }, capabilities: m.caps }) : json(404, { error: 'not found' });
    if (req.url === '/v1/models') return json(200, { object: 'list', data: FAKE_MODELS.map((x) => ({ id: x.name, object: 'model' })) });
    if (req.url === '/api/generate') {
      if (body.keep_alive === 0) { loaded.delete(body.model); return json(200, { model: body.model, done: true, done_reason: 'unload' }); }
      await new Promise((r) => setTimeout(r, 100));
      loaded.set(body.model, body.options?.num_ctx ?? Math.min(m?.ctx ?? 32768, 65536));
      return json(200, { model: body.model, response: '', done: true, done_reason: 'load' });
    }
    if (req.url === '/api/embed') {
      const input = Array.isArray(body.input) ? body.input : [body.input];
      return json(200, { model: body.model, embeddings: input.map((t) => [String(t).length % 7 + 1, 2, 3]) });
    }
    if (req.url === '/api/chat') {
      if (body.tools && !m?.caps.includes('tools')) return json(400, { error: `registry.ollama.ai/library/${body.model} does not support tools` });
      loaded.set(body.model, body.options?.num_ctx ?? 32768);
      const a = answerOf(body, opts);
      if (!body.stream) return json(200, { model: body.model, message: { role: 'assistant', content: a.content || 'ready' }, done: true });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: a.content, ...(a.tool_calls ? { tool_calls: a.tool_calls } : {}) }, done: false })}\n`);
      res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 900, prompt_eval_duration: 1e9, eval_count: 40, eval_duration: 1e9 })}\n`);
      return res.end();
    }
    json(404, { error: 'not found' });
  });
  srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, port: srv.address().port, seen, loaded, chats: () => seen.filter((x) => x.path === '/api/chat').map((x) => x.body), close: () => new Promise((d) => { srv.closeAllConnections?.(); srv.close(d); }) }));
});
