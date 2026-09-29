import re

# Dollar value of one point for each futures root.
POINT_VALUE = {"NQ": 20.0, "ES": 50.0, "MNQ": 2.0, "MES": 5.0}


def point_value(symbol):
    """Point value for a contract code like NQZ6 or MNQZ6 (root, month letter, year digit)."""
    m = re.fullmatch(r"([A-Z]+?)[FGHJKMNQUVXZ]\d", symbol)
    if not m or m.group(1) not in POINT_VALUE:
        raise ValueError(f"unknown symbol {symbol}")
    return POINT_VALUE[m.group(1)]


def pnl(symbol, side, entry, exit, qty):
    """Profit or loss in dollars of a closed trade; side is 'long' or 'short'."""
    points = exit - entry if side == "long" else entry - exit
    return round(points * point_value(symbol) * qty, 2)
