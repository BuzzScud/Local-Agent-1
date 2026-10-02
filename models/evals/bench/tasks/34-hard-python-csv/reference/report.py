import csv
import io

from models import Trade

HEADER = ["symbol", "qty", "price", "note"]


def to_csv(trades):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(HEADER)
    for t in trades:
        w.writerow([t.symbol, t.qty, t.price, t.note])
    return buf.getvalue()
