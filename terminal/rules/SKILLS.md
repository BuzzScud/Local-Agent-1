# Skills

Agentic Coder follows this file. It is the only copy: change it here, or in the hub
(Instructions → 08 SKILLS.md), and Agentic Coder changes on your next message.

- Each skill is a `## Name` section: a `- Words:` line (the words or phrases that bring it,
  split by commas), an `- About:` line (one line, shown in the list), then its steps.
- When a request uses a skill's Words, its steps go with that request, and Agentic Coder works
  step by step with them instead of its focused fix and change paths. The skill with the most
  matching words wins; a phrase counts twice.
- Every skill is also listed in the instructions by name and About, so the model can open one
  the words missed with Read SKILLS/<name>. When Who decides is Model (/effort), only the list
  is given and the model opens a skill itself.
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
