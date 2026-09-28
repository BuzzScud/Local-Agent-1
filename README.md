# Agentic Coder

*Formerly Bonsai Code (renamed 28 Sep 2026, when the brain became swappable).*

*Local-Agent-1.* A Claude Code–style coding agent for your terminal, running a local model on
this Mac. Nothing leaves the machine.

```
cd any/project
coding                     # start here
coding "fix the tests"     # start with a first prompt
coding -c                  # continue the last conversation in this folder
coding -p "what does x do" # answer once and exit
```

## Two parts

| Part | Folder | What it is |
|---|---|---|
| **1 · The terminal** | [`terminal/`](terminal/README.md) | The agent you talk to: the screen, keys, permissions, the tool loop, the focused paths (fix, change, several files, rename), the questions it asks you. It works with any model the models part offers. |
| **2 · The models** | [`models/`](models/README.md) | The models we use and test, one folder each, plus what runs them (llama-server, memory, warm-up, setup) and the test bench that measures the agent with a model (practice tasks, real requests, speed and soak runs, reports). |

The model today is **Gemma 4 12B QAT** (Google, quantization-aware 4-bit, 6.7 GB):
[`models/gemma-4-12b/`](models/gemma-4-12b/model.mjs) holds its settings. The previous
brain, **Bonsai 2 27B**, is kept as a recipe in [`models/bonsai-2-27b/`](models/bonsai-2-27b/README.md)
(settings, checksum, what was measured); its file was removed to free the disk.

The terminal talks to the models part through one file, `models/index.mjs`. The
test bench goes the other way: it runs the terminal's agent with a model and grades
the result, so a new model is tested the same way the last one was.

```
agentic-coder/
├─ terminal/            part 1 · the agent terminal
│  ├─ src/              cli, app (the screen), agent (the loop), flows, tools, ui, morning (the brief)
│  ├─ test/             unit tests and the app driven by keys in a real terminal
│  ├─ scripts/          captures, report builders, design previews (demo/), the devtools shim
│  ├─ app/              the Agentic Coder.app launcher, the `coding` launcher script, the icon
│  └─ demo-project/     a small project the tests and demos work on
├─ models/              part 2 · the models we use and test
│  ├─ index.mjs         the one entry the terminal imports
│  ├─ registry.mjs      the list of models and where their files live
│  ├─ runtime/          llama-server, memory, warm-up, coding setup; engine/ = how llama.cpp is built (Prism's, or the official)
│  ├─ gemma-4-12b/      the model in use: settings (results/ stays local)
│  ├─ bge-m3/           the small model that compares meanings, for the memory and the code search
│  ├─ bonsai-2-27b/     the previous model, kept as a recipe (file removed)
│  ├─ evals/            the test bench: bench (run, tasks, words, night), reports, tools, dev
│  └─ test/             unit tests of the models part
└─ docs/                every diagram, preview and report page, the one home (mirrors agentic-coder DOCS/, which is on the Mac only); tools/ = the mirror's two scripts
```

Only on this Mac, not in git: each model's `results/`, `models/evals/dev/experiments/julia-recall/`
(the memory-matcher experiment and its results), `agentic-coder DOCS/`, and `~/.agentic-coder`
(the engines, the model files, settings, logs and the test record).

## Commands

```
bun run start              # run from source (bun terminal/src/cli.jsx)
bun run test               # every unit test: terminal/test and models/test (a full run is added to the test record)
bun run test:terminal      # only the terminal's
bun run test:models        # only the models part's
bun run eval               # the 28 practice tasks against the real model (models/evals/bench/run.mjs)
bun run eval:words         # the 28 real requests
bun run eval:verify        # prove every practice task's check can fail and pass
bun run install-cli        # build one file and put it at ~/.local/bin/coding
bun run docs               # mirror agentic-coder DOCS/ into docs/ (run before a commit)
bun run test:record        # add test runs that are on this Mac but not yet in the test record
bun run check              # is anything here that should not be? secrets, packages, where the code connects, the installed app, the tests
```

Every test run adds a line to the test record (`~/.agentic-coder/tests/record.jsonl`); the hub shows it on its
Tests tab: `/tests` in Agentic Coder, or `coding tests`.

Every diagram, preview, report and test page lives in [`docs/`](docs/README.md), newest first.

Setup on a new Mac: `bun install`, `bun run install-cli`, then `coding setup` builds the model server (llama.cpp
on the model's engine: Prism's with our Metal patch today, a few minutes; needs cmake and Apple's command line
tools, see [`models/runtime/engine`](models/runtime/engine/README.md)) and downloads the model
into `~/.agentic-coder`. Environment switches are `AGENTIC_*` (the old `BONSAI_*` names still work).

## License

GPL-3.0, see [LICENSE](LICENSE).
