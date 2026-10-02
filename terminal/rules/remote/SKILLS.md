# Skills (remote models)

Same format as the local SKILLS.md (`## Name`, `- Words:`, `- About:`, optional `- Fence:`,
then steps). On App, a skill whose Words the request uses comes with the request; every
skill is also in the list, so the model can open one the words missed.

## Write a test
- Words: add a test, write a test, a test for, tests for, new test, unit test, test case
- About: add a test for one behaviour and run just that test file
- Fence: check

1. Find where the project keeps its tests and read the one closest to the code under test, to copy its style, imports and helpers.
2. Write the test for the behaviour asked: the normal case, then one edge case (empty, missing, too big) if the request does not rule it out.
3. Run only that test file. If it fails because the test is wrong, fix the test; if the code is wrong, say so and ask before changing the code.
4. Answer with the test's name, its file, and the run's result line.

## Review code
- Words: review, look over, code review, check my changes, anything wrong
- About: read a change or a file and report real problems, most serious first
- Fence: read

1. Find what to review: the uncommitted changes (Bash git diff), the files named, or the last commit.
2. Read each changed part with what it calls and what calls it.
3. Look for what breaks: wrong results, missing cases, errors swallowed, data lost, a security hole. Style comes last, and only when it hides a bug.
4. For each finding: the file and line, what goes wrong, and an input that shows it. Leave out anything you could not show.
5. Change nothing. End with a one-line verdict.

## Refactor
- Words: refactor, clean up, tidy, simplify, split this, extract
- About: change how code is arranged without changing what it does
- Fence: check, scratch

1. Run the tests first and note the result: that is what must still hold.
2. Make one move at a time (extract, rename, move), running the covering tests after each.
3. Keep every public name and output the same unless the request says otherwise.
4. Answer with what moved where and the test result before and after.

## Flaky test
- Words: flaky, sometimes fails, intermittent, passes alone, fails on ci
- About: find why a test passes and fails on different runs
- Fence: check

1. Run the test alone several times and in the full suite, and note the pattern.
2. Look for time, order, shared state, randomness, the network and timeouts.
3. Make it fail on purpose (fixed seed, slower timer, other order) before you fix it.
4. Fix the cause, not the timeout. Run it enough times to show the pattern is gone.
