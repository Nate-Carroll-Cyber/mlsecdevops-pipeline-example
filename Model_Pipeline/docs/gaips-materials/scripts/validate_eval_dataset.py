#!/usr/bin/env python3
"""Validate an eval dataset against the eval-dataset JSON Schema before loading.

Gate run ahead of the AI-eval stage: confirms every record of the eval/training
dataset conforms to the declared contract (`evals/eval-dataset.schema.json`) so a
malformed or off-contract dataset is caught *before* eval jobs consume it, rather
than producing confusing downstream eval failures.

Supports JSON (array of records or single object) and JSONL/NDJSON. Skips
cleanly when no dataset is present (the lab may run on built-in fixtures).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft7Validator
except ImportError:  # pragma: no cover - surfaced clearly in CI
    Draft7Validator = None


def _iter_records(path: Path):
    """Yield (line_no, record) for each record, or raise ValueError on bad JSON."""
    text = path.read_text(errors="replace")
    if path.suffix in (".jsonl", ".ndjson"):
        for i, line in enumerate(text.splitlines(), 1):
            if line.strip():
                yield i, json.loads(line)
    else:
        data = json.loads(text)
        if isinstance(data, list):
            for i, rec in enumerate(data, 1):
                yield i, rec
        else:
            yield 1, data


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="eval dataset file (json/jsonl)")
    parser.add_argument("--schema", required=True, help="JSON Schema path")
    parser.add_argument("--report", required=True, help="output report JSON path")
    parser.add_argument("--max-errors", type=int, default=20)
    args = parser.parse_args()

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    dataset = Path(args.dataset)

    def write(report: dict) -> None:
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if not dataset.exists():
        print(f"No eval dataset at {dataset} — validation skipped (using fixtures)")
        write({"skipped": True, "reason": "no dataset present"})
        return

    if Draft7Validator is None:
        print("ERROR: jsonschema not installed — cannot validate")
        write({"skipped": True, "reason": "jsonschema missing"})
        raise SystemExit(1)

    schema = json.loads(Path(args.schema).read_text())
    validator = Draft7Validator(schema)

    errors: list[dict] = []
    record_count = 0
    try:
        for line_no, rec in _iter_records(dataset):
            record_count += 1
            for err in validator.iter_errors(rec):
                errors.append({
                    "record": line_no,
                    "path": list(err.absolute_path),
                    "message": err.message,
                })
                if len(errors) >= args.max_errors:
                    break
            if len(errors) >= args.max_errors:
                break
    except ValueError as exc:
        print(f"Eval dataset is not valid JSON/JSONL: {exc}")
        write({"skipped": False, "valid": False, "parse_error": str(exc)})
        raise SystemExit(1)

    report = {
        "skipped": False,
        "valid": not errors,
        "file": dataset.name,
        "records": record_count,
        "error_count": len(errors),
        "errors": errors,
    }
    write(report)

    if errors:
        print(f"Eval dataset INVALID — {len(errors)} schema error(s) across {record_count} record(s):")
        for e in errors[:10]:
            print(f"  record {e['record']} {'/'.join(map(str, e['path'])) or '<root>'}: {e['message']}")
        raise SystemExit(1)

    print(f"Eval dataset VALID — {record_count} record(s) conform to {Path(args.schema).name}")


if __name__ == "__main__":
    main()
