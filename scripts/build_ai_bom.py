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
      - AI evaluation evidence ← the MarkLLM watermark eval results, attached
            to the root component.
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
    """Lift `components` straight out of the syft software SBOM (and pip-audit).

    Each component is tagged `gaips:source=syft-sbom` (Fix #30a — so the
    main-pipeline closure is distinguishable from the MarkLLM eval stack rather than
    fused into one flat count) and given a stable `bom-ref` (Fix #29 — so
    `vulnerabilities[].affects[].ref` can target it)."""
    for candidate in (
        sbom_dir / "sbom.cyclonedx.json",
        reports_dir / "pip-audit-cyclonedx.json",
    ):
        doc = _load_json(candidate)
        if doc and isinstance(doc.get("components"), list):
            comps = doc["components"]
            for c in comps:
                c.setdefault("type", "library")
                if not c.get("bom-ref"):
                    c["bom-ref"] = c.get("purl") or f"lib:{c.get('name', 'unknown')}"
                props = c.setdefault("properties", [])
                if not any(p.get("name") == f"{PROP_NS}:source" for p in props):
                    props.append(_prop("source", "syft-sbom"))
            return comps
    return []


def _watermark_stack_components(reports_dir: Path, existing: list[dict]) -> list[dict]:
    """Inventory the MarkLLM watermark stack (markllm/torch/transformers) from the
    markllm-deps-audit report. These are installed only in the eval jobs, so they
    never reach the Syft software SBOM — without this the AI BOM omits them. Deduped
    against the existing software components by purl/name."""
    audit = _load_json(reports_dir / "markllm-deps-audit.json")
    if not audit or not isinstance(audit.get("dependencies"), list):
        return []

    seen: set[str] = set()
    for c in existing:
        if c.get("purl"):
            seen.add(c["purl"].lower())
        if c.get("name"):
            seen.add(c["name"].lower())

    extra: list[dict] = []
    for dep in audit["dependencies"]:
        name = dep.get("name")
        if not name:
            continue
        version = dep.get("version")
        purl = f"pkg:pypi/{name}@{version}" if version else f"pkg:pypi/{name}"
        if purl.lower() in seen or name.lower() in seen:
            continue
        seen.add(purl.lower())
        seen.add(name.lower())
        props = [_prop("source", "markllm-deps-audit")]
        vulns = dep.get("vulns") or []
        if vulns:
            props.append(_prop("vulns.count", len(vulns)))
        # Stable bom-ref (Fix #29) so vulnerabilities[].affects[].ref can target it.
        comp = {"type": "library", "bom-ref": purl, "name": name, "purl": purl, "properties": props}
        if version:
            comp["version"] = version
        extra.append(comp)
    return extra


def _verification_verdict(evidence_dir: Path) -> dict[str, str]:
    """Read the signature-verification (#19) verdict so the BOM can distinguish
    'a signature exists' (signed) from 'we checked it' (verified) — Fix #32b.

    #19 writes evidence/signature-verification.jsonl as either a deferred marker
    (`{"skipped":true,"reason":...}` on an unprotected ref, where the pinned identity
    isn't injected) or one explain_signature record per model
    (`{"subjects":[{"match":bool}], ...}`). Returns {"state": true|false|unknown,
    "reason": <when not true>}. A global verdict is used (the pipeline signs/verifies
    the whole model dir uniformly) rather than fragile per-sha matching, since
    model-signing's manifest digest is not guaranteed to be a raw per-file sha256."""
    path = evidence_dir / "signature-verification.jsonl"
    if not path.exists():
        return {"state": "unknown", "reason": "signature-verification did not run"}
    records = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except Exception:
            continue
    if not records:
        return {"state": "unknown", "reason": "no verification records produced"}
    for rec in records:
        if rec.get("skipped"):
            return {"state": "false",
                    "reason": rec.get("reason", "signature-verification deferred")}
    verified = any(
        rec.get("subjects") and all(s.get("match") for s in rec["subjects"])
        for rec in records
    )
    if verified:
        return {"state": "true"}
    return {"state": "false", "reason": "no signed subject matched the on-disk model"}


