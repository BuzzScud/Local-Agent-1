import os
import tempfile
import unittest

from loader import load_bars


def write(text):
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w") as f:
        f.write(text)
    return path


class LoaderTest(unittest.TestCase):
    def test_reads_bars(self):
        path = write("time,open,high,low,close,volume\n09:30,1,2,0.5,1.5,10\n09:31,1.5,3,1,2.5,5\n")
        result = load_bars(path)
        bars = result[0] if isinstance(result, tuple) else result
        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[1]["close"], 2.5)


if __name__ == "__main__":
    unittest.main()
