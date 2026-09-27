# Part 2 · The models

The models Bonsai Code uses and tests, what runs them, and the bench that measures
the agent with each one.

| | |
|---|---|
| `index.mjs` | The one file the terminal imports: the registry, the runtime and setup. This part in turn imports the terminal only through `../terminal/index.mjs`. |
| `registry.mjs` | The list of models (one folder each), where their files live on this Mac (`~/.bonsai-code`), and how to ask a model to think. |
| `runtime/` | `server.mjs` starts, shares and stops llama-server; `memory.mjs` picks a context that fits the Mac; `warmup.mjs` saves and restores the read-in instructions; `setup.mjs` downloads the runtime and a model. |
| `bonsai-2-27b/` | The model in use: `model.mjs` (its settings), `README.md` (what was measured, with links to its report pages in `docs/`), `results/` (raw runs, kept on this Mac, not in git). |
| `evals/` | The test bench (below). |
| `test/` | Unit tests of this part: the registry, memory math, server flags, warm-up, sharing a server. |

## Models

| Model | Folder | Status |
|---|---|---|
| Bonsai 2 27B (Prism ML, ternary PQ2_0, 7.2 GB) | [`bonsai-2-27b/`](bonsai-2-27b/README.md) | In use, the default. Grade B+ as a coding agent on the M4. |

Earlier, Ternary Bonsai 8B was used in round 1 and removed on 24 Sep 2026; its
numbers live in the 27B's comparison pages.

## Adding a model

1. Make `models/<name>/model.mjs`, starting from `bonsai-2-27b/model.mjs`: the file, its
   download URL and checksum, its layout (for the memory estimate), sampling, effort levels,
   and the server options it needs.
2. Import it in `registry.mjs` and add it to the list.
3. `bonsai setup` fetches it; `/model` in the terminal lists it.
4. Test it the way the 27B was: `node models/evals/bench/run.mjs --model <id>` and
   `node models/evals/bench/words/real.mjs --model <id>`; results land in `models/<name>/results/`.

## The test bench (`evals/`)

Each run starts its own llama-server, runs the terminal's agent headless with the model,
and checks the result. Everything is auto-approved inside throwaway copies; Bonsai's
questions get scripted answers (`answers.json` per task).

| Script | What it measures |
|---|---|
| `bench/run.mjs` | The 28 practice tasks (`bench/tasks/`): questions, renames, fixes, features, writing, several files, vague requests, a real-sized project. `--think off\|on\|both`, `--effort`, `--reps`, `--only`, `--model`. |
| `tools/verify-tasks.sh` | Proves every task's check fails on the untouched project and passes with its reference answer. |
| `bench/words/real.mjs` | 28 real requests built around trigger words and blocked commands, in three kinds of folder. |
| `tools/speed.mjs`, `soak.mjs`, `reread.mjs` | Engine settings, long conversations and cold starts, what gets re-read each step. |
| `bench/night/start.sh` | All of the above overnight, with a morning report. |
| `reports/` | The builders of the report pages; pages go to `~/Desktop/bonsai-code DOCS`, mirrored into the repo's `docs/`. |
| `dev/` | Probes and experiments against a running server (see `dev/experiments/README.md`). |

Only one model fits in memory at a time on a 16 GB Mac, so bench runs wait for each other.
