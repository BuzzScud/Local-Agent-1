# models/evals/battle/work28/w13-viewer-role/ — Viewer role battle evaluation workspace for project and solution

Every folder under models/evals/battle/work28/w13-viewer-role/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/work28/w13-viewer-role/ — Viewer role battle evaluation workspace for project and solution
  - models/evals/battle/work28/w13-viewer-role/check.sh (14) — Runs tests and verifies viewer role logic in routes and invites
  - also: meta.json, task.txt
- models/evals/battle/work28/w13-viewer-role/project/ — Viewer role project with invite and route logic
  - models/evals/battle/work28/w13-viewer-role/project/invite.mjs (8) — Creates user invites with a specific role and unique code
  - models/evals/battle/work28/w13-viewer-role/project/roles.mjs (10) — Defines roles and checks if a user can perform an action ✓
  - models/evals/battle/work28/w13-viewer-role/project/routes.mjs (15) — Maps API endpoints to required permissions for access control
  - models/evals/battle/work28/w13-viewer-role/project/routes.test.mjs (11) — Tests that members can read and write but not access admin routes
  - also: package.json
- models/evals/battle/work28/w13-viewer-role/solution/ — Viewer role solution for the battle evaluation
  - models/evals/battle/work28/w13-viewer-role/solution/invite.mjs (8) — Creates an invite object with a random code and assigned role
  - models/evals/battle/work28/w13-viewer-role/solution/roles.mjs (11) — Defines user roles and checks if a user can perform an action
  - models/evals/battle/work28/w13-viewer-role/solution/routes.test.mjs (17) — Tests access permissions for members and viewers on API routes
