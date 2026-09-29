# Reranker bake-off (29 Sep 2026)

Which small reranker, if any, should /effort's Reranker row run? Results and
the pick: `models/qwen3-reranker-0.6b/README.md`.

- `memory.mjs` — the recall set (`models/evals/bench/memory/recall-set.json`):
  BGE-M3 alone against each reranker, three ways (the reranker's own cut-off,
  BGE-M3 deciding whether, and BGE-M3 deciding how many = what the app does).
- `code.mjs` — 12 requests about this repo's own functions (`code-labels.json`,
  written before any run); `LABELS=code-labels-names.json` for 5 that name a
  function exactly. `POOL` and `CH` set how many parts the reranker reads and
  how much of each (the app: 15 and 700).
- `gguf-names.mjs <file>` — a GGUF file's architecture and scoring-head layers
  (why the MiniLM files could not be used).

The jina files are not part of `coding setup`; put them in
`~/.agentic-coder/models/bakeoff/` (or point `BAKEOFF_MODELS` at them):

| File | From (commit) | SHA-256 |
|---|---|---|
| jina-reranker-v1-tiny-en-Q8_0.gguf | gpustack/jina-reranker-v1-tiny-en-GGUF (34fdafe5) | 0defc1f8…1f553 |
| Jina-Bert-Implementation-38M-F16.gguf | ggml-org/jina-reranker-v1-turbo-en-GGUF (607d8664) | 71abc010…21fca |
| ms-marco-MiniLM-L6-v2-Q8_0.gguf (no pooler: unusable) | sinjab/ms-marco-MiniLM-L6-v2-Q8_0-GGUF (2a3f821a) | abd99810…0f7b7 |

Run from the repo's top: `bun models/evals/dev/experiments/rerank-bakeoff/memory.mjs`
(~2 min) and `… /code.mjs` (~3 min, most of it indexing). Each starts its own
servers on ports 17695–17699 and stops them at the end.
