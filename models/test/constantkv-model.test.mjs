// Bonsai 2 27B ConstantKV, the fifth model in /model (1 Oct 2026): it runs on the MLX engine (its own Python
// and models/runtime/mlx/mlx-server.py, not llama.cpp), its memory does not grow with the context, so it
// starts at 64k, and its runtime's license is asked about before setup installs anything.
import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { MODELS, ENGINES, engineOf, serverBinOf, modelPath, HOME } from '../registry.mjs';
import { needBytes, kvBytesPerToken, chooseContext, contextCheck } from '../runtime/memory.mjs';
import { serverArgs, otherCopies, serverProcesses, SERVER_PROCESS, BUDGET_MESSAGE, mlxServerScript } from '../runtime/server.mjs';

const m = MODELS.constantkv;
const REPO = join(import.meta.dir, '..', '..');

test('it is in /model beside Bonsai, on the MLX engine whatever AGENTIC_ENGINE says, started with its own Python', () => {
  expect(m).toMatchObject({ id: 'constantkv', name: 'Bonsai 2 27B ConstantKV', engine: 'mlx', engineOnly: true, format: 'mlx', slots: 2, constantState: true });
  expect(MODELS.bonsai).toBeDefined(); // today's Bonsai stays
  expect(ENGINES.mlx).toMatchObject({ python: true, tag: 'mlx-crystal-2.0.0', runtime: 'crystal_runtime==2.0.0' });
  expect(serverBinOf(m)).toBe(join(HOME, 'engine', 'mlx-crystal-2.0.0', 'venv', 'bin', 'python'));
  const was = process.env.AGENTIC_ENGINE;
  try { process.env.AGENTIC_ENGINE = 'official'; expect(engineOf(m).id).toBe('mlx'); } finally { if (was === undefined) delete process.env.AGENTIC_ENGINE; else process.env.AGENTIC_ENGINE = was; }
  // Bonsai's template, so Bonsai's levels and its effort line at the top of the prompt.
  expect(m.thinkingLevels.map((l) => l.effort)).toEqual([null, 'medium', 'xhigh']);
  expect(m.effortAtTop).toBe(true);
});

test('its server is mlx-server.py on the model folder, with the context and the thinking cap; no llama.cpp flags', () => {
  const a = serverArgs(m, { ctx: 65_536, port: 17600 });
  expect(a[0]).toBe(mlxServerScript());
  expect(existsSync(a[0])).toBe(true);
  expect(a.slice(1)).toEqual(['--pack', modelPath(m), '--host', '127.0.0.1', '--port', '17600', '-c', '65536', '--reasoning-budget', '2048', '--reasoning-budget-message', BUDGET_MESSAGE]);
  expect(a.some((x) => ['-ngl', '-ctk', '--jinja', '--slot-save-path'].includes(x))).toBe(false);
  // coding serve's flags: the server takes them too.
  const help = spawnSync('python3', ['-c', `import re,sys; s=open(${JSON.stringify(a[0])}).read(); print(all(f in s for f in ['--api-key-file','--ssl-cert-file','--ssl-key-file','/v1/chat/completions','/tokenize','/apply-template','/completion','n_probs']))`], { encoding: 'utf8' });
  expect(help.stdout.trim()).toBe('True');
});

