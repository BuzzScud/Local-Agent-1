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

- **Tests:** `bun run test` runs both parts, the test files side by side (six at once, fewer on a Mac with
  fewer cores; `AGENTIC_TEST_JOBS=8` for more, `=1` for one after the other). A test that drives the app
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

- **The pack of Claude's notes and the code maps** (3 Oct 2026, the owner's picks: both, one shape, every model sized
  by its context). One shape for both, a ladder (`terminal/src/agent/ladder.mjs`): `MAP.md` (a line per part) → a part
  file under 2,000 tokens (a line per folder, file or note) → the file or note → for a long note its history. The
  **pack** (`claude-pack.mjs`, `bun run pack [--from <copy>]`) is `~/.agentic-coder/claude-pack/`: every Claude Code
  memory folder on this Mac and the copies named once with `--from` (kept in its `pack.json`), this Mac's note over
  the copy's; a project's note is `<project>--<note>` and says its project; sign-ins, servers and secrets are left out
  as before (`leftOut`, `holdsSecret`); a note over 7,000 characters keeps how it stands now (its opening, Why and How
  to apply, its newest dated parts) with the whole note in `history/`; topics come from each MEMORY.md's headings.
  `notesDir()` reads its `notes/` when there is one; nothing rebuilds it by itself (`/memory` says when notes changed
  since). The **code map** (`tools/codemap.mjs`, `bun run codemap [<folder>]`) is a project's `docs/map/`: a line per
  folder and per main file, written by a model on a service from a card per folder (cached per file's content under
  `~/.agentic-coder/maps/labels-*.json`), else from the code; `checkMap` (and `maps-and-pack.test.mjs` for this repo's
  own) fails on a missing path, a part over 2,000 tokens, a home path or an address. **What a model gets**
  (`opening.mjs mapsRead`, `mapRoom`): the code map's lines and the notes map, 3,000 characters each at 32k, with the
  code map's part nearest the request from 128k up; on the remote set in the opening read, on the local set as a step
  of its own ("Reading the maps", `giveMaps`). `Map {"part"}` opens a part, `Read NOTES/…` the pack (read-only).
  **Memory sent holds for Claude's notes too**: a service that is not the owner's own machine gets only the notes about
  the project it works in (`sentAllows`, `packView`); before 3 Oct every matched note went. Measured by the Maps and
  notes check (`models/evals/tools/ladder-check.mjs`, the Arena's `ladder`; its set and page are private).

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

- **Look before answering and Files that exist** (3 Oct 2026, the owner's picks after models on a service answered
  "where is…?" in one step and named files that are not there): two hooks (`look-first`, `real-files` in way.mjs, on
  by default) that hold a model on another machine only, in a project folder. An answer about the code (`aboutTheCode`:
  a question naming something of it, or a request for work) with no read, search, list, map, helper or read-only
  command of its own, and no file the app read for it, goes back once with the words to search for; a request that
  made a file needs no look. An answer naming files not in the project (`missingFiles`: not at that path, no file of
  that name; files the request names or the message made do not count) goes back once. The second time each is let
  through with a line under it. The remote HARNESS.md says the same in one line. `terminal/test/look-first.test.mjs`.

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

- **A model on /remote thinks by default** (3 Oct 2026, the owner's pick: "always leave on thinking as the default, and
  turn it off when a model has no thinking"): `remoteModel` sets `thinkingDefault` on, and off for a model the service
  says cannot think; gpt-oss starts on Medium, its maker's default. The shared Effort is this Mac's models'; a remote
  model starts on its own (kept when you pick one there: `saveOwnLevel`), else its default (`ownLevel` in App.jsx,
  the same in `coding -p`); `--think`/`--no-think` win. Look first's auto follows it, as designed (the owner kept that:
  remote models now look for 30 s before answering), except for a request that names an MCP server.

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
- **Self** (`isSelf`: Bypass on the Claude API, the owner's pick 8 Oct 2026): Agentic Coder works on
  itself. `OWN` opens (a copy kept first, `agent/self.mjs` keepOwnCopy); only `SELF_LOCKED` (door.key,
  trust.json) stays shut; the `BLOCKED` entries marked `self` (the push, kill) run; the sandbox closes only
  those two files. The App tool (`tools.mjs` appTool, `app/app-self.mjs` appBridge) runs a slash command, a
  setting, a restart on new code; `agent-work.mjs` restarts by itself after a turn that changed app code
  (`isAppCode`) with passing tests. A helper never gets it. `SELF_OPEN` is the note sent with the request.
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
  (the `Loops` object lives in App.jsx and is closed at quit); each run is a **fresh conversation** told what the
  earlier runs did, a line each, the last eight (`loopNote`; before 4 Oct 2026 only the last one); a run that would
  ask is **paused, "needs you"**, and the others go on; runs work **right in the folder**; they **wait while the model is off** or the window is answering (`status()`: nothing loads for a
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
- **A fixing loop that is not getting closer waits for you** (4 Oct 2026, the owner's pick): a test run's step says how
  many fail (`tests.count`), each run keeps it (`failing`), and when a `debug` loop's last two runs end with as many
  failing or more (`stuckWhy`), it pauses as "needs you · stuck" instead of a new try 15 s later. A note typed to it
  sends it on at once with the note; ^R and ^P send it on as it is. Test, web and other loops are meant to repeat and
  never stop this way.
- **Its plan stays in sight** (4 Oct 2026, every message, not only loops): five steps after the model last saw its
  TodoWrite list, a line with the step under way and the next ones goes on the end of that step's result
  (`planDue`, `planReminder`; on the end so the conversation before it is not read again), and when memory fills the
  whole list goes into its notes (`restartFrom`). Only a plan written in the same message counts.
- **The board** (`/loops`, and `coding loops` from another terminal; `loops-board.mjs`, drawn by `loops-draw.mjs`).
  Since 4 Oct 2026 (round three: "/loop test5m" had made a loop whose whole task was that word, and the letters the
  owner typed were read as keys and stopped it; their picks from docs/design rounds/
  agentic-coder-loops-4-designs-2026-10-04.html) it is **the coding window's own screen**, as /agents' tree is
  (App.jsx `openLoops`, `loopsKey`; loops-view.jsx), grown to 120 × 36 where the terminal follows that; esc goes back
  to the chat, where a line above the prompt shows each open loop (`loopsLine`). Its keys go straight to the loops
  (`Loops.apply`); `coding loops` still reads `<home>/loops/<pid>/state.json` and each run's `run-<loop>-<n>.jsonl`
  and sends its keys back as files in `cmd/` (`readCommands`, then `apply`), so closing it changes nothing. The look
  is the **Cards**: a card per loop with Now (the step its run is on, read off its lines: `nowWords`), Last, Next and
  You (your last note and what became of it, `lastNote`/`youWords`: sent, read after a step (`heard`), read at the
  start of a run, read as it gave its answer), then what happened, newest first, a line for what waits for you, the
  box and the keys. **Typing always goes in the box; the commands are ctrl keys** (^N new, ^R run now, ^P pause, ^S
  stop, ^O rules, ^X start over, ^B undo, ^G whole run, ↑↓ pick). A question is answered in the box (y, a or n; a
  number for one of its choices; other words to a question that wants a yes go to it as a note), and so is Ask
  first's go (y or n). A stop asks, and only y stops it: enter does nothing there. A note typed to a loop that ended
  starts it again with the note. **A new loop a step at a time** (`openSetup`, `setupKey`, `drawSetup`): what each
  run does → how often → when it stops → a read-back, then enter; it opens for /loops or /loop with no loop yet and
  for ^N, and ^O there is the form with every rule. **An unclear task is asked about first** (`unclearOf`, rules
  only, no model: a kind and a time typed together like "test5m", or a single word), from the chat and the box.
- **More control** (4 Oct 2026, the owner's ask: "i want to be able to control it more"; their picks: everything, a
  preview first). Each loop has rules of its own (`rulesOf`, `fieldsOf`): its mode, how many runs (`maxRuns`), a stop
  time (`stopAt`: 18:30, 6pm, 2h), a spending cap (`usdCap`; each run's end says its cost, `usd`, and the window's $5
  now counts its loops' runs too, which before it did not), steps a run (`steps`, over /effort's; `--loop-events`
  reads it from `AGENTIC_LOOP_SPEC`) and Ask first (`askFirst`: a due run waits as `ready` for y / `/loop <n> go`; n
  leaves one out, or pauses a loop with no time of its own). `limitWhy` ends a loop at its limits; a run stopped to
  start over does not count. The board's **form** (^O, from the cards or the setup; an ended loop starts again from it, its counts
  from nothing) is `openForm`/`formKey` in loops-board.mjs, drawn by `drawForm`; `/loop <n> every 7m · runs 5 · stop
  18:30 · cap $1 · mode auto · steps 20 · ask on · go · skip · undo · redo · note · message · again` does the same
  from the window or the board's box (`loopCommand`; `isLoopCommand` tells "/loop 2 every 7m" from "/loop 10 minutes …").
  **A note reaches the run at its next step**: `steering()` in loop-run.mjs hands it to the agent, which puts it on
  the end of that step's result (agent.mjs, beside the plan reminder) and emits `steered`; the run says `heard` with
  the step. On a focused path (a fix, a change) it goes with the next try's prompt and every try after it
  (flows/tries.mjs, `ctx.steering`, `ctx.notes`), and with the first step if the path hands over (`carriedNotes`):
  the first real Qwen run of the check showed a fixing loop's note arriving only after its answer, because the fix
  went down the focused path. A note that comes as the answer is given is still the next message (`more`). **Undo**: each run keeps
  copies in its own rewind session (`sessionOf`: `loop-<pid>-<id>`, rewind.mjs), and its end says from which point to
  which (`point`, `until`) and the files it changed; `Loops.undo` restores that run only (`plan(n, { until })`), a
  file changed since is left alone and named, never under a run that is working. **Start over** (^X, pressed again
  keeps the changes): the run is stopped and given 10 s (`kill({ wait })`) to keep its copy, its changes go back
  (`redoWait`/`lateEnd`/`redoNext`), and a run starts with your note. A question's choices are numbered: a number typed picks one.
  The preview the build followed ran on this code with a recorded Qwen run (docs/private/loops-preview/proto3).
- **Tests**: `terminal/test/loops.test.mjs` (no model: what /loop reads, when a loop runs, the files, the Cards at
  six sizes, the keys, the setup, an unclear task, a note to a loop that ended; the rules, limits, Ask first, edit, start over on a pretend store, undo on the real one, the
  form) and `app-loops.test.mjs` (a stand-in model: one run that asks and takes a note at its next step, a note as it
  answers, a run's copy put back, its own steps, the half-fix kept and put back, the app with /loops in its own window and `coding loops` in a
  second pseudo-terminal). The Arena's **Loop controls check** (`models/evals/tools/loop-check.mjs`, `/test loops`) does the
  note, the copy, undo, start over and the steps with the real model. `/loop` and `/loops` are in the / menu
  where the window has room (`WHEN_ROOM`, after /jumptomac).

## Staying on task on a model on another machine (4 Oct 2026)

- **What and why.** The owner asked how to keep a model on task in long runs on /remote, where a model holds up to
  256k and the memory was cleaned up only at 78% of it (about 200k), so the request could sit far behind the newest
  step. No saved conversation on this Mac had come near that, so nothing here is measured yet. Their picks: all three
  parts, a nudge that lets the run go on, the other Mac too, and no before/after test: the cleanup and the check are
  built off, for them to switch on and try.
- **Your request comes back** (`requestDue`, `requestReminder` in agent.mjs; on, as the plan reminder is): on a model
  with 64k of memory or more, every 10 steps since it was last in sight, one line with the request goes on the end of
  that step's result (on the end, so nothing before it is read again), and the screen says "Reminded it of your
  request". A restart from notes puts the request at the top again, and the count starts over.
- **Clean up at** (/remote's More, one choice for every service like Memory sent; settings.json `remoteCleanAt`: 0 ·
  32768 · 65536 · 131072; `agent.workRoom`, `cleanCap`): on a model on another machine, fitContext's trim, notes and
  summary lines are worked out against that size instead of the whole memory. The model keeps its whole memory, so
  one big file still fits. 0 (the default, "when nearly full") is the old behaviour; a model on this Mac ignores it.
  The window sets it on the agent and again when the form saves; `coding -p` (and so every loop run) passes it.
- **Stays on task** (`terminal/src/agent/drift.mjs`, the /hooks check `drift`, in `OPT_IN_HOOKS`: off until switched
  on, on App too): every 10 steps one short call (20 s at most, else skipped with a line) is asked "on" or "off" with
  the request, the plan, the last 10 steps in words (`recentSteps`: "changing README.md", "running npm test") and the
  model's last words, never a tool's output, so a file's text cannot steer it. Off: the model gets "(A check of your
  last steps: … Go back to what the user asked; finish that first.)" on the end of that step's result, the screen a
  warn line, and the run goes on; twice a message at most (`DRIFT_NUDGES`), then no more checks. Who checks
  (`driftWho`): on an Ollama service its Side jobs helper (/subagents), else the main model; on the other Mac
  (`coding serve`, kind llama) the main model on the server's second lane (`slots.side`, as Auto's check), and with a
  single lane nobody (one line says `coding serve --slots 2`); the Claude API, other services and this Mac: none.
  `coding -p` has no /subagents jobs, so on an Ollama service its runs check with the main model.
- **Tests**: `terminal/test/stay-on-task.test.mjs` (the reminder on 256k and not on 32k, the cleanup point on a
  remote and not here, the form row, the switch on both ways and in /hooks, what the check sees, two nudges on the
  second lane then none, on track, one lane, the Ollama helper then the main model on the Ollama stand-in).

## Follow-through: doing what it was asked (4 Oct 2026)

- **Why.** The owner watched a run on their other Mac (Qwen3.6 35B-A3B on their Ollama service, from the home folder,
  in Bypass): asked to take the formulas from a calculator's page and test them against a folder of exports, it met a
  login and tested something else without asking, typed a file's name wrong, read only the outline of the report page
  and said it had found the math, wrote no plan, and answered "All 24 formulas passed" after a run that printed "22
  passed, 2 failed". The remote rules already said "never claim a result you did not see", but as a guide it never
  opened. Their picks (all recommended): everything, stop and ask at a wall, ask "Work in that folder?", the second
  look on after real work, and a replay of the run before and after.
- **Outlines for pages and data** (`tools/outline.mjs` `docParts`, `jsonShape`; Read only, the maps' `outline()` is
  unchanged): a long page gives its headings, its sections and tabs with an id (a section and the heading under it are
  one part), styles and scripts; Markdown its headings; a CSV or TSV its header row and the first row; JSON a line
  saying what it holds (a list's length and its items' keys, where the first item starts). Before, any of these came
  back as "too long, and it has no functions to list", which the rail showed as "-1 parts". Read counts the parts it
  lists (`view.parts`, 0 for none; the rail says "no parts"), and `view.matched` says lines of the file came with it.
- **The closest name in its folder** (`tools/fs.mjs` `nearNames`, `nearPath`; `agent/tools.mjs` `settlePath`): a path
  that is not there is set right one missing part at a time from what is really in that folder, when one name is
  clearly closest (a third of the letters at most, the same words, or the name with its date left off). Read, Search,
  List and Edit use it, then didYouMean's walk (off from the home folder, as before, unless the request named a folder:
  `env.workFolder`). Never a walk, so it is safe from the home folder.
