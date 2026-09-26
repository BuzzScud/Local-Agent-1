# Working in this repo

- **Two parts.** `terminal/` is the agent terminal; `models/` holds the models we use
  and test, the runtime, and the test bench. The terminal imports only
  `models/index.mjs`. See README.md for the map.
- **Every page goes in `bonsai-code DOCS/`** (at the top of this repo, on the Mac only, not in git). Diagrams, previews, reports,
  test and result pages, PDFs: anything made about Bonsai Code is saved there, as one
  self-contained HTML file where it is a page. The report builders write their pages
  there directly (`docsPath` in `docs/to-docs.mjs`); a page made by hand is saved there too.
  Pages are not kept anywhere else in the repo, and capture outputs stay out of git.
- **Before a commit, run `bun run docs`.** It mirrors that folder into `docs/` (and
  rewrites `docs/README.md`, the index); commit `docs/` with the rest. It stops if the
  folder is missing or looks emptied, and changes nothing then.
- **Tests:** `bun run test` runs both parts. Raw results of model tests stay on the
  Mac in `models/<model>/results/` (not in git).
- **The GitHub repo** (BuzzScud/Local-Agent-1) is private. Nothing secret is committed:
  scan staged files before a push.
