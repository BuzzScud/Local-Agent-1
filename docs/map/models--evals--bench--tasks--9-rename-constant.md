# models/evals/bench/tasks/9-rename-constant/ — Task to rename a constant in the benchmark project

Every folder under models/evals/bench/tasks/9-rename-constant/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/9-rename-constant/ — Task to rename a constant in the benchmark project
  - models/evals/bench/tasks/9-rename-constant/check.sh (5) — Script verifying the constant was renamed and tests pass
  - also: task.txt
- models/evals/bench/tasks/9-rename-constant/project/ — Holds configuration and logic for a bounded queue task.
  - models/evals/bench/tasks/9-rename-constant/project/limits.mjs (2) — Sets the maximum number of items allowed in the queue.
  - models/evals/bench/tasks/9-rename-constant/project/queue.mjs (7) — Adds items to a list, blocking if it reaches capacity.
  - models/evals/bench/tasks/9-rename-constant/project/queue.test.mjs (8) — Checks that adding items works and rejects full queues.
  - also: package.json
- models/evals/bench/tasks/9-rename-constant/reference/ — Reference implementation for renaming a constant in the benchmark task
  - models/evals/bench/tasks/9-rename-constant/reference/limits.mjs (2) — Defines the maximum number of items allowed in the queue
  - models/evals/bench/tasks/9-rename-constant/reference/queue.mjs (7) — Adds an item to the queue or throws if full
  - models/evals/bench/tasks/9-rename-constant/reference/queue.test.mjs (8) — Tests adding items and handling a full queue error
