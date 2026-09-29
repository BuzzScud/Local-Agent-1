#!/bin/zsh
# the model's answer is saved to ../answer.txt
n=$(grep -Eo '(^|[^A-Za-z])[A-Z]{3}-[0-9]{4}([^0-9]|$)' ../answer.txt | grep -Eo '[A-Z]{3}-[0-9]{4}' | sort -u | wc -l | tr -d ' ')
[ "$n" -ge 2 ] || { echo "the answer does not give two examples like ABC-1234 (found $n)"; exit 1; }
grep -Eqi '(three|3).{0,40}(letter|capital|upper)|(letter|capital|upper).{0,40}(three|3)' ../answer.txt || { echo 'the answer does not say three capital letters'; exit 1; }
grep -Eqi '(four|4).{0,30}(digit|number)' ../answer.txt || { echo 'the answer does not say four digits'; exit 1; }
