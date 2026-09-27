# Bonsai Code

*Local-Agent-1.* A Claude Code–style coding agent for your terminal, running a local model on
this Mac. Nothing leaves the machine.

```
cd any/project
bonsai                     # start here
bonsai "fix the tests"     # start with a first prompt
bonsai -c                  # continue the last conversation in this folder
bonsai -p "what does x do" # answer once and exit
```

## Two parts

| Part | Folder | What it is |
|---|---|---|
| **1 · The terminal** | [`terminal/`](terminal/README.md) | The agent you talk to: the screen, keys, permissions, the tool loop, the focused paths (fix, change, several files, rename), the questions it asks you. It works with any model the models part offers. |
| **2 · The models** | [`models/`](models/README.md) | The models we use and test, one folder each, plus what runs them (llama-server, memory, warm-up, setup) and the test bench that measures the agent with a model (practice tasks, real requests, speed and soak runs, reports). |

The model today is **Bonsai 2 27B** (Prism ML's ternary model, 7.2 GB):
[`models/bonsai-2-27b/`](models/bonsai-2-27b/README.md) holds its settings, what was
measured, and the report pages.

The terminal talks to the models part through one file, `models/index.mjs`. The
test bench goes the other way: it runs the terminal's agent with a model and grades
the result, so a new model is tested the same way the 27B was.

```
bonsai-code/
├─ terminal/            part 1 · the agent terminal
│  ├─ src/              cli, app (the screen), agent (the loop), flows, tools, ui, morning (the brief)
│  ├─ test/             unit tests and the app driven by keys in a real terminal
│  ├─ scripts/          captures, report builders, design previews (demo/), the devtools shim
│  ├─ app/              the Bonsai Code.app launcher and its icon
│  └─ demo-project/     a small project the tests and demos work on
├─ models/              part 2 · the models we use and test
│  ├─ index.mjs         the one entry the terminal imports
│  ├─ registry.mjs      the list of models and where their files live
│  ├─ runtime/          llama-server, memory, warm-up, bonsai setup; engine/ = our build of it
│  ├─ bonsai-2-27b/     the model: settings and README (results/ stays local)
│  ├─ evals/            the test bench: bench (run, tasks, words, night), reports, tools, dev
│  └─ test/             unit tests of the models part
└─ docs/                every diagram, preview and report page, the one home (mirrors bonsai-code DOCS/, which is on the Mac only)
```

## Commands

```
bun run start              # run from source (bun terminal/src/cli.jsx)
bun run test               # every unit test: terminal/test and models/test (a full run is added to the test record)
bun run test:terminal      # only the terminal's
bun run test:models        # only the models part's
bun run eval               # the 28 practice tasks against the real model (models/evals/bench/run.mjs)
bun run eval:words         # the 28 real requests
bun run eval:verify        # prove every practice task's check can fail and pass
bun run install-cli        # build one file and put it at ~/.local/bin/bonsai
bun run docs               # mirror bonsai-code DOCS/ into docs/ (run before a commit)
bun run test:record        # add test runs that are on this Mac but not yet in the test record
```

Every test run adds a line to the test record (`~/.bonsai-code/tests/record.jsonl`); the hub shows it on its
Tests tab: `/tests` in Bonsai, or `bonsai tests`.

Every diagram, preview, report and test page lives in [`docs/`](docs/README.md), newest first.

Setup on a new Mac: `bun install`, then `bonsai setup` builds the model server (Prism's
llama.cpp with our Metal patch, a few minutes; needs cmake and Apple's command line
tools, see [`models/runtime/engine`](models/runtime/engine/README.md)) and downloads the model
and its guessing helper into `~/.bonsai-code`. `BONSAI_HELPER=off` runs without the helper.

## License

GPL-3.0, see [LICENSE](LICENSE).
