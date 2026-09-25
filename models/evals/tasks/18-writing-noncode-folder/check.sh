#!/bin/zsh
f=$(ls TEST.txt TEST 2>/dev/null | head -1)
[ -n "$f" ] && [ -s "$f" ] || { echo "no TEST.txt"; exit 1; }
n=$(tr -cd '.!?' < "$f" | wc -c | tr -d ' '); [ "$n" -ge 3 ] || { echo ""$f" has only $n sentences"; exit 1; }
[ -z "$(find . -newer ../started -type f ! -name 'TEST*')" ] || { echo "other files were changed"; exit 1; }
