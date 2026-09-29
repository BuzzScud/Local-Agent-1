#!/bin/sh
# Pulls, installs and restarts, then waits for the health check.
git pull --ff-only && npm ci && systemctl restart desk-api
for i in 1 2 3 4 5; do curl -fs localhost:8080/api/health && exit 0; sleep 2; done
echo "the health check did not answer"; exit 1
