# models/evals/bench/tasks/37-hard-two-bugs/ — Task with two bugs in invoice calculation logic

Every folder under models/evals/bench/tasks/37-hard-two-bugs/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/37-hard-two-bugs/ — Task with two bugs in invoice calculation logic
  - models/evals/bench/tasks/37-hard-two-bugs/check.sh (15) — Runs tests to verify invoice and money functions work correctly
  - also: task.txt
- models/evals/bench/tasks/37-hard-two-bugs/project/ — Folder for a task with two bugs in invoice calculation logic
  - models/evals/bench/tasks/37-hard-two-bugs/project/invoice.mjs (8) — Calculates the total invoice amount including tax, rounded to two decimals
  - models/evals/bench/tasks/37-hard-two-bugs/project/invoice.test.mjs (12) — Tests that empty invoices return zero and rounding works correctly
  - models/evals/bench/tasks/37-hard-two-bugs/project/lines.mjs (7) — Sums the product of quantity and price for each line item
  - models/evals/bench/tasks/37-hard-two-bugs/project/money.mjs (5) — Rounds a number to two decimal places by truncating
  - also: package.json
- models/evals/bench/tasks/37-hard-two-bugs/reference/ — Reference data for hard task with two bugs
  - models/evals/bench/tasks/37-hard-two-bugs/reference/lines.mjs (7) — Sums quantity times price across invoice lines
  - models/evals/bench/tasks/37-hard-two-bugs/reference/money.mjs (5) — Rounds numbers to two decimal places using half-up rule
