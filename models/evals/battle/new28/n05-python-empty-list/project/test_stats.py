import unittest
from stats import average


class AverageTest(unittest.TestCase):
    def test_numbers(self):
        self.assertEqual(average([1, 2, 3]), 2)

    def test_empty(self):
        self.assertIsNone(average([]))


if __name__ == '__main__':
    unittest.main()
