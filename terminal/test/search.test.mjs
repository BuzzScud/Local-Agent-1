// /effort's Search rows (src/agent/search.mjs): the word search and the
// fusion behind Retriever: Hybrid, the reranker's choice, and that each
// search (the saved facts, Read first's files, the code search) still lets
// through as many pieces as its own rule says: the rows only choose which.
import { test, expect, beforeAll } from 'bun:test';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeEmbedder } from './fake-embedder.mjs';

let search, recall, memoryDirs, applyChanges, rankFiles, CodeIndex, serverArgs, RERANKERS, DEFAULT_RERANKER;
beforeAll(async () => {
  process.env.AGENTIC_HOME ??= mkdtempSync(join(tmpdir(), 'agentic-search-home-'));
  search = await import('../src/agent/search.mjs');
  ({ recall } = await import('../src/agent/recall.mjs'));
  ({ memoryDirs, applyChanges } = await import('../src/agent/facts.mjs'));
  ({ rankFiles } = await import('../src/agent/rank.mjs'));
  ({ CodeIndex } = await import('../src/tools/codeindex.mjs'));
  ({ serverArgs, RERANKERS, DEFAULT_RERANKER } = await import('../../models/index.mjs'));
});

// A stand-in reranker: scores a text by the words it likes, and counts its calls.
const fakeReranker = (likes, { fail = false } = {}) => {
  const r = { model: { id: 'fake-rerank', pool: 15, chars: 700 }, calls: [], scores: async (query, texts) => {
    if (fail) throw new Error('not running');
    r.calls.push({ query, texts });
    return texts.map((t) => likes.filter((w) => t.toLowerCase().includes(w)).length);
  } };
  return r;
};

test('words: names split at their humps; BM25 puts the text sharing the most words first; RRF merges two orders', () => {
  expect(search.terms('rankFiles uses MIN_CLOSE and the HTTPServer')).toEqual(['rank', 'files', 'uses', 'min', 'close', 'http', 'server']);
  const w = new search.Words([search.terms('the invoice list'), search.terms('invoiceTotal adds the lines'), search.terms('draw the chart')]);
  expect(w.order('where is invoiceTotal')).toEqual([1, 0]);
  expect(w.order('nothing shared here at all')).toEqual([]);
  // a key high in both lists wins; one only in the second still comes
  expect(search.rrf([['a', 'b', 'c'], ['b', 'd']])).toEqual(['b', 'a', 'd', 'c']);
});

test('choose: on Meaning with no reranker it is the first n, as before; Hybrid brings a piece only the words found', async () => {
  const byMeaning = ['a', 'b', 'c', 'd'];
  expect((await search.choose({ query: 'q', byMeaning, n: 2 })).picked).toEqual(['a', 'b']);
  expect((await search.choose({ query: 'q', byMeaning, n: 0, reranker: fakeReranker([]) })).picked).toEqual([]);
  const h = await search.choose({ query: 'q', byMeaning, byWords: ['x', 'a'], n: 2, retriever: 'hybrid' });
  expect(h.order).toBe('hybrid');
  expect(h.picked).toEqual(['a', 'x']); // a is high in both; x is first by words
  // the words are left out while the retriever is Meaning
  expect((await search.choose({ query: 'q', byMeaning, byWords: ['x'], n: 2 })).picked).toEqual(['a', 'b']);
});

test('choose with a reranker: the same number come, the reranker says which; one that fails leaves the order, with a note', async () => {
  const texts = { a: 'about apples', b: 'about bananas', c: 'about cherries', d: 'the tests and cherries' };
  const rr = fakeReranker(['cherries', 'tests']);
  const c = await search.choose({ query: 'which fruit', byMeaning: ['a', 'b', 'c', 'd'], n: 2, text: (k) => texts[k], reranker: rr });
  expect(c.reranked).toBe(true);
  expect(c.picked).toEqual(['d', 'c']);
  expect(rr.calls[0].texts).toHaveLength(4); // all of them fit the pool of 15
  const down = await search.choose({ query: 'q', byMeaning: ['a', 'b', 'c'], n: 1, text: (k) => texts[k], reranker: fakeReranker([], { fail: true }) });
  expect(down.picked).toEqual(['a']);
  expect(down.note).toContain('did not answer');
  expect(search.howChosen(c)).toBe('by meaning, reranked');
  expect(search.howChosen({ order: 'hybrid', reranked: false })).toBe('by meaning + words');
  // stopped (esc): it stops too
  const ac = new AbortController();
  ac.abort();
  const stopped = { model: {}, scores: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } };
  await expect(search.choose({ query: 'q', byMeaning: ['a'], n: 1, reranker: stopped, signal: ac.signal })).rejects.toThrow('aborted');
});

