from __future__ import annotations

import argparse
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    reports = Path(args.reports)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Final Evaluation Results", "", "| Artifact | Present |", "| --- | --- |"]
    missing = []
    for name in EXPECTED:
        present = (reports / name).exists()
        lines.append(f"| reports/{name} | {present} |")
        if not present:
            missing.append(name)
    lines.extend(["", "## Advisory artifacts (not gated)", "",
                  "| Artifact | Present |", "| --- | --- |"])
    for name in ADVISORY:
        lines.append(f"| reports/{name} | {(reports / name).exists()} |")
    lines.extend(["", "## Gate", ""])
    if missing:
        lines.append("Missing required live-evaluation artifacts: " + ", ".join(missing))
    else:
        lines.append("All required live-evaluation artifact paths are present.")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
