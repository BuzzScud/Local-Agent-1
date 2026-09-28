// `coding setup`: gets what Agentic Coder needs into ~/.agentic-coder — the model
// server (Prism ML's llama.cpp built from source with our Metal patch, see
// models/runtime/engine), the model, its guessing helper and the memory's
// matcher — and checks the files' SHA-256. Safe to run again: finished parts are skipped.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HOME, ENGINE, MODELS, DEFAULT_MODEL, EMBEDDERS, DEFAULT_EMBEDDER, MODELS_DIR, SERVER_BIN, modelPath, draftPath } from '../registry.mjs';
import { buildEngine } from './engine/build.mjs';

export const RUNTIME = ENGINE;

async function download(url, file, say) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const part = `${file}.part`;
  const out = createWriteStream(part);
  let got = 0;
  let last = 0;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    if (Date.now() - last > 500) { last = Date.now(); say(`  ${(got / 1e9).toFixed(2)} of ${(total / 1e9).toFixed(2)} GB`, true); }
  }
  await new Promise((r) => out.end(r));
  renameSync(part, file);
  say(`  ${(got / 1e9).toFixed(2)} GB done`);
}

async function sha256(file) {
  const h = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

// Downloads a file unless it is already here, then checks its SHA-256.
async function fetchChecked({ name, url, file, bytes, sha }, say) {
  if (existsSync(file) && statSync(file).size === bytes) say(`✓ ${name} already here`);
  else {
    say(`Downloading ${name} (${(bytes / 1e9).toFixed(2)} GB)…`);
    await download(url, file, say);
  }
  say(`Checking ${name}…`);
  const sum = await sha256(file);
  if (sum !== sha) throw new Error(`${name} is damaged (SHA-256 ${sum.slice(0, 12)}…); delete ${file} and run coding setup again`);
}

export async function setup({ modelId = DEFAULT_MODEL, say = (s, sameLine) => process.stdout.write(sameLine ? `\r${s}   ` : `${s}\n`) } = {}) {
  mkdirSync(MODELS_DIR, { recursive: true });
  if (existsSync(SERVER_BIN)) say(`✓ model server already built (${ENGINE.tag})`);
  else {
    say(`Building the model server (${ENGINE.tag}, a few minutes)…`);
    await buildEngine({ ...ENGINE, home: HOME, say });
    say('✓ model server built');
  }
  const m = MODELS[modelId];
  await fetchChecked({ name: m.name, url: m.url, file: modelPath(m), bytes: m.bytes, sha: m.sha256 }, say);
  if (m.draft) await fetchChecked({ name: `${m.name}'s guessing helper`, url: m.draft.url, file: draftPath(m), bytes: m.draft.bytes, sha: m.draft.sha256 }, say);
  // The memory's matcher. Without it the memory still works, by words.
  const e = EMBEDDERS[DEFAULT_EMBEDDER];
  if (e) await fetchChecked({ name: `${e.name}, the memory's matcher`, url: e.url, file: modelPath(e), bytes: e.bytes, sha: e.sha256 }, say);
  say('✓ all checked. Run: coding');
}