- **Stop when blocked** (hook `blocked`): `wallOf` in agent/tools.mjs: a fetch answered 401, 403 or 407, a short answer
  that says it needs a login (even with a 200), a move to a login page, or a 404/410/5xx at an address the request
  gave; and a Read or List of a path the request named that is not there. The result ends with "Do not do a different
  task instead. Tell the user what blocked you and ask how to go on, with Ask"; the agent keeps it (`turn.walls`, a
  warn line on screen), reminds it once if two steps later it has not asked (`followDue`), and sends back once an answer
  that neither asked nor names the wall (`MENTIONS_WALL`).
- **Answer matches results** (hook `results`): every Bash run whose output counts passed and failed (`readResults`
  now also reads a script's own "22 passed, 2 failed" and "22/24 passed") or that is a test run is kept
  (`turn.checks`); an answer that says all passed or it works (`claimsAllGood`) after a failing last run goes back
  once with that run's own line, then a warn line under it. Before, only a run after an Edit or Write counted, and the
  run's scripts were written by heredocs.
- **Read before claiming** (hook `read-first`): files seen only as an outline with none of their lines
  (`turn.outlined`); a reply that says it found or has what it needs (`claimsFound`) gets a line on its next step's
  result, or a final answer goes back once.
- **Plan for several asks** (hook `to-do`): a request with two questions or more, or a list (`severalAsks`), and no
  TodoWrite by the third step: one line asks for the plan, which then comes back every 5 steps (`planDue`).
- **The folder a request names** (`projects.mjs` `foldersNamed`): from the home folder, a path in quotes (spaces and
  all) or after ~/ or /, code project or not, is offered as "Work in …?" (staying is the first choice), and either way
  becomes `turn.workFolder`: Look before answering and Files that exist hold there too (`missingFiles` also checks full
  paths into it, `fullPathsIn`), and didYouMean walks from it. The agent's own `home` decides what the home folder is.
- **Second look** (hook `second-look`, `agent/second-look.mjs`; on, the owner's pick): after a message that ran
  commands, wrote files or fetched pages, one call checks the final answer against what the app recorded: the request,
  the plan, the model's own calls cut short (a command's first 400 characters, so a script's numbers show), the check
  runs with their counts and exit codes, errors in the app's own words, walls, files only outlined. Never a page's or a
  command's output. Wrong: up to three problems, sent back once ("it can be wrong"); a warn line says them. Who: as for
  Stays on task (`lookWho`), and on this Mac the server's second lane. `AGENTIC_SECOND_LOOK=off` (test-env.mjs) keeps
  it out of the tests that count a stand-in's replies.
- **Two rules in both instruction sets** (prompt.mjs WORK_HABITS, rules/remote/HARNESS.md): say you found, read,
  checked or worked out something only when a tool showed it (an outline is not the text; an expected value is worked
  out with a command), and a blocked request stops for an Ask.
- **The replay** (`models/evals/tools/follow-through-replay.mjs`, the Arena's `follow-through`): the run of 4 Oct
  played again, `coding -p --loop-events` in a throwaway home with a copy of the folder, questions answered as the
  owner would, scored from the whole conversation (`AGENTIC_TRANSCRIPT=<file>` makes `coding -p` write it) on six slips;
  `--before <a checkout>` plays the code before beside it. Its task (the request, the calculator's and the service's
  addresses, the answers) and the folder are private: `~/.agentic-coder/evals/follow-through/`. The page names neither
  address. `terminal/test/follow-through.test.mjs` holds each part on a stand-in model.

## The model shootout, Cases have tests and the lean harness (4 Oct 2026)

- **The shootout** (`bun run eval:shootout --remote <address> --models a,b [--ctx 65536] [--reps 3] [--lean]`,
  `models/evals/tools/model-shootout.mjs` and `-page.mjs`): one hard task (bench task 40, an Agentic Coder change,
  scored in six parts by a hidden `check.mjs`) on each big model of an Ollama service, one model loaded at a time and
  let go after. `AGENTIC_PUT_BACK=off` keeps a failed message's work so part of it can be scored. One run says little
  (Qwen3.6 scored 2, 4, 3 and 1 of 6 in four runs): measure with `--reps`. Its pages are private (`~/Desktop/harness reviews/`).
- **What the runs fixed** (`terminal/test/shootout-fixes.test.mjs`): TodoWrite takes a plan as text, under `tasks` or
  one step a call, and a plan in the wrong shape is no error in a row; CodeSearch is offered only when it can run;
  gpt-oss's own tool names (open_file, print_tree, exec, apply_patch → `patchOps`) run as the tools here; a range of a
  short file runs as typed; notes when memory fills ask a service model with thinking off; a Write that would break
  a file is refused; a test file in a code project is never asked about by the Desktop default.
- **Cases have tests** (hook `cases`, `terminal/src/agent/cases.mjs`, on for Model with `done`): on a model on another
  machine, in a project with tests, the first change brings a call of its own that lists the request's cases
  (`listCases`): two halves, what it asks for and what must stay as it is, 25 each, in the request's own words, the
  input alone. Left out: a call with more arguments than the request gives the function (`madeUp`), a sentence, a
  made-up shape of a result. A flag or a shell sign the request spells out that no case uses is a case too
  (`gapCases`). Before the answer stands, each listed example must be in a test file changed in the message as
  written (`untested`; a plan's own cases match by form): back twice, then a line. The cases go with the notes when
  memory fills.
- **Case review** (hook `case-review`, on for Model; 5 Oct 2026): once a message, after that, a call of its own reads
  the changed code (not the tests) against each case: what the request says, what the code gives when followed by
  hand, ok or not (`reviewAsk`, `REVIEW_SCHEMA`). What reads wrong goes back once, as a read that can be wrong, to be
  checked by running it. Tried on a correct solution with three bugs put in: Qwen3.6 found two and raised none on the
  correct one; qwen3-coder-next found none.
- **Thinking on an Ollama service** (5 Oct 2026; it takes no cap of ours): a reply that thinks past the model's
  thinking budget is stopped and asked for again with thinking off (`generate`'s `noThink`; one reply had thought 14
  minutes), and past half a request's time its replies are asked for with thinking off (`serviceSteppedDown`).
- **Steps not lost** (`mendEdit`, runStep): an Edit with no path goes to the one seen file that holds its old text, a
  Write of old and new text is an Edit, and `cd /a-folder-not-there && cmd` runs in the project folder and says so.
  The bench's `--keep` keeps each run's files beside its results.
- **Older copies go before notes** (5 Oct 2026, the owner's pick; agent.mjs `dropSuperseded`, called by
  `fitContext` on a model on another machine only): when memory is nearly full, what the conversation holds a newer
  copy of is dropped first: an older Read of a file whose text came again later (the whole file, or the same lines,
  told from the result's own first lines), an older whole version it wrote, an older output of a command run again.
  The newest two outputs, a kept error and anything short stay. Only when that leaves 8% of the memory free are the
  notes skipped. On this Mac a changed old message is read again slowly, so conversations there go to notes as before.
  More names for an argument are taken too (Search's `find`, Write's `prompt` or `file_text`, Bash's `commands`,
  TodoWrite's `todo`), and an Edit with the whole file and no old text is the Write it means. `memory-copies.test.mjs`.
- **The same step again** (5 Oct 2026, the owner's picks; agent.mjs's loop, questions.mjs `sameStepNote`,
  `stuckQuestion`): the second time, the model is told why nothing changed in that step's own words (a write that
  changed nothing, a command with the same result, a search already answered; a Read answers for itself) and you are
  not asked. The third time (a look: the fourth) the Stuck question says what it is on, what it tried, how often and
  what came of it, with ways out as choices: Try a different way, Skip this step, Stop here, or your hint ("Keep
  going" means another way). One more time and it stops. A command whose words changed is not the same step again.
- **The lean harness** (the owner, shown Claude Code's harness beside this one: "can we make it just like this?";
  `way.mjs` `leanFrom`, `LEAN_LINES`): one switch, off unless set (settings.json `"lean"`, `AGENTIC_LEAN`,
  `/hooks lean` · `/hooks full`, `coding -p --lean`, the bench's and the shootout's `--lean`). On: Who decides is Model,
  none of the app's checks run (`hook()` is false for all), no Look first, no reminders of the plan or the request,
  no Remember hints, nothing put back; the instructions gain four lines on checking its own work. Permissions, your
  own hooks, the memory, the notes when memory fills and the technical stops stay. `terminal/test/lean.test.mjs`.
- **Better tools** (5 Oct 2026, the owner: "can we make the tools better?"; from the failed steps of 40 runs on a
  service). Edit already took a copy off by spaces, indent or a typo (`findEdit`); what failed was an old_text the
  file no longer held, one that appears several times, and old and new the same. Now a miss shows the file's own
  lines at the closest place, numbered as Read shows them, and from which line they differ, so the next try needs no
  Read; Edit takes `line` (where the one meant starts) to pick among several; the same-text error says the line
  already reads that way. The folder fence (`permissions.mjs`) reads a regex in quoted code as a regex
  (`regexSpans`: five of the commands it turned away, such as `/x|y|z/.test(…)`), and the project under another
  name for the same place as inside (`realOf`: /var is /private/var, which node's process.cwd() gives); a path that
  is not there is refused with what to use instead. A failed node run ends with what to change (`nodeHint` in
  scripts.mjs: require in a module, an import outside one, a name taken from the wrong built-in module; node 22.7 and
  later already run import lines in node -e). Edit, Write, Bash and TodoWrite each show one call as an example. Map,
  Rename, TestFirst and Remember (never called in those runs) are offered only where they can run, as CodeSearch is:
  Map not in the home folder, Rename and TestFirst in a folder of code, Remember with a memory; the folder is looked
  at once a conversation, so the list does not move. The remote TOOLS.md has two lines more: copy old_text from a
  failed Edit's lines, and try out code in a file rather than a long node -e. `terminal/test/better-tools.test.mjs`.
- **Where the time goes** (5 Oct 2026, the owner: "CAN WE BUILD #2?"; `terminal/src/agent/timing.mjs`). In the saved
  runs the replies took about three quarters of a run, and with thinking off a short reply still took 60-80 s, with
  nothing saved to say whether the service was reading the conversation or writing. Now each model reply is one entry
  (agent.mjs `generate`, event `timing`) with what the service says it spent (Ollama's durations, kept by client.mjs
  as llama.cpp names them: `prompt_ms`, `predicted_ms`, `load_ms`): loading, reading, writing, and the rest as
  waiting; the tokens new since the last reply (`fresh`: a long read of few new tokens is the conversation read
  again); its thinking; and a reply cut short says why. Each side call (`complete({ what })`, flows/llm.mjs `timers`:
  the cases' list, the case review, the second look, the notes) and each tool run (`runTool`) is one too. `coding -p`
  returns them (`timeline`, `time`), the bench keeps them in each run's file and summary and prints a line and the
  slowest reads under each result, and the shootout page has a "Where the time went" section. Nothing measured yet.
  `terminal/test/timing.test.mjs`.

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
  name. A Bash command naming one of the tools does not run (it waited on a yes in the window) and is told it is a tool.
  An answer with no MCP tool tried, to a request that names the server (`hits[].named`) when the model looked at nothing
  else, is not shown: it is sent back twice (`MCP_BACKS`), each time for one step with only the named tools
  (`mcpFocusTools`) and thinking on, the second with how the tool is called (`callHint`); then it is replaced by "I
  couldn't get this from your MCP server …" (the owner's pick). A message with a server's data in it (a resource you
  attached, a server's own prompt: `fromServer`) gets no note, and a request naming a server does not Look first. Qwen3.6 35B on a service, 3 Oct 2026: 10 of 12 questions
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

## Changed files, background commands and your own hooks (3 Oct 2026)

- **What they are.** The owner asked how Agentic Coder compares with Claude Code and picked three of its parts to
  build: a guard for files that changed since the model read them, long and background commands, and hooks of their
  own. Their picks: the guard shows the changed lines; a job that ends after a reply wakes the model; hooks are added
  with a form in /hooks.
- **The changed-file guard** (`terminal/src/agent/seen.mjs`): `agent.readFiles` is a `SeenFiles`, each file kept as
  the model last saw it (its Read, the app's reading ahead, its own Edit or Write, the studio's rebuild after one). An
  Edit or Write of a file that changed on disk since (a command, a formatter, you, another session) is turned back with
  the changed lines, numbered (`changedBlocks`: a change at line 10 and one at line 500 are two places), and that
  counts as reading it again; past `SHOW_MAX` (40 lines) it asks for a new Read from the first change. A deleted file
  is not news (Edit says it is missing; Write may make it). Edit still needs a Read first, and on the local set Write
  still never replaces a file (as before).
- **Long and background commands** (`terminal/src/tools/jobs.mjs`, Bash's `timeout` and `background`, the `Jobs` tool,
  `/jobs`). `timeout` is seconds up to 600 (`secsOf`: from 10,000 up it is Claude Code's milliseconds; between the cap
  and that, seconds past the cap); /effort's Command timeout stays the default. `background: true` starts the command
  in its own process group and answers after its first 1.5 s with its id (`job1`…) and first lines; one that ended by
  then answers as a plain command. Four run at once at most. `Jobs` (on both ways, after the app's tools, so the list
  never moves) reads what is new, lists, or stops (`stop: true`, the whole group). A job that ends by itself is news:
  with the next step's result while a reply runs (`takeJobNews`), with your next message after you stopped a reply,
  and otherwise the app sends it as a message of its own (`jobs-waiting` → App.jsx `jobWakeRef`, `agent.jobWake`,
  `send(..., { wake: true })`, which nothing sorts or reads ahead for, as when the model decides); with the model off
  it waits for /start. One the model or you stopped, or one of a conversation you cleared (`orphan`), is only a line.
  Jobs stop when the window closes (quit, and an exit hook for a quit that skips it) and when a `coding -p` run ends.
  A helper shares its parent's jobs. The full suite paragraph above still holds: the default limit is 2 minutes.
- **Your own hooks** (`terminal/src/agent/user-hooks.mjs`, `terminal/src/app/hooks-form.mjs`). Claude Code's layout,
  so a hook copies over: `~/.agentic-coder/hooks.json` (the form writes it) and a project's `.agentic/hooks.json`, run
  only after a yes to that very file (fingerprint in `hooks-state.json`; asked from /hooks; in `PROTECTED` and `OWN`).
  Seven moments: PreToolUse (exit 2 or a deny stops the step and the model is told why; `permissionDecision` allow
  skips the question, ask asks; a hard stop still holds), PostToolUse (what it says goes with the result; a hook that
  changed an edited file is said with its lines and counts as read), UserPromptSubmit (exit 2 keeps the message from
  being sent; what it prints goes with it; not for a job's wake), Stop (exit 2 sends the model back, three times at
  most a message, `stop_hook_active` after the first; not for helpers or the focused paths), Notification (a
  permission question or the Ask tool; not waited for), SessionStart (window start, /clear, /resume; what it prints
  goes with the next message) and SessionEnd (quit and /clear, 5 s at most). A matcher is a pattern over the whole
  tool name and fits Claude Code's names too (Grep, Glob, Task, MultiEdit); `tool_input` carries Claude Code's
  `file_path`, `old_string`, `new_string`. A hook runs as you, in the project folder, no sandbox, 60 s unless it says.
  `/hooks` is one picker: yours (enter edits, space on/off, t tests, d removes), + Add a hook, the project's line, then
  the app's checks (space on/off, as `/hooks on 1` still does). `coding -p` runs yours (`userHooks: true` in cli.jsx);
  the benches run none; `AGENTIC_USER_HOOKS=off` turns them off.
- **Tests**: `seen.test.mjs`, `jobs.test.mjs`, `user-hooks.test.mjs` (the parts and whole conversations on a scripted
  model), `app-jobs.test.mjs` (a job that ends after the reply wakes the model; /jobs) and `app-hooks.test.mjs` (a hook
  added in the form, tested, saved, and stopping the next command).

## The start page fills the window (4 Oct 2026)

- **What and why.** The owner's screenshot of a start on their other Mac (152 × 56) had the page in its top 13 rows, four
  start notes as paragraphs under it, about 25 empty rows, and the tip cut on the footer. Their picks, from a round of
  two designs drawn by the real code (private: `docs/private/design rounds/`): "1 · Studio, grown", the page growing to
  fill the window, the conversations numbered for `/resume <n>`, and the notes kept but shorter.
- **The room** (`start.room`, App.jsx): the window less the prompt box, footer, gaps and cursor line (7 with the
  page's blank line). Held (a start on this Mac), less what sits under it too: the notes, the / menu (while held, the
  rows the page can give up and keep its bot, 18 at the least) and the shortcuts, so it shrinks for them and stays live; under `START_MIN` rows it is printed as it is,
  as before. Printed at once (a remote or `--url`), it keeps 2 rows for each note still to come (the mode the last
  window left; on a remote where it runs, Big-model mode, the load). Once printed it keeps the room it was shown with
  until the window changes size. The welcome's measured height is keyed by its room too (`rowsKey`).
- **What fits** (start.jsx `StartPage`): always a conversation, This folder and Try; then sessions in the background
  with no window on them (`listBackground`), What's new (the app's last 5 commits by headline, cli.jsx; `AGENTIC_NEWS=off`
  leaves it out, as `pty.mjs` does for the app tests), then up to 20 conversations and the rest of each change's
  sentence (`GROW`), then the other folders you worked in (from the home folder). Under the bot: the last 14 days drawn
  and the memory's facts. With fewer than `START_BIG` rows under the title it is `SmallPage`. The tip (startTip) is on
  the page while it has its Try rows, else on the footer as before.
- **Numbers**: a row is numbered as `/resume <n>` takes it (`recentOf`, repeats left out); `recentRows` finds the rows
  for a click by those numbers. The notes keep their opening words (the tests wait for them) and lose the rest.
- **Tests**: `terminal/test/start.test.mjs` (the room at eight sizes, never past it, loading as tall as ready, every
  part, the small page, the numbers, `/resume 2` and the / menu in the real window).

## Pictures and PDFs dropped into the prompt (7 Oct 2026)

- **What and why.** The owner asked to drag a screenshot in and see it as a preview or attachment.
  Before, a dragged file stayed as its long path in the box until enter. Their picks (all
  recommended): the tray over the box with a thumbnail, a click opening Quick Look, the file copied
  as it arrives, a chip deleted in one piece, PDFs too (not thumbnails in sent messages).
- **How** (`terminal/src/app/attach.mjs`, drawn by `tray.jsx`): a paste, or keys arriving all at
  once (a drop with Terminal's paste brackets off), is read with `droppedFiles`; each picture or
  PDF is copied to `~/.agentic-coder/attachments/<session>-<n>.<ext>` and its path in the text
  becomes `[Image #n]` or `[PDF #n]` (`ATTACH_TOKEN`, shared with ctrl+v's numbering:
  `pastedRef` = { n, files, info }). One that cannot be copied or opened keeps its path, with a
  line saying why. In shell mode (!) a path stays a path. The tray lists the chips the box holds
  (`trayItems`), so a deleted chip takes its card away and ctrl+z brings it back; `trayLayout`
  places the cards once, for the drawing and for a click (`trayRef`, onMouse: the rows over the
  box's top edge). A window under 24 rows or 60 columns gets one line instead.
- **The thumbnail** is media-tool.swift's `thumb`: the picture drawn into at most 20 × 10 dots
  (a cell is two, ▀ with its top dot as the letter and its bottom as the background); a dot half
  see-through or more is left blank (a window's shadow). In Terminal's 256 colours it shows a
  page's layout and colours, not its words; Quick Look (`qlmanage -p`, ctrl+f or a click) shows it sharp.
- **What the model gets** is as before (the copy, made smaller), plus a line saying where a dropped
  file came from (`expandMentions`' `from`), so it can still name or read the original.
- **Tests**: `attach.test.mjs` (the drop, the copy, PDFs, what is left alone, the thumbnail the
  right way up, the cards, Quick Look), `edit-input.test.mjs` (a chip in one piece),
  `app-vision.test.mjs` (the real window: drop, card, ctrl+f, delete and ctrl+z, the request),
  `app-mouse.test.mjs` (a click on a card), `app-keeper.test.mjs` (a drop through the keeper).
  `AGENTIC_TEST_QUICKLOOK` names a file the tests read in Quick Look's place; with
  `AGENTIC_NO_OPEN` (every test window) nothing opens.

## Profiles: which server and model each request goes to (8 Oct 2026)

- **What and why.** The owner's shared Ollama service is busy (6 Oct: 77 s of a 201 s task was waiting in line), and
  they asked to hot-swap the server and model live: each AI and each task group points at a profile, and changing a
  profile changes the very next request, mid-task too. Their picks: the full build, the next request even mid-task,
  a busy server spills to a backup, a /profiles panel every window on this Mac follows, a second step in /model, the
  Rows design, /profiles in /subagents' place in the / menu.
- **A profile** (`terminal/src/app/profiles.mjs`) is a server (the /remote set-up without its key), a model, a backup
  and a wait (`spillAfter`), by name, in `~/.agentic-coder/profiles.json` with `uses`: a row's key (`ai:btw`,
  `type:fix`, `cat:coding`, `skill:write-a-test`) → a profile. The most specific wins (`profileFor`): skill › task
  type › its category › the AI › its category › Main. Nothing changes until a file exists: the first one is made from
  what runs today (`seedProfiles`: Main = the remote in use, one profile per /subagents helper model, a saved Claude
  API as one nothing uses), and only a window makes it (it knows the helpers); the hub's tab waits for one.
- **The router** (`terminal/src/app/profile-router.mjs`) reads the file again whenever its time changed, at each
  request. The conversation moves between steps (`agent-model.mjs followProfile`, called before `fitContext` in the
  step loop and in `chat`): the step under way never moves; the new model reads the conversation once, made to fit
  first. Its own calls name no model, so a move connects the server for that model (its endpoint then names it);
  every helper's call names its model and server (`use.url`, client.mjs), so two profiles on one address never mix.
  Each server is connected once; the window's own connection is lent (`lendConn` at /remote and /model).
  `helperUse` goes by profile once a file exists (`profileUse`), /btw has its own row (`btwUse`), /agents' steps go
  by the `agents` row (agents-driver `routeAi`), a helper agent by `helpers` unless its file names its own model.
- **A spill** (client.mjs `spilling`): a profile with a backup sends its request there when its server answers busy
  (a 429/503, or those words) or sends no first word within `spillAfter` seconds plus the time to read what is new
  (the reading speed measured, else 1,000 tokens a second: a long conversation read again is not a busy server);
  then the profile cools down for `COOL_MS` (2 min, `agent/profile-spill.mjs`): its requests go straight to the
  backup. A note says so. Once the first word has come the request stays.
  The calls the agent makes on the conversation's model without naming a profile (a summary, the cases, the second
  look, a check) follow it the same way: the agent registers its profile by address (client.mjs `routeCalls`). The
  agent's event for a move is `profile-route` (`route` is the request's sort, flows/index.mjs).
- **Meters** (`terminal/src/agent/profile-meters.mjs`): each window writes `profile-meters/<day>/<pid>.json` (requests,
  wait to the first word, speed, spills, cost); /profiles and the hub add up every window of the day.
- **The window** (`app-profiles.mjs`): /profiles (profiles-view.jsx) lists the profiles (←→ steps the highlighted
  one's model: the Claude API's list, else its service's; enter opens its settings), then one group at a time with
  ◀ profile ▶ per row, saved at once; a model that cannot do a row's job (pictures, embeddings) is marked ⚠. /model on
  a service has three steps: the model, which profile uses it (+ New profile, Just this window = the old switch), its
  settings with Backup and Spill after. Both open while a reply runs. The window looks at the file every 2 s and,
  while idle, moves the conversation to its Main and rebuilds the code search's embedder (`followProfiles`); the
  footer follows (`onRoute`). /subagents is typed only and opens /profiles on its AIs group; its panel is gone.
- **The hub's Profiles tab** (`profiles-hub.mjs`, `profiles.html`, `coding hub profiles`): the same file, a model
  picked from the Remote tab's list for that server, backups, who uses which, today's meters.
- **Tests**: `terminal/test/profiles.test.mjs` (which profile, the first profiles, the file, the meters, the router,
  a busy and a silent server spilling, the conversation moving to another server between two steps, a spill with its
  cool-down) and `app-profiles.test.mjs` (the real window: the / menu, /subagents, /model's steps while a task works,
  its next step on the new model).

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
