#!/bin/zsh
python3 -m pytest -q 2>&1 | grep -Eq '^[0-9]+ passed' || { echo "pytest fails"; exit 1; }
[ "$(python3 -m pytest -q 2>&1 | grep -Eo '^[0-9]+ passed' | grep -Eo '[0-9]+')" -ge 2 ] || { echo "no new test"; exit 1; }
python3 -c "
from models import Trade
from serialize import to_dict
t = Trade('NQ', 2, 10.0, fee=1.5)
d = to_dict(t)
assert d['fee'] == 1.5, d
assert d['value'] == 18.5, d
assert Trade('NQ', 1, 1.0).fee == 0.0
assert to_dict(Trade('NQ', 1, 1.0))['value'] == 1.0
" || { echo "fee wrong"; exit 1; }
