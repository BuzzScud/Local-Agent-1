// /usage in the real window (8 Oct 2026; "3 · One row", 9 Oct 2026), on a stand-in Claude API that sends the owner's
// real limits (fake-anthropic.mjs): /usage in the / menu, its card with the prompt box's ends, r asking Anthropic once,
// esc closing it; none of it on a model that is not the Claude API. Since 19 Nov 2026 (the owner, on "$168.88 left of
// $200": "the amount is wrong", then "remove the balance overall from the agentic coder") the footer has no dollars,
// and /usage balance and /usage limit only say they are gone.
import { test, expect } from 'bun:test';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit, ON_REMOTE } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: 'test-anthropic-key-0123456789', ANTHROPIC_API_KEY: '' };
const lines = (text) => text.split('\n').map((l) => l.trimEnd());

test('on the Claude API: no dollars in the footer, /usage in the menu, its card with the month spent, r asks once, esc closes it, no balance or limit', async () => {
  const { startFakeAnthropic } = await import('./fake-anthropic.mjs');
  const { cwd, env, base } = setup();
  const claude = await startFakeAnthropic([{ text: 'Hello from Claude.' }], { limits: { requests: [1000, 999], input: [2_000_000, 1_996_000], output: [400_000, 399_000] } });
  const r0 = { source: 'claude', address: claude.url, port: null, connect: 'http', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: '6789', keyId: 'claude' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { claude: r0 } }));
  // Yesterday's spend on the Claude API, from another window (the cost meter's own file). bun test runs in UTC and the
  // window in this Mac's zone, so from 8 pm in New York the test's yesterday was the window's today: the window gets UTC too.
  const y = new Date(Date.now() - 86_400_000);
  const day = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  mkdirSync(join(base, 'home', 'spend', day), { recursive: true });
  writeFileSync(join(base, 'home', 'spend', day, '1.json'), JSON.stringify({ usd: 9.85, service: 'api.anthropic.com', byService: { 'api.anthropic.com': 9.85 }, byKind: { claude: 9.85 } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, TZ: 'UTC' }, args: ['--no-flows'], cols: 152, rows: 44, timeoutMs: 90_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 600 }, { snapshot: 'start' },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from Claude.', ms: 20_000 }, { sleep: 800 }, { snapshot: 'after', has: ['? for shortcuts'] },
    { type: '/us' }, { sleep: 400 }, { snapshot: 'menu' },
    { key: 'enter' }, { wait: 'THIS MONTH' }, { sleep: 300 }, { snapshot: 'card' },
    { type: 'r' }, { wait: 'r refresh', ms: 10_000 }, { sleep: 600 }, { snapshot: 'asked' },
    { key: 'esc' }, { waitGone: 'THIS MONTH' }, { sleep: 300 }, { snapshot: 'closed' },
    { type: '/usage limit 200' }, { key: 'enter' }, { wait: 'no longer keeps a balance or a limit' }, { sleep: 500 }, { snapshot: 'limit' },
    { type: '/usage balance 201' }, { key: 'enter' }, { sleep: 800 }, { snapshot: 'balance' },
    ...quit,
  ] });
  await claude.close();
  // Inside the prompt box (the "Panel", 8 Oct 2026; "3 · One row", 9 Oct 2026): under its dotted rule, the
  // footer, one cell in from the box's border, with what is left after the model's name, and the box's bottom
  // edge under it, on the window's last line (no empty line under it: patches/ink@7.1.1.patch).
  // Before a reply: the model, no dollars
  const start = lines(r.snapshots.start);
  expect(start.at(-1)).toBe(`╰${'─'.repeat(150)}╯`);
  expect(start.at(-2)).toMatch(/● (Opus 5\.5|claude-opus-5-5)( · .+)? │$/);
  expect(start.at(-2)).not.toContain('$');
  // After it: the rule, then the footer: the model by its name alone, no dollars after it.
  const after = lines(r.snapshots.after);
  const [rule, footer] = after.slice(-3, -1);
  expect(rule).toBe(`├${'╌'.repeat(150)}┤`);
  expect(footer).toMatch(/^│ \? for shortcuts {2,}● (Opus 5\.5|claude-opus-5-5) │$/);
  for (const l of [rule, footer, after.at(-1)]) expect(l.length).toBe(152);
  expect(after.at(-1)).toBe(`╰${'─'.repeat(150)}╯`);
  expect(r.snapshots.after).not.toContain('◆');
  expect(r.snapshots.menu).toMatch(/\/usage/);
  // The card: the prompt box's width and corners, the month first
  const card = lines(r.snapshots.card);
  const top = card.findIndex((l) => l.startsWith('╭─ ◆ Usage · Claude API · Opus 5.5'));
  expect(top).toBeGreaterThan(-1);
  expect(card[top]).toHaveLength(152);
  expect(card[top].endsWith('r refresh · s spent · k admin key · esc ─╮')).toBe(true);
  expect(r.snapshots.card).toMatch(/THIS MONTH\s+\w+\s+\$9\.\d\d spent/);
  const bottom = card.findIndex((l, i) => i > top && l.startsWith('╰'));
  expect(card.slice(top, bottom).join('\n')).not.toMatch(/ left|balance|your limit/);
  expect(card[bottom]).toBe(`╰${'─'.repeat(150)}╯`);
  expect(card.slice(top + 1, bottom).every((l) => l.length === 152 && l.startsWith('│ ') && l.endsWith(' │'))).toBe(true);
  expect(r.snapshots.card).toMatch(/THIS MONTH\s+October|THIS MONTH\s+\w+/);
  expect(r.snapshots.card).toContain('999 of 1,000');
  // The prompt cache (13 Oct 2026): the stand-in reads 900 tokens of each answer's ~2,100 from it, so under half, on
  // the request's end line and in the card's CACHE row
  expect(r.snapshots.after.replace(/\s+/g, ' ')).toMatch(/for this request · 4\d% from the cache/);
  expect(r.snapshots.card).toMatch(/CACHE {9}4\d% of what was sent today came from the cache · saved \$0\.00 · 14 days 4\d%/);
  // r: one tiny request, its limits kept
  const tiny = claude.seen.filter((s) => s.path.startsWith('/v1/messages') && s.body?.max_tokens === 64);
  expect(tiny).toHaveLength(1);
  expect(tiny[0].body.messages).toEqual([{ role: 'user', content: 'Reply with the single word: ok' }]);
  // esc: the card goes, the footer comes back
  expect(r.snapshots.closed).not.toContain('THIS MONTH');
  expect(lines(r.snapshots.closed).at(-2)).toMatch(/● (Opus 5\.5|claude-opus-5-5) │$/);
  // /usage limit 200 and /usage balance 201: said to be gone, nothing kept, still no dollars in the footer
  for (const s of [r.snapshots.limit, r.snapshots.balance]) {
    expect(s.replace(/\s+/g, ' ')).toContain('/usage no longer keeps a balance or a limit');
    expect(lines(s).at(-2)).not.toContain('$');
  }
  expect(r.snapshots.balance.match(/no longer keeps a balance or a limit/g)?.length).toBe(2);
  const ownFile = join(base, 'home', 'usage', 'claude-own.json');
  const own = existsSync(ownFile) ? JSON.parse(readFileSync(ownFile, 'utf8')) : {};
  expect(own).not.toHaveProperty('limit');
  expect(own).not.toHaveProperty('balance');
}, T * 2);

