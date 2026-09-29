import { createServer } from 'node:http';

export const startedAt = Date.now();

// Answers one request: { status, body }. env and now can be given (tests do).
export function handle(method, path, env = process.env, now = Date.now()) {
  if (method === 'GET' && path === '/api/health') {
    return { status: 200, body: { ok: true, uptime: Math.round((now - startedAt) / 1000), build: env.BUILD_SHA ? env.BUILD_SHA.slice(0, 7) : 'dev' } };
  }
  return { status: 404, body: { error: 'not found' } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer((req, res) => {
    const { status, body } = handle(req.method, req.url);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }).listen(Number(process.env.PORT ?? 8080));
}
