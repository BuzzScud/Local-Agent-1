# Flaky test hunter
Runs the whole suite 5 times, a minute apart, then names the tests that pass only sometimes.

- Kind: test
- Every: 1m
- Until: 5 runs
- Mode: ask
- Picture: RUN the suite › NOTE failures › COMPARE the runs › NAME flaky tests

## Each run
Run the whole test suite once and note every test that failed. On the last run, list the tests that failed in some runs and passed in others: those are flaky. Change nothing.
