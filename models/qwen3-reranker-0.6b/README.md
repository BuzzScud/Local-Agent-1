# Qwen3-Reranker 0.6B

The model behind /effort's **Reranker** row. By Qwen, Apache 2.0; the GGUF
file is llama.cpp's own conversion (`ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF`,
639 MB). It runs in Agentic Coder's own engine in its reranking mode
(`llama-server --rerank`), beside Gemma, and only when the row is on.

`coding setup` downloads it. Without it the Reranker row says so and stays off.

## What it does

The search finds pieces by meaning (BGE-M3, which reads the request and each
piece apart) and, with Retriever on Hybrid, by words too. The reranker then
reads the request **together with** each of the best 15 pieces and orders
them by how well each answers it. BGE-M3 still decides whether anything
fits and how many pieces come along; the reranker decides which ones. So
with the reranker on, the same number of pieces travel with a request as
with it off; only the choice changes.

## Why this one

Measured on 29 Sep 2026 on the M4, with BGE-M3 finding the candidates
(`models/evals/dev/experiments/rerank-bakeoff/`, raw output in
`results/bakeoff-2026-09-29/`, on this Mac only).
Code: 12 requests about Agentic Coder's own functions, written before any
run (the code index of `terminal/src` + `models/runtime`), the reranker
reading the best 15 parts, 700 characters each, as the app does.
Memory: the recall set (`models/evals/bench/memory/recall-set.json`: 20
facts, 30 scored requests), BGE-M3's own rule deciding how many facts come
and the reranker which ones, as the app does.

| Reranker | Code: right function first (higher is better) | Code: in the first 3 (higher is better) | Memory: right / wrong of 30 | Time a search (lower is better) |
|---|---|---|---|---|
| none (BGE-M3 alone) | 6 of 12 | 8 of 12 | 23 / 0 | — |
| jina-reranker-v1-tiny-en (37 MB) | 5 | 9 | 22 / 2 | 0.1–0.3 s |
| jina-reranker-v1-turbo-en (77 MB) | 4 | 9 | 21 / 3 | 0.2–0.7 s |
| **Qwen3-Reranker 0.6B** | **5** | **10** | **23 / 1** | **~1.9 s** |

- It is the only one that helped the code search: 2 more requests of 12 got
  the right function in the first 3, the number that matters when up to 8
  parts come along. None put the right one first more often.
- On the saved facts none beat BGE-M3 alone; Qwen3 cost one wrong pick.
- A reranker left to decide how many facts come (its own cut-off) was worse
  still (Qwen3 22 right / 4 wrong): which is why BGE-M3 keeps deciding how many.
- So the row is **off by default**: turn it on to try it on your own work.
- The ms-marco MiniLM-L-6 cross-encoder that won in the RAG project could not
  run here: its GGUF files lack the pooler layer (all scores ≈ 0) or do not
  load in llama.cpp (`gguf-names.mjs` in the experiment shows which layers a
  file has).
- Words beside the meaning (Retriever: Hybrid, merged by RRF, k = 60) gave the
  same results as meaning alone on both sets; 5 requests that name a function
  exactly were already 5 of 5 by meaning.

Memory: the reranker's server holds ~1.1 GB while it is loaded (measured with
`-c 2048`; 1.56 GB with `-c 8192`, same choices and speed). It is started at
the first request after the row is turned on and stopped when it is turned off
(unless another window still uses it). With less than 1.2 GB free it is not
started: the search goes on in its own order and says why, once. Measured on the
M4 with Gemma (32k) and BGE-M3 loaded: 1.58 GB free before it, 0.83 GB after.

A whole request with Gemma (29 Sep, the big-project question practice task, run as
`coding -p` does): the same answer and the same pieces as with the rows off, 49 s
against 42 s: the reranker's first start and each search that brought something.

A real check on this repo's files (Read first, 3 requests, BGE-M3 + Hybrid +
the reranker, ~2 s each): better on two ("the effort panel rows" put
`limits.mjs` first; "turn a request into numbers" swapped a practice-task file
for `rank.mjs` and `recall.mjs`), worse on one ("where are saved memory facts
matched" dropped `recall.mjs`).

The sets are small (the code set moved by one request between two runs): they
show the order of the methods more than exact scores.
