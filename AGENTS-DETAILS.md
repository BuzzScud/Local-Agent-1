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

## The memory

- **The memory** (`terminal/src/agent/facts.mjs`, `recall.mjs`, `lessons.mjs`) keeps what Agentic Coder
  learns as small files, on the Mac only: `~/.agentic/memory` about the user (on this Mac a link to
  `docs/private/memory-about-you/`), `<project>/.agentic/memory` about a project. Work on the tests' own
  starter files (`models/evals/battle/<set>/<id>/project/`, `models/evals/bench/tasks/<id>/project/`
  and their answers) is practice: no lesson is saved from it (`practiceWork` in `lessons.mjs`). A test never touches the real one: with `AGENTIC_HOME` (or `BONSAI_HOME`) set the user's memory
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

## The prompt files

- **TOOLS.md and SKILLS.md** (`terminal/rules/`, since 30 Sep 2026) are read by `terminal/src/agent/prompt-files.mjs`
  at each use: TOOLS.md's `## Tool use` lines are the Tool use part of the prompt, and SKILLS.md's skills
  (`## Name`, `- Words:`, `- About:`, steps) are listed in the prompt as `SKILLS/<name>` and brought with a
  request whose words they use. The hub's Instructions tabs 06–08 save them and a folder's AGENTS.md
  (`terminal/src/app/prompt-files-hub.mjs`). As shipped they change nothing: the Tool use lines from before,
  and the one skill is an example switched off. A test that reads the prompt sets `AGENTIC_RULES_DIR` to a
  folder of its own, so the shipped files never decide what it sees (`terminal/test/prompt-files.test.mjs`).
  The Arena's Skills check measures a skill on the real model.

## The public repo

- **The GitHub repo** (BuzzScud/Local-Agent-1) is PUBLIC since 28 Sep 2026 (the user's choice): anyone can read it. Nothing secret is committed:
  scan staged files before a push. `bun run check` does that scan and more (the history,
  the packages, where the code connects, the installed app, the unit tests); `--fast`
  leaves out the model files and the tests. A place the code names for the first time
  (`KNOWN_HOSTS` in `models/evals/tools/check.mjs`) is added there on purpose, never in passing.
