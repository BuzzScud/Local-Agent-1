# models/evals/ — 4 folders: battle/, bench/, dev/, tools/; 3 files

Every folder under models/evals/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- models/evals/ — 4 folders: battle/, bench/, dev/, tools/; 3 files
  - models/evals/prompts.mjs (37) — Loads test prompts from files to distinguish real work from practice tasks
  - models/evals/record.mjs (315) — The test record: one line per test run, kept on this Mac in ~/.agentic-coder/tests/record.jsonl (AGENTIC_HOME moves it, AGENTIC_TEST_RECORD names the file outr…
  - models/evals/run-tests.mjs (285) — The tests the Arena and `/test` know by name (the hub's Arena tab, models/evals/battle/), one model at a time: what each is, the command it runs (from the repo…
- models/evals/battle/ — Tests and battles for models: runner, store, remote entrants, and one-run logic → models--evals--battle.md
- models/evals/bench/ — Directory for benchmarking evaluation tasks and their execution scripts → models--evals--bench.md
- models/evals/dev/ — 1 folders: experiments/; 3 files → models--evals--dev.md
- models/evals/tools/ — 57 files → models--evals--tools.md
