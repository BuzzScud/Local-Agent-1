# Working in this repo

- **Two parts.** `terminal/` is the agent terminal; `models/` holds the models we use
  and test, the runtime, and the test bench. The terminal imports only
  `models/index.mjs`, and the models part imports only `terminal/index.mjs`: a name the
  other part needs is added to that file, not imported around it
  (`terminal/test/two-parts.test.mjs` fails otherwise). See README.md for the map.
- **Every page goes in `agentic-coder DOCS/`** (at the top of this repo, on the Mac only, not in git). Diagrams, previews, reports,
  test and result pages, PDFs: anything made about Agentic Coder is saved there, as one
  self-contained HTML file where it is a page. The report builders write their pages
  there directly (`docsPath` in `docs/to-docs.mjs`); a page made by hand is saved there too.
  Pages are not kept anywhere else in the repo, and capture outputs stay out of git.
  The folder has six groups, each a subfolder: `diagrams/` (how Agentic Coder is built),
  `reports/` (what got built, by day), `tests/` (measured runs and checks), `design rounds/`,
  `other/`, and `older versions/` (a page replaced by a newer one moves there; nothing is
  deleted). A builder names its group in the path it gives `docsPath` (`tests/bonsai-night-….html`).
  `/docs` in Agentic Coder (the hub) lists the folder live by these groups; a file left at the top
  level shows as unsorted until it is filed.
- **Gemma pages go in `~/Desktop/gemma-docs/`, not the DOCS folder** (the user's rule, 28 Sep
  2026). Any report, diagram, flow, test page or other file about Gemma (the model, its
  tests, its thinking, its harness) is saved there; a replaced version moves to its
  `older versions/`. Raw model results still stay in `models/gemma-4-12b/results/`.
- **The Bonsai-era pages** (24–28 Sep 2026) left the DOCS folder on 28 Sep: they are in
  `models/bonsai-2-27b/Bonsai Docs/` (beside the retired model's recipe, on the Mac only,
  not in git), and in git history under `docs/`.
- **Before a commit, run `bun run docs`.** It mirrors that folder into `docs/` (and
  rewrites `docs/README.md`, the index); commit `docs/` with the rest. It stops if the
  folder is missing or looks emptied, and changes nothing then.
- **Tests:** `bun run test` runs both parts, the test files side by side (four at once;
  `AGENTIC_TEST_JOBS=6` for more, `=1` for one after the other). A test that drives the app
  must end with the app quitting: with text left in the prompt, quit with `quitTyped`.
  Raw results of model tests stay on the Mac in `models/<model>/results/` (not in git);
  a test's working copy of another project goes outside the repo, not into `results/`.
- **Every test run goes in the test record**, which the hub shows on its Tests tab
  (`/tests` in Agentic Coder, `coding tests`). The record is one file on the Mac,
  `~/.agentic-coder/tests/record.jsonl`, one line per run. `bun run test`, `bun run eval`
  and `bun run eval:words` add their own line when they finish, so run the tests through
  those (a bare `bun test` is not recorded). Any other measured run (a real-bug try, a
  probe, a one-off check) adds its line with `recordTest()` from `models/evals/record.mjs`:
  what was tested, the code it ran on, the result, the seconds, where the raw results are,
  and its results page in the DOCS folder if one was made. `bun run test:record` adds runs
  that are on the Mac but not yet in the record. A saved copy of the Tests tab is written to
  `agentic-coder DOCS/tests/agentic-coder-test-record.html`, so it is mirrored with the other pages.
- **The memory** (`terminal/src/agent/facts.mjs`, `recall.mjs`, `lessons.mjs`) keeps what Agentic Coder
  learns as small files, on the Mac only: `~/.agentic/memory` about the user, `<project>/.agentic/memory`
  about a project. A test never touches the real one: with `AGENTIC_HOME` (or `BONSAI_HOME`) set the user's memory
  is kept inside it, and the app tests run with `AGENTIC_MEMORY_SAVE=off` unless they test saving.
  A practice run (`bun run eval`) runs without the memory, so it measures the same thing every
  time; `memory: true` in `runHeadless` turns it on. `bun run eval:recall` is the check that the
  right fact comes back (20 facts, 30 requests, the real small model).
  After a task it ASKS before saving (the user's pick, 28 Sep 2026); "update memory" and `/update memory` save at once.
- **The GitHub repo** (BuzzScud/Local-Agent-1) is PUBLIC since 28 Sep 2026 (the user's choice): anyone can read it. Nothing secret is committed:
  scan staged files before a push. `bun run check` does that scan and more (the history,
  the packages, where the code connects, the installed app, the unit tests); `--fast`
  leaves out the model files and the tests. A place the code names for the first time
  (`KNOWN_HOSTS` in `models/evals/tools/check.mjs`) is added there on purpose, never in passing.
