from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run or record the GAIPS PyRIT CI scan.")
    parser.add_argument("--materials", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    materials = Path(args.materials)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    run_command = os.environ.get("PYRIT_RUN_COMMAND", "").strip()
    if run_command:
        proc = subprocess.run(run_command, shell=True, text=True, capture_output=True, check=False)
        report = {
            "tool": "pyrit",
            "mode": "live-command",
            "command_returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
        out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        if proc.returncode != 0:
            raise SystemExit(proc.returncode)
        return

    if os.environ.get("GAIPS_USE_FIXTURES", "").lower() == "true":
        shutil.copyfile(materials / "fixtures" / "pyrit-results.json", out)
        return

    report = {
        "tool": "pyrit",
        "mode": "not-configured",
        "status": "skipped",
        "reason": "PYRIT_RUN_COMMAND is not set and GAIPS_USE_FIXTURES is not true.",
    }
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
