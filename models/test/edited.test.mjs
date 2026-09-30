// The edited copies of the models (models/runtime/edited.mjs): one per model, each with
// its own manifest, and the older single manifest still read. The copies and manifests
// live in the models folder, so this runs in its own process with its own temp home:
// it must never see the real one.
import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function inHome(body) {
  const home = mkdtempSync(join(tmpdir(), 'agentic-edited-'));
  const script = `
    import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
    import { join } from 'node:path';
    const E = await import(${JSON.stringify(join(import.meta.dir, '..', 'runtime', 'edited.mjs'))});
    const { MODELS, MODELS_DIR, HOME } = await import(${JSON.stringify(join(import.meta.dir, '..', 'registry.mjs'))});
    if (HOME !== ${JSON.stringify(home)}) throw new Error('not the temp home: ' + HOME);
    mkdirSync(MODELS_DIR, { recursive: true });
    const put = (f, text = 'x') => writeFileSync(join(MODELS_DIR, f), text);
    const files = () => readdirSync(MODELS_DIR).sort();
    const out = {};
    ${body}
    console.log(JSON.stringify(out));
  `;
  const r = spawnSync('bun', ['-e', script], { env: { ...process.env, AGENTIC_HOME: home }, encoding: 'utf8', timeout: 30000 });
  return JSON.parse(r.stdout.trim().split('\n').pop() || (() => { throw new Error(r.stderr); })());
}
const G = 'gemma-4-12B-it-qat-UD-Q4_K_XL', Q = 'Qwen3.5-9B-MTP-UD-Q5_K_XL';

test('each model keeps its own edited copy: saved, listed after the models, found by id, and removed one at a time', () => {
  const out = inHome(`
    out.empty = [E.readEdited(), E.readEdited('gemma'), E.readEditedAll(), E.editedModel(), E.editedModels(), E.modelById('gemma-edited'), E.removeEdited('qwen')];
    put(E.editedFileName(MODELS.qwen), 'qwen copy'); E.writeEdited({ base: 'qwen', file: E.editedFileName(MODELS.qwen), saved: '2026-09-30T10:00:00.000Z', edits: [{ op: 'scale', tensor: 't', row: 1, k: 2 }] });
    put(E.editedFileName(MODELS.gemma), 'gemma copy!'); E.writeEdited({ base: 'gemma', file: E.editedFileName(MODELS.gemma), saved: '2026-09-30T11:00:00.000Z', edits: [{ op: 'scale', tensor: 't', row: 1, k: 2 }, { op: 'swap', tensor: 't', a: 0, b: 1 }] });
    out.files = files();
    out.all = Object.entries(E.readEditedAll()).map(([id, m]) => [id, m.base, m.edits.length]);
    out.newest = E.readEdited().base; // with no model named: the one saved last
    out.models = E.editedModels().map((m) => [m.id, m.name, m.file, m.bytes, m.edited.base, m.edited.edits.length, m.slots === MODELS[m.edited.base].slots]);
    out.one = [E.editedModel('qwen').id, E.editedModel('gemma').id, E.editedModel().id];
    out.byId = [E.modelById('qwen-edited').name, E.modelById('gemma').name, E.modelById('qwen').name, E.modelById('llama-edited'), E.modelById('')];
    out.removed = E.removeEdited('qwen').base; out.afterRemove = [files(), Object.keys(E.readEditedAll()), E.removeEdited('qwen')];
    E.removeEdited('gemma'); out.afterBoth = [files(), E.readEdited()];
  `);
  expect(out.empty).toEqual([null, null, {}, null, [], null, null]);
  expect(out.files).toEqual([`${Q}-edited.gguf`, 'edited-gemma.json', 'edited-qwen.json', `${G}-edited.gguf`].sort());
  expect(out.all).toEqual([['gemma', 'gemma', 2], ['qwen', 'qwen', 1]]); // the model list's order, not the order saved in
  expect(out.newest).toBe('gemma');
  expect(out.models).toEqual([['gemma-edited', 'Gemma 4 12B QAT · edited', `${G}-edited.gguf`, 11, 'gemma', 2, true], ['qwen-edited', 'Qwen3.5 9B · edited', `${Q}-edited.gguf`, 9, 'qwen', 1, true]]);
  expect(out.one).toEqual(['qwen-edited', 'gemma-edited', 'gemma-edited']);
  expect(out.byId).toEqual(['Qwen3.5 9B · edited', 'Gemma 4 12B QAT', 'Qwen3.5 9B', null, null]);
  expect(out.removed).toBe('qwen');
  expect(out.afterRemove).toEqual([['edited-gemma.json', `${G}-edited.gguf`].sort(), ['gemma'], null]); // the other model's copy is untouched
  expect(out.afterBoth).toEqual([[], null]);
});

