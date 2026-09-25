"""Turning trades into plain dicts."""
from models import Trade


def to_dict(trade: Trade) -> dict:
    return {
        "symbol": trade.symbol,
        "qty": trade.qty,
        "price": trade.price,
        "value": trade.qty * trade.price,
    }
