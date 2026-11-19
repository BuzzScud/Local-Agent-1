// /usage and "$ left" in the footer on the Claude API (claude-usage.mjs, usage-bar.mjs, 8 Oct 2026; "3 · One row"
// and your own limit, 9 Oct 2026): the limits each reply carries, the month from the cost meter (the Claude API's
// dollars only), a figure typed from the Console or Anthropic's bill, against your limit or the tier's cap, the
// cap's stop said plainly and not tried again, and the card with the prompt box's ends. Against a stand-in
// Claude API: no key, no bill.
import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeAnthropic } from './fake-anthropic.mjs';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-usage-home-'));
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { limitsFrom, noteLimits, tierOf, capOf, noteCapped, usageNow, resetOf, setOwn, fetchBill, readBill, dollarsOf, monthOf } = await import('../src/agent/claude-usage.mjs');
const { recordSpend, daySpend, dayOf, costOf, claudeSince, cacheOf, dayCache, windowSpend } = await import('../src/agent/spend.mjs');
const { usagePanel, usageChip, sourceWords, textOf, widthOf, LABEL_W, cacheWords } = await import('../src/app/usage-bar.mjs');
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
  expect(daySpend(dayOf(now), { kind: 'claude' })).toEqual({ usd: 9, windows: 3, untagged: 9 }); // no account named: all from before 19 Nov 2026
  expect(daySpend(dayOf(now), { service: CLAUDE_HOST })).toEqual({ usd: 7, windows: 2 });
  expect(daySpend(dayOf(now), { service: 'openrouter.ai' })).toEqual({ usd: 10, windows: 2 });
});

test('the month: the Claude API’s dollars against a $500 limit, today, the pace and the day it runs out; the tier’s cap only named; nothing known before a reply', () => {
  const home = freshHome();
  spendFile(home, new Date(2026, 9, 7), 11, { usd: 9.85, service: CLAUDE_HOST });
  spendFile(home, new Date(2026, 9, 8), 12, { usd: 50, byService: { [CLAUDE_HOST]: 47.89, 'openrouter.ai': 2.11 }, byKind: { claude: 47.89, openai: 2.11 } });
  spendFile(home, new Date(2026, 9, 8), 13, { usd: 8.82, service: CLAUDE_HOST });
  const before = usageNow({ model: OPUS, now: NOW });
  expect(before).toMatchObject({ cap: null, left: null, tier: null, limits: null });
  expect(before.spent).toBeCloseTo(66.56, 2);
  noteLimits(new Headers(START), OPUS, NOW - 600_000);
  // the Start tier's $500 is a ceiling on the month, not money left (18 Nov 2026: it showed $500 with $201 in credit)
  expect(usageNow({ model: OPUS, now: NOW })).toMatchObject({ cap: null, left: null, tier: 'Start', tierCap: 500 });
  setOwn({ limit: 500 });
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
const U = { model: OPUS, modelName: 'Opus 5.5', cap: 500, tier: 'Start', spent: 66.56, left: 433.44, monthName: 'October', days: [0, 0, 0, 0, 0, 0, 9.85, 56.71], last14: [...Array(12).fill(0), 9.85, 56.71], today: { usd: 56.71, windows: 2 }, window: 8.82, cache: { today: { sent: 2_000_000, hit: 1_720_000, wrote: 200_000, saved: 6.02 }, last14: { sent: 9_000_000, hit: 7_380_000, wrote: 900_000, saved: 25.75 } }, pace: { perDay: 33.28, runsOut: new Date(2026, 9, 22).getTime(), beforeReset: true }, limits: limitsFrom(startHeaders(new Date(NOW - 599_000).toISOString()), OPUS, NOW - 600_000), resetsOn: Date.parse('2026-11-01T00:00:00Z'), capped: null };
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
    expect(rows[0]).toMatch(W >= 101 ? /^╭─ ◆ Usage · Claude API · Opus 5\.5 ─+ r refresh · b balance · l limit · s spent · k admin key · esc ─╮$/ : /^╭─ ◆ Usage · Claude API · Opus 5\.5 ─+ r · b · l · s · k · esc ─╮$/);
    expect(rows.at(-1)).toBe(`╰${'─'.repeat(W - 2)}╯`);
    for (const r of rows.slice(1, -1)) { expect(r.startsWith('│ ')).toBe(true); expect(r.endsWith(' │')).toBe(true); }
    const inner = rows.slice(1, -1).map((r) => r.slice(2, -2));
    const at = (word) => inner.find((r) => r.startsWith(word));
    expect(at('THIS MONTH').trimEnd().endsWith('$433.44 left of $500')).toBe(true);
    expect(at('THIS MONTH').trimEnd().length).toBe(W - 4); // to the inner edge
    expect(inner.find((r) => /^[━╸─]+$/.test(r))).toHaveLength(W - 4); // the line: the whole inner width
    for (const label of ['TODAY', '14 DAYS', 'CACHE', 'THIS MINUTE', 'requests', 'input', 'output']) expect(at(label)[LABEL_W - 1]).toBe(' '), expect(at(label)[LABEL_W]).not.toBe(' ');
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
  expect(wide).toContain('CACHE         86% of what was sent today came from the cache · saved $6.02 · 14 days 82%, saved $25.75');
});

