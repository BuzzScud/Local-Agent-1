# models/evals/dev/ — Dev evaluation scripts for testing model capabilities and debugging ✓

Every folder under models/evals/dev/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/dev/ — Dev evaluation scripts for testing model capabilities and debugging ✓
  - models/evals/dev/debug-change.mjs (19) — Tool to apply and test code changes in a temporary project
  - models/evals/dev/debug-fix.mjs (20) — Utility to run tests and attempt bug fixes automatically
  - models/evals/dev/debug-json.mjs (15) — Script to intercept and log JSON-related command outputs
  - models/evals/dev/flows-smoke.mjs (26) — Smoke test script to verify basic workflow functionality
  - models/evals/dev/probe-focused-jobs.mjs (85) — Probe to test model performance on focused, single-task requests
  - also: 27b-realuse-2026-09-24.json, 27b-realuse.mjs, dev-server.mjs, gguf-meta.mjs
- models/evals/dev/experiments/ — Experiments for Bonsai 2 27B model on M4 hardware
  - models/evals/dev/experiments/checkpoint-memory.mjs (37) — Measures memory usage from prompt reuse in the server
  - models/evals/dev/experiments/open-items-run.sh (23) — Runs sequential checks for nine open issues one by one
  - models/evals/dev/experiments/README.md (15) — Documents experiment setup, questions asked, and findings summary
  - models/evals/dev/experiments/thinking-cap.mjs (19) — Checks if reasoning budget limits the model's thought process
  - models/evals/dev/experiments/two-slots-and-saved-warmup.mjs (59) — Manages two server slots and saves warmed-up instructions
  - also: gguf-meta.mjs, greet-prefix.mjs
- models/evals/dev/experiments/rerank-bakeoff/ — Reranker bake-off experiment comparing small models for code search
  - models/evals/dev/experiments/rerank-bakeoff/code.mjs (69) — Script executing reranking tasks on code snippets using specified model configurations
  - models/evals/dev/experiments/rerank-bakeoff/gguf-names.mjs (13) — Utility script parsing GGUF binary files to extract string metadata fields
  - models/evals/dev/experiments/rerank-bakeoff/memory.mjs (89) — Script evaluating reranker recall performance against a set of stored memory facts
  - models/evals/dev/experiments/rerank-bakeoff/README.md (28) — Documentation explaining the bake-off goal, methodology, and selected best reranker model
  - also: code-labels-names.json, code-labels.json
