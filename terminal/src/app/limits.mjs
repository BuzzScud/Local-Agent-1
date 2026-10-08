// /effort (one panel): the effort and Who decides (agent/way.mjs), then the search's three rows
// (Embedder, Retriever, Reranker: agent/search.mjs), then the limits you can move up and
// down, in one place. Each row has the steps it moves through (numbers, or
// named choices for the search's rows), its default, how it reads, and what a
// value costs (said next to it in the panel). Saved as "limits" in
// settings.json; only the ones moved off their default are kept, so a new
// default reaches you.
import { needBytes, hasDraft, thinkingLevel, loadedBytesOf, searchBytes, EMBEDDERS, RERANKERS, Embedder, embedderReady, Reranker, rerankerReady } from '../../../models/index.mjs';
import { SEARCH } from '../agent/search.mjs';
import { rulesRoomFor, upFrontFor, CHARS_PER_TOKEN, SERVICE_REPLY } from '../agent/room.mjs';
import { LOOK_STEPS, LOOK_BACKS, lookSecs, showLook } from '../agent/look.mjs';

const k = (v) => `${Math.round(v / 1024)}k`;
const mins = (s) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`);
const pct = (v) => `${Math.round(v * 100)}%`;
// Measured on this Mac for Gemma (28 Sep): reading ~130 tokens/s, writing ~13.
const READ_TPS = 130;
const WRITE_TPS = 13;

const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

// Qwen3.6 on an Ollama service starts on its maker's values for precise coding (temperature 0.6, presence
// penalty 0), not the service's own (its Modelfile: 1 and 1.5, the maker's for general chat). 8 Oct 2026, on
// 1 and 1.5: five Writes in six came with only "path", the plan's steps came under "value", and Bash came as
// a JSON list. Steering it off words it just used works against a tool call, which repeats its tags and names.
// Not measured yet. A value picked in /model or /effort still wins.
const qwenCoding = (m) => Boolean(m?.remote?.ollama) && /^qwen3\.6(:|$)/i.test(String(m?.remote?.model ?? ''));

export const LIMITS = [
  // Who decides (agent/way.mjs, 30 Sep 2026): the app, as before, or the model, as in Claude
  // Code. Right under the Effort row, with no heading of its own (group 'Effort').
  {
    id: 'way', label: 'Who decides', group: 'Effort', choice: true,
    steps: () => ['app', 'model'],
    // A big model on a service (big-model mode) decides for itself, as Claude Code does; the rest as before.
    def: (m) => m?.harness?.way ?? 'app',
    show: (v) => (v === 'model' ? 'Model' : 'App'),
    note: (v) => (v === 'model' ? 'it sorts, looks and saves for itself, like Claude Code · six checks start on (/hooks)' : 'the app sorts, reads ahead and checks, as before'),
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
      // (switching: /model's menu for a model not in use yet, which loads at it as you switch.)
      if (e.model?.remote?.ollama) return v ? `${k(v)} on the service · ${e.model.remote.model} ${e.switching ? 'loads at this size as you switch' : 'loads again at this size; the chat stays'}` : `the service's own${e.ctxNow ? ` · ${k(e.ctxNow)} ${e.switching ? 'loaded now' : 'now'}` : ''}`;
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
  // The model on an Ollama service (2 Oct 2026, the user's ask: "add limits to the model we load"):
  // sent with each request, kept by model (OWN_ROWS), shown only on a service (shownLimits).
  {
    // num_predict: Ollama's only stop for a reply, thinking and answer together. auto: up to
    // SERVICE_REPLY (32k; it was 2,048, too little for a file). Never more than the context has left.
    id: 'replyTokens', label: 'Reply length', model: true,
    steps: (m) => [0, 4096, 8192, 16384, 32768, 65536].filter((v) => !v || v <= (m.maxCtx ?? 32768)),
    def: () => 0,
    show: (v) => (v ? `${k(v)} tokens` : 'auto'),
    note: (v, e) => {
      const ctx = e.values.context || e.ctxNow || 32768;
      return `${v > ctx / 2 ? '⚠ over half the context: raise Context first · ' : ''}up to ${k(v || SERVICE_REPLY)} a reply, thinking and answer together, never past the context`;
    },
  },
  {
    id: 'temperature', label: 'Temperature', model: true, choice: true,
    steps: () => ['own', 0, 0.2, 0.4, 0.6, 0.7, 1],
    def: (m) => (qwenCoding(m) ? 0.6 : 'own'),
    show: (v) => (v === 'own' ? 'its own' : String(v)),
    note: (v) => (v === 'own' ? 'the model’s own on the service' : v <= 0.2 ? 'steadier: much the same answer each time' : 'more varied: other wordings and ideas'),
  },
  {
    id: 'presence', label: 'Presence penalty', model: true, choice: true,
    steps: () => ['own', 0, 0.5, 1, 1.5, 2],
    def: (m) => (qwenCoding(m) ? 0 : 'own'),
    show: (v) => (v === 'own' ? 'its own' : String(v)),
    note: (v) => (v === 'own' ? 'the model’s own · raise it if it repeats itself or loops' : v === 0 ? 'off: words it has used are not held against it · raise it if it loops' : 'steers it off words it has used · too high and it drifts'),
  },
  {
    // keep_alive: how long the service keeps it loaded after a request (open: while this window is open,
    // asked again every few minutes, so it goes 15 min at most after the window does: OPEN_KEEP).
    id: 'keepLoaded', label: 'Keep loaded', model: true, choice: true,
    steps: () => [300, 1800, 'open'],
    def: () => 'open',
    show: (v) => (v === 'open' ? 'while open' : mins(v)),
    note: (v) => (v === 'open' ? 'on the service while this window is open: every reply starts at once' : `let go after ${mins(v)} without a request; the next reply waits while it loads`),
  },
  {
    id: 'tries', label: 'Tries per fix',
    steps: () => [2, 4, 8, 12, 16],
    def: (m) => m?.harness?.tries ?? 8,
    show: (v) => String(v),
    note: () => 'each try ~20 s on Low, up to a few min on High',
  },
  {
    // 0 = no limit: only on the Claude API, and its default (8 Oct 2026, the owner's ask: "remove the
    // step limit for claude api"); a request runs until it is done, or esc stops it. Saved 0 fits only
    // there (readLimits: in range of the row's steps), so a local model keeps its count.
    id: 'steps', label: 'Steps per request',
    steps: (m) => (m?.remote?.kind === 'claude' ? [0, 20, 40, 60, 80, 120] : [20, 40, 60, 80, 120]),
    def: (m) => (m?.remote?.kind === 'claude' ? 0 : m?.harness?.steps ?? 40),
    show: (v) => (v ? String(v) : 'no limit'),
    note: (v) => (v ? `stops a request after ${v} tool steps` : 'runs until the request is done; esc stops it'),
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
    def: (m) => m?.harness?.outputLines ?? 80,
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
      // (On a service the Effort row is Thinking: Off · On…)
      const auto = v === 'auto' ? (e.effortWord === 'Thinking' ? `follows Thinking: ${secs ? `${secs} s` : 'none while it is off'} · ` : `follows Effort: ${secs ? `${secs} s` : 'none on Low'} · `) : '';
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

// A model on an Ollama service keeps its own settings (/model's menu, the user's pick 2 Oct 2026):
// its Effort and these rows, kept by model in the service's set-up ("tuned", beside "contexts",
// which holds its Context). The rest (Who decides, the search's, this Mac's Context and Thinking
// cap) every model shares. A row it has not set follows the shared value, as before.
export const OWN_ROWS = ['replyTokens', 'temperature', 'presence', 'keepLoaded', 'tries', 'steps', 'rulesRoom', 'upFront', 'outputLines', 'timeoutSecs', 'trimAt', 'summarizeAt', 'look'];
// { level, limits } kept for a remote model (by the name the service knows it by), or null.
export const ownOf = (settings, name) => (name ? settings?.remote?.tuned?.[name] ?? null : null);

// The values in use: the defaults, with what settings.json holds on top, and a
// remote model's own rows on top of that (own: false leaves them out: what it
// would have without them). A value that is not a number (or is out of range) is left out.
export function readLimits(settings, model, { own = true } = {}) {
  const out = defaultLimits(model);
  const fits = (l, v) => {
    const steps = l.steps(model);
    return l.choice ? steps.includes(v) : typeof v === 'number' && Number.isFinite(v) && v >= steps[0] && v <= steps.at(-1);
  };
  const saved = settings?.limits ?? {};
  for (const l of LIMITS) if (fits(l, saved[l.id])) out[l.id] = saved[l.id];
  const mine = own ? ownOf(settings, model?.remote?.model)?.limits ?? {} : {};
  for (const l of LIMITS) if (OWN_ROWS.includes(l.id) && fits(l, mine[l.id])) out[l.id] = mine[l.id];
  if (out.trimAt >= out.summarizeAt) { out.trimAt = defaultLimits(model).trimAt; out.summarizeAt = defaultLimits(model).summarizeAt; }
  return out;
}

// The rows /effort shows for a model. On an Ollama service the Thinking cap is left out: Ollama has
// no thinking limit (Reply length holds the thinking there; the panel says so in its place); and so
// are the search's rows (the user's ask, 2 Oct 2026: the service's models have their own: /subagents
// gives one the code search). This Mac's search stays as saved, in /effort on This Mac. The model's
// own rows (Reply length, Temperature…) are only on a service.
// own: /model's menu for one model, its own rows only (and its Context).
export function shownLimits(model, { own = false } = {}) {
  const svc = Boolean(model?.remote?.ollama);
  return LIMITS.filter((l) => (svc ? !(l.id === 'thinking' || l.group === 'Search') : !l.model) && (!own || l.id === 'context' || OWN_ROWS.includes(l.id)));
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
    const rows = LIMITS.filter((l) => !l.model).map((l) => ({ id: l.id, label: l.label, group: l.group ?? 'Limits', def: defs[l.id],
      steps: l.steps(model).filter((v) => !(l.id === 'context' && v === 0)).map((v) => ({ v, show: showLimit(l.id, v), note: limitNote(l.id, env({ ...defs, [l.id]: v })),
        ...(l.id === 'context' ? { bySearch: Object.fromEntries(pairs.map(([em, rr]) => [`${em}|${rr}`, limitNote('context', env({ ...defs, context: v, embedder: em, reranker: rr }))])) } : {}) })) }));
    const levels = (model.thinkingLevels ?? []).map((lv) => ({ id: lv.id, show: lv.label ?? lv.id, note: effortNote(lv, defs.thinking) }));
    out[model.id] = { rows, levels, defs };
  }
  return out;
}

