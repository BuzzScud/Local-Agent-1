// A stand-in for the Claude API (Anthropic's Messages API), for testing the
// Claude API remote without a key or a bill: GET /v1/models, and POST
// /v1/messages streaming the same events the real one does (message_start,
// content blocks for thinking, text and tool_use, message_delta, message_stop).
// Each reply: { delayMs?, tools?: [{ name, args }, …], thinking?, search?: { query, results: [{ url, title }] }, fetch?: { url, text }, text?, tool?: { name, args },
// stop? ('refusal', 'pause_turn'), error?: { status, type, message } }. search and fetch: Anthropic's own web tools, done on its side;
// toolSearch: { query, found }: its tool search, loading deferred tools.
// seen: every request's path, its key, beta and version headers, and its body.
import { createServer } from 'node:http';

export const FAKE_MODELS = [
  { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z', max_input_tokens: 1_000_000, max_tokens: 128_000 },
  { type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z', max_input_tokens: 200_000, max_tokens: 64_000 },
];

export function startFakeAnthropic(replies, { key = 'test-anthropic-key-0123456789' } = {}) {
  const queue = [...replies];
  const seen = [];
  let n = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : null;
    const entry = { path: req.url, method: req.method, key: req.headers['x-api-key'] ?? null, beta: req.headers['anthropic-beta'] ?? null, version: req.headers['anthropic-version'] ?? null, body, at: Date.now(), end: null };
    seen.push(entry);
    res.on('finish', () => { entry.end = Date.now(); });
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const error = (status, type, message) => json(status, { type: 'error', error: { type, message } });
    if (req.headers['x-api-key'] !== key) return error(401, 'authentication_error', 'invalid x-api-key');
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) return json(200, { data: FAKE_MODELS, has_more: false, first_id: FAKE_MODELS[0].id, last_id: FAKE_MODELS.at(-1).id });
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) return error(404, 'not_found_error', `no ${req.url}`);
    const reply = queue.shift() ?? { text: 'Done.' };
    if (reply.error) return error(reply.error.status, reply.error.type, reply.error.message);
    const id = `msg_${++n}`;
    const blocks = [];
    if (reply.thinking) blocks.push({ type: 'thinking', thinking: reply.thinking, signature: `sig-${n}` });
    if (reply.search) {
      blocks.push({ type: 'server_tool_use', id: `srvtoolu_s${n}`, name: 'web_search', input: { query: reply.search.query } });
      blocks.push({ type: 'web_search_tool_result', tool_use_id: `srvtoolu_s${n}`, content: reply.search.results.map((r) => ({ type: 'web_search_result', url: r.url, title: r.title, encrypted_content: `enc-${r.url}`, page_age: null })) });
    }
    if (reply.fetch) {
      blocks.push({ type: 'server_tool_use', id: `srvtoolu_f${n}`, name: 'web_fetch', input: { url: reply.fetch.url } });
      blocks.push({ type: 'web_fetch_tool_result', tool_use_id: `srvtoolu_f${n}`, content: { type: 'web_fetch_result', url: reply.fetch.url, content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: reply.fetch.text } }, retrieved_at: '2026-09-30T00:00:00Z' } });
    }
    // toolSearch: { query, found: [tool names] }: Anthropic's tool search, done on its side, loading deferred tools.
    if (reply.toolSearch) {
      blocks.push({ type: 'server_tool_use', id: `srvtoolu_t${n}`, name: 'tool_search_tool_bm25', input: { query: reply.toolSearch.query } });
      blocks.push({ type: 'tool_search_tool_result', tool_use_id: `srvtoolu_t${n}`, content: { type: 'tool_search_tool_search_result', tool_references: reply.toolSearch.found.map((name) => ({ type: 'tool_reference', tool_name: name })) } });
    }
    if (reply.text) blocks.push({ type: 'text', text: reply.text });
    for (const [i, t] of [...(reply.tool ? [reply.tool] : []), ...(reply.tools ?? [])].entries()) blocks.push({ type: 'tool_use', id: `toolu_${n}${i ? `_${i}` : ''}`, name: t.name, input: t.args });
    const stop = reply.stop ?? (reply.tool || reply.tools ? 'tool_use' : 'end_turn');
    // delayMs: the reply is held that long first (a test sees two requests at once).
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    const usage = { input_tokens: 1200 + n, output_tokens: 30, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };
    if (!body.stream) return json(200, { id, type: 'message', role: 'assistant', model: body.model, content: blocks, stop_reason: stop, stop_sequence: null, usage });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { id, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
    blocks.forEach((b, i) => {
      if (b.type === 'thinking') {
        send('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
        send('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: b.thinking } });
        send('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: b.signature } });
      } else if (b.type === 'text') {
        send('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
        for (const part of b.text.match(/.{1,8}/gs) ?? []) send('content_block_delta', { index: i, delta: { type: 'text_delta', text: part } });
      } else if (b.type.endsWith('_tool_result')) {
        send('content_block_start', { index: i, content_block: b });
      } else {
        send('content_block_start', { index: i, content_block: { type: b.type, id: b.id, name: b.name, input: {} } });
        const args = JSON.stringify(b.input);
        for (const part of args.match(/.{1,10}/gs) ?? []) send('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: part } });
      }
      send('content_block_stop', { index: i });
    });
    send('message_delta', { delta: { stop_reason: stop, stop_sequence: null, ...(stop === 'refusal' ? { stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } } : {}) }, usage: { output_tokens: 30 } });
    send('message_stop', {});
    res.end();
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    ok({ url: `http://127.0.0.1:${port}`, port, key, seen, remaining: () => queue.length, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}
