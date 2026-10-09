// /usage and the bar under the footer on the Claude API (claude-usage.mjs, usage-bar.mjs, 8 Oct 2026):
// the limits each reply carries, the month from the cost meter (the Claude API's dollars only)
// against the tier's cap, the cap's stop said plainly and not tried again, and the bar and the card
// with the same ends as the footer and the prompt box. Against a stand-in Claude API: no key, no bill.
import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeAnthropic } from './fake-anthropic.mjs';

process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-usage-home-'));
process.env.AGENTIC_REMOTE_KEYSTORE = 'file';
const { limitsFrom, noteLimits, tierOf, capOf, noteCapped, usageNow, resetOf } = await import('../src/agent/claude-usage.mjs');
const { recordSpend, daySpend, dayOf } = await import('../src/agent/spend.mjs');
const { usageRow, usagePanel, textOf, widthOf, MIN_LINE, LABEL_W } = await import('../src/app/usage-bar.mjs');
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
  expect(textOf(usageRow(usageNow({ model: OPUS, now: NOW }), 120, { now: NOW }))).toContain('paused · cap reached · back Nov 1');
  noteLimits(START, OPUS, NOW + 1000);
  expect(usageNow({ model: OPUS, now: NOW }).capped).toBeNull();
});

// The numbers the drawing tests use: 8 Oct, the owner's own.
const U = { model: OPUS, modelName: 'Opus 5.5', cap: 500, tier: 'Start', spent: 66.56, left: 433.44, monthName: 'October', days: [0, 0, 0, 0, 0, 0, 9.85, 56.71], last14: [...Array(12).fill(0), 9.85, 56.71], today: { usd: 56.71, windows: 2 }, window: 8.82, pace: { perDay: 33.28, runsOut: new Date(2026, 9, 22).getTime(), beforeReset: true }, limits: limitsFrom(startHeaders(new Date(NOW - 599_000).toISOString()), OPUS, NOW - 600_000), resetsOn: Date.parse('2026-11-01T00:00:00Z'), capped: null };
const WIDTHS = [60, 72, 80, 100, 120, 152, 177];

// "1 · Tidy" (9 Oct 2026): the line's row is drawn at the footer's inner width, inside the prompt box; what is
// left on the left, today and the run-out day on the right, ending on the row's last cell as the footer's words
// above it do, the line between them.
test('the usage line has the footer’s ends at every width: ◆ and what is left first, today and the run-out day ending on the last cell, the line between; narrower never says more', () => {
  let words = Infinity;
  for (const W of [...WIDTHS].reverse()) {
    const row = usageRow(U, W, { now: NOW });
    const t = textOf(row);
    expect(widthOf(row)).toBe(W);
    expect(t).toMatch(/^◆ \$433(\.44)? left/);
    expect(t.at(-1)).not.toBe(' '); // the last word ends where the footer's right side does
    expect(t).toMatch(/ {2}today \$56\.71 · out (by )?Oct 22$/);
    const line = t.match(/[━╸─]+/)[0].length;
    expect(line).toBeGreaterThanOrEqual(MIN_LINE);
    expect(t.length - line).toBeLessThanOrEqual(words);
    words = t.length - line;
  }
  expect(textOf(usageRow(U, 152, { now: NOW }))).toMatch(/^◆ \$433\.44 left of \$500 {2}━[━╸─]+ {2}today \$56\.71 · out by Oct 22$/);
  // the limits only once the tightest is under half; the daily pace is /usage's
  expect(textOf(usageRow(U, 152, { now: NOW }))).not.toMatch(/limits|\/day/);
  const low = { ...U, limits: { requests: { limit: 1000, remaining: 300, reset: NOW + 30_000 } } };
  expect(textOf(usageRow(low, 152, { now: NOW }))).toMatch(/today \$56\.71 · out by Oct 22 · limits 30% · full in 30s$/);
  // the line is what is left: about 87% of it, then today's 11% in amber, then the rest faint
  const line = usageRow(U, 177, { now: NOW }).filter((s) => /^[━╸─]+$/.test(s.t));
  const cells = (pred) => line.filter(pred).reduce((n, s) => n + s.t.length, 0);
  const all = cells(() => true);
  expect(cells((s) => s.fg !== 94 && s.fg !== 237) / all).toBeCloseTo(0.867, 1);
  expect(cells((s) => s.fg === 94) / all).toBeCloseTo(0.113, 1);
});

test('the bar before the first reply (no cap known), and at rest it holds still while a reply makes it shine', () => {
  const none = { ...U, cap: null, left: null, tier: null, limits: null, pace: { perDay: 33.28, runsOut: null, beforeReset: false } };
  expect(textOf(usageRow(none, 152, { now: NOW }))).toMatch(/^◆ \$66\.56 this month {2}─+ {2}today \$56\.71 · the cap shows after a reply$/);
  expect(textOf(usageRow(U, 152, { now: NOW }))).toBe(textOf(usageRow(U, 152, { now: NOW + 777 })));
  const colours = (now, live) => usageRow(U, 152, { now, live }).map((s) => `${s.fg}:${s.t.length}`).join(',');
  expect(colours(NOW, false)).toBe(colours(NOW + 777, false));
  expect(colours(NOW, true)).not.toBe(colours(NOW + 777, true));
});

test('the /usage card has the prompt box’s ends: the whole width, round corners, text one cell in, one label column, numbers to one edge, meters ending together', () => {
  for (const W of [72, 80, 120, 152, 177]) {
    const rows = usagePanel(U, W, { now: NOW }).map(textOf);
    expect(rows.every((r) => [...r].length === W)).toBe(true);
    expect(rows[0]).toMatch(/^╭─ ◆ Usage · Claude API · Opus 5\.5 ─+ r refresh · esc close ─╮$/);
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