def _markllm_card(reports_dir: Path) -> dict[str, dict]:
    """Index markllm-results.json by model_id so the watermark eval populates the
    otherwise-empty modelCard (Fix #30b). Producer (run_markllm_watermark_eval.py)
    writes: status, model_id, device, metrics:{prompt_count, detections_completed}."""
    res = _load_json(reports_dir / "markllm-results.json")
    if not isinstance(res, dict) or not res.get("model_id"):
        return {}
    return {res["model_id"]: res}


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
    # hf-artifact-scan writes its per-repo records under "gated" (both the skip and
    # the real-scan paths), not "scanned" — keying off the wrong field left HF
    # provenance silently absent from every model component.
    hf_by_id = {
        rec.get("model_id"): rec
        for rec in (hf.get("gated") or [])
        if isinstance(rec, dict)
    }
    verdict = _verification_verdict(evidence_dir)        # Fix #32b
    markllm_by_id = _markllm_card(reports_dir)           # Fix #30b

    components: list[dict] = []
    digests = _parse_digest_file(evidence_dir / "model-digests.txt")
    digests += _parse_digest_file(evidence_dir / "modelfile-digests.txt")

    for path, sha in digests:
        # Defensive (belt-and-suspenders to the #17 root fix): never emit an absolute
        # /builds/… path into artifact.path / bom-ref (Fix #41-F5).
        if os.path.isabs(path):
            path = os.path.relpath(path, os.environ.get("CI_PROJECT_DIR", "/"))
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
            # Fix #32b — distinguish "a signature exists" (signed) from "we checked it"
            # (verified). Sourced from signature-verification #19; false/unknown until
            # #19 runs on a protected branch (the honest deferred state).
            _prop("model.verified", verdict["state"]),
        ]
        if verdict.get("reason"):
            props.append(_prop("model.verified.reason", verdict["reason"]))

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

        # HF repo ids carry mixed case (e.g. "Qwen/Qwen2.5-1.5B-Instruct") while the
        # signed model path/name are lowercase GGUF, so all id-to-artifact matching
        # below is case-insensitive against both the path and the component name.
        path_l, name_l = path.lower(), name.lower()

        # Fold HuggingFace provenance metadata in when this artifact maps to an HF
        # repo. hf-artifact-scan records flat provenance fields per repo (author,
        # revision sha, gated/private/disabled status) — not nested model-card
        # metadata — so read those fields directly off the record.
        for hf_id, rec in hf_by_id.items():
            hf_base = hf_id.split("/")[-1].lower() if hf_id else ""
            if hf_base and (hf_base in path_l or hf_base in name_l):
                props.append(_prop("huggingface.repo", hf_id))
                props.append(_prop("huggingface.gated", rec.get("gated", "unknown")))
                if rec.get("author"):
                    props.append(_prop("huggingface.author", rec["author"]))
                if rec.get("sha"):
                    props.append(_prop("huggingface.revision", rec["sha"]))
                if "private" in rec:
                    props.append(_prop("huggingface.private", rec["private"]))
                if "disabled" in rec:
                    props.append(_prop("huggingface.disabled", rec["disabled"]))

        # Fold the MarkLLM watermark eval into the modelCard (Fix #30b) — previously
        # modelParameters/quantitativeAnalysis were always empty even though the eval ran.
        # Match the model id basename against the (lowercased) path or component name;
        # the old `name in res["prompts"]` fallback was dead (prompts is a list of dicts).
        for mid, res in markllm_by_id.items():
            mid_base = mid.split("/")[-1].lower() if mid else ""
            if mid_base and (mid_base in path_l or mid_base in name_l):
                metrics = res.get("metrics") or {}
                if res.get("device"):
                    model_card["modelParameters"]["device"] = res["device"]
                model_card["modelParameters"].setdefault("task", "watermarking")
                perf = [
                    {"slice": "markllm-watermark", "type": k, "value": v}
                    for k, v in metrics.items()
                    if isinstance(v, (int, float))
                ]
                if perf:
                    model_card["quantitativeAnalysis"]["performanceMetrics"] = perf
                props.append(_prop("markllm.status", res.get("status", "unknown")))
                if metrics.get("prompt_count") is not None:
                    props.append(_prop("markllm.prompt_count", metrics["prompt_count"]))
                if metrics.get("detections_completed") is not None:
                    props.append(_prop("markllm.detections_completed", metrics["detections_completed"]))

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


