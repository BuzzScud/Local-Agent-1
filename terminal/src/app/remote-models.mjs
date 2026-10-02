// /model on an Ollama service (the design picked on 1 Oct 2026, "the service's
// list"): the service's own models, with what each can do. The loaded ones come
// first (they answer at once), then the ones that can run the agent (they call
// tools), each group a coder first, then the newest. The chat-only ones (no
// tools: no file reads, edits or commands; picking one asks first) fold into one
// row, and so do this Mac's models; the other saved services follow. Typing
// filters the service's models by name; ←→ is Effort, as in the other /model.
// The list itself is ollama.mjs's (models/); this file only lays it out.
import { remoteLevels, bigHarness, paramsB } from '../../../models/index.mjs';

// "262144" → "256k" (as the rest of the app writes a context), "10485760" → "10M".
export const ctxWord = (n) => (!n ? '' : n >= 1_048_576 ? `${Math.round(n / 1_048_576)}M` : `${Math.round(n / 1024)}k`);
export const gbWord = (bytes) => (bytes ? `${(bytes / 1e9).toFixed(1)} GB` : '');
// "36.0B" (a mixture of experts: "36.0B MoE"); "268.10M" → "268M".
export const sizeWord = (m) => `${/M$/i.test(m.params) ? `${Math.round(parseFloat(m.params))}M` : m.params}${/moe/i.test(m.family) && m.params ? ' MoE' : ''}`;
// What it can do, in the words of the list; '' when the service did not say.
export const canWord = (m) => (!m.known ? '' : [m.tools && 'tools', m.thinking && 'thinks', m.vision && 'images'].filter(Boolean).join(' · ') || '—');

// A coder first, then the newest (the service lists the newest first too), then by name.
const order = (a, b) => (/coder/i.test(b.id) - /coder/i.test(a.id)) || String(b.modified ?? '').localeCompare(String(a.modified ?? '')) || a.id.localeCompare(b.id);

// A helper, not a main model (/subagents gives each a job): one that only compares
// meanings (embeddings), one that sees pictures but calls no tools (llava,
// deepseek-ocr), and a tiny one under a billion parameters (functiongemma).
export const isHelper = (m) => Boolean(m.embedding || (m.known && m.vision && !m.tools) || (m.params && paramsB(m.params) < 1));

// The service's models in their groups: loaded (and able to run the agent),
// able to run the agent, chat only, helpers. Copies (the same weights under
// two names, or one model in several precisions) are one entry, its others in
// `copies` (copiesOf).
export function groupsOf(models = [], inUse = null) {
  const all = copiesOf(models, inUse);
  const chat = all.filter((m) => m.chat && !isHelper(m));
  const loaded = chat.filter((m) => m.tools && m.loaded).sort((a, b) => (b.id === inUse) - (a.id === inUse) || order(a, b));
  return { loaded, agent: chat.filter((m) => m.tools && !m.loaded).sort(order), chatOnly: chat.filter((m) => !m.tools).sort(order), helpers: all.filter(isHelper).sort((a, b) => paramsB(a.params) - paramsB(b.params)) };
}

// One entry per model: the same weights under two names (deepseek-coder-v2:latest
// and :16b) or one model in several precisions (laguna-xs-2.1 :latest, :bf16,
// :q8_0) show once, as the one in use, else the loaded one, else :latest, else the
// first; the others are its `copies` (←→ on the /remote list picks one).
export function copiesOf(models = [], inUse = null) {
  const base = (id) => id.split(':')[0].toLowerCase();
  const key = (m) => (m.sameAs?.length ? `d:${[m.id, ...m.sameAs].sort()[0]}` : `n:${base(m.id)}:${m.params || '?'}:${m.known ? m.family : '?'}`);
  const groups = new Map();
  for (const m of models) groups.set(key(m), [...(groups.get(key(m)) ?? []), m]);
  // Two sizes of one name (qwen2.5-coder 14b and 32b) differ in params, so they stay apart;
  // models whose size is not known are only joined when their tags are precisions.
  const precision = /^(latest|bf16|f16|fp16|q\d.*|iq\d.*|mxfp4|fp8)$/i;
  const out = [];
  for (const g of groups.values()) {
    const sure = g.length > 1 && (g[0].params || g.every((m) => precision.test(m.id.split(':')[1] ?? 'latest')));
    if (!sure) { out.push(...g.map((m) => ({ ...m, copies: [] }))); continue; }
    const head = g.find((m) => m.id === inUse) ?? g.find((m) => m.loaded) ?? g.find((m) => /:latest$/.test(m.id)) ?? g[0];
    out.push({ ...head, copies: g.filter((m) => m !== head).map((m) => m.id) });
  }
  return out;
}

