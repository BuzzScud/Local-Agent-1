#!/usr/bin/env node
// A stand-in for Prism's llama-server binary, for testing Agentic Coder's own
// start-up: it takes a moment to load, renders a simple chat template, "reads"
// prompts slowly, saves and restores slot files, and streams a fixed reply.
import { createServer } from 'node:http';
import { writeFileSync, existsSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const port = Number(arg('--port'));
const slotDir = arg('--slot-save-path');
const t0 = Date.now();
// A test that checks how it was started names a file to note its arguments in;
// one that needs a reply still running sets FAKE_LLAMA_REPLY_MS (below), one that
// needs the start-up to last longer sets FAKE_LLAMA_LOAD_MS (default 1500).
if (process.env.FAKE_LLAMA_ARGS) appendFileSync(process.env.FAKE_LLAMA_ARGS, `${JSON.stringify(process.argv.slice(2))}\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// --api-key-file (coding serve): everything but /health asks for that key, as the real one does.
const keyFile = process.argv.includes('--api-key-file') ? arg('--api-key-file') : null;
const key = keyFile ? readFileSync(keyFile, 'utf8').split('\n')[0].trim() : null;
createServer(async (req, res) => {
  if (req.url === '/health') { const ok = Date.now() - t0 > Number(process.env.FAKE_LLAMA_LOAD_MS ?? 1500); res.statusCode = ok ? 200 : 503; res.end(ok ? '{"status":"ok"}' : '{"status":"loading"}'); return; }
  if (key && req.headers.authorization !== `Bearer ${key}`) { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end('{"error":{"message":"Invalid API Key","type":"authentication_error"}}'); return; }
  // What it runs, as /remote asks a server (its file, context and slots, from how it was started).
  if (req.url === '/props') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model_path: arg('-m'), total_slots: Number(arg('-np') ?? 1), default_generation_settings: { n_ctx: Number(arg('-c') ?? 4096) } })); return; }
  let body = ''; for await (const c of req) body += c;
  const j = body ? JSON.parse(body) : {};
  res.setHeader('content-type', 'application/json');
  if (req.url === '/apply-template') {
    const [sys, user] = j.messages;
    res.end(JSON.stringify({ prompt: `<|im_start|>system\n# Tools\n${JSON.stringify(j.tools ?? [])}\n\n${sys.content}<|im_end|>\n<|im_start|>user\n${user.content}<|im_end|>\n<|im_start|>assistant\n` }));
    return;
  }
  if (req.url === '/completion') { await wait(j.prompt.includes('This session') ? 200 : 2500); res.end('{}'); return; }
  const m = /^\/slots\/\d+\?action=(save|restore)$/.exec(req.url);
  if (m?.[1] === 'save') { writeFileSync(join(slotDir, j.filename), 'state'); res.end('{"n_saved":1}'); return; }
  if (m?.[1] === 'restore') { await wait(1500); if (!existsSync(join(slotDir, j.filename))) { res.statusCode = 400; res.end('{"error":{"message":"no file"}}'); return; } res.end('{"n_restored":1}'); return; }
  if (!j.stream) { res.end(JSON.stringify({ choices: [{ message: { content: '' } }] })); return; }
  res.setHeader('content-type', 'text/event-stream');
  await wait(Number(process.env.FAKE_LLAMA_REPLY_MS ?? 0)); // a test holds the reply open with this
  const text = 'Hello from the stand-in model.';
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  res.end();
}).listen(port, '127.0.0.1');
