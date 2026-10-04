# models/evals/bench/tasks/ — Directory holding various evaluation tasks for code benchmarks (5 of 5)

Every folder under models/evals/bench/tasks/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- models/evals/bench/tasks/6-question-page-size/project/ — Paginated product listing task configuration
  - also: package.json
- models/evals/bench/tasks/6-question-page-size/project/src/ — Holds source code for a paginated product listing task.
  - models/evals/bench/tasks/6-question-page-size/project/src/catalog.mjs (6) — Exports a function to list products by delegating to the paginator.
  - models/evals/bench/tasks/6-question-page-size/project/src/paginate.mjs (8) — Splits item lists into pages with configurable size and default settings.
- models/evals/bench/tasks/6-question-page-size/reference/ — Reference data for the six-question page size benchmark task
  - also: answer.txt
- models/evals/bench/tasks/7-question-tax/ — Folder for a seven-question tax benchmark task.
  - models/evals/bench/tasks/7-question-tax/check.sh (5) — Script verifying the answer file contains the correct tax rate and no extra changes.
  - also: task.txt
- models/evals/bench/tasks/7-question-tax/project/ — Holds files for a tax calculation exercise project.
  - models/evals/bench/tasks/7-question-tax/project/billing.mjs (13) — Exports functions to calculate order subtotal, tax, and discounts.
  - models/evals/bench/tasks/7-question-tax/project/checkout.mjs (6) — Exports a function to compute the final total price.
  - also: package.json
- models/evals/bench/tasks/7-question-tax/reference/ — Holds reference data for the seven-question tax benchmark task.
  - also: answer.txt
- models/evals/bench/tasks/8-rename-method/ — Task to rename a method and verify the change
  - models/evals/bench/tasks/8-rename-method/check.sh (5) — Script verifying the old name is gone and new tests pass
  - also: task.txt
- models/evals/bench/tasks/8-rename-method/project/ — Task folder for renaming a method in the project
  - models/evals/bench/tasks/8-rename-method/project/cart.mjs (6) — Class holding shopping items and calculating the total price
  - models/evals/bench/tasks/8-rename-method/project/cart.test.mjs (8) — Tests checking cart totals and receipt formatting
  - models/evals/bench/tasks/8-rename-method/project/receipt.mjs (4) — Function generating a text summary of the cart contents
  - also: package.json
- models/evals/bench/tasks/8-rename-method/reference/ — Reference data for renaming method tasks
  - models/evals/bench/tasks/8-rename-method/reference/cart.mjs (6) — Class defining shopping cart logic and totals
  - models/evals/bench/tasks/8-rename-method/reference/cart.test.mjs (8) — Tests verifying cart calculation and receipt output
  - models/evals/bench/tasks/8-rename-method/reference/receipt.mjs (4) — Function generating formatted text from cart items
- models/evals/bench/tasks/9-rename-constant/ — Task to rename a constant in the benchmark project → models--evals--bench--tasks--9-rename-constant.md
