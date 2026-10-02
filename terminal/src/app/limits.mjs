// /effort (one panel): the effort and Who decides (agent/way.mjs), then the search's three rows
// (Embedder, Retriever, Reranker: agent/search.mjs), then the limits you can move up and
// down, in one place. Each row has the steps it moves through (numbers, or
// named choices for the search's rows), its default, how it reads, and what a
// value costs (said next to it in the panel). Saved as "limits" in
// settings.json; only the ones moved off their default are kept, so a new
// default reaches you.
import { needBytes, hasDraft, thinkingLevel, loadedBytesOf, searchBytes, EMBEDDERS, DEFAULT_EMBEDDER, RERANKERS, DEFAULT_RERANKER, Embedder, embedderReady, Reranker, rerankerReady } from '../../../models/index.mjs';
import { SEARCH } from '../agent/search.mjs';
import { rulesRoomFor, upFrontFor, CHARS_PER_TOKEN } from '../agent/room.mjs';
import { LOOK_STEPS, LOOK_BACKS, lookSecs, showLook } from '../agent/look.mjs';

const k = (v) => `${Math.round(v / 1024)}k`;
const mins = (s) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);
const pct = (v) => `${Math.round(v * 100)}%`;
// Measured on this Mac for Gemma (28 Sep): reading ~130 tokens/s, writing ~13.
const READ_TPS = 130;
const WRITE_TPS = 13;

const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

