# Fixing a bug

Bonsai follows this file. It is the only copy: change it here and Bonsai changes.

- **Every time** goes into Bonsai's instructions for every request.
- When a request is about a bug, Bonsai sorts it into one of the kinds below by its
  **Words**, and that kind's steps go with the request.
- **Tests see it: no** means the project's whole test suite can't show that kind of bug. Bonsai's
  fix mode then skips the suite and works step by step, unless the request names a check, or
  the main tool is a browser check and the project has a browser: then Bonsai makes the check first.
- **Runs of the check** is how many runs in a row the named check must pass.
- Bonsai rebuilds with this file inside it: after editing, run `bun run install-cli`.

## Every time

1. See it: make it happen once, the way the user sees it.
2. Sort it: crash, wrong value, layout, data, speed, flaky, time & date, only there, used to work,
   or security. The steps for its kind come with the request.
3. Find it: search for the names of what you see; don't read files one by one.
4. Understand why before changing anything.
5. Pick the smallest fix.
6. Make one change.
7. Check it with the check for its kind, not the whole test suite. If it fails, go back to step 4.
8. Look at the result yourself.
9. Commit only when asked. Say how you checked it, and leave that check behind so the bug can't come back.

## Why each step matters

1. See it: so you fix the real problem, not a guess of it.
2. Sort it: the kind decides how you search and how you check.
3. Find it: the names on screen lead straight to the few lines that matter.
4. Understand it: stops guessed edits. Most wasted time is edits made too early.
5. Smallest fix: less to break, and easier to check.
6. One change: you know exactly what fixed it.
7. Check it: proof that it's fixed, not hope. A fail sends you back to step 4.
8. Look again: a check can pass while the screen still looks wrong.
9. Ship: a test or check left behind stops the same bug coming back.

## The 10 kinds

| # | Kind | Looks like | Main tool | Tests see it |
|---|---|---|---|---|
| 1 | Crash | error on screen | the stack trace | yes |
| 2 | Wrong value | a number is wrong | a unit test | yes |
| 3 | Layout | something covered | a browser check | no |
| 4 | Data | didn't load / stale | request + reply | no |
| 5 | Speed | slow or stuck | a timer | no |
| 6 | Flaky | only sometimes | run it 20 times | no |
| 7 | Time & date | wrong day or hour | a fake clock | yes |
| 8 | Only there | fine here, not there | compare the two | no |
| 9 | Used to work | worked last week | find the change | yes |
| 10 | Security | too much access | try another user | yes |

## Steps for each kind

Step 2 is the kind itself, so each list skips from 1 to 3.

### 1 · Crash

- Words: error, errors, crash, crashes, crashed, exception, throws, thrown, typeerror, referenceerror, syntaxerror, traceback, stack trace, undefined is not, cannot read, is not a function, null, panic, segfault
- Looks like: error on screen
- Main tool: the stack trace
- Tests see it: yes

1. See it: Make it crash once; copy the exact error and where it showed (page, console, log).
3. Find it: Open the first line of the stack trace that is our code; skip library lines.
4. Understand it: Which value was missing or wrong there, and where did it come from?
5. Pick the smallest fix: Fix the bad value where it starts, not just a guard where it crashed.
6. Make the change: Edit the line that makes the bad value and leave the rest alone.
7. Check it: same steps, no error. If it fails, go back to step 4.
8. Look at it again: Repeat step 1 by hand: no error, and the screen around it still works.
9. Save and ship: Ship it, then watch the error log for a day to be sure it stays gone.

### 2 · Wrong value

- Words: wrong, incorrect, should be, expected, off by, total, sum, average, rounding, rounded, calculates, calculation, math, percent, number, returns
- Looks like: a number is wrong
- Main tool: a unit test
- Tests see it: yes

1. See it: Write down the number you got, the one you expected, and the exact inputs.
3. Find it: Search for the label on screen, then follow it to the code that works out the number.
4. Understand it: Do the math by hand for those inputs; find the first line where the code differs.
5. Pick the smallest fix: Fix that one piece of math or rounding; don't patch the number afterwards.
6. Make the change: Change that line and add a test with the exact inputs and answer.
7. Check it: the test with those inputs. If it fails, go back to step 4.
8. Look at it again: The number on screen matches your hand math; spot-check two other inputs.
9. Save and ship: Ship it with the new test, so this number can't quietly go wrong again.

### 3 · Layout

- Words: behind, hides, hidden, covered, covers, overlap, overlaps, on top, underneath, cut off, clipped, misaligned, alignment, layout, z-index, css, style, off screen, wraps, too wide, spacing, padding, margin
- Looks like: something covered
- Main tool: a browser check
- Tests see it: no

1. See it: Screenshot it at the window size where it goes wrong.
3. Find it: Search for the name (class or id) of each thing that overlaps, is cut off or misplaced.
4. Understand it: Compare their layers, sizes and positions; find the rule that wins.
5. Pick the smallest fix: Change one value: a layer, a size or a gap; no special case for one screen.
6. Make the change: Edit that one style rule in the stylesheet.
7. Check it: a browser check at that size. If it fails, go back to step 4.
8. Look at it again: Look at other window sizes, and in light and dark.
9. Save and ship: Ship it and keep the browser check with the other page tests.

### 4 · Data

- Words: not loading, doesn't load, won't load, does not load, stale, old data, out of date, missing data, no data, empty, blank, 404, 500, 502, fetch, request, response, api, cache
- Looks like: didn't load / stale
- Main tool: request + reply
- Tests see it: no

