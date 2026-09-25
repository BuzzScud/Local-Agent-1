#!/bin/zsh
grep -q 'addTax' ../answer.txt || { echo "answer lacks addTax"; exit 1; }
grep -Eq '0\.0825|8\.25' ../answer.txt || { echo "answer lacks the rate (0.0825 / 8.25%)"; exit 1; }
[ -z "$(find . -newer ../started -type f)" ] || { echo "files were changed"; exit 1; }
