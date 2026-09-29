import csv

FIELDS = ("time", "open", "high", "low", "close", "volume")


def load_bars(path):
    """Reads a CSV of bars (time,open,high,low,close,volume). Returns (bars, skipped): the good
    rows as dicts, and how many rows were left out (an empty or wrong number, a missing column)."""
    bars, skipped = [], 0
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                if any(row.get(k) in (None, "") for k in FIELDS):
                    raise ValueError("missing column")
                bars.append({
                    "time": row["time"],
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": int(row["volume"]),
                })
            except ValueError:
                skipped += 1
    return bars, skipped
