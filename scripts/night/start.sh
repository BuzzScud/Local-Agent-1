#!/bin/zsh
# Starts the overnight check in the background, keeping the Mac awake while it
# runs (caffeinate). Safe to close the terminal; the morning report opens itself.
#   scripts/night/start.sh            (all steps)
#   scripts/night/start.sh --only soak,speed
set -euo pipefail
root=${0:A:h:h:h}
day=$(date -v+6H +%Y-%m-%d)
mkdir -p "$root/evals/night/$day"
cd "$root"
nohup caffeinate -ims node scripts/night/run-night.mjs "$@" > "$root/evals/night/$day/runner.out" 2>&1 &
echo "$!" > "$root/evals/night/$day/runner.pid"
echo "night check started (pid $!); log: evals/night/$day/night.log"
