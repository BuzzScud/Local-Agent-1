# models/evals/battle/new28/n26-split-module/ — Folder for splitting module logic into separate files.

Every folder under models/evals/battle/new28/n26-split-module/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/new28/n26-split-module/ — Folder for splitting module logic into separate files.
  - models/evals/battle/new28/n26-split-module/check.sh (7) — Script verifying utils removal, test success, helper placement, and app output.
  - also: meta.json, task.txt
- models/evals/battle/new28/n26-split-module/project/ — Holds a small project with utility functions and their tests.
  - models/evals/battle/new28/n26-split-module/project/app.mjs (4) — Runs the script to demonstrate text and number helpers.
  - models/evals/battle/new28/n26-split-module/project/utils.mjs (8) — Exports helper functions for string and number manipulation.
  - models/evals/battle/new28/n26-split-module/project/utils.test.mjs (7) — Tests the utility functions for correctness.
  - also: package.json
- models/evals/battle/new28/n26-split-module/solution/ — Holds solution code for splitting module logic into separate files.
  - models/evals/battle/new28/n26-split-module/solution/app.mjs (5) — Main entry point that logs results from string and number utilities.
  - models/evals/battle/new28/n26-split-module/solution/numbers.mjs (4) — Exports helper functions for clamping values and rounding numbers.
  - models/evals/battle/new28/n26-split-module/solution/strings.mjs (4) — Exports helper functions for creating slugs and title-casing text.
  - models/evals/battle/new28/n26-split-module/solution/utils.test.mjs (8) — Tests string slugification, title casing, number clamping, and rounding.
