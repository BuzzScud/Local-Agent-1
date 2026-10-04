# models/evals/ — Directory holding evaluation scripts for testing and benchmarking models

Every folder under models/evals/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- models/evals/ — Directory holding evaluation scripts for testing and benchmarking models
  - models/evals/prompts.mjs (37) — Loads test prompts from files to distinguish real work from practice tasks
  - models/evals/record.mjs (315) — Appends test results to a JSONL file for live tracking and reporting
  - models/evals/run-tests.mjs (279) — Defines test configurations and manages running models or commands in the Arena
- models/evals/battle/ — Tests and battles for models: runner, store, remote entrants, and one-run logic → models--evals--battle.md
- models/evals/bench/ — Directory for benchmarking evaluation tasks and their execution scripts → models--evals--bench.md
- models/evals/dev/ — Dev evaluation scripts for testing model capabilities and debugging ✓ → models--evals--dev.md
- models/evals/reports/ — Folder holding scripts that generate evaluation report pages
  - models/evals/reports/report-27b.mjs (190) — Script building the Bonsai 27B switch report page with real app screens
  - models/evals/reports/report-fast.mjs (321) — Script creating a stats page for the faster round comparison against Prism ✓
  - models/evals/reports/report-faster.mjs (92) — Script producing a before-and-after speed improvement report for Gemma
  - models/evals/reports/report-smart-stats.mjs (482) — Script creating detailed stats page with charts for smarter and faster round
  - models/evals/reports/report-smart.mjs (169) — Script generating the initial report page for the smarter and faster round
  - also: report-claude-notes.mjs, report-memory.mjs, report-round3.mjs, report-step2.mjs, report-step3.mjs
- models/evals/tools/ — Tools for evaluating model behavior and system checks
  - models/evals/tools/check.mjs (532) — Checks if anything in the repo should not be there ✓
  - models/evals/tools/door-check.mjs (387) — Checks background sessions and the door between Macs
  - models/evals/tools/door-page.mjs (35) — Generates the results page for the Door check
  - models/evals/tools/remote-rules-ab.mjs (187) — Compares local versus remote prompt instructions
  - models/evals/tools/run-suite.mjs (115) — Runs unit tests and records the results
  - also: ab-kit.mjs, agents-ab.mjs, agents-check.mjs, agents-page.mjs, auto-screen-check.mjs, auto-screen-page.mjs, big-ab.mjs, check-page.mjs, constantkv-check.mjs, done-check.mjs, done-page.mjs, edited-check.mjs, habits-check.mjs, habits-page.mjs, ladder-check.mjs, ladder-page.mjs, long-task-page.mjs, lon… (50 files)
- models/evals/tools/constantkv/ — Runs the model side of the ConstantKV evaluation check
  - models/evals/tools/constantkv/run.py (179) — Loads model, measures speed and memory, prints pass or fail results