// 19 Nov 2026, the owner: "i just changed the api key but my $ amount stayed the same". The key's account is asked for
// at once (the model list, free), and the month is that account's: the dollars from before accounts were kept are named
// in the card, not counted; a reply's dollars go to the account it names.
test('on the Claude API with a key of its own account: the month counts that account only, learned at once, and the card says so', async () => {
  const { startFakeAnthropic } = await import('./fake-anthropic.mjs');
  const { cwd, env, base } = setup();
  const KEY = 'test-anthropic-key-0123456789';
  const claude = await startFakeAnthropic([{ text: 'Hello from Claude.' }], { orgs: { [KEY]: 'org-test-1111' }, limits: { requests: [1000, 999], input: [2_000_000, 1_996_000], output: [400_000, 399_000] } });
  const r0 = { source: 'claude', address: claude.url, port: null, connect: 'http', kind: 'claude', model: 'claude-opus-5-5', context: 0, key: true, keyEnd: '6789', keyId: 'claude' };
  writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify({ remote: { ...r0, use: true }, remotes: { claude: r0 } }));
  // $9.85 today from before accounts were kept (another window's file, no account named)
  const t = new Date();
  const day = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  mkdirSync(join(base, 'home', 'spend', day), { recursive: true });
  writeFileSync(join(base, 'home', 'spend', day, '1.json'), JSON.stringify({ usd: 9.85, service: 'api.anthropic.com', byService: { 'api.anthropic.com': 9.85 }, byKind: { claude: 9.85 } }));
  const r = await runInPty({ cwd, env: { ...env, ...NO_ENV_KEYS, TZ: 'UTC' }, args: ['--no-flows'], cols: 152, rows: 44, timeoutMs: 90_000, steps: [
    { wait: ON_REMOTE, ms: 25_000 }, { sleep: 600 },
    { type: '/usage' }, { key: 'enter' }, { wait: 'organization …1111', ms: 10_000 }, { sleep: 300 }, { snapshot: 'start' },
    { key: 'esc' }, { waitGone: 'THIS MONTH' }, { sleep: 200 },
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from Claude.', ms: 20_000 }, { sleep: 800 }, { snapshot: 'after' },
    { type: '/usage' }, { key: 'enter' }, { wait: 'THIS MONTH' }, { sleep: 300 }, { snapshot: 'card' },
    { key: 'esc' }, { waitGone: 'THIS MONTH' }, { sleep: 200 },
    ...quit,
  ] });
  await claude.close();
  expect(r.snapshots.start).toMatch(/THIS MONTH\s+\w+\s+\$0\.00 spent/); // the account's month: none of the $9.85
  expect(claude.seen.some((s) => s.method === 'GET' && s.path.startsWith('/v1/models?limit=1'))).toBe(true); // asked for free
  expect(lines(r.snapshots.after).at(-2)).not.toContain('$'); // the footer has no dollars
  expect(r.snapshots.card).toMatch(/THIS MONTH\s+\w+\s+\$0\.0[1-9] spent/); // the reply's cents, not the $9.85
  expect(r.snapshots.card).toContain('account: organization …1111, the key in use’s · only its dollars count');
  expect(r.snapshots.card).toContain('$9.85 earlier this month came before keys were told apart: not counted');
  expect(r.snapshots.card).toContain('999 of 1,000');
  const kept = JSON.parse(readFileSync(join(base, 'home', 'usage', 'claude.json'), 'utf8'));
  expect(kept.org).toBe('org-test-1111');
  expect(JSON.stringify(kept)).not.toContain(KEY); // the key's mark only, never the key
}, T * 2);

test('on a model that is not the Claude API: no bar, no /usage in the menu, and typed in full it says where it works', async () => {
  const { cwd, env } = setup();
  const srv = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', srv.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'start' },
    { type: '/us' }, { sleep: 400 }, { snapshot: 'menu' },
    { key: 'backspace' }, { key: 'backspace' }, { key: 'backspace' }, { type: '/usage' }, { key: 'enter' }, { wait: 'shows what the Claude API has cost' }, { snapshot: 'typed' },
    ...quit,
  ] });
  await srv.close();
  expect(lines(r.snapshots.start).filter(Boolean).at(-2)).toContain('? for shortcuts'); // inside the box, over its bottom edge
  expect(r.snapshots.start).not.toMatch(/\$[\d.]+ (left|this month)/);
  expect(r.snapshots.menu).not.toMatch(/\/usage\s/);
  expect(r.snapshots.typed.replace(/\s+/g, ' ')).toContain('/remote claude connects it');
}, T);
