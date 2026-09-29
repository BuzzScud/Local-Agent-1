#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi 'record' ../answer.txt || { echo "the answer does not say the function (record in audit.mjs)"; exit 1; }
grep -Eqi 'shop-activity\.log' ../answer.txt || { echo "the answer does not say the file name (shop-activity.log)"; exit 1; }
