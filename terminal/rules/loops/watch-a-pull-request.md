# Watch a pull request
Looks at one pull request's checks every 5 minutes and ends once they all pass on its newest commit, or one fails.

- Kind: task
- Every: 5m
- Until: 4h
- Mode: ask
- Picture: READ its checks › JUDGE each part › FIND the cause › TELL ready or why
- Asks: number = 1

## Each run
Run coding pr {number} in this folder (a Gitea or Forgejo pull request; on GitHub, gh pr checks {number}). Say each part that changed since the last run. A part that passed on every run is not what blocks it. When a part fails on the newest commit, name the failed test and its first error line, and say whether it is REAL (fails on the newest) or once (failed before, not since). Change nothing. End with LOOP DONE once every part has passed on the newest commit, or the pull request is closed.
