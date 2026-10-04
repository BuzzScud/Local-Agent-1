# models/evals/bench/tasks/19-multifile-symbol/ — Tests for multi-file symbol formatting logic and configuration defaults.

Every folder under models/evals/bench/tasks/19-multifile-symbol/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/19-multifile-symbol/ — Tests for multi-file symbol formatting logic and configuration defaults.
  - models/evals/bench/tasks/19-multifile-symbol/check.sh (15) — Runs tests to verify money formatting and report building work correctly.
  - also: task.txt
- models/evals/bench/tasks/19-multifile-symbol/project/ — Holds configuration and logic for formatting money and building financial reports.
  - models/evals/bench/tasks/19-multifile-symbol/project/config.mjs (3) — Exports shared default settings for locale and decimal places.
  - models/evals/bench/tasks/19-multifile-symbol/project/format.mjs (9) — Converts numbers into formatted currency strings with commas.
  - models/evals/bench/tasks/19-multifile-symbol/project/report.mjs (11) — Generates a text summary listing items and their total.
  - models/evals/bench/tasks/19-multifile-symbol/project/report.test.mjs (14) — Verifies formatting and report generation logic works correctly.
  - also: package.json
- models/evals/bench/tasks/19-multifile-symbol/reference/ — Shared defaults for formatting and reports.
  - models/evals/bench/tasks/19-multifile-symbol/reference/config.mjs (3) — Defines shared defaults for formatting and reports.
  - models/evals/bench/tasks/19-multifile-symbol/reference/format.mjs (9) — Formats money amounts with commas, decimals, and symbol.
  - models/evals/bench/tasks/19-multifile-symbol/reference/report.mjs (11) — Builds a text report listing rows and total.
  - models/evals/bench/tasks/19-multifile-symbol/reference/report.test.mjs (19) — Tests formatting and report generation logic.
