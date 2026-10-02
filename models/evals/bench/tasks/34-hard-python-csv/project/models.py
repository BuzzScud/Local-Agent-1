from dataclasses import dataclass


@dataclass
class Trade:
    symbol: str
    qty: int
    price: float
    note: str = ""
