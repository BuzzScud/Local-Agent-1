# models/evals/bench/tasks/33-hard-pagination/ — Hard pagination benchmark task folder with project and reference data

Every folder under models/evals/bench/tasks/33-hard-pagination/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/33-hard-pagination/ — Hard pagination benchmark task folder with project and reference data
  - models/evals/bench/tasks/33-hard-pagination/check.sh (28) — Runs tests and validates pagination API response structure and counts
  - also: task.txt
- models/evals/bench/tasks/33-hard-pagination/project/ — Hard pagination task project folder
  - models/evals/bench/tasks/33-hard-pagination/project/api.mjs (6) — API entry point returning paginated items
  - models/evals/bench/tasks/33-hard-pagination/project/api.test.mjs (9) — Tests item structure contains id and name
  - models/evals/bench/tasks/33-hard-pagination/project/service.mjs (7) — Service layer filtering item fields for output
  - models/evals/bench/tasks/33-hard-pagination/project/store.mjs (12) — Data store with pagination tracking logic
  - also: package.json
- models/evals/bench/tasks/33-hard-pagination/reference/ — Reference data for hard pagination benchmark tasks
  - models/evals/bench/tasks/33-hard-pagination/reference/api.mjs (11) — Handles paginated queries with limit and cursor logic
  - models/evals/bench/tasks/33-hard-pagination/reference/api.test.mjs (19) — Tests pagination limits, cursors, and item structure
  - models/evals/bench/tasks/33-hard-pagination/reference/service.mjs (7) — Filters items to expose only id and name
  - models/evals/bench/tasks/33-hard-pagination/reference/store.mjs (18) — Stores 250 items and tracks scan counts
