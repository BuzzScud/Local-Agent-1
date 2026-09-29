#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi '18:15|6:15' ../answer.txt || { echo "the answer does not say 6:15 PM (18:15)"; exit 1; }
grep -Eqi 'sun' ../answer.txt || { echo "the answer does not say it starts on Sunday"; exit 1; }
grep -Eqi 'thu' ../answer.txt || { echo "the answer does not say it ends on Thursday"; exit 1; }
grep -Eqi 'new york|eastern|\bET\b' ../answer.txt || { echo "the answer does not say New York time"; exit 1; }
