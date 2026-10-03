# Details behind AGENTS.md

AGENTS.md has the rules, kept short so a small local model reads them quickly. This file has
the background: how each part works and why. Its paragraphs are the old AGENTS.md, moved here
word for word on 30 Sep 2026. Claude Code reads this file at the start (CLAUDE.md imports it);
Agentic Coder reads only AGENTS.md. A new feature's notes go here, not into AGENTS.md.

## The two parts

- **Two parts.** `terminal/` is the agent terminal; `models/` holds the models we use
  and test, the runtime, and the test bench. The terminal imports only
  `models/index.mjs`, and the models part imports only `terminal/index.mjs`: a name the
  other part needs is added to that file, not imported around it
  (`terminal/test/two-parts.test.mjs` fails otherwise). See README.md for the map.

## The docs folder

- **Every page goes in `docs/`** (since 30 Sep 2026; before that in `cli docs/` beside it,
  which is gone). Diagrams, previews, reports, test and result pages, PDFs: anything made
  about Agentic Coder is saved there, as one self-contained HTML file where it is a page, in
  one of its groups: `diagrams/` (how Agentic Coder is built), `reports/` (what got built, by
  day), `tests/` (measured runs and checks), `design rounds/`, `other/`, `older versions/` (a
  page replaced by a newer one moves there; nothing is deleted, and the hub still opens it
  from its old link) and `gemma-docs/`. The report builders write there directly
  (`docsPath` in `docs/tools/to-docs.mjs`, which is the MAIN folder's docs/ even from a
  worktree); a page made by hand is saved there too. `/docs` in Agentic Coder (the hub) lists
  the folder live by these groups; a file left at the top shows as unsorted until it is filed.

- **The repo is public, so git keeps only those groups** (plus `docs/README.md` and
  `docs/tools/`): `.gitignore` is an allow-list, `docs/*` then `!docs/<group>/`. Everything
  else in docs/ stays on the Mac, above all **`docs/private/`**, the owner's own things:
  `memory-about-you/` (Agentic Coder's memory about them; `~/.agentic/memory` is a link to
  it), `design examples/` (the design cards), `morning briefs/`, `gemma-runs/` (logs,
  scripts and markers of Gemma test runs), `claude-code-runs/` and private pages. A page
  that must not be public goes in `docs/private/`, never in a group. A new group means a
  new line in PAGE_GROUPS and in `.gitignore` (models/test/docs-mirror.test.mjs holds the
  two together).

- **Gemma pages go in `docs/gemma-docs/`, not in the other groups** (the user's rule, 28 Sep
  2026; public since 30 Sep 2026). Any report, diagram, flow, test page or other page about
  Gemma (the model, its tests, its thinking, its harness) is saved there; a replaced version
  moves to its `older versions/`. **Tests go in its `test/` folder** (the user's rule, 28 Sep
  evening): a test wizard or runbook, a run's timeline, a test's results page. The logs,
  summaries and scripts a test run leaves go in `docs/private/gemma-runs/<test>/`, not
  beside the pages; raw model results still stay in `models/gemma-4-12b/results/`.

- **The Bonsai-era pages** (24–28 Sep 2026) left the DOCS folder on 28 Sep: they are in
  `~/Desktop/SEP/agentic-coder backups/bonsai-docs/` (on the Mac only, not in git), and in git
  history under `docs/`. The restore points from before the 24–28 Sep changes (git bundles,
  zips, tgz) are in `~/Desktop/SEP/agentic-coder backups/`, also on the Mac only.

- **Before a commit of pages, run `bun run docs`.** It rewrites `docs/README.md` (the index
  GitHub shows) and stops with an error when git tracks a file of docs/ outside the groups,
  or a page holds the home folder's path or name (`ownerMarks`; write it as `~`). Commit
  pages from the main folder, where they are saved, by path. `bun run check` runs the same
  two checks ("Private pages stay private"). Never point `AGENTIC_DOCS` at a folder of
  private files.

## Tests, the Arena and the test record

- **Tests:** `bun run test` runs both parts, the test files side by side (four at once;
  `AGENTIC_TEST_JOBS=6` for more, `=1` for one after the other). A test that drives the app
  must end with the app quitting: with text left in the prompt, quit with `quitTyped`.
  Raw results of model tests stay on the Mac in `models/<model>/results/` (not in git);
  a test's working copy of another project goes outside the repo, not into `results/`.

- **The tests' home is never the real one** (3 Oct 2026, after a test deleted the real settings.json): several
  test files in one `bun test` share one process, and the models part reads its home once. The preload
  (`terminal/test/test-env.mjs`) gives every test process a throwaway `AGENTIC_HOME` before anything loads (its own
  folder is `AGENTIC_TEST_HOME`), and inside a test run (`NODE_ENV=test`, which bun test sets) `models/registry.mjs`
  puts a throwaway in place of the real home whatever the order. A test that deletes in the home checks first that
  the folder is its own (`remote-rules.test.mjs`). `terminal/test/test-home.test.mjs` runs two files in one process
  with a pretend `$HOME` and a planted settings.json, which must still be there after.

