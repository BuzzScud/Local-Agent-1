# Code map · agentic-coder

One line per top folder: what it holds, then the part that lists every folder in it with its main files. Open a part with Map {"part": "<name>"} or Read docs/map/<name>.md, then the file itself. Made by `bun run codemap` on 2026-10-03; a line can be out of date, the code is right. A line ending in ✓ was checked by hand against the code.

- docs/ — Every page about Agentic Coder (diagrams, reports, test results, design rounds, Gemma pages) and this code map ✓ → docs.md
- models/ — Part 2: the models (each one's settings, the registry), the runtime that runs them, and the test bench (evals) with its tests ✓ → models.md
- terminal/ — Part 1: the coding agent you talk to: the app, the agent loop, its tools and prompt files (rules/), scripts and tests ✓ → terminal.md
- the files at the top (AGENTS-DETAILS.md, AGENTS.md, CLAUDE.md, install.sh, README.md) → top.md
