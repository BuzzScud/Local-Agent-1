// The code set (LABELS=code-labels-names.json for the 5 exact-name requests;
// POOL and CH set how many pieces the reranker reads and how much of each).
// Part of the 29 Sep 2026 reranker bake-off (README.md here). The rerankers
// run in Agentic Coder's own engine (llama-server --rerank); the jina files are
// downloaded by hand into BAKEOFF_MODELS (README.md lists them), Qwen3-Reranker
// and BGE-M3 come from `coding setup`.
import { join } from 'node:path';
import { serverBinOf, modelPath, MODELS, DEFAULT_MODEL, EMBEDDERS, DEFAULT_EMBEDDER, RERANKERS, DEFAULT_RERANKER, HOME } from '../../../../index.mjs';
const ENG = serverBinOf(MODELS[DEFAULT_MODEL]);
const HAND = process.env.BAKEOFF_MODELS ?? join(HOME, 'models', 'bakeoff');
const BGE = modelPath(EMBEDDERS[DEFAULT_EMBEDDER]);
const QWEN = modelPath(RERANKERS[DEFAULT_RERANKER]);
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { CodeIndex } from '../../../../../terminal/index.mjs';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const DIR = new URL('.', import.meta.url).pathname;
const REPO = new URL('../../../../../', import.meta.url).pathname;
const servers = [];
async function start(args, port) {
  const p = spawn(ENG, [...args, '--host', '127.0.0.1', '--port', String(port), '--no-webui', '-np', '1'], { stdio: 'ignore' }); servers.push(p);
  for (let t = Date.now(); Date.now() - t < 60000;) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return `http://127.0.0.1:${port}`; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('no start');
}
try {
const embUrl = await start(['-m', BGE, '--embedding', '--pooling', 'cls', '-c', '2048', '-ub', '2048', '-ngl', '99'], 17699);
const rr = {
  'jina-tiny': await start(['-m', join(HAND, 'jina-reranker-v1-tiny-en-Q8_0.gguf'), '--rerank', '-c', '8192', '-ub', '8192', '-b', '8192', '-ngl', '0', '-t', '4'], 17697),
  'jina-turbo': await start(['-m', join(HAND, 'Jina-Bert-Implementation-38M-F16.gguf'), '--rerank', '-c', '8192', '-ub', '8192', '-b', '8192', '-ngl', '0', '-t', '4'], 17696),
  'qwen3-0.6b': await start(['-m', QWEN, '--rerank', '-c', '8192', '-ub', '8192', '-b', '8192', '-ngl', '99'], 17695),
};
const embedder = { model: { file: 'bge-m3-Q8_0.gguf' }, async embed(texts) { const out = []; for (let i = 0; i < texts.length; i += 16) { const j = await (await fetch(`${embUrl}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: texts.slice(i, i + 16).map((t) => String(t).slice(0, 4000)) }) })).json(); for (const r of j.data.sort((a, b) => a.index - b.index)) { const v = Float32Array.from(r.embedding); const n = Math.hypot(...v) || 1; out.push(v.map((x) => x / n)); } } return out; } };
// The code the requests are about: a copy of terminal/src and models/runtime, indexed in a throwaway folder.
const cwd = mkdtempSync(join(tmpdir(), 'rerank-bakeoff-'));
cpSync(join(REPO, 'terminal', 'src'), join(cwd, 'terminal', 'src'), { recursive: true });
cpSync(join(REPO, 'models', 'runtime'), join(cwd, 'models', 'runtime'), { recursive: true });
const idx = new CodeIndex(cwd, embedder, { dir: mkdtempSync(join(tmpdir(), 'rerank-bakeoff-maps-')) });
const t0 = Date.now(); await idx.build(); console.log(`index: ${idx.parts.length} parts in ${Math.round((Date.now() - t0) / 1000)} s`);
const text = (p) => { const l = readFileSync(join(cwd, p.rel), 'utf8').split('\n'); return `${p.rel} · ${p.name}\n${l.slice(p.line - 1, p.end).join('\n')}`.slice(0, 1500); };
const words = (t) => (String(t).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).flatMap((w) => w.split(/(?<=[a-z])(?=[A-Z])|_/)).map((w) => w.toLowerCase()).filter((w) => w.length > 2);
// BM25 over every part's text
const docs = idx.parts.map((p) => words(text(p)));
const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length;
const df = new Map(); for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
const bm25 = (q) => { const qs = [...new Set(words(q))]; return docs.map((d) => { const tf = new Map(); for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1); return qs.reduce((s, w) => { const f = tf.get(w) ?? 0; if (!f) return s; const idf = Math.log(1 + (docs.length - df.get(w) + 0.5) / (df.get(w) + 0.5)); return s + idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.length / avg)); }, 0); }); };
const rrf = (lists, k = 60) => { const s = new Map(); for (const l of lists) l.forEach((key, r) => s.set(key, (s.get(key) ?? 0) + 1 / (k + r + 1))); return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x); };
const rerank = async (url, query, docsT) => { const j = await (await fetch(`${url}/v1/rerank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, documents: docsT, top_n: docsT.length }) })).json(); return j.results.sort((a, b) => b.relevance_score - a.relevance_score).map((r) => r.index); };
const labels = JSON.parse(readFileSync(join(DIR, process.env.LABELS ?? 'code-labels.json'), 'utf8'));
const POOL = Number(process.env.POOL ?? 25), CH = Number(process.env.CH ?? 1500);
const key = (p) => `${p.rel}#${p.line}`;
const byKey = new Map(idx.parts.map((p, i) => [key(p), i]));
const isHit = (i, L) => idx.parts[i].rel === L.file && idx.parts[i].name.split(/ › | \(/).includes(L.name);
const stats = {};
const add = (m, order, L, ms = 0) => { const r = order.findIndex((i) => isHit(i, L)); const s = (stats[m] ??= { h1: 0, h3: 0, mrr: 0, ms: 0, n: 0, miss: [] }); s.n++; s.ms += ms; if (r === 0) s.h1++; if (r >= 0 && r < 3) s.h3++; if (r >= 0 && r < 25) s.mrr += 1 / (r + 1); else s.miss.push(L.name); };
for (const L of labels) {
  const found = await idx.search(L.q, { top: 40 });
  const meaning = found.parts.map((p) => byKey.get(key(p)));
  const b = bm25(L.q); const wordsOrder = b.map((s, i) => [s, i]).filter(([s]) => s > 0).sort((a, c) => c[0] - a[0]).slice(0, 40).map(([, i]) => i);
  const hybrid = rrf([meaning, wordsOrder]).slice(0, 40);
  add('meaning (today)', meaning, L); add('words (BM25)', wordsOrder, L); add('hybrid (RRF)', hybrid, L);
  for (const [name, url] of Object.entries(rr)) for (const [pk, pool] of [['meaning', meaning], ['hybrid', hybrid]]) {
    const top = pool.slice(0, POOL); const t = Date.now(); const ord = await rerank(url, L.q, top.map((i) => text(idx.parts[i]).slice(0, CH))); add(`${pk} → ${name}`, ord.map((k) => top[k]), L, Date.now() - t);
  }
}
console.log(`\n${labels.length} requests · hit@1 / hit@3 / MRR (higher is better)`);
for (const [m, s] of Object.entries(stats)) console.log(`${m.padEnd(22)} ${s.h1}/${s.n}  ${s.h3}/${s.n}  ${(s.mrr / s.n).toFixed(2)}${s.ms ? `  · rerank ${Math.round(s.ms / s.n)} ms` : ''}${s.miss.length ? `  · missed: ${s.miss.join(', ')}` : ''}`);
} finally { for (const p of servers) p.kill('SIGTERM'); }