- **Every test run goes in the test record**, which the hub shows from its Arena tab
  (`/tests` in Agentic Coder, `coding hub tests`). The Arena (`/arena`, `/test`; it is the Tests tab and
  the Battle tab as one, since 30 Sep 2026) runs a test on one model or battles two with it, and the
  checks in `models/evals/run-tests.mjs`, one at a time, with the settings of its panel kept in the
  record; the owner's own tests are made in the hub's Test builder (a window over the Arena), `models/evals/battle/builder.mjs`,
  and stay on the Mac in `~/.agentic-coder/battle/tests/`, never in git. The record is one file on the Mac,
  `~/.agentic-coder/tests/record.jsonl`, one line per run. `bun run test`, `bun run eval`
  and `bun run eval:words` add their own line when they finish, so run the tests through
  those (a bare `bun test` is not recorded). Any other measured run (a real-bug try, a
  probe, a one-off check) adds its line with `recordTest()` from `models/evals/record.mjs`:
  what was tested, the code it ran on, the result, the seconds, where the raw results are,
  and its results page in the DOCS folder if one was made. `bun run test:record` adds runs
  that are on the Mac but not yet in the record. A saved copy of the record page is written to
  `docs/tests/agentic-coder-test-record.html` (the main folder's), so it goes out with the next commit of pages.

- **A tool a test needs that the Mac lacks is a named skip** (3 Oct 2026, the owner's pick; one Mac had no pytest and
  could not build the picture helper, so about 25 tests always failed there and two new failures went unseen).
  `terminal/test/needs.mjs`: `test.skipIf(needs('pytest'))(…)`, with `python3`, `pytest`, `chrome`, `pictures`
  (`needs('pictures', media.mediaTool)`: the file's own build), `playwright` and `sandbox`. A tool that is here is
  never skipped. Each skipped test prints "(skipped: no pytest)"; `run-suite.mjs` counts them by reason (`skipsIn` in
  record.mjs), ends with "skipped for want of a tool: 16 no picture helper, 9 no pytest", and the record's line keeps
  them (`skipped`); `bun run check` is green only at 0 fail and lists them. A models test reaches it as
  `globalThis.needs` (the preload puts it there: the two parts meet at one file each way). `AGENTIC_TEST_HIDE=pytest`
  hides a tool for a test of the skips. Which tests need what was measured, not guessed: the suite run with python and
  the picture helper taken away.
- **Every test process has a throwaway home** (test-env.mjs, 3 Oct 2026) and removes its own when it ends.
- **The app tests drive the app in its own window** (`AGENTIC_SESSIONS=off` in test-env.mjs), not the way a window
  runs it since 3 Oct 2026 (inside a keeper, sessions.mjs). `terminal/test/app-keeper.test.mjs` drives the everyday
  things through the keeper (a reply, a paste, /clear, the menus before the app and typing after them, a mouse drag),
  each ending with the app quitting and no keeper left; a resize and /update's restart run through it in
  resize.test.mjs and update.test.mjs. A new thing that depends on keys, the mouse or the screen
  gets a line there too.
- **Throwaway copies** (`terminal/src/flows/scratch.mjs`): each notes its maker beside it (`<copy>.owner`), and before
  a new one the copies whose maker is gone are removed (`sweepScratch`; one with no note after an hour); a copy that
  would leave under 10 GB free on the disk is refused with the reason.
- **Two switches a measurement needs** (3 Oct 2026, changing nothing until one is run): `AGENTIC_OWN_START` on · off ·
  auto (`ownStartOn` in client.mjs; auto = the model kinds in `OWN_START_KINDS`) for the own first line of a
  conversation on an Ollama service, and `BIG_WAYS` in models/runtime/remote.mjs (`bigWay`): who decides, by model
  kind, every kind Model until its own measurement says otherwise.

## The memory

- **The memory** (`terminal/src/agent/facts.mjs`, `recall.mjs`, `lessons.mjs`) keeps what Agentic Coder
  learns as small files, on the Mac only: `~/.agentic/memory` about the user (on this Mac a link to
  `docs/private/memory-about-you/`), `<project>/.agentic/memory` about a project. Work on the tests' own
  starter files (`models/evals/battle/<set>/<id>/project/`, `models/evals/bench/tasks/<id>/project/`
  and their answers) is practice: no lesson is saved from it (`practiceWork` in `lessons.mjs`). A test never touches the real one: with `AGENTIC_HOME` set the user's memory
  is kept inside it, and the app tests run with `AGENTIC_MEMORY_SAVE=off` unless they test saving.
  A practice run (`bun run eval`) runs without the memory, so it measures the same thing every
  time; `memory: true` in `runHeadless` turns it on. `bun run eval:recall` is the check that the
  right fact comes back (20 facts, 30 requests, the real small model). `bun run eval:code` is
  the same for the code search: questions about real projects, each with the function that
  answers it, on the real folder with the real small model (`--rerank` compares the reranker,
  `--check` only checks the questions still point at code). This repo's questions are in
  `models/evals/bench/code/`; a private project's stay on the Mac in `~/.agentic-coder/evals/code/`.
  After a task it ASKS before saving (the user's pick, 28 Sep 2026); "update memory" and `/update memory` save at once.
  Since 30 Sep 2026: a test's prompt pasted into the app is practice too (`isTestPrompt`, against `testPrompts()`
  in `models/evals/prompts.mjs`: the Arena's tests and the design runs' `pages.json` / `components.json`);
  trust moves only for the facts a turn really used (`usedFacts` in `recall.mjs`); a save shows the model the 15
  saved facts closest to what happened (`SAVE_SEEN`); when a window closes, the conversation is read again and,
  asking first, what it would save waits in a `.pending` file in `memory-jobs/` for the next start there; a fact
  skipped once is kept in `state.json` (`declined`) and not offered again; `/memory` ends with a 7-day health line.
  With `"memory": false` nothing is saved: the old `notes.md` writer is gone, and a leftover notes file is no longer read as rules (since 30 Sep 2026 only AGENTS.md and CLAUDE.md are, from the working folder up to your home folder).

- **What the memory sends to another machine** (`memoryToRemote`, 3 Oct 2026, the owner's pick: "in full only to
  your own Macs"): the opening read (`terminal/src/agent/opening.mjs`) gives a remote model the facts in full. Facts
  about the user go only to the owner's own other computer: kind `llama` (`coding serve`) at a private address or
  over SSH (`ownMachine` in `models/runtime/remote.mjs`, carried as `model.remote.mine`). Any other service (an
  Ollama one even on the home network, OpenAI-style ones, the Claude API) gets the project's facts in full and none
  about the user, and the screen says "Reading the project's memory · N facts about you stay on this Mac"; the
  prompt's short lines are as before. settings.json `memoryToRemote`: `mine` (the default) · `all` (everything,
  everywhere, as before) · `none` (no memory block); /remote's More has the row (Memory sent). `opening.test.mjs`
  checks each on a pretend service.

## The prompt files

- **TOOLS.md and SKILLS.md** (`terminal/rules/`, since 30 Sep 2026) are read by `terminal/src/agent/prompt-files.mjs`
  at each use: TOOLS.md's `## Tool use` lines are the Tool use part of the prompt, and SKILLS.md's skills
  (`## Name`, `- Words:`, `- About:`, steps) are listed in the prompt as `SKILLS/<name>` and brought with a
  request whose words they use. The hub's Instructions tabs 06–08 save them and a folder's AGENTS.md
  (`terminal/src/app/prompt-files-hub.mjs`). As shipped: the Tool use lines from before plus four (search before reading, only the test
  file that covers a change, done only once a tool shows it, a fitting skill opened from the list;
  30 Sep), and the one skill is an example switched off. A test that reads the prompt sets `AGENTIC_RULES_DIR` to a
  folder of its own, so the shipped files never decide what it sees (`terminal/test/prompt-files.test.mjs`).
  The Arena's Skills check measures a skill on the real model.

- **The remote set** (`terminal/rules/remote/`, 2 Oct 2026, the owner's ask: "make a separate one for remote
  models to follow, since they have more capabilities"): HARNESS.md, its own TOOLS.md and SKILLS.md, and fourteen guides
  the model opens with Read at `RULES/<NAME>.md` (prompt-files.mjs `readGuides`, `readGuidePath`; prompt.mjs
  `remotePrompt`). The owner's picks: every remote model gets it (auto), all twelve files (seventeen since the same day's second round: CONTEXT, PERMISSIONS with a live table, DEBUGGING, RECOVERY, SECURITY; verification, handoff, style and packages merged into TESTING, REVIEW, ANSWERS and HARNESS), the guides as a list the
  model opens (like Claude Code's skills), and the app still decides. The agent picks the set each message
  (`rulesSet()`: settings.json `"instructions"`, saved from the hub's tab 09, and `AGENTIC_INSTRUCTIONS`
  over it; not an /effort row, since that panel is as tall as 80×24 allows); a prompt built for the other set is built
  again once (`promptSetOf`), a helper takes its parent's row and never reloads. The local instructions stay the
  same letter for letter (`terminal/test/remote-rules.test.mjs`). A rebuild of the rules brings the memory only
  when the agent has one (`notesFrom`), so a practice run never reads the owner's. Measured by
  `models/evals/tools/remote-rules-ab.mjs` (the Arena's `remote-rules` and `hard`); the hard tasks (30–39) are
  `bench/run.mjs --set hard` and never run without `--set` or `--only`.

- **Files you add to the remote set** (2 Oct 2026, the owner's ask: "make .md files for agents im running", made
  with a Desktop page of theirs, not the hub). They live in the app's home, not the repo (`ownDir`:
  `~/.agentic-coder/rules/remote`, AGENTIC_HOME's in a test), because the repo is public and its tests must not see
  them. A `NAME.md` there is a guide, listed after the shipped ones by name (`extraGuides`, `readGuides`); letters,
  digits and hyphens only, and a shipped name is ignored. A file in its `agents/` is a **helper agent**
  (`readHelperAgents`, `parseHelperAgent`): its first sentence is what the Agent tool says about it, `- Tools:` (all,
  look, or a list) and `- Model:` (main, or another model on the same Ollama service, run with the client's `use` at
  32k and with a 32k room; the main model by its own name stays the main model), and from its first `##` on, the
  instructions the helper gets after the helper part (`helperPrompt`). The Agent tool names each as a kind of its own
  (`agentToolDef`), and on the remote set one such file is enough to offer the Agent tool on App too (`agentsOn`), so
  the helpers guide is listed with it; "subagents": false still turns it off. The local set has neither. A loose file
  in the repo's `terminal/rules/remote/` is still not read. With none of yours, the instructions and tools are the same
  letter for letter (`terminal/test/agent-files.test.mjs`).

- **Look first** (`terminal/src/agent/look.mjs`, the last /effort row, since 30 Sep 2026): auto follows
  Effort (Low none, Medium 15 s, High 30 s). It is the last row so the rows above keep their places for
  the app tests that move with the arrow keys; the panel keeps 22 lines because the keys' hint sits on
  the Reset all line.

- **The A/B checks** of Look first and the tool lines (`models/evals/tools/look-check.mjs`, `habits-check.mjs`)
  share `ab-kit.mjs`: a throwaway home, the small shop project, `coding -p`. `coding -p` ends the lines of
  what the app read for the model before its first step with " [app]", so a check counts only the model's
  own steps. Each runs end to end on a stand-in with `--url` (`terminal/test/arena-checks.test.mjs`).

## The design studio

- **The design studio** (`terminal/src/agent/studio.mjs`, since 30 Sep 2026; the user's ask: "a design studio
  folder that contains designs and styles and ui components like preline.co") is a folder of ready-made UI pieces
  in the user's look, on the Mac only: `docs/private/design studio/` (`AGENTIC_STUDIO_DIR` names another), with
  `styles/theme.css` (the rules card's colours as Tailwind tokens, light and dark, and no other colours) and
  `components/<kind>/<name>.html`, one piece each, headed by a comment with `# Name`, `- For:` and `- Words:`.
  A page request that gets the design examples gets the pieces that fit it by their Words (the best one, and a
  second only when it fits nearly as well) in the example card's place, as real code; the rules card still comes.
  After every Write or Edit of a page the turn built from pieces (or a page built before), the CSS for its classes
  is built into one `<style id="studio-css">` line before `</head>` with Tailwind's own compiler (the `tailwindcss`
  package, offline, ~15 ms; a new compiler each build, because one keeps every class it was ever given). A stock
  Tailwind colour draws nothing and is named back to the model in the same reply; a Tailwind CDN tag is taken out.
  Read shows the built line folded (`hideBuilt`), and an Edit naming the fold means the real line (`realBuilt`).
  The app built with `bun build --compile` finds the package through `AGENTIC_REPO`, which the launcher sets.
  Switches: settings.json `design.studio`, `AGENTIC_STUDIO` (off in the tests, test-env.mjs), `/design studio on|off`;
  `/design studio` alone lists the pieces (a /design word, not a command of its own: the / menu keeps 18 and
  /settings 18, which is all that fits an 80 × 24 window). The Arena's **Design studio check** (`models/evals/bench/design/studio-check.mjs`,
  no model) opens every piece in headless Chrome and writes a live gallery of them beside the pieces (private) and a
  results page of names and results to `docs/tests/`; the **UI component battle** has a fourth part, Studio on,
  with its own blind vote against the folder-on page.

## The model at start

- **The model is off when a window opens** (since 30 Sep 2026, the user's pick): `/start` loads it and
  `/stop` unloads it and gives its memory back (a reply under way stops first; another window on the same
  copy keeps it). `/autostart on` (settings.json `modelAtStart`, a /settings row), `--start` or
  `AGENTIC_MODEL_AT_START=on` load it as the window opens; `/update` passes `--start` so the new version
  joins the copy it kept. A message sent while it is off waits (the Queued line) and goes after `/start`.
  Quitting or closing the Terminal window unloads it at once (before, a closed window or a joined copy stayed 30
  minutes), unless another window uses it; the memory's save at
  quit still runs on it first. With the model off at quit, that save waits in a `.wait` file in
  `memory-jobs/` for the next `/start` in that folder (`AutoSave.runWaiting`), and a handed-over save whose
  model has gone waits the same way: nothing loads after a window has closed. The app tests set
  `AGENTIC_MODEL_AT_START=on` in `setup()` (app-setup.mjs); `app-model-start.test.mjs` tests it off.
- **Two starts at the same moment** (3 Oct 2026, `models/runtime/server.mjs`): the port is looked at, then the server
  started on it, so two windows (or two tests) starting together both saw 17600 free and one server died while
  loading. `start()` now tries the next free port (three times at most) when its server exited while loading and
  the port is held by another program; that exit is not said as a crash. `coding serve`'s port is the one it was
  given, so there it fails as before. A health answer is trusted only while our own server is still running.
- **The footer's model label** (the user's pick, 30 Sep 2026): "○ model off · ctrl+t start", "◐ Qwen3.5 9B
  loading · ctrl+t stop", "● Qwen3.5 9B · 6.9 GB · ctrl+t stop" (`modelLabels` in screen.jsx; none on --url
  or a remote). ctrl+t switches it, and with `/mouse on` so does a click on it; in the middle of a reply the
  first press only asks. `footerParts` works out the footer once, for the drawing and for where the label is:
  the click lands on the row under the prompt box's bottom edge. So that a click can arrive, `/mouse on` keeps
  the mouse with an empty prompt too (before, only while the box had text); fn held is Terminal's own highlight.

## K2 Horizon, the third model

- **K2 Horizon 7B** (MBZUAI IFM, added 30 Sep 2026; `models/k2-horizon-7b/`, id `k2`) is the third model in
  /model; Qwen stays the default. Its design ("k2-horizon") runs only on IFM's llama.cpp so far, so it has an
  engine of its own (`ENGINES.ifm`) and `engineOnly` keeps it there whatever `AGENTIC_ENGINE` says.
  `coding setup --model k2` downloads it (6.5 GB) and builds that engine (about 2 minutes).
- **Its chat template writes tags of its own:** thinking in `<ifm|think>` (High), `<ifm|think_fast>` (Medium) or
  `<ifm|think_faster>`, tool calls as `<ifm|tool_call>` with `<ifm|arg_key>`/`<ifm|arg_value>`. llama.cpp's
  autoparser reads them from the template (the New model check of 30 Sep: every call a real call, the thinking
  apart at each level). Should a build ever leave them in the text, `terminal/src/agent/think-tags.mjs` sorts the
  thinking from the answer (`thinkTags` in its model.mjs) and `toolCallInText` reads the call. `templateKwargs`
  sends its `tool_call_format` with every request; its template errors on any effort but high, medium, low.
- **It cannot look at pictures.** A picture sent while it is the model asks whether a model here that can (its
  file and its add-on on this Mac) takes that one message: it loads in K2's place with its add-on, answers, and
  K2 comes back after the reply (`switchBackRef` in App.jsx; your own /model pick cancels the return). Esc puts
  the message back in the prompt, unsent.
- **The New model check** (`models/evals/tools/model-check.mjs`, the Arena's `modelcheck`) runs any model in
  /model through the app's real client: it loads (and the memory it takes), the template takes the app's request
  at every level, a plain answer, a tool call off and at each level, the thinking cap really ending the thinking
  (with the app's tools a model often acts after the cap, a Bash call, which counts), its other tool-call format,
  and the speeds. Run it on any model added to /model before trusting it with real work.

## The five modes and the Screen tool (2 Oct 2026)

- **Five modes, with Claude Code's names** (`MODES` in `terminal/src/agent/permissions.mjs`): Auto,
  Manual (was "Ask first", id `ask`), Accept edits (was "Auto-edit", id `edits`), Plan, Bypass permissions.
  shift+tab cycles Manual → Accept edits → Plan → Auto (`CYCLE`); Bypass is only ever chosen on purpose
  (`/mode 5`, `/mode bypass`, `--mode bypass`). The old words still work (`modeOf`).
- **Auto:** a step a rule covers runs or asks as before. A Bash command or a web read no rule covers gets
  the decision `'check'`: one side-slot call to the same model (`agent/auto-check.mjs`, answer `run` or
  `ask` with a reason, 20 s limit with its own timer, since `AbortSignal.timeout` never fires under bun test).
  The rail says "Auto let it run" or "Auto asks you" with that reason. Commits and protected files still ask.
- **Bypass:** never asks, but the hard stops stay (rm -rf, sudo, git push, kill, the never-list) and so does
  the sandbox (inside the project, no internet). `OWN` (Agentic Coder's own settings) is refused there too.
- **Screen** (`terminal/src/tools/screen.mjs` + `media-tool.swift`, macOS `screencapture`): a picture of one
  app's front window or the whole screen. It only looks; nothing is clicked or typed. The first look at an
  app asks (this time, this session, always for this folder, no). macOS must let the terminal record the
  screen first: `/screen setup` (typed only; the / menu is full at 80×24). The picture goes to whichever
  model runs, local or remote. `AGENTIC_SCREEN_FAKE=<folder>` stands in for the screen in tests.
- **The Arena's `autoscreen` check** (`models/evals/tools/auto-screen-check.mjs`): 16 Auto steps (8 risky
  must ask, 8 fitting should run) and 3 screen questions through `coding -p`. Qwen3.5 9B passed 18 of 19 on
  2 Oct 2026 (a `git mv` rename still asks: cautious, not unsafe).

## /agents

- **What a run may do** (`terminal/src/agent/agents-run.mjs`, the fix plan of 3 Oct 2026): Ship offers "Fix it" for a
  critical finding twice (`SHIP_FIXES`), then only "Stop here", so no screen (which always answers Fix it) ends NO-GO;
  resume in Build keeps the task list (done stays done, a task caught half-way goes back to its saved test, `t.test`);
  before the first write, a SPEC.md, CONSTRAINTS.md or tasks/*.md that no /agents run wrote here (the run file's
  `wrote`: a hash of each file a run wrote, carried from run to run) asks Keep mine (`place`: every file of the run in
  `.agentic/agents/<run id>/`) · Replace (yours copied to `.agentic/agents/kept/<run id>/` first) · Stop, and with no
  screen keeps yours. RED is real: no test file after a second ask leaves the task open ("no test written"); a test
  that passes before any code is asked once to fail, then the task is "already true" and skips GREEN; a suite command
  that cannot run one file is never a task's own test. "Allow it this once" is once; in Verify, Review and Ship a
  command that is not plain reading (`isReadOnly`) asks first; in Plan mode /agents says so and does not start.

## Loops (/loop, 3 Oct 2026)

- **What a loop is** (`terminal/src/app/loops.mjs`, the owner's ask: "add a /loop command. can we make a terminal
  window appear, so we can manage loops for agents?"). `/loop [debug|test|web] [10m] [message]` (`parseLoop`) makes a
  message the app sends again by itself. The owner's picks, asked in two rounds: a loop **stops with its window**
  (the `Loops` object lives in App.jsx and is closed at quit); each run is a **fresh conversation** told how the last
  one ended (`loopNote`); a run that would ask is **paused, "needs you"**, and the others go on; runs work **right in
  the folder**; they **wait while the model is off** or the window is answering (`status()`: nothing loads for a
  loop); a loop **ends** when a run says `LOOP DONE`, when a debugging loop's tests pass, or after 24 hours ($5 on a
  paid service); one run at a time on this Mac's model, three on a service. The shortest gap is a minute
  (`AGENTIC_LOOP_MIN_SECS` for the tests).
- **A run is a process**: `coding -p --loop-events` (`startRun`), with the message in `AGENTIC_LOOP_SPEC`. It writes
  one JSON line per step to stdout and reads answers and notes from stdin (`terminal/src/app/loop-run.mjs`; the
  protocol is at the top of that file). `runHeadless` took three options for it: `mode` (the window's mode),
  `askUser` (every question goes to the window) and `more` (a note typed meanwhile is the next message of the same
  conversation). "Always" on the board is remembered per loop as a signature (`signatureOf`: this exact command,
  every edit, this site) and handed to its later runs. Its memory is read, never saved to.
- **A half-fix is kept** (the owner's pick): in a loop's run only (`keepProgress`), `putBackWhy` leaves the changes
  when the last check failed but fewer tests fail than before the message and none fails newly (`madeProgress` in
  agent.mjs, read with `readResults`; unknown counts, or more than ten failing names, count as no progress).
  Everywhere else a message that ends on a failing check still has its changes put back.
- **The board** (`coding loops`, `/loops`; `loops-board.mjs`, drawn by `loops-draw.mjs`) is a program of its own in
  a Terminal window of its own (`openBoardWindow`, like the door's window). It reads `<home>/loops/<pid>/state.json`
  and each run's `run-<loop>-<n>.jsonl` five times a second and sends its keys back as files in `cmd/`, which the
  window reads at its next tick (half a second): closing the board changes nothing. The look is the Tree, the owner's
  pick after two design rounds (docs/design rounds/agentic-coder-loop-board-3-designs-2026-10-03.html and -v2): this
  window, a box per loop with the four steps of a run (`cycleOf` reads them off the run's lines), a log, one line
  for a question, the chat box, a status line. In the chat box every key is text; `+` types `/loop ` for you (never
  `n`, which is only "no").
- **Tests**: `terminal/test/loops.test.mjs` (no model: what /loop reads, when a loop runs, the files, the Tree at
  six sizes, the keys) and `app-loops.test.mjs` (a stand-in model: one run that asks and takes a note, the half-fix
  kept and put back, the app with its board in a second pseudo-terminal). `/loop` and `/loops` are in the / menu
  where the window has room (`WHEN_ROOM`, after /jumptomac).

## MCP servers (3 Oct 2026)

- **What it is.** `/mcp` gives the model tools from outside the app (the Model Context Protocol): a program on this
  Mac, or a service at an address. The owner's picks: a full MCP host (tools first, then sign-in, resources, prompts and
  a server's own questions), the official client (`@modelcontextprotocol/client`, 13 packages, both protocol eras:
  2026-07-28 and 2025-11-25), "balanced" safety, and big models on a service, the Claude API and the other Mac as the
  remote setups that must work. The plan and the preview the build followed: `docs/design rounds/mcp-preview-2026-10-03.html`.
- **The files.** `terminal/src/tools/mcp.mjs` is the hub: one connection a server for the session (the conversation and
  its helpers share it), started in the background, stopped at quit; a program server runs in the project folder with
  a clean environment behind `sandboxProfile` (`net` and `local` open the internet and named local ports for that one
  server); its era is remembered a week so its start is not probed twice (the probe starts the program once more).
  `terminal/src/agent/mcp.mjs` has no connection in it: names (`mcp__server__tool`, cleaned, at most 64), the
  fingerprint (description + arguments, hashed), the catalog with the owner's marks, `mcpPlan` (how the tools are
  shown), argument checks, results. `terminal/src/app/mcp-store.mjs` keeps `~/.agentic-coder/mcp.json`, a project's
  `.agentic/mcp.json` (never started before a yes to that very file: its fingerprint), and `mcp-state.json` (the
  yes, the marks on a project's tools, the fingerprint each "always allow" was given for, the eras). A key is never
  in a file: Keychain entry `mcp-<server>` (`AGENTIC_REMOTE_KEY` does not stand in for it). `mcp-form.mjs` is the
  picker; `mcp-start.mjs` opens the hub for the app and `coding -p` (`AGENTIC_MCP=off`: none).
- **How the tools are shown** (`mcpPlan`): a model that is not Claude gets them by name while they fit 8% of its
  context (`BUDGET_SHARE`), whole servers, the smallest first; a server past that is listed by name and one line a
  tool inside the `Mcp` tool, which gives a tool's arguments (a call with only `tool`) and runs it (with `arguments`).
  A call by a listed tool's own name runs too (an Ollama service passes it through; `runMcp`), and arguments sent
  wrapped as Mcp takes them are unwrapped (`unwrapArgs`). The instructions list the servers on (`mcpBrief`): a small
  server's tools by name, a big one pointed to the Mcp tool's list (naming only its first tools sent Qwen3.6 to the
  wrong one); without that list, Qwen3.6 searched the project for "ticket 142" while holding the ticket tool. A request
  that names a server, or what one of its tools is about, carries a line naming the tools to call (`requestNote`); an
  answer to it with no MCP tool tried is sent back once, then marked as not from the server. The names a model makes up
  are read as the tool they mean: `shop__get_ticket`, `Shop_get_note`, a wrapper like `call_mcp` with the server and the
  tool inside (`madeUpCall`), arguments beside "tool" in an Mcp call (`gateCall`), the call written out as JSON text
  or as `mcp__warehouse__stock_level(item="mug")` (`mcpCallInText`), and a one-argument tool's argument under another
  name. A Bash command naming one of the tools does not run (it waited on a yes in the window) and is told it is a tool. Qwen3.6 35B on a service, 3 Oct 2026: 10 of 12 questions
  answered from the right tool with these, 3 or 4 of 8 without. On the Claude API: by name up to 10,000 tokens
  (`CLAUDE_BY_NAME`), past it every MCP tool carries `defer_loading` and `tool_search_tool_bm25_20251119` is added
  (`claude.mjs`). A schema is cut down for servers that are not Claude's (`simplifySchema`: llama.cpp turns a schema
  into a grammar and refuses what it does not know).
- **The list is kept for a conversation** (`agent.mjs mcpTake`): taken before the first message (it waits up to 8 s
  for servers still starting; before a warm-up only when all have settled), then the same letter for letter until
  `/clear`. A server's own change (list_changed) is a note; a late server joins the next conversation. What the owner
  changes in `/mcp` sets `mcpStale`: taken at the next message, with a line. Why: on a service the tools sit at the
  top of the prompt, and any change there is a whole re-read (15.7 s for 15.6k tokens, 3 Oct 2026).
- **Permissions** (`permissions.mjs judge`, `agent.mjs runMcp`): a tool asks before its first use in every mode but
  Bypass; rules are `Mcp(server:tool)` (a colon: a tool's name may hold dots), `Mcp(server:*)` on the never-list only.
  "reads" is the owner's mark, bound to the tool's fingerprint; the server's own annotations are shown (`says`) and
  never decide anything. A tool that is no longer the one allowed, marked, or listed when the conversation began
  counts as changed and asks again. Plan mode refuses an unmarked tool; a question and a skill's read fence ask even
  for an allowed one; `/agents`' stop list (`agents-guards.mjs`) asks while it builds and turns it away in Verify,
  Review and Ship; an explore helper gets only marked tools; `.agentic/mcp.json` is in `PROTECTED` and `OWN`.
- **Instructions.** Both TOOLS.md files have an `## MCP tools` section that joins the Tool use lines only while a
  tool is offered, and the remote set has a guide, `MCP.md`, listed the same way (`MCP_GUIDE`, as `SUBAGENTS` is for
  the Agent tool). With no server, the instructions are the same letter for letter.
- **The Level 1 extras** (the second part of the build). Sign-in (`terminal/src/app/mcp-auth.mjs`): the official
  client's `auth()` with a page on this Mac taking the browser back (`127.0.0.1:17690–17699/callback`, its state
  checked); registration and tokens are kept as one Keychain secret, `mcp-<server>-signin` (`saveSecret`, base64url:
  longer than a key may be); a hub starting a server never opens a browser (the server is "sign in: s").
  `AGENTIC_SIGNIN_FOLLOW=1` (tests) follows the sign-in page's answer itself. Resources: `@server:uri` is read when
  the message is sent (`resourceMentions`, `resourceParts`), not asked about (you named it). Prompts: `/server:prompt
  args` (`promptCommand`, `promptText`). A server's own question (elicitation; on 2026-07-28 it rides in the result
  and the client asks again) goes to the ask box as the server's (`agent.mjs mcpAsked`); with nobody there it is
  declined. Anthropic's connector: on the Claude API a server whose "On Claude" is the connector is left out of the
  app's tools and sent as `mcp_servers` + an `mcp_toolset` (beta `mcp-client-2025-11-20`), with its token read at
  each request; its `mcp_tool_use`/`mcp_tool_result` blocks show as finished steps and the reply goes back whole.
- **Tests.** `terminal/test/fake-mcp.mjs` is the stand-in server (a program or an address, either era; it can crash,
  hang, change its tools, ask a question, return a picture). `mcp.test.mjs` (the pure parts, the files, the hub),
  `mcp-agent.test.mjs` (whole conversations on a scripted model, and the Claude path on the stand-in Claude API: the
  owner's pick is no real Claude runs), `app-mcp.test.mjs` (the real window). The Arena's **MCP check**
  (`models/evals/tools/mcp-check.mjs`, `/test mcp`, `/test mcp-remote`): nine checks with the real model on two
  stand-in servers, judged by the servers' own log.

## The public repo

- **The GitHub repo** (BuzzScud/Local-Agent-1) is PUBLIC since 28 Sep 2026 (the user's choice): anyone can read it. Nothing secret is committed:
  scan staged files before a push. `bun run check` does that scan and more (the history,
  the packages, where the code connects, the installed app, the unit tests); `--fast`
  leaves out the model files and the tests. A place the code names for the first time
  (`KNOWN_HOSTS` in `models/evals/tools/check.mjs`) is added there on purpose, never in passing.
- **What `bun run check` says about the repo itself** (3 Oct 2026): "Who can read it" is fine while `PUBLIC_SINCE` in
  check.mjs says the repo is public on purpose (private again, the line says so; set to null, a public repo is wrong, as
  before). "No server addresses" (`publicAddresses`): a public internet address in a tracked file is wrong, and one in a
  commit message is a line to look at, since only a rewrite of the history takes it out; this Mac, the home network,
  Tailscale and the documentation ranges are not addresses a stranger can use, versions and a page's drawing numbers
  are not addresses at all, and a test's made-up one is added to `KNOWN_ADDRESSES` on purpose. "Packages" compares a
  package the repo holds itself (the react-devtools-core stand-in, which bun installs as a copy) with the repo's own
  folder (`localCopyDiff`), not with npm.

## The contract: Scope, Done and failures (1 Oct 2026)

- **Where these came from.** The owner brought a longer AGENTS.md on 1 Oct 2026 with four
  additions: Scope, a glossary, "When something fails" and a Done list. AGENTS.md took Scope,
  Done and one hard rule (the Arena's scoring changes only when the task is the Arena); the rest
  is kept here, because AGENTS.md stays under 4,000 characters (`terminal/test/agents-md.test.mjs`).
  The draft repeated the `index.mjs` seam rule three times; AGENTS.md says it once.

- **Why the full suite is for Claude Code and Codex only.** `bun run test` takes about 3 minutes.
  Agentic Coder stops a command after 2 minutes (/effort's Command timeout, 120 s by default), and
  its own Tool use line (`terminal/rules/TOOLS.md`) says to run only the test file that covers a
  change, not the whole suite. A small model given both rules would have to guess, so for Agentic
  Coder the covering test file is the check, and the recorded full run is the larger agents' job.

- **When something fails** (the draft's steps):
  - The seam test fails: the import skipped `index.mjs`. Export the name there, then rerun
    `bun run test ./terminal/test/two-parts.test.mjs`. Do not weaken the test.
  - `bun run docs` stops: a private path is tracked, or a page holds the home folder's path or
    name. Untrack it, write `~`, and rerun. Do not commit `docs/private/`.
  - A test read or wrote the real memory: stop; the run is invalid. Point `AGENTIC_HOME` at a
    temporary folder, set `AGENTIC_MEMORY_SAVE=off` unless the test is about saving, and rerun.
  - A driven app is still open: finish with quit (`quitTyped` when the prompt still has text).
    A hung app is a failed test, not a passing one.
  - `bun run check` fails: it blocks the push. Fix the finding or do not push. `--fast` is not a
    waiver for a secrets failure.

- **The names AGENTS.md uses.** The test record is `~/.agentic-coder/tests/record.jsonl` (what
  ran, and whether it counted). The Arena is the eval comparison described above. The memory is
  the owner's store under `AGENTIC_HOME`, never the real one in a test.
