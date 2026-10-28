// The helpers panel (28 Oct 2026, the owner's pick of two live designs, "2 · Helper panel"): over the prompt while a
// helper (the Agent tool) or a side job runs, one row each, its model, its step or what it does, and its time; then
// the memory the service's loaded models take. Fed by the agent's 'helper' and 'side-job' events (app-run.mjs) and,
// on an Ollama service, its /api/ps (models ollamaLoaded). Drawn by helpers-panel.jsx.

// A finished row stays this long, so its ✓ is seen.
export const KEEP_DONE_MS = 6000;

// The list after one event: a row by its id, replaced as it changes.
export function withHelper(list, ev, now = Date.now()) {
  const rest = (list ?? []).filter((h) => h.id !== ev.id);
  return [...rest, { ...ev, ...(ev.done ? { doneAt: now } : {}) }];
}
// The rows still shown: the running ones, and the finished ones for KEEP_DONE_MS.
export const shownHelpers = (list, now = Date.now()) => (list ?? []).filter((h) => !h.done || now - (h.doneAt ?? now) < KEEP_DONE_MS);

const secsOf = (h, now) => Math.max(0, Math.round(h.done && h.secs != null ? h.secs : (now - (h.started ?? now)) / 1000));
const gb = (bytes) => (bytes / 1e9).toFixed(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// What the panel shows: { title, rows: [{ mark, running, kind, model, what, secs }], memory }, or null with nothing to show.
export function helperRows(list, { loaded = null, now = Date.now() } = {}) {
  const shown = shownHelpers(list, now);
  if (!shown.length) return null;
  const rows = shown.map((h) => {
    const failed = h.done && h.reason && !['done', 'answered'].includes(h.reason);
    const what = h.what
      ? `${h.what} · ${h.done ? 'saved' : 'writing'}`
      : h.done ? `${failed ? `stopped: ${h.reason}` : 'done'} · ${plural(h.steps ?? 0, 'step')}` : `step ${h.steps ?? 0} · ${h.last || 'starting'}`;
    return { mark: !h.done ? '●' : failed ? '✗' : '✓', running: !h.done, kind: h.kind ?? 'Helper', model: h.model ?? '', what, secs: secsOf(h, now) };
  });
  const helpers = shown.filter((h) => !h.what).length;
  const sides = shown.length - helpers;
  const title = ['Helpers', helpers ? plural(helpers, 'helper') : '', sides ? plural(sides, 'side job') : '', helpers && rows.some((r, i) => r.running && !shown[i].what) ? 'the conversation waits for the report' : ''].filter(Boolean).join(' · ');
  const memory = loaded?.length ? `Memory ${gb(loaded.reduce((n, m) => n + (m.size ?? 0), 0))} GB · ${loaded.map((m) => `${m.name} ${gb(m.size ?? 0)}`).join(' · ')}` : null;
  return { title, rows, memory };
}
