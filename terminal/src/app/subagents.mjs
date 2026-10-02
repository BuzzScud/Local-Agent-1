// /subagents (2 Oct 2026, the user's ask and picks): the helper models on an Ollama
// service, one row per job. Each job is on or off and has its model; ←→ steps
// through the service's models that can do it, space switches it, enter loads it
// now. A helper loads the first time its job needs it (their pick), not as the
// window connects, so the main model keeps the most room. Saved in settings.json
// `subagents` by service address, so another service keeps its own.
//   pictures   looks at a picture when the main model cannot (llava, deepseek-ocr)
//   side       the small jobs: summaries, saved notes, /btw (llama3.2:3b)
//   search     the code search's meanings (embeddinggemma), in place of this Mac's
//   review     a second opinion on the plan and the finished change (gpt-oss:120b)
//   design     UI design, two halves (their pick "Both"): one model writes the page's
//              layout and styling, one that sees looks at a picture of it
// The jobs themselves run in the agent; this file is the list, the defaults and
// the panel's rows.
import { paramsB } from '../../../models/index.mjs';
import { copiesOf } from './remote-models.mjs';

// main: the main model may do the job itself ("same as main" heads its choices).
export const JOBS = [
  { id: 'pictures', label: 'Pictures', note: 'looks at a picture when your model cannot' },
  { id: 'side', label: 'Side jobs', note: 'summaries, saved notes, /btw', main: true },
  { id: 'search', label: 'Code search', note: 'finds the code closest to your request' },
  { id: 'review', label: 'Second opinion', note: 'checks the plan and the finished change' },
  { id: 'designWrite', label: 'UI design · writes', note: 'writes the layout and styling of a page', main: true },
  { id: 'designCheck', label: 'UI design · checks', note: 'looks at a picture of the page, lists what looks off' },
];
export const MAIN = 'main';

const B = (m) => paramsB(m.params);
const sees = (m) => m.known && m.chat && m.vision;
// The service's models that can do a job, the best first.
export function choicesFor(job, models = [], main = null) {
  const all = copiesOf(models).filter((m) => m.id !== main);
  const by = (f) => [...all].sort(f);
  let list;
  // a small one that only looks first; one made for reading text off a page (deepseek-ocr) after the others
  if (job === 'pictures') list = by((a, b) => (/ocr/i.test(a.id) - /ocr/i.test(b.id)) || (a.tools - b.tools) || B(a) - B(b)).filter(sees);
  else if (job === 'side') list = by((a, b) => B(a) - B(b)).filter((m) => m.chat && !m.embedding && m.known && B(m) >= 1 && B(m) <= 16);
  else if (job === 'search') list = by((a, b) => B(a) - B(b)).filter((m) => m.embedding);
  // one that thinks, the smallest of 30B or more first, so it fits beside the main model (the user's
  // pick, 2 Oct 2026: Qwen3.6 35B over gpt-oss 120b, which would unload the main model for each check)
  else if (job === 'review') list = by((a, b) => (b.thinking - a.thinking) || B(a) - B(b)).filter((m) => m.known && m.chat && !m.embedding && B(m) >= 30);
  else if (job === 'designWrite') list = by((a, b) => (/coder/i.test(b.id) - /coder/i.test(a.id)) || B(b) - B(a)).filter((m) => m.known && m.chat && m.tools && B(m) >= 7);
  else if (job === 'designCheck') list = by((a, b) => ((B(b) >= 20) - (B(a) >= 20)) || B(a) - B(b)).filter(sees); // the smallest big one that sees
  else list = [];
  const ids = list.map((m) => m.id);
  return JOBS.find((j) => j.id === job)?.main ? [MAIN, ...ids] : ids;
}

// The jobs as saved for this service, a job never set getting its default: on, with
// its first choice (the UI design writer: the main model itself).
export function jobsOf(saved = {}, models = [], main = null) {
  return JOBS.map((j) => {
    const choices = choicesFor(j.id, models, main);
    const s = saved[j.id] ?? {};
    const def = j.id === 'designWrite' ? MAIN : choices.find((c) => c !== MAIN) ?? choices[0] ?? null;
    const model = s.model && (s.model === MAIN || models.some((m) => m.id === s.model)) ? s.model : def;
    return { ...j, choices, model, on: s.on ?? Boolean(model), missing: Boolean(s.model && model !== s.model) };
  });
}

// What a row says on its right: loaded, loads when needed, off, or nothing on the service for it.
export function statusOf(job, models = [], main = null) {
  if (!job.model) return { text: 'nothing on the service can', tone: 'warn' };
  if (!job.on) return { text: 'off', tone: 'dim' };
  if (job.model === MAIN) return { text: `your model (${main ?? 'main'})`, tone: 'dim' };
  const m = models.find((x) => x.id === job.model);
  const gb = m?.bytes ? ` · ${(m.bytes / 1e9).toFixed(1)} GB` : '';
  return m?.loaded ? { text: `loaded${gb}`, tone: 'ok' } : { text: `loads when needed${gb}`, tone: 'dim' };
}

// The line under the rows: the main model and what is loaded on the service now.
// (Ollama does not say how much memory the service has in all, so the room left is
// not known; a helper that does not fit is loaded after the least-needed model is
// let go: "only me", their pick.)
export function roomLine(jobs, models = [], main = null) {
  const loaded = models.filter((m) => m.loaded);
  const now = loaded.reduce((n, m) => n + (m.bytes || 0), 0);
  return `Main: ${main ?? 'none'} · loaded on the service now: ${(now / 1e9).toFixed(1)} GB (${loaded.length} model${loaded.length === 1 ? '' : 's'})`;
}

// The panel as it opens, and its moves. pk: { kind: 'subagents', at, jobs }.
export const openSubagents = (jobs) => ({ kind: 'subagents', at: 0, jobs });
export const moveJob = (pk, dir) => ({ ...pk, at: Math.max(0, Math.min(pk.jobs.length - 1, pk.at + dir)) });
export function stepModel(pk, dir) {
  const j = pk.jobs[pk.at];
  if (!j?.choices.length) return pk;
  const i = Math.max(0, j.choices.indexOf(j.model));
  const next = j.choices[Math.max(0, Math.min(j.choices.length - 1, i + dir))];
  return { ...pk, jobs: pk.jobs.map((x, k) => (k === pk.at ? { ...x, model: next, on: true, missing: false } : x)) };
}
export const toggleJob = (pk) => ({ ...pk, jobs: pk.jobs.map((x, k) => (k === pk.at && x.model ? { ...x, on: !x.on } : x)) });
// What settings.json keeps for the service.
export const savedOf = (jobs) => Object.fromEntries(jobs.map((j) => [j.id, { on: j.on, model: j.model }]));
