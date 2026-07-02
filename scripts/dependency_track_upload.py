#!/usr/bin/env python3
"""Upload a CycloneDX BOM to Dependency-Track and gate on policy violations.

Dependency-Track is the continuous backend for the BOMs this pipeline already
emits: it ingests a CycloneDX SBOM (and the CycloneDX 1.6 AI BOM nested beneath
it) once, then re-analyses both against new CVEs and policy conditions as they
land — turning a point-in-time grype/trivy scan into ongoing monitoring.

Flow (mirrors DT's documented CI usage, POST /api/v1/bom multipart):
  1. POST the BOM with autoCreate=true. Pass parentName/parentVersion to nest the
     AI BOM under the application project so DT shows one project hierarchy.
  2. Poll GET /api/v1/bom/token/{token} until processing completes.
  3. Look up the project UUID, then pull findings and policy violations.
  4. Gate: fail when any non-suppressed violation has a violationState in the
     configured fail set (default: FAIL). VEX-suppressed violations never gate.

Honest scope: DT's vulnerability matching targets software components. The
machine-learning-model / data components in the AI BOM ride along as inventory
and policy targets but will not receive CVE matches — they are tracked, not
scanned. The gate here is policy-driven, which DOES apply to those components.

Skips cleanly (exit 0) when DT_API_URL / DT_API_KEY are not configured, so the
pipeline runs unchanged until a Dependency-Track instance is wired in.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover — surfaced clearly in CI
    requests = None


def _base_url() -> str:
    return (os.environ.get("DT_API_URL") or os.environ.get("DEPENDENCYTRACK_URL") or "").rstrip("/")


def _api_key() -> str:
    return os.environ.get("DT_API_KEY") or os.environ.get("DEPENDENCYTRACK_API_KEY") or ""


def upload_bom(base: str, key: str, bom: Path, name: str, version: str,
               parent_name: str | None, parent_version: str | None) -> str:
    """POST the BOM (multipart, autoCreate) and return the processing token."""
    data = {
        "autoCreate": "true",
        "projectName": name,
        "projectVersion": version,
    }
    if parent_name:
        data["parentName"] = parent_name
        data["parentVersion"] = parent_version or version
    with bom.open("rb") as fh:
        resp = requests.post(
            f"{base}/api/v1/bom",
            headers={"X-Api-Key": key},
            data=data,
            files={"bom": (bom.name, fh, "application/json")},
            timeout=60,
        )
    resp.raise_for_status()
    token = resp.json().get("token", "")
    print(f"  uploaded {bom.name} → {name} {version}"
          + (f" (child of {parent_name} {parent_version or version})" if parent_name else "")
          + f"; token={token or '(none)'}")
    return token


def wait_for_processing(base: str, key: str, token: str, timeout: int) -> bool:
    """Poll the token endpoint until DT finishes processing the BOM."""
    if not token:
        return True
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = requests.get(
            f"{base}/api/v1/bom/token/{token}",
            headers={"X-Api-Key": key},
            timeout=30,
        )
        resp.raise_for_status()
        if not resp.json().get("processing", False):
            return True
        time.sleep(3)
    print(f"  WARN: BOM still processing after {timeout}s — analysing partial results")
    return False


def lookup_project(base: str, key: str, name: str, version: str) -> dict | None:
    resp = requests.get(
        f"{base}/api/v1/project/lookup",
        headers={"X-Api-Key": key},
        params={"name": name, "version": version},
        timeout=30,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def get_findings(base: str, key: str, uuid: str) -> list:
    resp = requests.get(
        f"{base}/api/v1/finding/project/{uuid}",
        headers={"X-Api-Key": key},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json() if isinstance(resp.json(), list) else []


def get_violations(base: str, key: str, uuid: str) -> list:
    resp = requests.get(
        f"{base}/api/v1/violation/project/{uuid}",
        headers={"X-Api-Key": key},
        params={"suppressed": "false"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json() if isinstance(resp.json(), list) else []


def evaluate_project(base: str, key: str, name: str, version: str,
                     fail_states: set[str]) -> dict | None:
    """Resolve a project, pull its findings + violations, and collect the blocking ones.

    Returns a per-project result dict, or None when the project cannot be resolved
    after upload — the caller treats that as a gate error, never a silent pass.
    """
    project = lookup_project(base, key, name, version)
    if not project:
        return None
    uuid = project.get("uuid", "")

    findings = get_findings(base, key, uuid)
    by_sev: dict[str, int] = {}
    for f in findings:
        sev = (f.get("vulnerability", {}) or {}).get("severity", "UNKNOWN")
        by_sev[sev] = by_sev.get(sev, 0) + 1

    violations = get_violations(base, key, uuid)
    failing = [
        v for v in violations
        if not v.get("suppressed", False)
        and ((v.get("policyCondition", {}) or {}).get("policy", {}) or {})
            .get("violationState", "").upper() in fail_states
    ]

    return {
        "name": name,
        "version": version,
        "uuid": uuid,
        "dashboard_url": f"{base}/projects/{uuid}",
        "findings_total": len(findings),
        "findings_by_severity": by_sev,
        "violations_total": len(violations),
        "failing_violations": [
            {
                "project": name,
                "component": (v.get("component", {}) or {}).get("name"),
                "type": v.get("type"),
                "policy": (((v.get("policyCondition", {}) or {}).get("policy", {})) or {}).get("name"),
                "state": (((v.get("policyCondition", {}) or {}).get("policy", {})) or {}).get("violationState"),
            }
            for v in failing
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bom", required=True, help="primary CycloneDX BOM (the app SBOM)")
    parser.add_argument("--aibom", help="optional AI BOM to nest under the app project")
    parser.add_argument("--project-name", required=True)
    parser.add_argument("--project-version", required=True)
    parser.add_argument("--aibom-name", help="project name for the nested AI BOM")
    parser.add_argument("--report", required=True, help="output report JSON path")
    parser.add_argument("--fail-on", default="FAIL",
                        help="comma list of violationStates that fail the gate (default FAIL)")
    parser.add_argument("--poll-timeout", type=int, default=180,
                        help="seconds to wait for DT to finish processing each BOM")
    args = parser.parse_args()

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    def write(report: dict) -> None:
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    base, key = _base_url(), _api_key()
    if not base or not key:
        print("DT_API_URL / DT_API_KEY not set — Dependency-Track upload skipped")
        write({"skipped": True, "reason": "DT_API_URL/DT_API_KEY not configured"})
        return

    if requests is None:
        print("ERROR: requests not installed — cannot reach Dependency-Track")
        write({"skipped": True, "reason": "requests missing"})
        raise SystemExit(1)

    bom = Path(args.bom)
    if not bom.exists():
        print(f"No BOM at {bom} — nothing to upload")
        write({"skipped": True, "reason": "no BOM produced"})
        return

    fail_states = {s.strip().upper() for s in args.fail_on.split(",") if s.strip()}

    # 1) Upload the app SBOM (parent project).
    print(f"Dependency-Track: {base}")
    token = upload_bom(base, key, bom, args.project_name, args.project_version, None, None)

    # 2) Upload the AI BOM nested under the app project, if present.
    aibom = Path(args.aibom) if args.aibom else None
    if aibom and aibom.exists():
        aibom_name = args.aibom_name or f"{args.project_name}-aibom"
        aibom_token = upload_bom(
            base, key, aibom, aibom_name, args.project_version,
            parent_name=args.project_name, parent_version=args.project_version,
        )
    else:
        aibom_name, aibom_token = None, None
        if args.aibom:
            print(f"  AI BOM {args.aibom} not present — skipping nested upload")

    # 3) Wait for processing on both BOMs.
    wait_for_processing(base, key, token, args.poll_timeout)
    if aibom_token:
        wait_for_processing(base, key, aibom_token, args.poll_timeout)

    # 4) Evaluate the gate for EVERY project we uploaded — the parent app SBOM and,
    #    when present, the nested AI-BOM child. The AI-BOM's model/data components get
    #    no CVE match but ARE policy targets, so it must be evaluated, not just uploaded.
    targets = [(args.project_name, args.project_version)]
    if aibom_token:
        targets.append((aibom_name, args.project_version))

    results: list[dict] = []
    unresolved: list[str] = []
    for name, version in targets:
        result = evaluate_project(base, key, name, version, fail_states)
        if result is None:
            unresolved.append(f"{name} {version}")
            continue
        results.append(result)

    failing = [v for r in results for v in r["failing_violations"]]

    report = {
        "skipped": False,
        "uploaded": True,
        "project": next((r for r in results if r["name"] == args.project_name), None),
        "ai_bom_project": next((r for r in results if r["name"] == aibom_name), None) if aibom_name else None,
        "projects": results,
        "unresolved_projects": unresolved,
        "failing_violations": failing,
        "gate_fail_states": sorted(fail_states),
    }
    write(report)

    for r in results:
        print(f"  [{r['name']}] findings: {r['findings_total']} ({r['findings_by_severity']}); "
              f"violations: {r['violations_total']} total, {len(r['failing_violations'])} at fail-state")
        print(f"    dashboard: {r['dashboard_url']}")

    # An uploaded project we could not resolve means we could not evaluate policy on it.
    # That must fail the gate — never let a configured gate pass without evaluating.
    if unresolved:
        print(f"DEPENDENCY-TRACK GATE FAILED — {len(unresolved)} uploaded project(s) "
              f"could not be resolved for evaluation (DT may still be indexing): "
              f"{', '.join(unresolved)}")
        raise SystemExit(1)

    if failing:
        print(f"DEPENDENCY-TRACK GATE FAILED — {len(failing)} blocking policy violation(s):")
        for v in failing:
            print(f"  [{v['state']}] {v['policy']} — {v['component']} ({v['type']}) "
                  f"in {v['project']}")
        raise SystemExit(1)

    print("Dependency-Track gate PASSED — no blocking policy violations")


if __name__ == "__main__":
    main()
