import unittest

from stats.summary import median, summarize


class SummaryTest(unittest.TestCase):
    def test_even_median(self):
        self.assertEqual(median([4, 1, 3, 2]), 2.5)

    def test_odd_median(self):
        self.assertEqual(median([5, 1, 3]), 3)

    def test_does_not_mutate(self):
        data = [3, 1, 2]
        summarize(data)
        self.assertEqual(data, [3, 1, 2])

    def test_keys(self):
        self.assertEqual(summarize([1, 2]), {"count": 2, "min": 1, "max": 2, "median": 1.5})

    def test_empty(self):
        with self.assertRaises(ValueError):
            summarize([])


if __name__ == "__main__":
    unittest.main()