function place() {
  const home = mkdtempSync(join(tmpdir(), 'agentic-search-'));
  const repo = join(home, 'work', 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  cpSync(join(import.meta.dir, '..', 'demo-project'), repo, { recursive: true });
  const dirs = memoryDirs(repo, home);
  applyChanges(dirs.project, { add: [
    { kind: 'project', text: 'Run the tests with `node --test`.' },
    { kind: 'project', text: 'The test fixtures live in test/fixtures.' },
    { kind: 'project', text: 'Every page about Agentic Coder is saved in the DOCS folder.' },
  ] }, { today: '2026-09-29' });
  return { home, repo };
}

test('saved facts: the reranker picks which of the close ones come, never more than the cut-off lets through, never one for a request nothing fits', async () => {
  const { home, repo } = place();
  const embedder = new FakeEmbedder({ cut: 0.5, margin: 0.5 });
  const plain = await recall(repo, 'can you check the suite still passes', { embedder, home, mark: false });
  const rr = fakeReranker(['fixtures']);
  const reranked = await recall(repo, 'can you check the suite still passes', { embedder, home, mark: false, reranker: rr });
  expect(reranked.facts).toHaveLength(plain.facts.length);
  expect(reranked.facts[0].text).toContain('fixtures');
  expect(reranked.chosen.reranked).toBe(true);
  const none = await recall(repo, 'whats the capital of brazil', { embedder, home, mark: false, reranker: rr });
  expect(none.facts).toEqual([]);
});

test('Read first: the reranker chooses among the files; how many is still the ranking\'s; Hybrid is said on the result', async () => {
  const d = mkdtempSync(join(tmpdir(), 'agentic-search-rank-'));
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'weather.mjs'), '// The weather widget: clouds and sun.\nexport function weatherIcon(kind) { return kind; }\n');
  writeFileSync(join(d, 'src', 'forecast.mjs'), '// The weather forecast for tomorrow.\nexport function forecast(days) { return days; }\n');
  writeFileSync(join(d, 'src', 'billing.mjs'), '// Invoices.\nexport function invoiceTotal(lines) { return 0; }\n');
  const embedder = { model: { file: 'fake.gguf' }, embed: async (texts) => texts.map((t) => { const v = [t.toLowerCase().includes('weather') ? 1 : 0.05, t.toLowerCase().includes('invoice') ? 1 : 0.05]; const n = Math.hypot(...v); return Float32Array.from(v.map((x) => x / n)); }) };
  const plain = await rankFiles(d, 'the weather', { embedder });
  const rr = fakeReranker(['forecast']);
  const r = await rankFiles(d, 'the weather', { embedder, reranker: rr, retriever: 'hybrid' });
  expect(r.files).toHaveLength(plain.files.length);
  expect(r.files[0].rel).toBe('src/forecast.mjs');
  expect(r.chosen).toMatchObject({ order: 'hybrid', reranked: true });
});

test('the code search\'s word half finds a function by its exact name, from the file as it is', async () => {
  const d = mkdtempSync(join(tmpdir(), 'agentic-search-code-'));
  writeFileSync(join(d, 'billing.mjs'), '// Money in.\nexport function invoiceTotal(lines) {\n  return lines.reduce((s, l) => s + l.amount, 0);\n}\n\nexport function taxOf(total) {\n  return total * 0.2;\n}\n');
  writeFileSync(join(d, 'charts.mjs'), '// Pictures.\nexport function drawChart(points) {\n  return points.map((p) => p * 2);\n}\n');
  const index = new CodeIndex(d, new FakeEmbedder(), { dir: mkdtempSync(join(tmpdir(), 'agentic-search-maps-')) });
  await index.build();
  const found = index.wordSearch('invoiceTotal gives the wrong sum');
  expect(found[0]).toMatchObject({ rel: 'billing.mjs', name: 'invoiceTotal' });
  expect(index.textOf(found[0])).toContain('lines.reduce');
  expect(index.wordSearch('zzz nothing')).toEqual([]);
});

test('the reranker runs in the engine\'s reranking mode, on its own server', () => {
  const m = RERANKERS[DEFAULT_RERANKER];
  expect(m.kind).toBe('rerank');
  const args = serverArgs(m, { port: 17611 });
  expect(args).toContain('--rerank');
  expect(args.slice(args.indexOf('-c'), args.indexOf('-c') + 2)).toEqual(['-c', String(m.ctx)]);
  expect(args).not.toContain('--jinja');
});
