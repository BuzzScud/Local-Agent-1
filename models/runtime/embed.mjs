// The embedder: a small model that turns texts into numbers, so that meanings
// can be compared (models/bge-m3). It runs in the same llama-server as the
// 27B, in its embedding mode, as a server of its own: started at the first
// use, shared between windows and kept loaded like the 27B's (server.mjs).
import { existsSync } from 'node:fs';
import { SERVER_BIN, EMBEDDERS, DEFAULT_EMBEDDER, modelPath } from '../registry.mjs';
import { ModelServer, LINGER_SECS } from './server.mjs';

const CACHE = 256; // texts whose numbers are kept for the next ask

// The engine is built and the model's file is here.
export const embedderReady = (model = EMBEDDERS[DEFAULT_EMBEDDER]) => Boolean(model) && existsSync(SERVER_BIN) && existsSync(modelPath(model));

export class Embedder {
  constructor(model = EMBEDDERS[DEFAULT_EMBEDDER], { url } = {}) {
    this.model = model;
    this.fixedUrl = url ?? null; // a server that is already running (tests)
    this.server = null;
    this.starting = null;
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

  // One list of numbers per text, each of length 1 (so that the closeness of
  // two texts is the sum of their numbers multiplied pair by pair). A text
  // asked for again (one request: the memory, Claude's notes and the code
  // search each look it up) is answered from the last CACHE texts.
  async embed(texts, { signal } = {}) {
    if (!texts.length) return [];
    const cache = (this.cache ??= new Map());
    const keys = texts.map((t) => String(t).slice(0, 4000));
    const want = [...new Set(keys.filter((k) => !cache.has(k)))];
    if (want.length) await this.start();
    for (let i = 0; i < want.length; i += 16) {
      const batch = want.slice(i, i + 16);
      const res = await fetch(`${this.url}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ model: this.model.id, input: batch }) });
      if (!res.ok) throw new Error(`the embedder answered ${res.status}`);
      const rows = (await res.json()).data.sort((a, b) => a.index - b.index);
      rows.forEach((r, k) => {
        const v = Float32Array.from(r.embedding);
        let n = 0;
        for (const x of v) n += x * x;
        n = Math.sqrt(n) || 1;
        for (let j = 0; j < v.length; j++) v[j] /= n;
        cache.set(batch[k], v);
      });
    }
    const out = keys.map((k) => cache.get(k));
    for (const k of keys) { const v = cache.get(k); cache.delete(k); cache.set(k, v); } // newest last
    while (cache.size > CACHE) cache.delete(cache.keys().next().value);
    return out;
  }

  // keep: leave it loaded for the next window (its watcher stops it later).
  async stop({ keep = true } = {}) {
    const s = this.server;
    this.server = null;
    await s?.stop({ keep });
  }
}
