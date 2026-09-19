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
  • declared scope and completeness — the header properties and `compositions[]` must
    exist, and an `incomplete` claim is reported (a truthful partial BOM is valid; it
    is surfaced, not rejected).
  • no absence-as-clean — a scanner field may read `not-scanned` / `unknown`, never a
    defaulted 0 / true. A model whose every scanner is not-scanned is an ERROR.
  • model identity — version, purl, supplier and licence present or explicitly UNKNOWN.
  • dependency graph — `dependencies[]` present and rooted.
  • currency — with --expect-commit, the BOM's commit must match (a validly signed BOM
    from an earlier run is otherwise indistinguishable from this run's).
  • accepted risks — every `analysis` carries an owner and an unexpired review date.

These grade the DOCUMENT. None of them is a statement about the system it describes.

Posture (Fix #0/#23): advisory by default (exit 0, warnings). Pass --enforce to make
the coverage/signing assertions hard once the pipeline is otherwise green.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

# Same dir on sys.path[0] when invoked as `python3 scripts/assert_ai_bom_content.py`.
import build_ai_bom


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bom", required=True, help="aibom.cyclonedx.json")
    parser.add_argument("--reports", required=True, help="REPORTS_DIR (audit sources)")
    parser.add_argument("--expect-commit", default=None,
                        help="commit SHA this BOM must describe (e.g. $CI_COMMIT_SHA); "
                             "mismatch is an error — the BOM is stale for this revision")
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
        # A provider-hosted model under evaluation has no weights in this pipeline to
        # sign; it is checked for a resolved id instead (section 4).
        if str(p.get("gaips:role", "")).startswith("model under evaluation"):
            continue
        if p.get("gaips:signed") != "true":
            errors.append(f"model component '{name}' is not signed (gaips:signed != true)")
        if p.get("gaips:model.verified") != "true":
            warnings.append(
                f"model component '{name}' is signed but not verified "
                f"(gaips:model.verified={p.get('gaips:model.verified')!r}: "
                f"{p.get('gaips:model.verified.reason', 'n/a')}) — expected until #19 runs on a protected ref"
            )
    print(f"model components: {len(models)} (signed+verified asserted)")

    NS = build_ai_bom.PROP_NS
    meta = {p.get("name"): p.get("value")
            for p in (bom.get("metadata", {}).get("properties") or [])}

    # 3) Declared scope and completeness.
    for key in ("aibom.graphType", "aibom.scope.included", "aibom.scope.excluded",
                "aibom.completenessClaim", "aibom.generationMethod"):
        if not meta.get(f"{NS}:{key}"):
            errors.append(f"header property {NS}:{key} is missing — scope and completeness "
                          f"must be declared before content means anything")
    comps = bom.get("compositions") or []
    if not comps:
        errors.append("no compositions[] — the BOM makes no completeness claim, so an "
                      "unlisted component proves nothing")
    for c in comps:
        if c.get("bom-ref") == "comp:pipeline-run" and c.get("aggregate") != "complete":
            warnings.append(f"completeness claim is {c.get('aggregate')!r}: "
                            f"{meta.get(f'{NS}:aibom.completenessClaim', 'n/a')}")
    absent = sorted(k[len(NS) + 7:] for k, v in meta.items()
                    if k.startswith(f"{NS}:input.") and v == "absent")
    if absent:
        warnings.append("producer reports absent (never ran or not pulled via needs:): "
                        + ", ".join(absent))

    # 4) No absence-as-clean, and identity fields, per model.
    for m in models:
        p = props(m)
        name = m.get("name", "?")
        if p.get(f"{NS}:role", "").startswith("model under evaluation"):
            if p.get(f"{NS}:resolved_id.disclosure"):
                warnings.append(f"hosted model '{name}': resolved model id not captured — a "
                                f"provider alias repoint is undetectable from this BOM")
            continue
        states = {k: p.get(f"{NS}:{k}.state") for k in ("modelscan", "modelaudit")}
        for scanner, state in states.items():
            if state is None:
                errors.append(f"model '{name}': {scanner}.state missing — cannot tell a clean "
                              f"scan from no scan")
            elif state != "present":
                warnings.append(f"model '{name}': {scanner} {state} (fields read not-scanned)")
        clam = p.get(f"{NS}:clamav.infected", "unknown")
        if all(s != "present" for s in states.values()) and clam == "unknown":
            errors.append(f"model '{name}': no scanner produced a verdict (modelscan, "
                          f"modelaudit, clamav all not-scanned/unknown)")
        if not m.get("version") or m.get("version") == "unknown":
            warnings.append(f"model '{name}': version unknown")
        if not m.get("purl"):
            warnings.append(f"model '{name}': no machine-processable identifier (purl)")
        if not m.get("supplier"):
            warnings.append(f"model '{name}': producer unknown")
        if not m.get("licenses"):
            warnings.append(f"model '{name}': licence unknown")
        if not m.get("version") and not p.get(f"{NS}:version.disclosure"):
            errors.append(f"model '{name}': version neither populated nor declared UNKNOWN")

    for d in (c for c in bom.get("components", []) if c.get("type") == "data"):
        p = props(d)
        if f"{NS}:dataset.scan.passed" in p and f"{NS}:dataset.scan.state" not in p:
            errors.append(f"dataset '{d.get('name','?')}': scan.passed without scan.state — "
                          f"absence may be rendered as a pass")

    # 5) Dependency graph.
    deps = bom.get("dependencies") or []
    root_ref = bom.get("metadata", {}).get("component", {}).get("bom-ref")
    if not deps:
        errors.append("no dependencies[] — flat inventory (CISA Dependency Relationship)")
    elif not any(d.get("ref") == root_ref and d.get("dependsOn") for d in deps):
        errors.append("dependencies[] has no edges from the root component")
    if str(meta.get(f"{NS}:dependencies.software_graph", "")).startswith("UNKNOWN"):
        warnings.append("software dependency edges are root-only (source SBOM had no graph)")

    # 6) Currency.
    if args.expect_commit:
        got = meta.get(f"{NS}:commit.sha")
        if got != args.expect_commit:
            errors.append(f"BOM describes commit {got!r}, expected {args.expect_commit!r} — "
                          f"stale for this revision")

    # 7) Accepted risks are owned and time-bounded.
    today = datetime.date.today().isoformat()
    unowned: list[str] = []
    for v in bom_vulns:
        if not v.get("analysis"):
            continue
        vp = props(v)
        owner = vp.get(f"{NS}:accepted_risk.owner")
        review = vp.get(f"{NS}:accepted_risk.review_by")
        if not owner or owner == "UNASSIGNED":
            unowned.append(str(v.get("id")))
        if not review:
            errors.append(f"accepted risk {v.get('id')}: no review date")
        elif review < today:
            errors.append(f"accepted risk {v.get('id')}: review date {review} has passed")

    if unowned:
        warnings.append(f"{len(unowned)} accepted risk(s) have no owner (set AIBOM_RISK_OWNER): "
                        + ", ".join(sorted(set(unowned))))

    if not (bom.get("metadata", {}).get("authors")):
        warnings.append("no BOM author recorded (set AIBOM_AUTHOR)")

    for w in warnings:
        print(f"::warning:: {w}")
    for e in errors:
        print(f"::error:: {e}")

    if not errors and not warnings:
        print("AI BOM content gate PASSED — no substance gaps in the document")
    elif not errors:
        print("AI BOM content gate PASSED with warnings (verification deferred)")
    else:
        verb = "FAILED" if args.enforce else "FAILED (advisory — teeth deferred, not blocking)"
        print(f"AI BOM content gate {verb} — {len(errors)} substance gap(s)")
        if args.enforce:
            sys.exit(1)


if __name__ == "__main__":
    main()
