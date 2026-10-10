# Log watcher
Reads the end of a log file every 5 minutes and lists the errors and warnings that are new.

- Kind: task
- Every: 5m
- Until: no limit
- Mode: ask
- Picture: READ the log › FIND new errors › COMPARE to last run › TELL you
- Asks: file = logs/server.log

## Each run
Read the last 200 lines of {file}. List each error or warning that is new since the last run, with its line. Change nothing.
