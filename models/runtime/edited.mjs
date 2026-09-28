// The edited copy of a model: ONE slot, next to the original in
// ~/.agentic-coder/models, described by edited.json there. Each save rebuilds
// the copy from a fresh clone of the original plus the full edit list, so
// the manifest always says exactly what is in the file. The original and
// `bonsai setup`'s fingerprint check are never involved.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS, MODELS_DIR } from '../registry.mjs';

export const EDITED_MANIFEST = join(MODELS_DIR, 'edited.json');

// The edited copy's file name, from its base model's.
export const editedFileName = (base) => base.file.replace(/\.gguf$/i, '-edited.gguf');

// The manifest, or null when there is none or the copy itself is gone.
export function readEdited() {
  try {
    const m = JSON.parse(readFileSync(EDITED_MANIFEST, 'utf8'));
    if (!MODELS[m.base] || !Array.isArray(m.edits)) return null;
    if (!existsSync(join(MODELS_DIR, m.file))) return null;
    return m;
  } catch { return null; }
}

export function writeEdited(m) { writeFileSync(EDITED_MANIFEST, JSON.stringify(m, null, 2)); }

// Deletes the copy and its manifest. The original is untouched.
export function removeEdited() {
  const m = readEdited();
  rmSync(EDITED_MANIFEST, { force: true });
  if (m) rmSync(join(MODELS_DIR, m.file), { force: true });
  return m;
}

// The "27B · edited" model entry, built from its base — null without a copy.
// Everything about running it (context, helper, slots) comes from the base;
// only the file, the name and the edit list differ.
export function editedModel() {
  const m = readEdited();
  if (!m) return null;
  const base = MODELS[m.base];
  return {
    ...base,
    id: `${m.base}-edited`,
    name: `${base.name.replace(/^Bonsai \d+ /, '')} · edited`,
    file: m.file,
    bytes: statSync(join(MODELS_DIR, m.file)).size,
    edited: { base: m.base, saved: m.saved, edits: m.edits },
  };
}

// A model by id: the registered ones, or the edited copy.
export function modelById(id) {
  if (!id) return null;
  if (MODELS[id]) return MODELS[id];
  const e = editedModel();
  return e && e.id === id ? e : null;
}
