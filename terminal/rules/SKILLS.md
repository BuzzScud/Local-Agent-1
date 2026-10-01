# Skills

Agentic Coder follows this file. It is the only copy: change it here, or in the hub
(Instructions → 08 SKILLS.md), and Agentic Coder changes on your next message.

- Each skill is a `## Name` section: a `- Words:` line (the words or phrases that bring it,
  split by commas), an `- About:` line (one line, shown in the list), an optional `- Fence:`
  line (`read`, `check`, `scratch`, split by commas), then its steps.
- When a request uses a skill's Words, its steps go with that request on both ways (App and
  Model), and on App the work goes step by step with them instead of the focused fix and
  change paths. The skill with the most matching words wins; a phrase counts twice.
- The fence is what the loop enforces, not a sentence in the steps. `read` refuses Edit and
  Write. `check` requires one command before the turn may end as done. `scratch` puts the
  message's edits back when its check fails (the free loop does this either way).
- Every skill is also listed in the instructions by name and About, so the model can open one
  the words missed. The path is SKILLS/<name>, or Rules/SKILLS/<name> when this project has a
  SKILLS folder of its own, so the read cannot land in that folder.
- Keep each skill short: its steps are read again with every request they go with (about
  4 seconds for 2,000 characters on Qwen).
- Pick Words that only your kind of task uses: a skill wins over the focused paths, so
  "add a test" would also take "add a flag, and add a test" off the test-first change path.
- Nothing between `<!--` and `-->` is read. The skill below is an example: delete the two
  lines around it to turn it on.

<!--
## Write a test
- Words: add a test, write a test, a test for, tests for, new test, unit test, test case
- About: add a test for one behaviour and run just that test file

1. Find where this project keeps its tests (List or Search for "test") and read one test file for the code you are testing, to copy its style and imports.
2. Write one test for the behaviour asked, in that test file or in a new one beside it.
3. Run only that test file, not the whole suite.
4. If it fails because the test is wrong, fix the test. If it fails because the code is wrong, say so and ask before changing the code.
5. Answer with the test's name, its file, and the run's result line.
-->
