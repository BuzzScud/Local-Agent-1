// The reranker: a small model that reads a request together with each piece
// the search found and says how well each answers it (models/qwen3-reranker-0.6b).
// It runs in the same llama-server as the other models, in its reranking
// mode, as a server of its own: started at its first use, shared between
// windows and kept loaded like the embedder (embed.mjs). /effort's Reranker
// row turns it on; off, nothing here runs.
import { existsSync } from 'node:fs';
import { serverBinOf, RERANKERS, DEFAULT_RERANKER, modelPath } from '../registry.mjs';
import { ModelServer, LINGER_SECS, scanServers, liveUsers } from './server.mjs';
import { availableBytes } from './memory.mjs';

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

  // free: the memory free now (tests pass their own). One already loaded (by
  // another window) is shared; a new one needs its memory free, or the
  // search goes on without it this time and says why.
  async start({ lingerSecs = LINGER_SECS, free = availableBytes } = {}) {
    if (this.fixedUrl || this.server) return this.url;
    const loaded = scanServers().some((e) => e.model === this.model.file);
    const need = this.model.loadedBytes ?? 1.2e9;
    if (!loaded && !this.starting && free() < need) throw new Error(`only ${(free() / 1e9).toFixed(1)} GB of memory is free and it needs about ${(need / 1e9).toFixed(1)} GB`);
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
    let res;
    try {
      res = await fetch(`${this.url}/v1/rerank`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ model: this.model.id, query: String(query).slice(0, 2000), documents, top_n: documents.length }) });
    } catch (e) {
      // The server is gone (stopped by the window that started it, or its
      // watcher): the next search starts one again, or shares another's.
      if (!signal?.aborted && e.name !== 'AbortError' && !this.fixedUrl) this.server = null;
      throw e;
    }
    if (!res.ok) throw new Error(`the reranker answered ${res.status}`);
    const out = new Array(texts.length).fill(-Infinity);
    for (const r of (await res.json()).results ?? []) out[r.index] = r.relevance_score;
    this.last = { pieces: texts.length, ms: Date.now() - t0 };
    return out;
  }

  // keep: leave it loaded for the next window (its watcher stops it later).
  // Turned off (keep: false) while another window still uses it, it stays
  // for that window. others(port): the windows on it (tests pass their own).
  async stop({ keep = true, others = liveUsers } = {}) {
    const s = this.server;
    this.server = null;
    if (!keep && s?.port && others(s.port).some((p) => p !== process.pid)) keep = true;
    await s?.stop({ keep });
  }
}