// What goes into settings.json: only the limits moved off their default.
// keep: rows saved before that this save left alone. They stay saved even when
// they match this model's default, because a big model's defaults are not this
// Mac's (Steps 80 picked on Qwen is still 80 after a save on a big model).
export function limitsToSave(values, model, keep = {}) {
  const d = defaultLimits(model);
  return Object.fromEntries(LIMITS.filter((l) => values[l.id] !== d[l.id] || (keep[l.id] !== undefined && keep[l.id] === values[l.id])).map((l) => [l.id, values[l.id]]));
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
// A model on a service also takes its own Reply length (replyTokens: the agent's num_predict) and
// sampling (Temperature, Presence penalty) from here; 'own' leaves the service's.
export function modelWithLimits(model, values) {
  let out = model;
  const want = values?.thinking;
  if (want && want !== model.thinkingBudget) out = { ...out, thinkingBudget: want };
  const s = {};
  if (typeof values?.temperature === 'number') s.temperature = values.temperature;
  if (typeof values?.presence === 'number') s.presence_penalty = values.presence;
  if (Object.keys(s).length) out = { ...out, sampling: { ...out.sampling, ...s }, thinkingSampling: { ...out.thinkingSampling, ...s } };
  if (values?.replyTokens) out = { ...out, replyTokens: values.replyTokens };
  return out;
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
  agent.maxSteps = values.steps || Infinity; // 0: no limit (the Claude API)
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