test('the older single manifest is still read as its model\'s copy, and that model\'s next save takes its place', () => {
  const out = inHome(`
    put(E.editedFileName(MODELS.gemma)); writeFileSync(E.EDITED_MANIFEST, JSON.stringify({ base: 'gemma', file: E.editedFileName(MODELS.gemma), saved: '2026-09-26T14:32:00.000Z', edits: [{ op: 'scale', tensor: 't', row: 3, k: 0.5 }] }));
    out.old = [Object.keys(E.readEditedAll()), E.readEdited('gemma').saved, E.readEdited('qwen'), E.editedModels().map((m) => m.id)];
    put(E.editedFileName(MODELS.qwen)); E.writeEdited({ base: 'qwen', file: E.editedFileName(MODELS.qwen), saved: '2026-09-30T10:00:00.000Z', edits: [] });
    out.mixed = [files().filter((f) => f.endsWith('.json')), Object.keys(E.readEditedAll())]; // Qwen's save leaves Gemma's older manifest alone
    E.writeEdited({ base: 'gemma', file: E.editedFileName(MODELS.gemma), saved: '2026-09-30T12:00:00.000Z', edits: [] });
    out.replaced = [files().filter((f) => f.endsWith('.json')), E.readEdited('gemma').saved];
    // an older manifest is removed with its copy
    E.removeEdited('gemma'); E.removeEdited('qwen'); put(E.editedFileName(MODELS.gemma)); writeFileSync(E.EDITED_MANIFEST, JSON.stringify({ base: 'gemma', file: E.editedFileName(MODELS.gemma), saved: 's', edits: [] }));
    out.removedOld = [E.removeEdited('gemma').base, files()];
    // a manifest whose copy is gone, one for a model not in the list, and one that is not JSON: no copy
    writeFileSync(E.editedManifest('qwen'), JSON.stringify({ base: 'qwen', file: 'gone.gguf', saved: 's', edits: [] }));
    writeFileSync(E.EDITED_MANIFEST, JSON.stringify({ base: 'llama', file: 'gone.gguf', saved: 's', edits: [] }));
    writeFileSync(E.editedManifest('gemma'), 'not json');
    out.bad = [E.readEditedAll(), E.readEdited(), E.editedModels()];
    // a manifest put under another model's name is not that model's copy
    put('stray.gguf'); writeFileSync(E.editedManifest('qwen'), JSON.stringify({ base: 'gemma', file: 'stray.gguf', saved: 's', edits: [] }));
    out.misnamed = Object.keys(E.readEditedAll());
  `);
  expect(out.old).toEqual([['gemma'], '2026-09-26T14:32:00.000Z', null, ['gemma-edited']]);
  expect(out.mixed).toEqual([['edited-qwen.json', 'edited.json'], ['gemma', 'qwen']]);
  expect(out.replaced).toEqual([['edited-gemma.json', 'edited-qwen.json'], '2026-09-30T12:00:00.000Z']);
  expect(out.removedOld).toEqual(['gemma', []]);
  expect(out.bad).toEqual([{}, null, []]);
  expect(out.misnamed).toEqual([]);
});
