# Fixing a bug

Read this for any request about something broken. The steps for the bug's kind still come
with the request, as on this Mac (terminal/rules/bug-fixing.md).

## Every time

1. See it: make it happen once, the way the user sees it (run the program, the test, the page).
2. Sort it: crash, wrong value, layout, data, speed, flaky, time and date, only there, used to work, or security.
3. Find it: search for the names of what you see (the error text, the function, the setting). Follow the data back to where it goes wrong.
4. Understand why before changing anything. Say the cause in one sentence; if you cannot, keep looking.
5. Pick the smallest fix that removes the cause, not one that hides the symptom.
6. Make one change.
7. Check it with the check for its kind, not only the whole suite. If it fails, go back to step 4.
8. Leave a test or check behind that fails without the fix, so the bug cannot come back.
9. Commit only when asked. In the answer: the cause, the fix, and how you checked it.

## Why each step matters

- Seeing it first means you fix the real problem, not your guess of it.
- The kind decides where to look: a layout bug is not in the tests, a "used to work" bug is in the history (git log, git diff).
- A fix without a cause in one sentence is usually a guess.