// 13 Oct 2026 (the owner's pick "1 · Track cache re-use"): Claude tells each answer how much of what was sent it
// read from its prompt cache; the app kept only the dollars, so nobody could tell whether the cache worked.
test('the prompt cache of each Claude answer is kept: the window, the day by kind of service, each answer’s line; a service with no cache keeps none', () => {
  const home = freshHome();
  const claude = { remote: true, kind: 'claude', label: CLAUDE_HOST, price: { in: 4, out: 20, hit: 0.2 } };
  const other = { remote: true, kind: 'openai', label: 'openrouter.ai', price: { in: 1, out: 1 } };
  const now = new Date(NOW);
  // 100k sent: 90k read from the cache, 8k written to it, 2k plain
  const one = { prompt_tokens: 100_000, cached_tokens: 90_000, cache_write_tokens: 8_000, completion_tokens: 1_000 };
  expect(cacheOf(one, claude.price)).toEqual({ sent: 100_000, hit: 90_000, wrote: 8_000, saved: expect.any(Number) });
  // saved: 90k at $3.80 less than plain, less 8k written at a quarter more ($1 a million): $0.342 - $0.008
  expect(cacheOf(one, claude.price).saved).toBeCloseTo(0.334, 6);
  expect(cacheOf({ prompt_tokens: 5000, completion_tokens: 10 }, other.price)).toBe(null);
  const before = windowSpend().cache;
  recordSpend(claude, one, { now, pid: 1 });
  recordSpend(claude, { prompt_tokens: 50_000, cached_tokens: 0, cache_write_tokens: 50_000, completion_tokens: 500 }, { now, pid: 2 });
  recordSpend(other, { prompt_tokens: 1_000_000, completion_tokens: 0 }, { now, pid: 1 });
  const win = windowSpend().cache;
  expect(win.sent - before.sent).toBe(150_000);
  expect(win.hit - before.hit).toBe(90_000);
  expect(dayCache(dayOf(now), { kind: 'claude' })).toMatchObject({ sent: 150_000, hit: 90_000, wrote: 58_000 });
  expect(dayCache(dayOf(now), { kind: 'openai' })).toEqual({ sent: 0, hit: 0, wrote: 0, saved: 0 });
  expect(dayCache('2026-01-01', { kind: 'claude' })).toEqual({ sent: 0, hit: 0, wrote: 0, saved: 0 });
  // each answer's line has its tokens after its dollars, and the dollars after a figure still add up
  const line = readFileSync(join(home, 'spend', dayOf(now), '1.claude'), 'utf8').trim().split(' ');
  expect(line.slice(2)).toEqual(['100000', '90000', '8000']);
  expect(claudeSince(NOW - 1, { dir: join(home, 'spend'), now })).toBeCloseTo(costOf(one, claude.price) + costOf({ prompt_tokens: 50_000, cache_write_tokens: 50_000, completion_tokens: 500 }, claude.price), 6);
  // the month's numbers carry today's and the 14 days'
  spendFile(home, new Date(2026, 9, 3), 9, { usd: 1, byKind: { claude: 1 }, cacheByKind: { claude: { sent: 50_000, hit: 40_000, wrote: 0, saved: 0.15 } } });
  const u = usageNow({ model: OPUS, now: NOW });
  expect(u.cache.today).toMatchObject({ sent: 150_000, hit: 90_000 });
  expect(u.cache.last14).toMatchObject({ sent: 200_000, hit: 130_000 });
});

