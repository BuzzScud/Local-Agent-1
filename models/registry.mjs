// The models Agentic Coder can run (one folder each), and where their files
// live on this Mac (~/.agentic-coder).
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The state folder: ~/.agentic-coder once it exists; until the migration
// runs, the old ~/.agentic-coder keeps working. AGENTIC_HOME overrides.
const NEW_HOME = join(homedir(), '.agentic-coder');
const OLD_HOME = join(homedir(), '.bonsai-code'); // the folder's name before the rename: used only while ~/.agentic-coder does not exist
export const HOME = (process.env.AGENTIC_HOME ?? process.env.BONSAI_HOME) ?? (existsSync(NEW_HOME) || !existsSync(OLD_HOME) ? NEW_HOME : OLD_HOME);
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
// models/bonsai-2-27b/ is kept as a recipe (settings, checksum, results) but
// is no longer listed: its file was removed on 28 Sep 2026 to free the disk.
// To bring it back: import it here, add it to ALL, run `coding setup`.
import gemma4_12b from './gemma-4-12b/model.mjs';

const ALL = [gemma4_12b];
export const MODELS = Object.fromEntries(ALL.map((m) => [m.id, m]));

export const DEFAULT_MODEL = 'gemma';

// The small models that write nothing and only compare meanings (one folder
// each, like the models above). The memory uses one to find the facts that
// fit a request.
import bgeM3 from './bge-m3/model.mjs';

export const EMBEDDERS = Object.fromEntries([bgeM3].map((m) => [m.id, m]));
export const DEFAULT_EMBEDDER = 'bge-m3';

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
