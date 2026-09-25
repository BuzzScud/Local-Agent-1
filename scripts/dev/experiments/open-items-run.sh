#!/bin/zsh
# The real-model checks for the nine open items (2026-09-25), one after the
# other (one model at a time). Results in evals/night/2026-09-25-open9/.
cd "$(dirname "$0")/../../.."
D=evals/night/2026-09-25-open9
mkdir -p $D
step() { echo "[$(date +%H:%M:%S)] $1" >> $D/runner.out; }
step "greeting prefix"; node scripts/dev/experiments/greet-prefix.mjs > $D/greet-prefix.log 2>&1
step "trigger words (28)"; node evals/words/real.mjs --out $D/words-real.json > $D/words-real.log 2>&1
for size in 80x24 109x55 155x43 200x60; do
  step "screens $size"; COLS=${size%x*} ROWS=${size#*x} node scripts/capture-ui.mjs --out $D/screens-$size.json > $D/screens-$size.log 2>&1
done
step "practice, thinking off x2 (all 18)"; node evals/run.mjs --think off --reps 2 --out $D/practice-off > $D/practice-off.log 2>&1
step "soak: 10 starts + full conversation"; node evals/soak.mjs --starts 10 --fill --minutes 60 --out $D/soak.json > $D/soak.log 2>&1
CODE=1,2,3,10,11,12,13,14,15
step "thinking on code: medium x2"; node evals/run.mjs --think on --effort medium --reps 2 --only $CODE --out $D/code-medium > $D/code-medium.log 2>&1
step "thinking on code: high x1"; node evals/run.mjs --think on --effort high --reps 1 --only $CODE --out $D/code-high > $D/code-high.log 2>&1
step "done"; echo finished > $D/DONE
