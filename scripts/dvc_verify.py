#!/usr/bin/env python3
"""Gate dvc-verify on data/model DRIFT from the pinned DVC versions.

dvc-verify runs `dvc status --json` after pulling the pinned versions. Per the DVC
docs, `dvc status` reports the workspace is "up to date" when it matches the pinned
hashes and lists changes otherwise — i.e. the JSON is EMPTY ({} / []) when in sync
and populated on drift. It is informational and does NOT set a non-zero exit code
on drift, so this helper parses the JSON and decides the gate.

Teeth-last (mirrors RL_FAIL_ON / IMAGE_VERIFY_REQUIRE): with --require blank the run
is ADVISORY — drift is reported and warned but never blocks. With --require truthy a
DRIFT, or an inability to evaluate (pull/status failed, unparseable output), fails the
job so a configured gate never passes green un-verified.

Counting top-level entries is intentionally schema-light: it does not depend on DVC's
internal stage/out key names (which the public docs don't pin down), only on the
documented empty-vs-populated contract.

Writes a normalized report the evidence-summary reads (Fix #33):
  {"skipped":false,"require":bool,"remote_configured":bool,"evaluated":bool,
   "in_sync":bool|null,"drift_count":int,"drift":<raw dvc status payload>}
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def _truthy(v: str) -> bool:
    return (v or "").strip().lower() in ("1", "true", "yes", "on")


def classify(raw_text: str) -> tuple[bool, int, object]:
    """Return (in_sync, drift_count, parsed). Raises ValueError if unparseable.

    Empty {} / [] → in sync; any entries → drift. Non-container JSON (null/scalar)
    is treated as no-drift but recorded verbatim.
    """
    doc = json.loads(raw_text)
    if isinstance(doc, (dict, list)):
        return (len(doc) == 0, len(doc), doc)
    return (True, 0, doc)


def main() -> None:
    p = argparse.ArgumentParser(description="Gate dvc-verify on drift from pinned DVC versions.")
    p.add_argument("--status", required=True, help="path to raw `dvc status --json` output")
    p.add_argument("--report", required=True, help="path to write the normalized dvc-status.json")
    p.add_argument("--require", default="", help="DVC_REQUIRE: blank=advisory, truthy=gate")
    p.add_argument("--remote", default="", help="DVC_REMOTE_URL (recorded for context)")
    p.add_argument("--pull-failed", default="0", help="1 if `dvc pull` failed")
    p.add_argument("--status-failed", default="0", help="1 if `dvc status --json` failed")
    args = p.parse_args()

    require = _truthy(args.require)
    report: dict = {
        "skipped": False,
        "require": require,
        "remote_configured": bool((args.remote or "").strip()),
    }

    out = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)

    def finish(code: int) -> None:
        out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        raise SystemExit(code)

    # 1) Could we evaluate at all? A failed pull or status means the gate cannot
    #    confirm the pinned versions — never pass an enforced gate un-verified.
    if _truthy(args.status_failed) or _truthy(args.pull_failed):
        report["evaluated"] = False
        report["in_sync"] = None
        report["reason"] = "dvc pull failed" if _truthy(args.pull_failed) else "dvc status failed"
        print(f"DVC verify: could not evaluate ({report['reason']}).")
        if require:
            print("DVC_REQUIRE set — failing: refusing to pass an un-verified data gate.")
            finish(1)
        print("Advisory (DVC_REQUIRE blank) — reporting only.")
        finish(0)

    # 2) Parse the status JSON.
    try:
        raw_text = Path(args.status).read_text()
    except Exception as exc:  # missing/unreadable status file
        report["evaluated"] = False
        report["in_sync"] = None
        report["reason"] = f"could not read status output: {exc}"
        print(f"DVC verify: {report['reason']}")
        finish(1 if require else 0)

    try:
        in_sync, drift_count, parsed = classify(raw_text or "{}")
    except ValueError:
        report["evaluated"] = False
        report["in_sync"] = None
        report["reason"] = "dvc status output not valid JSON"
        print("DVC verify: status output not parseable JSON.")
        finish(1 if require else 0)

    report["evaluated"] = True
    report["in_sync"] = in_sync
    report["drift_count"] = drift_count
    report["drift"] = parsed

    # 3) Verdict.
    if in_sync:
        print("DVC verify: workspace matches pinned versions (in sync).")
        finish(0)

    print(f"DVC verify: DRIFT — {drift_count} tracked entry(ies) differ from pinned versions.")
    if require:
        print("DVC_REQUIRE set — failing the pipeline on drift.")
        finish(1)
    print("Advisory (DVC_REQUIRE blank) — drift reported but not blocking. "
          "Set DVC_REQUIRE=true to gate.")
    finish(0)


if __name__ == "__main__":
    main()
