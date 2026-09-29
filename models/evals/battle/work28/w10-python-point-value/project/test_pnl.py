import unittest

from pnl import pnl


class PnlTest(unittest.TestCase):
    def test_full_contracts(self):
        self.assertEqual(pnl("NQZ6", "long", 100, 110, 1), 200.0)
        self.assertEqual(pnl("ESZ6", "short", 5000, 4990, 2), 1000.0)

    def test_micro_contracts(self):
        self.assertEqual(pnl("MNQZ6", "long", 100, 110, 1), 20.0)
        self.assertEqual(pnl("MESZ6", "short", 5000, 4990, 2), 100.0)


if __name__ == "__main__":
    unittest.main()
