#!/bin/zsh
[ -s STORY.txt ] || { echo "no STORY.txt"; exit 1; }
n=$(tr -cd '.!?' < STORY.txt | wc -c | tr -d ' '); [ "$n" -ge 5 ] || { echo "STORY.txt has only $n sentences"; exit 1; }
grep -qi 'lighthouse' STORY.txt || { echo "not about a lighthouse"; exit 1; }
[ -z "$(find . -newer ../started -type f ! -name STORY.txt)" ] || { echo "other files were changed"; exit 1; }
