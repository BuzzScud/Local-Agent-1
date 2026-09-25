#!/bin/zsh
grep -q '25' ../answer.txt || { echo "answer lacks 25"; exit 1; }
grep -qi 'paginate' ../answer.txt || { echo "answer does not say where (paginate.mjs)"; exit 1; }
[ -z "$(find . -newer ../started -type f)" ] || { echo "files were changed"; exit 1; }
