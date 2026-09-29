// Does the right code come back? Questions about real projects, each with the
// function that answers it, asked of the code search (terminal: CodeIndex)
// built on the real folder with the real small model, the way the app does.
// A question counts:
//   first / top 3 / top 10   where the right function is in the search's order
//   handed                   it is among the pieces the model is given (the
//                            agent's rule: close enough to the best, at most 8
//                            pieces from at most 3 files; none below the cut)
//   in the index             its file is one the index reads at all
// With --rerank the same questions also go through the reranker, the way
// /effort's Reranker row would pick, to compare (nothing in the app changes).
//
// The sets: agentic-coder.json here (this repo), and any set on this Mac in
// ~/.agentic-coder/evals/code/*.json ("private": true keeps its questions and
// names out of the test record, which is mirrored to GitHub). No bar yet: it
// is the ruler a change to the search is measured with.
//   node models/evals/bench/code/search.mjs [--rerank] [--set <name>] [--no-record]
//   --check: only that every question still points at code that is there (no model)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Embedder, embedderReady, EMBEDDERS, DEFAULT_EMBEDDER, Reranker, rerankerReady, RERANKERS, DEFAULT_RERANKER, HOME, recordTest, codeLabel } from '../../../index.mjs';
import { CodeIndex, partsOf, partKey, CODE_CUT, CODE_MARGIN, choose } from '../../../../terminal/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const rerank = process.argv.includes('--rerank');
const only = arg('--set');
const MAX_PIECES = 8; // the agent's own rule (agent.mjs, the rag helper)
const MAX_FILES = 3;

const privateDir = join(HOME, 'evals', 'code');
const setFiles = [
  ...readdirSync(here).filter((f) => f.endsWith('.json')).map((f) => join(here, f)),
  ...(existsSync(privateDir) ? readdirSync(privateDir).filter((f) => f.endsWith('.json')).map((f) => join(privateDir, f)) : []),
];
const sets = setFiles.map((f) => ({ ...JSON.parse(readFileSync(f, 'utf8')), from: f })).filter((s) => !only || s.name.toLowerCase() === only.toLowerCase());
if (!sets.length) { console.error(only ? `No set named "${only}".` : 'No question sets.'); process.exit(2); }
const folderOf = (s) => (s.folder.startsWith('~/') ? join(homedir(), s.folder.slice(2)) : isAbsolute(s.folder) ? s.folder : resolve(root, s.folder));

if (process.argv.includes('--check')) {
  let bad = 0;
  for (const set of sets) {
    const broken = set.questions.map((q) => ({ q, t: target(folderOf(set), q) })).filter((x) => x.t.broken);
    bad += broken.length;
    console.log(`${set.name}: ${set.questions.length - broken.length} of ${set.questions.length} questions point at code that is there`);
    for (const x of broken) console.log(`  BROKEN  ${x.q.q} · ${x.t.broken}`);
  }
  process.exit(bad ? 1 : 0);
}

const embedModel = EMBEDDERS[DEFAULT_EMBEDDER];
if (!embedderReady(embedModel)) { console.error(`${embedModel.name} is not on this Mac yet. Run: coding setup`); process.exit(2); }
const rerankModel = RERANKERS[DEFAULT_RERANKER];
if (rerank && !rerankerReady(rerankModel)) { console.error(`${rerankModel.name} is not on this Mac yet. Run: coding setup`); process.exit(2); }

