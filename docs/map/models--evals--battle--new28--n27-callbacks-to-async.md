# models/evals/battle/new28/n27-callbacks-to-async/ — Tests and metadata for converting callbacks to async promises

Every folder under models/evals/battle/new28/n27-callbacks-to-async/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/new28/n27-callbacks-to-async/ — Tests and metadata for converting callbacks to async promises
  - models/evals/battle/new28/n27-callbacks-to-async/check.sh (6) — Runs tests and verifies no callback code remains in source files
  - also: meta.json, task.txt
- models/evals/battle/new28/n27-callbacks-to-async/project/ — Folder for testing callback to async conversion
  - models/evals/battle/new28/n27-callbacks-to-async/project/config.mjs (10) — Reads config file and passes result via callback
  - models/evals/battle/new28/n27-callbacks-to-async/project/main.mjs (7) — Loads a user by ID and logs their name
  - models/evals/battle/new28/n27-callbacks-to-async/project/users.mjs (10) — Finds a user in config using an ID
  - models/evals/battle/new28/n27-callbacks-to-async/project/users.test.mjs (8) — Tests finding a user by ID
  - also: config.json, package.json
- models/evals/battle/new28/n27-callbacks-to-async/solution/ — Async solution for converting callbacks to promises
  - models/evals/battle/new28/n27-callbacks-to-async/solution/config.mjs (7) — Loads and parses the JSON configuration file
  - models/evals/battle/new28/n27-callbacks-to-async/solution/main.mjs (5) — Runs the app by loading and printing a user name
  - models/evals/battle/new28/n27-callbacks-to-async/solution/users.mjs (8) — Fetches a user record from config by ID
  - models/evals/battle/new28/n27-callbacks-to-async/solution/users.test.mjs (9) — Tests finding a specific user by ID
