# models/evals/battle/new28/n17-bigproject-config/ — Config for a large project battle setup

Every folder under models/evals/battle/new28/n17-bigproject-config/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/new28/n17-bigproject-config/ — Config for a large project battle setup
  - models/evals/battle/new28/n17-bigproject-config/check.sh (5) — Script verifying answer contains loadSettings and listenPort
  - also: meta.json, task.txt
- models/evals/battle/new28/n17-bigproject-config/project/ — Holds configuration files for a large project setup
  - models/evals/battle/new28/n17-bigproject-config/project/README.md (4) — Describes the small shop backend app
  - also: package.json, settings.json
- models/evals/battle/new28/n17-bigproject-config/project/src/ — Source code for a large project with boot, features, and web parts
- models/evals/battle/new28/n17-bigproject-config/project/src/boot/ — Boot scripts to initialize the application environment and start the server.
  - models/evals/battle/new28/n17-bigproject-config/project/src/boot/loadSettings.mjs (7) — Reads and exports configuration data from the project's settings file.
  - models/evals/battle/new28/n17-bigproject-config/project/src/boot/start.mjs (6) — Loads settings and launches the application server on the specified port.
- models/evals/battle/new28/n17-bigproject-config/project/src/features/ — Holds feature modules for billing, emails, invoices, orders, and reports.
  - models/evals/battle/new28/n17-bigproject-config/project/src/features/billing.mjs (5) — Defines the billing routes handler.
  - models/evals/battle/new28/n17-bigproject-config/project/src/features/emails.mjs (5) — Defines the email routes handler.
  - models/evals/battle/new28/n17-bigproject-config/project/src/features/invoices.mjs (5) — Defines the invoice routes handler.
  - models/evals/battle/new28/n17-bigproject-config/project/src/features/orders.mjs (5) — Defines the order routes handler.
  - models/evals/battle/new28/n17-bigproject-config/project/src/features/reports.mjs (5) — Defines the report routes handler.
  - also: search.mjs, users.mjs
- models/evals/battle/new28/n17-bigproject-config/project/src/web/ — Web app source code directory
  - models/evals/battle/new28/n17-bigproject-config/project/src/web/app.mjs (6) — Creates a tiny web app with path-based routing and listening capabilities
- models/evals/battle/new28/n17-bigproject-config/solution/ — Directory holding the solution configuration for the new big project battle
  - also: answer.txt
