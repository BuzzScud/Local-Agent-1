# models/evals/bench/tasks/20-multifile-signature/ — Tests multifile signature logic with cart and invoice

Every folder under models/evals/bench/tasks/20-multifile-signature/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/20-multifile-signature/ — Tests multifile signature logic with cart and invoice
  - models/evals/bench/tasks/20-multifile-signature/check.sh (15) — Runs tests to verify discount, cart, and invoice calculations
  - also: task.txt
- models/evals/bench/tasks/20-multifile-signature/project/ — Folder for multifile signature task with cart and invoice logic
  - models/evals/bench/tasks/20-multifile-signature/project/cart.mjs (6) — Calculates total price of items in the shopping cart
  - models/evals/bench/tasks/20-multifile-signature/project/invoice.mjs (6) — Formats a single line item for an invoice display
  - models/evals/bench/tasks/20-multifile-signature/project/price.mjs (5) — Computes the final price after applying a discount percentage
  - models/evals/bench/tasks/20-multifile-signature/project/price.test.mjs (18) — Verifies discount calculation and cart total logic correctness
  - also: package.json
- models/evals/bench/tasks/20-multifile-signature/reference/ — Reference code for multi-file signature task with cart, invoice, and pricing logic
  - models/evals/bench/tasks/20-multifile-signature/reference/cart.mjs (6) — Calculates total price of items in a shopping cart with optional discount percentage
  - models/evals/bench/tasks/20-multifile-signature/reference/invoice.mjs (6) — Formats a single line item for an invoice showing name and discounted price
  - models/evals/bench/tasks/20-multifile-signature/reference/price.mjs (6) — Applies a percentage discount to a price, capped by a maximum limit
  - models/evals/bench/tasks/20-multifile-signature/reference/price.test.mjs (25) — Tests discount calculation, cart totals, and invoice formatting with cap limits