// The model to suggest on a service whose list says what each can do: a tried one
// that passed first, then a coder, one loaded now, a big one (30B+), the newest.
// tried: { [id]: { ok } } (tryouts.mjs). null when none can run the agent.
export function suggestModel(models = [], tried = {}) {
  const g = groupsOf(models);
  const pool = [...g.loaded, ...g.agent];
  let best = null, bestS = -Infinity;
  pool.forEach((m, i) => {
    const t = tried[m.id];
    const s = (t ? (t.ok ? 20 : -50) : 0) + (/coder/i.test(m.id) ? 5 : 0) + (m.loaded ? 3 : 0) + (bigHarness(m) ? 2 : 0) - i / 100;
    if (s > bestS) { bestS = s; best = m.id; }
  });
  return best;
}

// The picker as it opens: on the model in use, no filter, the folds shut.
export function openService({ inUse, levelId, on }) {
  return { kind: 'service', at: inUse ? `m:${inUse}` : null, filter: '', open: { chat: false, mac: false, helpers: false }, levelId, on };
}

// The rows, top to bottom. sv: { catalog, inUse, mac (this Mac's models),
// services (other saved services, as /model rows), lastLocal (its name) }.
// A row with an id can be picked: m:<model>, fold:chat, fold:mac, local:<id>, svc:<source>.
export function serviceRows(pk, sv) {
  const rows = [];
  const gap = () => { if (rows.length) rows.push({ kind: 'blank' }); };
  const q = String(pk.filter ?? '').trim().toLowerCase();
  const fits = (m) => !q || m.id.toLowerCase().includes(q);
  const model = (m) => ({ kind: 'model', id: `m:${m.id}`, m });
  if (!sv.catalog) rows.push({ kind: 'note', text: 'Reading the service’s list…' });
  else {
    const g = groupsOf(sv.catalog.models, sv.inUse);
    const loaded = g.loaded.filter(fits), agent = g.agent.filter(fits), chatOnly = g.chatOnly.filter(fits);
    if (loaded.length) rows.push({ kind: 'head', text: 'Loaded on the service', note: 'answers at once' }, ...loaded.map(model));
    if (agent.length) { gap(); rows.push({ kind: 'head', text: 'Can run the agent', note: 'loads when you switch: the first reply may wait while it does' }, ...agent.map(model)); }
    // While filtering, the chat-only matches show at once; else they fold into one row.
    if (q && chatOnly.length) { gap(); rows.push({ kind: 'head', text: 'Chat only', note: 'no tools, so no file reads, edits or commands' }, ...chatOnly.map(model)); }
    if (q && !loaded.length && !agent.length && !chatOnly.length && !g.helpers.some(fits)) rows.push({ kind: 'note', text: `Nothing on the service has “${pk.filter.trim()}” in its name.` });
    if (!q && chatOnly.length) {
      gap();
      rows.push({ kind: 'fold', id: 'fold:chat', open: pk.open.chat, text: 'Chat only', note: `${chatOnly.length} on the service · no tools, so no file reads, edits or commands` });
      if (pk.open.chat) rows.push(...chatOnly.map(model));
    }
    // The helpers (pictures, search, tiny ones): not main models; /subagents gives them a job.
    const helpers = g.helpers.filter(fits);
    if (helpers.length) {
      if (rows.at(-1)?.kind !== 'fold' || q) gap();
      if (q) rows.push({ kind: 'head', text: 'Helpers', note: '/subagents gives them a job' }, ...helpers.map(model));
      else {
        rows.push({ kind: 'fold', id: 'fold:helpers', open: pk.open.helpers, text: 'Helpers', note: `${helpers.length} on the service · pictures, search, small jobs · /subagents gives them a job` });
        if (pk.open.helpers) rows.push(...helpers.map(model));
      }
    }
  }
  if (q) return rows;
  if (sv.mac?.length) {
    if (rows.at(-1)?.kind !== 'fold') gap();
    rows.push({ kind: 'fold', id: 'fold:mac', open: pk.open.mac, text: 'This Mac', note: `${sv.mac.length} model${sv.mac.length === 1 ? '' : 's'}${sv.lastLocal ? ` · ${sv.lastLocal} was in use last` : ''}` });
    if (pk.open.mac) rows.push(...sv.mac.map((m) => ({ kind: 'local', id: `local:${m.id}`, m })));
  }
  rows.push(...(sv.services ?? []).map((s) => ({ kind: 'service', id: `svc:${s.source}`, s })));
  return rows;
}

