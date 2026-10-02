from models import Trade
from report import to_csv


def test_plain_rows():
    out = to_csv([Trade("NQ", 2, 10.5, "open")])
    assert out.splitlines()[0] == "symbol,qty,price,note"
    assert out.splitlines()[1] == "NQ,2,10.5,open"
