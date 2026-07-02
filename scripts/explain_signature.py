#!/usr/bin/env python3
"""Explain a verified model-signing / Sigstore bundle.

`model_signing verify` proves THAT a signature is valid, but its log only says
"Verification succeeded" — it never records WHAT was verified against. That makes
the gate unauditable: a too-permissive MODEL_SIGNING_IDENTITY (or a swapped
artifact) can pass without the evidence ever showing the resolved identity,
issuer, signed digest, or transparency-log entry.

This script parses an already-verified Sigstore bundle (model.sig) and prints +
emits that proof:
  * the certificate SubjectAlternativeName (the signer identity that was matched)
  * the Fulcio OIDC issuer extension
  * each Rekor transparency-log entry (logIndex + integratedTime)
  * the in-toto subject digests the signature actually covers
  * a RECOMPUTED sha256 of each on-disk file vs the signed digest (tamper check)

It is a REPORTING step only — the authoritative cryptographic verification (and the
tamper gate) is `model_signing verify`, which runs immediately before this in the
job. This script always exits 0: a recomputed-vs-signed digest difference is printed
as a loud WARNING rather than failing the job, because model-signing's manifest
digest scheme is not guaranteed to be a raw per-file sha256, so a naive recompute
mismatch here would be an unreliable gate. Treat the WARNING as a prompt to inspect,
not as a verdict.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path

# Fulcio OIDC issuer extension OIDs (v2 string-encoded, then legacy raw).
_ISSUER_OIDS = ("1.3.6.1.4.1.57264.1.8", "1.3.6.1.4.1.57264.1.1")


def _load_cert_der(vm: dict) -> bytes | None:
    if "certificate" in vm:
        return base64.b64decode(vm["certificate"]["rawBytes"])
    chain = vm.get("x509CertificateChain", {}).get("certificates", [])
    if chain:
        return base64.b64decode(chain[0]["rawBytes"])
    return None


def _cert_identity(der: bytes) -> tuple[list[str], str | None]:
    from cryptography import x509
    from cryptography.x509.oid import ObjectIdentifier

    cert = x509.load_der_x509_certificate(der)
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        identities = san.value.get_values_for_type(x509.UniformResourceIdentifier)
    except x509.ExtensionNotFound:
        identities = []

    issuer = None
    for oid in _ISSUER_OIDS:
        try:
            raw = cert.extensions.get_extension_for_oid(ObjectIdentifier(oid)).value.value
        except x509.ExtensionNotFound:
            continue
        issuer = raw[2:].decode() if oid.endswith(".1.8") and raw[:1] == b"\x0c" else raw.decode()
        break
    return identities, issuer


def _subjects(bundle: dict) -> list[dict]:
    env = bundle.get("dsseEnvelope") or bundle.get("dsse_envelope")
    if not env or "payload" not in env:
        return []
    try:
        statement = json.loads(base64.b64decode(env["payload"]))
    except Exception:
        return []
    return statement.get("subject", []) or []


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True, help="path to model.sig Sigstore bundle")
    parser.add_argument("--model-dir", required=True, help="signed model directory (for digest recompute)")
    parser.add_argument("--json-out", help="optional path to append a JSON evidence record")
    args = parser.parse_args()

    bundle = json.loads(Path(args.bundle).read_text())
    vm = bundle.get("verificationMaterial") or bundle.get("verification_material") or {}

    der = _load_cert_der(vm)
    identities, issuer = _cert_identity(der) if der else ([], None)

    tlog = []
    for entry in vm.get("tlogEntries", []) or vm.get("tlog_entries", []) or []:
        tlog.append({
            "logIndex": entry.get("logIndex") or entry.get("log_index"),
            "integratedTime": entry.get("integratedTime") or entry.get("integrated_time"),
        })

    model_dir = Path(args.model_dir)
    mismatch = False
    subjects = []
    for subj in _subjects(bundle):
        name = subj.get("name", "")
        signed = (subj.get("digest", {}) or {}).get("sha256", "")
        on_disk = ""
        candidate = model_dir / name
        if not candidate.exists():
            matches = list(model_dir.rglob(Path(name).name))
            candidate = matches[0] if matches else candidate
        if candidate.exists() and candidate.is_file():
            on_disk = _sha256(candidate)
        ok = bool(signed) and signed == on_disk
        if signed and on_disk and not ok:
            mismatch = True
        subjects.append({"name": name, "signed_sha256": signed, "recomputed_sha256": on_disk, "match": ok})

    print(f"  signer identity (cert SAN) : {identities[0] if identities else '<none>'}")
    print(f"  oidc issuer                : {issuer or '<none>'}")
    for t in tlog:
        print(f"  rekor transparency log     : logIndex={t['logIndex']} integratedTime={t['integratedTime']}")
    for s in subjects:
        flag = "OK" if s["match"] else ("MISMATCH" if s["recomputed_sha256"] else "not-on-disk")
        print(f"  signed subject             : {s['name']} sha256={s['signed_sha256'][:16]}… [{flag}]")

    if args.json_out:
        record = {
            "bundle": str(args.bundle),
            # This script runs only AFTER `model_signing verify` succeeded (the hard
            # gate in signature-verification), so reaching here means the signature is
            # cryptographically valid. Record that explicitly — sign-evidence keys its
            # model.verified on this flag, NOT on subjects[].match (the naive per-file
            # sha256 recompute below, which legitimately differs from model-signing's
            # manifest digest and is only an advisory tamper hint).
            "verified": True,
            "identity": identities[0] if identities else None,
            "issuer": issuer,
            "rekor": tlog,
            "recompute_match": (not mismatch),
            "subjects": subjects,
        }
        with open(args.json_out, "a") as fh:
            fh.write(json.dumps(record) + "\n")

    if mismatch:
        # Non-fatal by design (see module docstring): model_signing verify is the
        # authoritative gate. Surface loudly for human inspection, but do not fail.
        print("  WARNING: a signed subject digest did not match a naive sha256 of the on-disk file")
        print("           (model-signing's manifest digest may not be a raw per-file sha256 — inspect;")
        print("            the authoritative check is `model_signing verify`, which already passed)")


if __name__ == "__main__":
    main()