def _dataset_contents(evidence_dir: Path, name: str, download: dict) -> dict[str, str] | None:
    """Return a schema-valid CycloneDX data contents reference, never an empty attachment."""
    candidates: list[str] = []
    for key in ("path", "filepath", "source", "url"):
        value = download.get(key)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())

    if name and name != "dataset":
        candidates.append(f"evidence/dataset-input/{name}")

    for candidate in candidates:
        if candidate.startswith(("http://", "https://", "file://")):
            return {"url": candidate}
        path = Path(candidate)
        if path.is_absolute():
            try:
                candidate = str(path.relative_to(evidence_dir.parent))
            except ValueError:
                candidate = path.name
        return {"url": f"file://{candidate}"}

    return None


def _load_dataset_baseline(explicit: Path | None) -> dict | None:
    """Resolve and load the reviewed dataset-baseline.json (source/license/revision).

    The CI `data` component otherwise carries only a digest + scan/redaction verdicts
    — no provenance — while model components fold in full HuggingFace metadata. This
    closes that asymmetry by reading the same reviewed manifest that pins
    DATASET_EXPECTED_SHA256. Searched: explicit arg, $DATASET_BASELINE_FILE,
    $GAIPS_MATERIALS_DIR/evals, then the conventional in-repo locations."""
    candidates: list[Path] = []
    if explicit:
        candidates.append(explicit)
    env = os.environ.get("DATASET_BASELINE_FILE")
    if env:
        candidates.append(Path(env))
    materials = os.environ.get("GAIPS_MATERIALS_DIR")
    if materials:
        candidates.append(Path(materials) / "evals" / "dataset-baseline.json")
    candidates += [
        Path("evals/dataset-baseline.json"),
    ]
    for c in candidates:
        if c.exists():
            data = _load_json(c)
            if isinstance(data, dict):
                return data
    return None


def _data_components(
    evidence_dir: Path, reports_dir: Path, baseline: dict | None = None
) -> list[dict]:
    """`data` components for datasets, with scan verdicts, signature, and provenance."""
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
    data_entry = {
        "type": "dataset",
        "name": name,
    }
    contents = _dataset_contents(evidence_dir, name, download)
    if contents:
        data_entry["contents"] = contents

    # Provenance + license from the reviewed dataset-baseline.json — symmetric with
    # the HuggingFace metadata folded into model components. Without this the `data`
    # component is a bare digest with no source or license (the AI-BOM gap).
    licenses: list[dict] = []
    if isinstance(baseline, dict):
        prov = baseline.get("provenance", {}) if isinstance(baseline.get("provenance"), dict) else {}
        lic = baseline.get("license", {}) if isinstance(baseline.get("license"), dict) else {}
        prov_map = {
            "dataset.platform": prov.get("platform"),
            "dataset.source": prov.get("source"),
            "dataset.source.url": prov.get("source_url"),
            "dataset.revision": prov.get("revision"),
            "dataset.split": prov.get("split"),
            "dataset.retrieved": prov.get("retrieved"),
            "dataset.license": lic.get("id"),
            "dataset.citation": lic.get("citation"),
        }
        for key, value in prov_map.items():
            if value:
                props.append(_prop(key, value))
        if lic.get("id"):
            # CycloneDX component-level license (SPDX id) — the auditable license field.
            licenses.append({"license": {"id": lic["id"]}})
        if prov.get("source_url"):
            ext_refs = ext_refs + [{
                "type": "website",
                "url": prov["source_url"],
                "comment": "Upstream dataset source (provenance)",
            }]

    component = {
        "type": "data",
        "bom-ref": f"dataset:{name}",
        "name": name,
        "hashes": [_sha256_hash(sha)] if sha else [],
        "externalReferences": ext_refs,
        "data": [data_entry],
        "properties": props,
    }
    if licenses:
        component["licenses"] = licenses
    components.append(component)
    return components


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


