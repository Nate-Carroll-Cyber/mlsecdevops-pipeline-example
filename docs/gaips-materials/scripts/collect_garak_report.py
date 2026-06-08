from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reports", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    reports = Path(args.reports)
    candidates = sorted(reports.glob("garak-live*.report.json")) + sorted(reports.glob("garak-live*.json"))
    if not candidates:
        normalized = {
            "tool": "garak",
            "mode": "live",
            "status": "completed-no-json-report-found",
            "source_report": None,
            "report": None,
        }
        Path(args.out).write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")
        return
    source = candidates[-1]
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {"raw_report": source.read_text(encoding="utf-8")}
    normalized = {"tool": "garak", "mode": "live", "status": "completed", "source_report": str(source), "report": data}
    Path(args.out).write_text(json.dumps(normalized, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
