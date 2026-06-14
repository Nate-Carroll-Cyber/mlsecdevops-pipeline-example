#!/usr/bin/env python3
"""Detect model/behaviour drift by comparing eval metrics against a baseline.

Extracts a normalised set of numeric metrics from the AI-eval stage's result
files, then compares them to a committed baseline (`evals/eval-baseline.json`).
Any metric that moves more than the threshold flags drift — catching a model (or
its guardrails) silently regressing between runs, measured on the same eval set.

Artifact-baseline strategy: the baseline lives as a file in the repo. On first
run (no baseline) it is seeded and written to the report dir to be committed; on
later runs it is the comparison reference. No external state store.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _load(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _rate(items: list, key: str) -> float | None:
    """Pass-rate over a list of records using a boolean/decision field."""
    if not items:
        return None
    passed = 0
    for it in items:
        v = it.get(key) if isinstance(it, dict) else None
        if v is True or (isinstance(v, str) and v.lower() in ("pass", "passed", "allow", "safe")):
            passed += 1
    return round(passed / len(items), 4)


def extract_metrics(reports: Path) -> dict[str, float]:
    """Pull normalised numeric metrics from whatever eval reports are present."""
    m: dict[str, float] = {}

    inspect = _load(reports / "inspect-ai-results.json")
    if isinstance(inspect, dict):
        if isinstance(inspect.get("score"), (int, float)):
            m["inspect.score"] = round(float(inspect["score"]), 4)
        r = _rate(inspect.get("cases", []), "pass")
        if r is not None:
            m["inspect.pass_rate"] = r

    garak = _load(reports / "garak-results.json")
    if isinstance(garak, dict):
        s = garak.get("summary", {})
        total = s.get("total")
        if isinstance(total, (int, float)) and total:
            m["garak.pass_rate"] = round(float(s.get("passed", 0)) / total, 4)

    pyrit = _load(reports / "pyrit-results.json")
    if isinstance(pyrit, dict):
        r = _rate(pyrit.get("conversations", []), "decision")
        if r is not None:
            m["pyrit.pass_rate"] = r

    giskard = _load(reports / "giskard-results.json")
    if isinstance(giskard, dict):
        findings = giskard.get("findings", [])
        m["giskard.high_findings"] = float(
            sum(1 for f in findings if isinstance(f, dict) and f.get("severity") == "high")
        )

    for name, key in (("guardrail-regression.json", "guardrail"),):
        doc = _load(reports / name)
        if isinstance(doc, dict):
            for list_key in ("results", "checks"):
                r = _rate(doc.get(list_key, []), "pass")
                if r is not None:
                    m[f"{key}.pass_rate"] = r
                    break
            else:
                if isinstance(doc.get("passed"), bool):
                    m[f"{key}.pass_rate"] = 1.0 if doc["passed"] else 0.0

    promptfoo = _load(reports / "promptfoo-results.json")
    if isinstance(promptfoo, dict):
        stats = promptfoo.get("results", {})
        stats = stats.get("stats", {}) if isinstance(stats, dict) else {}
        succ, fail = stats.get("successes"), stats.get("failures")
        if isinstance(succ, (int, float)) and isinstance(fail, (int, float)) and (succ + fail):
            m["promptfoo.pass_rate"] = round(succ / (succ + fail), 4)

    return m


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports", required=True, help="REPORTS_DIR with eval results")
    parser.add_argument("--baseline", required=True, help="committed baseline JSON path")
    parser.add_argument("--out", required=True, help="output drift report JSON path")
    parser.add_argument("--threshold", type=float, default=0.10,
                        help="absolute drift that flags a metric (default 0.10)")
    parser.add_argument("--fail-on-drift", action="store_true",
                        help="exit non-zero when drift is detected")
    args = parser.parse_args()

    reports = Path(args.reports)
    baseline_path = Path(args.baseline)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    current = extract_metrics(reports)
    if not current:
        print("No eval metrics found — drift detection skipped")
        out.write_text(json.dumps({"skipped": True, "reason": "no metrics"}, indent=2) + "\n")
        return

    baseline = _load(baseline_path) or {}
    baseline_metrics = baseline.get("metrics", {}) if isinstance(baseline, dict) else {}

    if not baseline_metrics:
        # Seed: write the baseline to the report dir for the maintainer to commit.
        seed = {"schema_version": "1.0", "metrics": current}
        seeded = out.parent / "eval-baseline.seed.json"
        seeded.write_text(json.dumps(seed, indent=2) + "\n")
        print(f"No baseline at {baseline_path} — seeded {len(current)} metric(s) → {seeded}")
        print(f"  Commit it to {baseline_path} to activate drift detection.")
        out.write_text(json.dumps(
            {"skipped": False, "seeded": True, "metrics": current, "drifted": []}, indent=2) + "\n")
        return

    drifted = []
    comparison = {}
    for name, cur in current.items():
        base = baseline_metrics.get(name)
        if base is None:
            comparison[name] = {"current": cur, "baseline": None, "delta": None, "new": True}
            continue
        delta = round(cur - base, 4)
        is_drift = abs(delta) > args.threshold
        comparison[name] = {"current": cur, "baseline": base, "delta": delta, "drift": is_drift}
        if is_drift:
            drifted.append({"metric": name, "baseline": base, "current": cur, "delta": delta})

    report = {
        "skipped": False,
        "seeded": False,
        "threshold": args.threshold,
        "metrics": comparison,
        "drifted": drifted,
        "drift_detected": bool(drifted),
    }
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if drifted:
        print(f"MODEL DRIFT DETECTED — {len(drifted)} metric(s) beyond ±{args.threshold}:")
        for d in drifted:
            print(f"  {d['metric']}: {d['baseline']} → {d['current']} (Δ{d['delta']:+})")
        if args.fail_on_drift:
            raise SystemExit(1)
    else:
        print(f"No drift — {len(current)} metric(s) within ±{args.threshold} of baseline")


if __name__ == "__main__":
    main()