test('its memory does not grow with the context: the same need at 16k, 64k and 256k, and it starts at 64k', () => {
  expect(kvBytesPerToken(m)).toBe(0);
  expect(needBytes(m, 16_384)).toBe(needBytes(m, 262_144));
  expect(needBytes(m, 65_536) / 1e9).toBeCloseTo(12.8, 0); // measured: a 12.8 GB peak reading 4,500 tokens with its checkpoint
  expect(chooseContext(m, { available: 14e9 })).toMatchObject({ ctx: 65_536, reason: null });
  // Short of memory, a smaller context would save nothing: it stays at 64k and says what it needs.
  const short = chooseContext(m, { available: 9e9 });
  expect(short.ctx).toBe(65_536);
  expect(short.reason).toBe('9.0 GB free, so using 64k (needs 12.8 GB); close other apps, such as the desk servers, to keep it fast');
  expect(contextCheck(m, 65_536, { available: 9e9, users: [] }).fits).toBe(false);
  // The others keep their sizes and their words.
  expect(chooseContext(MODELS.bonsai, { available: 1e9 }).reason).toMatch(/so using 16k \(needs /);
});

test('its server is seen as a loaded model: another copy is found, and it counts among the model servers', () => {
  const py = serverBinOf(m), file = modelPath(m);
  const psText = [
    `  700  1 9000000 ${py} ${mlxServerScript()} --pack ${file} --host 127.0.0.1 --port 17605 -c 65536`,
    '  701  1 1000 /usr/bin/python3 server.py --port 8000',
    `  702  1 5000000 ${HOME}/engine/prism-adfffbe-pq2mc1/llama-server -m ${modelPath(MODELS.bonsai)} --port 17600`,
  ].join('\n');
  expect(otherCopies(m, { psText, live: [] })).toEqual([{ pid: 700, port: 17605, who: 'another program', bytes: 9000000 * 1024 }]);
  const psPlain = psText.split('\n').map((l) => l.replace(/^(\s*\d+) 1 /, '$1 ')).join('\n'); // pid=,rss=,command=
  expect(serverProcesses({ psText: psPlain }).map((s) => s.pid)).toEqual([700, 702]);
  expect(SERVER_PROCESS.test('/x/venv/bin/python /repo/models/runtime/mlx/mlx-server.py --pack /m')).toBe(true);
  expect(SERVER_PROCESS.test('/usr/bin/python3 server.py --port 8000')).toBe(false);
});

test('its files: the whole repository at a pinned revision, every file with its size and SHA-256', () => {
  expect(m.files).toHaveLength(70);
  expect(m.bytes).toBe(m.files.reduce((n, f) => n + f.bytes, 0));
  // Only the runtime's two lock files are empty (the repository's own, kept: the pack must match it byte for byte).
  expect(m.files.filter((f) => f.bytes === 0).map((f) => f.path)).toEqual(['causal/.causal-weight-bindings.lock', 'causal/.manifest.lock']);
  expect(m.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes >= 0 && !f.path.startsWith('/') && !f.path.includes('..'))).toBe(true);
  for (const p of ['model.safetensors', 'crystal.safetensors', 'tokenizer.json', 'chat_template.jinja', 'crystal_runtime/requirements.txt', 'crystal_runtime/LICENSE']) expect(m.files.some((f) => f.path === p)).toBe(true);
  expect(m.files.find((f) => f.path === 'model.safetensors').sha256).toBe('130de5925082c168b7866b2e91b52e44abbafc99017e3ca352b77b5b55a269ed');
  expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
  expect(m.url).toContain(m.revision);
});

test('setup shows the runtime\'s license and installs nothing without a yes (no terminal to ask: --accept-license)', () => {
  const home = mkdtempSync(join(tmpdir(), 'agentic-ckv-setup-'));
  const r = spawnSync(process.execPath, ['-e', "const { setup } = await import('./models/runtime/setup.mjs'); try { await setup({ modelId: 'constantkv', say: (s) => console.log(s) }); console.log('INSTALLED'); } catch (e) { console.log('REFUSED: ' + e.message); }"],
    { cwd: REPO, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AGENTIC_HOME: home, AGENTIC_MEMORY_SAVE: 'off' } });
  // Asked before anything is built or downloaded: nothing of it is here after a no.
  expect(r.stdout).toContain('runs on a closed runtime under its own license (Crystal Runtime Research License 1.1)');
  expect(r.stdout).toContain('It may not be used for commercial purposes');
  expect(r.stdout).toContain('REFUSED: Bonsai 2 27B ConstantKV needs its runtime\'s license accepted: run coding setup --model constantkv --accept-license');
  expect(existsSync(join(home, 'models', m.file))).toBe(false);
  expect(existsSync(join(home, 'engine', 'mlx-crystal-2.0.0', 'license-accepted'))).toBe(false);
});
