#!/usr/bin/env python3
"""Assemble a consolidated CycloneDX 1.6 AI BOM (AI/ML Bill of Materials).

Two modes:

  build  (default) — Merge every element the pipeline produces into ONE
    CycloneDX document:
      - software components  ← syft software SBOM (sbom.cyclonedx.json)
      - machine-learning-model components ← model-digests.txt + model.sig +
            ModelScan / ModelAudit / ClamAV verdicts + HuggingFace card metadata
      - data components      ← dataset-digest.txt + dataset-download/scan
            reports + dataset.sig (signed training data)
      - AI evaluation evidence ← garak / giskard / inspect-ai / promptfoo /
            guardrail-regression results, attached to the root component.
    Model and dataset signatures are embedded as base64 `data:` URIs so the BOM
    is self-describing — those signatures cover the model/dataset bytes, not the
    BOM, so embedding them changes nothing they attest.

The BOM's OWN signature is applied separately, downstream, as a native CycloneDX
enveloped signature (`cyclonedx sign bom` over the XML rendering) — it verifies
as-is with `cyclonedx verify all`, no canonical reconstruction. Only the model
and dataset signatures (which attest their own bytes, not the BOM) are embedded
here.

Everything is optional: a missing input is skipped, never fatal, so the BOM
degrades gracefully as the pipeline's stages light up. Output is canonical
CycloneDX 1.6 JSON — the established "AI BOM" interchange format.

Hand-built against the CycloneDX 1.6 JSON schema rather than via a library so
the ML-BOM surface (modelCard, componentData) stays fully under our control and
adds no runtime dependency, matching the stdlib-only style of the other scripts.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

SPEC_VERSION = "1.6"
PROP_NS = "gaips"  # property namespace prefix, per CycloneDX property conventions

DIGEST_RE = re.compile(r"^(?P<path>.+?)\s+sha256:(?P<sha>[0-9a-f]{64})\s*$")


# ── helpers ──────────────────────────────────────────────────────────────────

def _load_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _prop(name: str, value: Any) -> dict[str, str]:
    return {"name": f"{PROP_NS}:{name}", "value": str(value)}


def _sha256_hash(content: str) -> dict[str, str]:
    return {"alg": "SHA-256", "content": content}


def _data_uri(path: Path, mime: str) -> str | None:
    """base64 `data:` URI for a (small) signature/cert file, or None if absent."""
    try:
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    except Exception:
        return None
    return f"data:{mime};base64,{b64}"


def _signature_refs(sig: Path, cert: Path, subject: str) -> list[dict]:
    """External references embedding a cosign signature + Fulcio cert inline.

    `type: "other"` is used (guaranteed valid across CycloneDX versions) with the
    semantics carried in `comment`. Safe to embed: these sign `subject`, not the
    BOM that carries them.
    """
    refs: list[dict] = []
    sig_uri = _data_uri(sig, "application/octet-stream")
    if sig_uri:
        refs.append({
            "type": "other",
            "url": sig_uri,
            "comment": f"cosign keyless signature (Sigstore) over {subject}",
        })
        cert_uri = _data_uri(cert, "application/x-pem-file")
        if cert_uri:
            refs.append({
                "type": "other",
                "url": cert_uri,
                "comment": f"cosign signing certificate (Fulcio X.509, PEM) for {subject}",
            })
    return refs


def _parse_digest_file(path: Path) -> list[tuple[str, str]]:
    """Parse 'path  sha256:<hex>' lines → [(path, sha), ...]."""
    out: list[tuple[str, str]] = []
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        m = DIGEST_RE.match(line.strip())
        if m:
            out.append((m.group("path"), m.group("sha")))
    return out


# ── component builders ───────────────────────────────────────────────────────

def _software_components(sbom_dir: Path, reports_dir: Path) -> list[dict]:
    """Lift `components` straight out of the syft software SBOM (and pip-audit)."""
    for candidate in (
        sbom_dir / "sbom.cyclonedx.json",
        reports_dir / "pip-audit-cyclonedx.json",
    ):
        doc = _load_json(candidate)
        if doc and isinstance(doc.get("components"), list):
            comps = doc["components"]
            for c in comps:
                c.setdefault("type", "library")
            return comps
    return []


def _model_components(
    evidence_dir: Path, reports_dir: Path, model_dir: Path
) -> list[dict]:
    """machine-learning-model components from digests + signatures + scans."""
    modelscan = _load_json(reports_dir / "modelscan.json") or {}
    scan_summary = (
        modelscan.get("summary", {}).get("total_issues_by_severity", {})
        if isinstance(modelscan, dict)
        else {}
    )
    modelaudit = _load_json(reports_dir / "modelaudit-summary.json") or {}
    clamav = _load_json(reports_dir / "clamav-model.json") or {}
    hf = _load_json(reports_dir / "hf-scan" / "summary.json") or {}
    hf_by_id = {
        rec.get("model_id"): rec
        for rec in (hf.get("scanned") or [])
        if isinstance(rec, dict)
    }

    components: list[dict] = []
    digests = _parse_digest_file(evidence_dir / "model-digests.txt")
    digests += _parse_digest_file(evidence_dir / "modelfile-digests.txt")

    for path, sha in digests:
        name = Path(path).name
        # model-sign writes <model_dir>/model.sig next to each model artifact.
        sig = Path(path).parent / "model.sig"
        cert = Path(path).parent / "model.pem"
        ext_refs = _signature_refs(sig, cert, subject=f"model {name}")
        signed = bool(ext_refs)

        props = [
            _prop("artifact.path", path),
            _prop("modelscan.critical", scan_summary.get("CRITICAL", 0)),
            _prop("modelscan.high", scan_summary.get("HIGH", 0)),
            _prop("modelaudit.critical", modelaudit.get("critical", 0)),
            _prop("modelaudit.findings", modelaudit.get("findings", 0)),
            _prop("clamav.infected", clamav.get("infected", "unknown")),
            _prop("signed", "true" if signed else "false"),
        ]

        model_card: dict[str, Any] = {
            "modelParameters": {},
            "quantitativeAnalysis": {},
            "considerations": {
                "technicalLimitations": [
                    "Integrity attested via SHA-256 digest and Sigstore signature; "
                    "behavioural safety covered by the ai-eval stage."
                ],
            },
        }

        # Fold HuggingFace card metadata in when this artifact maps to an HF repo
        for hf_id, rec in hf_by_id.items():
            if hf_id and (hf_id.split("/")[-1] in path):
                meta = rec.get("card_meta") or {}
                if meta.get("pipeline_tag"):
                    model_card["modelParameters"]["task"] = meta["pipeline_tag"]
                props.append(_prop("huggingface.repo", hf_id))
                props.append(_prop("huggingface.gated", meta.get("gated", "unknown")))

        components.append({
            "type": "machine-learning-model",
            "bom-ref": f"model:{path}",
            "name": name,
            "hashes": [_sha256_hash(sha)],
            "modelCard": model_card,
            "externalReferences": ext_refs,
            "properties": props,
        })
    return components


def _data_components(evidence_dir: Path, reports_dir: Path) -> list[dict]:
    """`data` components for datasets, with scan verdicts and signature."""
    components: list[dict] = []
    download = _load_json(reports_dir / "dataset-download.json") or {}
    scan = _load_json(reports_dir / "dataset-scan.json") or {}
    if download.get("skipped", True):
        return components

    name = download.get("file", "dataset")
    sha = download.get("sha256")
    findings = scan.get("findings", []) if isinstance(scan, dict) else []

    # dataset-sign writes dataset.sig / dataset.pem beside the downloaded file.
    sig = evidence_dir / "dataset-input" / "dataset.sig"
    cert = evidence_dir / "dataset-input" / "dataset.pem"
    ext_refs = _signature_refs(sig, cert, subject=f"dataset {name}")
    signed = bool(ext_refs)

    props = [
        _prop("dataset.size_bytes", download.get("size_bytes", "unknown")),
        _prop("dataset.scan.findings", len(findings)),
        _prop("dataset.scan.passed", "false" if findings else "true"),
        _prop("dataset.signed", "true" if signed else "false"),
    ]

    # Redaction (dataset-redact): the SIGNED bytes are the REDACTED bytes, so the
    # component hash should be the redacted digest, not the raw download digest.
    redact = _load_json(reports_dir / "dataset-redact.json") or {}
    if not redact.get("skipped", True):
        if redact.get("redacted_sha256"):
            sha = redact["redacted_sha256"]
        props.extend([
            _prop("dataset.redacted", "true"),
            _prop("dataset.redaction.secrets", redact.get("secret_redactions", 0)),
            _prop("dataset.redaction.pii", redact.get("pii_redactions", 0)),
        ])
    components.append({
        "type": "data",
        "bom-ref": f"dataset:{name}",
        "name": name,
        "hashes": [_sha256_hash(sha)] if sha else [],
        "externalReferences": ext_refs,
        "data": [{
            "type": "dataset",
            "name": name,
            "contents": {"attachment": {"contentType": "application/octet-stream"}},
        }],
        "properties": props,
    })
    return components


# ── evaluation evidence (attached to the root component) ─────────────────────

EVAL_REPORTS = {
    "garak": "garak-results.json",
    "giskard": "giskard-results.json",
    "inspect-ai": "inspect-ai-results.json",
    "promptfoo": "promptfoo-results.json",
    "guardrail-regression": "guardrail-regression.json",
    "pyrit": "pyrit-results.json",
}


def _eval_evidence(reports_dir: Path) -> tuple[list[dict], list[dict]]:
    """Return (properties, externalReferences) summarising AI eval results + drift."""
    props: list[dict] = []
    refs: list[dict] = []
    for label, filename in EVAL_REPORTS.items():
        path = reports_dir / filename
        present = path.exists()
        props.append(_prop(f"eval.{label}.present", "true" if present else "false"))
        if present:
            refs.append({
                "type": "other",
                "url": f"file://reports/{filename}",
                "comment": f"AI evaluation report: {label}",
            })

    # Model-drift verdict (detect_model_drift) — a key behavioural-provenance signal.
    drift = _load_json(reports_dir / "model-drift.json")
    if isinstance(drift, dict) and not drift.get("skipped"):
        if drift.get("seeded"):
            props.append(_prop("drift.status", "baseline-seeded"))
        else:
            props.append(_prop("drift.detected", "true" if drift.get("drift_detected") else "false"))
            props.append(_prop("drift.metrics_drifted", len(drift.get("drifted", []))))
        refs.append({
            "type": "other",
            "url": "file://reports/model-drift.json",
            "comment": "Model drift report (eval metrics vs baseline)",
        })
    return props, refs


def _data_quality_evidence(reports_dir: Path) -> tuple[list[dict], list[dict]]:
    """Fold the data-quality / input-drift verdicts into the BOM root component.

    These run before the ai-bom stage: Great Expectations (content gate),
    Evidently (input-side data drift), YData (profile), DVC (version lineage).
    Dependency-Track is intentionally absent — it INGESTS this BOM downstream,
    so its verdict cannot be part of the document it analyses.
    """
    props: list[dict] = []
    refs: list[dict] = []

    ge = _load_json(reports_dir / "great-expectations.json")
    if isinstance(ge, dict) and not ge.get("skipped"):
        props.append(_prop("data_quality.great_expectations.success",
                           "true" if ge.get("success") else "false"))
        props.append(_prop("data_quality.great_expectations.expectations",
                           ge.get("expectations_evaluated", 0)))
        refs.append({
            "type": "other",
            "url": "file://reports/great-expectations.json",
            "comment": "Great Expectations content-quality validation",
        })

    ev = _load_json(reports_dir / "evidently-drift.json")
    if isinstance(ev, dict) and not ev.get("skipped"):
        if ev.get("seeded"):
            props.append(_prop("data_drift.status", "reference-seeded"))
        else:
            props.append(_prop("data_drift.detected",
                               "true" if ev.get("drift_detected") else "false"))
            if ev.get("drifted_columns") is not None:
                props.append(_prop("data_drift.columns", ev.get("drifted_columns")))
        refs.append({
            "type": "other",
            "url": "file://reports/evidently-drift.json",
            "comment": "Evidently data/feature drift report (dataset vs reference)",
        })

    yd = _load_json(reports_dir / "ydata-profile.json")
    if isinstance(yd, dict) and not yd.get("skipped"):
        props.append(_prop("data_quality.ydata_profile.present", "true"))
        refs.append({
            "type": "other",
            "url": "file://reports/ydata-profile.json",
            "comment": "YData dataset profile",
        })

    dvc = _load_json(reports_dir / "dvc-status.json")
    if isinstance(dvc, dict) and not dvc.get("skipped"):
        props.append(_prop("data_lineage.dvc.present", "true"))
        refs.append({
            "type": "other",
            "url": "file://reports/dvc-status.json",
            "comment": "DVC tracked-vs-pinned data/model status",
        })

    return props, refs


def _version_properties(evidence_dir: Path) -> list[dict]:
    """Git/CI provenance from version-info.json as BOM metadata properties."""
    info = _load_json(evidence_dir / "version-info.json")
    if not isinstance(info, dict):
        return []
    g = info.get("git", {})
    props = [
        _prop("version.commit", g.get("commit", "unknown")),
        _prop("version.describe", g.get("describe", "unknown")),
        _prop("version.branch", g.get("branch", "unknown")),
    ]
    if g.get("tag"):
        props.append(_prop("version.tag", g["tag"]))
    if g.get("dirty") is not None:
        props.append(_prop("version.dirty", "true" if g["dirty"] else "false"))
    return props


# ── assembly ─────────────────────────────────────────────────────────────────

def build_bom(
    sbom_dir: Path,
    reports_dir: Path,
    evidence_dir: Path,
    model_dir: Path,
    timestamp: str,
) -> dict:
    software = _software_components(sbom_dir, reports_dir)
    models = _model_components(evidence_dir, reports_dir, model_dir)
    data = _data_components(evidence_dir, reports_dir)
    eval_props, eval_refs = _eval_evidence(reports_dir)
    dq_props, dq_refs = _data_quality_evidence(reports_dir)

    root_ref = "root:" + os.environ.get("CI_PROJECT_PATH_SLUG", "gaips-application")
    root = {
        "type": "application",
        "bom-ref": root_ref,
        "name": os.environ.get("CI_PROJECT_NAME", "gaips-application"),
        "version": os.environ.get("CI_COMMIT_SHORT_SHA", "0.0.0"),
        "properties": eval_props + dq_props,
        "externalReferences": eval_refs + dq_refs,
    }

    components = models + data + software
    bom = {
        "$schema": "http://cyclonedx.org/schema/bom-1.6.schema.json",
        "bomFormat": "CycloneDX",
        "specVersion": SPEC_VERSION,
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": timestamp,
            "lifecycles": [{"phase": "build"}],
            "tools": {
                "components": [{
                    "type": "application",
                    "name": "gaips-build-ai-bom",
                    "version": "1.0",
                }]
            },
            "component": root,
            "properties": [
                _prop("pipeline.id", os.environ.get("CI_PIPELINE_ID", "local")),
                _prop("commit.sha", os.environ.get("CI_COMMIT_SHA", "unknown")),
                _prop("ref", os.environ.get("CI_COMMIT_REF_NAME", "unknown")),
                _prop("bom.counts.models", len(models)),
                _prop("bom.counts.datasets", len(data)),
                _prop("bom.counts.software", len(software)),
            ] + _version_properties(evidence_dir),
        },
        "components": components,
    }
    return bom


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="output AI BOM JSON path")
    parser.add_argument("--sbom", required=True, help="SBOM_DIR")
    parser.add_argument("--reports", required=True, help="REPORTS_DIR")
    parser.add_argument("--evidence", required=True, help="EVIDENCE_DIR")
    parser.add_argument("--models", required=True, help="MODEL_DIR")
    parser.add_argument("--timestamp", required=True, help="ISO-8601 UTC timestamp")
    args = parser.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    bom = build_bom(
        sbom_dir=Path(args.sbom),
        reports_dir=Path(args.reports),
        evidence_dir=Path(args.evidence),
        model_dir=Path(args.models),
        timestamp=args.timestamp,
    )
    out.write_text(json.dumps(bom, indent=2) + "\n", encoding="utf-8")

    meta_props = {p["name"]: p["value"] for p in bom["metadata"]["properties"]}
    print(
        f"AI BOM written → {out}\n"
        f"  models={meta_props[f'{PROP_NS}:bom.counts.models']} "
        f"datasets={meta_props[f'{PROP_NS}:bom.counts.datasets']} "
        f"software={meta_props[f'{PROP_NS}:bom.counts.software']} "
        f"(total components={len(bom['components'])})"
    )


if __name__ == "__main__":
    main()
