// /usage and the bar under the footer in the real window (8 Oct 2026), on a stand-in Claude API that
// sends the owner's real limits (fake-anthropic.mjs): the bar under the footer with the footer's ends
// before and after a reply, /usage in the / menu, its card with the prompt box's ends, r asking
// Anthropic once, esc closing it; and none of it on a model that is not the Claude API.
import { test, expect } from 'bun:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInPty } from './pty.mjs';
import { T, setup, quit, ON_REMOTE } from './app-setup.mjs';
import { startFakeServer } from './fake-server.mjs';

const NO_ENV_KEYS = { AGENTIC_REMOTE_KEYSTORE: 'file', AGENTIC_REMOTE_KEY: 'test-anthropic-key-0123456789', ANTHROPIC_API_KEY: '' };
const lines = (text) => text.split('\n').map((l) => l.trimEnd());

test('on the Claude API: the bar under the footer with the footer’s ends, /usage in the menu, its card, r asks once, esc closes it', async () => {
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
    { type: 'hello' }, { key: 'enter' }, { wait: 'Hello from Claude.', ms: 20_000 }, { sleep: 800 }, { snapshot: 'after', has: ['left of $500'] },
    { type: '/us' }, { sleep: 400 }, { snapshot: 'menu' },
    { key: 'enter' }, { wait: 'THIS MONTH' }, { sleep: 300 }, { snapshot: 'card' },
    { type: 'r' }, { wait: 'r refresh', ms: 10_000 }, { sleep: 600 }, { snapshot: 'asked' },
    { key: 'esc' }, { waitGone: 'THIS MONTH' }, { sleep: 300 }, { snapshot: 'closed' },
    ...quit,
  ] });
  await claude.close();
  // Inside the prompt box (the "Panel", 8 Oct 2026; tidied 9 Oct 2026, "1 · Tidy"): under its dotted rule,
  // the footer, then the usage line, each one cell in from the box's border, and the box's bottom edge
  // under them, on the window's last line (no empty line under it: patches/ink@7.1.1.patch).
  // Before a reply: the line is there (its row counted, nothing scrolled), the cap not known yet
  const start = lines(r.snapshots.start);
  expect(start.at(-1)).toBe(`╰${'─'.repeat(150)}╯`);
  expect(start.at(-2)).toMatch(/^│ ◆ \$9\.85 this month {2}─+ {2}today \$0\.00 · the cap shows after a reply │$/);
  // After it: the rule, the footer, then the usage line under it: all four rows end at the box's edges,
  // the footer's words and the line's ending on the same column. The model goes by its name alone (the
  // line says it is the Claude API) and the mode by its short name.
  const after = lines(r.snapshots.after);
  const [rule, footer, bar] = after.slice(-4, -1);
  expect(rule).toBe(`├${'╌'.repeat(150)}┤`);
  expect(footer).toMatch(/^│ \? for shortcuts {2,}● (Opus 5\.5|claude-opus-5-5) │$/);
  expect(bar).toMatch(/^│ ◆ \$490\.1\d left of \$500 {2}━[━╸─]{12,} {2}today \$0\.01 │$/);
  for (const l of [rule, footer, bar, after.at(-1)]) expect(l.length).toBe(152);
  expect(after.at(-1)).toBe(`╰${'─'.repeat(150)}╯`);
  expect(r.snapshots.menu).toMatch(/\/usage/);
  // The card: the prompt box's width and corners, the month first
  const card = lines(r.snapshots.card);
  const top = card.findIndex((l) => l.startsWith('╭─ ◆ Usage · Claude API · Opus 5.5'));
  expect(top).toBeGreaterThan(-1);
  expect(card[top]).toHaveLength(152);
  expect(card[top].endsWith('r refresh · esc close ─╮')).toBe(true);
  const bottom = card.findIndex((l, i) => i > top && l.startsWith('╰'));
  expect(card[bottom]).toBe(`╰${'─'.repeat(150)}╯`);
  expect(card.slice(top + 1, bottom).every((l) => l.length === 152 && l.startsWith('│ ') && l.endsWith(' │'))).toBe(true);
  expect(r.snapshots.card).toMatch(/THIS MONTH\s+October|THIS MONTH\s+\w+/);
  expect(r.snapshots.card).toContain('999 of 1,000');
  // r: one tiny request, its limits kept
  const tiny = claude.seen.filter((s) => s.path.startsWith('/v1/messages') && s.body?.max_tokens === 64);
  expect(tiny).toHaveLength(1);
  expect(tiny[0].body.messages).toEqual([{ role: 'user', content: 'Reply with the single word: ok' }]);
  // esc: the card goes, the footer and the bar come back
  expect(r.snapshots.closed).not.toContain('THIS MONTH');
  expect(lines(r.snapshots.closed).at(-2)).toMatch(/^│ ◆ /);
}, T * 2);

test('on a model that is not the Claude API: no bar, no /usage in the menu, and typed in full it says where it works', async () => {
  const { cwd, env } = setup();
  const srv = await startFakeServer([]);
  const r = await runInPty({ cwd, env, args: ['--url', srv.url, '--no-flows'], steps: [
    { wait: '? for shortcuts' }, { sleep: 300 }, { snapshot: 'start' },
    { type: '/us' }, { sleep: 400 }, { snapshot: 'menu' },
    { key: 'backspace' }, { key: 'backspace' }, { key: 'backspace' }, { type: '/usage' }, { key: 'enter' }, { wait: 'shows what the Claude API has left' }, { snapshot: 'typed' },
    ...quit,
  ] });
  await srv.close();
  expect(lines(r.snapshots.start).filter(Boolean).at(-2)).toContain('? for shortcuts'); // inside the box, over its bottom edge
  expect(r.snapshots.start).not.toContain('◆');
  expect(r.snapshots.menu).not.toMatch(/\/usage\s/);
  expect(r.snapshots.typed.replace(/\s+/g, ' ')).toContain('/remote claude connects it');
}, T);
