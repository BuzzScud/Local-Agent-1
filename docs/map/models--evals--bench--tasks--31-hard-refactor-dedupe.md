# models/evals/bench/tasks/31-hard-refactor-dedupe/ — Folder for hard refactor dedupe task

Every folder under models/evals/bench/tasks/31-hard-refactor-dedupe/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/31-hard-refactor-dedupe/ — Folder for hard refactor dedupe task
  - models/evals/bench/tasks/31-hard-refactor-dedupe/check.sh (19) — Script verifying test success and validation logic placement
  - also: task.txt
- models/evals/bench/tasks/31-hard-refactor-dedupe/project/ — Tests for user creation, order placement, and invoice sending logic
  - models/evals/bench/tasks/31-hard-refactor-dedupe/project/handlers.test.mjs (18) — Unit tests verifying email validation and data transformation in handlers ✓
  - also: package.json
- models/evals/bench/tasks/31-hard-refactor-dedupe/project/handlers/ — Folder holding handler functions for invoices, orders, and users
  - models/evals/bench/tasks/31-hard-refactor-dedupe/project/handlers/invoice.mjs (11) — Function to validate email format and amount before sending an invoice
  - models/evals/bench/tasks/31-hard-refactor-dedupe/project/handlers/order.mjs (9) — Function to check for items and valid email when placing an order
  - models/evals/bench/tasks/31-hard-refactor-dedupe/project/handlers/user.mjs (9) — Function to verify name presence and email validity during user creation
- models/evals/bench/tasks/31-hard-refactor-dedupe/reference/ — Shared email validation logic for reference handlers
  - models/evals/bench/tasks/31-hard-refactor-dedupe/reference/validate.mjs (9) — Exports function checking if an email address is valid or returns error object
- models/evals/bench/tasks/31-hard-refactor-dedupe/reference/handlers/ — Folder for reference handler implementations
  - models/evals/bench/tasks/31-hard-refactor-dedupe/reference/handlers/invoice.mjs (11) — Sends invoices with trimmed, lowercase email validation
  - models/evals/bench/tasks/31-hard-refactor-dedupe/reference/handlers/order.mjs (9) — Places orders checking for items and valid email ✓
  - models/evals/bench/tasks/31-hard-refactor-dedupe/reference/handlers/user.mjs (9) — Creates users requiring a name and valid email
