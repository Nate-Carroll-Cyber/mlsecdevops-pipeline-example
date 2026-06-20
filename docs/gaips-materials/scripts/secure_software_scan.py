#!/usr/bin/env python3
"""Poll ReversingLabs Spectra Assure Community for OSS package reputation/malware.

This is a supply-chain reputation gate for the project's *own* dependencies: it
reads the pinned requirements lockfile, asks the Spectra Assure Community
catalogue what it knows about each package@version, and gates the pipeline on a
recent **malware** or **tampering** verdict.

Flow (mirrors the Community API's batched search usage):
  1. Parse the requirements lockfile into (name, version) pins → purls
     `pkg:{ecosystem}/{name}@{version}` (e.g. pkg:pypi/numpy@1.2.3).
  2. POST them to `{base}/find/packages` in batches — the search endpoint
     accepts at most FIVE packages per request on the Community Free plan
     (50 on Enterprise), so the default batch size is 5.
  3. For each returned package, match the requested version and read its
     `assessments.malware.status` / `assessments.tampering.status`
     (pass | warning | fail) plus the package/version `incidents`
     (type: malware | removal) and the `all_malicious` rollup.
  4. Gate: fail when any pin trips a category named in --fail-on (malware,
     tampering). With --fail-on empty the job is REPORT-ONLY (always exit 0).

Enforcement switch: --fail-on is driven by the RL_FAIL_ON CI variable. Blank =
report-only scan; e.g. "malware,tampering" = gate. This mirrors the
DT_FAIL_ON / dependency_track_upload.py pattern already used in this pipeline.

Token resolution: set RL_TOKEN (or alias RL_TOKEN_FILE) as a GitLab CI/CD variable
of EITHER type — a normal Variable (holds the token) or a File variable (holds a
path GitLab wrote the token to); _token() handles both. Vault injection sets
RL_TOKEN directly. Skips cleanly (exit 0) when no token is configured, so the
pipeline runs unchanged until one is wired in — same convention as
dependency-track-upload skipping on DT_API_KEY.

Honest scope: the gate uses the Community *search* endpoint because it is the
only multi-package (batchable) one and it already returns the per-version
`assessments` block. A 404 from the catalogue means the package is simply not
tracked by Community (typical for private/internal packages) — that is recorded
as not_in_catalogue, NOT a gate failure. Other API errors (401/402/429/500) are
operational and DO fail the gate in enforce mode, so a configured gate never
passes green without actually evaluating.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover — surfaced clearly in CI
    requests = None

# Spectra Assure Community search endpoint caps a single request at 5 packages on
# the Free plan (50 on Enterprise). Keep the default at the lower bound.
DEFAULT_BATCH_SIZE = 5
# Default = the FREE Spectra Assure Community API (single global host). The endpoint
# paths below are relative to the base, with NO /community prefix (it's baked into
# the base). Portal accounts override RL_API_URL with their portal base *ending in
# /community*, e.g. https://<org>.secure.software/api/public/v1/community — then the
# same paths (/user/account, /find/packages, /report/...) resolve correctly there.
DEFAULT_API_URL = "https://data.reversinglabs.com/api/oss/community/v2/free"
# Assessment categories this gate understands, mapped to the Community schema.
KNOWN_CATEGORIES = {"malware", "tampering"}


def _api_url() -> str:
    return (os.environ.get("RL_API_URL") or DEFAULT_API_URL).rstrip("/")


def _token() -> str:
    """Resolve the Community PAT from RL_TOKEN (or its aliases).

    Each candidate is treated as a value OR, if it names an existing file, as a
    path — so the same RL_TOKEN works whether it's a normal CI/CD variable (holds
    the value) or a GitLab **File**-type variable (GitLab writes the value to a
    file and the env var holds that file's path). RL_TOKEN_FILE is kept as an
    explicit alias. Vault injection sets RL_TOKEN directly.
    """
    for var in ("RL_TOKEN", "SECURE_SOFTWARE_TOKEN",
                "RL_TOKEN_FILE", "SECURE_SOFTWARE_TOKEN_FILE"):
        val = os.environ.get(var)
        if not val:
            continue
        if os.path.isfile(val):  # GitLab File-type variable exposes a path
            return Path(val).read_text(encoding="utf-8").strip()
        return val.strip()
    return ""


def normalize_name(name: str) -> str:
    """PEP 503 normalization: lowercase, runs of -_. collapse to a single -."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_requirements(path: Path) -> list[tuple[str, str | None]]:
    """Parse a pip requirements/lockfile into [(normalized_name, version|None)].

    Handles ==-pinned lines (incl. hashed lockfiles where the pin line ends with a
    trailing backslash), extras (`pkg[extra]`), inline comments, and environment
    markers. Skips blank/comment lines, option lines (-r, -e, --hash, ...), and
    VCS/URL requirements (no purl can be derived from those). Unpinned lines are
    recorded with version=None so they're reported but matched against the latest
    published version.
    """
    pins: list[tuple[str, str | None]] = []
    seen: set[tuple[str, str | None]] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        line = line.split(" #", 1)[0].strip()      # strip inline comment
        line = line.split(";", 1)[0].strip()        # strip environment marker
        if not line or "://" in line or line.startswith("git+"):
            continue
        m = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*==\s*([^\s\\]+)", line)
        if m:
            entry = (normalize_name(m.group(1)), m.group(2))
        else:
            m2 = re.match(r"^([A-Za-z0-9][A-Za-z0-9._-]*)", line)
            if not m2:
                continue
            entry = (normalize_name(m2.group(1)), None)
        if entry not in seen:
            seen.add(entry)
            pins.append(entry)
    return pins


def build_purl(ecosystem: str, name: str, version: str | None) -> str:
    """pkg:{ecosystem}/{name}[@{version}] — version omitted ⇒ latest published."""
    base = f"pkg:{ecosystem}/{name}"
    return f"{base}@{version}" if version else base


def chunked(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def check_account(base: str, token: str, timeout: int) -> int:
    """Validate the token via GET {base}/user/account and print account details.

    This endpoint does NOT count against the API usage quota (per the API docs), so
    it's the cheap way to confirm a token works — and the plan tier it returns
    tells us the real per-request package limit — before spending a pipeline run.
    Returns a process exit code (0 = token valid).
    """
    url = f"{base}/user/account"
    try:
        resp = requests.get(url, headers={"Authorization": f"Bearer {token}",
                                          "Accept": "application/json"}, timeout=timeout)
    except Exception as exc:
        print(f"TOKEN CHECK FAILED — could not reach {url}: {exc}")
        return 1
    if resp.status_code in (401, 403):
        print(f"TOKEN CHECK FAILED — {resp.status_code} {resp.reason}: token is invalid, "
              "expired, or lacks access. (This endpoint does not consume quota.)")
        return 1
    if resp.status_code != 200:
        print(f"TOKEN CHECK FAILED — unexpected HTTP {resp.status_code}: {resp.text[:200]}")
        return 1

    acct = (resp.json() or {}).get("account") or {}
    sub = acct.get("subscription") or {}
    ent = acct.get("entitlements") or {}
    reqs = ent.get("api_requests") or {}
    tier = sub.get("tier", "?")
    print("TOKEN OK — Spectra Assure Community account reachable.")
    print(f"  account      : {acct.get('name','?')} <{acct.get('email','?')}>"
          + (f", {acct.get('company')}" if acct.get("company") else ""))
    print(f"  subscription : {tier} (expires {sub.get('expiration','?')})")
    if reqs:
        used, allowed = reqs.get("used"), reqs.get("allowed")
        print(f"  api_requests : {used}/{allowed} used this month"
              + (f" — {allowed - used} remaining" if isinstance(used, int) and isinstance(allowed, int) else ""))
    # Surface the per-request package cap implied by the tier (Free = 5, else 50),
    # so the operator can confirm the scan's batch size before running it.
    cap = 5 if str(tier).lower().startswith("community") else 50
    print(f"  search limit : {cap} packages/request for tier '{tier}' "
          f"(scan batches at {DEFAULT_BATCH_SIZE})")
    return 0


def search_batch(base: str, token: str, items: list[dict], timeout: int) -> dict:
    """POST one batch (≤ batch-size purls) to {base}/find/packages.

    Retries briefly on 429 (rate limit). Raises on auth/quota/server errors so the
    caller can fail a configured gate rather than silently pass.
    """
    url = f"{base}/find/packages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    for attempt in range(4):
        # NOTE: do NOT send compact=true — it omits optional fields including the
        # per-version `assessments` block this gate depends on.
        resp = requests.post(url, headers=headers, json=items, timeout=timeout)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", "2") or "2")
            print(f"  rate-limited (429) — waiting {wait}s then retrying (attempt {attempt + 1}/4)")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    resp.raise_for_status()  # exhausted retries on 429
    return {}


def match_version(pkg: dict, want_version: str | None) -> tuple[dict | None, bool]:
    """Pick the version object to assess. Returns (version_obj, exact_match)."""
    versions = pkg.get("versions") or []
    if want_version:
        for v in versions:
            if v.get("version") == want_version:
                return v, True
    latest = pkg.get("latest_version")
    if latest:
        for v in versions:
            if v.get("version") == latest:
                return v, want_version is None
    return (versions[0], False) if versions else (None, False)


def category_status(version_obj: dict, category: str) -> str | None:
    """Read assessments.<category>.status for a version. None if not assessed.

    `assessments` is a oneOf: either the full block (licenses/malware/tampering/…)
    or just {repository}. Only the full block carries malware/tampering, so a
    repository-only assessment returns None (assessed-but-no-verdict).
    """
    assessments = version_obj.get("assessments")
    if not isinstance(assessments, dict):
        return None
    entry = assessments.get(category)
    if isinstance(entry, dict):
        return entry.get("status")
    return None


def version_incident_types(version_obj: dict | None) -> list[str]:
    """Incident types (malware | removal) recorded against THIS specific version.

    Version-level `incidents` is a record map {"<id>": {"type": ..., ...}} (usually
    {} for a clean version). The PACKAGE-level `incidents` is a lifetime stats object
    ({"malware": <int>, "removal": <int>, "recent_*": {...}}) aggregated across every
    version ever published — a mature package can show hundreds of past removals — so
    it is deliberately NOT used for gating (it would false-positive the pinned
    version). See package_incident_history() for that, which is informational only.
    """
    out: list[str] = []
    incidents = (version_obj or {}).get("incidents")
    if isinstance(incidents, dict):
        for val in incidents.values():
            if isinstance(val, dict) and val.get("type"):
                out.append(val["type"])
    return out


def package_incident_history(pkg: dict) -> dict:
    """Lifetime incident counts for the package — recorded for context, never gates."""
    incidents = pkg.get("incidents")
    if not isinstance(incidents, dict):
        return {}
    return {k: incidents[k] for k in ("malware", "removal")
            if isinstance(incidents.get(k), int)}


def evaluate_package(purl: str, pkg: dict, want_version: str | None,
                     fail_on: set[str]) -> dict:
    """Build a per-package result and decide which fail-on categories it trips."""
    version_obj, exact = match_version(pkg, want_version)
    statuses: dict[str, str | None] = {}
    if version_obj:
        for cat in KNOWN_CATEGORIES:
            statuses[cat] = category_status(version_obj, cat)
    incidents = version_incident_types(version_obj)   # this version only — not pkg history
    all_malicious = bool(pkg.get("all_malicious"))

    hits: list[dict] = []
    if "malware" in fail_on:
        if statuses.get("malware") == "fail":
            hits.append({"category": "malware", "reason": "assessments.malware.status=fail"})
        elif all_malicious:
            hits.append({"category": "malware", "reason": "all_malicious=true"})
        elif "malware" in incidents:
            hits.append({"category": "malware", "reason": "malware incident on this version"})
    if "tampering" in fail_on:
        if statuses.get("tampering") == "fail":
            hits.append({"category": "tampering", "reason": "assessments.tampering.status=fail"})
        elif "removal" in incidents:
            hits.append({"category": "tampering", "reason": "removal incident on this version"})

    identity = pkg.get("identity") if isinstance(pkg.get("identity"), dict) else {}
    return {
        "purl": purl,
        "name": identity.get("package") or identity.get("product"),
        "requested_version": want_version,
        "assessed_version": version_obj.get("version") if version_obj else None,
        "exact_version_match": exact,
        "all_malicious": all_malicious,
        "was_removed": bool(pkg.get("was_removed")),
        "statuses": statuses,
        "version_incidents": sorted(set(incidents)),
        "package_incident_history": package_incident_history(pkg),  # informational, never gates
        "hits": hits,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requirements", default="requirements.txt",
                        help="requirements lockfile to scan (default: requirements.txt)")
    parser.add_argument("--ecosystem", default="pypi",
                        help="purl ecosystem / Community repository (default: pypi)")
    parser.add_argument("--report", help="output report JSON path (required unless --check-token)")
    parser.add_argument("--check-token", action="store_true",
                        help="only validate the token via the no-quota account endpoint, then exit")
    parser.add_argument("--dump-raw", action="store_true",
                        help="POST the first batch and print the RAW JSON response, then exit "
                             "(for inspecting the live response shape)")
    parser.add_argument("--fail-on", default="",
                        help="comma list of categories that fail the gate "
                             "(malware,tampering). Blank = report-only.")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                        help=f"packages per search request (default {DEFAULT_BATCH_SIZE}; "
                             "Community Free plan max is 5)")
    parser.add_argument("--timeout", type=int, default=60,
                        help="per-request HTTP timeout in seconds")
    args = parser.parse_args()

    # RL_REQUIRE_TOKEN: teeth-last switch (same pattern as EVIDENCE_SIGNING_REQUIRED).
    # Default off → a missing token is a clean skip, so the pipeline runs unchanged
    # until a token is wired in. Set to "true"/"1"/"yes" once you INTEND the scan to
    # run: a missing/non-injected token then becomes a LOUD hard failure instead of a
    # silent green skip — this is what catches "the CI/CD variable never reached the
    # job" (protected-var-on-unprotected-branch, wrong Key, env scope) the moment it
    # happens, instead of leaving a passing pipeline that scanned nothing.
    require_token = os.environ.get("RL_REQUIRE_TOKEN", "").strip().lower() in (
        "1", "true", "yes", "on")

    # --check-token: validate the token (no quota cost) and exit, before any of the
    # scan setup that needs a --report path or a requirements file. Designed as a
    # CI pre-flight: exit 0 when NO token is set (nothing to check — the scan job
    # will skip cleanly) and exit 1 only when a token IS present but invalid, so a
    # misconfigured token fails fast and cheap instead of mid-scan.
    if args.check_token:
        if requests is None:
            print("ERROR: requests not installed — cannot reach Spectra Assure Community")
            raise SystemExit(1)
        token = _token()
        if not token:
            if require_token:
                print("ERROR: RL_REQUIRE_TOKEN is set but no RL_TOKEN / RL_TOKEN_FILE "
                      "reached this job. The CI/CD variable did not inject — check it is "
                      "not Protected on an unprotected branch, the Key is exactly "
                      "RL_TOKEN, and the environment scope matches.")
                raise SystemExit(1)
            print("No token (RL_TOKEN / RL_TOKEN_FILE) configured — nothing to check "
                  "(the scan job will skip cleanly)")
            raise SystemExit(0)
        # Length-masked confirmation so the CI log itself proves the variable arrived.
        print(f"TOKEN PRESENT (RL_TOKEN reached the job, length={len(token)}) — validating…")
        raise SystemExit(check_account(_api_url(), token, args.timeout))

    if not args.report and not args.dump_raw:
        parser.error("--report is required unless --check-token or --dump-raw is given")

    report_path = Path(args.report) if args.report else None
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)

    def write(report: dict) -> None:
        if report_path:
            report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    fail_on = {c.strip().lower() for c in args.fail_on.split(",") if c.strip()}
    unknown = fail_on - KNOWN_CATEGORIES
    if unknown:
        print(f"ERROR: unknown --fail-on categor(y/ies): {', '.join(sorted(unknown))} "
              f"(known: {', '.join(sorted(KNOWN_CATEGORIES))})")
        write({"skipped": True, "reason": f"unknown fail-on categories: {sorted(unknown)}"})
        raise SystemExit(2)
    enforce = bool(fail_on)

    token = _token()
    if not token:
        if require_token:
            print("ERROR: RL_REQUIRE_TOKEN is set but no RL_TOKEN / RL_TOKEN_FILE reached "
                  "the job — refusing to skip. The CI/CD variable did not inject "
                  "(Protected on an unprotected branch? wrong Key? env scope?).")
            write({"skipped": False, "error": "RL_REQUIRE_TOKEN set but no token injected"})
            raise SystemExit(1)
        print("No token (RL_TOKEN / RL_TOKEN_FILE) — Spectra Assure Community scan skipped")
        write({"skipped": True, "reason": "no RL_TOKEN / RL_TOKEN_FILE configured"})
        return
    print(f"TOKEN OK (length={len(token)}) — proceeding with Spectra Assure Community scan")

    if requests is None:
        print("ERROR: requests not installed — cannot reach Spectra Assure Community")
        write({"skipped": True, "reason": "requests missing"})
        raise SystemExit(1)

    req_path = Path(args.requirements)
    if not req_path.exists():
        print(f"No requirements file at {req_path} — nothing to scan")
        write({"skipped": True, "reason": f"{req_path} not found"})
        return

    pins = parse_requirements(req_path)
    if not pins:
        print(f"No parseable pins in {req_path} — nothing to scan")
        write({"skipped": True, "reason": "no parseable requirements"})
        return

    batch_size = max(1, min(args.batch_size, DEFAULT_BATCH_SIZE))
    if args.batch_size > DEFAULT_BATCH_SIZE:
        print(f"  note: --batch-size {args.batch_size} clamped to {DEFAULT_BATCH_SIZE} "
              "(Community Free-plan per-request limit)")

    base = _api_url()
    # uuid is an arbitrary per-item search id echoed back in the response; use the
    # purl so results/errors map straight back to the pin that produced them.
    by_uuid: dict[str, tuple[str, str | None]] = {}
    items: list[dict] = []
    for name, version in pins:
        purl = build_purl(args.ecosystem, name, version)
        by_uuid[purl] = (purl, version)
        items.append({"uuid": purl, "purl": purl})

    print(f"Spectra Assure Community: {base}")
    print(f"  scanning {len(items)} {args.ecosystem} package(s) from {req_path} "
          f"in batches of {batch_size}; mode={'ENFORCE ' + ','.join(sorted(fail_on)) if enforce else 'report-only'}")

    if args.dump_raw:
        print(json.dumps(search_batch(base, token, items[:batch_size], args.timeout), indent=2))
        raise SystemExit(0)

    results: list[dict] = []
    not_in_catalogue: list[str] = []
    op_errors: list[dict] = []

    for batch in chunked(items, batch_size):
        try:
            data = search_batch(base, token, batch, args.timeout)
        except Exception as exc:  # network / auth / quota / server
            for it in batch:
                op_errors.append({"purl": it["uuid"], "error": str(exc)})
            print(f"  ERROR on batch ({len(batch)} pkg): {exc}")
            continue
        # Free Community returns {packages,errors} at the top level; Portal nests
        # them under {community:{...}}. Accept either.
        community = data.get("community") or data
        for entry in community.get("packages") or []:
            uuid = entry.get("uuid", "")
            _, want_version = by_uuid.get(uuid, (uuid, None))
            results.append(evaluate_package(uuid, entry.get("package") or {},
                                            want_version, fail_on))
        for err in community.get("errors") or []:
            uuid = err.get("uuid", "")
            code = (err.get("error") or {}).get("code")
            info = (err.get("error") or {}).get("info", "")
            if code == 404:
                not_in_catalogue.append(uuid)
            else:
                op_errors.append({"purl": uuid, "code": code, "info": info})

    failing = [
        {"purl": r["purl"], **hit}
        for r in results for hit in r["hits"]
    ]

    report = {
        "skipped": False,
        "api_url": base,
        "ecosystem": args.ecosystem,
        "requirements": str(req_path),
        "batch_size": batch_size,
        "enforce": enforce,
        "gate_fail_on": sorted(fail_on),
        "scanned": len(items),
        "evaluated": len(results),
        "results": results,
        "not_in_catalogue": sorted(not_in_catalogue),
        "operational_errors": op_errors,
        "failing": failing,
    }
    write(report)

    # Summary
    print(f"  evaluated {len(results)} package(s); "
          f"{len(not_in_catalogue)} not in catalogue; {len(op_errors)} operational error(s)")
    for r in results:
        if r["hits"]:
            cats = ", ".join(sorted({h["category"] for h in r["hits"]}))
            print(f"    HIT [{cats}] {r['purl']} "
                  f"(version {r['assessed_version']}, statuses={r['statuses']})")

    if not enforce:
        print("Spectra Assure Community scan complete (report-only — gate not enforced)")
        return

    # Enforce mode: an operational error means we could not evaluate those pins —
    # never let a configured gate pass green without evaluating (mirrors DT).
    if op_errors:
        print(f"SECURE.SOFTWARE GATE FAILED — {len(op_errors)} operational error(s) "
              "prevented evaluation:")
        for e in op_errors:
            detail = e.get("error") or f"HTTP {e.get('code')}: {e.get('info')}"
            print(f"  {e['purl']}: {detail}")
        raise SystemExit(1)

    if failing:
        print(f"SECURE.SOFTWARE GATE FAILED — {len(failing)} malware/tampering hit(s):")
        for f in failing:
            print(f"  [{f['category']}] {f['purl']} — {f['reason']}")
        raise SystemExit(1)

    print("Spectra Assure Community gate PASSED — no malware/tampering verdicts")


if __name__ == "__main__":
    main()
