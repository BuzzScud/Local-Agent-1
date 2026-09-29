#!/bin/zsh
python3 -m unittest -q test_pnl 2>/dev/null || { echo "the tests fail"; exit 1; }
[ "$(shasum test_pnl.py | cut -c1-12)" = "cc6d091150eb" ] || { echo "test_pnl.py was changed (fix the code, not the tests)"; exit 1; }
err=$(python3 -c "
from pnl import point_value
for code, want in [('MESH7', 5.0), ('ESH7', 50.0), ('MNQU6', 2.0), ('NQH7', 20.0)]:
    assert point_value(code) == want, code + ' gives ' + str(point_value(code))
try:
    point_value('CLZ6')
except ValueError:
    pass
else:
    raise AssertionError('an unknown symbol (CLZ6) should raise ValueError')
" 2>&1) || { echo "$err" | tail -1; exit 1; }
