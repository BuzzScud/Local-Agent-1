// /tune's Test (27 Oct 2026), started from the window (tune-cmd.mjs startTuneTest) or the hub's Remote tab
// (remote-hub.mjs): a model on a service, with the settings it has, on the Arena's three short tasks (TUNE_TESTS,
// the runner's set "tune"), one after another in the Arena's line. Its rows go with the run (kept beside its line
// in the test record); its own instructions the run reads itself (run-one.mjs). The Arena runs a model of the
// service /remote is connected to; for another it answers why.
import { startBattle, TUNE_TESTS } from '../../../models/index.mjs';
import { OWN_ROWS, PRESETS } from './limits.mjs';

// The run's settings: the model's own rows as they are in use, and its Context on the service (0: the service's own).
const tuneSettings = (values, ctx = 0) => ({ ...Object.fromEntries(OWN_ROWS.map((id) => [id, values?.[id]]).filter(([, x]) => x !== undefined)), ...(ctx ? { context: ctx } : {}) });
export const presetWord = (values) => PRESETS[values?.preset]?.label ?? 'Custom';

// → { url, who, tests }: the Arena's address. Throws, in plain words, when the Arena turns it down.
export async function lineTuneTest({ source, model, values, ctx = 0, think = false }) {
  const who = `remote:${source}:${model}`;
  const settings = tuneSettings(values, ctx);
  const url = (await startBattle()).url;
  const name = `Tune · ${model} · ${presetWord(values)}`;
  const line = async (items) => {
    const r = await fetch(`${url}api/line`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, items }), signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `the Arena answered ${r.status}`);
    return j;
  };
  // An Arena runner started before /tune has no set "tune": the three tasks one by one there.
  await line([{ kind: 'set', id: 'tune', who, think, settings }])
    .catch((e) => (/no such set/.test(e.message) ? line(TUNE_TESTS.map((id) => ({ kind: 'test', id, who, think, settings }))) : Promise.reject(e)));
  return { url, who, tests: TUNE_TESTS.length };
}
