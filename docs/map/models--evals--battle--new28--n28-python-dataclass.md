# models/evals/battle/new28/n28-python-dataclass/ — Python dataclass battle task setup

Every folder under models/evals/battle/new28/n28-python-dataclass/ with a plain line, its main files with a line each (lines in brackets), the rest by name. Paths are from the project's top. A line can be out of date: the code is right.

- models/evals/battle/new28/n28-python-dataclass/ — Python dataclass battle task setup
  - models/evals/battle/new28/n28-python-dataclass/check.sh (7) — Runs tests and validates code changes
  - also: meta.json, task.txt
- models/evals/battle/new28/n28-python-dataclass/project/ — Holds code for user models and service logic.
  - models/evals/battle/new28/n28-python-dataclass/project/models.py (4) — Creates a dictionary representing an active user with name and email.
  - models/evals/battle/new28/n28-python-dataclass/project/service.py (8) — Provides functions to generate a greeting string and deactivate a user.
  - models/evals/battle/new28/n28-python-dataclass/project/test_service.py (17) — Contains unit tests verifying the greeting and deactivation behaviors.
- models/evals/battle/new28/n28-python-dataclass/solution/ — Holds data structures and service logic for the new28 battle solution.
  - models/evals/battle/new28/n28-python-dataclass/solution/models.py (14) — Defines a User data class and a factory function to create active users.
  - models/evals/battle/new28/n28-python-dataclass/solution/service.py (8) — Provides functions to generate user greetings and deactivate user accounts.
