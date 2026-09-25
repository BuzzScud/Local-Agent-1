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
│  ├─ src/              cli, app (the screen), agent (the loop), flows, tools
│  ├─ test/             unit tests and the app driven by keys in a real terminal
│  ├─ scripts/          screen captures and the terminal's report pages
│  ├─ docs/             the terminal's design and report pages
│  ├─ app/              the Bonsai Code.app launcher and its icon
│  └─ demo-project/     a small project the tests and demos work on
└─ models/              part 2 · the models we use and test
   ├─ index.mjs         the one entry the terminal imports
   ├─ registry.mjs      the list of models and where their files live
   ├─ runtime/          llama-server, memory, warm-up, bonsai setup
   ├─ bonsai-2-27b/     the model: settings, README, reports/ (results/ stays local)
   ├─ evals/            the test bench: 28 practice tasks, 28 real requests, speed, soak, night runs
   └─ test/             unit tests of the models part
```

## Commands

```
bun run start              # run from source (bun terminal/src/cli.jsx)
bun run test               # all 124 tests: terminal/test and models/test
bun run test:terminal      # only the terminal's
bun run test:models        # only the models part's
bun run eval               # the 28 practice tasks against the real model (models/evals/run.mjs)
bun run eval:words         # the 28 real requests
bun run eval:verify        # prove every practice task's check can fail and pass
bun run install-cli        # build one file and put it at ~/.local/bin/bonsai
```

Setup on a new Mac: `bun install`, then `bonsai setup` downloads Prism's
llama.cpp build and the model into `~/.bonsai-code`.

## License

GPL-3.0, see [LICENSE](LICENSE).
