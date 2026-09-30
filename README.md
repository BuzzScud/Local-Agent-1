# Agentic Coder

*Formerly Bonsai Code (renamed 28 Sep 2026, when the brain became swappable).*

*Local-Agent-1.* A Claude Code–style coding agent for your terminal, running a local model on
this Mac. Nothing leaves the machine.

## Install

**You need:** a Mac with Apple Silicon (M1 or newer), 16 GB of memory, about 12 GB of free
disk, and an internet connection for the first install.

**Paste this into Terminal:**

```sh
curl -fsSL https://raw.githubusercontent.com/BuzzScud/Local-Agent-1/main/install.sh | sh
```

It does five steps and prints a ✓ after each:

1. **Checks your Mac**: macOS, Apple Silicon, memory, and Apple's command line tools. If the
   tools are missing, a window opens to install them. Finish it, then paste the line again.
2. **Installs Bun** (what builds and runs the app), if you don't have it. It asks first.
3. **Downloads Agentic Coder** into `~/agentic-coder`.
4. **Builds the app** and adds the `coding` command (in `~/.local/bin`, added to your PATH).
5. **Gets the model.** It asks first, then builds the model server (llama.cpp, about 3
   minutes; it offers to install `cmake` with Homebrew if it's missing) and downloads about
   8.5 GB: Gemma 4 12B plus three small helper models. If you say no, run `coding setup`
   later.

When it says **Done**, open a new Terminal window and start it in any project:

```sh
cd ~/your-project
coding
```

You can run the installer again at any time. It updates the code and skips the parts that
are already done. Options: `AGENTIC_DIR=~/somewhere` picks the folder, and `AGENTIC_YES=1`
answers yes to every question (`curl … | AGENTIC_YES=1 sh`).

<details>
<summary>Install by hand instead (the same steps)</summary>

```sh
xcode-select --install                     # Apple's command line tools (skip if you have them)
brew install cmake                         # needed to build the model server
curl -fsSL https://bun.sh/install | bash   # Bun
git clone https://github.com/BuzzScud/Local-Agent-1.git ~/agentic-coder
cd ~/agentic-coder
bun install
bun run install-cli                        # builds the app, puts `coding` in ~/.local/bin
export PATH="$HOME/.local/bin:$PATH"       # add this line to ~/.zshrc too
coding setup                               # model server + models, about 8.5 GB
```
</details>

**Check that it works:** `coding -p "what is 6 times 7"` should answer 42. The first
answer takes a little longer while the model loads.

<details>
<summary>If something goes wrong</summary>

| You see | Do this |
|---|---|
| `command not found: coding` | Open a new Terminal window, or run `export PATH="$HOME/.local/bin:$PATH"`. |
| `cmake is missing` | `brew install cmake` (Homebrew: [brew.sh](https://brew.sh)), then `coding setup`. |
| `… is damaged (SHA-256 …)` | A download broke. Delete the file it names, then run `coding setup` again. |
| `The first build failed` | Its log is in `~/.agentic-coder/logs/update.log`. |
| The model is slow or won't start | Close other big apps: the model needs most of a 16 GB Mac's memory. |
</details>

**Update:** `cd ~/agentic-coder && git pull`. The next `coding` rebuilds itself.
**Uninstall:** delete `~/.local/bin/coding`, `~/.agentic-coder` (the model files and
settings) and `~/agentic-coder`.

## Use it

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
│  ├─ qwen3-reranker-0.6b/ the reranker /effort's Reranker row turns on (off by default)
│  ├─ bonsai-2-27b/     the previous model, kept as a recipe (file removed)
│  ├─ evals/            the test bench: bench (run, tasks, words, night), battle (the Arena: its runner, page and tests), reports, tools, dev
│  └─ test/             unit tests of the models part
└─ docs/                every diagram, preview and report page, the one home (mirrors the page groups of cli docs/, which is on the Mac only); tools/ = the mirror's two scripts
```

Only on this Mac, not in git: each model's `results/`, `models/evals/dev/experiments/julia-recall/`
(the memory-matcher experiment and its results), `cli docs/` (the pages, plus the owner's own
folders that are never mirrored), and `~/.agentic-coder`
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
bun run battle:verify      # prove every Battle test that comes with the arena (New 28, Work 28, Practice 28) fails as given and passes with its answer (no model)
bun run install-cli        # build one file and put it at ~/.local/bin/coding
bun run docs               # mirror the page groups of cli docs/ into docs/ (run before a commit)
bun run test:record        # add test runs that are on this Mac but not yet in the test record
bun run check              # is anything here that should not be? secrets, packages, where the code connects, the installed app, the tests
```

Every test run adds a line to the test record (`~/.agentic-coder/tests/record.jsonl`); `/tests` in Agentic
Coder (or `coding hub tests`) shows it. Tests are run from the hub's **Arena** tab (`/arena`, or `/test` with a
test named; it is the Tests tab and the Battle tab as one): tick tests, sets or checks on the left, say who runs
them on the right (Gemma, Qwen, or both: a battle, with a blind vote) and set the run in the panel, then press the
button and watch the result in the middle. Everything runs one at a time in one line, keeps going if you close
Agentic Coder, and Stop is there while it runs.

The hub's **Test builder** tab (`coding hub builder`, or + New in the Arena) is where tests of your own are
made: paste a list of prompts or write one, give each a level (Easy, Medium, Hard: its points and its time limit),
confirm the checks suggested from the prompt's words, try them on a page with no model, then run them by level from
the Arena. They are kept on the Mac only, in `~/.agentic-coder/battle/tests/`.

Every diagram, preview, report and test page lives in [`docs/`](docs/README.md), newest first.

Setup on a new Mac: see [Install](#install) at the top (`install.sh` does it in one line). `coding setup` builds
the model server (llama.cpp on the model's engine: Prism's with our Metal patch today, see
[`models/runtime/engine`](models/runtime/engine/README.md)) and downloads the models into `~/.agentic-coder`.
Environment switches are `AGENTIC_*` (the old `BONSAI_*` names still work).

## Shared instructions

Open the hub’s **Instructions** tab with `/instructions` in the app (also in `/settings`) or `coding hub instructions`
in a shell (no model download needed). Edit **General** behavior and **Planning** rules, inspect
loaded project context, and preview the main or focused coding prompt. Save applies both sections
to the next task in an updated app; an in-progress task keeps its current instructions.

Instructions are stored locally in `~/.agentic-coder/instructions.json` (`AGENTIC_HOME` overrides
that folder). The editor detects conflicting saves, keeps up to 20 previous versions for undo,
and can load recommended defaults into the draft. Project rules stay in `AGENTS.md`, `CLAUDE.md`,
and the existing notes/memory sources. Tool permissions remain enforced by the app.

Planning uses the selected coding model and existing task-list tool. These defaults request a
brief covering goal, evidence, scope, steps, checks, and unknowns; they are guidance, not a
separate planner or proof of correctness. Compare real task success and elapsed time when tuning them.

**Project context** (tab 03) shows one card per notes file for a folder you pick: what kind it is
(this project's rules, a folder above, your rules for every folder, private notes, the memory),
whether it arrives whole, cut or left out (the notes get 9,000 characters), and which wins: your
words in the chat, then the notes, then General and Planning, then the built-in defaults.
**Prompt preview** (tab 04) splits the prompt into its parts with each part's size, the share of
the model's memory it takes, whether it is kept on disk or read again, and what the side calls
get; with a model running, the counts come from its own tokenizer. Its "Added to each request"
view also picks the design style (Auto, Opus, Fable or Mix) and shows the design cards a request
would bring.

Since 30 Sep 2026 the built-in prompt has a **Work habits** block (how Opus and Fable work: act
once you know enough, pick one way, report failures plainly, Read and Search over cat and grep…),
names each notes file's kind and says which notes win. `AGENTIC_PROMPT=old` gives the prompt from
before, and the Arena's **Prompt old vs new** check (`/test prompt`) runs the Practice 28 with both.

## License

GPL-3.0, see [LICENSE](LICENSE).
