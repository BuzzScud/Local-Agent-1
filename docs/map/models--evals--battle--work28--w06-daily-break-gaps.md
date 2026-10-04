# models/evals/battle/work28/w06-daily-break-gaps/ — Tests verifying gap detection logic ignores daily market breaks

Every folder under models/evals/battle/work28/w06-daily-break-gaps/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/work28/w06-daily-break-gaps/ — Tests verifying gap detection logic ignores daily market breaks
  - models/evals/battle/work28/w06-daily-break-gaps/check.sh (15) — Runs tests and validates the gap finding function handles daily breaks correctly
  - also: meta.json, task.txt
- models/evals/battle/work28/w06-daily-break-gaps/project/ — Folder for finding gaps in daily time series data
  - models/evals/battle/work28/w06-daily-break-gaps/project/gaps.mjs (14) — Exports function to detect missing minutes between ordered timestamps
  - models/evals/battle/work28/w06-daily-break-gaps/project/gaps.test.mjs (10) — Tests the gap detection logic with sample timestamp arrays
  - also: package.json
- models/evals/battle/work28/w06-daily-break-gaps/solution/ — Code to find missing minute intervals in market data while ignoring the daily break.
  - models/evals/battle/work28/w06-daily-break-gaps/solution/gaps.mjs (20) — Exports a function that identifies gaps between time bars, excluding those within the 21:00 UTC daily break.
  - models/evals/battle/work28/w06-daily-break-gaps/solution/gaps.test.mjs (14) — Tests the gap-finding logic to ensure it detects missing minutes and ignores the daily break period.