# ── vulnerabilities (Fix #29) ────────────────────────────────────────────────

_VALID_SEV = {"critical", "high", "medium", "low", "info", "none", "unknown"}

# ── Accepted-risk VEX annotations (CycloneDX 1.6 vulnerability.analysis) ──────
# Deliberate risk acceptances recorded IN the BOM itself (not a side document):
# the vulnerable code paths are not reachable in this pipeline's actual use.
# state=not_affected with a justification is the CycloneDX way to assert "present
# but not exploitable here"; response records the disposition (can_not_fix when no
# fixed release exists, will_not_fix when a fix exists but is blocked by a pin).
_ANALYSIS_MARKLLM_NOFIX = {
    "state": "not_affected",
    "justification": "code_not_reachable",
    "response": ["can_not_fix"],
    "detail": ("Accepted risk: pinned by markllm==0.1.5 (latest & last release; hard-pins "
               "Pillow==9.4.0, predates transformers 5.x). markllm-watermark-eval performs a TEXT "
               "watermark embed/detect on the trusted, signature-verified model fixture; it does not "
               "JIT-compile untrusted scripts, deserialize untrusted checkpoints, use the Trainer/"
               "rng_state loader, or process untrusted images. No fixed release exists."),
}
_ANALYSIS_MARKLLM_WONTFIX = {
    "state": "not_affected",
    "justification": "code_not_reachable",
    "response": ["will_not_fix"],
    "detail": ("Accepted risk: a fixed release exists but is blocked by the markllm==0.1.5 pin "
               "(Pillow==9.4.0 / transformers 4.x). The vulnerable path (untrusted image / checkpoint "
               "/ Trainer load) is not exercised by the text watermark eval on the trusted model."),
}
_ANALYSIS_DISKCACHE = {
    "state": "not_affected",
    "justification": "requires_environment",
    "response": ["can_not_fix"],
    "detail": ("Accepted risk: diskcache (core dvc-data dependency) has no fixed release. Exploit "
               "requires write access to the cache directory; jobs run in ephemeral, single-tenant "
               "CI containers with no shared/untrusted writable cache, and the DVC job is inert."),
}
# Keyed by vulnerability id (lowercased); aliases included so a scanner reporting the
# CVE form instead of the PYSEC form still matches.
_ACCEPTED_ANALYSIS: dict[str, dict] = {
    "cve-2025-3000": _ANALYSIS_MARKLLM_NOFIX,                                   # torch — no fix
    "pysec-2025-217": _ANALYSIS_MARKLLM_NOFIX,                                  # transformers X-CLIP RCE
    "cve-2025-14929": _ANALYSIS_MARKLLM_NOFIX,                                  #   (alias)
    "cve-2026-1839": _ANALYSIS_MARKLLM_WONTFIX,                                 # transformers Trainer RCE
    "pysec-2023-175": _ANALYSIS_MARKLLM_WONTFIX, "cve-2023-4863": _ANALYSIS_MARKLLM_WONTFIX,
    "cve-2023-5129": _ANALYSIS_MARKLLM_WONTFIX,  "pysec-2023-227": _ANALYSIS_MARKLLM_WONTFIX,
    "cve-2023-44271": _ANALYSIS_MARKLLM_WONTFIX, "cve-2023-50447": _ANALYSIS_MARKLLM_WONTFIX,
    "cve-2024-28219": _ANALYSIS_MARKLLM_WONTFIX, "pysec-2026-165": _ANALYSIS_MARKLLM_WONTFIX,
    "cve-2026-42308": _ANALYSIS_MARKLLM_WONTFIX, "cve-2026-42310": _ANALYSIS_MARKLLM_WONTFIX,
    "cve-2025-69872": _ANALYSIS_DISKCACHE,                                      # diskcache — no fix
}


