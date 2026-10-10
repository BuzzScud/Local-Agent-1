# Watch CI
Checks the newest CI run on GitHub every 5 minutes and ends once it has finished, saying which jobs passed.

- Kind: web
- Every: 5m
- Until: 2h
- Mode: ask
- Picture: READ the CI run › CHECK each job › FIND the cause › TELL red or green
- Asks: repo =

## Each run
Read the newest GitHub Actions run of {repo} on its main branch (https://api.github.com/repos/{repo}/actions/runs?branch=main&per_page=1). While it runs, say which job it is on. When it has finished, say whether each job passed, and end with LOOP DONE.
