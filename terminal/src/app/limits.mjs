// /increase: the limits you can move up and down, in one place. Each has the
// steps it moves through, its default, how it reads, and what a value costs
// (said next to it in the panel). Saved as "limits" in settings.json; only the
// ones moved off their default are kept, so a new default reaches you.
import { needBytes, hasDraft } from '../../../models/index.mjs';

const k = (v) => `${Math.round(v / 1024)}k`;
const mins = (s) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);
const pct = (v) => `${Math.round(v * 100)}%`;
// Measured on this Mac for Gemma (28 Sep): reading ~130 tokens/s, writing ~13.
const READ_TPS = 130;
const WRITE_TPS = 13;

export const LIMITS = [
  {
    id: 'context', label: 'Context', restart: true,
    // 0 = auto: 32k, or 16k when memory is short (chooseContext).
    steps: (m) => [0, 16384, 32768, 65536, 131072, 262144].filter((v) => !v || v <= (m.maxCtx ?? 32768)),
    def: () => 0,
    show: (v) => (v ? k(v) : 'auto'),
    note: (v, e) => {
      if (!v) return '32k, or 16k when memory is short';
      // With the speed helper when it comes along, as the start checks (a test says which).
      const need = needBytes(e.model, v, { draft: e.draft ?? hasDraft(e.model) }) / 1e9;
      const free = e.freeBytes != null ? e.freeBytes / 1e9 : null;
      const short = free != null && need > free;
      return `${short ? '⚠ ' : ''}needs ${need.toFixed(1)} GB${free != null ? ` of ${free.toFixed(1)} free` : ''} · a full re-read ~${mins((v * 0.78) / (e.pps || READ_TPS))}`;
    },
  },
  {
    id: 'thinking', label: 'Thinking cap', restart: true,
    steps: () => [1024, 2048, 4096, 8192],
    def: (m) => m.thinkingBudget ?? 2048,
    show: (v) => `${v.toLocaleString()} tokens`,
    note: (v, e) => {
      const ctx = e.values.context || e.ctxNow || 16384;
      if (2048 + v > ctx * 0.5) return `⚠ too big for a ${k(ctx)} context: raise Context first`;
      return `up to ~${mins(v / (e.tps || WRITE_TPS))} per think (High only)`;
    },
  },
  {
    id: 'tries', label: 'Tries per fix',
    steps: () => [2, 4, 8, 12, 16],
    def: () => 8,
    show: (v) => String(v),
    note: () => 'each try ~20 s on Low, up to a few min on High',
  },
  {
    id: 'steps', label: 'Steps per request',
    steps: () => [20, 40, 60, 80, 120],
    def: () => 40,
    show: (v) => String(v),
    note: (v) => `stops a request after ${v} tool steps`,
  },
  {
    id: 'outputLines', label: 'Command output',
    steps: () => [40, 80, 160, 320],
    def: () => 80,
    show: (v) => `${v} lines`,
    note: (v) => `the first ${v / 2} and last ${v / 2} lines of each command`,
  },
  {
    id: 'timeoutSecs', label: 'Command timeout',
    steps: () => [60, 120, 300, 600],
    def: () => 120,
    show: (v) => mins(v),
    note: () => 'a command still running then is stopped',
  },
  {
    id: 'trimAt', label: 'Trim at',
    steps: () => [0.6, 0.7, 0.78, 0.85],
    def: () => 0.78,
    show: pct,
    note: () => 'of the context: old tool output is dropped',
  },
  {
    id: 'summarizeAt', label: 'Summarize at',
    steps: () => [0.8, 0.85, 0.9],
    def: () => 0.85,
    show: pct,
    note: () => 'of the context, with the next reply: the chat is summarized',
  },
];
const byId = Object.fromEntries(LIMITS.map((l) => [l.id, l]));

export function defaultLimits(model) {
  return Object.fromEntries(LIMITS.map((l) => [l.id, l.def(model)]));
}

// The values in use: the defaults, with what settings.json holds on top.
// A value that is not a number (or is out of range) is left out.
export function readLimits(settings, model) {
  const out = defaultLimits(model);
  const saved = settings?.limits ?? {};
  for (const l of LIMITS) {
    const v = saved[l.id];
    const steps = l.steps(model);
    if (typeof v === 'number' && Number.isFinite(v) && v >= steps[0] && v <= steps.at(-1)) out[l.id] = v;
  }
  if (out.trimAt >= out.summarizeAt) { out.trimAt = defaultLimits(model).trimAt; out.summarizeAt = defaultLimits(model).summarizeAt; }
  return out;
}

// What goes into settings.json: only the limits moved off their default.
export function limitsToSave(values, model) {
  const d = defaultLimits(model);
  return Object.fromEntries(LIMITS.filter((l) => values[l.id] !== d[l.id]).map((l) => [l.id, values[l.id]]));
}

// One step down (dir -1) or up (+1). A value between steps (typed into
// settings.json by hand) goes to the next step that way. Trim stays below
// Summarize.
export function moveLimit(values, id, dir, model) {
  const l = byId[id];
  const steps = l.steps(model);
  const v = values[id];
  const next = dir > 0 ? steps.find((s) => s > v) : [...steps].reverse().find((s) => s < v);
  if (next === undefined) return values;
  const out = { ...values, [id]: next };
  if (id === 'trimAt' && out.trimAt >= out.summarizeAt) return values;
  if (id === 'summarizeAt' && out.trimAt >= out.summarizeAt) return values;
  return out;
}

export const showLimit = (id, v) => byId[id].show(v);
export const limitNote = (id, env) => byId[id].note(env.values[id], env);
export const isDefault = (id, values, model) => values[id] === byId[id].def(model);

// What changed between two sets of values, for the note after a save.
export function limitChanges(before, after) {
  return LIMITS.filter((l) => before[l.id] !== after[l.id]).map((l) => ({ id: l.id, label: l.label, from: l.show(before[l.id]), to: l.show(after[l.id]), restart: !!l.restart }));
}

// The model with its thinking cap moved: the server's --reasoning-budget,
// the flows' token room and the agent's reply room all read thinkingBudget.
// `model` is always the registry's (its budget is the default); the copy goes
// to the agent and the server only.
export function modelWithLimits(model, values) {
  const want = values?.thinking;
  if (!want || want === model.thinkingBudget) return model;
  return { ...model, thinkingBudget: want };
}

// The limits the agent reads while it works (they take effect at once).
export function applyLimits(agent, values) {
  agent.maxTries = values.tries;
  agent.maxSteps = values.steps;
  agent.trimAt = values.trimAt;
  agent.fullAt = values.summarizeAt;
  agent.bash = { maxLines: values.outputLines, timeoutMs: values.timeoutSecs * 1000 };
  agent.testTimeoutMs = values.timeoutSecs * 1000; // the flows' test runs
}
