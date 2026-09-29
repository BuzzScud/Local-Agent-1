#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi '(^|[^0-9.])4([^0-9.]|$)|\bfour\b' ../answer.txt || { echo "the answer does not say 4 a minute"; exit 1; }
grep -Eqi 'limits\.mjs|LIMITS' ../answer.txt || { echo "the answer does not say where (limits.mjs)"; exit 1; }
