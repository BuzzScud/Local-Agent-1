# models/evals/battle/work28/w11-python-bad-rows/ — Folder for solution code handling bad CSV rows in a battle evaluation

Every folder under models/evals/battle/work28/w11-python-bad-rows/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/work28/w11-python-bad-rows/ — Folder for solution code handling bad CSV rows in a battle evaluation
  - models/evals/battle/work28/w11-python-bad-rows/check.sh (20) — Runs tests and checks that load_bars handles bad financial data correctly. ✓
  - also: meta.json, task.txt
- models/evals/battle/work28/w11-python-bad-rows/project/ — Holds scripts for loading financial bar data and reporting results.
  - models/evals/battle/work28/w11-python-bad-rows/project/loader.py (18) — Reads a CSV file containing OHLCV market data into a list of dictionaries.
  - models/evals/battle/work28/w11-python-bad-rows/project/report.py (16) — Loads the data and prints the count and time range of the bars.
  - models/evals/battle/work28/w11-python-bad-rows/project/test_loader.py (26) — Tests the loader by creating temporary CSV files and verifying the parsed output.
- models/evals/battle/work28/w11-python-bad-rows/solution/ — Folder for solution code handling bad CSV rows in a battle evaluation
  - models/evals/battle/work28/w11-python-bad-rows/solution/loader.py (26) — Reads CSV bar data, returns valid rows and count of skipped bad entries
  - models/evals/battle/work28/w11-python-bad-rows/solution/report.py (18) — Main script printing summary of loaded bars and skipped row counts
  - models/evals/battle/work28/w11-python-bad-rows/solution/test_loader.py (32) — Unit tests verifying bar loading logic and bad row skipping behavior