test('the CACHE row: today’s share in amber under half, the 14 days beside it, plain words before the first kept answer', () => {
  const words = (c, wide) => textOf(cacheWords(c, wide));
  expect(words(null)).toBe('the share of each request read from Claude’s cache shows here after the next reply');
  const all = { sent: 1000, hit: 900, wrote: 0, saved: 1.5 };
  expect(words({ today: { sent: 0, hit: 0, wrote: 0, saved: 0 }, last14: all })).toBe('nothing sent today · 14 days 90%, saved $1.50');
  const low = cacheWords({ today: { sent: 1000, hit: 300, wrote: 600, saved: -0.2 }, last14: all });
  expect(low[0]).toMatchObject({ t: '30%', fg: 215 });
  expect(words({ today: { sent: 1000, hit: 300, wrote: 600, saved: 0.1 }, last14: all }, false)).toBe('30% from the cache today · saved $0.10 · 14 d 90%');
});

test('on the stand-in Claude API: each reply’s limits are kept for every window; at the cap the request stops with a plain reason and is not tried again', async () => {
  freshHome();
  const cap = { status: 429, type: 'rate_limit_error', message: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold, set based on your organization\'s API tier.', details: { error_code: 'enforced_spend_limit_reached' } };
  const fake = await startFakeAnthropic([{ text: 'Hi.' }, { error: cap }, { error: cap }, { error: cap }, { error: cap }], { limits: { requests: [1000, 997], input: [2_000_000, 1_996_000], output: [400_000, 399_000] } });
  setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: OPUS, label: CLAUDE_HOST, price: { in: 4, out: 20 } });
  const drain = async (it) => { const out = []; for await (const ev of it) out.push(ev); return out; };
  const ask = () => drain(streamChat({ url: fake.url, messages: [{ role: 'user', content: 'hi' }], model: GENERIC_REMOTE, maxTokens: 200 }));
  try {
    const t0 = Date.now();
    await ask();
    const u = usageNow({ model: OPUS });
    expect(u).toMatchObject({ cap: null, tierCap: 500, tier: 'Start', limits: { requests: { limit: 1000, remaining: 997 }, input: { remaining: 1_996_000 } } });
    // the reply's cost, on the Claude API's line: on the day it was asked, or the next when the run crossed midnight
    expect(Math.max(...[t0, Date.now()].map((now) => usageNow({ model: OPUS, now }).today.usd))).toBeGreaterThan(0);
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
  expect(u).toMatchObject({ cap: null, left: null, tierCap: 500, ownLimit: null, source: { kind: 'meter' } });
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
  expect(usageNow({ model: OPUS, now: NOW })).toMatchObject({ cap: null, left: null, ownLimit: null, source: { kind: 'meter' } });
});

// 18 Nov 2026, the owner: "it says i have $500 available but i only have 201"; their pick "type it once, the app
// counts down". No API tells the credit balance, so the one typed from the Console's Billing page is what is left.
test('your credit balance, typed once, counts down with each Claude answer after it; it wins over a limit and the tier; old, it asks again', () => {
  freshHome();
  const DAY = 86_400_000;
  const claude = { remote: true, kind: 'claude', label: CLAUDE_HOST, price: { in: 4, out: 20 } };
  noteLimits(START, OPUS, NOW - 600_000);
  setOwn({ limit: 300 });
  recordSpend(claude, { prompt_tokens: 2_500_000, completion_tokens: 0 }, { now: new Date(NOW - 7_200_000), pid: 1 }); // $10 before it was typed
  setOwn({ balance: { usd: 201, at: NOW - 3_600_000 } });
  recordSpend(claude, { prompt_tokens: 650_000, completion_tokens: 0 }, { now: new Date(NOW - 60_000), pid: 2 }); // $2.60 after
  let u = usageNow({ model: OPUS, now: NOW });
  expect(u).toMatchObject({ cap: 201, tier: 'Start', tierCap: 500, ownLimit: 300, balance: { usd: 201, days: 0, stale: false }, low: false });
  expect(u.balance.since).toBeCloseTo(2.6, 6);
  expect(u.left).toBeCloseTo(198.4, 6);
  expect(u.spent).toBeCloseTo(12.6, 6); // the month still counts everything
  expect(u.pace.beforeReset).toBe(false); // a balance does not come back on the 1st
  expect(textOf(usageChip(u))).toBe('$198.40 left');
  for (const w of WIDTHS) for (const r of usagePanel(u, w, { now: NOW })) expect(widthOf(r)).toBe(w);
  const card = usagePanel(u, 152, { now: NOW }).map(textOf).join('\n');
  expect(card).toContain('$198.40 left of $201, your balance');
  expect(card).toContain('balance: the $201.00 you typed 60 min ago − $2.60 this Mac since · other Macs not counted · b types it again');
  expect(card).not.toContain('the API stops until');
  // three whole days old: the footer and the card ask for it again
  setOwn({ balance: { usd: 201, at: NOW - 3 * DAY } });
  u = usageNow({ model: OPUS, now: NOW });
  expect(u.balance).toMatchObject({ days: 3, stale: true });
  expect(textOf(usageChip(u))).toBe(`$${u.left.toFixed(2)} left (3 d old)`);
  expect(usagePanel(u, 152, { now: NOW }).map(textOf).join('\n')).toContain('▲ the balance you typed is 3 days old: b types the Console’s figure again');
  // spent down to nothing: $0.00 left, never below; under a tenth: low
  setOwn({ balance: { usd: 2, at: NOW - 3_600_000 } });
  expect(usageNow({ model: OPUS, now: NOW })).toMatchObject({ left: 0, low: true });
  // taken out: the limit counts again; with neither, the month's spend and no "left"
  setOwn({ balance: null });
  expect(usageNow({ model: OPUS, now: NOW })).toMatchObject({ cap: 300, balance: null });
  setOwn({ limit: null });
  u = usageNow({ model: OPUS, now: NOW });
  expect(u).toMatchObject({ cap: null, left: null });
  expect(textOf(usageChip(u))).toBe('$12.60 this month');
});

