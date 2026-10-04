# models/evals/bench/tasks/26-bigproject-change/ — Task twenty-six big project change evaluation setup

Every folder under models/evals/bench/tasks/26-bigproject-change/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right. A folder with an arrow has a part of its own.

- models/evals/bench/tasks/26-bigproject-change/ — Task twenty-six big project change evaluation setup
  - models/evals/bench/tasks/26-bigproject-change/check.sh (14) — Script verifying test count and file listing behavior
  - also: task.txt
- models/evals/bench/tasks/26-bigproject-change/project/ — Root of the big project containing configuration, source, and tests → models--evals--bench--tasks--26-bigproject-change--project.md
- models/evals/bench/tasks/26-bigproject-change/reference/ — Reference data for the twenty-sixth big project change benchmark task
- models/evals/bench/tasks/26-bigproject-change/reference/src/ — Source code for the reference implementation of the big project change task
- models/evals/bench/tasks/26-bigproject-change/reference/src/tools/ — Folder holding file system utility functions for the project.
  - models/evals/bench/tasks/26-bigproject-change/reference/src/tools/fs.mjs (110) — Exports helpers to list and search files while skipping bulky folders.
- models/evals/bench/tasks/26-bigproject-change/reference/test/ — Tests for file system operations in the big project benchmark
  - models/evals/bench/tasks/26-bigproject-change/reference/test/fs.test.mjs (29) — Verifies glob patterns and file listing filters like node_modules
