# Working in this repo

Agentic Coder: a coding agent for the terminal (`terminal/`) that runs local models
(`models/`). JavaScript modules (`.mjs`, Ink `.jsx`), run with Bun. README.md has the
folder map; AGENTS-DETAILS.md has the background to every rule here.

## Commands
- Run the app from here: `bun run start`. Installed, it is the `coding` command.
- One test file: `bun run test ./terminal/test/<name>.test.mjs` (or `./models/test/…`;
  keep the `./`). Use it while you work: seconds, not recorded.
- All tests: `bun run test`, about 3 minutes; it adds a line to the test record. Run it
  once at the end, and never as a bare `bun test` (that is not recorded).
- Before a commit of pages: `bun run docs` (it rewrites `docs/README.md`, the index, and
  stops when git tracks a private file or a page holds the home folder's path or name:
  write it as `~`). Before a push: `bun run check` (the secrets scan and more; `--fast`
  skips the model files and the tests).

## Hard rules
- `terminal/` imports only `models/index.mjs`, and `models/` imports only
  `terminal/index.mjs`. A name the other part needs is added to that file
  (`terminal/test/two-parts.test.mjs` fails otherwise).
- The GitHub repo is public. Nothing secret is committed. A place the code connects to
  for the first time is added to `KNOWN_HOSTS` (`models/evals/tools/check.mjs`) on purpose.
- Tests never touch the user's real memory: set `AGENTIC_HOME`, and
  `AGENTIC_MEMORY_SAVE=off` unless the test is about saving.
- A test that drives the app ends with the app quitting (`quitTyped` when text is left
  in the prompt).
- A page that must not be public goes in `docs/private/`, never in a group. Never point
  `AGENTIC_DOCS` at a folder of private files.

## Where things go
- A page about Agentic Coder (report, diagram, test results, preview): one
  self-contained HTML file in `docs/<group>/`: `diagrams`, `reports`, `tests`,
  `design rounds` or `other`. Builders use `docsPath('tests/…')`, which is the main
  folder's `docs/` even from a worktree; pages are committed from the main folder, by path.
- A page replaced by a newer one is never deleted: move it to `docs/older versions/` (a
  Gemma page to its own folder's `older versions/`).
- A page about Gemma: `docs/gemma-docs/`. A Gemma test's page (a run's results, a
  wizard, a runbook): `docs/gemma-docs/test/`. A test run's logs and scripts:
  `docs/private/gemma-runs/<test>/`.
- `docs/private/` holds the owner's own things (the memory, the design cards, morning
  briefs, run logs). Git never keeps it.
- Raw model results: `models/<model>/results/`, not in git. A test's working copy of
  another project goes outside the repo.
- Every measured run goes in the test record (`~/.agentic-coder/tests/record.jsonl`).
  `bun run test`, `bun run eval` and `bun run eval:words` add their own line; anything
  else calls `recordTest()` from `models/evals/record.mjs`.

## Before you change these, read AGENTS-DETAILS.md
The memory, the Arena and the test record, the evals, and the `docs/` folder: it has
how each works and why.
