#!/bin/zsh
grep -qi 'internal' ../answer.txt || { echo "answer lacks the internal kind"; exit 1; }
grep -Eqi 'subtotal (is )?(0|zero)|zero subtotal|subtotal of 0|0 subtotal|nothing to (charge|pay)|empty' ../answer.txt || { echo "answer lacks the zero subtotal case"; exit 1; }
grep -q 'FEE_BPS' ../answer.txt || { echo "answer lacks FEE_BPS"; exit 1; }
grep -Eq 'feeBps|config' ../answer.txt || { echo "answer lacks the config"; exit 1; }
grep -Eq '\b25\b' ../answer.txt || { echo "answer lacks the default 25"; exit 1; }
python3 -c "
import re
t = open('../answer.txt').read()
i = t.find('FEE_BPS')
m = re.compile(r'feeBps|config').search(t, i)
k = re.compile(r'\b25\b').search(t, m.end()) if m else None
assert i >= 0 and m and k
" 2>/dev/null || { echo "answer gives the sources out of order (FEE_BPS, then the config, then 25)"; exit 1; }
grep -qi 'staff' ../answer.txt && { echo "answer cites the unused legacy code"; exit 1; }
[ -z "$(find . -newer ../started -type f)" ] || { echo "files were changed"; exit 1; }
