from models import Trade
from serialize import to_dict


def test_to_dict():
    assert to_dict(Trade("NQ", 2, 10.0)) == {"symbol": "NQ", "qty": 2, "price": 10.0, "value": 20.0}
