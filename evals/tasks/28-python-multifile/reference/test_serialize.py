from models import Trade
from serialize import to_dict


def test_to_dict():
    assert to_dict(Trade("NQ", 2, 10.0)) == {"symbol": "NQ", "qty": 2, "price": 10.0, "fee": 0.0, "value": 20.0}


def test_fee_is_taken_off_the_value():
    assert to_dict(Trade("NQ", 2, 10.0, fee=1.5))["fee"] == 1.5
    assert to_dict(Trade("NQ", 2, 10.0, fee=1.5))["value"] == 18.5
