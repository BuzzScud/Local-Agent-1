#!/bin/zsh
# the model's answer is saved to ../answer.txt
for c in NQ ES CL GC; do grep -Eq "(^|[^A-Z])$c([^A-Z]|$)" ../answer.txt || { echo "the answer does not name $c"; exit 1; }; done
grep -Eq '(^|[^0-9])45([^0-9]|$)' ../answer.txt || { echo "the answer does not say 45 days"; exit 1; }
