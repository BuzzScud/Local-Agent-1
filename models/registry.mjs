// The models Bonsai Code can run (one folder each), and where their files
// live on this Mac (~/.bonsai-code).
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = process.env.BONSAI_HOME ?? join(homedir(), '.bonsai-code');
// The model server: Prism ML's llama.cpp built from source with our Metal patch
// (models/runtime/engine: it checks 2-8 guessed words in one pass). Each build
// has its own folder, so a new one never replaces the one in use.
export const ENGINE = { tag: 'prism-adfffbe-pq2mc1', commit: 'adfffbe41b2cabcd51fff326ab045662265062bb' };
export const SERVER_BIN = join(HOME, 'engine', ENGINE.tag, 'llama-server');
export const MODELS_DIR = join(HOME, 'models');
export const LOG_DIR = join(HOME, 'logs');
export const SLOT_DIR = join(HOME, 'slots'); // saved warm-ups (models/runtime/warmup.mjs)
export const DEFAULT_PORT = 17600;

// One entry per model folder. To add a model: make models/<name>/model.mjs
// (copy this model's as a start), import it here, and add it to the list.
import bonsai2_27b from './bonsai-2-27b/model.mjs';

const ALL = [bonsai2_27b];
export const MODELS = Object.fromEntries(ALL.map((m) => [m.id, m]));

export const DEFAULT_MODEL = '27b';

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
export function thinkingKwargs(model, thinking, effort) {
  if (!thinking) return { enable_thinking: false };
  const lv = thinkingLevel(model, true, effort);
  return { enable_thinking: true, ...(lv.effort ? { reasoning_effort: lv.effort } : {}) };
}

export const modelPath = (m) => join(MODELS_DIR, m.file);
// The model's guessing helper (speculative decoding), when it has one.
export const draftPath = (m) => (m?.draft ? join(MODELS_DIR, m.draft.file) : null);

// This model's folder in the repo: its README, reports/ and results/.
export const modelFolder = (m) => new URL(`./${m.folder}/`, import.meta.url).pathname;
