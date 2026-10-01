// `coding setup`: gets what Agentic Coder needs into ~/.agentic-coder — the model
// server (llama.cpp built from source on the model's engine, see
// models/runtime/engine), the model, its guessing helper and the memory's
// matcher — and checks the files' SHA-256. Safe to run again: finished parts are skipped.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { HOME, ENGINE, MODELS, DEFAULT_MODEL, EMBEDDERS, DEFAULT_EMBEDDER, RERANKERS, DEFAULT_RERANKER, MODELS_DIR, visionPath, engineOf, serverBinOf, modelPath, draftPath } from '../registry.mjs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
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

// The model's vision add-on (what lets it look at a picture), downloaded and
// checked like the model; nothing when the model has none.
export async function getVision(m, say = (t) => process.stdout.write(`${t}\n`)) {
  if (!m?.vision) return false;
  mkdirSync(MODELS_DIR, { recursive: true });
  await fetchChecked({ name: `${m.name}'s vision add-on`, url: m.vision.url, file: visionPath(m), bytes: m.vision.bytes, sha: m.vision.sha256 }, say);
  return true;
}

// The runtime's license of an MLX model, shown and asked about once, before anything is built or
// downloaded (--accept-license: accepted without asking; no terminal to ask: refused with that hint).
async function askLicense(m, say, accept) {
  const home = join(HOME, 'engine', engineOf(m).tag), agreed = join(home, 'license-accepted');
  if (existsSync(agreed)) return;
  say(`${m.name} runs on a closed runtime under its own license (${m.license.name}):`);
  say(`  ${m.license.says}`);
  say(`  The whole text: ${m.url.replace('/tree/', '/blob/')}/${m.license.file}`);
  if (!accept) {
    if (!process.stdin.isTTY) throw new Error(`${m.name} needs its runtime's license accepted: run coding setup --model ${m.id} --accept-license`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const yes = /^y(es)?$/i.test((await rl.question('Install it under these terms? [y/N] ')).trim());
    rl.close();
    if (!yes) throw new Error('not installed: the license was not accepted');
  }
  mkdirSync(home, { recursive: true });
  writeFileSync(agreed, `${m.license.name} accepted ${new Date().toISOString()}\n`);
}

// An MLX model (format 'mlx', engine python), once its license is accepted: every file of its
// repository at the pinned revision, each checked against model.files; then its engine, a Python of its
// own (a venv in ~/.agentic-coder/engine/<tag>) with the pack's own requirements and its runtime's wheel
// from the pack. Safe to run again.
async function setupMlx(m, say) {
  const eng = engineOf(m), home = join(HOME, 'engine', eng.tag);
  const dir = modelPath(m);
  for (const f of m.files) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    const url = `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    if (f.bytes > 50e6) await fetchChecked({ name: `${m.name} (${f.path})`, url, file: join(dir, f.path), bytes: f.bytes, sha: f.sha256 }, say);
    else await fetchChecked({ name: f.path, url, file: join(dir, f.path), bytes: f.bytes, sha: f.sha256 }, () => {});
  }
  say(`✓ ${m.name}: all ${m.files.length} files checked`);
  if (existsSync(serverBinOf(m)) && spawnSync(serverBinOf(m), ['-c', 'import crystal_runtime, mlx.core'], { encoding: 'utf8' }).status === 0) { say(`✓ its engine is ready (${eng.tag})`); return; }
  // A Python its runtime has a wheel for (the pack's crystal_runtime/*.whl: 3.10, 3.11 or 3.13 on a Mac).
  const wheels = readdirSync(join(dir, 'crystal_runtime')).filter((w) => /macosx.*\.whl$/.test(w)).map((w) => /-cp(\d+)-/.exec(w)?.[1]).filter(Boolean);
  const found = spawnSync('/bin/sh', ['-lc', 'for p in python3.13 python3.11 python3.10 python3; do command -v $p; done'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const py = found.find((p) => wheels.includes(spawnSync(p, ['-c', 'import sys; print("%d%d" % sys.version_info[:2])'], { encoding: 'utf8' }).stdout.trim()));
  if (!py) throw new Error(`${m.name} needs Python ${wheels.map((v) => `${v[0]}.${v.slice(1)}`).join(', ')} (its runtime is built for those): install one (brew install python@3.13), then run coding setup --model ${m.id} again`);
  const step = (what, cmd, args) => { say(what); const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); if (r.status !== 0) throw new Error(`${what.replace(/…$/, '')} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' · ')}`); };
  const pip = join(home, 'venv', 'bin', 'pip');
  step(`Making its Python (${py})…`, py, ['-m', 'venv', join(home, 'venv')]);
  step('Installing MLX and what the runtime needs (about 400 MB)…', pip, ['install', '-q', '-r', join(dir, 'crystal_runtime', 'requirements.txt')]);
  step('Installing its runtime from the pack…', pip, ['install', '-q', '--no-index', '--find-links', join(dir, 'crystal_runtime'), eng.runtime]);
  say(`✓ its engine is ready (${eng.tag})`);
}

export async function setup({ modelId = DEFAULT_MODEL, accept = false, say = (s, sameLine) => process.stdout.write(sameLine ? `\r${s}   ` : `${s}\n`) } = {}) {
  mkdirSync(MODELS_DIR, { recursive: true });
  const m = MODELS[modelId];
  if (m.format === 'mlx') await askLicense(m, say, accept);
  // The engines the model and the memory's matcher run on (usually the same one); an MLX model's is set up with it.
  const engines = new Map([m, EMBEDDERS[DEFAULT_EMBEDDER]].filter((x) => x && !engineOf(x).python).map((x) => [engineOf(x).tag, x]));
  for (const [tag, x] of engines) {
    if (existsSync(serverBinOf(x))) say(`✓ model server already built (${tag})`);
    else {
      say(`Building the model server (${tag}, a few minutes)…`);
      await buildEngine({ ...engineOf(x), home: HOME, say });
      say('✓ model server built');
    }
  }
  if (m.format === 'mlx') await setupMlx(m, say);
  else await fetchChecked({ name: m.name, url: m.url, file: modelPath(m), bytes: m.bytes, sha: m.sha256 }, say);
  // A helper inside the model file (draft.inFile) came with it.
  if (m.draft && !m.draft.inFile) await fetchChecked({ name: `${m.name}'s guessing helper`, url: m.draft.url, file: draftPath(m), bytes: m.draft.bytes, sha: m.draft.sha256 }, say);
  // Its vision add-on: kept on disk, loaded only once a picture is attached.
  await getVision(m, say);
  // The memory's matcher. Without it the memory still works, by words.
  const e = EMBEDDERS[DEFAULT_EMBEDDER];
  if (e) await fetchChecked({ name: `${e.name}, the memory's matcher`, url: e.url, file: modelPath(e), bytes: e.bytes, sha: e.sha256 }, say);
  // The reranker (/effort's Reranker row, off until you turn it on).
  const r = RERANKERS[DEFAULT_RERANKER];
  if (r) await fetchChecked({ name: `${r.name}, the search's reranker`, url: r.url, file: modelPath(r), bytes: r.bytes, sha: r.sha256 }, say);
  say('✓ all checked. Run: coding');
}
