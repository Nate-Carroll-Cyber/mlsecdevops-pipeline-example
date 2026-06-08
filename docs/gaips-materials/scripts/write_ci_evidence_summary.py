from __future__ import annotations

import argparse
from pathlib import Path

EXPECTED = [
    "local-target-results.json",
    "semgrep.json",
    "promptfoo-results.json",
    "garak-results.json",
    "giskard-results.json",
    "inspect-ai-results.json",
    "markllm-results.json",
    "pyrit-results.json",
    "guardrail-regression.json",
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
