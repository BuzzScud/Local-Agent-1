# models/evals/bench/tasks/28-python-multifile/ — Folder for Python multi-file code generation evaluation task number twenty-eight.

Every folder under models/evals/bench/tasks/28-python-multifile/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/bench/tasks/28-python-multifile/ — Folder for Python multi-file code generation evaluation task number twenty-eight.
  - models/evals/bench/tasks/28-python-multifile/check.sh (14) — Script runs tests and validates trade object fee calculations.
  - also: task.txt
- models/evals/bench/tasks/28-python-multifile/project/ — Holds Python task files for evaluating multi-file code generation.
  - models/evals/bench/tasks/28-python-multifile/project/models.py (10) — Defines a Trade data class with symbol, quantity, and price fields.
  - models/evals/bench/tasks/28-python-multifile/project/serialize.py (12) — Converts a Trade object into a dictionary including calculated value.
  - models/evals/bench/tasks/28-python-multifile/project/test_serialize.py (7) — Tests that the serialization function produces the correct output.
- models/evals/bench/tasks/28-python-multifile/reference/ — Reference data classes and serialization logic for trade records.
  - models/evals/bench/tasks/28-python-multifile/reference/models.py (11) — Defines the Trade data class with symbol, quantity, price, and fee fields.
  - models/evals/bench/tasks/28-python-multifile/reference/serialize.py (13) — Converts a Trade object into a dictionary including calculated value.
  - models/evals/bench/tasks/28-python-multifile/reference/test_serialize.py (12) — Tests that serialization produces correct dictionaries and handles fees properly.
