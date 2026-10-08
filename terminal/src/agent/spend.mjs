// The cost meter (/remote): what this window's requests to a paid service cost, and today's total
// over every window. Each window keeps one small file a day, spend/<day>/<pid>.json, so the total
// adds up the windows you closed too, and no two windows ever write the same file.
// The price: the service's own figure for the answer (OpenRouter's usage.cost), else its price
// list (the model list's pricing, the Claude models' prices), dollars a million tokens. A service
// of your own (Ollama, llama.cpp, an address on your network) is free and counts nothing; one
// whose price is not known counts the tokens sent and back instead.
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, CLAUDE_HOST } from '../../../models/index.mjs';

export const spendEvents = new EventEmitter();
const spendDir = () => join(process.env.AGENTIC_HOME ?? HOME, 'spend');
// Today as YYYY-MM-DD, in this Mac's own time.
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Dollars for one answer: null when its price is not known.
// usage: { prompt_tokens, completion_tokens, cached_tokens?, cache_write_tokens?, cost? }; price: { in, out } $ a million.
// Read from the prompt cache costs a tenth; written to it (the Claude API's cache_creation_input_tokens) a
// quarter more than plain input. Until 7 Oct 2026 a write was counted as plain input, so the meter read low.
export function costOf(usage, price) {
  if (!usage) return null;
  if (Number.isFinite(usage.cost)) return usage.cost;
  if (!price) return null;
  const all = usage.prompt_tokens ?? 0;
  const cached = Math.min(usage.cached_tokens ?? 0, all);
  const written = Math.min(usage.cache_write_tokens ?? 0, all - cached);
  return ((all - cached - written) * price.in + cached * price.in * 0.1 + written * price.in * 1.25 + (usage.completion_tokens ?? 0) * price.out) / 1e6;
}

// This window since it opened: dollars, and the tokens of answers whose price is not known.
const mine = { usd: 0, tokensIn: 0, tokensOut: 0, unpriced: 0, requests: 0 };
export const windowSpend = () => ({ ...mine });

// One answer from a remote: counted, written to today's file, and told to the screen.
// ep: the remote's endpoint (models remote.mjs: price, free). Returns its dollars (null: not known; 0: free).
// (A save handed over by a window that closed counts under that window: AGENTIC_SPEND_PID, autosave.mjs.)
export function recordSpend(ep, usage, { dir = spendDir(), pid = process.env.AGENTIC_SPEND_PID ?? process.pid, now = new Date() } = {}) {
  if (!ep?.remote || !usage) return null;
  if (ep.free && !Number.isFinite(usage.cost)) return 0;
  const usd = costOf(usage, ep.price);
  mine.requests++;
  if (usd == null) { mine.unpriced++; mine.tokensIn += usage.prompt_tokens ?? 0; mine.tokensOut += usage.completion_tokens ?? 0; }
  else mine.usd += usd;
  try {
    const day = join(dir, dayOf(now));
    mkdirSync(day, { recursive: true });
    const file = join(day, `${pid}.json`);
    let kept = {};
    try { kept = JSON.parse(readFileSync(file, 'utf8')); } catch {}
    // Each service's own dollars too (byService), and the Claude API's whatever its address (byKind), so
    // /usage counts only the Claude API's against its cap. A file from before keeps its one service's.
    const label = ep.label ?? null;
    const by = { ...(kept.byService ?? (kept.service && kept.usd ? { [kept.service]: kept.usd } : {})) };
    const kinds = { ...(kept.byKind ?? (kept.service === CLAUDE_HOST && kept.usd ? { claude: kept.usd } : {})) };
    if (label && usd) by[label] = (by[label] ?? 0) + usd;
    if (ep.kind && usd) kinds[ep.kind] = (kinds[ep.kind] ?? 0) + usd;
    const next = {
      usd: (kept.usd ?? 0) + (usd ?? 0),
      tokensIn: (kept.tokensIn ?? 0) + (usd == null ? usage.prompt_tokens ?? 0 : 0),
      tokensOut: (kept.tokensOut ?? 0) + (usd == null ? usage.completion_tokens ?? 0 : 0),
      service: label, byService: by, byKind: kinds, updated: now.toISOString(),
    };
    writeFileSync(`${file}.tmp`, JSON.stringify(next));
    renameSync(`${file}.tmp`, file);
  } catch { /* the meter only shows less */ }
  spendEvents.emit('change', { usd });
  return usd;
}

// Today over every window: { usd, windows } (windows: those that spent anything today).
export function todaySpend({ dir = spendDir(), now = new Date() } = {}) {
  const day = join(dir, dayOf(now));
  let usd = 0, windows = 0;
  let files = [];
  try { files = readdirSync(day).filter((f) => f.endsWith('.json')); } catch {}
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(day, f), 'utf8'));
      if ((j.usd ?? 0) > 0 || (j.tokensIn ?? 0) > 0) windows++;
      usd += j.usd ?? 0;
    } catch {}
  }
  return { usd, windows };
}

// One day's dollars over every window: { usd, windows }, of one kind of service (byKind: 'claude') or one
// service by its label. A file from before byKind and byService (7 Oct 2026) counts whole when its one
// service is that one (the Claude API's: api.anthropic.com).
export function daySpend(day, { kind = null, service = kind === 'claude' ? CLAUDE_HOST : null } = {}, { dir = spendDir() } = {}) {
  let usd = 0, windows = 0;
  let files = [];
  try { files = readdirSync(join(dir, day)).filter((f) => f.endsWith('.json')); } catch {}
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(join(dir, day, f), 'utf8'));
      const v = kind && j.byKind ? j.byKind[kind] ?? 0 : !kind && j.byService ? j.byService[service] ?? 0 : j.service === service ? j.usd ?? 0 : 0;
      if (v > 0) { usd += v; windows++; }
    } catch {}
  }
  return { usd, windows };
}

// Dollars as the footer shows them: cents, or to a tenth of a cent below a cent.
export const money = (usd) => (usd > 0 && usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);
const kTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

// The footer's words: "$0.03 this window · $0.31 today, 3 windows"; tokens when the price is not
// known; '' before anything was spent (and always on a free service).
export function spendLabel(win = windowSpend(), today = todaySpend()) {
  if (win.usd > 0) return `${money(win.usd)} this window · ${money(today.usd)} today${today.windows > 1 ? `, ${today.windows} windows` : ''}`;
  if (win.unpriced) return `${kTok(win.tokensIn)} sent · ${kTok(win.tokensOut)} back`;
  return '';
}
