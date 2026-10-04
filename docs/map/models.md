# models/ — Part 2: the models (each one's settings, the registry), the runtime that runs them, and the test bench (evals) with its tests ✓

Every folder under models/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- models/ — Part 2: the models (each one's settings, the registry), the runtime that runs them, and the test bench (evals) with its tests ✓
  - models/index.mjs (36) — Part 2 of Agentic Coder: the models it runs and tests.
  - models/README.md (69) — Part 2 · The models The models Agentic Coder uses and tests, what runs them, and the bench that measures the agent with each one.
  - models/registry.mjs (125) — The models Agentic Coder can run (one folder each), and where their files live on this Mac (~/.agentic-coder).
- models/bge-m3/ — Folder for BGE-M3 embedding model files
  - models/bge-m3/model.mjs (32) — Exports configuration settings for the small text embedding model
  - models/bge-m3/README.md (34) — Explains how this model matches requests to saved memory facts
- models/bonsai-2-27b/ — Holds Bonsai 2 27B model settings and documentation
  - models/bonsai-2-27b/model.mjs (107) — Defines configuration for the ternary Bonsai 2 27B model
  - models/bonsai-2-27b/README.md (88) — Bonsai 2 27B Prism ML's ternary Bonsai 2 27B, `Ternary-Bonsai-2-27B-PQ2_0.gguf` (7.21 GB, sha256 `3907dc16…62ec1`), run with Prism's llama.cpp built from sourc…
- models/bonsai-2-27b-constantkv/ — Bonsai 2 model with fixed memory cache for long context
  - models/bonsai-2-27b-constantkv/model.mjs (73) — Bonsai 2 model code with constant KV cache logic
  - also: files.json
- models/evals/ — 4 folders: battle/, bench/, dev/, tools/; 3 files → models--evals.md
- models/gemma-4-12b/ — Gemma 4 12B model config folder
  - models/gemma-4-12b/model.mjs (98) — Exports Gemma 4 12B QAT model metadata and performance stats
- models/k2-horizon-7b/ — Folder for the K2 Horizon 7B text-only language model configuration.
  - models/k2-horizon-7b/model.mjs (74) — Exports default settings and metadata for the open-source K2 Horizon 7B model.
- models/qwen3-reranker-0.6b/ — Qwen3-Reranker model folder for reordering search results
  - models/qwen3-reranker-0.6b/model.mjs (32) — Exports the reranker config to order search results by relevance
  - models/qwen3-reranker-0.6b/README.md (73) — Documents the model source, size, and how it ranks search pieces
- models/qwen3.5-9b/ — Folder for Qwen3.5 9B model configuration files.
  - models/qwen3.5-9b/model.mjs (94) — Exports default config object defining the Qwen3.5 9B model metadata and folder path.
- models/runtime/ — Runtime modules for connecting to and managing local or remote AI model servers → models--runtime.md
- models/test/ — 35 files
  - models/test/arena.test.mjs (296) — The Arena's runner (models/evals/battle/runner.mjs), end to end in practice mode (no model): one line for everything you start.
  - models/test/ollama.test.mjs (249) — Ollama service integration and catalog tests
  - models/test/record.test.mjs (349) — The test record (models/evals/record.mjs): one line per run, read newest first, never a throw, and the saved copy of the Tests page.
  - models/test/run-a-test.test.mjs (322) — The tests the Arena and /test know by name (models/evals/run-tests.mjs): which practice tasks a run plays (--set 28), the list and the command each starts from…
  - models/test/server.test.mjs (205) — 205 lines
  - also: agents-check.test.mjs, arena-groups.test.mjs, battle.test.mjs, builder.test.mjs, check-kit.test.mjs, check.test.mjs, components.test.mjs, constantkv-model.test.mjs, constantkv.test.mjs, docs-mirror.test.mjs, edited-check.test.mjs, edited.test.mjs, embed.test.mjs, engines-memory.test.mjs, habits-che… (30 files)
