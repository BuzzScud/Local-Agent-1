# Part 2 · The models

The models Agentic Coder uses and tests, what runs them, and the bench that measures
the agent with each one.

| | |
|---|---|
| `index.mjs` | The one file the terminal imports: the registry, the runtime and setup. This part in turn imports the terminal only through `../terminal/index.mjs`. |
| `registry.mjs` | The list of models (one folder each), where their files live on this Mac (`~/.agentic-coder`), and how to ask a model to think. |
| `runtime/` | `server.mjs` starts, shares and stops llama-server, and finds another copy of the model already loaded (a practice-test run, a speed test); `memory.mjs` picks a context that fits the Mac, and checks one you picked in `/effort`; `warmup.mjs` saves and restores the read-in instructions; `setup.mjs` builds the engine and downloads a model; `engine/` builds llama-server (the official release, or Prism's with our patch for the Bonsai 27B). |
| `gemma-4-12b/` | The model in use: `model.mjs` (its settings), `results/` (raw runs, on this Mac only). |
| `qwen3.5-9b/` | The second model in `/model`: `model.mjs` (its settings; its MTP helper is inside the model file, `draft.inFile`), `results/` (raw runs, on this Mac only). |
| `bge-m3/` | The small model that compares meanings, for the memory: it finds the saved facts that fit a request. `runtime/embed.mjs` runs it in the engine's embedding mode, beside the model in use. |
| `bonsai-2-27b/` | The previous model, kept as a recipe: `model.mjs` (its settings), `README.md` (what was measured, with links to its report pages in `docs/`), `results/` (raw runs, kept on this Mac, not in git). |
| `evals/` | The test bench (below). |
| `test/` | Unit tests of this part: the registry, memory math, server flags, warm-up, sharing a server. |

## Models

| Model | Folder | Status |
|---|---|---|
| Gemma 4 12B it QAT (Google, 4-bit QAT, 6.7 GB) | [`gemma-4-12b/`](gemma-4-12b/model.mjs) | **In use, the default** since 28 Sep 2026. Live-checked on the M4: clean tool calls, reads 126–128 tok/s, writes 13.2. Not yet graded on the 28 tasks. |
| Qwen3.5 9B (Alibaba Qwen, Unsloth UD-Q5_K_XL MTP build, 6.9 GB) | [`qwen3.5-9b/`](qwen3.5-9b/model.mjs) | **Second model** since 29 Sep 2026 (pick it in `/model`). Quick check 4/4 (tool calls, High); reads ~190 tok/s; with its own MTP layer writes 18.1 tok/s over 4 kinds of writing (1.12× without it). Only one model fits in 16 GB at a time. Not yet graded on the 28 tasks. |
| Bonsai 2 27B (Prism ML, ternary PQ2_0, 7.2 GB) | [`bonsai-2-27b/`](bonsai-2-27b/README.md) | **Retired 28 Sep 2026**, file removed to free the disk; the folder is the recipe to bring it back (import it in `registry.mjs`, `coding setup`). Grade B+ as a coding agent on the M4. |

Earlier, Ternary Bonsai 8B was used in round 1 and removed on 24 Sep 2026; its
numbers live in the 27B's comparison pages.

## Adding a model

1. Make `models/<name>/model.mjs`, starting from `bonsai-2-27b/model.mjs`: the file, its
   download URL and checksum, its layout (for the memory estimate), sampling, effort levels,
   the server options it needs, and `engine` if it needs one other than the default
   (`ENGINES` in `registry.mjs`). A speed helper is `draft`: a file of its own (Gemma's MTP),
   or `inFile: true` when it is a layer inside the model file (Qwen3.5's MTP build).
2. Import it in `registry.mjs` and add it to the list.
3. `coding setup` fetches it; `/model` in the terminal lists it.
4. Test it the way the 27B was: `node models/evals/bench/run.mjs --model <id>` and
   `node models/evals/bench/words/real.mjs --model <id>`; results land in `models/<name>/results/`.

## The test bench (`evals/`)

Each run starts its own llama-server, runs the terminal's agent headless with the model,
and checks the result. Everything is auto-approved inside throwaway copies; Agentic Coder's
questions get scripted answers (`answers.json` per task).

| Script | What it measures |
|---|---|
| `bench/run.mjs` | The 28 practice tasks (`bench/tasks/`): questions, renames, fixes, features, writing, several files, vague requests, a real-sized project. `--think off\|on\|both`, `--effort`, `--reps`, `--only`, `--model`. |
| `tools/verify-tasks.sh` | Proves every task's check fails on the untouched project and passes with its reference answer. |
| `bench/words/real.mjs` | 28 real requests built around trigger words and blocked commands, in three kinds of folder. |
| `tools/speed.mjs`, `soak.mjs`, `reread.mjs` | Engine settings, long conversations and cold starts, what gets re-read each step. |
| `bench/night/start.sh` | All of the above overnight, with a morning report. |
| `reports/` | The builders of the report pages; pages go to `agentic-coder DOCS/` at the top of the repo, mirrored into the repo's `docs/`. |
| `dev/` | Probes and experiments against a running server (see `dev/experiments/README.md`). |

Only one model fits in memory at a time on a 16 GB Mac, so bench runs wait for each other.
