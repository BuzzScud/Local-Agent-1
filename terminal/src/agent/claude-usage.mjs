// The Claude API's usage, for /usage and the bar under the footer (8 Oct 2026, the owner's pick
// "1 · Fuel line" from docs/private/design rounds/agentic-coder-usage-2-designs-2026-10-08.html):
// what is left of the month's spend cap, today's dollars, and the limits each minute.
//   - The limits come with every reply (the anthropic-ratelimit-* headers; a free call such as a
//     token count carries none). Each reply's are kept in <home>/usage/claude.json, by model, so
//     every window shows the newest.
//   - The cap is the tier's, told from those limits (Start $500, Build $1,000, Scale $200,000 a
//     month: Anthropic's rate-limit page, Oct 2026). A lower limit set in the Console is not seen.
//   - The month is the cost meter's (spend.mjs): the Claude API's dollars only, every window.
//   - At the cap Anthropic answers 429 with error_code enforced_spend_limit_reached and no
//     retry-after (a limit of your own: 400 "You have reached your specified API usage limits").
//     It is said plainly and not tried again, and the bar says paused until the 1st (UTC).
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HOME, CLAUDE_MODELS, claudeName, claudeClient, claudeCaps } from '../../../models/index.mjs';
import { daySpend, dayOf, windowSpend, recordSpend } from './spend.mjs';

export const usageEvents = new EventEmitter();
const usageFile = () => join(process.env.AGENTIC_HOME ?? HOME, 'usage', 'claude.json');
const readAll = () => { try { return JSON.parse(readFileSync(usageFile(), 'utf8')) ?? {}; } catch { return {}; } };
function writeAll(all) {
  try {
    const f = usageFile();
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(all));
    renameSync(`${f}.${process.pid}.tmp`, f);
  } catch { /* /usage only shows less */ }
  usageEvents.emit('change');
}

// The header names, by the part they say: requests, input and output tokens a minute (and all
// tokens, the tightest limit in effect).
const PARTS = { requests: 'requests', input: 'input-tokens', output: 'output-tokens', tokens: 'tokens' };

// The limits a reply's headers carry ({ at, model, requests, input, output: { limit, remaining,
// reset } }), or null when they carry none. headers: a Headers object or a plain one.
export function limitsFrom(headers, model, now = Date.now()) {
  if (!headers) return null;
  const get = typeof headers.get === 'function' ? (k) => headers.get(k) : (k) => headers[k];
  const out = { at: now, model };
  for (const [part, h] of Object.entries(PARTS)) {
    const limit = Number(get(`anthropic-ratelimit-${h}-limit`));
    if (!(limit > 0)) { if (part === 'tokens') continue; return null; }
    const reset = Date.parse(get(`anthropic-ratelimit-${h}-reset`) ?? '');
    out[part] = { limit, remaining: Math.max(0, Number(get(`anthropic-ratelimit-${h}-remaining`)) || 0), reset: Number.isFinite(reset) ? reset : now };
  }
  return out;
}

// A reply's limits, kept for every window. A reply that came means the cap is not reached.
export function noteLimits(headers, model, now = Date.now()) {
  const r = limitsFrom(headers, model, now);
  if (!r) return null;
  const all = readAll();
  all.models = { ...(all.models ?? {}), [model]: r };
  all.last = model;
  delete all.capped;
  writeAll(all);
  return r;
}

