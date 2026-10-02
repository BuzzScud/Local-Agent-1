import csv
import io

from models import Trade
from report import to_csv


def test_plain_rows():
    out = to_csv([Trade("NQ", 2, 10.5, "open")])
    assert out.splitlines()[0] == "symbol,qty,price,note"
    assert out.splitlines()[1] == "NQ,2,10.5,open"


def test_awkward_notes_read_back():
    notes = ['a, b', 'say "hi"', "two\nlines"]
    rows = list(csv.reader(io.StringIO(to_csv([Trade("ES", 1, 1.0, n) for n in notes]))))
    assert [r[3] for r in rows[1:]] == notes
