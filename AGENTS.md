# Working in this repo

- **Two parts.** `terminal/` is the agent terminal; `models/` holds the models we use
  and test, the runtime, and the test bench. The terminal imports only
  `models/index.mjs`. See README.md for the map.
- **Every page goes in `bonsai-code DOCS/`** (at the top of this repo, on the Mac only, not in git). Diagrams, previews, reports,
  test and result pages, PDFs: anything made about Bonsai Code is saved there, as one
  self-contained HTML file where it is a page. The report builders write their pages
  there directly (`docsPath` in `docs/to-docs.mjs`); a page made by hand is saved there too.
  Pages are not kept anywhere else in the repo, and capture outputs stay out of git.
  The folder has six groups, each a subfolder: `diagrams/` (how Bonsai is built),
  `reports/` (what got built, by day), `tests/` (measured runs and checks), `design rounds/`,
  `other/`, and `older versions/` (a page replaced by a newer one moves there; nothing is
  deleted). A builder names its group in the path it gives `docsPath` (`tests/bonsai-night-….html`).
  `/docs` in Bonsai (the hub) lists the folder live by these groups; a file left at the top
  level shows as unsorted until it is filed.
- **Before a commit, run `bun run docs`.** It mirrors that folder into `docs/` (and
  rewrites `docs/README.md`, the index); commit `docs/` with the rest. It stops if the
  folder is missing or looks emptied, and changes nothing then.
- **Tests:** `bun run test` runs both parts. Raw results of model tests stay on the
  Mac in `models/<model>/results/` (not in git).
- **Every test run goes in the test record**, which the hub shows on its Tests tab
  (`/tests` in Bonsai, `bonsai tests`). The record is one file on the Mac,
  `~/.bonsai-code/tests/record.jsonl`, one line per run. `bun run test`, `bun run eval`
  and `bun run eval:words` add their own line when they finish, so run the tests through
  those (a bare `bun test` is not recorded). Any other measured run (a real-bug try, a
  probe, a one-off check) adds its line with `recordTest()` from `models/evals/record.mjs`:
  what was tested, the code it ran on, the result, the seconds, where the raw results are,
  and its results page in the DOCS folder if one was made. `bun run test:record` adds runs
  that are on the Mac but not yet in the record. A saved copy of the Tests tab is written to
  `bonsai-code DOCS/tests/bonsai-test-record.html`, so it is mirrored with the other pages.
- **The GitHub repo** (BuzzScud/Local-Agent-1) is private. Nothing secret is committed:
  scan staged files before a push.
