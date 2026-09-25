// The models Bonsai Code can run, and where everything lives on disk.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = process.env.BONSAI_HOME ?? join(homedir(), '.bonsai-code');
export const SERVER_BIN = join(HOME, 'bin', 'llama-server');
export const MODELS_DIR = join(HOME, 'models');
export const LOG_DIR = join(HOME, 'logs');
export const SLOT_DIR = join(HOME, 'slots'); // saved warm-ups (src/server/warmup.mjs)
export const DEFAULT_PORT = 17600;

export const MODELS = {
  '27b': {
    id: '27b',
    name: 'Bonsai 2 27B',
    file: 'Ternary-Bonsai-2-27B-PQ2_0.gguf',
    url: 'https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf/resolve/main/Ternary-Bonsai-2-27B-PQ2_0.gguf',
    sha256: '3907dc1658db1f78a9826bf8d5bcb8dc65db0d466388937af57f2294fae62ec1',
    bytes: 7_206_168_928,
    // The file's own chat template is used: it already handles tool calls and
    // the thinking switch (enable_thinking + reasoning_effort).
    // Layout read from the file (Qwen3.8-27B): 64 layers, but only every 4th
    // keeps a per-token cache (4 KV heads of 256); the other 48 keep a
    // fixed-size running state.
    attnLayers: 16, kvHeads: 4, headDim: 256, maxCtx: 262_144,
    fixedStateBytes: 0.16e9,
    // To pick a conversation up again, the server saves checkpoints of that
    // running state (150 MiB each). Its defaults (32 checkpoints plus an 8 GB
    // store of old prompts) grew to 9 GB in 13 prompts; 4 checkpoints and no
    // store stay at ~2.1 GB and still skip re-reading a try's shared start.
    checkpoints: 3, checkpointBytes: 0.157e9,
    // Two slots: the conversation keeps slot 0, side requests (sorting a
    // request, the tries) use slot 1, so they never wipe the conversation's
    // read-in instructions. Each slot has its own running state and checkpoints.
    slots: 2,
    // n-gram speculative decoding (see serverArgs): lookup 12 tokens, draft up to 48.
    spec: { type: 'ngram-simple', n: 12, m: 48 },
    // Measured 2026-09-24 on the M4: 10.4 tokens/s writing, 61 reading.
    // Thinking starts off; /think on turns on PrismML's "medium" effort (about
    // 200 tokens on a small task). "xhigh", the model's default, can think for
    // minutes and "high" errors in this build.
    thinkingDefault: false,
    thinkingEffort: 'medium', // the level /think on (and --think) uses
    // The levels /model offers. effort is the chat template's reasoning_effort
    // ("low" acts like "xhigh" in this build, and "high" errors).
    thinkingLevels: [
      { id: 'off', label: 'Off', effort: null, note: 'answers straight away (fastest)' },
      { id: 'medium', label: 'Medium', effort: 'medium', note: 'thinks briefly first (about 200 tokens on a small task)' },
      { id: 'high', label: 'High', effort: 'xhigh', note: 'thinks carefully first; can take minutes (stopped at 2,048 tokens)' },
    ],
    thinkingBudget: 2048, // ~3 min at 10 tokens/s; the server ends thinking there
    // PrismML's instruct settings without its presence penalty (which would
    // push code away from repeating names and brackets); these are the
    // settings tested on real jobs.
    sampling: { temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 },
    thinkingSampling: { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.05 },
  },
};

export const DEFAULT_MODEL = '27b';

// The thinking level for on/off plus an effort id ('medium' | 'high').
export function thinkingLevel(model, thinking, effort) {
  const levels = model?.thinkingLevels ?? [];
  if (!thinking) return levels.find((l) => l.id === 'off') ?? { id: 'off', label: 'Off', effort: null };
  return levels.find((l) => l.id === (effort ?? model?.thinkingEffort) && l.effort)
    ?? levels.find((l) => l.id === model?.thinkingEffort)
    ?? { id: 'on', label: 'On', effort: null };
}

// What to send the chat template for thinking off, or on at an effort.
export function thinkingKwargs(model, thinking, effort) {
  if (!thinking) return { enable_thinking: false };
  const lv = thinkingLevel(model, true, effort);
  return { enable_thinking: true, ...(lv.effort ? { reasoning_effort: lv.effort } : {}) };
}

export const modelPath = (m) => join(MODELS_DIR, m.file);
