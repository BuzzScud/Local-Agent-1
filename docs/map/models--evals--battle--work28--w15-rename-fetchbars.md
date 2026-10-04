# models/evals/battle/work28/w15-rename-fetchbars/ — Script verifying fetchBars removal and loadBars usage in project files

Every folder under models/evals/battle/work28/w15-rename-fetchbars/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/work28/w15-rename-fetchbars/ — Script verifying fetchBars removal and loadBars usage in project files
  - models/evals/battle/work28/w15-rename-fetchbars/check.sh (7) — Shell script checking code changes and test results
  - also: meta.json, task.txt
- models/evals/battle/work28/w15-rename-fetchbars/project/ — Project folder for fetching and counting market bars
  - models/evals/battle/work28/w15-rename-fetchbars/project/bank.mjs (7) — Counts how many bars exist for each symbol on a specific day
  - models/evals/battle/work28/w15-rename-fetchbars/project/bank.test.mjs (16) — Tests that bar fetching and counting logic works correctly
  - models/evals/battle/work28/w15-rename-fetchbars/project/bars.mjs (10) — Retrieves one-minute price bars from the local data store
  - models/evals/battle/work28/w15-rename-fetchbars/project/chart.mjs (7) — Extracts closing prices from bars to display on a chart
  - also: package.json
- models/evals/battle/work28/w15-rename-fetchbars/solution/ — Code for fetching and counting daily price bars
  - models/evals/battle/work28/w15-rename-fetchbars/solution/bank.mjs (7) — Counts stored bars per symbol for a given day
  - models/evals/battle/work28/w15-rename-fetchbars/solution/bank.test.mjs (16) — Tests bar loading and counting logic
  - models/evals/battle/work28/w15-rename-fetchbars/solution/bars.mjs (10) — Retrieves 1-minute price bars from a mock store
  - models/evals/battle/work28/w15-rename-fetchbars/solution/chart.mjs (7) — Extracts closing prices from loaded bars for charting
