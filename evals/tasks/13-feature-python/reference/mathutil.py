"""Small maths helpers."""


def mean(values):
    return sum(values) / len(values)


def clamp(value, low, high):
    return max(low, min(value, high))
