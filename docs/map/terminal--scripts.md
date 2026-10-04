# terminal/scripts/ — 2 folders: demo/, shims/; 7 files

Every folder under terminal/scripts/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- terminal/scripts/ — 2 folders: demo/, shims/; 7 files
  - terminal/scripts/capture-ui.mjs (63) — Captures the new screens with the real app and the real model (155×43, or COLS/ROWS from the environment): the start-up (restoring the saved warm-up), the "/" …
  - terminal/scripts/codemap.mjs (122) — `bun run codemap [<project folder>]`: writes the project's code map, docs/map/ (tools/codemap.mjs).
  - terminal/scripts/flow-page.mjs (22) — Saves a dated HTML copy of the hub's Flow tab
  - terminal/scripts/pack.mjs (25) — `bun run pack`: builds the pack of Claude's notes (~/.agentic-coder/claude-pack, claude-pack.mjs) from Claude Code's memory folders on this Mac and the copies …
  - terminal/scripts/report.mjs (189) — Generates a full HTML report with scores and limits
  - also: measured.json, ui-walk.mjs
- terminal/scripts/demo/ — 1 folders: run-preview/; 7 files
  - terminal/scripts/demo/build-preview.jsx (43) — Renders all three designs at every half second of the recorded session with the real Ink components (256 colours, 155 columns = your Terminal window) and write…
  - terminal/scripts/demo/live.jsx (70) — Plays recorded session in real terminal with designs
  - terminal/scripts/demo/record.mjs (89) — Runs tool calls and writes timing data to JSON
  - terminal/scripts/demo/script.mjs (84) — Defines scripted demo steps and performance estimates
  - terminal/scripts/demo/spin.jsx (80) — The working icon in its three looks, side by side in your real terminal: the app's own Spinner line, fed one turn whose timing follows Bonsai 2 27B's measured …
  - also: preview.template.html, session.json
- terminal/scripts/demo/run-preview/ — Folder for running a preview demo script
  - terminal/scripts/demo/run-preview/build.jsx (246) — Script to replay a model session and write a design page
  - also: page.html
- terminal/scripts/shims/ — Directory holding shims for terminal scripts
- terminal/scripts/shims/react-devtools-core/ — Stub for React DevTools to avoid errors during development.
  - terminal/scripts/shims/react-devtools-core/index.js (4) — Empty stub providing dummy functions for React DevTools integration.
  - also: package.json
