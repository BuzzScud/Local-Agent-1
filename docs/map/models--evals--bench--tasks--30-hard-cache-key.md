# models/evals/bench/tasks/30-hard-cache-key/ — Hard cache key benchmark task directory

Every folder under models/evals/bench/tasks/30-hard-cache-key/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/30-hard-cache-key/ — Hard cache key benchmark task directory
  - models/evals/bench/tasks/30-hard-cache-key/check.sh (14) — Runs tests and validates currency conversion logic with assertions
  - also: task.txt
- models/evals/bench/tasks/30-hard-cache-key/project/ — Folder for hard cache key benchmark task project
  - models/evals/bench/tasks/30-hard-cache-key/project/cache.mjs (10) — Memoization helper that caches function results by argument to avoid repeated work.
  - models/evals/bench/tasks/30-hard-cache-key/project/convert.mjs (10) — Currency conversion logic using memoized rate fetching and rounding.
  - models/evals/bench/tasks/30-hard-cache-key/project/convert.test.mjs (8) — Test verifying correct conversion of USD to EUR amount.
  - models/evals/bench/tasks/30-hard-cache-key/project/rates.mjs (11) — Exchange rate data store with call counting and error handling.
  - also: package.json
- models/evals/bench/tasks/30-hard-cache-key/reference/ — Folder for hard cache key benchmark reference tasks
  - models/evals/bench/tasks/30-hard-cache-key/reference/cache.mjs (10) — Memoization utility storing function results by argument keys to avoid repeated work
  - models/evals/bench/tasks/30-hard-cache-key/reference/convert.test.mjs (13) — Tests currency conversion logic for USD, EUR, and GBP rates
