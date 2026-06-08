from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--logs", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    logs = Path(args.logs)
    files = sorted([p for p in logs.rglob("*") if p.is_file()]) if logs.exists() else []
    report = {
        "tool": "inspect-ai",
        "mode": "live-local",
        "log_dir": str(logs),
        "log_files": [str(p) for p in files],
        "status": "completed" if files else "completed-no-log-files-found",
    }
    Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
