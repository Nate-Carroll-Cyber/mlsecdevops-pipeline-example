#!/usr/bin/env python3
"""Content-substance gate for the AI BOM (Fix #31).

`ai-bom-validate` runs `cyclonedx validate --fail-on-errors`, which only proves the
BOM is *well-formed* against the CycloneDX 1.6 schema — every content gap flagged in
the #41 review (no `vulnerabilities[]`, hollow modelCard, `signed` without `verified`)
is perfectly schema-valid and sails through. That gate is honest about being a schema
check; this one asserts the BOM actually *says something*:

  • vulnerability coverage — if the run's audit reports found vulns but the BOM's
    `vulnerabilities[]` is empty, the keystone inventory is hiding known risk (#29).
  • signing — every machine-learning-model component must be `gaips:signed=true`.
  • verification — every model SHOULD be `gaips:model.verified=true` (#32); WARN only,
    since signature-verification #19 legitimately defers on unprotected refs.

Posture (Fix #0/#23): advisory by default (exit 0, warnings). Pass --enforce to make
the coverage/signing assertions hard once the pipeline is otherwise green.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Same dir on sys.path[0] when invoked as `python3 scripts/assert_ai_bom_content.py`.
import build_ai_bom


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bom", required=True, help="aibom.cyclonedx.json")
    parser.add_argument("--reports", required=True, help="REPORTS_DIR (audit sources)")
    parser.add_argument("--enforce", action="store_true",
                        help="exit 1 on a coverage/signing assertion (teeth-last; default advisory)")
    args = parser.parse_args()

    bom_path = Path(args.bom)
    if not bom_path.exists():
        print(f"No AI BOM at {bom_path} — nothing to assert (upstream assemble skipped)")
        return
    bom = json.loads(bom_path.read_text())
    reports = Path(args.reports)

    errors: list[str] = []
    warnings: list[str] = []

    # 1) Vulnerability coverage — count vulns the audit reports actually found, using
    #    the SAME parser that populates the BOM, so the gate tracks #29 exactly.
    audit_vulns = build_ai_bom._vulnerabilities(reports, [])
    bom_vulns = bom.get("vulnerabilities") or []
    print(f"vulnerabilities: audit-reported={len(audit_vulns)}  in-BOM={len(bom_vulns)}")
    if audit_vulns and not bom_vulns:
        errors.append(
            f"audit reports found {len(audit_vulns)} vuln(s) but the BOM emits no "
            f"vulnerabilities[] — an auditor would ingest nothing structured (#29)"
        )

    # 2) Signing + verification per model component.
    def props(c: dict) -> dict[str, str]:
        return {p.get("name"): p.get("value") for p in (c.get("properties") or [])}

    models = [c for c in bom.get("components", []) if c.get("type") == "machine-learning-model"]
    for m in models:
        p = props(m)
        name = m.get("name", "?")
        if p.get("gaips:signed") != "true":
            errors.append(f"model component '{name}' is not signed (gaips:signed != true)")
        if p.get("gaips:model.verified") != "true":
            warnings.append(
                f"model component '{name}' is signed but not verified "
                f"(gaips:model.verified={p.get('gaips:model.verified')!r}: "
                f"{p.get('gaips:model.verified.reason', 'n/a')}) — expected until #19 runs on a protected ref"
            )
    print(f"model components: {len(models)} (signed+verified asserted)")

    for w in warnings:
        print(f"::warning:: {w}")
    for e in errors:
        print(f"::error:: {e}")

    if not errors and not warnings:
        print("AI BOM content gate PASSED — vulnerabilities[] populated, models signed + verified")
    elif not errors:
        print("AI BOM content gate PASSED with warnings (verification deferred)")
    else:
        verb = "FAILED" if args.enforce else "FAILED (advisory — teeth deferred, not blocking)"
        print(f"AI BOM content gate {verb} — {len(errors)} substance gap(s)")
        if args.enforce:
            sys.exit(1)


if __name__ == "__main__":
    main()
