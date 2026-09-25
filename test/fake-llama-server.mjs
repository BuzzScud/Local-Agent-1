#!/usr/bin/env node
// A stand-in for Prism's llama-server binary, for testing Bonsai Code's own
// start-up: it takes a moment to load, renders a simple chat template, "reads"
// prompts slowly, saves and restores slot files, and streams a fixed reply.
import { createServer } from 'node:http';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const port = Number(arg('--port'));
const slotDir = arg('--slot-save-path');
const t0 = Date.now();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
createServer(async (req, res) => {
  if (req.url === '/health') { const ok = Date.now() - t0 > 1500; res.statusCode = ok ? 200 : 503; res.end(ok ? '{"status":"ok"}' : '{"status":"loading"}'); return; }
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
  const text = 'Hello from the stand-in model.';
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  res.end();
}).listen(port, '127.0.0.1');
