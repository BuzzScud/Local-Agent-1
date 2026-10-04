# terminal/scripts/ — Scripts: UI screen captures and reports, the pack of Claude's notes (pack.mjs) and the code map (codemap.mjs) ✓

Every folder under terminal/scripts/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- terminal/scripts/ — Scripts: UI screen captures and reports, the pack of Claude's notes (pack.mjs) and the code map (codemap.mjs) ✓
  - terminal/scripts/capture-ui.mjs (63) — Captures real app screens with the model and saves them for reporting
  - terminal/scripts/flow-page.mjs (22) — Saves a dated HTML copy of the hub's Flow tab
  - terminal/scripts/report-ui.mjs (184) — Builds an HTML report showing captured UI moments
  - terminal/scripts/report.mjs (189) — Generates a full HTML report with scores and limits
  - terminal/scripts/ui-walk.mjs (230) — Walks through every app screen, capturing and checking each one
  - also: capture.mjs, codemap.mjs, measured.json, pack.mjs, ui-report.mjs
- terminal/scripts/demo/ — Scripts for running and recording terminal demo sessions
  - terminal/scripts/demo/live.jsx (70) — Plays recorded session in real terminal with designs
  - terminal/scripts/demo/record.mjs (89) — Runs tool calls and writes timing data to JSON
  - terminal/scripts/demo/script.mjs (84) — Defines scripted demo steps and performance estimates
  - terminal/scripts/demo/spin-preview.jsx (367) — Renders spinner design frames in 256 colors
  - terminal/scripts/demo/spin.jsx (80) — Shows spinner animation in three styles side by side
  - also: build-preview.jsx, preview.template.html, session.json
- terminal/scripts/demo/run-preview/ — Folder for running a preview demo script
  - terminal/scripts/demo/run-preview/build.jsx (246) — Script to replay a model session and write a design page
  - also: page.html
- terminal/scripts/shims/ — Directory holding shims for terminal scripts
- terminal/scripts/shims/react-devtools-core/ — Stub for React DevTools to avoid errors during development.
  - terminal/scripts/shims/react-devtools-core/index.js (4) — Empty stub providing dummy functions for React DevTools integration.
  - also: package.json
