# Release watch
Reads a page every hour and tells you when something new is there, with its main changes.

- Kind: web
- Every: 1h
- Until: no limit
- Mode: ask
- Picture: OPEN the page › FIND what is new › COMPARE to last run › TELL you
- Asks: page = https://bun.sh/blog

## Each run
Read {page}. If there is a version or a post newer than the last run saw, say what it is and its three main changes; else say "nothing new". Change nothing.