test('a typed figure three whole days old asks to be typed again: in the footer and the card; fresh, the bill and the meter never do', () => {
  freshHome();
  const month = monthOf(NOW);
  noteLimits(START, OPUS, NOW - 600_000);
  setOwn({ limit: 200 });
  const DAY = 86_400_000;
  const typedAgo = (ms) => { setOwn({ spent: { usd: 50, at: NOW - ms, month } }); return usageNow({ model: OPUS, now: NOW }); };
  // fresh, and a minute short of three days: no nudge
  for (const ms of [3_600_000, 3 * DAY - 60_000]) {
    const u = typedAgo(ms);
    expect(u.source.stale).toBe(false);
    expect(textOf(usageChip(u))).toBe('$150.00 left');
    expect(usagePanel(u, 120, { now: NOW }).map(textOf).some((r) => r.includes('▲ the figure you typed'))).toBe(false);
  }
  // exactly three days: stale; the footer says so after what is left, in amber
  let u = typedAgo(3 * DAY);
  expect(u.source).toMatchObject({ kind: 'typed', days: 3, stale: true });
  expect(textOf(usageChip(u))).toBe('$150.00 left (3 d old)');
  expect(usageChip(u).at(-1).fg).toBe(215);
  // the card: one amber row under where the spend comes from, the card's ends kept at every width
  for (const w of WIDTHS) {
    const rows = usagePanel(u, w, { now: NOW });
    for (const r of rows) expect(widthOf(r)).toBe(w);
    const words = rows.map(textOf).find((r) => r.includes('▲'));
    expect(words).toContain(w - 4 >= 80 ? 'the figure you typed is 3 days old: s types the Console’s figure again' : 'typed 3 days ago · s to update');
  }
  // without a cap the month's words get it too; at the cap only "paused"
  expect(textOf(usageChip({ ...u, cap: null, left: null }))).toBe(`$${u.spent.toFixed(2)} this month (3 d old)`);
  expect(textOf(usageChip({ ...u, capped: { kind: 'own' } }))).toBe('paused');
  // typed again: fresh
  u = typedAgo(0);
  expect(u.source.stale).toBe(false);
  // the meter (nothing typed) is never stale
  setOwn({ spent: null });
  expect(usageNow({ model: OPUS, now: NOW }).source.stale).toBeUndefined();
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

// 19 Nov 2026, the owner: "i just changed the api key but my $ amount stayed the same".
test('a key of another account counts its own month: dollars, today, limits, the cap and what you typed follow the account the key belongs to', () => {
  const home = freshHome();
  const A = 'test-stand-in-key-of-account-a', B = 'test-stand-in-key-of-account-b', A2 = 'test-another-key-of-account-a';
  const claude = { remote: true, kind: 'claude', label: CLAUDE_HOST, price: { in: 4, out: 20 } };
  const day = new Date(NOW - 3_600_000);
  // $42.10 from before accounts were kept: no account named
  spendFile(home, new Date(2026, 9, 7), 21, { usd: 12.4, service: CLAUDE_HOST, byService: { [CLAUDE_HOST]: 12.4 }, byKind: { claude: 12.4 } });
  spendFile(home, day, 22, { usd: 29.7, service: CLAUDE_HOST, byService: { [CLAUDE_HOST]: 29.7 }, byKind: { claude: 29.7 } });
  expect(usageNow({ model: OPUS, now: NOW }).spent).toBeCloseTo(42.1, 6); // no key named: every dollar, as before
  // a key not seen yet: its account is being checked, and nothing is counted for it
  let u = usageNow({ model: OPUS, now: NOW, key: A });
  expect(u.account).toMatchObject({ pending: true, org: null });
  expect(u.spent).toBe(0);
  expect(u.today.usd).toBe(0);
  noteLimits({ ...START, 'anthropic-organization-id': 'org-aaaa-1111' }, OPUS, NOW - 600_000, A);
  u = usageNow({ model: OPUS, now: NOW, key: A });
  expect(u.account).toMatchObject({ pending: false, org: 'org-aaaa-1111', orgEnd: '1111', earlier: 42.1 });
  expect(u.limits.requests.limit).toBe(1000);
  recordSpend(claude, { prompt_tokens: 1_000_000, completion_tokens: 0, org: 'org-aaaa-1111' }, { now: new Date(NOW - 60_000), pid: 22 }); // $4, in the window's file that holds the old $29.70
  expect(readFileSync(join(home, 'spend', dayOf(new Date(NOW)), '22.claude'), 'utf8').trim()).toMatch(/ org=org-aaaa-1111$/);
  u = usageNow({ model: OPUS, now: NOW, key: A });
  expect(u.spent).toBeCloseTo(4, 6);
  expect(u.today.usd).toBeCloseTo(4, 6);
  expect(u.last14.at(-1)).toBeCloseTo(4, 6);
  expect(u.account.earlier).toBeCloseTo(42.1, 6);
  // another key of the same account: the same month, once a reply names it
  noteLimits({ 'anthropic-organization-id': 'org-aaaa-1111' }, OPUS, NOW, A2);
  expect(usageNow({ model: OPUS, now: NOW, key: A2 }).spent).toBeCloseTo(4, 6);
  // a key of account B: its own month from $0, none of A's limits, A's balance not counted
  setOwn({ balance: { usd: 201, at: NOW - 7_200_000, org: 'org-aaaa-1111' } });
  noteLimits({ 'anthropic-organization-id': 'org-bbbb-2222' }, OPUS, NOW, B); // a free call: an account, no limits
  u = usageNow({ model: OPUS, now: NOW, key: B });
  expect(u).toMatchObject({ spent: 0, limits: null, tier: null, balance: null, cap: null, account: { pending: false, orgEnd: '2222' } });
  recordSpend(claude, { prompt_tokens: 500_000, completion_tokens: 0, org: 'org-bbbb-2222' }, { now: new Date(NOW - 30_000), pid: 22 }); // $2
  expect(usageNow({ model: OPUS, now: NOW, key: B }).spent).toBeCloseTo(2, 6);
  // back to A: its $4 and its balance less A's answers since ($201 − $4), not B's
  u = usageNow({ model: OPUS, now: NOW, key: A });
  expect(u.spent).toBeCloseTo(4, 6);
  expect(u.left).toBeCloseTo(197, 6);
  // a cap reached under B does not pause A
  noteCapped('tier', NOW, 'org-bbbb-2222');
  expect(usageNow({ model: OPUS, now: NOW, key: B }).capped).toMatchObject({ kind: 'tier' });
  expect(usageNow({ model: OPUS, now: NOW, key: A }).capped).toBeNull();
  expect(usageNow({ model: OPUS, now: NOW }).spent).toBeCloseTo(48.1, 6); // no key named: every account's, as before
  // a key whose answers name no account (a proxy that drops the header): every dollar counts for it, as before
  const P = 'test-stand-in-key-behind-a-proxy';
  noteLimits({ 'request-id': 'req_1' }, OPUS, NOW, P); // no limits either: not known to be an answer, still checking
  expect(usageNow({ model: OPUS, now: NOW, key: P }).account.pending).toBe(true);
  noteLimits(START, OPUS, NOW, P);
  expect(usageNow({ model: OPUS, now: NOW, key: P })).toMatchObject({ account: { pending: false, org: null, earlier: 0 } });
  expect(usageNow({ model: OPUS, now: NOW, key: P }).spent).toBeCloseTo(48.1, 6);
});

test('the card says whose dollars these are, at every width: a new key being checked, then its account and the older dollars not counted', () => {
  const pending = { ...U, cap: null, left: null, spent: 0, account: { pending: true, org: null, orgEnd: null, earlier: 0 } };
  const known = { ...U, account: { pending: false, org: 'org-bbbb-2222', orgEnd: '2222', earlier: 42.1 } };
  for (const W of WIDTHS) {
    for (const u of [pending, known]) for (const r of usagePanel(u, W, { now: NOW })) expect(widthOf(r)).toBe(W);
  }
  const wide = (u) => usagePanel(u, 152, { now: NOW }).map(textOf).join('\n');
  expect(wide(pending)).toContain('account: checking which account the new key belongs to · nothing counted until it answers');
  expect(wide(known)).toContain('account: organization …2222, the key in use’s · only its dollars count');
  expect(wide(known)).toContain('$42.10 earlier this month came before keys were told apart: not counted');
  expect(wide(U)).not.toContain('account');
  expect(usagePanel(known, 60, { now: NOW }).map(textOf).join('\n')).toContain('account …2222 · its dollars only');
});

test('a new key in a running window: its account is learned for free from the model list, and each reply’s dollars go to the account it names', async () => {
  freshHome();
  const B = 'test-stand-in-key-of-account-b';
  const fake = await startFakeAnthropic([{ text: 'Hi.' }, { text: 'Hi again.' }], { orgs: { 'test-anthropic-key-0123456789': 'org-aaaa-1111', [B]: 'org-bbbb-2222' }, limits: { requests: [1000, 999], input: [2_000_000, 1_999_000], output: [400_000, 400_000] } });
  const { learnAccount } = await import('../src/agent/claude-usage.mjs');
  const drain = async (it) => { for await (const _ of it); };
  const ask = () => drain(streamChat({ url: fake.url, messages: [{ role: 'user', content: 'hi' }], model: GENERIC_REMOTE, maxTokens: 200 }));
  try {
    setEndpoint(fake.url, { remote: true, kind: 'claude', key: fake.key, model: OPUS, label: CLAUDE_HOST, price: { in: 4, out: 20 } });
    await ask();
    const a = usageNow({ model: OPUS, key: fake.key });
    expect(a.account).toMatchObject({ pending: false, org: 'org-aaaa-1111' });
    expect(a.spent).toBeGreaterThan(0);
    expect(a.limits.requests.remaining).toBe(999);
    // the key changed: nothing counted until its account is known, which costs no request to /v1/messages
    expect(usageNow({ model: OPUS, key: B }).account.pending).toBe(true);
    const posts = () => fake.seen.filter((x) => x.path.startsWith('/v1/messages')).length;
    const before = posts();
    expect(await learnAccount({ url: fake.url, key: B })).toBe('org-bbbb-2222');
    expect(posts()).toBe(before);
    expect(fake.seen.at(-1)).toMatchObject({ method: 'GET', key: B });
    expect(usageNow({ model: OPUS, key: B })).toMatchObject({ spent: 0, limits: null, account: { pending: false, org: 'org-bbbb-2222' } });
    setEndpoint(fake.url, { remote: true, kind: 'claude', key: B, model: OPUS, label: CLAUDE_HOST, price: { in: 4, out: 20 } });
    await ask();
    const b = usageNow({ model: OPUS, key: B });
    expect(b.spent).toBeGreaterThan(0);
    expect(b.limits.requests.limit).toBe(1000);
    expect(usageNow({ model: OPUS, key: fake.key }).spent).toBeCloseTo(a.spent, 9); // A's month unchanged by B's reply
  } finally { dropEndpoint(fake.url); await fake.close(); }
});

test('dollars typed: $, commas and cents; off takes a value out; words are not dollars', () => {
  expect(dollarsOf('200')).toBe(200);
  expect(dollarsOf('$1,000.505')).toBe(1000.51);
  expect(dollarsOf(' 112.40 ')).toBe(112.4);
  expect(dollarsOf('off')).toBe(0);
  expect(dollarsOf('lots')).toBeNull();
  expect(dollarsOf('')).toBeNull();
});
