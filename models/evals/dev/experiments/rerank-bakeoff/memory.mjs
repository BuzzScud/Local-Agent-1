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
// The memory set: which search picks the right saved facts?
// Scoring as in the 26 Sep test: right = the wanted fact comes back (or nothing
// when nothing is wanted); wrong = a fact outside want+ok comes back. Cut-offs
// are set on the 15 'tune' requests, then the 30 'test' requests are scored.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const S = JSON.parse(readFileSync(new URL('../../../bench/memory/recall-set.json', import.meta.url), 'utf8'));
const servers = [];
async function start(args, port) {
  const p = spawn(ENG, [...args, '--host', '127.0.0.1', '--port', String(port), '--no-webui', '-np', '1'], { stdio: 'ignore' });
  servers.push(p);
  for (let t = Date.now(); Date.now() - t < 60000;) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return `http://127.0.0.1:${port}`; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('no start');
}
const embUrl = await start(['-m', BGE, '--embedding', '--pooling', 'cls', '-c', '2048', '-ub', '2048', '-ngl', '99'], 17699);
const rr = {
  'jina-tiny': await start(['-m', join(HAND, 'jina-reranker-v1-tiny-en-Q8_0.gguf'), '--rerank', '-c', '8192', '-ub', '8192', '-b', '8192', '-ngl', '0', '-t', '4'], 17697),
  'jina-turbo': await start(['-m', join(HAND, 'Jina-Bert-Implementation-38M-F16.gguf'), '--rerank', '-c', '8192', '-ub', '8192', '-b', '8192', '-ngl', '0', '-t', '4'], 17696),
  'qwen3-0.6b': await start(['-m', QWEN, '--rerank', '-c', '8192', '-ub', '8192', '-b', '8192', '-ngl', '99'], 17695),
};
const embed = async (texts) => { const j = await (await fetch(`${embUrl}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: texts }) })).json(); return j.data.sort((a, b) => a.index - b.index).map((r) => { const v = r.embedding; const n = Math.hypot(...v) || 1; return v.map((x) => x / n); }); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const rerank = async (url, query, docs) => { const j = await (await fetch(`${url}/v1/rerank`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, documents: docs, top_n: docs.length }) })).json(); const out = new Array(docs.length); for (const r of j.results) out[r.index] = r.relevance_score; return out; };
// words, the recall.mjs way (idf, needs 2 shared words)
const STOP = new Set('a an the and or of to in on at for with from by is are was were be it its this that these those i me my we our you your do does did can could should would will what where when why how which who not no so as if then than there here have has had one only each every all any some more most such also into out up down over under again very just about before after'.split(' '));
const wordsOf = (t) => (String(t).toLowerCase().replace(/z-index/g, 'zindex').match(/[a-z0-9][a-z0-9_+#-]*/g) ?? []).map((w) => { w = w.replace(/^[-_]+|[-_]+$/g, ''); if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1); return w; }).filter((w) => w.length > 1 && !STOP.has(w));
const F = S.facts;
const docs = F.map((f) => new Set(wordsOf(f.text)));
const df = new Map(); for (const d of docs) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
const wordScore = (q) => { const qs = new Set(wordsOf(q)); return docs.map((d) => [...qs].filter((w) => d.has(w)).reduce((s, w) => s + Math.log(1 + F.length / df.get(w)), 0)); };
const FV = await embed(F.map((f) => f.text));
const rrf = (lists, k = 60) => { const s = new Map(); for (const l of lists) l.forEach((i, r) => s.set(i, (s.get(i) ?? 0) + 1 / (k + r + 1))); return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i); };

// Per request: every method's scored candidates [{i, score}] (higher = better)
async function candidates(q) {
  const [qv] = await embed([q]);
  const close = FV.map((v) => dot(qv, v));
  const byMeaning = close.map((c, i) => i).sort((a, b) => close[b] - close[a]);
  const ws = wordScore(q);
  const byWords = ws.map((c, i) => i).filter((i) => ws[i] > 0).sort((a, b) => ws[b] - ws[a]);
  const pool = { meaning: byMeaning.slice(0, 10), hybrid: rrf([byMeaning.slice(0, 10), byWords.slice(0, 10)]).slice(0, 10) };
  const out = { today: close.map((c, i) => ({ i, score: c })) };
  for (const [name, url] of Object.entries(rr)) for (const [pk, ids] of Object.entries(pool)) {
    const t = Date.now();
    const sc = await rerank(url, q, ids.map((i) => F[i].text));
    out[`${pk} → ${name}`] = ids.map((i, k) => ({ i, score: sc[k] }));
    (out.ms ??= {})[`${pk} → ${name}`] = Date.now() - t;
  }
  // gated: BGE-M3 decides whether anything fits (its own cut), the reranker orders the top 10
  const gateOk = Math.max(...close) >= 0.56;
  for (const name of Object.keys(rr)) { const k = `meaning → ${name}`; out[`gated → ${name}`] = gateOk ? out[k] : []; out.ms[`gated → ${name}`] = out.ms[k]; }
  return out;
}
// the app's pick rule: best ≥ cut, others ≥ best − margin, at most 3
const pick = (c, cut, margin) => { const s = [...c].sort((a, b) => b.score - a.score); const best = s[0]?.score ?? -Infinity; return s.filter((x) => x.score >= cut && x.score >= best - margin).slice(0, 3).map((x) => F[x.i].id); };
// 'same count': what the app does (agent/search.mjs choose): BGE-M3's own rule
// says how many facts come, the reranker says which of its best 10.
const sameCount = (r, key) => { const n = pick(r.c.today, 0.56, 0.02).length; return [...r.c[key.replace('same count', 'meaning')]].sort((a, b) => b.score - a.score).slice(0, n).map((x) => F[x.i].id); };
const grade = (rows, key, cut, margin) => { let right = 0, wrong = 0; for (const r of rows) { const got = key.startsWith('same count') ? sameCount(r, key) : pick(r.c[key], cut, margin); const ok = new Set([...r.want, ...(r.ok ?? [])]); const bad = got.some((g) => !ok.has(g)); const hit = r.want.length ? r.want.every((w) => got.includes(w)) : got.length === 0; if (bad) wrong++; else if (hit) right++; } return { right, wrong }; };
const tune = []; for (const r of S.tune) tune.push({ ...r, c: await candidates(r.q) });
const test = []; for (const r of S.test) test.push({ ...r, c: await candidates(r.q) });
const keys = [...Object.keys(test[0].c).filter((k) => k !== 'ms'), ...Object.keys(rr).map((n) => `same count → ${n}`)];
console.log(`${S.test.length} test requests, ${F.length} facts\n`);
for (const k of keys) {
  let best = null;
  if (k === 'today' || k.startsWith('same count')) best = { cut: 0.56, margin: 0.02 };
  else {
    const all = tune.flatMap((r) => r.c[k].map((x) => x.score)).sort((a, b) => a - b);
    const cuts = [...new Set(all.map((x) => +x.toFixed(4)))];
    const spread = all.at(-1) - all[0];
    for (const cut of cuts) for (const m of [0.05, 0.1, 0.2, 0.35, 0.5, 1].map((f) => f * spread)) { const g = grade(tune, k, cut, m); const v = g.right - 2 * g.wrong; if (!best || v > best.v) best = { cut, margin: m, v }; }
  }
  const g = grade(test, k, best.cut, best.margin);
  const mk = k.replace('same count', 'meaning');
  const ms = k === 'today' ? '' : ` · rerank ${Math.round(test.reduce((s, r) => s + r.c.ms[mk], 0) / test.length)} ms`;
  console.log(`${k.padEnd(24)} right ${String(g.right).padStart(2)} · wrong ${String(g.wrong).padStart(2)}${ms}   (cut ${best.cut.toFixed(3)})`);
}
for (const p of servers) p.kill('SIGTERM');
