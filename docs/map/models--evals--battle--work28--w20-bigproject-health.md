# models/evals/battle/work28/w20-bigproject-health/ — Folder for a big project health battle evaluation task

Every folder under models/evals/battle/work28/w20-bigproject-health/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/work28/w20-bigproject-health/ — Folder for a big project health battle evaluation task
  - models/evals/battle/work28/w20-bigproject-health/check.sh (7) — Script verifying answer contains status, ok, build, and uptime references
  - also: meta.json, task.txt
- models/evals/battle/work28/w20-bigproject-health/project/ — Trading desk API project configuration and documentation
  - models/evals/battle/work28/w20-bigproject-health/project/README.md (5) — Explains the API purpose and deployment commands
  - also: package.json
- models/evals/battle/work28/w20-bigproject-health/project/scripts/ — Script for deploying the project by pulling code and restarting services.
  - models/evals/battle/work28/w20-bigproject-health/project/scripts/deploy.sh (6) — Shell script that pulls updates, installs dependencies, restarts the API, and checks health.
- models/evals/battle/work28/w20-bigproject-health/project/src/ — Main entry point for the application server.
  - models/evals/battle/work28/w20-bigproject-health/project/src/config.mjs (4) — Sets environment variables for port, build ID, and database file path.
  - models/evals/battle/work28/w20-bigproject-health/project/src/server.mjs (12) — Starts the HTTP server to handle incoming requests.
- models/evals/battle/work28/w20-bigproject-health/project/src/lib/ — Shared utilities for authentication, database, logging, and timing.
  - models/evals/battle/work28/w20-bigproject-health/project/src/lib/auth.mjs (3) — Checks if a user is signed in via session cookie presence.
  - models/evals/battle/work28/w20-bigproject-health/project/src/lib/db.mjs (7) — Provides a simple in-memory store for tables and rows.
  - models/evals/battle/work28/w20-bigproject-health/project/src/lib/health-old.mjs (3) — Deprecated health check endpoint kept for historical reference.
  - models/evals/battle/work28/w20-bigproject-health/project/src/lib/log.mjs (2) — Formats and prints timestamped messages to the console.
  - models/evals/battle/work28/w20-bigproject-health/project/src/lib/time.mjs (2) — Records the application startup time as a constant.
- models/evals/battle/work28/w20-bigproject-health/project/src/routes/ — Holds API route handlers for bars, users, invites, and health checks.
  - models/evals/battle/work28/w20-bigproject-health/project/src/routes/bars.mjs (5) — Lists all bars and saves new ones to the database.
  - models/evals/battle/work28/w20-bigproject-health/project/src/routes/index.mjs (22) — Maps HTTP methods and paths to their corresponding handler functions.
  - models/evals/battle/work28/w20-bigproject-health/project/src/routes/invites.mjs (4) — Creates a new invite record with a default member role.
  - models/evals/battle/work28/w20-bigproject-health/project/src/routes/status.mjs (8) — Returns server health status, build ID, and uptime duration.
  - models/evals/battle/work28/w20-bigproject-health/project/src/routes/users.mjs (4) — Retrieves all users returning only their name and role.
- models/evals/battle/work28/w20-bigproject-health/project/test/ — Tests for the health check endpoint ✓
  - models/evals/battle/work28/w20-bigproject-health/project/test/routes.test.mjs (9) — Verifies the health route responds with status 200 without authentication
- models/evals/battle/work28/w20-bigproject-health/solution/ — Directory holding the solution for the big project health battle
  - also: answer.txt
