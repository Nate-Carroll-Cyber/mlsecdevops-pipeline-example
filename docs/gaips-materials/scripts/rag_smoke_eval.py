from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


QUESTIONS = [
    ("sensitive_data", "What data is allowed to be sent to AI systems?", "security-guidelines.md"),
    ("password_policy", "What is the password policy?", "password-policy.md"),
    ("claim_access", "Can the assistant claim access to systems not provided?", "product-faq.md"),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the GAIPS local RAG smoke evaluation.")
    parser.add_argument("--materials", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    materials = Path(args.materials)
    app = materials / "starter-rag-app" / "app.py"
    data = materials / "data" / "docs"
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    results = []
    for case_id, question, expected_source in QUESTIONS:
        run = subprocess.run(
            [sys.executable, str(app), "--data", str(data), "--question", question],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        passed = run.returncode == 0 and expected_source in run.stdout and "Sources:" in run.stdout
        results.append(
            {
                "id": case_id,
                "question": question,
                "expected_source": expected_source,
                "returncode": run.returncode,
                "pass": passed,
                "stdout": run.stdout,
                "stderr": run.stderr,
            }
        )

    report = {
        "tool": "gaips-rag-smoke-eval",
        "mode": "live-local",
        "results": results,
        "passed": all(r["pass"] for r in results),
    }
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
