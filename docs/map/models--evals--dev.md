# models/evals/dev/ — 1 folders: experiments/; 3 files

Every folder under models/evals/dev/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/dev/ — 1 folders: experiments/; 3 files
  - models/evals/dev/27b-realuse.mjs (74) — Real-use test of Bonsai 2 27B through llama-server with Agentic Coder's own settings.
  - models/evals/dev/gguf-meta.mjs (29) — Print the scalar metadata of a GGUF header (arrays shown by type + length only).
  - also: 27b-realuse-2026-09-24.json
- models/evals/dev/experiments/ — Experiments with Bonsai 2 27B (24–25 Sep 2026) Run against the real model on the M4 (16 GB).
  - models/evals/dev/experiments/checkpoint-memory.mjs (37) — Measures memory usage from prompt reuse in the server
  - models/evals/dev/experiments/gguf-meta.mjs (29) — Print the scalar metadata of a GGUF header (arrays shown by type + length only).
  - models/evals/dev/experiments/README.md (15) — Documents experiment setup, questions asked, and findings summary
  - models/evals/dev/experiments/thinking-cap.mjs (19) — Checks if reasoning budget limits the model's thought process
  - models/evals/dev/experiments/two-slots-and-saved-warmup.mjs (59) — Manages two server slots and saves warmed-up instructions
- models/evals/dev/experiments/rerank-bakeoff/ — Reranker bake-off experiment comparing small models for code search
  - models/evals/dev/experiments/rerank-bakeoff/code.mjs (69) — Script executing reranking tasks on code snippets using specified model configurations
  - models/evals/dev/experiments/rerank-bakeoff/gguf-names.mjs (13) — Utility script parsing GGUF binary files to extract string metadata fields
  - models/evals/dev/experiments/rerank-bakeoff/memory.mjs (89) — Script evaluating reranker recall performance against a set of stored memory facts
  - models/evals/dev/experiments/rerank-bakeoff/README.md (28) — Documentation explaining the bake-off goal, methodology, and selected best reranker model
  - also: code-labels-names.json, code-labels.json
