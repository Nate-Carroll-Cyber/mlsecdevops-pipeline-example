from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--materials", required=True)
    parser.add_argument("--reports", required=True)
    args = parser.parse_args()
    materials = Path(args.materials)
    reports = Path(args.reports)
    guardrails = materials / "guardrails"
    reports.mkdir(parents=True, exist_ok=True)

    prompt_guard = load(guardrails / "prompt-guard-results.json")
    llama_guard = load(guardrails / "llama-guard-3-results.json")
    model_armor = load(guardrails / "model-armor-results.json")

    checks = [
        {"id": "prompt_guard_blocks_jailbreak", "pass": any(r.get("label") == "jailbreak" and r.get("decision") == "block" for r in prompt_guard["results"])},
        {"id": "prompt_guard_excludes_rag_injection", "pass": any(r.get("input_type") == "retrieved_chunk" and "exclude" in r.get("decision", "") for r in prompt_guard["results"])},
        {"id": "llama_guard_has_unsafe_case", "pass": any(r.get("safe") is False for r in llama_guard["results"])},
        {"id": "model_armor_redacts_sensitive_response", "pass": any(r.get("method") == "sanitizeModelResponse" and r.get("decision") == "redact" for r in model_armor["results"])},
    ]
    passed = all(c["pass"] for c in checks)
    report = {"tool": "gaips-guardrail-regression", "mode": "deterministic-local", "checks": checks, "passed": passed}
    (reports / "guardrail-regression.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(guardrails / "prompt-guard-results.json", reports / "prompt-guard-results.json")
    shutil.copyfile(guardrails / "llama-guard-3-results.json", reports / "llama-guard-3-results.json")
    shutil.copyfile(guardrails / "model-armor-results.json", reports / "model-armor-results.json")
    lines = ["# Guardrail Regression", "", "| Check | Pass |", "| --- | --- |"]
    for check in checks:
        lines.append(f"| {check['id']} | {check['pass']} |")
    (reports / "guardrail-regression.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
