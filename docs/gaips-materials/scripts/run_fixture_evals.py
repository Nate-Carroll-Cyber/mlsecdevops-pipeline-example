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
    parser = argparse.ArgumentParser()
    parser.add_argument("--materials", required=True)
    parser.add_argument("--reports", required=True)
    args = parser.parse_args()
    materials = Path(args.materials)
    reports = Path(args.reports)
    reports.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(materials / "fixtures" / name, reports / name)
        print(f"wrote {reports / name}")


if __name__ == "__main__":
    main()
