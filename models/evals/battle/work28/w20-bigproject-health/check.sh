#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi 'status\.mjs' ../answer.txt || { echo "the answer does not name src/routes/status.mjs"; exit 1; }
grep -Eqi '\bok\b' ../answer.txt || { echo "the answer does not name the ok field"; exit 1; }
grep -Eqi 'build' ../answer.txt || { echo "the answer does not name the build field"; exit 1; }
grep -Eqi 'uptime' ../answer.txt || { echo "the answer does not name the uptime field"; exit 1; }
