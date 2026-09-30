// A stand-in for llama-server that replays scripted replies over the same
// streaming API, so the agent and the terminal app can be tested without the
// real model. Each reply: { reasoning?, text?, tool?: { name, args } }.
// route(request) may answer a request out of turn (the memory's save, which
// comes whenever the app finds a pause): its reply is sent and the scripted
// ones stay in line.
// key: it answers only with that API key (as llama-server --api-key does;
// /health stays open); props: it says what it runs (/props, /v1/models), as a
// remote is asked by /remote. seen: every request's path and key header.
import { createServer } from 'node:http';

export const FAKE_PROPS = { default_generation_settings: { n_ctx: 32768 }, total_slots: 2, model_path: '/models/gemma-4-12B-it-qat-UD-Q4_K_XL.gguf' };
export function startFakeServer(replies, { delayMs = 2, chunk = 6, route = null, key = null, props = false } = {}) {
  const queue = [...replies];
  const requests = [];
  const seen = [];
  let down = false;
  const server = createServer(async (req, res) => {
    seen.push({ path: req.url, method: req.method, auth: req.headers.authorization ?? null });
    if (down) { req.socket.destroy(); return; }
    if (req.url === '/health') { res.end('{"status":"ok"}'); return; }
    if (key && req.headers.authorization !== `Bearer ${key}`) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Invalid API Key","type":"authentication_error"}}'); return; }
    if (props && req.method === 'GET' && req.url === '/props') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(FAKE_PROPS)); return; }
    if (props && req.method === 'GET' && req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', context_length: 65536 }] })); return; }
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    requests.push(json);
    if (json.max_tokens === 1 || !json.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '' } }] })); return; }
    const reply = route?.(json) ?? queue.shift() ?? { text: 'Done.' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const pieces = (s) => s.match(new RegExp(`[\\s\\S]{1,${chunk}}`, 'g')) ?? [];
    const wait = () => new Promise((r) => setTimeout(r, delayMs));
    let n = 0;
    for (const p of pieces(reply.reasoning ?? '')) { send({ reasoning_content: p }); n++; await wait(); }
    for (const p of pieces(reply.text ?? '')) { send({ content: p }); n++; await wait(); }
    if (reply.tool) {
      const args = JSON.stringify(reply.tool.args);
      send({ tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: reply.tool.name, arguments: '' } }] });
      for (const p of pieces(args)) { send({ tool_calls: [{ index: 0, function: { arguments: p } }] }); n++; await wait(); }
    }
    send({}, reply.finish ?? (reply.tool ? 'tool_calls' : 'stop'));
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900 + requests.length * 150, completion_tokens: n }, timings: { prompt_n: 120, prompt_per_second: 233.4, predicted_n: n, predicted_per_second: 41.9 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    // kill: every request from now on has its connection dropped (a machine that went away).
    resolve({ url: `http://127.0.0.1:${port}`, port, requests, seen, close: () => new Promise((r) => server.close(r)), kill: () => { down = true; }, remaining: () => queue.length });
  }));
}
