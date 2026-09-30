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
| `qwen3-reranker-0.6b/` | The reranker behind /effort's Reranker row (off by default): it reads a request together with each of the search's best pieces and orders them. `runtime/rerank.mjs` runs it in the engine's reranking mode (`--rerank`). `README.md` has the 29 Sep bake-off that picked it. |
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
   Three more lines feed the hub's Harness tab, which shows every listed model beside the
   others: `by` (who made it), `measured` (its reading and writing speed on this Mac, tokens a
   second) and, when there is one, `watch` (what to look out for, seen in use by hand).
2. Import it in `registry.mjs` and add it to the list.
3. `coding setup` fetches it; `/model` in the terminal lists it, and the Harness tab shows it
   by itself (`coding hub harness`).
4. Test it the way the 27B was: `node models/evals/bench/run.mjs --model <id>` and
   `node models/evals/bench/words/real.mjs --model <id>`; results land in `models/<name>/results/`.

## The test bench (`evals/`)

Each run starts its own llama-server, runs the terminal's agent headless with the model,
and checks the result. Everything is auto-approved inside throwaway copies; Agentic Coder's
questions get scripted answers (`answers.json` per task).

| Script | What it measures |
|---|---|
| `bench/run.mjs` | The 28 practice tasks (`bench/tasks/`): questions, renames, fixes, features, writing, several files, vague requests, a real-sized project. `--think off\|on\|both`, `--effort`, `--reps`, `--set 28` (the 28 that grade a model; 29, the notes page, is an extra), `--only`, `--model`. Control-C (or the hub's Stop) ends the task under way, skips the rest and records what ran as stopped. |
| `tools/verify-tasks.sh` | Proves every task's check fails on the untouched project and passes with its reference answer. |
| `bench/words/real.mjs` | 28 real requests built around trigger words and blocked commands, in three kinds of folder. `--think on` runs them with thinking (High; 12 minutes a request instead of 6). Stops the same way. |
| `run-tests.mjs` | The tests the hub's Tests tab can run (**▶ Run tests**, `/test`: each with its own ▶, one at a time in the runner's line, with the control panel's settings, `cleanSettings`): Practice 28, one practice task, the real requests, the long task, the Work 28 and New 28 on one model, your own tests (all of them, the ones of one level: Easy, Medium, Hard, or one by its number), and, with no model, the unit tests and the repo check. What each is, the command it starts (thinking off, Low, or on, High: the panel's Effort row), how its progress is counted and how its record line is found. The Battle arena's runner runs them (below). |
| `tools/speed.mjs`, `soak.mjs`, `reread.mjs` | Engine settings, long conversations and cold starts, what gets re-read each step. |
| `bench/night/start.sh` | All of the above overnight, with a morning report. |
| `battle/` | The Battle arena (the hub's Battle tab, `/battle`): Gemma vs Qwen on tests you make and the New 28 (`battle/new28/`), one model at a time, each run stopped at 10 min, a blind vote. Its header: **Load** one test or a set (All New 28, one kind of them, or My tests) and press **Battle**; what is loaded replaces the line, and a set runs only the tests not done yet. The Load list shows each test's last result and opens it. `runner.mjs` is its own server (8758); it also runs the Tests tab's test runs, one at a time, with the same hold on the memory (only the hub, with the key in `runner.token`, can start or stop one). `run-one.mjs` is one model on one test, `run-set.mjs` one model on a whole set (Work 28 or New 28, one line in the record as a Battle set; `--think on` with thinking, which `run-one.mjs` takes too), `fake-one.mjs` and `fake-test.mjs` the stand-ins for practice mode, `checks.mjs` the pass checks, `verify-new28.mjs` proves each New 28 test fails as given and passes with its answer. Your tests and battles stay in `~/.agentic-coder/battle/`. |
| `battle/builder.mjs`, `suggest.mjs` | The Test builder (the hub's Test builder tab, `coding hub builder`): tests of your own made in full, each with a level. **Easy** is worth 1 point and stops at 5 minutes, **Medium** 2 and 10, **Hard** 3 and 20 (a test can have its own limit; a battle stops every test at 10). `suggest.mjs` reads a pasted list (`Prompt 1 — Title`, then its words) and picks the checks that fit each prompt's own words: what the prompt asks for is ticked, what it makes optional is listed with the reason, and the parts only a person can judge are listed as "by eye". A level starts a test with its checks (Easy the basics, Medium adds the layout check, Hard every part the prompt names); ticks made by hand stay. `checks.mjs` has the checks it adds: a page was made, so many buttons or list items, the bar is drawn, and the layout check (the app's own, measured by `runChecksWith`). `builder.mjs` saves, pastes, duplicates, trashes and restores, exports and imports, and tries a test's page checks on a page with no model (one you hand it, or the last page a run of the test made, kept in `battle/pages/`). A test with its design switch on runs with the design folder and the layout fix, as the app does. `run-set.mjs --set mine --level hard` runs one level; a run of your own tests ends with the points it got. |
| `reports/` | The builders of the report pages; pages go to `agentic-coder DOCS/` at the top of the repo, mirrored into the repo's `docs/`. |
| `dev/` | Probes and experiments against a running server (see `dev/experiments/README.md`). |

Only one model fits in memory at a time on a 16 GB Mac, so bench runs wait for each other. A battle, or a test run from the Tests tab, holds the memory while it runs (`~/.agentic-coder/battle/running.json`): an Agentic Coder window waits, or lets its model go when idle and loads it again after.
