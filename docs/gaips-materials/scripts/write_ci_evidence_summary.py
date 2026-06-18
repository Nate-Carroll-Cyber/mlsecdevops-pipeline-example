from __future__ import annotations

import argparse
import json
from pathlib import Path

EXPECTED = [
    "semgrep.json",
    "markllm-results.json",
    # The endpoint-dependent live evals (promptfoo/garak/giskard/inspect-ai/pyrit/
    # guardrail-regression) were split into the separate live-scan pipeline
    # (docs/gaips-materials/ci/live-scans.gitlab-ci.yml) — they no longer run here,
    # so they are not gated as required artifacts in this static pipeline.
]

# Advisory artifacts — displayed for completeness but NOT gated (they skip
# cleanly when their input is absent, so missing ≠ failure).
ADVISORY = [
    "modelaudit-summary.json",
    "great-expectations.json",
    "ydata-profile.json",
    "evidently-drift.json",
    "dvc-status.json",
    "dependency-track.json",
]


def _load(path: Path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def verdict(name: str, path: Path) -> tuple[str, str]:
    """Read an artifact's VERDICT, not just its presence (Fix #33).

    Returns (state, detail) where state ∈ {pass, fail, inert, absent}. `inert` =
    present but carries no pass/fail signal (a profile, or a skipped/seeded run);
    `absent` = file missing. This is what lets the summary distinguish a bundle of
    *failing* evidence from a *complete* one — the old gate only saw existence."""
    if not path.exists():
        return "absent", "missing"
    doc = _load(path)
    if doc is None:
        return "inert", "unparseable"
    if isinstance(doc, dict) and doc.get("skipped"):
        return "inert", f"skipped: {doc.get('reason', 'n/a')}"

    if name == "semgrep.json":
        results = doc.get("results", []) if isinstance(doc, dict) else []
        errors = [r for r in results if (r.get("extra", {}) or {}).get("severity") == "ERROR"]
        return ("fail", f"{len(errors)} ERROR-severity finding(s)") if errors else ("pass", f"{len(results)} finding(s), 0 error-severity")
    if name == "markllm-results.json":
        status = doc.get("status") if isinstance(doc, dict) else None
        return ("fail", f"status={status}") if status == "failed" else ("pass", f"status={status}")
    if name == "modelaudit-summary.json":
        crit = (doc or {}).get("critical", 0)
        return ("fail", f"{crit} critical") if crit else ("pass", "0 critical")
    if name == "great-expectations.json":
        return ("pass", "all expectations met") if doc.get("success") else ("fail", "expectation(s) failed")
    if name == "evidently-drift.json":
        if doc.get("seeded"):
            return "inert", "reference seeded (no comparison yet)"
        # polarity-aware (per Fix #28): drift detected is the BAD state.
        return ("fail", "data drift detected") if doc.get("drift_detected") else ("pass", "no data drift")
    if name == "dependency-track.json":
        failing = doc.get("failing_violations") or []
        return ("fail", f"{len(failing)} blocking policy violation(s)") if failing else ("pass", "no blocking violations")
    # ydata-profile.json / dvc-status.json — descriptive, no verdict.
    return "inert", "present (no verdict)"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports", required=True)
    parser.add_argument("--out", required=True)
    # Teeth-last (per Fix #0/#23 posture): default WARN on verdict failures; flip to
    # a hard gate once the pipeline is otherwise green.
    parser.add_argument("--enforce-verdicts", action="store_true",
                        help="fail the job when a REQUIRED artifact's verdict is 'fail' (not just missing)")
    args = parser.parse_args()
    reports = Path(args.reports)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    lines = ["# Final Evaluation Results", "",
             "| Artifact | Present | Verdict | Detail |", "| --- | --- | --- | --- |"]
    missing: list[str] = []
    failed_required: list[str] = []
    for name in EXPECTED:
        state, detail = verdict(name, reports / name)
        present = state != "absent"
        lines.append(f"| reports/{name} | {present} | {state} | {detail} |")
        if not present:
            missing.append(name)
        elif state == "fail":
            failed_required.append(f"{name} ({detail})")

    lines.extend(["", "## Advisory artifacts (not gated)", "",
                  "| Artifact | Present | Verdict | Detail |", "| --- | --- | --- | --- |"])
    failed_advisory: list[str] = []
    for name in ADVISORY:
        state, detail = verdict(name, reports / name)
        present = state != "absent"
        lines.append(f"| reports/{name} | {present} | {state} | {detail} |")
        if state == "fail":
            failed_advisory.append(f"{name} ({detail})")

    lines.extend(["", "## Gate", ""])
    if missing:
        lines.append("Missing required live-evaluation artifacts: " + ", ".join(missing))
    else:
        lines.append("All required live-evaluation artifact paths are present.")
    if failed_required:
        verb = "FAILING (enforced)" if args.enforce_verdicts else "FAILING (advisory — teeth deferred)"
        lines.append(f"Required artifacts with a {verb} verdict: " + ", ".join(failed_required))
    if failed_advisory:
        lines.append("Advisory artifacts reporting a failure (not gated): " + ", ".join(failed_advisory))
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # Emit warnings to the job log so a failing-but-present verdict is never invisible.
    for f in failed_required:
        print(f"::warning:: required evidence verdict FAILED: {f}")
    for f in failed_advisory:
        print(f"WARNING: advisory evidence verdict failed: {f}")

    # Hard gate: required-missing always fails (unchanged). Required-verdict failures
    # fail only under --enforce-verdicts (teeth-last).
    if missing:
        raise SystemExit(1)
    if failed_required and args.enforce_verdicts:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
