// Files ranked by meaning before the first step (src/agent/rank.mjs), the
// fix/change paths' file choice without asking the model when one file is a
// clear winner (flows/localize.mjs), and the counts on the done line.
import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let rankFiles, MIN_CLOSE, pickFile, doneCounts;
beforeAll(async () => {
  process.env.AGENTIC_HOME = mkdtempSync(join(tmpdir(), 'agentic-rank-home-'));
  ({ rankFiles, MIN_CLOSE } = await import('../src/agent/rank.mjs'));
  ({ pickFile } = await import('../src/flows/localize.mjs'));
  ({ doneCounts } = await import('../src/app/screen.jsx'));
});

// A project with one file per topic.
function project() {
  const d = mkdtempSync(join(tmpdir(), 'agentic-rank-'));
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'weather.mjs'), '// The weather widget: clouds, sun and rain icons.\nexport function weatherIcon(kind) { return kind; }\n');
  writeFileSync(join(d, 'src', 'billing.mjs'), '// Invoices and payments.\nexport function invoiceTotal(lines) { return 0; }\n');
  writeFileSync(join(d, 'src', 'login.mjs'), '// Sign-in form and sessions.\nexport function signIn(user) { return user; }\n');
  writeFileSync(join(d, 'src', 'charts.mjs'), '// Line and bar charts.\nexport function drawChart(points) { return points; }\n');
  return d;
}

// A stand-in for the small model: one number per topic word, so "closeness"
// is how much two texts share a topic. It counts what it was asked to embed.
const TOPICS = ['weather', 'invoice', 'sign', 'chart'];
function fakeEmbedder() {
  const e = { model: { file: 'fake.gguf' }, calls: [], embed: async (texts) => {
    e.calls.push(texts.length);
    return texts.map((t) => {
      const v = TOPICS.map((w) => (t.toLowerCase().includes(w) ? 1 : 0.05));
      const n = Math.hypot(...v);
      return Float32Array.from(v.map((x) => x / n));
    });
  } };
  return e;
}

test('the file a request is about comes first, and only files close to it are given', async () => {
  const cwd = project();
  const e = fakeEmbedder();
  const r = await rankFiles(cwd, 'use clouds and sun for the weather icons', { embedder: e });
  expect(r.how).toBe('meaning');
  expect(r.files.map((f) => f.rel)).toEqual(['src/weather.mjs']);
  expect(r.files[0].score).toBeGreaterThanOrEqual(MIN_CLOSE);
});

test('a file\'s numbers are kept: the second request embeds only the request', async () => {
  const cwd = project();
  const e = fakeEmbedder();
  await rankFiles(cwd, 'the weather icons', { embedder: e });
  expect(e.calls).toEqual([4, 1]); // four cards, then the request
  await rankFiles(cwd, 'the invoice total is wrong', { embedder: e });
  expect(e.calls).toEqual([4, 1, 1]);
  // a changed file is worked out again, alone
  writeFileSync(join(cwd, 'src', 'charts.mjs'), '// Pie charts now too.\nexport function drawChart(points) { return points; }\nexport function drawPie() {}\n');
  await rankFiles(cwd, 'the chart legend', { embedder: e });
  expect(e.calls).toEqual([4, 1, 1, 1, 1]);
});

test('without the small model, files are ranked by the request\'s words', async () => {
  const cwd = project();
  const r = await rankFiles(cwd, 'fix drawChart in charts', {});
  expect(r.how).toBe('words');
  expect(r.files[0].rel).toBe('src/charts.mjs');
  // nothing in common: nothing given
  expect((await rankFiles(cwd, 'hello there', {})).files).toEqual([]);
});

test('the fix/change paths take a clear winner without asking the model', async () => {
  const cwd = project();
  const files = ['src/weather.mjs', 'src/billing.mjs', 'src/login.mjs', 'src/charts.mjs'];
  // url points nowhere: asking the model would fail the test
  const picked = await pickFile({ url: 'http://127.0.0.1:9', model: {}, cwd, task: 'the weather icons show the wrong sun', files, embedder: fakeEmbedder() });
  expect(picked).toBe('src/weather.mjs');
});

test('the done line says where the time went; zero counts and old sessions show nothing extra', () => {
  expect(doneCounts({ steps: 9, reads: 4, thinkTokens: 1820 })).toBe(' · 9 steps · 4 reads · ~1,820 thinking tokens');
  expect(doneCounts({ steps: 1, reads: 1, thinkTokens: 0 })).toBe(' · 1 step · 1 read');
  expect(doneCounts({})).toBe('');
  // The window's total since it opened (4 Oct 2026, the owner's pick: on the spinner and end lines).
  expect(doneCounts({ steps: 12, thinkTokens: 2300, session: 32040 })).toBe(' · 12 steps · ~2,300 thinking tokens · ↓ 32.0k tokens this session');
  expect(doneCounts({ session: 840 })).toBe(' · ↓ 840 tokens this session');
});
