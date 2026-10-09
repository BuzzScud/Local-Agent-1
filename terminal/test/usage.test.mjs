// /usage and "$ left" in the footer on the Claude API (claude-usage.mjs, usage-bar.mjs, 8 Oct 2026; "3 · One row"
// and your own limit, 9 Oct 2026): the limits each reply carries, the month from the cost meter (the Claude API's
// dollars only), a figure typed from the Console or Anthropic's bill, against your limit or the tier's cap, the
// cap's stop said plainly and not tried again, and the card with the prompt box's ends. Against a stand-in
// Claude API: no key, no bill.
import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeAnthropic } from './fake-anthropic.mjs';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-usage-home-'));
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { limitsFrom, noteLimits, tierOf, capOf, noteCapped, usageNow, resetOf, setOwn, fetchBill, readBill, dollarsOf, monthOf } = await import('../src/agent/claude-usage.mjs');
const { recordSpend, daySpend, dayOf, costOf, claudeSince } = await import('../src/agent/spend.mjs');
const { usagePanel, usageChip, sourceWords, textOf, LABEL_W } = await import('../src/app/usage-bar.mjs');
const { streamChat } = await import('../src/agent/client.mjs');
const { setEndpoint, dropEndpoint, GENERIC_REMOTE, CLAUDE_HOST } = await import('../../models/index.mjs');
const { matchCommands } = await import('../src/app/commands.mjs');

// Each test in a home of its own (spend.mjs and claude-usage.mjs read AGENTIC_HOME at each use).
const base = process.env.AGENTIC_HOME;
let n = 0;
const freshHome = () => { const h = join(base, `usage-${++n}`); mkdirSync(h, { recursive: true }); process.env.AGENTIC_HOME = h; return h; };
afterEach(() => { process.env.AGENTIC_HOME = base; });