// The month's reset: 00:00 UTC on the 1st of the next month (ms).
export function resetOf(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

// A request refused at the cap: { kind: 'tier' (the tier's cap) | 'own' (a limit set in the
// Console), message }, or null for any other error.
export function capOf(e) {
  const body = e?.error?.error ?? e?.error ?? {};
  const code = body?.details?.error_code ?? '';
  const msg = String(body?.message ?? e?.message ?? '');
  if (code === 'enforced_spend_limit_reached' || /monthly API usage threshold/i.test(msg)) return { kind: 'tier', message: msg };
  if (/reached your specified (workspace )?API usage limits/i.test(msg)) return { kind: 'own', message: msg };
  return null;
}
export function noteCapped(kind, now = Date.now()) {
  const all = readAll();
  all.capped = { kind, at: now, until: resetOf(now) };
  writeAll(all);
}

// The tiers by the requests a minute a reply says (Fable has its own numbers; Opus, Sonnet and
// Haiku 4.5 and later share the rest), and each one's monthly cap in dollars.
export const TIERS = [
  { name: 'Start', cap: 500, fable: 1000, other: 1000 },
  { name: 'Build', cap: 1000, fable: 2000, other: 5000 },
  { name: 'Scale', cap: 200_000, fable: 4000, other: 10_000 },
];
export function tierOf(model, requestsLimit) {
  const fable = /fable|mythos/.test(String(model ?? ''));
  return TIERS.find((t) => (fable ? t.fable : t.other) === requestsLimit) ?? null;
}

// Everything /usage and the bar show, as of `now`. model: the window's Claude model.
//   cap, tier, left: null on a tier not known (a Custom tier has no cap)
//   days: this month's dollars by day so far; last14: the last 14 days'; pace: dollars a day since
//   the first day with any, and the day the cap runs out at that pace (null when it does not)
//   limits: the newest reply's for this model (null before the first); capped: stopped at the cap
export function usageNow({ model, now = Date.now() } = {}) {
  const all = readAll();
  const limits = all.models?.[model] ?? null;
  const any = limits ?? (all.last ? all.models?.[all.last] ?? null : null);
  const tier = any ? tierOf(any.model, any.requests?.limit) : null;
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth(), today = d.getDate();
  const spentOn = (date) => daySpend(dayOf(date), { kind: 'claude' });
  const days = [];
  let spent = 0, first = 0;
  for (let n = 1; n <= today; n++) {
    const usd = spentOn(new Date(y, m, n)).usd;
    days.push(usd);
    spent += usd;
    if (usd > 0 && !first) first = n;
  }
  const last14 = [];
  for (let i = 13; i >= 0; i--) last14.push(i < today ? days[today - 1 - i] : spentOn(new Date(y, m, today - i)).usd);
  const cap = tier?.cap ?? null;
  const left = cap == null ? null : Math.max(0, cap - spent);
  const perDay = first ? spent / (today - first + 1) : 0;
  const resetsOn = resetOf(now);
  const runsOut = left != null && perDay > 0 ? new Date(y, m, today + Math.ceil(left / perDay)).getTime() : null;
  return {
    model, modelName: claudeName(model), cap, tier: tier?.name ?? null, spent, left,
    monthName: d.toLocaleString('en-US', { month: 'long' }), days, last14,
    today: spentOn(d), window: windowSpend().usd,
    pace: { perDay, runsOut, beforeReset: runsOut != null && runsOut < resetsOn },
    limits, resetsOn,
    capped: all.capped && all.capped.until > now ? all.capped : null,
  };
}

// r in /usage: one tiny request (a fraction of a cent) for the limits its answer carries. Its
// cost goes on the meter like any other answer's.
export async function askLimits({ url, ep, signal }) {
  const client = await claudeClient(url, ep.key);
  const model = ep.model;
  const stream = client.beta.messages.stream({ model, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], ...(claudeCaps(model).effort ? { output_config: { effort: 'low' } } : {}) }, { signal });
  const final = await stream.finalMessage();
  const u = final.usage ?? {};
  recordSpend({ ...ep, price: ep.price ?? CLAUDE_MODELS.find((x) => x.id === model)?.price }, { prompt_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), completion_tokens: u.output_tokens ?? 0, cached_tokens: u.cache_read_input_tokens ?? 0, cache_write_tokens: u.cache_creation_input_tokens ?? 0 });
  return noteLimits(stream.response?.headers, model);
}
