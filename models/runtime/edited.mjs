// The edited copy of a model: ONE slot per model, next to the original in
// ~/.agentic-coder/models, described by edited-<model>.json there. Each save
// rebuilds the copy from a fresh clone of the original plus the full edit
// list, so the manifest always says exactly what is in the file. The original
// and `coding setup`'s fingerprint check are never involved.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS, MODELS_DIR } from '../registry.mjs';

// The one manifest there was while only one model could be edited: still read
// (as its base model's slot), and replaced by that model's own file at its next save.
export const EDITED_MANIFEST = join(MODELS_DIR, 'edited.json');
export const editedManifest = (id) => join(MODELS_DIR, `edited-${id}.json`);

// The edited copy's file name, from its base model's.
export const editedFileName = (base) => base.file.replace(/\.gguf$/i, '-edited.gguf');

// A manifest file as it should be, or null: a listed model, an edit list, and the copy itself still there.
function manifestAt(file, id) {
  try {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    if (!MODELS[m.base] || !Array.isArray(m.edits) || (id && m.base !== id)) return null;
    if (!existsSync(join(MODELS_DIR, m.file))) return null;
    return m;
  } catch { return null; }
}

// Every edited copy on this Mac: { model id: its manifest }, in the model list's order.
export function readEditedAll() {
  const old = manifestAt(EDITED_MANIFEST);
  const all = {};
  for (const id of Object.keys(MODELS)) { const m = manifestAt(editedManifest(id), id) ?? (old?.base === id ? old : null); if (m) all[id] = m; }
  return all;
}

// One model's manifest, or null when it has no copy. With no model named: the
// one saved last (what "the edited copy" meant while there was one slot).
export function readEdited(id) {
  const all = readEditedAll();
  if (id) return all[id] ?? null;
  return Object.values(all).sort((a, b) => String(b.saved).localeCompare(String(a.saved)))[0] ?? null;
}

export function writeEdited(m) {
  writeFileSync(editedManifest(m.base), JSON.stringify(m, null, 2));
  // the older single manifest, when it was this model's: this file takes its place
  try { if (JSON.parse(readFileSync(EDITED_MANIFEST, 'utf8')).base === m.base) rmSync(EDITED_MANIFEST, { force: true }); } catch { /* none, or not this model's */ }
}

// Deletes one model's copy and its manifest (with no model named: the one saved
// last). The original is untouched, and so is every other model's copy.
export function removeEdited(id) {
  const m = readEdited(id);
  if (!m) return null;
  rmSync(editedManifest(m.base), { force: true });
  try { if (JSON.parse(readFileSync(EDITED_MANIFEST, 'utf8')).base === m.base) rmSync(EDITED_MANIFEST, { force: true }); } catch { /* none, or not this model's */ }
  rmSync(join(MODELS_DIR, m.file), { force: true });
  return m;
}

// A model's "· edited" entry, built from its base — null without a copy.
// Everything about running it (context, helper, slots) comes from the base;
// only the file, the name and the edit list differ.
function entry(m) {
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
export function editedModel(id) {
  const m = readEdited(id);
  return m ? entry(m) : null;
}
// Every edited copy as a model entry, in the model list's order: /model lists them after the models.
export const editedModels = () => Object.values(readEditedAll()).map(entry);

// A model by id: the registered ones, or an edited copy.
export function modelById(id) {
  if (!id) return null;
  if (MODELS[id]) return MODELS[id];
  return editedModels().find((e) => e.id === id) ?? null;
}
