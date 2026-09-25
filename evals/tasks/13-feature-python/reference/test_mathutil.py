from mathutil import clamp, mean


def test_mean():
    assert mean([1, 2, 3, 4]) == 2.5


def test_clamp():
    assert clamp(5, 0, 3) == 3
