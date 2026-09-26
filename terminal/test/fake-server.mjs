// A stand-in for llama-server that replays scripted replies over the same
// streaming API, so the agent and the terminal app can be tested without the
// real model. Each reply: { reasoning?, text?, tool?: { name, args } }.
import { createServer } from 'node:http';

export function startFakeServer(replies, { delayMs = 2, chunk = 6 } = {}) {
  const queue = [...replies];
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/health') { res.end('{"status":"ok"}'); return; }
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    requests.push(json);
    if (json.max_tokens === 1 || !json.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '' } }] })); return; }
    const reply = queue.shift() ?? { text: 'Done.' };
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
    resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(r)), remaining: () => queue.length });
  }));
}
