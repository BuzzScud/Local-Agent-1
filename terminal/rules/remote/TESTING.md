# Testing

Read this before you check a change, run the tests, or say that something works.

## Check a change

1. Find how this project tests: the test command in the session details, package.json scripts, a test folder. Do not invent a command.
2. Run the test file that covers the change first (the test command with that file's path). It takes seconds; the whole suite can take minutes.
3. No test covers it: run the program the way the user would and read its output, or write a small test beside the others.
4. A failure is evidence: read the first failing line and the code it points to before you change anything.
5. When the change touches shared code (a helper many files use, a config, a format), run the whole suite once at the end.
6. A test that failed before your change: say so, and do not fix it unless asked.
7. Never weaken or delete a test to make it pass. Never say a check passed that you did not run.
8. In the answer: the command you ran and its result line.

## Prove the claim

A passing suite is not proof that the request works. Before you say it works:

1. Run the exact thing the user asked about: the bug's reproducing command, the new flag, the page. Show its output or exit code, not "should work".
2. For a bug: show it failing before your fix and passing after, with the same command.
3. Say what you did not check (another platform, a slow network, real data you do not have).
