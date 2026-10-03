# Agentic Coder

*Formerly Bonsai Code (renamed 28 Sep 2026, when the brain became swappable).*

*Local-Agent-1.* A Claude Code–style coding agent for your terminal, running a local model on
this Mac. Nothing leaves the machine, unless you point it at a model on another machine of
yours with [`/remote`](#a-model-on-another-machine).

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
   8.2 GB: Qwen3.5 9B plus two small helper models. If you say no, run `coding setup`
   later.

When it says **Done**, open a new Terminal window and start it in any project:

```sh
cd ~/your-project
coding
```

**Terminal only (no model download).** If the model runs somewhere else (another machine of
yours, Ollama, LM Studio, or an API), the installer asks "Where will the model run?": answer
**2**. It skips the 8.2 GB download and the model-server build, then asks for the address (and
the API key, if there is one), checks them, and saves them. To skip the question:

```sh
curl -fsSL https://raw.githubusercontent.com/BuzzScud/Local-Agent-1/main/install.sh | sh -s -- --terminal-only
```

Later, `coding connect` does the same step again, and `/remote` in the app changes it.

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
coding --way model         # the model decides, like Claude Code (/effort shows it as Who decides)
```

### /agents: spec, plan, test-first build, verify, review, ship

`/agents build a Kepler solver: where an orbit is at time t` takes one request through six stages
(after Addy Osmani's agent setup), drawn live as an agent tree (after the agent-tree screen of
Claude Code's /advisor): the main model at the top, the stage's four steps as bars, three helpers,
the second opinion on call down the left, the session log and one status line.

| Stage | Its four steps | What it leaves |
|---|---|---|
| 01 Define | ask · answer · write · check | a short interview, then `SPEC.md` and `CONSTRAINTS.md` |
| 02 Plan | look · split · checks · write | `tasks/plan.md` and `tasks/todo.md`; the second opinion reads it, then your one yes ("looks fine" is not a yes) |
| 03 Build | red · green · check · save | per task: a failing test, the least code to pass it (three tries, then it asks), the whole suite, a rewind point and the second opinion |
| 04 Verify | suite · run · cross · proof | the request run the way you would, and checked a second way (for math: another method) |
| 05 Review | read · find · show · grade | five areas (math gets correctness, stability, precision, speed, readability), each finding with file:line and a fix; a critical one goes back to Build |
| 06 Ship | code · security · tests · merge | three reviewers, `tasks/ship.md`, GO or NO-GO and how to roll it back |

It never commits: every step is a /rewind point, and the report says to read `git diff`. It stops
and asks on the stop list: auth, payments, deploys, migrations, secrets, deletions, a test's
expected value or tolerance changed, a new package, a task over 100 lines or 3 files, and a test
that will not pass after three tries. Verify, Review and Ship only read. The second opinion is the
review model from `/subagents`; without one, the main model with a fresh context.

While its tree is open: 1–3 or ↑↓ enter answer, p pauses, esc shows the chat with one live line
(esc or `/agents` opens the tree again), and a message you type goes with its next step. In
Terminal or iTerm2 the window grows to 112 × 59 while it runs and goes back after
(`AGENTIC_AGENTS_RESIZE=off` leaves it); under 38 rows the tree is drawn as lines. `/agents demo`
shows it on a pretend run, `/agents stop` ends a run, `/agents resume` picks up one that did not
finish (`.agentic/agents/run.json`). `coding -p --agents "…"` runs it with no screen. The Arena's
**Agents check** (`/test agents`) measures it against a plain request. `/morning` gave /agents its
row in the `/` menu and is typed in full now.

### Pictures and PDFs

Drag a screenshot or a PDF into the window, name it with `@shot.png`, or copy a screenshot
(ctrl+shift+cmd+4) and press **ctrl+v**: it goes with your message. The model looks at a picture
once its vision add-on is loaded: the first picture you attach loads it (the model reloads once,
about 20 s; it is downloaded then if `coding setup` has not got it yet: Qwen's is 0.92 GB, Gemma's
0.18 GB). The model can also look at a picture it finds by itself with Read: its vision is
turned on then, the same way. A PDF goes as its text, page by page; a page with no text (a scan)
goes as a picture, and the model can look at any page as one (a figure). Pictures are made
smaller before they are sent (1280 px at most), Qwen's are given at least 1024 tokens (at fewer it
misread small text), and only the latest three go with each request. It all uses what macOS has
(a small Swift helper built on first use with Apple's command line tools); nothing else is
installed. The Vision check and Picture tokens in the Arena test it with the real model.

### The web

The model can read a web page and, with a search service, search the web. Type `/web` (or pick
Web in `/settings`) and fill in one form: **Search** (Off, Brave Search or Tavily), its **API key**
(from api-dashboard.search.brave.com or app.tavily.com; kept in the Keychain), **Read pages** (On
or Off), and what Claude may do when `/remote` is on the Claude API. **Test** runs one search with
the key before anything is saved.

Every search asks first, and so does the first page from each site; "don't ask again" holds for
the rest of the session, and "always allow" saves the rule (`WebSearch`, `WebFetch(docs.python.org)`)
in `/permissions` for the folder. A page comes back as its text: headings, lists, tables, code and
links, without scripts, styling or menus; a PDF as its text, a picture as a picture. A redirect to
another site is not followed: the model is told where it goes and asks for it. What a page or a
search brings back is marked as data from the web, not instructions. On the Claude API, Claude uses
Anthropic's own web search and fetch instead: they run on Anthropic's side, billed to that key,
without asking here (the Claude API row turns them off). `coding -p` uses the same settings; with
`--yes` it does not ask.

### Helpers (subagents)

The model can hand one piece of work to a helper: a second agent that starts fresh (it sees none
of the conversation), works with its own tools, and sends back only its report, so a search that
takes many reads does not fill the conversation. An **explore** helper only reads (files, the code
search, the web) and reports what it found with file:line; a **general** helper may also edit and
run commands, each change asked about as your mode says (a no ends the turn, as for any change).
While a helper works, one line shows its steps as they come; after, it is one step in the
conversation, and ctrl+o shows its steps and its report. esc stops it with the rest.

Helpers are offered when the model decides (`/effort`, Who decides: Model) and on the Claude API.
On this Mac one runs at a time, on the model server's second slot, so the conversation keeps its
place on the first and goes on without reading everything again; on the Claude API several in
one reply run side by side. `"subagents": false` in settings.json leaves them out. The Subagent
check in the Arena tests them with the real model.

### A model on another machine

The model can run on another computer: a bigger Mac, a PC with a GPU, a rented GPU server, a
hosted API, or Claude. Type `/remote` in Agentic Coder: the first row, **Run on**, picks where,
and only that choice's rows show (the ones seldom changed behind **More**, ←→ or enter):

| Run on | Its rows | Behind More |
|---|---|---|
| This Mac | none: Switch comes back here | |
| Claude API | API key (from console.anthropic.com, or blank with `ANTHROPIC_API_KEY` set), Model (◀ Opus 5.5 · Sonnet 5.5 · Fable 5.1 · Haiku 4.5 ▶) | Address (blank: Anthropic's), Context (at most 200k unless you pick more) |
| My other computer | Address (an IP or a name, or for SSH `user@host` or a name from `~/.ssh/config`), Reach by (Home network (http) · Internet (https) · SSH tunnel, which Agentic Coder opens itself with your ssh keys), API key (the one `coding serve` printed) | Port (8080 for `coding serve` and llama-server), Server (llama.cpp, or OpenAI-compatible for Ollama, LM Studio, vLLM), Model, Context |
| Another service | Address (the whole `https://…` address, path included), API key, Model (the name it wants; ←→ through its list after a Connect) | Reach by, Port, Context |

Each one keeps its own rows and its own API key (in the macOS Keychain, never in a file of the
repo or in settings.json), so flipping Run on loses nothing. **Connect** checks the rows as they
are (reached, key accepted, what it runs, one word back) and only when that works saves them and
switches; when it does not, nothing changes and what it found shows under the row. **Save only**
keeps them for later. When a remote stops answering, Agentic Coder says why and asks: try again,
use the model on this Mac for now, or open the form. `/remote claude`, `/remote computer` and
`/remote service` switch straight to one (the form asks for its first row when it is not set up),
`/remote here` comes back to this Mac, and `/model` lists each one set up as a row of its own;
`coding -p` follows the one in use (`--local` runs on this Mac instead).

**Ollama:** on an Ollama service, `/model` is the service's own list, read from Ollama's API: the
loaded models first, then the ones that can run the agent (they call tools), each with its size,
context and what it can do (tools, thinking, pictures). Type to filter. Enter switches in place: the
chat stays, and the model is loaded on the service first. The chat-only models (no tools) fold into
one row and ask before you switch to one. The footer names the model and where it runs
(`● qwen3-coder:30b on gpu-box:11434`), and a click on it opens `/model` (`/mouse on`).
Requests go through Ollama's own chat, the one that takes a context size: `/effort`'s Context row
sets each model's (8k up to its longest; auto is the size it is loaded at), and the model loads
again at that size. A model that does not fit in the service's GPU memory is tried again at half
the context, down to 32k, and the size it fits at is kept for it; one that never fits goes back to
the model before, and a message sent meanwhile waits for it.

**Big-model mode:** a model on the service with 30B parameters or more (by its total) that can call
tools gets more room than a small model on this Mac: `/effort` starts it on 80 steps a request,
12 tries a fix and 160 lines of command output, and Read gives a file whole up to 400 lines (a part
400 at a time, 1,000 at most). The app still decides (Who decides: App): with the model deciding,
qwen3-coder-next passed 22 of the 28 practice tasks against 26, in 73% more time. What you saved
in `/effort` still wins. `/model` marks these models
"big", and a note says when a switch turns the mode on or off. `models/evals/tools/big-ab.mjs`
runs the practice tasks on a service with it off and on (`/test big`).

**Claude:** `/remote claude`, paste an API key, enter, enter. It goes through Anthropic's own
Messages API and official SDK: High effort thinks first and shows its summarized thinking, Low
asks for effort low, JSON answers are held to their schema, the conversation is cached, and a
request the model declines is retried on Anthropic's fallback model. Every step sends the
conversation again and is billed to the key.

On the other machine, if it is a Mac or a Linux box with this repo installed:

```
coding serve              # the model for other machines, behind a new API key; prints what to type into /remote
coding serve --local      # this machine only: reach it with Reach by = SSH tunnel
coding serve --https cert.pem key.pem   # https with your certificate (tailscale cert makes one)
```

With a remote in use, your prompts, your code and the files Agentic Coder reads go to that
machine. The memory's small search models still run on this Mac.

## Background sessions, and opening them from another Mac

Like Claude Code's `claude --bg` and `claude attach`. Each `coding` window runs its app in a
keeper with no window, so the session can outlive the window (Bun 1.3.5 or later; with an older
Bun the app runs in the window as before):

```
ctrl+b                    # in a coding window: it closes, the session keeps running
coding --bg "fix the tests"   # start one with no window
coding sessions           # what runs in the background here
coding attach [name]      # open one in this window (ctrl+b leaves it again; quitting there ends it)
```

Closing the window a session started in ends it, as before; closing one that attached only
leaves. Several windows can show one session at once: what any of them types reaches it, and it
is drawn at the smallest window's size.

From another Mac, over [Tailscale](https://tailscale.com): on the Mac with the sessions run
`coding door on` once, in Terminal. It listens on that Mac's Tailscale address only and asks for a
key it prints. It runs as started from Terminal, so a session it starts may use your Desktop and
Documents as Terminal does (a login item's own program may not). After a restart a login item opens
a Terminal window that starts it again; `coding door off` removes both. Then, on the other Mac:

```
coding sessions <mac>     # its sessions (the Tailscale name, e.g. coding sessions studio)
coding attach <mac>       # pick one, or start a new one there
coding attach <mac> <name>
```

The key is asked once and kept in the Keychain. A window from another Mac never ends a session by
closing; quit inside it, or ctrl+b to leave it running.

`coding attach <mac>` lists what runs there, then what can be started there: a new session in a
folder you worked in on that Mac, in its home, or in a folder you type (`~` is its home), or its
last conversation carried on. The Mac the session runs on shows it too: a Terminal window opens
there, at your window's size, so both screens show the same session and either can type. The
footer says `⇄ on <that Mac>` while another Mac has a window on a session.

A window on another Mac checks in every 10 seconds. If the link is lost (your Mac slept, the
network dropped), the window says `Connection to <mac> lost, reconnecting…` and opens the same
session again by itself when the link is back; ctrl+b stops the waiting. On the other side, a
window that has said nothing for 35 seconds, or has fallen 16 MB behind, is let go: the session
is no longer drawn at its size or counted as open there. Five wrong keys from one address refuse
it for a minute, however they are sent. `~/.agentic-coder/logs/sessions.log` keeps what each
session did. The Arena's **Door check** measures all of this on one Mac (no model, about 90
seconds).

If the other Mac takes the connection and then says nothing, the window says so and gives the
terminal back: look at that Mac's screen, where macOS may be asking whether Agentic Coder may
accept incoming connections (Allow), or about a folder. The door itself never waits on a folder:
its list of folders is read with a time limit, and a list is answered without it when it cannot
be read in time.

## Two parts

| Part | Folder | What it is |
|---|---|---|
| **1 · The terminal** | [`terminal/`](terminal/README.md) | The agent you talk to: the screen, keys, permissions, the tool loop, the focused paths (fix, change, several files, rename), the questions it asks you. It works with any model the models part offers. |
| **2 · The models** | [`models/`](models/README.md) | The models we use and test, one folder each, plus what runs them (llama-server, memory, warm-up, setup) and the test bench that measures the agent with a model (practice tasks, real requests, speed and soak runs, reports). |

The model today is **Qwen3.5 9B** (Alibaba, 6.9 GB, its speed-up layer inside the file):
[`models/qwen3.5-9b/`](models/qwen3.5-9b/model.mjs) holds its settings. It became the default on
30 Sep 2026: with thinking on it passed 24 of 24 practice tasks in about half the time Gemma
took for 22. **Gemma 4 12B QAT** (Google, 6.7 GB) is still one pick away in `/model`
([`models/gemma-4-12b/`](models/gemma-4-12b/model.mjs); `coding setup` downloads only the
default, so run it with Gemma picked to get Gemma's file). The previous
brain, **Bonsai 2 27B** (Prism ML's ternary Qwen3.8 27B, 7.2 GB), is back in `/model` since
1 Oct 2026 ([`models/bonsai-2-27b/`](models/bonsai-2-27b/README.md); `coding setup --model bonsai`
downloads it). **Bonsai 2 27B ConstantKV** sits beside it from the same day: the same weights on
Apple's MLX with a memory that stays 1.27 GB at any length, so it starts at 64k
([`models/bonsai-2-27b-constantkv/`](models/bonsai-2-27b-constantkv/model.mjs)). Its runtime is
closed and research-licensed (no commercial use): `coding setup --model constantkv` shows the
license and asks before it downloads 8.7 GB and makes its Python.

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
│  ├─ runtime/          llama-server, memory, warm-up, coding setup; engine/ = how llama.cpp is built (Prism's, or the official); mlx/ = the MLX engine's server
│  ├─ qwen3.5-9b/       the default model: settings (results/ stays local)
│  ├─ gemma-4-12b/      the other model in /model: settings (results/ stays local)
│  ├─ bge-m3/           the small model that compares meanings, for the memory and the code search
│  ├─ qwen3-reranker-0.6b/ the reranker /effort's Reranker row turns on (off by default)
│  ├─ bonsai-2-27b/     the previous model, back in /model: settings (results/ stays local)
│  ├─ evals/            the test bench: bench (run, tasks, words, night), battle (the Arena: its runner, page and tests), reports, tools, dev
│  └─ test/             unit tests of the models part
└─ docs/                every diagram, preview, report and test page, the one home, by group (gemma-docs/ is one); private/ = the owner's own, on the Mac only; tools/ = the index and its check
```

Only on this Mac, not in git: each model's `results/`, `models/evals/dev/experiments/julia-recall/`
(the memory-matcher experiment and its results), `docs/private/` (the owner's memory, design cards,
the design studio's UI pieces, morning briefs and Gemma run files; git keeps only docs/'s page groups), and `~/.agentic-coder`
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
bun run docs               # rewrite docs/README.md, the index; fails if docs/private/ is tracked or a page holds your home path (run before a commit)
bun run test:record        # add test runs that are on this Mac but not yet in the test record
bun run check              # is anything here that should not be? secrets, packages, where the code connects, the installed app, the tests
```

Every test run adds a line to the test record (`~/.agentic-coder/tests/record.jsonl`); `/tests` in Agentic
Coder (or `coding hub tests`) shows it. Tests are run from the hub's **Arena** tab (`/arena`, or `/test` with a
test named; it is the Tests tab and the Battle tab as one), in four steps: **1 Model & settings** (who runs it, a
model alone or any two in a battle with a blind vote, and the panel), **2 Tests** (One test or check, or a Group of
tests, sets and checks), **3 Run** (the group's timeline on top and a terminal of every step, command and answer as it
happens) and **4 Results** (that group's, with every step, and every earlier group). Everything runs one at a time in
one line, keeps going if you close Agentic Coder, and Stop is there while it runs.

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
(this project's rules, a folder above, your rules for every folder, the memory),
whether it arrives whole, cut or left out (the notes get 12,000 characters at 32k Context and more on a bigger one; /effort's Rules room moves it), and which wins: your
words in the chat, then the notes, then General and Planning, then the built-in defaults.
**Prompt preview** (tab 04) splits the prompt into its parts with each part's size, the share of
the model's memory it takes, whether it is kept on disk or read again, and what the side calls
get; with a model running, the counts come from its own tokenizer. Its "Added to each request"
view also picks the design style (Auto, Opus, Fable or Mix) and shows the design cards a request
would bring.

**Prompt files** (tabs 06–08, since 30 Sep 2026) edit the three Markdown files the model is given,
each saved as a real file and read again before your next message:
- **06 AGENTS.md**: the rules file of the folder you pick (the same Folder menu). Saving creates
  it when there is none; the tab says how much of it Qwen gets in the rules room, and when this
  folder's CLAUDE.md is what is read today.
- **07 TOOLS.md** (`terminal/rules/TOOLS.md`): its `## Tool use` lines are the Tool use part of
  the prompt, word for word. As shipped they are the lines from before plus four: search for a name before
  reading, check a change with only the test file that covers it (the Skills check's finding),
  say done only after a tool shows it works, and open a skill from the list when one fits.
  ▶ Run a test → **Tool habits check** runs one task for each of the four, with the lines from before
  and with TOOLS.md now (the shortcuts off, so the lines are what guide it).
- **08 SKILLS.md** (`terminal/rules/SKILLS.md`): steps for kinds of task. Each `## Name` has a
  `- Words:` line and an `- About:` line, then its steps. When a request uses a skill's Words
  (the one with most wins, a phrase counting twice), its steps go with that request and the work
  goes step by step with them instead of the focused fix and change paths. Every skill is listed
  in the prompt as `SKILLS/<name>`, so the model can open one the words missed with Read; when
  Who decides is Model, only the list is given. The tab's "Which skill?" box shows what a request
  would bring. As shipped, the one skill in it is an example switched off (between `<!--` and `-->`).

TOOLS.md and SKILLS.md are in the repo, so they ship with the app and are public after a push
(the app reads them from the repo named by the launcher, `AGENTIC_REPO`, or its built-in copies).
A save never overwrites a change made elsewhere since the tab read the file, and Undo puts back
the text before each save (20 a file, kept in `~/.agentic-coder/prompt-files/`). ▶ Run a test →
**Skills check** measures a skill on the real model: the example on three test-writing tasks,
without and with it.

**The remote set** (`terminal/rules/remote/`, since 2 Oct 2026) is a second set of prompt files for
a model on another machine (/remote), which can take more than the 9–12B models here:
- **HARNESS.md**: its opening, how it works and its rules, in place of the local opening, Work
  habits and Rules (each `##` part keeps its heading: the app builds the instructions from them).
- **TOOLS.md** and **SKILLS.md**: its own Tool use lines and four skills (Write a test, Review
  code, Refactor, Flaky test), in the same formats as the local files.
- **Fourteen guides** (PLANNING, CONTEXT, PERMISSIONS, TESTING, REVIEW, DEBUGGING, BUG-FIXING,
  RECOVERY, DESIGN, SECURITY, SUBAGENTS, MEMORY, GIT, ANSWERS): each is one line in the prompt's
  Guides list (the first sentence under its title) and the model opens it with Read at
  `RULES/<NAME>.md` when the task fits (`Rules/RULES/…` when the project has a RULES folder of its
  own). SUBAGENTS is listed only when the Agent tool is offered. PERMISSIONS comes with a
  **Right now** table the app adds as it is read: what runs, asks or is refused in your current
  mode, and your /permissions rules. TESTING has a "Prove the claim" part, ANSWERS a "Hand off"
  part, and HARNESS's How you work says to match the project's style and to use the packages
  already installed (commands have no internet).

Tab 09's **The model gets** menu picks the set, saved in settings.json as `"instructions"`: Auto
(the default: remote for a model on /remote, local here), Local or Remote. The app reads it before
each message and says when the set changes; `AGENTIC_INSTRUCTIONS` wins over it. A file missing from
`remote/` falls back to the local one (TOOLS, SKILLS), the built-in copy (HARNESS) or is left out
(a guide). Tabs 07–08 get a **Local | Remote** switch, and **09 Remote: HARNESS & guides** edits
the rest, saved and undone like the other files. ▶ Run a test → **Instructions: local vs remote**
plays the Practice 28 and the 10 hard tasks on the /remote model three ways (local, remote, remote
with its skills off); **Hard practice tasks** plays the hard ones alone (`bench/run.mjs --set hard`:
30–39, several files, exact edge cases, a spec to follow, a vague request with two causes).

Since 30 Sep 2026 the built-in prompt has a **Work habits** block (how Opus and Fable work: act
once you know enough, pick one way, report failures plainly, Read and Search over cat and grep…),
names each notes file's kind and says which notes win. `AGENTIC_PROMPT=old` gives the prompt from
before, and the Arena's **Prompt old vs new** check (`/test prompt`) runs the Practice 28 with both.

This repo's own `AGENTS.md` is kept short for the same reason (30 Sep 2026): the rules stay there,
and the background went word for word into `AGENTS-DETAILS.md`, which Claude Code reads through
`CLAUDE.md` and Agentic Coder never does. `terminal/test/agents-md.test.mjs` keeps it under 4,000
characters. The Arena's **Rules file old vs new** check (`/test rules file`) asks the model 10
questions about working here with the old file and with the new one, times the start, and runs one
small task with each.

Also since 30 Sep 2026, **High thinks where it pays**, the local way of Fable's adaptive thinking.
The first round of tests and drafts (the work before the tries) is written without thinking; a
try after a miss thinks, with the miss in front of it; the tries that fix or change the code think
from the first. Past half a request's time for thinking (15 minutes, `AGENTIC_THINK_BUDGET` in
seconds, 0 for never) it thinks only briefly, so it finishes: the chat keeps its thinking switch
but is capped at 64 tokens a reply (Gemma's switch sits at the top of its prompt, so turning it
off would read the whole conversation again), and the focused paths stop thinking. Low is
unchanged. `AGENTIC_THINK=old` gives the way before, and the Arena's **Thinking old vs new** check
(`/test thinking`) runs the Practice 28 at High both ways. Two tries at once, one on each of the
server's two slots, was measured and left out: ×1.02 on Qwen and ×1.07 on Gemma with the speed
helper on (**Two at once**, `/test twoatonce`).

Also since 30 Sep 2026, **Who decides** (the row under Effort in `/effort`; `--way` for one
window, or for one `coding -p` run): **App**, the default, works as before: word rules sort the request, a focused path runs for a
fix, a change or a rename, the files it is about are read before the model's first word, a question
cannot change files, and the app's checks send work back. **Model** works the way Claude Code does:
the model reads your message and decides. Nothing is sorted and nothing is read ahead; what the app
did becomes tools it may call (`Map` the project map, `CodeSearch` by meaning, `Rename`, `TestFirst`
the fix and change paths, `Remember` a fact for later), it can send several calls in one reply (Read
takes several paths too, for Gemma, which sends one call a reply), your permission mode is the safety
net (plan mode is the lock), the app's checks are **hooks** (`/hooks`). Four start on, because this way
has no focused path under it: next-step, tests, stuck and said-done. The rest are off until you switch
them on. The memory is saved by the model with `Remember`, a line saying what (the app's own saves after
a task and at quit are off then). The replies that repeat, calls cut off at the reply limit and the step
limit are handled on both. The Arena's **Who decides: App vs Model** check (`/test way`) runs the
Practice 28 both ways, with its rule written before the first run: Model holds when it passes as many
tasks and takes at most 25% more time.

**Look first** (the last row of `/effort`, since 30 Sep 2026) is a minimum of looking before the model
answers, so it gathers what it needs instead of answering from the first file: thinking only reasons
over what is already in front of the model, reading is what finds more. When it is on, a task that goes
step by step starts with a note to search for the names it involves and read where they are defined,
used and tested, and an answer that comes before the minimum (with nothing changed yet) is sent back
to look further, with what it has looked at so far: at most 3 times, and never once the minimum has
passed (60 s at most). **auto** (the
default) follows Effort: none on Low, 15 s on Medium, 30 s on High; **off**, or 15 to 60 s whatever the
Effort. Follow-ups, the home folder and helpers never wait; the focused fix and change paths gather
with their own search and are not changed. ▶ Run a test → **Look first check** measures it on the real
model: four questions whose answers need more than one file, each with Look first off and on, at Effort
High; it holds when at least as many are right and it takes at most 60 s more a question.

## License

GPL-3.0, see [LICENSE](LICENSE).
