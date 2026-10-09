# Docs keeper
Every hour, fixes the README lines the code has made wrong. It waits for your go before each run.

- Kind: task
- Every: 1h
- Until: no limit
- Mode: edits
- Ask first: on
- Picture: READ the diff › FIX the README › TELL you

## Each run
Compare README.md with the code changed since the last commit. Fix the lines in the README that are now wrong or missing. Change no code.
