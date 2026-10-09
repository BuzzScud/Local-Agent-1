// The Claude API's usage, for /usage and the bar under the footer (8 Oct 2026, the owner's pick
// "1 · Fuel line" from docs/private/design rounds/agentic-coder-usage-2-designs-2026-10-08.html):
// what is left of the month's spend cap, today's dollars, and the limits each minute.
//   - The limits come with every reply (the anthropic-ratelimit-* headers; a free call such as a
//     token count carries none). Each reply's are kept in <home>/usage/claude.json, by model, so
//     every window shows the newest.
//   - The cap is the limit you set in the Console when you give it (/usage limit 200, or l in the card;
//     no API tells it: the Spend Limits API is Claude Enterprise's), else the tier's, told from those limits
//     (Start $500, Build $1,000, Scale $200,000 a month: Anthropic's rate-limit page, Oct 2026).
//   - The month's spend (9 Oct 2026, the owner: "ensure that the api $ left is updated in real time and is
//     true"), the best there is: Anthropic's own bill (cost_report, with an Admin key; about 5 minutes
//     behind, read once a minute) or the Console's figure typed once (/usage spent 112.40, or s), each with
//     this Mac's answers after it added at once (spend.mjs claudeSince); else the cost meter (spend.mjs):
//     the Claude API's dollars of this Mac's windows only.
//   - At the cap Anthropic answers 429 with error_code enforced_spend_limit_reached and no
//     retry-after (a limit of your own: 400 "You have reached your specified API usage limits").
//     It is said plainly and not tried again, and the bar says paused until the 1st (UTC).
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HOME, CLAUDE_MODELS, claudeName, claudeClient, claudeCaps, readKey, saveKey, removeKey } from '../../../models/index.mjs';
import { daySpend, dayOf, windowSpend, recordSpend, claudeSince } from './spend.mjs';

export const usageEvents = new EventEmitter();
export const usageDir = () => join(process.env.AGENTIC_HOME ?? HOME, 'usage');
const readJson = (name) => { try { return JSON.parse(readFileSync(join(usageDir(), name), 'utf8')) ?? {}; } catch { return {}; } };
function writeJson(name, all) {
  try {
    const f = join(usageDir(), name);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(all));
    renameSync(`${f}.${process.pid}.tmp`, f);
  } catch { /* /usage only shows less */ }
  usageEvents.emit('change');
}
const readAll = () => readJson('claude.json');
const writeAll = (all) => writeJson('claude.json', all);

// Anthropic's month: from 00:00 UTC on the 1st ("2026-10").
export const monthOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 7);
const monthStart = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

// Yours, for every window (<home>/usage/claude-own.json): limit, the dollars a month you set in the Console;
// spent, the Console's figure for this month as you typed it ({ usd, at, month }). null takes one out.
export const readOwn = () => readJson('claude-own.json');
export function setOwn(patch) {
  const next = { ...readOwn(), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v == null) delete next[k];
  writeJson('claude-own.json', next);
  return next;
}
// "$200", "200", "1,000.50" → dollars, or null; "off" / "none" → 0 (take it out).
export function dollarsOf(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (/^(off|none|clear|reset)$/.test(t)) return 0;
  const v = Number(t.replace(/[$,\s]/g, ''));
  return Number.isFinite(v) && v >= 0 && /\d/.test(t) ? Math.round(v * 100) / 100 : null;
}

