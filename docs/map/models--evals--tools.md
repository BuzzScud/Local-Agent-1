# models/evals/tools/ — 1 folders: constantkv/; 58 files

Every folder under models/evals/tools/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/tools/ — 1 folders: constantkv/; 58 files
  - models/evals/tools/check.mjs (598) — `bun run check`: is anything in Agentic Coder that should not be?
  - models/evals/tools/door-check.mjs (370) — The Door check: background sessions and the door between Macs (terminal/src/app/sessions.mjs, door.mjs), measured on this Mac alone, with no model.
  - models/evals/tools/remote-rules-ab.mjs (187) — Instructions: local vs remote (the Arena → ▶ Run a test, `/test remote-rules`; 2 Oct 2026): one model on a service (/remote's Another service, an Ollama) plays…
  - models/evals/tools/run-suite.mjs (115) — `bun run test`: the unit tests of both parts, and one line in the test record when a full run ends.
  - models/evals/tools/skills-check.mjs (197) — The skills check (▶ Run a test → Skills check, `/test skills`): does a skill from SKILLS.md help the real model, on this Mac?
  - also: ab-kit.mjs, agents-ab.mjs, agents-check.mjs, agents-page.mjs, auto-screen-check.mjs, auto-screen-page.mjs, big-ab.mjs, check-kit.mjs, check-page.mjs, constantkv-check.mjs, done-check.mjs, done-page.mjs, door-page.mjs, edited-check.mjs, habits-check.mjs, habits-page.mjs, ladder-check.mjs, ladder-pag… (53 files)
- models/evals/tools/constantkv/ — Runs the model side of the ConstantKV evaluation check
  - models/evals/tools/constantkv/run.py (179) — Loads model, measures speed and memory, prints pass or fail results