# Advisory aliases: security databases assign different IDs to the SAME flaw
# (a CVE, a GHSA, a PYSEC). Map each known alias onto ONE canonical ID so a risk
# accepted under one ID (in _ACCEPTED_ANALYSIS) isn't re-surfaced raw under another,
# and so no flaw is double-listed. Extend as scanners surface new alias pairs.
_VULN_ALIASES: dict[str, str] = {
    "ghsa-w8v5-vhqr-4h9v": "CVE-2025-69872",   # diskcache pickle RCE (grype ↔ osv)
    "cve-2023-5129": "CVE-2023-4863",          # pillow bundled libwebp
    "cve-2025-14929": "PYSEC-2025-217",        # transformers X-CLIP RCE
}


def _canonical_id(vid: Any) -> str:
    """Return the canonical advisory ID for a vuln, collapsing known aliases."""
    return _VULN_ALIASES.get(str(vid).lower(), str(vid))


def _norm_severity(s: Any) -> str | None:
    """Map a scanner severity onto the CycloneDX `ratings[].severity` enum."""
    if not s:
        return None
    s = str(s).lower()
    if s == "negligible":
        return "low"
    if s == "moderate":
        return "medium"
    return s if s in _VALID_SEV else "unknown"


def _group_for_component(c: dict) -> str | None:
    """Which dependency set a component belongs to, for per-group CVE attribution.

    The three sets never share one environment, so a CVE's blast radius is per-group.
    The MarkLLM eval stack is tagged by `gaips:source`; everything else is grouped by
    the requirements file Syft cataloged it from (`syft:location:*:path`), which both
    the SBOM and grype.json preserve. Derived from the component so EVERY scanner's
    findings get a group — not just grype's (a grype-only read would miss CVEs that
    lockfile-audit/pip-audit recorded first under the (id, ref) dedup)."""
    pmap = {p.get("name"): p.get("value") for p in (c.get("properties") or [])}
    if pmap.get(f"{PROP_NS}:source") == "markllm-deps-audit":
        return "markllm"
    for name, val in pmap.items():
        if name and name.startswith("syft:location") and name.endswith(":path") and val:
            base = str(val).rsplit("/", 1)[-1]
            if "dataquality" in base:
                return "data-quality"
            if base.startswith("requirements"):
                return "core"
    return None


