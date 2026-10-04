# models/evals/bench/ — Directory for benchmarking evaluation tasks and their execution scripts

Every folder under models/evals/bench/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- models/evals/bench/ — Directory for benchmarking evaluation tasks and their execution scripts
  - models/evals/bench/pick-tasks.mjs (22) — Script that selects which practice task folders to run based on command line arguments
  - models/evals/bench/run.mjs (218) — Main script that executes selected tasks against a model and records the results
- models/evals/bench/code/ — Code search benchmark for real projects
  - models/evals/bench/code/search.mjs (162) — Tests code search accuracy on real project functions
  - also: agentic-coder.json
- models/evals/bench/design/ — Design bench tests comparing model output with and without design examples
  - models/evals/bench/design/components-page.mjs (361) — Generates the UI component battle results page with tabs for verdicts and blind votes
  - models/evals/bench/design/components.mjs (182) — UI component battle (▶ Run tests → UI component battle, `/test components`): do Gemma and Qwen build a small UI component well, and is the design folder (docs/…
  - models/evals/bench/design/page.mjs (169) — Builds the design before-and-after test results page with side-by-side comparisons
  - models/evals/bench/design/run.mjs (226) — Executes the main design example benchmark runs across different model arms and settings
  - models/evals/bench/design/studio-check.mjs (198) — Validates design studio pieces using headless Chrome layout checks without running models
  - also: components.json, pages.json
- models/evals/bench/memory/ — 4 files
  - models/evals/bench/memory/claude-notes.mjs (69) — Checks if specific user notes are correctly recalled by the model
  - models/evals/bench/memory/recall.mjs (76) — Measures if relevant saved facts are returned for given requests
  - models/evals/bench/memory/second-time.mjs (105) — Compares task results with empty versus populated memory states
  - also: recall-set.json
- models/evals/bench/night/ — Overnight benchmarking tools for nightly model evaluations
  - models/evals/bench/night/report-night.mjs (184) — Generates an HTML summary report from the previous night's evaluation results
  - models/evals/bench/night/run-night.mjs (88) — The overnight check, report only: runs each check in turn (never two models at once), writes results to models/bonsai-2-27b/results/night/<date>/, then builds …
  - models/evals/bench/night/start.sh (14) — Launches the background process while preventing system sleep
- models/evals/bench/tasks/ — Directory holding various evaluation tasks for code benchmarks → models--evals--bench--tasks.md
- models/evals/bench/words/ — Folder for benchmarking word-based evaluation triggers
  - models/evals/bench/words/real.mjs (180) — Script running real model requests with steering words, recording outcomes and metrics
