# terminal/ — Part 1: the coding agent you talk to: the app, the agent loop, its tools and prompt files (rules/), scripts and tests ✓

Every folder under terminal/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- terminal/ — Part 1: the coding agent you talk to: the app, the agent loop, its tools and prompt files (rules/), scripts and tests ✓
  - terminal/index.mjs (62) — Main module exporting the agent, client, flows, memory, and context helpers for the models part
  - terminal/README.md (236) — Documentation describing the terminal's role as the user-facing coding agent interface ✓
- terminal/app/ — Mac app assets and build scripts for the Agentic Coder desktop application
  - terminal/app/agentic-coder-launcher.sh (79) — Shell script that checks for code changes, rebuilds the app if needed, and launches it as the 'coding' command
  - terminal/app/make-app.sh (28) — Zsh script that compiles the AppleScript and bundles resources into a clickable macOS application folder
  - terminal/app/render-icon.mjs (31) — Node.js script using Playwright to convert the SVG icon source into PNG and ICNS formats
  - also: agentic-coder.applescript, icon-1024.png, icon.icns, icon.svg
- terminal/demo-project/ — Demo project for exporting trade data
  - terminal/demo-project/export.mjs (20) — Converts a JSON trades file into CSV format
  - terminal/demo-project/export.test.mjs (17) — Tests the CSV conversion and file reading logic
  - also: trades.json
- terminal/rules/ — Rules folder for coding agent behavior and skills
  - terminal/rules/bug-fixing.md (225) — Guide for categorizing bugs and applying fix steps based on test visibility
  - terminal/rules/SKILLS.md (36) — List of named skills with trigger words and execution steps for the agent
  - terminal/rules/TOOLS.md (21) — Instructions for tool usage commands included in every conversation start
- terminal/rules/remote/ — Rules for remote coding agents to work safely and effectively
  - terminal/rules/remote/ANSWERS.md (22) — Guides how to report results clearly and concisely
  - terminal/rules/remote/HARNESS.md (43) — Core identity and operational rules for remote models
  - terminal/rules/remote/SUBAGENTS.md (14) — Rules for delegating work to helper agents
  - terminal/rules/remote/TESTING.md (23) — Strategies for validating changes and running tests
  - terminal/rules/remote/TOOLS.md (19) — Instructions for using search, read, and list tools
  - also: BUG-FIXING.md, CONTEXT.md, DEBUGGING.md, DESIGN.md, GIT.md, MEMORY.md, PERMISSIONS.md, PLANNING.md, RECOVERY.md, REVIEW.md, SECURITY.md, SKILLS.md
- terminal/scripts/ — Scripts: UI screen captures and reports, the pack of Claude's notes (pack.mjs) and the code map (codemap.mjs) ✓ → terminal--scripts.md
- terminal/src/ — The app's code: agent/ (the loop, prompt, memory, Claude's notes, maps), app/ (screen, commands, hub), tools/, flows/, ui/ ✓ → terminal--src.md
- terminal/test/ — Tests for the terminal application's core features and agent logic. → terminal--test.md
