import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("latency", Path(__file__).parents[1] / "latency-summary.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LatencySummaryTest(unittest.TestCase):
    def test_tail_latency_is_not_average_or_network_rtt(self):
        result = module.summarize(list(range(1, 101)))
        self.assertEqual(result["p95_ms"], 95)
        self.assertEqual(result["worst_ms"], 100)
        self.assertEqual(result["median_ms"], 50.5)

    def test_invalid_and_empty_measurements_are_rejected(self):
        for values in ([], [float("nan")], [float("inf")], [-1]):
            with self.assertRaises(ValueError):
                module.summarize(values)