// Is a piece the right one? Its file, a name in its path ("App › runSlash
// (lines 1-80)" has App and runSlash), and the line `find` names when given.
function target(folder, q) {
  let text;
  try { text = readFileSync(join(folder, q.file), 'utf8'); } catch { return { broken: `${q.file} is not there` }; }
  const lines = text.split('\n');
  let at = null;
  if (q.find) {
    const i = lines.findIndex((l) => l.includes(q.find));
    if (i < 0) return { broken: `"${q.find}" is not in ${q.file}` };
    at = i + 1;
  }
  const is = (p) => p.rel === q.file && p.name.split(/ › | \(/).includes(q.name) && (at == null || (p.line <= at && at <= p.end));
  if (!partsOf(q.file, text).some((p) => is({ ...p, rel: q.file }))) return { broken: `no piece of ${q.file} is ${q.name}${q.find ? ` holding "${q.find}"` : ''}` };
  return { is };
}

// The pieces the model is given, as the agent picks them.
async function handed(index, q, parts, reranker) {
  if (!parts.length || parts[0].close < CODE_CUT) return [];
  const best = parts[0].close;
  const n = parts.filter((x) => x.close >= Math.max(CODE_CUT, best - CODE_MARGIN)).slice(0, MAX_PIECES).length;
  const chosen = await choose({ query: q, byMeaning: parts, n, key: partKey, text: (p) => index.textOf(p, reranker?.model?.chars), reranker });
  const files = [...new Set(chosen.picked.map((p) => p.rel))].slice(0, MAX_FILES);
  return chosen.picked.filter((p) => files.includes(p.rel));
}

const t0 = Date.now();
const embedder = new Embedder(embedModel);
const reranker = rerank ? new Reranker(rerankModel) : null;
await embedder.start({ lingerSecs: 0 });
if (reranker) await reranker.start({ lingerSecs: 0 });
const results = [];
try {
  for (const set of sets) {
    const folder = folderOf(set);
    console.log(`\n${set.name} · ${set.questions.length} questions · ${folder.replace(homedir(), '~')}`);
    const index = new CodeIndex(folder, embedder, { dir: join(HOME, 'evals', 'code', 'maps') });
    const b0 = Date.now();
    const tick = setInterval(() => console.log(`  indexing: ${index.done} of ${index.total} pieces, ${Math.round((Date.now() - b0) / 1000)} s`), 30_000);
    await index.build();
    clearInterval(tick);
    if (index.state !== 'ready') throw new Error(`the index of ${set.name} was not built: ${index.why}`);
    const indexed = new Set(index.parts.map((p) => p.rel));
    console.log(`  index: ${index.parts.length} pieces from ${indexed.size} files, ${Math.round((Date.now() - b0) / 1000)} s`);
    const rows = [];
    for (const q of set.questions) {
      const t = target(folder, q);
      if (t.broken) { rows.push({ q: q.q, file: q.file, name: q.name, broken: t.broken }); console.log(`  BROKEN  ${q.q} · ${t.broken}`); continue; }
      const s0 = Date.now();
      const found = await index.search(q.q, { top: 40 });
      const ms = Date.now() - s0;
      const rank = found.parts.findIndex(t.is);
      const given = await handed(index, q.q, found.parts, null);
      const row = { q: q.q, file: q.file, name: q.name, inIndex: indexed.has(q.file), rank, handed: given.some(t.is), pieces: given.length, best: found.parts[0]?.close ?? 0, top: found.parts[0] ? `${found.parts[0].rel} · ${found.parts[0].name}` : null, ms };
      if (reranker) {
        const pool = found.parts.slice(0, rerankModel.pool ?? 15);
        const r0 = Date.now();
        const scores = await reranker.scores(q.q, pool.map((p) => index.textOf(p, rerankModel.chars)));
        row.rankReranked = pool.map((p, i) => ({ p, s: scores[i], i })).sort((a, b) => b.s - a.s || a.i - b.i).findIndex((x) => t.is(x.p));
        row.handedReranked = (await handed(index, q.q, found.parts, reranker)).some(t.is);
        row.rerankMs = Date.now() - r0;
      }
      rows.push(row);
      const where = !row.inIndex ? 'not indexed' : rank < 0 ? 'missed' : rank === 0 ? 'first' : `#${rank + 1}`;
      console.log(`  ${where.padEnd(11)} ${row.handed ? 'handed ' : '       '}${reranker ? `rr ${row.rankReranked < 0 ? '-' : `#${row.rankReranked + 1}`}${row.handedReranked ? ' handed' : ''}`.padEnd(14) : ''} ${q.q.slice(0, 70)}`);
    }
    results.push({ set: set.name, private: Boolean(set.private), folder, pieces: index.parts.length, files: indexed.size, rows });
  }
} finally {
  await reranker?.stop({ keep: false });
  await embedder.stop({ keep: false });
}

// The totals, one set at a time and all together.
const count = (rows) => {
  const ok = rows.filter((r) => !r.broken);
  const c = (f) => ok.filter(f).length;
  return {
    n: ok.length, broken: rows.length - ok.length, inIndex: c((r) => r.inIndex),
    first: c((r) => r.rank === 0), top3: c((r) => r.rank >= 0 && r.rank < 3), top10: c((r) => r.rank >= 0 && r.rank < 10), handed: c((r) => r.handed),
    ...(rerank ? { firstR: c((r) => r.rankReranked === 0), top3R: c((r) => r.rankReranked >= 0 && r.rankReranked < 3), handedR: c((r) => r.handedReranked) } : {}),
  };
};
const line = (name, k) => `${name.padEnd(16)} in the index ${k.inIndex}/${k.n} · first ${k.first} · top 3 ${k.top3} · top 10 ${k.top10} · handed ${k.handed}${rerank ? ` │ reranked: first ${k.firstR} · top 3 ${k.top3R} · handed ${k.handedR}` : ''}${k.broken ? ` · ${k.broken} BROKEN` : ''}`;
console.log('');
for (const r of results) console.log(line(r.set, count(r.rows)));
const all = count(results.flatMap((r) => r.rows));
if (results.length > 1) console.log(line('all', all));
const secs = (Date.now() - t0) / 1000;
console.log(`${Math.round(secs)} s${all.broken ? ` · ${all.broken} question(s) point at code that is gone: fix them in their set` : ''}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = join(root, 'models', embedModel.folder, 'results', `code-search-${stamp}${rerank ? '-rerank' : ''}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), embedder: embedModel.name, reranker: rerank ? rerankModel.name : null, secs, results }, null, 1));
console.log(`results: ${out.replace(homedir(), '~')}`);

if (!process.argv.includes('--no-record')) {
  const setsNote = results.map((r, i) => { const k = count(r.rows); return `${r.private ? `private set ${i + 1}` : r.set}: handed ${k.handed}/${k.n}, top 3 ${k.top3}, first ${k.first}, in the index ${k.inIndex}${rerank ? `; reranked handed ${k.handedR}, top 3 ${k.top3R}` : ''}`; }).join(' · ');
  recordTest({ kind: 'other', name: `Code search: the right function comes back (${embedModel.name}${rerank ? ` + ${rerankModel.name}` : ''}, ${all.n} questions)`, code: codeLabel(root), passed: all.handed, total: all.n, secs, result: all.broken ? 'fail' : 'pass', note: `${setsNote}. No bar yet: the ruler for changes to the search.${all.broken ? ` ${all.broken} question(s) broken.` : ''}`, raw: out.slice(root.length + 1) });
}
process.exit(all.broken ? 1 : 0);
