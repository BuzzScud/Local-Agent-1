// The search settings (/effort's three Search rows) and the two steps they
// can add to the searches the helpers run (the code search, Read first's file
// ranking, the saved facts, Claude's notes):
//   embedder   'bge-m3' finds pieces by meaning (models/bge-m3); 'off' leaves
//              every search to its own word matching, and the code search pauses.
//   retriever  'meaning' orders the pieces by meaning alone (as before);
//              'hybrid' merges that order with a word search (BM25) by
//              Reciprocal Rank Fusion, the way the RAG project does.
//   reranker   'off', or a reranker's id (models/<id>): it reads the request
//              together with each of the best pieces and orders them.
// Whether anything comes along, and how many pieces, stays each search's own
// rule on meaning (or words): the retriever and the reranker only choose
// WHICH pieces. So on Meaning with the reranker Off every search gives exactly
// what it gave before. Measured 29 Sep (models/qwen3-reranker-0.6b/README.md):
// hybrid changed nothing on the practice sets and the reranker helped only
// the code search, so both are off by default.
export const SEARCH = { embedder: 'bge-m3', retriever: 'meaning', reranker: 'off' };
export const RRF_K = 60; // the fusion's damping: a place at the top counts, the rest fades
export const WORD_TOP = 40; // how many of the word search's best join the fusion

const STOP = new Set('the and for with from this that these those are was were been have has had not but you your our can could should would will what where when which who how why its into out then than there here also just about only each every all any some more most such very use used using const let var function return export import default new true false null undefined async await else case break'.split(' '));

// A text's words as a code search counts them: names split at their humps
// and underscores ("rankFiles" → rank, files), lower case, 3 letters or more.
export function terms(text) {
  const out = [];
  for (const w of String(text).match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) {
    for (const p of w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      const t = p.toLowerCase();
      if (t.length > 2 && !STOP.has(t)) out.push(t);
    }
  }
  return out;
}

// A word index over texts (each a list of terms), built once and asked many
// times: BM25 scores in the texts' order (0 = no word shared).
export class Words {
  constructor(docs) {
    this.docs = docs.map((d) => { const tf = new Map(); for (const w of d) tf.set(w, (tf.get(w) ?? 0) + 1); return { tf, n: d.length }; });
    this.avg = this.docs.reduce((s, d) => s + d.n, 0) / (this.docs.length || 1);
    this.df = new Map();
    for (const d of this.docs) for (const w of d.tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
  }
  scores(query, { k1 = 1.2, b = 0.75 } = {}) {
    const qs = [...new Set(terms(query))].filter((w) => this.df.has(w));
    const N = this.docs.length;
    return this.docs.map((d) => qs.reduce((s, w) => {
      const f = d.tf.get(w);
      if (!f) return s;
      const df = this.df.get(w);
      return s + Math.log(1 + (N - df + 0.5) / (df + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.n) / (this.avg || 1)));
    }, 0));
  }
  // The indexes of the texts that share words with the query, best first.
  order(query, top = WORD_TOP) {
    return this.scores(query).map((s, i) => [s, i]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, top).map(([, i]) => i);
  }
}
export const bm25 = (query, docs) => new Words(docs).scores(query);

// Reciprocal Rank Fusion: lists of keys, best first, merged into one order.
// A key high in either list comes early; one in both comes earliest.
export function rrf(lists, k = RRF_K) {
  const score = new Map();
  for (const list of lists) list.forEach((key, r) => score.set(key, (score.get(key) ?? 0) + 1 / (k + r + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

// Which pieces come along. `byMeaning` is the search's own order (best
// first) and `n` how many its own rule lets through (0: none).
//   byWords    for Hybrid: the word search's order (pieces, best first)
//   key(p)     what makes two pieces the same one (for the fusion)
//   text(p)    the piece as the reranker reads it
// → { picked, order: 'meaning' | 'hybrid', reranked, ms, note }. A reranker
// that fails leaves the order as it was, with a note; nothing is lost.
export async function choose({ query, byMeaning, byWords = null, n, key = (p) => p, text = String, retriever = 'meaning', reranker = null, pool, signal }) {
  const t0 = Date.now();
  let list = byMeaning;
  let order = 'meaning';
  if (retriever === 'hybrid' && byWords?.length) {
    const by = new Map();
    for (const p of [...byMeaning, ...byWords]) if (!by.has(key(p))) by.set(key(p), p);
    list = rrf([byMeaning.map(key), byWords.map(key)]).map((k) => by.get(k));
    order = 'hybrid';
  }
  if (n <= 0) return { picked: [], order, reranked: false, ms: Date.now() - t0 };
  if (!reranker) return { picked: list.slice(0, n), order, reranked: false, ms: Date.now() - t0 };
  // Only the best few are read: a bigger pool took twice as long and chose no better.
  const cand = list.slice(0, Math.max(n, pool ?? reranker.model?.pool ?? 15));
  try {
    const s = await reranker.scores(query, cand.map(text), { signal });
    const picked = cand.map((p, i) => ({ p, s: s[i], i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map((x) => x.p);
    return { picked, order, reranked: true, ms: Date.now() - t0 };
  } catch (e) {
    if (signal?.aborted || e.name === 'AbortError') throw e;
    return { picked: list.slice(0, n), order, reranked: false, ms: Date.now() - t0, note: `The reranker did not answer (${e.message}); the search's own order was used.` };
  }
}

// How a search chose, for the screen: "by meaning", "by meaning + words, reranked".
export function howChosen(c, base = 'meaning') {
  if (!c) return base === 'words' ? 'by words' : base === 'meaning' ? 'by meaning' : '';
  const first = base === 'words' ? 'by words' : c.order === 'hybrid' ? 'by meaning + words' : 'by meaning';
  return `${first}${c.reranked ? ', reranked' : ''}`;
}
