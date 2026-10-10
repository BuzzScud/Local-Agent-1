# Fix until green
Fixes the failing tests run after run, and ends when they all pass (10 tries at most, $1 at most).

- Kind: debug
- Every: until done
- Until: 10 runs
- Mode: edits
- Cap: $1.00
- Picture: RUN the tests › FIND the cause › FIX the code › CHECK they pass

## Each run
Some tests in this folder fail. Find why and fix the code until every test passes. Never change a test to make it pass.
