# terminal/test/ — Tests for the terminal application's core features and agent logic.

Every folder under terminal/test/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- terminal/test/ — Tests for the terminal application's core features and agent logic.
  - terminal/test/agents.test.mjs (134) — Tests subagent helpers that delegate work to other agents with fresh conversations.
  - terminal/test/app-remote.test.mjs (650) — Tests the remote model connection form and key management in the pseudo-terminal.
  - terminal/test/app-settings.test.mjs (170) — Tests the settings menu commands and coding hub tab completion logic.
  - terminal/test/app-test-run.test.mjs (84) — Tests running tests from the hub tab and managing window memory during runs.
  - terminal/test/app.test.mjs (162) — Tests end-to-end terminal interaction, screen turns, and menu navigation with a fake model.
  - also: agent-files.test.mjs, agent.test.mjs, agents-guards.test.mjs, agents-headless.test.mjs, agents-md.test.mjs, agents-run.test.mjs, agents-tree.test.mjs, app-agents-run.test.mjs, app-agents.test.mjs, app-battle.test.mjs, app-btw-remote.test.mjs, app-btw.test.mjs, app-clear.test.mjs, app-effort.test.mj… (157 files)
- terminal/test/fixture-fix/ — Folder with small statistics helpers for trade prices.
  - terminal/test/fixture-fix/stats.mjs (16) — Exports mean, median, and range functions for calculating price statistics.
  - terminal/test/fixture-fix/stats.test.mjs (9) — Tests the mean, median, and range helper functions.
- terminal/test/fixture-page/ — Holds test fixtures for the page component
  - also: index.html, package.json, style.css
- terminal/test/fixture-rename/ — Test fixtures for renaming logic
  - terminal/test/fixture-rename/cart.mjs (7) — Generates a summary string from cart data
  - terminal/test/fixture-rename/cart.test.mjs (8) — Tests the cart summary function output
  - terminal/test/fixture-rename/price.mjs (7) — Calculates total order price with tax
