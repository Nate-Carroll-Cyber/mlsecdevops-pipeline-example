"""verdict() decides whether a control passed. A bug here reports a failing gate as
green, which is the worst failure this repo can have — so it gets the most tests."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from write_ci_evidence_summary import verdict  # noqa: E402


class VerdictTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def w(self, name, doc, raw=None):
        path = self.dir / name
        path.write_text(raw if raw is not None else json.dumps(doc))
        return path

    # ── generic states ───────────────────────────────────────────────────────
    def test_absent_file(self):
        self.assertEqual(verdict("semgrep.json", self.dir / "nope.json")[0], "absent")

    def test_unparseable_is_inert_not_pass(self):
        state, _ = verdict("semgrep.json", self.w("semgrep.json", None, raw="{oops"))
        self.assertEqual(state, "inert")

    def test_skipped_is_inert(self):
        state, detail = verdict("refusal-eval.json",
                                self.w("refusal-eval.json", {"skipped": True, "reason": "no endpoint"}))
        self.assertEqual(state, "inert")
        self.assertIn("no endpoint", detail)

    # ── semgrep ──────────────────────────────────────────────────────────────
    def test_semgrep_error_severity_fails(self):
        doc = {"results": [{"extra": {"severity": "ERROR"}}, {"extra": {"severity": "WARNING"}}]}
        self.assertEqual(verdict("semgrep.json", self.w("semgrep.json", doc))[0], "fail")

    def test_semgrep_warnings_only_passes(self):
        doc = {"results": [{"extra": {"severity": "WARNING"}}]}
        self.assertEqual(verdict("semgrep.json", self.w("semgrep.json", doc))[0], "pass")

    # ── refusal eval: polarity is what matters ───────────────────────────────
    def test_refusal_any_compliance_fails(self):
        doc = {"metrics": {"refusal_rate": 0.99, "compliances": 1, "scored": 104}}
        state, detail = verdict("refusal-eval.json", self.w("refusal-eval.json", doc))
        self.assertEqual(state, "fail")
        self.assertIn("1 non-refusal", detail)

    def test_refusal_clean_run_passes(self):
        doc = {"metrics": {"refusal_rate": 1.0, "compliances": 0, "scored": 104}}
        self.assertEqual(verdict("refusal-eval.json", self.w("refusal-eval.json", doc))[0], "pass")

    def test_refusal_all_errors_fails(self):
        doc = {"status": "failed", "failure_reason": "every probe errored",
               "metrics": {"refusal_rate": None, "compliances": 0}}
        self.assertEqual(verdict("refusal-eval.json", self.w("refusal-eval.json", doc))[0], "fail")

    def test_refusal_no_rate_is_inert_not_pass(self):
        doc = {"metrics": {"refusal_rate": None, "compliances": 0}}
        self.assertEqual(verdict("refusal-eval.json", self.w("refusal-eval.json", doc))[0], "inert")

    # ── simpleqa: a trend signal, never a security verdict ───────────────────
    def test_simpleqa_low_score_is_inert_not_fail(self):
        doc = {"metrics": {"graded": 100, "f1": 0.04, "accuracy_given_attempted": 0.05}}
        state, detail = verdict("simpleqa-eval.json", self.w("simpleqa-eval.json", doc))
        self.assertEqual(state, "inert")
        self.assertIn("f1=0.04", detail)

    def test_simpleqa_hard_failure_fails(self):
        doc = {"status": "failed", "failure_reason": "every question errored", "metrics": {}}
        self.assertEqual(verdict("simpleqa-eval.json", self.w("simpleqa-eval.json", doc))[0], "fail")

    # ── drift jobs: seeded ≠ passing ─────────────────────────────────────────
    def test_eval_drift_seeded_is_inert(self):
        doc = {"seeded": True, "drift_detected": False}
        self.assertEqual(verdict("eval-metric-drift.json", self.w("eval-metric-drift.json", doc))[0], "inert")

    def test_eval_drift_detected_fails(self):
        doc = {"seeded": False, "drift_detected": True, "drifted_metrics": ["simpleqa.f1"],
               "comparisons": [{"metric": "simpleqa.f1"}]}
        state, detail = verdict("eval-metric-drift.json", self.w("eval-metric-drift.json", doc))
        self.assertEqual(state, "fail")
        self.assertIn("simpleqa.f1", detail)

    def test_eval_drift_within_tolerance_passes(self):
        doc = {"seeded": False, "drift_detected": False, "drifted_metrics": [],
               "comparisons": [{"metric": "simpleqa.f1"}, {"metric": "refusal_eval.refusal_rate"}]}
        self.assertEqual(verdict("eval-metric-drift.json", self.w("eval-metric-drift.json", doc))[0], "pass")

    def test_evidently_seeded_is_not_a_no_drift_pass(self):
        doc = {"seeded": True, "drift_detected": False}
        self.assertEqual(verdict("evidently-drift.json", self.w("evidently-drift.json", doc))[0], "inert")

    def test_evidently_drift_detected_fails(self):
        doc = {"seeded": False, "drift_detected": True}
        self.assertEqual(verdict("evidently-drift.json", self.w("evidently-drift.json", doc))[0], "fail")


if __name__ == "__main__":
    unittest.main()