const OPUS = 'claude-opus-5-5';
const NOW = new Date(2026, 9, 8, 17, 30).getTime(); // 8 Oct 2026, 5:30 PM on this Mac
// The headers of the owner's real reply on 8 Oct (Opus 5.5, the Start tier); reset: when each is full again.
const startHeaders = (reset = '2026-10-08T21:26:18Z') => ({ 'anthropic-ratelimit-requests-limit': '1000', 'anthropic-ratelimit-requests-remaining': '999', 'anthropic-ratelimit-requests-reset': reset, 'anthropic-ratelimit-input-tokens-limit': '2000000', 'anthropic-ratelimit-input-tokens-remaining': '2000000', 'anthropic-ratelimit-input-tokens-reset': reset, 'anthropic-ratelimit-output-tokens-limit': '400000', 'anthropic-ratelimit-output-tokens-remaining': '400000', 'anthropic-ratelimit-output-tokens-reset': reset, 'anthropic-ratelimit-tokens-limit': '2400000', 'anthropic-ratelimit-tokens-remaining': '2400000', 'anthropic-ratelimit-tokens-reset': reset });
const START = startHeaders();
// One window's file for a day, as the cost meter writes it (spend/<day>/<pid>.json).
const spendFile = (home, date, pid, body) => { const d = join(home, 'spend', dayOf(date)); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${pid}.json`), JSON.stringify(body)); };

test('the limits come from a reply’s headers (a Headers object or a plain one); a call that carries none gives nothing', () => {
  const want = { at: 5, model: OPUS, requests: { limit: 1000, remaining: 999, reset: Date.parse('2026-10-08T21:26:18Z') }, input: { limit: 2_000_000, remaining: 2_000_000 }, output: { limit: 400_000, remaining: 400_000 } };
  expect(limitsFrom(new Headers(START), OPUS, 5)).toMatchObject(want);
  expect(limitsFrom(START, OPUS, 5)).toMatchObject(want);
  expect(limitsFrom(new Headers({ 'request-id': 'req_1', 'anthropic-organization-id': 'org' }), OPUS)).toBeNull();
  expect(limitsFrom(null, OPUS)).toBeNull();
});

test('the tier and its monthly cap, told from the requests a minute (Fable has its own numbers)', () => {
  expect(tierOf(OPUS, 1000)).toMatchObject({ name: 'Start', cap: 500 });
  expect(tierOf('claude-sonnet-5-5', 5000)).toMatchObject({ name: 'Build', cap: 1000 });
  expect(tierOf('claude-fable-5-1', 2000)).toMatchObject({ name: 'Build', cap: 1000 });
  expect(tierOf(OPUS, 10_000)).toMatchObject({ name: 'Scale', cap: 200_000 });
  expect(tierOf(OPUS, 123)).toBeNull(); // a Custom tier: no cap known
});

test('the cap’s answer is told from a rate limit: the tier’s (error_code), or one you set in the Console (a 400)', () => {
  const tier = { status: 429, error: { type: 'error', error: { type: 'rate_limit_error', message: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization\'s API tier. You will regain access on 2026-11-01 at 00:00 UTC.', details: { error_code: 'enforced_spend_limit_reached' } } } };
  expect(capOf(tier)).toMatchObject({ kind: 'tier' });
  expect(capOf({ status: 400, message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."}}' })).toMatchObject({ kind: 'own' });
  expect(capOf({ status: 429, error: { type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' } } })).toBeNull();
  expect(new Date(resetOf(NOW)).toISOString()).toBe('2026-11-01T00:00:00.000Z');
});

test('the cost meter keeps each service’s dollars and the Claude API’s at any address; a day counts only those, older files by their one service', () => {
  const home = freshHome();
  const claude = { remote: true, kind: 'claude', label: CLAUDE_HOST, price: { in: 4, out: 20 } };
  const proxy = { remote: true, kind: 'claude', label: '127.0.0.1:9999', price: { in: 4, out: 20 } };
  const other = { remote: true, kind: 'openai', label: 'openrouter.ai', price: { in: 1, out: 1 } };
  const now = new Date(NOW);
  recordSpend(claude, { prompt_tokens: 1_000_000, completion_tokens: 0 }, { now, pid: 1 });
  recordSpend(other, { prompt_tokens: 1_000_000, completion_tokens: 0 }, { now, pid: 1 });
  recordSpend(proxy, { prompt_tokens: 500_000, completion_tokens: 0 }, { now, pid: 4 }); // the Claude API at another address
  spendFile(home, now, 2, { usd: 3, service: CLAUDE_HOST }); // before byService (7 Oct)
  spendFile(home, now, 3, { usd: 9, service: 'openrouter.ai' });
  expect(daySpend(dayOf(now), { kind: 'claude' })).toEqual({ usd: 9, windows: 3 });
  expect(daySpend(dayOf(now), { service: CLAUDE_HOST })).toEqual({ usd: 7, windows: 2 });
  expect(daySpend(dayOf(now), { service: 'openrouter.ai' })).toEqual({ usd: 10, windows: 2 });
});

test('the month: the Claude API’s dollars against the Start tier’s $500, today, the pace and the day it runs out; nothing known before a reply', () => {
  const home = freshHome();
  spendFile(home, new Date(2026, 9, 7), 11, { usd: 9.85, service: CLAUDE_HOST });
  spendFile(home, new Date(2026, 9, 8), 12, { usd: 50, byService: { [CLAUDE_HOST]: 47.89, 'openrouter.ai': 2.11 }, byKind: { claude: 47.89, openai: 2.11 } });
  spendFile(home, new Date(2026, 9, 8), 13, { usd: 8.82, service: CLAUDE_HOST });
  const before = usageNow({ model: OPUS, now: NOW });
  expect(before).toMatchObject({ cap: null, left: null, tier: null, limits: null });
  expect(before.spent).toBeCloseTo(66.56, 2);
  noteLimits(new Headers(START), OPUS, NOW - 600_000);
  const u = usageNow({ model: OPUS, now: NOW });
  expect(u).toMatchObject({ cap: 500, tier: 'Start', monthName: 'October', modelName: 'Opus 5.5', today: { windows: 2 } });
  expect(u.left).toBeCloseTo(433.44, 2);
  expect(u.today.usd).toBeCloseTo(56.71, 2);
  expect(u.pace.perDay).toBeCloseTo(33.28, 2);
  expect(new Date(u.pace.runsOut).getDate()).toBe(22);
  expect(u.pace.beforeReset).toBe(true);
  expect(u.last14.slice(-2).map((x) => +x.toFixed(2))).toEqual([9.85, 56.71]);
  expect(u.limits.requests).toMatchObject({ limit: 1000, remaining: 999 });
  // another model in the same window: the tier is still known from the last reading
  expect(usageNow({ model: 'claude-sonnet-5-5', now: NOW })).toMatchObject({ cap: 500, limits: null });
});

test('stopped at the cap: paused until the 1st (UTC); the next reply that comes clears it', () => {
  freshHome();
  noteLimits(START, OPUS, NOW);
  noteCapped('tier', NOW);
  expect(usageNow({ model: OPUS, now: NOW }).capped).toMatchObject({ kind: 'tier', until: Date.parse('2026-11-01T00:00:00Z') });
  expect(textOf(usageChip(usageNow({ model: OPUS, now: NOW })))).toBe('paused');
  noteLimits(START, OPUS, NOW + 1000);
  expect(usageNow({ model: OPUS, now: NOW }).capped).toBeNull();
});

// The numbers the drawing tests use: 8 Oct, the owner's own.
const U = { model: OPUS, modelName: 'Opus 5.5', cap: 500, tier: 'Start', spent: 66.56, left: 433.44, monthName: 'October', days: [0, 0, 0, 0, 0, 0, 9.85, 56.71], last14: [...Array(12).fill(0), 9.85, 56.71], today: { usd: 56.71, windows: 2 }, window: 8.82, pace: { perDay: 33.28, runsOut: new Date(2026, 9, 22).getTime(), beforeReset: true }, limits: limitsFrom(startHeaders(new Date(NOW - 599_000).toISOString()), OPUS, NOW - 600_000), resetsOn: Date.parse('2026-11-01T00:00:00Z'), capped: null };
const WIDTHS = [60, 72, 80, 100, 120, 152, 177];

// "3 · One row" (9 Oct 2026): no row of its own; "$433.44 left" in the footer's right side, after the model.
test('the footer’s words: what is left in cents, amber when it runs out before the 1st, red under a tenth, paused at the cap, the month without a cap', () => {
  const chip = (u) => usageChip(u).map((x) => `${x.t}@${x.fg}`).join('|');
  expect(textOf(usageChip(U))).toBe('$433.44 left');
  expect(chip(U)).toBe('$433.44@215| left@215'); // U runs out on Oct 22: amber
  expect(chip({ ...U, pace: { ...U.pace, beforeReset: false } })).toBe('$433.44@255| left@245');
  expect(chip({ ...U, left: 14.99, low: true })).toBe('$14.99@203| left@203');
  expect(textOf(usageChip({ ...U, capped: { kind: 'own' } }))).toBe('paused');
  expect(textOf(usageChip({ ...U, cap: null, left: null }))).toBe('$66.56 this month');
});

test('the card’s line holds still at rest and shines while a reply runs', () => {
  const colours = (now, live) => usagePanel(U, 152, { now, live })[3].map((s) => `${s.fg}:${s.t.length}`).join(',');
  expect(colours(NOW, false)).toBe(colours(NOW + 777, false));
  expect(colours(NOW, true)).not.toBe(colours(NOW + 777, true));
});

test('the /usage card has the prompt box’s ends: the whole width, round corners, text one cell in, one label column, numbers to one edge, meters ending together', () => {
  for (const W of [72, 80, 120, 152, 177]) {
    const rows = usagePanel(U, W, { now: NOW }).map(textOf);
    expect(rows.every((r) => [...r].length === W)).toBe(true);
    expect(rows[0]).toMatch(W >= 84 ? /^╭─ ◆ Usage · Claude API · Opus 5\.5 ─+ r refresh · l limit · s spent · k admin key · esc ─╮$/ : /^╭─ ◆ Usage · Claude API · Opus 5\.5 ─+ r · l · s · k · esc ─╮$/);
    expect(rows.at(-1)).toBe(`╰${'─'.repeat(W - 2)}╯`);
    for (const r of rows.slice(1, -1)) { expect(r.startsWith('│ ')).toBe(true); expect(r.endsWith(' │')).toBe(true); }
    const inner = rows.slice(1, -1).map((r) => r.slice(2, -2));
    const at = (word) => inner.find((r) => r.startsWith(word));
    expect(at('THIS MONTH').trimEnd().endsWith('$433.44 left of $500')).toBe(true);
    expect(at('THIS MONTH').trimEnd().length).toBe(W - 4); // to the inner edge
    expect(inner.find((r) => /^[━╸─]+$/.test(r))).toHaveLength(W - 4); // the line: the whole inner width
    for (const label of ['TODAY', '14 DAYS', 'THIS MINUTE', 'requests', 'input', 'output']) expect(at(label)[LABEL_W - 1]).toBe(' '), expect(at(label)[LABEL_W]).not.toBe(' ');
    const meters = ['requests', 'input', 'output'].map((k) => at(k));
    const ends = meters.map((r) => r.slice(LABEL_W).search(/[━╸─](?![━╸─])/));
    expect(new Set(ends).size).toBe(1);
    for (const r of meters) expect(r.trimEnd().length).toBe(W - 4);
    // one blank row between sections
    const blanks = inner.map((r, i) => (r.trim() ? null : i)).filter((i) => i != null);
    expect(blanks.every((i, k) => k === 0 || i - blanks[k - 1] > 1)).toBe(true);
  }
  const wide = usagePanel(U, 152, { now: NOW }).map(textOf).join('\n');
  expect(wide).toContain('▲ at ~$33 a day it runs out around Oct 22, and the API stops until Nov 1');
  expect(wide).toContain('1,000 of 1,000');
  expect(wide).toContain('limits from Anthropic’s last reply, 10 min ago');
});

test('on the stand-in Claude API: each reply’s limits are kept for every window; at the cap the request stops with a plain reason and is not tried again', async () => {
  freshHome();
  const cap = { status: 429, type: 'rate_limit_error', message: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization\'s API tier.', details: { error_code: 'enforced_spend_limit_reached' } };
  const fake = await startFakeAnthropic([{ text: 'Hi.' }, { error: cap }, { error: cap }, { error: cap }, { error: cap }], { limits: { requests: [1000, 997], input: [2_000_000, 1_996_000], output: [400_000, 399_000] } });
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: OPUS, label: CLAUDE_HOST, price: { in: 4, out: 20 } });
  const drain = async (it) => { const out = []; for await (const ev of it) out.push(ev); return out; };
  const ask = () => drain(streamChat({ url: fake.url, messages: [{ role: 'user', content: 'hi' }], model: GENERIC_REMOTE, maxTokens: 200 }));
  try {
    await ask();
    const u = usageNow({ model: OPUS });
    expect(u).toMatchObject({ cap: 500, tier: 'Start', limits: { requests: { limit: 1000, remaining: 997 }, input: { remaining: 1_996_000 } } });
    expect(u.today.usd).toBeGreaterThan(0); // the reply's cost, on the Claude API's line
    const posts = () => fake.seen.filter((s) => s.path.startsWith('/v1/messages')).length;
    const before = posts();
    let err = null;
    try { await ask(); } catch (e) { err = e; }
    expect(err?.message).toMatch(/^the Claude API stopped: this month's spend cap is reached, and it answers again on Nov 1 \(UTC\) · \/usage$|answers again on \w+ \d+ \(UTC\)/);
    expect(err.busy).toBe(false);
    expect(posts() - before).toBeLessThanOrEqual(3); // the SDK's own two retries at most, none of the app's waits
    expect(usageNow({ model: OPUS }).capped).toMatchObject({ kind: 'tier' });
  } finally { dropEndpoint(fake.url); await fake.close(); }
}, 20_000);

test('/usage is in the / menu on the Claude API only, and shows without scrolling in an 80 × 24 window', () => {
  const names = (o) => matchCommands('/', { remote: true, side: true, room: 18, ...o }).map((c) => c.name);
  expect(names({ claude: true })).toContain('usage');
  expect(names({ claude: true }).indexOf('usage')).toBeLessThan(18); // among the 18 rows shown before any scrolling
  expect(names({})).not.toContain('usage');
  expect(matchCommands('/us', { claude: true, remote: true }).map((c) => c.name)[0]).toBe('usage');
});

// 9 Oct 2026 (the owner: "ensure that the api $ left is updated in real time and is true. my limit is $200").
test('the price of a cache hit is the model’s own: 5% of input on Opus 5.5, a tenth where none is named', () => {
  const hit = { prompt_tokens: 1_000_000, cached_tokens: 1_000_000, completion_tokens: 0 };
  expect(costOf(hit, { in: 4, out: 20, hit: 0.2 })).toBeCloseTo(0.2, 6);
  expect(costOf(hit, { in: 4, out: 20 })).toBeCloseTo(0.4, 6);
  expect(costOf({ prompt_tokens: 1_100_000, cached_tokens: 900_000, cache_write_tokens: 100_000, completion_tokens: 10_000 }, { in: 4, out: 20, hit: 0.2 })).toBeCloseTo(0.4 + 0.18 + 0.5 + 0.2, 6);
});

test('each Claude API answer is kept with its moment, so what came after a figure can be added to it', () => {
  const home = freshHome();
  const claude = { remote: true, kind: 'claude', label: CLAUDE_HOST, price: { in: 4, out: 20, hit: 0.2 } };
  const other = { remote: true, kind: 'openai', label: 'openrouter.ai', price: { in: 1, out: 1 } };
  recordSpend(claude, { prompt_tokens: 1_000_000, completion_tokens: 0 }, { now: new Date(NOW - 7_200_000), pid: 1 });
  recordSpend(claude, { prompt_tokens: 250_000, completion_tokens: 0 }, { now: new Date(NOW - 60_000), pid: 2 });
  recordSpend(other, { prompt_tokens: 1_000_000, completion_tokens: 0 }, { now: new Date(NOW - 30_000), pid: 2 });
  expect(claudeSince(NOW - 3_600_000, { dir: join(home, 'spend'), now: new Date(NOW) })).toBeCloseTo(1, 6);
  expect(claudeSince(NOW - 86_400_000, { dir: join(home, 'spend'), now: new Date(NOW) })).toBeCloseTo(5, 6);
  expect(claudeSince(NOW, { dir: join(home, 'spend'), now: new Date(NOW) })).toBe(0);
});

test('your limit, a figure typed from the Console and Anthropic’s bill: the newest of the two, plus this Mac since; the meter without either', () => {
  freshHome();
  const month = monthOf(NOW);
  const claude = { remote: true, kind: 'claude', label: CLAUDE_HOST, price: { in: 4, out: 20 } };
  recordSpend(claude, { prompt_tokens: 2_500_000, completion_tokens: 0 }, { now: new Date(NOW - 7_200_000), pid: 1 }); // $10, two hours ago
  noteLimits(START, OPUS, NOW - 600_000);
  let u = usageNow({ model: OPUS, now: NOW });
  expect(u).toMatchObject({ cap: 500, tierCap: 500, ownLimit: null, source: { kind: 'meter' } });
  expect(u.spent).toBeCloseTo(10, 6);
  setOwn({ limit: 200 });
  u = usageNow({ model: OPUS, now: NOW });
  expect(u).toMatchObject({ cap: 200, tierCap: 500, ownLimit: 200, low: false });
  expect(u.left).toBeCloseTo(190, 6);
  // the Console said $120 an hour ago; $1 since on this Mac
  setOwn({ spent: { usd: 120, at: NOW - 3_600_000, month } });
  recordSpend(claude, { prompt_tokens: 250_000, completion_tokens: 0 }, { now: new Date(NOW - 60_000), pid: 2 });
  u = usageNow({ model: OPUS, now: NOW });
  expect(u.source).toMatchObject({ kind: 'typed', usd: 120 });
  expect(u.spent).toBeCloseTo(121, 6);
  expect(u.left).toBeCloseTo(79, 6);
  expect(sourceWords(u, NOW)).toBe('spent: the $120.00 you typed 60 min ago + $1.00 this Mac since · other Macs after it not counted');
  // a typed figure from another month is not this month's
  setOwn({ spent: { usd: 120, at: NOW - 3_600_000, month: '2026-09' } });
  expect(usageNow({ model: OPUS, now: NOW }).source.kind).toBe('meter');
  // under a tenth left: low
  setOwn({ spent: { usd: 185, at: NOW - 3_600_000, month } });
  expect(usageNow({ model: OPUS, now: NOW })).toMatchObject({ low: true });
  expect(usageNow({ model: OPUS, now: NOW }).left).toBeCloseTo(14, 6);
  setOwn({ limit: null, spent: null });
  expect(usageNow({ model: OPUS, now: NOW })).toMatchObject({ cap: 500, ownLimit: null, source: { kind: 'meter' } });
});

test('Anthropic’s bill: every page of the month added up, once a minute over every window, this Mac’s answers after it on top; a refused key said, the last bill kept', async () => {
  freshHome();
  const ADMIN = 'stand-in-admin-key-for-the-test';
  const fake = await startFakeAnthropic([], { bill: { adminKey: ADMIN, cents: ['1000', '2050.5', null, '4999.5', '4000'] } });
  process.env.AGENTIC_ADMIN_URL = fake.url;
  try {
    const now = Date.now();
    const bill = await fetchBill({ key: ADMIN, now });
    expect(bill).toMatchObject({ month: monthOf(now), usd: 120.5, at: now });
    expect(fake.seen.filter((x) => x.path.startsWith('/v1/organizations/cost_report'))).toHaveLength(3); // three pages
    const first = fake.seen.find((x) => x.path.startsWith('/v1/organizations/cost_report'));
    expect(first).toMatchObject({ key: ADMIN, version: '2023-06-01' });
    expect(new URL(first.path, 'http://x').searchParams.get('starting_at')).toBe(`${monthOf(now)}-01T00:00:00.000Z`);
    expect(await fetchBill({ key: ADMIN, now: now + 30_000 })).toMatchObject({ at: now }); // read under a minute ago: not again
    const claude = { remote: true, kind: 'claude', label: CLAUDE_HOST, price: { in: 4, out: 20 } };
    recordSpend(claude, { prompt_tokens: 500_000, completion_tokens: 0 }, { now: new Date(now + 1000), pid: 3 });
    const u = usageNow({ model: OPUS, now: now + 2000, admin: true });
    expect(u.source).toMatchObject({ kind: 'bill', usd: 120.5 });
    expect(u.spent).toBeCloseTo(122.5, 6);
    // a bill nobody reads any more counts for 15 minutes, then the meter again
    expect(usageNow({ model: OPUS, now: now + 16 * 60_000 }).source.kind).not.toBe('bill');
    const refused = await fetchBill({ key: 'a-wrong-stand-in-key', now: now + 120_000 });
    expect(refused).toMatchObject({ usd: 120.5, error: { status: 401 } });
    expect(readBill().error.message).toMatch(/Admin API/);
    expect(usageNow({ model: OPUS, now: now + 121_000, admin: true }).source.error).toMatchObject({ status: 401 });
  } finally { delete process.env.AGENTIC_ADMIN_URL; await fake.close(); }
});

test('dollars typed: $, commas and cents; off takes a value out; words are not dollars', () => {
  expect(dollarsOf('200')).toBe(200);
  expect(dollarsOf('$1,000.505')).toBe(1000.51);
  expect(dollarsOf(' 112.40 ')).toBe(112.4);
  expect(dollarsOf('off')).toBe(0);
  expect(dollarsOf('lots')).toBeNull();
  expect(dollarsOf('')).toBeNull();
});
