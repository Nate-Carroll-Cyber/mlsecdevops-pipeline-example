#!/usr/bin/env python3
"""Redact secrets and PII from a downloaded dataset, after the AV scan.

Defence-in-depth for training/eval data ingest: even data that passed the ClamAV
+ structural gate may carry secrets (API keys, tokens) or PII (names, emails,
SSNs). This step removes both *before* the data is signed, validated, or loaded
into any eval — so the trust boundary covers data confidentiality, not just
malware.

  - Secrets   ← gitleaks findings (run upstream; matched strings passed in via
                --gitleaks-report). Replaced with [REDACTED-SECRET].
  - PII       ← Microsoft Presidio analyzer/anonymizer. Replaced with <ENTITY>.

Redaction is applied to string *values* inside JSON/JSONL records (structure is
preserved so the dataset stays loadable); for other formats the raw text is
redacted. The dataset is rewritten in place. The report records counts only —
never the raw secret/PII values it found.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

try:
    from presidio_analyzer import AnalyzerEngine
    from presidio_anonymizer import AnonymizerEngine
except ImportError:  # pragma: no cover
    AnalyzerEngine = None
    AnonymizerEngine = None


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_secrets(gitleaks_report: Path | None) -> list[str]:
    """Extract matched secret strings from a gitleaks JSON report."""
    if not gitleaks_report or not gitleaks_report.exists():
        return []
    try:
        data = json.loads(gitleaks_report.read_text())
    except Exception:
        return []
    findings = data if isinstance(data, list) else data.get("findings", [])
    secrets = []
    for f in findings or []:
        secret = (f.get("Secret") or f.get("secret") or "").strip()
        if secret:
            secrets.append(secret)
    return secrets


class Redactor:
    def __init__(self, secrets: list[str]):
        # Longest-first so overlapping secrets redact greedily.
        self.secrets = sorted(set(secrets), key=len, reverse=True)
        self.secret_hits = 0
        self.pii_hits = 0
        self.pii_by_type: dict[str, int] = {}
        self._analyzer = AnalyzerEngine() if AnalyzerEngine else None
        self._anonymizer = AnonymizerEngine() if AnonymizerEngine else None

    def redact_text(self, text: str) -> str:
        if not text:
            return text
        for s in self.secrets:
            if s in text:
                self.secret_hits += text.count(s)
                text = text.replace(s, "[REDACTED-SECRET]")
        if self._analyzer and self._anonymizer:
            results = self._analyzer.analyze(text=text, language="en")
            for r in results:
                self.pii_by_type[r.entity_type] = self.pii_by_type.get(r.entity_type, 0) + 1
            self.pii_hits += len(results)
            if results:
                text = self._anonymizer.anonymize(text=text, analyzer_results=results).text
        return text

    def walk(self, obj: Any) -> Any:
        if isinstance(obj, str):
            return self.redact_text(obj)
        if isinstance(obj, list):
            return [self.walk(x) for x in obj]
        if isinstance(obj, dict):
            return {k: self.walk(v) for k, v in obj.items()}
        return obj


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="dataset file (redacted in place)")
    parser.add_argument("--gitleaks-report", help="gitleaks JSON report (secret strings)")
    parser.add_argument("--report", required=True, help="output redaction report JSON")
    # Hard-fail thresholds: redaction always runs first, then the job fails if
    # findings exceed the limit. -1 disables the check for that category.
    parser.add_argument("--max-secrets", type=int, default=-1,
                        help="fail if secret redactions exceed this count (-1 = disabled)")
    parser.add_argument("--max-pii", type=int, default=-1,
                        help="fail if PII redactions exceed this count (-1 = disabled)")
    args = parser.parse_args()

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    dataset = Path(args.input)

    def write(report: dict) -> None:
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if not dataset.exists():
        print(f"No dataset at {dataset} — redaction skipped")
        write({"skipped": True, "reason": "no dataset present"})
        return

    original_sha = _sha256(dataset)
    secrets = _load_secrets(Path(args.gitleaks_report) if args.gitleaks_report else None)
    redactor = Redactor(secrets)

    if AnalyzerEngine is None:
        # Secrets can still be redacted without Presidio; PII cannot.
        print("WARNING: Presidio not installed — secret redaction only, PII NOT redacted")

    text = dataset.read_text(errors="replace")
    suffix = dataset.suffix.lower()
    try:
        if suffix in (".jsonl", ".ndjson"):
            out_lines = []
            for line in text.splitlines():
                if not line.strip():
                    out_lines.append(line)
                    continue
                out_lines.append(json.dumps(redactor.walk(json.loads(line)), ensure_ascii=False))
            dataset.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
        elif suffix == ".json":
            dataset.write_text(
                json.dumps(redactor.walk(json.loads(text)), indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        else:
            dataset.write_text(redactor.redact_text(text), encoding="utf-8")
    except ValueError:
        # Not parseable as JSON — fall back to raw-text redaction.
        dataset.write_text(redactor.redact_text(text), encoding="utf-8")

    redacted_sha = _sha256(dataset)
    # Threshold breaches — computed before writing so they're recorded in the report.
    breaches = []
    if args.max_secrets >= 0 and redactor.secret_hits > args.max_secrets:
        breaches.append(f"secrets={redactor.secret_hits} > max {args.max_secrets}")
    if args.max_pii >= 0 and redactor.pii_hits > args.max_pii:
        breaches.append(f"pii={redactor.pii_hits} > max {args.max_pii}")

    report = {
        "skipped": False,
        "file": dataset.name,
        "presidio_available": AnalyzerEngine is not None,
        "original_sha256": original_sha,
        "redacted_sha256": redacted_sha,
        "changed": original_sha != redacted_sha,
        "secret_redactions": redactor.secret_hits,
        "pii_redactions": redactor.pii_hits,
        "pii_by_type": redactor.pii_by_type,
        "thresholds": {"max_secrets": args.max_secrets, "max_pii": args.max_pii},
        "threshold_breaches": breaches,
    }
    write(report)
    print(
        f"Redacted {dataset.name}: {redactor.secret_hits} secret(s), "
        f"{redactor.pii_hits} PII entity/ies {redactor.pii_by_type or ''} "
        f"(changed={report['changed']})"
    )

    # Data is redacted and the report is written; NOW fail if findings exceeded
    # the configured tolerance (the source data was carrying too much sensitive
    # content to accept silently).
    if breaches:
        print("REDACTION THRESHOLD EXCEEDED — " + "; ".join(breaches))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
