#!/usr/bin/env python3
"""Normalise every CI signal into one operational-metrics JSON document.

`write_ci_evidence_summary.py` answers "did each artifact get produced?". This
answers "what do the artifacts *say*?" — it reads the security, supply-chain,
model-integrity, AI-eval, and data-quality reports this pipeline already emits,
plus GitLab's own pipeline/job API, and folds them into a single normalised
document that a dashboard can render without knowing any tool's native shape.

Design (mirrors the rest of scripts/):
  - Every parser is defensive: a missing or malformed input is recorded in
    `sources` as absent/error and simply omitted from the metrics — it never
    aborts the run. This job is reporting, not gating, so it exits 0 always.
  - Output has three views of the same data:
      sections  — grouped, human-shaped (security, model_integrity, …)
      metrics   — a flat {dotted.key: number} map for charting/trend diffing
      gates     — derived pass/fail/skip per signal, for an at-a-glance banner
  - The GitLab-native block calls the Pipelines/Jobs API when a token is set;
    it skips cleanly (like dependency_track_upload.py) when it is not.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:  # pragma: no cover — only the GitLab-API block needs it
    requests = None


# ── loading helpers ───────────────────────────────────────────────────────────

class Sources:
    """Tracks which inputs were present, absent, or failed to parse."""

    def __init__(self) -> None:
        self.status: dict[str, str] = {}

    def mark(self, name: str, state: str) -> None:
        self.status[name] = state


def _load_json(path: Path, sources: Sources, label: str) -> Any | None:
    if not path.exists():
        sources.mark(label, "absent")
        return None
    try:
        data = json.loads(path.read_text())
        sources.mark(label, "present")
        return data
    except Exception as exc:  # malformed JSON — record and move on
        sources.mark(label, f"error: {exc}")
        return None


def _load_env(path: Path, sources: Sources, label: str) -> dict[str, str]:
    """Parse a KEY=value .env-style file into a dict."""
    if not path.exists():
        sources.mark(label, "absent")
        return {}
    out: dict[str, str] = {}
    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
        sources.mark(label, "present")
    except Exception as exc:
        sources.mark(label, f"error: {exc}")
    return out


def _load_lines(path: Path, sources: Sources, label: str) -> list[str]:
    if not path.exists():
        sources.mark(label, "absent")
        return []
    try:
        lines = [ln for ln in path.read_text().splitlines() if ln.strip()]
        sources.mark(label, "present")
        return lines
    except Exception as exc:
        sources.mark(label, f"error: {exc}")
        return []


def _rate(items: list, key: str) -> float | None:
    """Pass-rate over a list of records using a boolean/decision field."""
    if not items:
        return None
    passed = 0
    for it in items:
        v = it.get(key) if isinstance(it, dict) else None
        if v is True or (isinstance(v, str) and v.lower() in ("pass", "passed", "allow", "safe")):
            passed += 1
    return round(passed / len(items), 4)


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ── output accumulator ─────────────────────────────────────────────────────────

class Metrics:
    """Collects the three views and the gate ledger."""

    def __init__(self) -> None:
        self.sections: dict[str, dict] = {}
        self.flat: dict[str, float] = {}
        self.gates: dict[str, list[dict]] = {"passed": [], "failed": [], "skipped": []}

    def section(self, name: str, payload: dict) -> None:
        if payload:
            self.sections.setdefault(name, {}).update(payload)

    def metric(self, key: str, value: Any) -> None:
        n = _num(value)
        if n is not None:
            self.flat[key] = round(n, 6)

    def gate(self, name: str, state: str | None, detail: str = "") -> None:
        """state: True=passed, False=failed, None=skipped/unknown."""
        bucket = "skipped" if state is None else ("passed" if state else "failed")
        self.gates[bucket].append({"signal": name, "detail": detail})


# ── parsers: security & supply chain ───────────────────────────────────────────

def parse_security(reports: Path, sbom: Path, src: Sources, m: Metrics) -> None:
    sec: dict[str, Any] = {}

    semgrep = _load_json(reports / "semgrep.json", src, "semgrep.json")
    if isinstance(semgrep, dict):
        results = semgrep.get("results", []) or []
        by_sev: dict[str, int] = {}
        for r in results:
            sev = (r.get("extra", {}) or {}).get("severity", "UNKNOWN")
            by_sev[sev] = by_sev.get(sev, 0) + 1
        sec["sast"] = {"findings": len(results), "by_severity": by_sev}
        m.metric("security.sast.findings", len(results))
        m.gate("semgrep-sast", len(results) == 0, f"{len(results)} finding(s)")

    # GitLab secret-detection report (vulnerabilities[]) and/or the raw one.
    for fname, label in (("secret-detection.json", "secret-detection.json"),
                         ("gl-secret-detection-report.json", "gl-secret-detection-report.json")):
        sd = _load_json(reports / fname, src, label)
        if isinstance(sd, dict) and "secrets" not in sec:
            vulns = sd.get("vulnerabilities", []) or []
            by_sev = {}
            for v in vulns:
                s = v.get("severity", "Unknown")
                by_sev[s] = by_sev.get(s, 0) + 1
            sec["secrets"] = {"findings": len(vulns), "by_severity": by_sev}
            m.metric("security.secrets.findings", len(vulns))
            m.gate("secret-detection", len(vulns) == 0, f"{len(vulns)} secret(s)")

    gitleaks = _load_json(reports / "gitleaks.json", src, "gitleaks.json")
    if gitleaks is not None:
        findings = gitleaks if isinstance(gitleaks, list) else gitleaks.get("findings", [])
        count = len(findings or [])
        sec["gitleaks"] = {"findings": count}
        m.metric("security.gitleaks.findings", count)
        m.gate("gitleaks-scan", count == 0, f"{count} leak(s)")

    pip_audit = _load_json(reports / "pip-audit.json", src, "pip-audit.json")
    if pip_audit is not None:
        deps = pip_audit.get("dependencies", []) if isinstance(pip_audit, dict) else pip_audit
        vuln_total = 0
        affected = 0
        for d in deps or []:
            vulns = (d.get("vulns") or d.get("vulnerabilities") or []) if isinstance(d, dict) else []
            if vulns:
                affected += 1
                vuln_total += len(vulns)
        sec["dependencies"] = {"vulnerabilities": vuln_total, "affected_packages": affected}
        m.metric("security.deps.vulnerabilities", vuln_total)
        m.metric("security.deps.affected_packages", affected)
        m.gate("pip-audit", vuln_total == 0, f"{vuln_total} vuln(s) in {affected} pkg(s)")

    pkg = _load_env(reports / "pkg-integrity.env", src, "pkg-integrity.env")
    if pkg:
        mode = pkg.get("MODE") or pkg.get("PKG_INTEGRITY_MODE") or "unknown"
        sec["package_integrity"] = {"mode": mode}

    m.section("security", sec)


def parse_supply_chain(reports: Path, sbom: Path, src: Sources, m: Metrics) -> None:
    sc: dict[str, Any] = {}

    cdx = _load_json(sbom / "sbom.cyclonedx.json", src, "sbom.cyclonedx.json")
    if isinstance(cdx, dict):
        comps = cdx.get("components", []) or []
        sc["sbom_cyclonedx"] = {"components": len(comps)}
        m.metric("supply_chain.sbom.components", len(comps))

    spdx = _load_json(sbom / "sbom.spdx.json", src, "sbom.spdx.json")
    if isinstance(spdx, dict):
        pkgs = spdx.get("packages", []) or []
        sc["sbom_spdx"] = {"packages": len(pkgs)}

    aibom = _load_json(sbom / "aibom.cyclonedx.json", src, "aibom.cyclonedx.json")
    if isinstance(aibom, dict):
        comps = aibom.get("components", []) or []
        by_type: dict[str, int] = {}
        for c in comps:
            t = c.get("type", "unknown")
            by_type[t] = by_type.get(t, 0) + 1
        sc["ai_bom"] = {"components": len(comps), "by_type": by_type}
        m.metric("supply_chain.ai_bom.components", len(comps))

    # Container/filesystem vuln scanners → severity histograms.
    grype = _load_json(reports / "grype.json", src, "grype.json")
    if isinstance(grype, dict):
        by_sev: dict[str, int] = {}
        for match in grype.get("matches", []) or []:
            sev = (match.get("vulnerability", {}) or {}).get("severity", "Unknown")
            by_sev[sev] = by_sev.get(sev, 0) + 1
        sc["grype"] = {"by_severity": by_sev, "total": sum(by_sev.values())}
        for sev, n in by_sev.items():
            m.metric(f"supply_chain.grype.{sev.lower()}", n)
        crit = by_sev.get("Critical", 0) + by_sev.get("High", 0)
        m.gate("grype-scan", crit == 0, f"{crit} critical/high")

    for fname, key in (("trivy-fs.json", "trivy_fs"), ("trivy-image.json", "trivy_image")):
        trivy = _load_json(reports / fname, src, fname)
        if isinstance(trivy, dict):
            by_sev = {}
            for res in trivy.get("Results", []) or []:
                for v in res.get("Vulnerabilities", []) or []:
                    s = v.get("Severity", "UNKNOWN")
                    by_sev[s] = by_sev.get(s, 0) + 1
            sc[key] = {"by_severity": by_sev, "total": sum(by_sev.values())}
            for sev, n in by_sev.items():
                m.metric(f"supply_chain.{key}.{sev.lower()}", n)

    dt = _load_json(reports / "dependency-track.json", src, "dependency-track.json")
    if isinstance(dt, dict) and not dt.get("skipped"):
        sc["dependency_track"] = {
            "findings_total": dt.get("findings_total"),
            "findings_by_severity": dt.get("findings_by_severity", {}),
            "violations_total": dt.get("violations_total"),
            "failing_violations": len(dt.get("failing_violations", []) or []),
            "dashboard_url": dt.get("dashboard_url"),
        }
        m.metric("supply_chain.dependency_track.findings", dt.get("findings_total"))
        m.metric("supply_chain.dependency_track.violations", dt.get("violations_total"))
        failing = len(dt.get("failing_violations", []) or [])
        m.gate("dependency-track", failing == 0, f"{failing} failing violation(s)")

    m.section("supply_chain", sc)


# ── parsers: model & dataset integrity ─────────────────────────────────────────

# Canonical model-digest line: "<path>  sha256:<64-hex>" — kept in sync with
# DIGEST_RE in build_ai_bom.py so the metrics and the AI BOM count digests alike.
_MODEL_DIGEST_RE = re.compile(r"^.+?\s+sha256:[0-9a-f]{64}\s*$")


def parse_model_integrity(reports: Path, evidence: Path, src: Sources, m: Metrics) -> None:
    mi: dict[str, Any] = {}

    digests = _load_lines(evidence / "model-digests.txt", src, "model-digests.txt")
    if digests:
        # Lines are "<path>  sha256:<64-hex>" (see .gitlab-ci.yml model-digest job);
        # a "WARNING: No model files found" line is written when MODEL_DIR is empty.
        # Count only real digest entries — the old check looked at the filepath token
        # (split()[0]) and never stripped the "sha256:" prefix, so it always reported
        # sha_coverage=0 and would miscount the warning line as a digest. Mirror the
        # canonical DIGEST_RE in build_ai_bom.py so both consumers agree.
        hashed = [ln for ln in digests if _MODEL_DIGEST_RE.match(ln.strip())]
        mi["model_digests"] = {"count": len(hashed), "sha_coverage": len(hashed)}
        m.metric("model.digests.count", len(hashed))

    integ = _load_env(evidence / "integrity.env", src, "integrity.env")
    if integ:
        # The tamper job writes `tamper_check_passed=true` (see .gitlab-ci.yml).
        # Read that key directly — the old substring scan for "PASS"/"FAIL" never
        # matched the literal "true" value, so it always reported a false failure.
        passed = integ.get("tamper_check_passed", "").strip().lower() == "true"
        mi["tamper_check"] = {"raw": integ, "passed": passed}
        m.gate("tamper-verification", passed, str(integ))

    modelscan = _load_json(reports / "modelscan.json", src, "modelscan.json")
    if isinstance(modelscan, dict):
        summary = modelscan.get("summary", {}) or {}
        by_sev = summary.get("total_issues_by_severity") or summary.get("by_severity") or {}
        if not by_sev:  # fall back to scanning an issues[] list
            for issue in modelscan.get("issues", []) or []:
                s = (issue.get("severity") or "UNKNOWN").upper()
                by_sev[s] = by_sev.get(s, 0) + 1
        mi["modelscan"] = {"by_severity": by_sev}
        for sev, n in by_sev.items():
            m.metric(f"model.modelscan.{str(sev).lower()}", n)
        crit = by_sev.get("CRITICAL", 0) + by_sev.get("HIGH", 0)
        m.gate("modelscan", crit == 0, f"{crit} critical/high issue(s)")

    mfa = _load_json(reports / "modelfile-audit.json", src, "modelfile-audit.json")
    if isinstance(mfa, dict):
        files = mfa.get("files", mfa.get("modelfiles", [])) or []
        mi["modelfile_audit"] = {"count": mfa.get("count", len(files))}
        m.metric("model.modelfiles.count", mfa.get("count", len(files)))

    clam = _load_json(reports / "clamav-model.json", src, "clamav-model.json")
    if isinstance(clam, dict):
        infected = clam.get("infected", clam.get("infected_files", 0))
        mi["clamav"] = {"infected": infected}
        m.metric("model.clamav.infected", infected)
        m.gate("clamav-scan", (infected or 0) == 0, f"{infected} infected")

    hf = _load_json(reports / "hf-scan/summary.json", src, "hf-scan/summary.json")
    if isinstance(hf, dict):
        mi["hf_scan"] = {
            "models_scanned": hf.get("models_scanned", hf.get("count")),
            "gated": hf.get("gated"),
            "downloads": hf.get("downloads"),
            "clamav_infected": hf.get("clamav_infected", hf.get("infected")),
            "modelscan_critical": hf.get("modelscan_critical"),
        }
        m.metric("model.hf.clamav_infected", hf.get("clamav_infected", hf.get("infected")))

    m.section("model_integrity", mi)


def parse_data(reports: Path, src: Sources, m: Metrics) -> None:
    d: dict[str, Any] = {}

    dl = _load_json(reports / "dataset-download.json", src, "dataset-download.json")
    if isinstance(dl, dict):
        d["download"] = {"size": dl.get("size", dl.get("bytes")), "sha256": dl.get("sha256", dl.get("sha"))}

    scan = _load_json(reports / "dataset-scan.json", src, "dataset-scan.json")
    if isinstance(scan, dict):
        findings = scan.get("findings", []) or []
        valid = scan.get("valid", not findings)
        d["scan"] = {"valid": valid, "findings": len(findings) if isinstance(findings, list) else findings}
        m.gate("dataset-scan", bool(valid), f"{d['scan']['findings']} finding(s)")

    redact = _load_json(reports / "dataset-redact.json", src, "dataset-redact.json")
    if isinstance(redact, dict) and not redact.get("skipped"):
        d["redaction"] = {
            "secret_redactions": redact.get("secret_redactions"),
            "pii_redactions": redact.get("pii_redactions"),
            "pii_by_type": redact.get("pii_by_type", {}),
            "changed": redact.get("changed"),
            "threshold_breaches": redact.get("threshold_breaches", []),
        }
        m.metric("data.redaction.secrets", redact.get("secret_redactions"))
        m.metric("data.redaction.pii", redact.get("pii_redactions"))
        m.gate("dataset-redact", not redact.get("threshold_breaches"),
               "; ".join(redact.get("threshold_breaches", [])) or "within thresholds")

    val = _load_json(reports / "eval-dataset-validation.json", src, "eval-dataset-validation.json")
    if isinstance(val, dict) and not val.get("skipped"):
        d["eval_dataset"] = {
            "valid": val.get("valid"),
            "records": val.get("records"),
            "error_count": val.get("error_count"),
        }
        m.metric("data.eval_dataset.records", val.get("records"))
        m.metric("data.eval_dataset.errors", val.get("error_count"))
        m.gate("eval-dataset-validate", bool(val.get("valid")), f"{val.get('error_count')} schema error(s)")

    m.section("data_quality", d)


# ── parsers: AI evaluation & guardrails ─────────────────────────────────────────

def parse_ai_eval(reports: Path, src: Sources, m: Metrics) -> None:
    ev: dict[str, Any] = {}

    pf = _load_json(reports / "promptfoo-results.json", src, "promptfoo-results.json")
    if isinstance(pf, dict):
        stats = (pf.get("results", {}) or {}).get("stats", {}) if isinstance(pf.get("results"), dict) else {}
        succ, fail = stats.get("successes"), stats.get("failures")
        if isinstance(succ, (int, float)) and isinstance(fail, (int, float)) and (succ + fail):
            rate = round(succ / (succ + fail), 4)
            ev["promptfoo"] = {"successes": succ, "failures": fail, "pass_rate": rate}
            m.metric("ai_eval.promptfoo.pass_rate", rate)
            m.gate("promptfoo-eval", fail == 0, f"{succ}/{succ + fail} passed")

    garak = _load_json(reports / "garak-results.json", src, "garak-results.json")
    if isinstance(garak, dict):
        s = garak.get("summary", {}) or {}
        total = s.get("total")
        if isinstance(total, (int, float)) and total:
            rate = round(float(s.get("passed", 0)) / total, 4)
            ev["garak"] = {"total": total, "passed": s.get("passed"), "pass_rate": rate}
            m.metric("ai_eval.garak.pass_rate", rate)

    insp_sum = _load_json(reports / "inspect-summary.json", src, "inspect-summary.json")
    insp = _load_json(reports / "inspect-ai-results.json", src, "inspect-ai-results.json")
    insp_block: dict[str, Any] = {}
    if isinstance(insp_sum, dict):
        insp_block.update({
            "evals": insp_sum.get("evals", insp_sum.get("count")),
            "passed": insp_sum.get("passed"),
            "failed": insp_sum.get("failed"),
        })
    if isinstance(insp, dict):
        if isinstance(insp.get("score"), (int, float)):
            insp_block["score"] = round(float(insp["score"]), 4)
            m.metric("ai_eval.inspect.score", insp["score"])
        r = _rate(insp.get("cases", []), "pass")
        if r is not None:
            insp_block["pass_rate"] = r
            m.metric("ai_eval.inspect.pass_rate", r)
    if insp_block:
        ev["inspect"] = insp_block

    pyrit = _load_json(reports / "pyrit-results.json", src, "pyrit-results.json")
    if isinstance(pyrit, dict):
        r = _rate(pyrit.get("conversations", []), "decision")
        if r is not None:
            ev["pyrit"] = {"pass_rate": r}
            m.metric("ai_eval.pyrit.pass_rate", r)

    guard = _load_json(reports / "guardrail-regression.json", src, "guardrail-regression.json")
    if isinstance(guard, dict):
        r = None
        for k in ("results", "checks"):
            r = _rate(guard.get(k, []), "pass")
            if r is not None:
                break
        if r is None and isinstance(guard.get("passed"), bool):
            r = 1.0 if guard["passed"] else 0.0
        if r is not None:
            ev["guardrail_regression"] = {"pass_rate": r}
            m.metric("ai_eval.guardrail.pass_rate", r)
            m.gate("guardrail-regression", r >= 1.0, f"pass_rate={r}")

    markllm = _load_json(reports / "markllm-results.json", src, "markllm-results.json")
    if isinstance(markllm, dict):
        ev["markllm"] = {
            "ready": markllm.get("ready", markllm.get("readiness")),
            "import_ok": markllm.get("import_ok", markllm.get("import_status")),
        }

    giskard = _load_json(reports / "giskard-results.json", src, "giskard-results.json")
    if isinstance(giskard, dict):
        findings = giskard.get("findings", []) or []
        high = sum(1 for f in findings if isinstance(f, dict) and f.get("severity") == "high")
        ev["giskard"] = {"findings": len(findings), "high_findings": high}
        m.metric("ai_eval.giskard.high_findings", high)

    drift = _load_json(reports / "model-drift.json", src, "model-drift.json")
    if isinstance(drift, dict) and not drift.get("skipped"):
        ev["model_drift"] = {
            "drift_detected": drift.get("drift_detected"),
            "drifted": [d.get("metric") for d in drift.get("drifted", []) or []],
            "threshold": drift.get("threshold"),
            "seeded": drift.get("seeded"),
        }
        m.gate("model-drift-detection", not drift.get("drift_detected"),
               f"{len(drift.get('drifted', []) or [])} metric(s) drifted")

    m.section("ai_evaluation", ev)


def parse_data_quality(reports: Path, src: Sources, m: Metrics) -> None:
    """Great Expectations / YData / Evidently / DVC (advisory, not gated)."""
    dq = m.sections.setdefault("data_quality", {})

    ge = _load_json(reports / "great-expectations.json", src, "great-expectations.json")
    if isinstance(ge, dict) and not ge.get("skipped"):
        dq["great_expectations"] = {
            "success": ge.get("success"),
            "records": ge.get("records"),
            "expectations_evaluated": ge.get("expectations_evaluated"),
        }
        m.metric("data.ge.records", ge.get("records"))
        m.metric("data.ge.expectations", ge.get("expectations_evaluated"))

    yd = _load_json(reports / "ydata-profile.json", src, "ydata-profile.json")
    if isinstance(yd, dict) and not yd.get("skipped"):
        alerts = yd.get("alerts", []) or []
        dq["ydata_profile"] = {
            "n_columns": yd.get("n_columns", yd.get("columns")),
            "alerts": len(alerts) if isinstance(alerts, list) else alerts,
        }

    ed = _load_json(reports / "evidently-drift.json", src, "evidently-drift.json")
    if isinstance(ed, dict) and not ed.get("skipped"):
        drifted = ed.get("drifted_columns", ed.get("drifted", [])) or []
        dq["evidently"] = {
            "drift_detected": ed.get("drift_detected"),
            "drift_share": ed.get("drift_share"),
            "drifted_columns": len(drifted) if isinstance(drifted, list) else drifted,
        }
        m.metric("data.evidently.drift_share", ed.get("drift_share"))

    dvc = _load_json(reports / "dvc-status.json", src, "dvc-status.json")
    if isinstance(dvc, dict):
        dq["dvc"] = {"clean": dvc.get("clean", not dvc.get("changes"))}


# ── parsers: provenance & GitLab-native operational health ──────────────────────

def parse_provenance(evidence: Path, src: Sources, m: Metrics) -> dict:
    prov: dict[str, Any] = {}
    vi = _load_json(evidence / "version-info.json", src, "version-info.json")
    if isinstance(vi, dict):
        prov.update(vi)
    return prov


def fetch_gitlab_operational(token_env: str, timeout: int, m: Metrics) -> dict:
    """Pull pipeline + per-job operational health from the GitLab API.

    Skips cleanly (like dependency_track_upload.py) when the token or the
    pipeline/project context is not configured, or when `requests` is missing.
    """
    api = (os.environ.get("CI_API_V4_URL") or "").rstrip("/")
    project = os.environ.get("CI_PROJECT_ID")
    pipeline = os.environ.get("CI_PIPELINE_ID")
    token = os.environ.get(token_env) or os.environ.get("GITLAB_API_TOKEN")

    if not token:
        names = token_env if token_env == "GITLAB_API_TOKEN" else f"{token_env}/GITLAB_API_TOKEN"
        return {"skipped": True, "reason": f"{names} not set"}
    if not (api and project and pipeline):
        return {"skipped": True, "reason": "CI_API_V4_URL/CI_PROJECT_ID/CI_PIPELINE_ID missing"}
    if requests is None:
        return {"skipped": True, "reason": "requests not installed"}

    headers = {"PRIVATE-TOKEN": token}
    base = f"{api}/projects/{project}/pipelines/{pipeline}"
    try:
        pipe = requests.get(base, headers=headers, timeout=timeout)
        pipe.raise_for_status()
        pj = pipe.json()

        jobs: list[dict] = []
        page = 1
        while True:
            resp = requests.get(f"{base}/jobs", headers=headers,
                                params={"per_page": 100, "page": page}, timeout=timeout)
            resp.raise_for_status()
            batch = resp.json()
            if not batch:
                break
            jobs.extend(batch)
            if len(batch) < 100:
                break
            page += 1
    except Exception as exc:
        return {"skipped": True, "reason": f"GitLab API error: {exc}"}

    by_stage: dict[str, dict[str, int]] = {}
    job_rows = []
    for j in jobs:
        stage = j.get("stage", "unknown")
        status = j.get("status", "unknown")
        by_stage.setdefault(stage, {})
        by_stage[stage][status] = by_stage[stage].get(status, 0) + 1
        job_rows.append({
            "name": j.get("name"),
            "stage": stage,
            "status": status,
            "duration": j.get("duration"),
            "queued_duration": j.get("queued_duration"),
            "allow_failure": j.get("allow_failure"),
            "artifacts_size": (j.get("artifacts_file") or {}).get("size"),
        })

    m.metric("operational.pipeline.duration", pj.get("duration"))
    m.metric("operational.pipeline.queued_duration", pj.get("queued_duration"))
    m.metric("operational.jobs.total", len(job_rows))
    m.metric("operational.jobs.failed",
             sum(1 for r in job_rows if r["status"] == "failed" and not r["allow_failure"]))

    return {
        "skipped": False,
        "status": pj.get("status"),
        "ref": pj.get("ref"),
        "source": pj.get("source"),
        "sha": pj.get("sha"),
        "duration": pj.get("duration"),
        "queued_duration": pj.get("queued_duration"),
        "coverage": pj.get("coverage"),
        "created_at": pj.get("created_at"),
        "started_at": pj.get("started_at"),
        "finished_at": pj.get("finished_at"),
        "web_url": pj.get("web_url"),
        "jobs_total": len(job_rows),
        "jobs_by_stage": by_stage,
        "jobs": job_rows,
    }


# ── main ────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reports", required=True, help="REPORTS_DIR")
    parser.add_argument("--evidence", required=True, help="EVIDENCE_DIR")
    parser.add_argument("--sbom", required=True, help="SBOM_DIR")
    parser.add_argument("--out", required=True, help="output operational-metrics JSON path")
    parser.add_argument("--timestamp", default="",
                        help="ISO generated_at (defaults to CI_PIPELINE_CREATED_AT or 'unknown')")
    parser.add_argument("--gitlab-token-env", default="GITLAB_API_TOKEN",
                        help="env var holding a read_api token for the GitLab API block")
    parser.add_argument("--gitlab-timeout", type=int, default=30)
    args = parser.parse_args()

    reports, evidence, sbom = Path(args.reports), Path(args.evidence), Path(args.sbom)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    src = Sources()
    m = Metrics()

    parse_security(reports, sbom, src, m)
    parse_supply_chain(reports, sbom, src, m)
    parse_model_integrity(reports, evidence, src, m)
    parse_data(reports, src, m)
    parse_ai_eval(reports, src, m)
    parse_data_quality(reports, src, m)

    provenance = parse_provenance(evidence, src, m)
    operational = fetch_gitlab_operational(args.gitlab_token_env, args.gitlab_timeout, m)

    ts = (args.timestamp or os.environ.get("CI_PIPELINE_CREATED_AT") or "unknown")
    document = {
        "schema_version": "1.0",
        "generated_at": ts,
        "pipeline": {
            "id": os.environ.get("CI_PIPELINE_ID"),
            "commit_sha": os.environ.get("CI_COMMIT_SHA"),
            "short_sha": os.environ.get("CI_COMMIT_SHORT_SHA"),
            "ref": os.environ.get("CI_COMMIT_REF_NAME"),
            "project": os.environ.get("CI_PROJECT_PATH"),
            "provenance": provenance,
        },
        "gates": {
            "passed": len(m.gates["passed"]),
            "failed": len(m.gates["failed"]),
            "skipped": len(m.gates["skipped"]),
            "detail": m.gates,
        },
        "operational": operational,
        "sections": m.sections,
        "metrics": m.flat,
        "sources": src.status,
    }

    out.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    present = sum(1 for v in src.status.values() if v == "present")
    print(f"operational-metrics → {out}")
    print(f"  sources: {present}/{len(src.status)} present")
    print(f"  metrics: {len(m.flat)} numeric")
    print(f"  gates: {len(m.gates['passed'])} passed, "
          f"{len(m.gates['failed'])} failed, {len(m.gates['skipped'])} skipped")
    if operational.get("skipped"):
        print(f"  gitlab-api: skipped ({operational.get('reason')})")
    else:
        print(f"  gitlab-api: pipeline {operational.get('status')} "
              f"in {operational.get('duration')}s, {operational.get('jobs_total')} jobs")


if __name__ == "__main__":
    main()
