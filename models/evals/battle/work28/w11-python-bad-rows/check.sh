#!/bin/zsh
out=$(python3 -m unittest -v 2>&1) || { echo "the tests fail: $(echo $out | tail -1)"; exit 1; }
n=$(echo "$out" | sed -n 's/^Ran \([0-9]*\) test.*/\1/p'); [ "${n:-0}" -ge 2 ] || { echo "no new test (ran ${n:-0})"; exit 1; }
D=$(mktemp -d)
printf 'time,open,high,low,close,volume\n09:30,1,2,0.5,1.5,10\n09:31,,3,1,2.5,5\n09:32,1.5,abc,1,2,5\n09:33,2,3\n09:34,2,4,1.5,3.5,7\n' > $D/bad.csv
printf 'time,open,high,low,close,volume\n09:30,1,2,0.5,1.5,10\n09:31,1.5,3,1,2.5,5\n' > $D/good.csv
python3 -c "
import sys
from loader import load_bars
r = load_bars(sys.argv[1])
assert isinstance(r, tuple) and len(r) == 2, 'load_bars should return (bars, skipped), got ' + type(r).__name__
bars, skipped = r
assert [b['time'] for b in bars] == ['09:30', '09:34'], 'kept ' + str([b['time'] for b in bars])
assert skipped == 3, 'skipped ' + str(skipped) + ', not 3'
assert bars[1]['close'] == 3.5 and bars[1]['volume'] == 7
" $D/bad.csv 2>$D/err || { echo "$(tail -1 $D/err)"; rm -rf $D; exit 1; }
[ "$(python3 report.py $D/good.csv 2>&1)" = "2 bars from 09:30 to 09:31" ] || { echo "report.py on a good file printed: $(python3 report.py $D/good.csv 2>&1 | head -2 | tr '\n' '|')"; rm -rf $D; exit 1; }
[ "$(python3 report.py $D/bad.csv 2>&1)" = "$(printf '2 bars from 09:30 to 09:34\nskipped 3 bad rows')" ] || { echo "report.py on a bad file printed: $(python3 report.py $D/bad.csv 2>&1 | head -3 | tr '\n' '|')"; rm -rf $D; exit 1; }
rm -rf $D
