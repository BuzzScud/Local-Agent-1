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

## Fix a failing check
- Words: failing check, check failed, checks failed, ci failed, ci is red, build is red, fix the build, pipeline failed
- About: read why a CI check failed, make it fail here, and fix the cause
- Fence: check

1. Find the failed check's log (the user's tools, gh run view --log-failed, or the file they give) and the first real error in it, not the last line.
2. Run the same command here and see it fail the same way. If it passes here, look for what differs: versions, env, order, files not committed.
3. Fix the cause in the code (or in the check's setup when that is what is wrong), never by skipping or loosening the test.
4. Run the failing command again, then the tests near it.
5. Answer with the cause in one line, the fix, and the run that now passes.

## Open a pull request
- Words: open a pull request, open a pr, make a pr, create a pull request, send a pr
- About: push a branch and open a pull request with a clear title and body
- Fence: check

1. Read GIT.md first. Check the branch: git status, git log of what is new against the base branch.
2. Run the project's tests; a pull request with failing tests says so in its body.
3. Push the branch (git fetch first). Open the pull request with the tool the user has (an MCP server's tool, gh pr create, or the host's page).
4. Title: what it changes, in one line. Body: why, what changed, how it was checked.
5. Answer with the pull request's address and its checks' state.

## Commit my changes
- Words: commit my changes, commit this, commit the changes, write a commit message
- About: commit only the files of this work, by path, with a message that says what changed

1. Read GIT.md first. List what changed (git status, git diff) and pick only the files of this work.
2. Stage them by path and check git diff --cached --name-only shows only those.
3. Message: one line on what changed for the user and why; details below it if needed.
4. Commit by path: git commit -m "…" -- <paths>. Push only if the user asked.
5. Answer with the commit's id, its line, and the files in it.

## Security review
- Words: security review, security audit, vulnerabilities, is this secure, security hole
- About: look for ways the code can be abused, most serious first
- Fence: read

1. Read SECURITY.md first. Find where outside input comes in: requests, files, commands, the network, other users.
2. Follow each input to where it is used: queries, paths, commands, HTML, permissions, secrets.
3. For each finding: the file and line, how someone abuses it, the input that does it, and the fix.
4. Leave out what you could not show. Change nothing. End with the worst finding in one line.

## Explain the project
- Words: explain this project, how does this project work, walk me through, tour of the code, onboard me, what does this repo do
- About: a short tour of a project: what it does, how it runs, where things are
- Fence: read

1. Read the README, the manifest (package.json, pyproject, Cargo.toml…) and AGENTS.md or CLAUDE.md when there.
2. See the layout (Map, or List of the top folders) and read the entry point.
3. Answer in plain words: what it does, how to run it and its tests, the main parts and the file each lives in, and one path a request takes through the code.

## Update the docs
- Words: update the readme, update the docs, write the docs, document this, add docs
- About: bring a README or docs in line with what the code does now

1. Read the docs to change and the code they describe; run a command they give, to see that it still works.
2. Change only what is wrong or missing, in the file's own style. No new claims you did not check.
3. Answer with what changed in the docs, and what you checked to be true.

## Release notes
- Words: release notes, changelog, what changed since, write the changelog
- About: list what changed for users between two versions, from git

1. Find the two points (tags, versions or dates) and read git log between them.
2. Group the changes as the users see them: new, changed, fixed. Leave out internal moves.
3. One line each, in plain words. Match the project's CHANGELOG style when it has one.
4. Answer with the notes, or say which file they went in.
