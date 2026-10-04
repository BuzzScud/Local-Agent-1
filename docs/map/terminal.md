# terminal/ — Part 1: the coding agent you talk to: the app, the agent loop, its tools and prompt files (rules/), scripts and tests ✓

Every folder under terminal/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- terminal/ — Part 1: the coding agent you talk to: the app, the agent loop, its tools and prompt files (rules/), scripts and tests ✓
  - terminal/index.mjs (65) — Part 1 of Agentic Coder: the terminal.
  - terminal/README.md (236) — Part 1 · The terminal The coding agent you talk to.
- terminal/app/ — Mac app assets and build scripts for the Agentic Coder desktop application
  - terminal/app/agentic-coder-launcher.sh (78) — The `coding` command.
  - terminal/app/make-app.sh (28) — Zsh script that compiles the AppleScript and bundles resources into a clickable macOS application folder
  - terminal/app/render-icon.mjs (31) — Node.js script using Playwright to convert the SVG icon source into PNG and ICNS formats
  - also: agentic-coder.applescript, icon-1024.png, icon.icns, icon.svg
- terminal/demo-project/ — Demo project for exporting trade data
  - terminal/demo-project/export.mjs (20) — Converts a JSON trades file into CSV format
  - terminal/demo-project/export.test.mjs (17) — Tests the CSV conversion and file reading logic
  - also: trades.json
- terminal/rules/ — Rules folder for coding agent behavior and skills → terminal--rules.md
- terminal/scripts/ — 2 folders: demo/, shims/; 7 files → terminal--scripts.md
- terminal/src/ — The app's code: agent/ (the loop, prompt, memory, Claude's notes, maps), app/ (screen, commands, hub), tools/, flows/, ui/ ✓ → terminal--src.md
- terminal/test/ — 3 folders: fixture-fix/, fixture-page/, fixture-rename/; 166 files → terminal--test.md
