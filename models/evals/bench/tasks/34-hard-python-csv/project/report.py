from models import Trade

HEADER = ["symbol", "qty", "price", "note"]


def to_csv(trades):
    lines = [",".join(HEADER)]
    for t in trades:
        lines.append(",".join([t.symbol, str(t.qty), str(t.price), t.note]))
    return "\n".join(lines) + "\n"
