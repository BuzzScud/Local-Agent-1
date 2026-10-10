# Build and lint guard
Runs the build and the linter every 30 minutes and lists only what is new.

- Kind: test
- Every: 30m
- Until: no limit
- Mode: ask
- Picture: BUILD the app › LINT the code › KEEP only new › TELL you

## Each run
Run the build and the linter. List each error or warning that is new since the last run, with its file and line. Change nothing.
