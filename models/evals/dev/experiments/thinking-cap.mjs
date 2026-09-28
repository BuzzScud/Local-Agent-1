// Does the server's thinking budget cut the 27B's thinking? Budget 40 on a throwaway server.
import { spawn } from 'node:child_process';
const R = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, ''); // the repo
const { MODELS, DEFAULT_MODEL, thinkingKwargs, SERVER_BIN } = await import(`${R}/models/registry.mjs`);
const { serverArgs } = await import(`${R}/models/runtime/server.mjs`);
const m = { ...MODELS[DEFAULT_MODEL], thinkingBudget: 40 };
const srv = spawn(SERVER_BIN, serverArgs(m, { ctx: 8192, port: 17651 }), { stdio: 'ignore' });
process.on('exit', () => srv.kill());
for (let i = 0; i < 120; i++) { try { if ((await fetch('http://127.0.0.1:17651/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const t0 = Date.now();
const r = await fetch('http://127.0.0.1:17651/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
  messages: [{ role: 'user', content: 'Is 391 a prime number? Check carefully, then answer yes or no with the factors if any.' }],
  max_tokens: 400, ...m.thinkingSampling, chat_template_kwargs: thinkingKwargs(m, true) }) });
const j = await r.json();
const msg = j.choices?.[0]?.message ?? {};
console.log(JSON.stringify({ status: r.status, secs: (Date.now() - t0) / 1000, reasoningTokens: Math.round((msg.reasoning_content ?? '').length / 3.8), reasoningTail: (msg.reasoning_content ?? '').slice(-160), answer: (msg.content ?? '').slice(0, 200), predicted: j.timings?.predicted_n, finish: j.choices?.[0]?.finish_reason, err: j.error }, null, 1));
srv.kill();
process.exit(0);
