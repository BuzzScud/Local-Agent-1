// Starts the dev model server the models/evals/dev tools expect: port 17650, 16k,
// with the app's own flags (serverArgs). Stop it with: kill $(cat ~/.agentic-coder/logs/dev-server.pid)
import { spawn } from 'node:child_process';
import { openSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const R = new URL('../../../', import.meta.url).pathname.replace(/\/$/, ''); // the repo
const { MODELS, DEFAULT_MODEL, LOG_DIR, SERVER_BIN } = await import(`${R}/models/registry.mjs`);
const { serverArgs } = await import(`${R}/models/runtime/server.mjs`);
mkdirSync(LOG_DIR, { recursive: true });
const log = openSync(join(LOG_DIR, 'dev-server.log'), 'a');
const srv = spawn(SERVER_BIN, serverArgs(MODELS[DEFAULT_MODEL], { ctx: Number(process.argv[2] ?? 16384), port: 17650 }), { stdio: ['ignore', log, log], detached: true });
writeFileSync(join(LOG_DIR, 'dev-server.pid'), String(srv.pid));
srv.unref();
for (let i = 0; i < 120; i++) { try { if ((await fetch('http://127.0.0.1:17650/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
console.log(`dev server ready on :17650 (pid ${srv.pid})`);
