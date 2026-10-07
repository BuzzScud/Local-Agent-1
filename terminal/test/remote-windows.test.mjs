// Several windows at once on /remote: each window's after-close memory save goes to the service
// that window used, not to the one another window saved since.
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dir, '..', '..');
// Runs `script` in a fresh bun with its own home (settings are read from it at import).
function inHome(script, settings) {
  const base = mkdtempSync(join(tmpdir(), 'agentic-rw-'));
  mkdirSync(join(base, 'home'), { recursive: true });
  if (settings) writeFileSync(join(base, 'home', 'settings.json'), JSON.stringify(settings));
  const r = spawnSync('bun', ['-e', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, AGENTIC_HOME: join(base, 'home'), AGENTIC_MEMORY_SAVE: 'off' }, timeout: 30_000 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').at(-1));
}

test('own service: a window\'s save after close goes to its own service; an old job (true) to the saved one', () => {
  const saved = { remote: { use: true, source: 'openai', kind: 'openai', address: 'ollama.example', port: 11434, connect: 'http', model: 'qwen3', key: false } };
  const out = inHome(`
    const { jobRemote } = await import('./terminal/src/app/autosave.mjs');
    const mine = { source: 'openai', kind: 'openai', address: 'openrouter.ai/api', connect: 'https', model: 'qwen/qwen3-coder', key: true };
    console.log(JSON.stringify({ own: jobRemote({ cwd: '/tmp', remote: mine }), old: jobRemote({ cwd: '/tmp', remote: true }) }));
  `, saved);
  expect(out.own.address).toBe('openrouter.ai/api');
  expect(out.old.address).toBe('ollama.example');
});

test('own service: what a window keeps for its save never holds a typed key', () => {
  const out = inHome(`
    const { remoteConfOf } = await import('./terminal/src/app/App.jsx');
    console.log(JSON.stringify(remoteConfOf({ kind: 'openai', address: 'a', key: 'test-typed-key-0123456789' })));
  `);
  expect(out.key).toBe(true);
  expect(JSON.stringify(out)).not.toContain('test-typed-key');
});

// The cost meter: its own home, so the real one is never written.
process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-rw-home-'));
const { costOf, recordSpend, todaySpend, spendLabel, windowSpend, money, dayOf } = await import('../src/agent/spend.mjs');
const { footerParts } = await import('../src/app/screen.jsx');
const { meterWords } = await import('../src/app/remote-footer.mjs');

test('cost: the service\'s own figure first, else its prices ($ a million; cached input a tenth, written to the cache a quarter more), else not known', () => {
  expect(costOf({ prompt_tokens: 1000, completion_tokens: 100, cost: 0.0123 }, { in: 4, out: 20 })).toBe(0.0123);
  expect(costOf({ prompt_tokens: 1_000_000, completion_tokens: 100_000 }, { in: 4, out: 20 })).toBeCloseTo(6, 6);
  expect(costOf({ prompt_tokens: 1_000_000, completion_tokens: 0, cached_tokens: 1_000_000 }, { in: 4, out: 20 })).toBeCloseTo(0.4, 6);
  // The Claude API: 1M read from the cache, 1M written to it, 1M plain: 0.4 + 5 + 4.
  expect(costOf({ prompt_tokens: 3_000_000, completion_tokens: 0, cached_tokens: 1_000_000, cache_write_tokens: 1_000_000 }, { in: 4, out: 20 })).toBeCloseTo(9.4, 6);
  expect(costOf({ prompt_tokens: 10, completion_tokens: 10 }, null)).toBe(null);
  expect(money(0.004)).toBe('$0.004');
  expect(money(0.31)).toBe('$0.31');
});

test('cost: each window its own file a day; today adds every window; a free service counts nothing; unknown counts tokens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-spend-'));
  const paid = { remote: true, label: 'svc', price: { in: 1, out: 2 } };
  const now = new Date();
  recordSpend(paid, { prompt_tokens: 1_000_000, completion_tokens: 0 }, { dir, pid: 111, now });
  recordSpend(paid, { prompt_tokens: 0, completion_tokens: 1_000_000 }, { dir, pid: 111, now });
  recordSpend(paid, { prompt_tokens: 500_000, completion_tokens: 0 }, { dir, pid: 222, now });
  expect(recordSpend({ remote: true, free: true }, { prompt_tokens: 9, completion_tokens: 9 }, { dir, pid: 333, now })).toBe(0);
  expect(recordSpend({ remote: true, label: 'x' }, { prompt_tokens: 1200, completion_tokens: 300 }, { dir, pid: 444, now })).toBe(null);
  expect(recordSpend({ remote: false }, { prompt_tokens: 1, completion_tokens: 1 }, { dir, pid: 555, now })).toBe(null); // this Mac's model: no meter
  const t = todaySpend({ dir, now });
  expect(t.usd).toBeCloseTo(3.5, 6);
  expect(t.windows).toBe(3); // 111, 222 and the unpriced 444; the free one spent nothing
  const y = new Date(now.getTime() - 86_400_000);
  expect(todaySpend({ dir, now: y }).usd).toBe(0);
  expect(dayOf(new Date(2026, 9, 2))).toBe('2026-10-02');
});

test('cost: the footer words — dollars, tokens when the price is not known, nothing before any spend', () => {
  expect(spendLabel({ usd: 0.03, unpriced: 0 }, { usd: 0.31, windows: 3 })).toBe('$0.03 this window · $0.31 today, 3 windows');
  expect(spendLabel({ usd: 0.03, unpriced: 0 }, { usd: 0.03, windows: 1 })).toBe('$0.03 this window · $0.03 today');
  expect(spendLabel({ usd: 0, unpriced: 2, tokensIn: 12_800, tokensOut: 400 }, { usd: 0, windows: 1 })).toBe('12.8k sent · 400 back');
  expect(spendLabel({ usd: 0, unpriced: 0 }, { usd: 1, windows: 2 })).toBe('');
});

test('cost: on a remote the meter is in /meters, not the footer (design 2, 2 Oct 2026), and the label keeps its click cells', () => {
  const base = { mode: 'default', width: 113, modelState: { remote: true, state: 'on', name: 'qwen3-coder', where: 'openrouter' } };
  const meter = '$0.03 this window · $0.31 today, 3 windows';
  const wide = footerParts({ ...base, spend: meter });
  expect(wide.spend).toBe('');
  expect(wide.labelAt).toEqual(footerParts(base).labelAt);
  expect(meterWords({ spend: meter })).toEqual([meter]);
});
