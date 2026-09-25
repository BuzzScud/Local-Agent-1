#!/bin/zsh
# Starts the overnight check in the background, keeping the Mac awake while it
# runs (caffeinate). Safe to close the terminal; the morning report opens itself.
#   models/evals/bench/night/start.sh            (all steps)
#   models/evals/bench/night/start.sh --only soak,speed
set -euo pipefail
root=${0:A:h:h:h:h:h}
day=$(date -v+6H +%Y-%m-%d)
mkdir -p "$root/models/bonsai-2-27b/results/night/$day"
cd "$root"
nohup caffeinate -ims node models/evals/bench/night/run-night.mjs "$@" > "$root/models/bonsai-2-27b/results/night/$day/runner.out" 2>&1 &
echo "$!" > "$root/models/bonsai-2-27b/results/night/$day/runner.pid"
echo "night check started (pid $!); log: models/bonsai-2-27b/results/night/$day/night.log"
