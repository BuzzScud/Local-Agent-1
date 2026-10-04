# models/runtime/ — Runtime modules for connecting to and managing local or remote AI model servers

Every folder under models/runtime/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/runtime/ — Runtime modules for connecting to and managing local or remote AI model servers
  - models/runtime/claude.mjs (122) — Configuration and client setup for Anthropic's Claude API via its official SDK
  - models/runtime/memory.mjs (163) — How much memory the Mac can give the model right now, and which context size fits: 32k by default, 16k when memory is short (and we say why).
  - models/runtime/ollama.mjs (192) — Discovers and queries local Ollama instances for available models and their specs
  - models/runtime/remote.mjs (598) — tunnel when it is reached that way, and a check that it answers.
  - models/runtime/server.mjs (393) — Starts and looks after llama-server for one model (on the model's engine): picks a free port, waits until it is healthy, restarts it once if it crashes, and st…
  - also: edited.mjs, embed.mjs, rerank.mjs, serve.mjs, setup.mjs, warmup.mjs
- models/runtime/engine/ — Builds model servers from source for Agentic Coder
  - models/runtime/engine/build-now.mjs (10) — Manual script to trigger an engine build by name
  - models/runtime/engine/build.mjs (63) — Core logic defining how to compile the engine binaries ✓
  - models/runtime/engine/make-patch.mjs (14) — Script to regenerate the patch file from source diffs
  - models/runtime/engine/patch.mjs (207) — Contains the Metal optimization patch as a text string
  - models/runtime/engine/README.md (50) — Documentation explaining the two available engine sources and usage ✓
  - also: pq2-multicol.patch
- models/runtime/mlx/ — Apple MLX model server for Bonsai 2 27B with fixed attention memory
  - models/runtime/mlx/mlx-server.py (572) — Handles chat completions and health checks using Apple's MLX engine