def _vulnerabilities(reports_dir: Path, components: list[dict]) -> list[dict]:
    """Emit a CycloneDX 1.6 `vulnerabilities[]` from the pipeline's audit reports.

    Previously the BOM recorded known vulns only as scalar property *counts*, so
    Dependency-Track (and any auditor) ingested nothing structured. Sources:
    pip-audit JSON (`markllm-deps-audit.json` + the Fix #0 per-job `pip-audit-*.json`),
    grype (`grype.json`), trivy (`trivy-fs.json` / `trivy-image.json`). Each entry's
    `affects[].ref` points at the offending component's bom-ref. Deduped by (id, ref)."""
    ref_by_key: dict[str, str] = {}
    group_by_ref: dict[str, str] = {}
    for c in components:
        ref = c.get("bom-ref")
        if not ref:
            continue
        if c.get("name"):
            ref_by_key.setdefault(str(c["name"]).lower(), ref)
        if c.get("purl"):
            ref_by_key.setdefault(str(c["purl"]).lower(), ref)
        group = _group_for_component(c)
        if group:
            group_by_ref.setdefault(ref, group)

    def resolve_ref(name: str | None = None, purl: str | None = None) -> str:
        for key in (purl, name):
            if key and key.lower() in ref_by_key:
                return ref_by_key[key.lower()]
        return purl or (f"lib:{name}" if name else "unknown")

    vulns: list[dict] = []
    by_key: dict[tuple[str, str], dict] = {}

    def add(vid: Any, ref: str, source: str | None = None, severity: Any = None,
            url: str | None = None, desc: str | None = None, fix: str | None = None) -> None:
        if not vid:
            return
        # Collapse alias IDs (a CVE, GHSA and PYSEC can name the SAME flaw) onto one
        # canonical entry, keyed by (canonical id, ref). A second sighting of the same
        # flaw — e.g. grype's GHSA twin of an osv CVE — merges into the first rather
        # than emitting a duplicate, so an accepted risk isn't re-surfaced raw.
        cid = _canonical_id(vid)
        key = (cid.lower(), ref)
        sev = _norm_severity(severity)
        existing = by_key.get(key)
        if existing is not None:
            # Fill only the fields the first sighting lacked (e.g. grype's severity
            # onto an osv entry that carried the description + accepted analysis).
            if sev and not existing.get("ratings"):
                existing["ratings"] = [{"severity": sev}]
            if desc and not existing.get("description"):
                existing["description"] = str(desc)[:1000]
            if fix and not existing.get("recommendation"):
                existing["recommendation"] = f"Upgrade to: {fix}"
            if source and "source" not in existing:
                existing["source"] = {"name": source}
                if url:
                    existing["source"]["url"] = url
            return
        entry: dict[str, Any] = {"bom-ref": f"vuln:{cid}:{ref}", "id": cid,
                                 "affects": [{"ref": ref}]}
        if source:
            entry["source"] = {"name": source}
            if url:
                entry["source"]["url"] = url
        if sev:
            entry["ratings"] = [{"severity": sev}]
        if desc:
            entry["description"] = str(desc)[:1000]
        if fix:
            entry["recommendation"] = f"Upgrade to: {fix}"
        analysis = _ACCEPTED_ANALYSIS.get(cid.lower())
        if analysis:
            entry["analysis"] = analysis
        group = group_by_ref.get(ref)
        if group:
            entry.setdefault("properties", []).append(_prop("group", group))
        by_key[key] = entry
        vulns.append(entry)

    # pip-audit native JSON: {"dependencies":[{"name","version","vulns":[{id,fix_versions,description}]}]}
    # Covers the manifest scan (pip-audit.json), the hash-pinned lockfile scan
    # (lockfile-audit.json — does NOT match the pip-audit* glob), and the MarkLLM
    # dependency audit. All three share the pip-audit native shape; dedup is by `seen`.
    audit_files = (sorted(reports_dir.glob("pip-audit*.json"))
                   + [reports_dir / "lockfile-audit.json",
                      reports_dir / "markllm-deps-audit.json"])
    for audit_path in audit_files:
        doc = _load_json(audit_path)
        if not isinstance(doc, dict) or not isinstance(doc.get("dependencies"), list):
            continue  # skips the CycloneDX-shaped pip-audit-cyclonedx.json safely
        for dep in doc["dependencies"]:
            name, version = dep.get("name"), dep.get("version")
            purl = f"pkg:pypi/{name}@{version}" if name and version else (f"pkg:pypi/{name}" if name else None)
            ref = resolve_ref(name, purl)
            for v in dep.get("vulns") or []:
                fix = ", ".join(v.get("fix_versions") or []) or None
                add(v.get("id"), ref, source="osv", desc=v.get("description"), fix=fix)

    # grype: {"matches":[{"vulnerability":{id,severity,dataSource,fix:{versions}},"artifact":{name,purl}}]}
    grype = _load_json(reports_dir / "grype.json")
    if isinstance(grype, dict):
        for m in grype.get("matches") or []:
            v = m.get("vulnerability", {}) or {}
            art = m.get("artifact", {}) or {}
            fix = ", ".join((v.get("fix", {}) or {}).get("versions") or []) or None
            ref = resolve_ref(art.get("name"), art.get("purl"))
            add(v.get("id"), ref, source="grype", severity=v.get("severity"),
                url=v.get("dataSource"), desc=v.get("description"), fix=fix)

    # trivy: {"Results":[{"Vulnerabilities":[{VulnerabilityID,PkgName,InstalledVersion,FixedVersion,Severity}]}]}
    for trivy_name in ("trivy-fs.json", "trivy-image.json"):
        trivy = _load_json(reports_dir / trivy_name)
        if not isinstance(trivy, dict):
            continue
        for res in trivy.get("Results") or []:
            for v in res.get("Vulnerabilities") or []:
                name, ver = v.get("PkgName"), v.get("InstalledVersion")
                purl = f"pkg:pypi/{name}@{ver}" if name and ver else None
                ref = resolve_ref(name, purl)
                add(v.get("VulnerabilityID"), ref, source="trivy", severity=v.get("Severity"),
                    url=v.get("PrimaryURL"), desc=v.get("Description"), fix=v.get("FixedVersion"))

    return vulns


