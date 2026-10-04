# models/evals/battle/new28/n25-rename-4-files/ — Folder for renaming task evaluation with checks and metadata

Every folder under models/evals/battle/new28/n25-rename-4-files/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/new28/n25-rename-4-files/ — Folder for renaming task evaluation with checks and metadata
  - models/evals/battle/new28/n25-rename-4-files/check.sh (6) — Script verifying tests pass and function names are updated correctly ✓
  - also: meta.json, task.txt
- models/evals/battle/new28/n25-rename-4-files/project/ — Holds invoice calculation, money logic, tests, and reporting utilities. ✓
  - models/evals/battle/new28/n25-rename-4-files/project/invoice.mjs (4) — Calculates the final invoice total including shipping costs.
  - models/evals/battle/new28/n25-rename-4-files/project/money.mjs (5) — Sums line item prices multiplied by their quantities.
  - models/evals/battle/new28/n25-rename-4-files/project/money.test.mjs (8) — Tests the total calculation and invoice logic functions.
  - models/evals/battle/new28/n25-rename-4-files/project/report.mjs (5) — Generates a list of totals for each order.
  - also: package.json
- models/evals/battle/new28/n25-rename-4-files/solution/ — Folder holding solution files for a renaming task.
  - models/evals/battle/new28/n25-rename-4-files/solution/invoice.mjs (4) — Exports invoiceTotal to sum line costs plus shipping.
  - models/evals/battle/new28/n25-rename-4-files/solution/money.mjs (5) — Exports computeTotal to sum price times quantity for lines.
  - models/evals/battle/new28/n25-rename-4-files/solution/money.test.mjs (8) — Tests computeTotal and invoiceTotal with simple assertions.
  - models/evals/battle/new28/n25-rename-4-files/solution/report.mjs (5) — Exports orderTotals to map computeTotal over orders.
