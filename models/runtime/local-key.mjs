// The key of the model servers this Mac starts for itself (18 Nov 2026, the audit): llama-server answers any
// program that reaches its port, and its open CORS let any web page you visit use the model or read its saved
// slots. Each start now passes --api-key-file with this file (made once, 0600, in the app's home); every request
// of the app to 127.0.0.1 or localhost carries it (authHeaders in remote.mjs, the embedder, the reranker).
// /health stays open, as llama-server keeps it. `coding serve` keeps its own key (serve.mjs).
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HOME } from '../registry.mjs';

export const LOCAL_KEY_FILE = () => join(HOME, 'local-model.key');
let cached = null;

// The file, made when there is none yet.
export function localKeyFile() {
  const f = LOCAL_KEY_FILE();
  if (!existsSync(f)) {
    mkdirSync(HOME, { recursive: true });
    try { writeFileSync(f, `${randomBytes(24).toString('hex')}\n`, { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  try { chmodSync(f, 0o600); } catch {}
  return f;
}

export function localKey() {
  const f = LOCAL_KEY_FILE();
  if (cached?.file === f) return cached.key;
  let key = null;
  try { key = readFileSync(f, 'utf8').split('\n')[0].trim() || null; } catch {}
  if (key) cached = { file: f, key };
  return key;
}

const LOOPBACK = /^https?:\/\/(?:127\.\d+\.\d+\.\d+|localhost|\[::1\])(?::\d+)?(?:\/|$)/i;
// The header for a request to a model server on this Mac; none elsewhere, or before any key was made.
export function localAuth(url) {
  if (!LOOPBACK.test(String(url ?? ''))) return {};
  const key = localKey();
  return key ? { authorization: `Bearer ${key}` } : {};
}
