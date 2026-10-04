# models/evals/battle/new28/n07-cli-csv-flag/ — Script to run tests and verify CLI output formats

Every folder under models/evals/battle/new28/n07-cli-csv-flag/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/new28/n07-cli-csv-flag/ — Script to run tests and verify CLI output formats
  - models/evals/battle/new28/n07-cli-csv-flag/check.sh (6) — Runs Node tests and checks CSV and table output correctness
  - also: meta.json, task.txt
- models/evals/battle/new28/n07-cli-csv-flag/project/ — CLI tool for CSV flag battles
  - models/evals/battle/new28/n07-cli-csv-flag/project/cli.mjs (5) — Main entry point that logs a sample table to the console
  - models/evals/battle/new28/n07-cli-csv-flag/project/report.mjs (5) — Exports a function to format data rows as a text table
  - models/evals/battle/new28/n07-cli-csv-flag/project/report.test.mjs (6) — Unit test verifying the table formatting logic works correctly
  - also: package.json
- models/evals/battle/new28/n07-cli-csv-flag/solution/ — CLI tool to display data as CSV or table based on command line flags
  - models/evals/battle/new28/n07-cli-csv-flag/solution/cli.mjs (5) — Main entry point that parses arguments and chooses output format
  - models/evals/battle/new28/n07-cli-csv-flag/solution/report.mjs (10) — Functions to format data rows as text tables or CSV strings
  - models/evals/battle/new28/n07-cli-csv-flag/solution/report.test.mjs (10) — Tests verifying table and CSV formatting functions work correctly
