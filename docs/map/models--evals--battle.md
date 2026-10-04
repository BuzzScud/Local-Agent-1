# models/evals/battle/ — Tests and battles for models: runner, store, remote entrants, and one-run logic

Every folder under models/evals/battle/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- models/evals/battle/ — Tests and battles for models: runner, store, remote entrants, and one-run logic
  - models/evals/battle/fake-test.mjs (83) — Fake test output for development, mimicking real test logs without running a model
  - models/evals/battle/remote-entrants.mjs (119) — The remote models in the Arena (3 Oct 2026, the owner's ask: "when /remote is connected, allow the remote models to participate in the arena").
  - models/evals/battle/run-one.mjs (134) — Executes a single battle test for one model using specific settings and context helpers
  - models/evals/battle/runner.mjs (644) — Main Arena runner handling tests, battles, and checks, managing state and lifecycle
  - models/evals/battle/store.mjs (310) — The Arena's files, on this Mac only (never in git): ~/.agentic-coder/battle/ (AGENTIC_HOME moves it with the rest).
  - also: arena.html, builder.mjs, checks.mjs, fake-one.mjs, practice28.json, run-set.mjs, start.mjs, suggest.mjs, verify-tests.mjs
- models/evals/battle/new28/ — Battle evaluation scenarios for model performance testing → models--evals--battle--new28.md
- models/evals/battle/work28/ — Battle evaluation workspace for model performance testing → models--evals--battle--work28.md
