#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi 'break|maintenance|closed|closes|not trading|no trading|halt' ../answer.txt || { echo "the answer does not say the market is closed then (the daily break)"; exit 1; }
grep -q 'findGaps' ../answer.txt || { echo "the answer does not name findGaps"; exit 1; }
