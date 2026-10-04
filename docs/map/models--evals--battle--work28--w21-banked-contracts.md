# models/evals/battle/work28/w21-banked-contracts/ — Script to verify the model's answer contains specific codes and a duration.

Every folder under models/evals/battle/work28/w21-banked-contracts/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/work28/w21-banked-contracts/ — Script to verify the model's answer contains specific codes and a duration.
  - models/evals/battle/work28/w21-banked-contracts/check.sh (5) — Shell script that checks if the answer file includes required codes and '45 days'.
  - also: meta.json, task.txt
- models/evals/battle/work28/w21-banked-contracts/project/ — Root config for the project
  - also: package.json
- models/evals/battle/work28/w21-banked-contracts/project/bank/ — Nightly bank job saving contract bars and cleaning old data
  - models/evals/battle/work28/w21-banked-contracts/project/bank/config.mjs (4) — Lists contracts to save and retention period in days
  - models/evals/battle/work28/w21-banked-contracts/project/bank/run.mjs (8) — Main script executing nightly save and cleanup tasks
  - models/evals/battle/work28/w21-banked-contracts/project/bank/store.mjs (4) — Functions to store daily bars and remove expired records
- models/evals/battle/work28/w21-banked-contracts/project/old/ — Old unused bank configuration holding symbol and day constants ✓
  - models/evals/battle/work28/w21-banked-contracts/project/old/config.mjs (3) — Exports market symbols and duration days for the legacy bank setup
  - models/evals/battle/work28/w21-banked-contracts/project/old/README.md (2) — States this is the obsolete first bank version no longer in use
- models/evals/battle/work28/w21-banked-contracts/solution/ — Banked contract solution details
  - also: answer.txt
