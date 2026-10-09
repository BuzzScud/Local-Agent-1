// The models Agentic Coder can run (one folder each), and where their files
// live on this Mac (~/.agentic-coder).
import { homedir, tmpdir } from 'node:os';
import { statSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The state folder: ~/.agentic-coder. AGENTIC_HOME overrides.
const NEW_HOME = join(homedir(), '.agentic-coder');
const CHOSEN = process.env.AGENTIC_HOME ?? NEW_HOME;
// Inside a test run (bun test sets NODE_ENV=test, and its children keep it) the home is never the real
// one, whatever the order the files load in: a throwaway takes its place (3 Oct 2026: a test file run
// after another in one process deleted the real settings.json). terminal/test/test-env.mjs gives every
// test process its own throwaway first, so this is the last line, not the usual one.
export const HOME = process.env.NODE_ENV === 'test' && resolve(CHOSEN) === NEW_HOME ? mkdtempSync(join(tmpdir(), 'agentic-test-home-')) : CHOSEN;
// The model servers (engines) Agentic Coder builds from source, one folder
// each under ~/.agentic-coder/engine/<tag>, so a new build never replaces the
// one in use (models/runtime/engine). A model names the one it runs on
// (`engine` in its model.mjs); one that names none runs on DEFAULT_ENGINE.
//   official: llama.cpp's own release, as Google's guide for Gemma 4 asks.
//   prism:    Prism ML's llama.cpp with our Metal patch (it checks 2-8 guessed
//             words in one pass): the only one that runs Bonsai 2 27B's ternary file.
//   ifm:      MBZUAI IFM's llama.cpp (branch model/K2Horizon, on llama.cpp of
//             28 Aug 2026): the only one that runs K2 Horizon so far.
//   mlx:      not llama.cpp: Apple's MLX in a Python of its own (python: true; a venv in
//             its folder, mlx 0.32.0 and the model's runtime, crystal_runtime 2.0.0), with
//             models/runtime/mlx/mlx-server.py in llama-server's place. Bonsai 2 27B
//             ConstantKV runs only there. `coding setup --model constantkv` makes it.
// AGENTIC_ENGINE=official|prism runs everything on one (a comparison, or a way
// back), except a model only one engine runs (engineOnly in its model.mjs).
export const ENGINES = {
  official: { id: 'official', tag: 'llama-v0.5.0-7fe450e', repo: 'https://github.com/ggml-org/llama.cpp.git', commit: '7fe450e19305b828c199d602c23a8337aaa1f03b', patch: false },
  prism: { id: 'prism', tag: 'prism-adfffbe-pq2mc1', repo: 'https://github.com/PrismML-Eng/llama.cpp.git', commit: 'adfffbe41b2cabcd51fff326ab045662265062bb', patch: true },
  ifm: { id: 'ifm', tag: 'ifm-k2horizon-42adf01', repo: 'https://github.com/ifm-ai/llama.cpp.git', commit: '42adf019f76013dac873b5b43950d54d5ab27216', patch: false },
  mlx: { id: 'mlx', tag: 'mlx-crystal-2.0.0', python: true, runtime: 'crystal_runtime==2.0.0' },
};
// Prism's, measured 28 Sep 2026 with the app's flags: the same speed plain, and
// with Gemma's two speed helpers ~5% faster than the official v0.5.0 (16.7 vs
// 15.9 words/s; models/gemma-4-12b/results/engine-compare-2026-09-28).
export const DEFAULT_ENGINE = 'prism';
export const engineOf = (m) => (m?.engineOnly && ENGINES[m.engine]) || (ENGINES[process.env.AGENTIC_ENGINE] ?? ENGINES[m?.engine] ?? ENGINES[DEFAULT_ENGINE]);
// The program a model's server is started with: llama-server, or for an MLX model its engine's Python
// (which runs models/runtime/mlx/mlx-server.py).
export const serverBinOf = (m) => (engineOf(m).python ? join(HOME, 'engine', engineOf(m).tag, 'venv', 'bin', 'python') : join(HOME, 'engine', engineOf(m).tag, 'llama-server'));
export const MODELS_DIR = join(HOME, 'models');
export const LOG_DIR = join(HOME, 'logs');
export const SLOT_DIR = join(HOME, 'slots'); // saved warm-ups (models/runtime/warmup.mjs)
export const DEFAULT_PORT = 17600;

// One entry per model folder. To add a model: make models/<name>/model.mjs
// (copy this model's as a start), import it here, and add it to the list.
// Bonsai 2 27B, Bonsai 2 27B ConstantKV and Gemma 4 12B left the list on
// 9 Oct 2026, their folders with them.
import qwen35_9b from './qwen3.5-9b/model.mjs';
import k2Horizon7b from './k2-horizon-7b/model.mjs';

const ALL = [qwen35_9b, k2Horizon7b];
export const MODELS = Object.fromEntries(ALL.map((m) => [m.id, m]));

// Qwen3.5 9B since 30 Sep 2026: with thinking on it passed 24 of 24 practice
// tasks in 1 h 53 m where Gemma passed 22 in 3 h 49 m, and it reads 190 tokens/s
// to Gemma's 127 (the prompt test and the speed probe).
export const DEFAULT_MODEL = 'qwen';
// The default model's engine and its server: what `coding setup`, the version
// check and the dev tools use.
export const ENGINE = engineOf(MODELS[DEFAULT_MODEL]);
export const SERVER_BIN = serverBinOf(MODELS[DEFAULT_MODEL]);

// The small models that write nothing and only compare meanings (one folder
// each, like the models above). The memory uses one to find the facts that
// fit a request.
import bgeM3 from './bge-m3/model.mjs';

export const EMBEDDERS = Object.fromEntries([bgeM3].map((m) => [m.id, m]));
export const DEFAULT_EMBEDDER = 'bge-m3';

// The small models that read a request together with each piece the search
// found and put the best first (/effort's Reranker row, off by default).
import qwen3Reranker from './qwen3-reranker-0.6b/model.mjs';

export const RERANKERS = Object.fromEntries([qwen3Reranker].map((m) => [m.id, m]));
export const DEFAULT_RERANKER = 'qwen3-reranker-0.6b';

// The thinking level for on/off plus an effort id ('medium' | 'high').
// Thinking off is the level without an effort (Low: answers straight away).
export function thinkingLevel(model, thinking, effort) {
  const levels = model?.thinkingLevels ?? [];
  if (!thinking) return levels.find((l) => !l.effort) ?? { id: 'low', label: 'Low', effort: null };
  return levels.find((l) => l.id === (effort ?? model?.thinkingEffort) && l.effort)
    ?? levels.find((l) => l.id === model?.thinkingEffort)
    ?? { id: 'on', label: 'On', effort: null };
}

// What to send the chat template for thinking off, or on at an effort.
// A model's own template switches (templateKwargs: K2 Horizon's tool-call
// format) go with them.
export function thinkingKwargs(model, thinking, effort) {
  const own = model?.templateKwargs ?? {};
  if (!thinking) return { ...own, enable_thinking: false };
  const lv = thinkingLevel(model, true, effort);
  return { ...own, enable_thinking: true, ...(lv.effort ? { reasoning_effort: lv.effort } : {}) };
}

export const modelPath = (m) => join(MODELS_DIR, m.file);
// How much of a model is on this Mac, in bytes: its file, or every listed file of an MLX model's folder
// (model.files); the same as model.bytes once it is all here. 0 when none of it is.
export const onDiskBytes = (m) => {
  const size = (p) => { try { return statSync(p).size; } catch { return 0; } };
  return m?.files ? m.files.reduce((n, f) => n + size(join(modelPath(m), f.path)), 0) : size(modelPath(m));
};
// The model's guessing helper (speculative decoding), when it has one.
export const draftPath = (m) => (m?.draft ? join(MODELS_DIR, m.draft.file) : null);
// Its vision add-on (the multimodal projector), when it has one; loaded only with visionOn.
export const visionPath = (m) => (m?.vision ? join(MODELS_DIR, m.vision.file) : null);
// The same model, loaded with its vision add-on: the server adds --mmproj, the
// memory estimate counts the add-on, and a server kept loaded is shared only
// when it has vision too.
export const withVision = (m) => (m?.vision ? { ...m, visionOn: true } : m);

// This model's folder in the repo: its README, reports/ and results/.
export const modelFolder = (m) => new URL(`./${m.folder}/`, import.meta.url).pathname;