1. See it: Note what's missing or out of date, and when it last looked right.
3. Find it: In the browser's network tab, find the request behind that part of the page.
4. Understand it: Is it the request, the server's reply, or the page reading the reply?
5. Pick the smallest fix: Fix it in that one place only; don't paper over it on the screen.
6. Make the change: Edit the request, the server or the page, whichever step 4 pointed at.
7. Check it: request + reply look right. If it fails, go back to step 4.
8. Look at it again: Reload, then try it with the server slow or down.
9. Save and ship: Ship it; show a warning when the data is older than it should be.

### 5 · Speed

- Words: slow, slower, slowly, lag, laggy, freeze, freezes, frozen, hangs, takes forever, performance, cpu, memory, seconds to load
- Looks like: slow or stuck
- Main tool: a timer
- Tests see it: no

1. See it: Time it: how slow, doing what, and with how much data.
3. Find it: Profile it and find the one step that takes most of the time.
4. Understand it: Why is that step slow: too much work, the same work repeated, or waiting?
5. Pick the smallest fix: Remove the waste in that one step; leave the parts that are fine.
6. Make the change: Change that step: cache it, skip it, or do it once instead of many times.
7. Check it: timer: faster, same results. If it fails, go back to step 4.
8. Look at it again: Use it for real and confirm it feels faster.
9. Save and ship: Ship it; save the new time so a slowdown later is easy to spot.

### 6 · Flaky

- Words: sometimes, flaky, intermittent, intermittently, random, randomly, occasionally, now and then, not always, every other, race
- Looks like: only sometimes
- Main tool: run it 20 times
- Tests see it: no
- Runs of the check: 5

1. See it: Count how often it fails: run it 20 times and note which runs break.
3. Find it: Compare a passing run with a failing one: logs, order of events, timing.
4. Understand it: What must happen first but sometimes doesn't? A race, a timeout, shared state?
5. Pick the smallest fix: Make the order certain: wait for the thing itself, not a longer pause.
6. Make the change: Edit the one place that assumes the order.
7. Check it: the check passes 5 runs in a row. If it fails, go back to step 4.
8. Look at it again: Run it on a slow machine too, or with the network slowed down.
9. Save and ship: Ship it; watch the automatic tests for a week for the same failure.

### 7 · Time & date

- Words: timezone, time zone, utc, midnight, date, dates, day, hour, dst, daylight, clock, yesterday, tomorrow, weekend, sunday, 6 pm, 6pm, trade date
- Looks like: wrong day or hour
- Main tool: a fake clock
- Tests see it: yes

1. See it: Note the exact time, day and time zone when it goes wrong.
3. Find it: Search for where that time or date is made, read or rounded.
4. Understand it: Which clock is it using: New York, UTC, the server's? Where do two disagree?
5. Pick the smallest fix: Use one clock everywhere and convert only where it's shown.
6. Make the change: Edit where the time is made, not where it's shown.
7. Check it: a fake clock at the edge times. If it fails, go back to step 4.
8. Look at it again: Try midnight, 6 pm, a Sunday, and a clock-change day.
9. Save and ship: Ship it with the fake-clock tests, so the edge times stay covered.

### 8 · Only there

- Words: works on my, works locally, works here, only on, only in, production, on the server, in safari, in chrome, in firefox, on mobile, on iphone, deployed, on the droplet
- Looks like: fine here, not there
- Main tool: compare the two
- Tests see it: no

1. See it: Write down where it breaks and where it works: Mac or server, Safari or Chrome.
3. Find it: List what's different between the two: settings, versions, files, data.
4. Understand it: Change one difference at a time until it breaks here too.
5. Pick the smallest fix: Fix the difference itself, not the code around it.
6. Make the change: Edit the setting, version or file that differs.
7. Check it: same result in both places. If it fails, go back to step 4.
8. Look at it again: Check the place where it broke yourself, not just the one where it worked.
9. Save and ship: Ship it; write the setting into the deploy steps so it can't drift again.

### 9 · Used to work

- Words: used to work, worked before, stopped working, since the, after the update, before the update, after updating, after the change, regression, broke after, no longer, anymore
- Looks like: worked last week
- Main tool: find the change
- Tests see it: yes

1. See it: Find the last version that worked and the first one that doesn't.
3. Find it: List the changes between those two versions; halve the list until one is left.
4. Understand it: Which change broke it, and what was that change trying to do?
5. Pick the smallest fix: Fix it so both work: the old behaviour and what the change was for.
6. Make the change: Edit on top of that change; don't just undo it.
7. Check it: old case and new case both work. If it fails, go back to step 4.
8. Look at it again: Try what the breaking change was meant to fix.
9. Save and ship: Ship it with a test that would have caught this change.

### 10 · Security

- Words: security, permission, permissions, access, anyone can, logged out, not logged in, login, sign in, password, token, secret, leak, exposed, xss, injection, role, admin, unauthorized
- Looks like: too much access
- Main tool: try another user
- Tests see it: yes

1. See it: Note who could see or do what, and how; keep it private while you fix it.
3. Find it: Find the check that should have stopped it: sign-in, role, or input.
4. Understand it: Why did it let them through: no check, trusted the browser, or the wrong rule?
5. Pick the smallest fix: Add the check on the server; never only on the page.
6. Make the change: Edit the server check so it says no unless it's sure.
7. Check it: wrong user tries it: blocked. If it fails, go back to step 4.
8. Look at it again: Try the other ways in: other pages, direct links, the API.
9. Save and ship: Ship it quickly, then check the logs for anyone who already used it.

## Worked example (Layout)

The chart's symbol list showed up behind the "EMA 13 · 21" legend. Searching the two names on
screen (`sym-menu`, `tv-lg`) found both at layer 4; the later one (the legend) is drawn on top. The
fix was one line: the header strip `.hud` from `z-index: 4` to `5`. A 3-second browser check proved
it. About a minute in all.
