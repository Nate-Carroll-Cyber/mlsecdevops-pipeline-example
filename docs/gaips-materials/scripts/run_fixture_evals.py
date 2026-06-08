from __future__ import annotations

import argparse
import shutil
from pathlib import Path

FILES = [
    "garak-results.json",
    "giskard-results.json",
    "inspect-ai-results.json",
    "pyrit-results.json",
    "hackagent-results.json",
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Copy fixture reports only when fixture mode is explicitly approved.")
    parser.add_argument("--materials", required=True)
    parser.add_argument("--reports", required=True)
    parser.add_argument("--allow-fixtures", action="store_true", help="Required. Prevents accidental use as a live eval runner.")
    args = parser.parse_args()
    if not args.allow_fixtures:
        raise SystemExit("Fixture copying requires --allow-fixtures. Live CI should run tool-specific jobs instead.")
    materials = Path(args.materials)
    reports = Path(args.reports)
    reports.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(materials / "fixtures" / name, reports / name)
        print(f"copied fixture {reports / name}")


if __name__ == "__main__":
    main()