const pickable = (rows) => rows.filter((r) => r.id);
// The highlighted row: the one picked, else the first that can be.
export const atRow = (pk, rows) => rows.find((r) => r.id && r.id === pk.at) ?? pickable(rows)[0] ?? null;
// ↑↓: the row before or after, stopping at the ends (as the other /model does).
export function moveService(pk, rows, dir) {
  const ids = pickable(rows).map((r) => r.id);
  if (!ids.length) return pk;
  const i = ids.indexOf(atRow(pk, rows)?.id);
  return { ...pk, at: ids[Math.max(0, Math.min(ids.length - 1, i + dir))] };
}
// Typing (or backspace): the filter changes; the cursor stays on its model when
// that still matches, else goes to the first that does.
export function filterService(pk, sv, filter) {
  const next = { ...pk, filter };
  const rows = serviceRows(next, sv);
  return { ...next, at: rows.some((r) => r.id === pk.at) ? pk.at : pickable(rows).find((r) => r.kind === 'model')?.id ?? pickable(rows)[0]?.id ?? null };
}
// enter on a fold: open or shut it.
export const toggleFold = (pk, id) => ({ ...pk, open: { ...pk.open, [id.slice(5)]: !pk.open[id.slice(5)] } });

// The model whose effort levels the Effort row shows: the highlighted one's
// (remoteLevels: Low only when it cannot think), else the one in use.
export function levelModelOf(row, current) {
  if (row?.kind === 'model') return { thinkingLevels: remoteLevels(row.m), thinkingEffort: row.m.known && !row.m.thinking ? 'low' : 'high' };
  if (row?.kind === 'local') return row.m;
  return current;
}

// The line under the list about the highlighted model: why picking it asks
// first, when the chat will not fit it, or that it loads first. used: the chat's
// tokens now.
export function rowDetail(row, { inUse, used = 0 } = {}) {
  if (row?.kind !== 'model' || row.m.id === inUse) return null;
  const m = row.m;
  if (!m.tools) return { tone: 'warn', text: 'No tools: it can only answer in words (no file reads, edits or commands). Enter asks first.' };
  const room = m.loadedCtx || m.ctx;
  if (room && used > room * 0.85) return { tone: 'warn', text: `Its context is ${ctxWord(room)} and the chat is about ${ctxWord(used)}: the oldest part is summed up before the next reply.` };
  if (!m.loaded) return { tone: 'dim', text: `Not loaded yet: it loads as you switch${m.bytes ? ` (${gbWord(m.bytes)})` : ''}, so the first reply may wait.` };
  if (isBig(m)) return { tone: 'dim', text: bigWords(m) };
  return null;
}

// Big-model mode (models/runtime/remote.mjs): a model with 30B parameters or more
// that can call tools. /model marks it "big"; the line under the list says what that means.
export const isBig = (m) => Boolean(bigHarness(m));
export const bigWords = (m) => {
  const h = bigHarness(m);
  return `Big model: it reads ${h.read.whole} lines at a time, up to ${h.steps} steps and ${h.tries} tries a fix.`;
};
