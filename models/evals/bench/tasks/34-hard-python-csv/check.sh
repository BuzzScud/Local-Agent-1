#!/bin/zsh
python3 -m pytest -q 2>&1 | grep -Eq '^[0-9]+ passed' || { echo "pytest fails"; exit 1; }
python3 -m pytest -q 2>&1 | grep -Eq 'failed|error' && { echo "pytest fails"; exit 1; }
[ "$(python3 -m pytest -q 2>&1 | grep -Eo '^[0-9]+ passed' | grep -Eo '[0-9]+')" -ge 2 ] || { echo "no new test"; exit 1; }
python3 -c "
import csv, io
from models import Trade
from report import to_csv
notes = ['plain', 'a, b', 'say \"hi\"', 'two\nlines', 'all, \"of\"\nit', '', ' spaced ']
out = to_csv([Trade('NQ', i, 1.25 * i, n) for i, n in enumerate(notes)])
assert out.splitlines()[0] == 'symbol,qty,price,note', out.splitlines()[0]
rows = list(csv.reader(io.StringIO(out)))
assert rows[0] == ['symbol', 'qty', 'price', 'note'], rows[0]
assert len(rows) == len(notes) + 1, len(rows)
for i, n in enumerate(notes):
    r = rows[i + 1]
    assert r == ['NQ', str(i), str(1.25 * i), n], (r, n)
assert to_csv([]) .splitlines() == ['symbol,qty,price,note']
" || { echo "the CSV does not read back"; exit 1; }
