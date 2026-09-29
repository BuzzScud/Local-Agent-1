#!/bin/zsh
# the model's answer is saved to ../answer.txt
grep -Eqi 'loadSettings' ../answer.txt || { echo "the answer does not say which function (loadSettings)"; exit 1; }
grep -Eqi 'listenPort' ../answer.txt || { echo "the answer does not say which setting (listenPort)"; exit 1; }