export const LIMITS = [
  // Who decides (agent/way.mjs, 30 Sep 2026): the app, as before, or the model, as in Claude
  // Code. Right under the Effort row, with no heading of its own (group 'Effort').
  {
    id: 'way', label: 'Who decides', group: 'Effort', choice: true,
    steps: () => ['app', 'model'],
    def: () => 'app',
    show: (v) => (v === 'model' ? 'Model' : 'App'),
    note: (v) => (v === 'model' ? 'it sorts, looks and saves for itself, like Claude Code · next-step, tests, stuck and said-done start on (/hooks)' : 'the app sorts, reads ahead and checks, as before'),
  },
  // The search (group 'Search', shown first): which models find what goes
  // along with a request. Measured 29 Sep (models/qwen3-reranker-0.6b/README.md).
  {
    id: 'embedder', label: 'Embedder', group: 'Search', choice: true,
    steps: () => ['off', ...Object.keys(EMBEDDERS)],
    def: () => (EMBEDDERS[SEARCH.embedder] ? SEARCH.embedder : 'off'),
    show: (v) => (v === 'off' ? 'Off' : EMBEDDERS[v]?.name ?? v),
    note: (v) => {
      if (v === 'off') return 'words only: the code search (Oracle) pauses';
      if (!embedderReady(EMBEDDERS[v])) return `⚠ not on this Mac: coding setup downloads it (${mb(EMBEDDERS[v].bytes)})`;
      return `finds pieces by meaning · ~${mb(loadedBytesOf(EMBEDDERS[v]))}`;
    },
  },
  {
    id: 'retriever', label: 'Retriever', group: 'Search', choice: true,
    steps: () => ['meaning', 'hybrid'],
    def: () => SEARCH.retriever,
    show: (v) => (v === 'hybrid' ? 'Hybrid' : 'Meaning'),
    note: (v, e) => {
      if (e.values.embedder === 'off') return 'by words while Embedder is Off';
      return v === 'hybrid' ? 'meaning + words, merged (RRF) · same results in the 29 Sep test' : 'by meaning alone';
    },
  },
  {
    id: 'reranker', label: 'Reranker', group: 'Search', choice: true,
    steps: () => ['off', ...Object.keys(RERANKERS)],
    def: () => SEARCH.reranker,
    show: (v) => (v === 'off' ? 'Off' : RERANKERS[v]?.short ?? RERANKERS[v]?.name ?? v),
    note: (v, e) => {
      if (v === 'off') return 'the search’s own order';
      const m = RERANKERS[v];
      if (!rerankerReady(m)) return `⚠ not on this Mac: coding setup downloads it (${mb(m.bytes)})`;
      const last = e.lastRerank ? ` · last ${(e.lastRerank.ms / 1000).toFixed(1)} s` : '';
      return `reads the best ${m.pool} with your request · ~2 s a search, ~${mb(loadedBytesOf(m))}${last}`;
    },
  },
  {
    id: 'context', label: 'Context', restart: true,
    // 0 = auto: 32k, or 16k when memory is short (chooseContext). On an Ollama service it is
    // each model's own (App.jsx keeps it by model): 8k up to the model's longest, auto the service's.
    steps: (m) => (m.remote?.ollama ? [0, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576] : [0, 16384, 32768, 65536, 131072, 262144]).filter((v) => !v || v <= (m.maxCtx ?? 32768)),
    def: () => 0,
    show: (v) => (v ? k(v) : 'auto'),
    note: (v, e) => {
      // A remote holds nothing of this Mac's memory: what this Mac would need says nothing there.
      if (e.model?.remote?.ollama) return v ? `${k(v)} on the service · ${e.model.remote.model} loads again at this size; the chat stays` : `the service's own${e.ctxNow ? ` · ${k(e.ctxNow)} now` : ''}`;
      if (e.model?.remote) return 'set where it runs: /remote’s Context row, or coding serve --ctx there';
      if (!v) return '32k, or 16k when memory is short';
      // With the speed helper when it comes along, as the start checks (a test says which).
      // The search models still to load count too, as the start's check counts them.
      const search = e.searchBytes ? e.searchBytes(e.values) / 1e9 : 0;
      const need = needBytes(e.model, v, { draft: e.draft ?? hasDraft(e.model) }) / 1e9 + search;
      const free = e.freeBytes != null ? e.freeBytes / 1e9 : null;
      const short = free != null && need > free;
      return `${short ? '⚠ ' : ''}needs ${need.toFixed(1)} GB${search ? ` (${search.toFixed(1)} search)` : ''}${free != null ? ` of ${free.toFixed(1)} free` : ''} · a full re-read ~${mins((v * 0.78) / (e.pps || READ_TPS))}`;
    },
  },
  {
    id: 'thinking', label: 'Thinking cap', restart: true,
    steps: () => [1024, 2048, 4096, 8192],
    def: (m) => m.thinkingBudget ?? 2048,
    show: (v) => `${v.toLocaleString()} tokens`,
    note: (v, e) => {
      const ctx = e.values.context || e.ctxNow || 16384;
      // The panel says so when Effort is Low: the cap is only used on High.
      const low = e.effortOn === false;
      if (!low && 2048 + v > ctx * 0.5) return `⚠ too big for a ${k(ctx)} context: raise Context first`;
      if (low) return 'High only: not used while Effort is Low';
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
    // 0 = auto: a share of the Context, never under 12,000 (room.mjs). Saved with the rest of the rules' reading:
    // a change reads your rules again once, before the next message.
    id: 'rulesRoom', label: 'Rules room',
    steps: () => [0, 6000, 9000, 12000, 18000, 36000, 72000],
    def: () => 0,
    show: (v) => (v ? `${v.toLocaleString()} chars` : 'auto'),
    note: (v, e) => {
      const room = v || rulesRoomFor(e.values.context || e.ctxNow || 32768);
      return `${v ? '' : `follows Context: ${room.toLocaleString()} chars · `}AGENTS.md / CLAUDE.md: ~${mins(room / CHARS_PER_TOKEN / READ_TPS)} to read at start, once`;
    },
  },
  {
    // 0 = auto: a share of the Context, 45,000 at 32k (room.mjs). What a question that names files reads whole before the first step.
    id: 'upFront', label: 'Up-front reading',
    steps: () => [0, 11000, 22000, 45000, 90000, 180000, 360000],
    def: () => 0,
    show: (v) => (v ? `${v.toLocaleString()} chars` : 'auto'),
    note: (v, e) => {
      const ctx = e.values.context || e.ctxNow || 32768;
      const room = v || upFrontFor(ctx);
      const big = room / CHARS_PER_TOKEN > ctx * 0.5;
      return `${big ? '⚠ over half the window: raise Context first · ' : ''}${v ? '' : `follows Context: ${room.toLocaleString()} chars · `}files a question names, up to ~${mins(room / CHARS_PER_TOKEN / READ_TPS)} of reading`;
    },
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
  {
    // Look first (agent/look.mjs): a minimum of searching and reading before the answer. Last, so
    // the rows above keep their places; auto follows Effort (Low none, Medium 15 s, High 30 s).
    id: 'look', label: 'Look first', choice: true,
    steps: () => LOOK_STEPS,
    def: () => 'auto',
    show: showLook,
    note: (v, e) => {
      const secs = lookSecs(v, { thinking: e.effortOn !== false, effort: e.effortLevel ?? null });
      const auto = v === 'auto' ? `follows Effort: ${secs ? `${secs} s` : 'none on Low'} · ` : '';
      if (!secs) return `${auto}answers as soon as it is ready`;
      return `${auto}searches and reads at least ${secs} s before it answers; sent back up to ${LOOK_BACKS}×`;
    },
  },
];
const byId = Object.fromEntries(LIMITS.map((l) => [l.id, l]));

// The Effort row's levels, read the way the panel and its save note say them.
// A level's note can name the thinking cap ("stopped at 4,096 tokens"); the
// cap moves in the same panel, so the number shown is the one in use.
export const effortNote = (level, cap) => (level?.note ?? '').replace(/[\d,]+ tokens/, `${(cap ?? 0).toLocaleString()} tokens`);
// The level a model starts on: what Reset all puts Effort back to.
export const defaultLevelId = (model) => thinkingLevel(model, model.thinkingDefault ?? true, model.thinkingEffort).id;

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
    if (l.choice ? steps.includes(v) : typeof v === 'number' && Number.isFinite(v) && v >= steps[0] && v <= steps.at(-1)) out[l.id] = v;
  }
  if (out.trimAt >= out.summarizeAt) { out.trimAt = defaultLimits(model).trimAt; out.summarizeAt = defaultLimits(model).summarizeAt; }
  return out;
}