// Anthropic's own bill (the Usage & Cost Admin API's cost_report): the month's dollars so far over the
// whole organization, every Mac and app on it, about 5 minutes behind. It needs an Admin key (sk-ant-admin…,
// made in the Console under Settings → Admin keys; an individual account has none), kept in the Keychain
// beside the API key. One window reads it at most once a minute (Anthropic's advice) and every window
// reads the answer from <home>/usage/claude-bill.json: { month, usd, at, tried, error }.
const ADMIN_KEY_ID = 'claude-admin';
export const adminKey = () => process.env.ANTHROPIC_ADMIN_KEY || readKey(ADMIN_KEY_ID);
export const saveAdminKey = (key) => (key ? saveKey(key, ADMIN_KEY_ID, 'Agentic Coder Claude Admin key') : removeKey(ADMIN_KEY_ID));
export const readBill = () => readJson('claude-bill.json');
export const clearBill = () => writeJson('claude-bill.json', {});
const BILL_EVERY_MS = 60_000;
const adminUrl = () => process.env.AGENTIC_ADMIN_URL || 'https://api.anthropic.com';
export async function fetchBill({ key = adminKey(), now = Date.now(), force = false, fetchFn = fetch } = {}) {
  if (!key) return null;
  const old = readBill();
  if (!force && old.tried && now - old.tried < BILL_EVERY_MS - 5000) return old;
  writeJson('claude-bill.json', { ...old, tried: now });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    let cents = 0, page = null;
    do {
      const q = new URLSearchParams({ starting_at: new Date(monthStart(now)).toISOString(), limit: '31' });
      if (page) q.set('page', page);
      const r = await fetchFn(`${adminUrl()}/v1/organizations/cost_report?${q}`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? `HTTP ${r.status}`), { status: r.status });
      for (const b of j.data ?? []) for (const x of b.results ?? []) cents += Number(x.amount) || 0;
      page = j.has_more ? j.next_page : null;
    } while (page);
    const bill = { month: monthOf(now), usd: cents / 100, at: now, tried: now };
    writeJson('claude-bill.json', bill);
    return bill;
  } catch (e) {
    const bill = { ...old, tried: now, error: { status: e.status ?? null, message: String(e.name === 'AbortError' ? 'no answer in 20 s' : e.message ?? e).slice(0, 200), at: now } };
    writeJson('claude-bill.json', bill);
    return bill;
  } finally { clearTimeout(timer); }
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

// Everything /usage and the footer show, as of `now`. model: the window's Claude model.
//   cap: your limit, else the tier's (tierCap); left: null with neither (a Custom tier has no cap)
//   spent: the month's dollars, from source { kind: 'bill' | 'typed' | 'meter', at, usd, error }:
//   Anthropic's bill or your typed figure, whichever is newer, plus this Mac's answers since; else the meter
//   days: this Mac's dollars by day so far; last14: the last 14 days'; pace: dollars a day since
//   the first day with any, and the day the cap runs out at that pace (null when it does not); low: under a tenth left
//   limits: the newest reply's for this model (null before the first); capped: stopped at the cap
//   admin: an Admin key is kept (the caller knows: reading the Keychain is a process)
export function usageNow({ model, now = Date.now(), admin = false } = {}) {
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
  const meter = spent;
  const own = readOwn();
  const bill = readBill();
  const month = monthOf(now);
  // A bill counts while an Admin key reads it, or for 15 minutes after (another window took the key out).
  const billed = bill.month === month && Number.isFinite(bill.usd) && bill.at && (admin || now - bill.at < 15 * 60_000) ? bill : null;
  const typed = own.spent?.month === month && Number.isFinite(own.spent.usd) ? own.spent : null;
  const base = billed && (!typed || billed.at >= typed.at) ? { kind: 'bill', usd: billed.usd, at: billed.at } : typed ? { kind: 'typed', usd: typed.usd, at: typed.at } : null;
  const source = base ? { ...base, since: claudeSince(base.at, { now: d }) } : { kind: 'meter' };
  if (base) spent = base.usd + source.since;
  if (bill.error && admin) source.error = bill.error;
  const tierCap = tier?.cap ?? null;
  const cap = own.limit > 0 ? own.limit : tierCap;
  const left = cap == null ? null : Math.max(0, cap - spent);
  const perDay = spent > 0 ? spent / (today - (first || 1) + 1) : 0;
  const resetsOn = resetOf(now);
  const runsOut = left != null && perDay > 0 ? new Date(y, m, today + Math.ceil(left / perDay)).getTime() : null;
  return {
    model, modelName: claudeName(model), cap, tierCap, ownLimit: own.limit > 0 ? own.limit : null, tier: tier?.name ?? null,
    spent, meter, source, admin, left, low: cap != null && left < cap * 0.1,
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
