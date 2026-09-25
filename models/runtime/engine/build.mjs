// Builds the model server Bonsai Code runs: Prism ML's llama.cpp (branch prism, the
// commit in ENGINE) plus our Metal patch, as static llama-server and llama-bench in
// ~/.bonsai-code/engine/<tag>/. Needs git, cmake and Apple's command line tools;
// about 3 minutes on the M4. `bonsai setup` calls it; by hand:
//   node models/runtime/engine/build-now.mjs
// (This module only defines the build: the one-file `bonsai` binary loads it on
// every start, so running anything at import time would rebuild each time.)
// A new tag gets a new folder, so a build in use is never replaced.
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { PATCH } from './patch.mjs';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args[0] ?? ''} failed:\n${out.trim().split('\n').slice(-6).join('\n')}`))));
  });
}

export async function buildEngine({ tag, commit, home, say = () => {} }) {
  for (const tool of ['git', 'cmake', 'xcrun']) {
    await run('/usr/bin/which', [tool]).catch(() => {
      throw new Error(`${tool} is missing: install Apple's command line tools (xcode-select --install) and cmake (brew install cmake)`);
    });
  }
  const out = join(home, 'engine', tag);
  const src = join(home, 'engine', `src-${tag}.part`);
  const tmp = `${out}.part`;
  rmSync(src, { recursive: true, force: true });
  say('  getting the source…');
  await run('git', ['clone', '--quiet', '--filter=blob:none', 'https://github.com/PrismML-Eng/llama.cpp.git', src]);
  await run('git', ['-C', src, 'checkout', '--quiet', commit]);
  writeFileSync(join(src, 'bonsai.patch'), PATCH);
  await run('git', ['-C', src, 'apply', 'bonsai.patch']);
  say('  configuring…');
  await run('cmake', ['-S', src, '-B', join(src, 'build'), '-DCMAKE_BUILD_TYPE=Release', '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON',
    // static and without SSL: the two programs need nothing outside macOS
    '-DBUILD_SHARED_LIBS=OFF', '-DLLAMA_CURL=OFF', '-DLLAMA_OPENSSL=OFF', '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF']);
  say('  compiling (a few minutes)…');
  await run('cmake', ['--build', join(src, 'build'), '-j', String(cpus().length), '--target', 'llama-server', 'llama-bench']);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const bin of ['llama-server', 'llama-bench']) {
    copyFileSync(join(src, 'build', 'bin', bin), join(tmp, bin));
    chmodSync(join(tmp, bin), 0o755);
  }
  await run(join(tmp, 'llama-server'), ['--version']);
  rmSync(out, { recursive: true, force: true });
  renameSync(tmp, out);
  rmSync(src, { recursive: true, force: true });
  return out;
}