# ── assembly ─────────────────────────────────────────────────────────────────

def build_bom(
    sbom_dir: Path,
    reports_dir: Path,
    evidence_dir: Path,
    model_dir: Path,
    timestamp: str,
    dataset_baseline: Path | None = None,
) -> dict:
    syft_sw = _software_components(sbom_dir, reports_dir)
    markllm_sw = _watermark_stack_components(reports_dir, syft_sw)   # Fix #30a: kept distinct
    software = syft_sw + markllm_sw
    models = _model_components(evidence_dir, reports_dir, model_dir)
    data = _data_components(evidence_dir, reports_dir, _load_dataset_baseline(dataset_baseline))
    dq_props, dq_refs = _data_quality_evidence(reports_dir)

    root_ref = "root:" + os.environ.get("CI_PROJECT_PATH_SLUG", "gaips-application")
    root = {
        "type": "application",
        "bom-ref": root_ref,
        "name": os.environ.get("CI_PROJECT_NAME", "gaips-application"),
        "version": os.environ.get("CI_COMMIT_SHORT_SHA", "0.0.0"),
        "properties": dq_props,
        "externalReferences": dq_refs,
    }

    components = models + data + software
    vulnerabilities = _vulnerabilities(reports_dir, components)   # Fix #29
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
                # Fix #30a: the flat total split into its two disjoint universes.
                _prop("bom.counts.software.pipeline", len(syft_sw)),
                _prop("bom.counts.software.markllm", len(markllm_sw)),
                _prop("bom.counts.vulnerabilities", len(vulnerabilities)),
            ] + _version_properties(evidence_dir),
        },
        "components": components,
    }
    if vulnerabilities:
        bom["vulnerabilities"] = vulnerabilities
    return bom


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="output AI BOM JSON path")
    parser.add_argument("--sbom", required=True, help="SBOM_DIR")
    parser.add_argument("--reports", required=True, help="REPORTS_DIR")
    parser.add_argument("--evidence", required=True, help="EVIDENCE_DIR")
    parser.add_argument("--models", required=True, help="MODEL_DIR")
    parser.add_argument("--timestamp", required=True, help="ISO-8601 UTC timestamp")
    parser.add_argument("--dataset-baseline", default=None, type=Path,
                        help="optional path to dataset-baseline.json for license/provenance "
                             "(falls back to $DATASET_BASELINE_FILE / conventional locations)")
    args = parser.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    bom = build_bom(
        sbom_dir=Path(args.sbom),
        reports_dir=Path(args.reports),
        evidence_dir=Path(args.evidence),
        model_dir=Path(args.models),
        timestamp=args.timestamp,
        dataset_baseline=args.dataset_baseline,
    )
    out.write_text(json.dumps(bom, indent=2) + "\n", encoding="utf-8")

    meta_props = {p["name"]: p["value"] for p in bom["metadata"]["properties"]}
    print(
        f"AI BOM written → {out}\n"
        f"  models={meta_props[f'{PROP_NS}:bom.counts.models']} "
        f"datasets={meta_props[f'{PROP_NS}:bom.counts.datasets']} "
        f"software={meta_props[f'{PROP_NS}:bom.counts.software']} "
        f"(pipeline={meta_props[f'{PROP_NS}:bom.counts.software.pipeline']} "
        f"markllm={meta_props[f'{PROP_NS}:bom.counts.software.markllm']}) "
        f"vulnerabilities={meta_props[f'{PROP_NS}:bom.counts.vulnerabilities']} "
        f"(total components={len(bom['components'])})"
    )


if __name__ == "__main__":
    main()
