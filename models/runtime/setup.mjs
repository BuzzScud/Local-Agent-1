// `bonsai setup`: downloads what Bonsai Code needs into ~/.bonsai-code —
// Prism ML's llama.cpp build (pinned) and the model — and checks the model's
// SHA-256. Safe to run again: finished files are skipped.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { HOME, MODELS, DEFAULT_MODEL, MODELS_DIR, SERVER_BIN, modelPath } from '../registry.mjs';

export const RUNTIME = {
  tag: 'prism-b10735-842b188',
  url: 'https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10735-842b188/llama-prism-b10735-842b188-bin-macos-arm64.tar.gz',
};

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

export async function setup({ modelId = DEFAULT_MODEL, say = (s, sameLine) => process.stdout.write(sameLine ? `\r${s}   ` : `${s}\n`) } = {}) {
  mkdirSync(join(HOME, 'bin'), { recursive: true });
  mkdirSync(MODELS_DIR, { recursive: true });
  if (existsSync(SERVER_BIN)) say(`✓ runtime already here (${SERVER_BIN})`);
  else {
    say(`Downloading Prism's llama.cpp (${RUNTIME.tag})…`);
    const tgz = join(HOME, 'runtime.tar.gz');
    await download(RUNTIME.url, tgz, say);
    const r = spawnSync('tar', ['-xzf', tgz, '-C', join(HOME, 'bin'), '--strip-components=1']);
    rmSync(tgz, { force: true });
    if (r.status !== 0) throw new Error('could not unpack the runtime');
    spawnSync('xattr', ['-dr', 'com.apple.quarantine', join(HOME, 'bin')]);
    say('✓ runtime ready');
  }
  const m = MODELS[modelId];
  const file = modelPath(m);
  if (existsSync(file) && statSync(file).size === m.bytes) say(`✓ ${m.name} already here`);
  else {
    say(`Downloading ${m.name} (${(m.bytes / 1e9).toFixed(2)} GB)…`);
    await download(m.url, file, say);
  }
  say('Checking the model file…');
  const sum = await sha256(file);
  if (sum !== m.sha256) throw new Error(`the model file is damaged (SHA-256 ${sum.slice(0, 12)}…); delete ${file} and run bonsai setup again`);
  say('✓ model checked. Run: bonsai');
}
