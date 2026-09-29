// The reranker: a small model that reads a request together with each piece
// the search found and says how well each answers it (models/qwen3-reranker-0.6b).
// It runs in the same llama-server as the other models, in its reranking
// mode, as a server of its own: started at its first use, shared between
// windows and kept loaded like the embedder (embed.mjs). /effort's Reranker
// row turns it on; off, nothing here runs.
import { existsSync } from 'node:fs';
import { serverBinOf, RERANKERS, DEFAULT_RERANKER, modelPath } from '../registry.mjs';
import { ModelServer, LINGER_SECS } from './server.mjs';

// The engine is built and the model's file is here.
export const rerankerReady = (model = RERANKERS[DEFAULT_RERANKER]) => Boolean(model) && existsSync(serverBinOf(model)) && existsSync(modelPath(model));

export class Reranker {
  constructor(model = RERANKERS[DEFAULT_RERANKER], { url } = {}) {
    this.model = model;
    this.fixedUrl = url ?? null; // a server that is already running (tests)
    this.server = null;
    this.starting = null;
    this.last = null; // { pieces, ms } of the last call, for /effort's note
  }

  get url() { return this.fixedUrl ?? this.server?.url ?? null; }

  async start({ lingerSecs = LINGER_SECS } = {}) {
    if (this.fixedUrl || this.server) return this.url;
    this.starting ??= (async () => {
      const server = new ModelServer(this.model);
      await server.start({ ctx: this.model.ctx, lingerSecs });
      this.server = server;
      return server.url;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  // One score per text, in the order given (higher = answers the query
  // better). The scores only order the texts of one call: they are not on a
  // scale that means the same from one request to the next.
  async scores(query, texts, { signal } = {}) {
    if (!texts.length) return [];
    await this.start();
    const t0 = Date.now();
    const documents = texts.map((t) => String(t).slice(0, this.model.chars ?? 700));
    const res = await fetch(`${this.url}/v1/rerank`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ model: this.model.id, query: String(query).slice(0, 2000), documents, top_n: documents.length }) });
    if (!res.ok) throw new Error(`the reranker answered ${res.status}`);
    const out = new Array(texts.length).fill(-Infinity);
    for (const r of (await res.json()).results ?? []) out[r.index] = r.relevance_score;
    this.last = { pieces: texts.length, ms: Date.now() - t0 };
    return out;
  }

  // keep: leave it loaded for the next window (its watcher stops it later).
  async stop({ keep = true } = {}) {
    const s = this.server;
    this.server = null;
    await s?.stop({ keep });
  }
}