// ---------- The Tests page's control panel (its Run tab) ----------
// A run started there uses the tests' defaults (the app's, except Context: the tests run at 32k,
// so results compare) with the rows you changed on top. The runner hands the changed rows to the
// run as AGENTIC_TEST_SETTINGS (JSON); the test runners, runHeadless and the test record read them.
export const TEST_CTX = 32768;
export const testDefaults = (model) => ({ ...defaultLimits(model), context: TEST_CTX });
// The changed rows a run was given, or null.
export function testSettings(env = process.env) {
  let v = null;
  try { v = JSON.parse(env.AGENTIC_TEST_SETTINGS || 'null'); } catch { return null; }
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? v : null;
}
// All the limits of such a run on `model`: the tests' defaults, the changed rows on top (a value out
// of a row's range is left at its default, as in settings.json). null when it was given none.
export function testLimits(model, settings = testSettings()) {
  if (!settings) return null;
  const out = readLimits({ limits: settings }, model);
  if (!out.context) out.context = TEST_CTX;
  return out;
}
// What the Run tab's panel shows for each model: /effort's rows with their steps, how each reads
// and what it costs (with `freeBytes` free for the run), the effort levels, and the tests' defaults.
// Context's note depends on the Search rows (their models sit beside it): one per embedder × reranker.
export function panelData(models, { freeBytes = null } = {}) {
  const out = {};
  for (const model of models) {
    const defs = testDefaults(model);
    const env = (values) => ({ model, values, freeBytes, effortOn: true, searchBytes: (v) => searchBytes([EMBEDDERS[v.embedder], RERANKERS[v.reranker]].filter(Boolean), () => false) });
    const pairs = ['off', ...Object.keys(EMBEDDERS)].flatMap((em) => ['off', ...Object.keys(RERANKERS)].map((rr) => [em, rr]));
    const rows = LIMITS.map((l) => ({ id: l.id, label: l.label, group: l.group ?? 'Limits', def: defs[l.id],
      steps: l.steps(model).filter((v) => !(l.id === 'context' && v === 0)).map((v) => ({ v, show: showLimit(l.id, v), note: limitNote(l.id, env({ ...defs, [l.id]: v })),
        ...(l.id === 'context' ? { bySearch: Object.fromEntries(pairs.map(([em, rr]) => [`${em}|${rr}`, limitNote('context', env({ ...defs, context: v, embedder: em, reranker: rr }))])) } : {}) })) }));
    const levels = (model.thinkingLevels ?? []).map((lv) => ({ id: lv.id, show: lv.label ?? lv.id, note: effortNote(lv, defs.thinking) }));
    out[model.id] = { rows, levels, defs };
  }
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
  // A named choice moves along its list; a number to the next step that way.
  const next = l.choice ? steps[steps.indexOf(v) + dir] : dir > 0 ? steps.find((s) => s > v) : [...steps].reverse().find((s) => s < v);
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

// The search's rows (they take effect with the next message; no restart): the
// embedder and the reranker are servers of their own, started at their first
// use. Embedder Off takes it away from every search (they go by words, and
// the code search pauses); back on, one is made again where the memory or
// the code search uses it. A reranker turned off
// is stopped, to hand its memory back. A model not on this Mac is left off.
// → a note to show when a row could not take effect, else null.
//   make, ready: how a model is made and whether its files are here (tests pass their own).
export function applySearch(agent, values, { make = { embedder: (m) => new Embedder(m), reranker: (m) => new Reranker(m) }, ready = { embedder: embedderReady, reranker: rerankerReady } } = {}) {
  const e = values.embedder;
  if (e === 'off' || !EMBEDDERS[e]) {
    if (agent.embedder || agent.ranker || agent.memory?.embedder) {
      agent.embedder = null;
      agent.ranker = null;
      if (agent.memory) agent.memory.embedder = null;
      agent.codeIndex = null;
    }
  } else if (!agent.embedder && (agent.memory || agent.helpers?.has?.('rag')) && ready.embedder(EMBEDDERS[e])) {
    // Only where one is used (the memory, or the code search), as at start:
    // with both off, the focused paths keep choosing their file by words.
    const made = make.embedder(EMBEDDERS[e]);
    agent.embedder = made;
    agent.ranker = made;
    if (agent.memory) agent.memory.embedder = made;
    agent.codeIndex = null;
  }
  agent.search = { ...(agent.search ?? {}), retriever: values.retriever ?? SEARCH.retriever };
  const r = values.reranker;
  if (!r || r === 'off' || !RERANKERS[r]) {
    agent.reranker?.stop({ keep: false }).catch(() => {});
    agent.reranker = null;
    return null;
  }
  if (agent.reranker?.model?.id === r) return null;
  agent.reranker?.stop({ keep: false }).catch(() => {});
  agent.reranker = null;
  if (!ready.reranker(RERANKERS[r])) return `${RERANKERS[r].name} is not on this Mac yet, so the reranker stays off: run coding setup (${mb(RERANKERS[r].bytes)}), then save it again in /effort.`;
  agent.reranker = make.reranker(RERANKERS[r]);
  return null;
}

// The search models these values turn on, as applySearch picks them: the
// embedder only where one is used (the memory, or the code search), the
// reranker when it is on; each only when its file is on this Mac.
export function searchModels(agent, values) {
  const e = EMBEDDERS[values.embedder], r = RERANKERS[values.reranker];
  return [
    values.embedder !== 'off' && e && (agent.memory || agent.helpers?.has?.('rag')) && embedderReady(e) ? e : null,
    values.reranker !== 'off' && r && rerankerReady(r) ? r : null,
  ].filter(Boolean);
}

// The limits the agent reads while it works (they take effect at once).
export function applyLimits(agent, values) {
  agent.maxTries = values.tries;
  agent.maxSteps = values.steps;
  agent.trimAt = values.trimAt;
  agent.fullAt = values.summarizeAt;
  agent.bash = { maxLines: values.outputLines, timeoutMs: values.timeoutSecs * 1000 };
  agent.testTimeoutMs = values.timeoutSecs * 1000; // the flows' test runs
  agent.rulesRoom = values.rulesRoom;
  agent.upFront = values.upFront;
  agent.look = values.look; // Look first: from the next message
  agent.syncRules?.(); // a new Rules room reads the rules again once
  // Who decides: from the next message (the prompt and the tools change with it).
  if (values.way) agent.setWay?.(values.way);
}
