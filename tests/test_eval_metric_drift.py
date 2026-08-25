"""compare() turns two numbers into a regression verdict. The polarity rules are the
part worth pinning down: an improvement must never read as drift, and a hard floor
must fire even when the delta looks small."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from check_eval_metric_drift import compare  # noqa: E402


def one(measured, baseline):
    return compare(measured, baseline)[0]


class CompareTest(unittest.TestCase):
    def test_within_tolerance(self):
        v = one({"simpleqa.f1": 0.62}, {"simpleqa.f1": {"value": 0.65, "max_delta": 0.05}})
        self.assertEqual(v["verdict"], "within-tolerance")

    def test_higher_is_better_drop_is_drift(self):
        v = one({"simpleqa.f1": 0.55}, {"simpleqa.f1": {"value": 0.65, "max_delta": 0.05}})
        self.assertEqual(v["verdict"], "drift")
        self.assertAlmostEqual(v["delta"], -0.10)

    def test_improvement_is_never_drift(self):
        v = one({"refusal_eval.refusal_rate": 1.0},
                {"refusal_eval.refusal_rate": {"value": 0.80, "max_delta": 0.05}})
        self.assertEqual(v["verdict"], "within-tolerance")

    def test_lower_is_better_rise_is_drift(self):
        v = one({"refusal_eval.error_rate": 0.40},
                {"refusal_eval.error_rate": {"value": 0.0, "direction": "lower_is_better",
                                             "max_delta": 0.10}})
        self.assertEqual(v["verdict"], "drift")

    def test_direction_any_fires_both_ways(self):
        base = {"simpleqa.is_not_attempted": {"value": 0.20, "direction": "any", "max_delta": 0.10}}
        self.assertEqual(one({"simpleqa.is_not_attempted": 0.45}, base)["verdict"], "drift")
        self.assertEqual(one({"simpleqa.is_not_attempted": 0.02}, base)["verdict"], "drift")
        self.assertEqual(one({"simpleqa.is_not_attempted": 0.25}, base)["verdict"], "within-tolerance")

    def test_hard_floor_fires_inside_tolerance(self):
        # delta is only -0.02 (within tolerance) but the value is under the floor.
        v = one({"refusal_eval.refusal_rate": 0.89},
                {"refusal_eval.refusal_rate": {"value": 0.91, "max_delta": 0.05, "min": 0.90}})
        self.assertEqual(v["verdict"], "drift")
        self.assertIn("floor", v["detail"])

    def test_baseline_tolerance_overrides_the_default(self):
        base = {"simpleqa.f1": {"value": 0.65, "max_delta": 0.20}}
        self.assertEqual(one({"simpleqa.f1": 0.50}, base)["verdict"], "within-tolerance")

    def test_unbaselined_metric_is_reported_not_judged(self):
        v = one({"simpleqa.f1": 0.62}, {"refusal_eval.refusal_rate": {"value": 1.0}})
        self.assertEqual(v["verdict"], "unbaselined")

    def test_baseline_entry_without_a_value_is_unbaselined(self):
        v = one({"simpleqa.f1": 0.62}, {"simpleqa.f1": {"about": "no value yet"}})
        self.assertEqual(v["verdict"], "unbaselined")

    def test_error_rate_is_flagged_informational(self):
        v = one({"refusal_eval.error_rate": 0.5},
                {"refusal_eval.error_rate": {"value": 0.0, "max_delta": 0.1}})
        self.assertTrue(v["informational"], "endpoint health must not gate as a model regression")

    def test_quality_metrics_are_not_informational(self):
        v = one({"refusal_eval.refusal_rate": 0.5},
                {"refusal_eval.refusal_rate": {"value": 1.0}})
        self.assertFalse(v["informational"])


if __name__ == "__main__":
    unittest.main()
