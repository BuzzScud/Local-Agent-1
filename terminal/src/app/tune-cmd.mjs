// /tune in the window (27 Oct 2026, the owner: "can u add a command to tune bonsai?"): the panel, the model's own
// instructions and its Test. Each takes the window (`self`, as slash-model.mjs has it): /tune and its keys
// (keys-pickers.mjs) call them, so the App lists none of them.
import { sourceOf, TUNE_TESTS } from '../../../models/index.mjs';
import { ownOf, cleanNotes, modelWithLimits, NOTES_MAX } from './limits.mjs';
import { lineTuneTest, presetWord } from './tune-test.mjs';

// The model in use, tuned in one panel: on an Ollama service its own settings with /tune's rows (panels-effort.mjs
// openOwnSettings, tune); anywhere else /effort, which is what there is to tune.
export function openTune(self) {
  if (!self.onService()) {
    self.push({ type: 'note', text: `/tune’s own rows (Preset, Top-p, Top-k, Thinking time, its instructions) are for a model on an Ollama service. ${self.model.remote ? self.model.remote.label : self.model.name} has Effort and limits: /effort, open now.`, tone: 'dim' });
    self.openEffortLimits();
    return;
  }
  self.openOwnSettings({ id: self.model.remote.model }, { tune: true });
}

// /tune notes <text>: the model in use's own instructions (kept by model with its rows: "tuned"), the last part
// of the working instructions from its next message; off (or none) takes them out.
export function saveTuneNotes(self, text) {
  if (!self.onService()) { self.push({ type: 'note', text: 'A model’s own instructions are for a model on an Ollama service; for every model, /instructions has the working instructions.', tone: 'dim' }); return; }
  const name = self.model.remote.model;
  const notes = /^(off|none|clear|remove)$/i.test(String(text ?? '').trim()) ? '' : cleanNotes(text);
  const prev = ownOf(self.settings, name);
  if ((prev?.notes ?? '') === notes) { self.push({ type: 'note', text: notes ? `${name}’s own instructions are already those.` : `${name} has no instructions of its own: /tune notes <what it should do> gives it some.`, tone: 'dim' }); return; }
  const own = { ...(prev ?? {}) };
  if (notes) own.notes = notes; else delete own.notes;
  self.setOwn(name, Object.keys(own).length ? own : null);
  const { notes: _n, ...rest } = self.limitsRef.current;
  self.limitsRef.current = notes || rest.toolsOff ? { ...rest, ...(notes ? { notes } : {}), notesOf: name } : rest;
  self.agent.model = modelWithLimits(self.model, self.limitsRef.current);
  const cut = String(text ?? '').trim().length > NOTES_MAX ? ` (cut to ${NOTES_MAX} characters)` : '';
  self.push({ type: 'note', text: notes ? `Saved ${name}’s own instructions${cut}: from its next message, the last part of its working instructions. /tune shows them; /tune notes off takes them out.` : `${name}’s own instructions taken out, from its next message.`, tone: 'dim' });
}

// /tune's Test (t in the panel, /tune test): the model in use with the settings it has now (tune-test.mjs). The
// Arena page opens on it. The run is the Arena runner's: it goes on when this window closes.
export async function startTuneTest(self) {
  if (!self.onService()) { self.push({ type: 'note', text: '/tune’s Test runs a model on an Ollama service; for this one, /test picks a test in the Arena.', tone: 'dim' }); return; }
  const name = self.model.remote.model;
  const v = self.limitsRef.current;
  const think = Boolean(self.agent.thinking);
  try { await lineTuneTest({ source: sourceOf(self.settings.remote), model: name, values: v, ctx: self.serviceCtx(), think }); } catch (e) { self.push({ type: 'note', text: `The test did not start: ${e.message}.`, tone: 'warn' }); return; }
  const hub = self.openHub('arena');
  self.push({ type: 'note', text: `Testing ${name} with these settings (${presetWord(v)}, thinking ${think ? 'on' : 'off'}${v.notes ? ', its own instructions' : ''}): ${TUNE_TESTS.length} short Arena tasks, up to 10 min each, one after another${hub ? `; watch at ${hub.url}` : ''}. The score goes in the test record (/tests). The service takes this window’s requests and the test’s side by side, so both may be slower meanwhile.`, tone: 'dim' });
}
