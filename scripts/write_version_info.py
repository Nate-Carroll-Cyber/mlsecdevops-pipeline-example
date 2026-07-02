#!/usr/bin/env python3
"""Record Git + CI version/provenance info to a JSON file.

Captures the exact source revision a pipeline ran against — commit, ref, tag,
`git describe`, and working-tree cleanliness — so every downstream artifact
(evidence bundle, AI BOM) can be traced back to a precise, version-controlled
state. Pulls from Git directly with CI environment variables as the fallback,
so it works both in GitLab CI and on a local checkout.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path


def _git(*args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", *args], capture_output=True, text=True, timeout=15,
        )
        if out.returncode == 0:
            return out.stdout.strip()
    except Exception:
        pass
    return None


def collect(timestamp: str) -> dict:
    # Git is authoritative; CI_* vars fill gaps when .git is shallow/absent.
    commit = _git("rev-parse", "HEAD") or os.environ.get("CI_COMMIT_SHA", "unknown")
    short = (_git("rev-parse", "--short", "HEAD")
             or os.environ.get("CI_COMMIT_SHORT_SHA", commit[:8]))
    branch = (os.environ.get("CI_COMMIT_REF_NAME")
              or _git("rev-parse", "--abbrev-ref", "HEAD") or "unknown")
    tag = os.environ.get("CI_COMMIT_TAG") or _git("describe", "--tags", "--exact-match") or ""
    describe = _git("describe", "--tags", "--always", "--dirty") or short

    # Working tree dirty? (uncommitted changes at build time — a provenance smell).
    # --untracked-files=no scopes this to TRACKED modifications: in CI the tree starts
    # pristine and the job itself writes untracked scratch (evidence/, reports/, sbom/,
    # pipeline.env) before this runs, which would otherwise read as DIRTY on every run.
    # This also matches `git describe --dirty` above, which already ignores untracked.
    status = _git("status", "--porcelain", "--untracked-files=no")
    dirty = bool(status) if status is not None else None

    return {
        "schema_version": "1.0",
        "timestamp": timestamp,
        "git": {
            "commit": commit,
            "short_commit": short,
            "branch": branch,
            "tag": tag,
            "describe": describe,
            "dirty": dirty,
        },
        "ci": {
            "pipeline_id": os.environ.get("CI_PIPELINE_ID", "local"),
            "pipeline_url": os.environ.get("CI_PIPELINE_URL", ""),
            "job_id": os.environ.get("CI_JOB_ID", ""),
            "project_path": os.environ.get("CI_PROJECT_PATH", ""),
            "server_url": os.environ.get("CI_SERVER_URL", ""),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="output version-info.json path")
    parser.add_argument("--timestamp", required=True, help="ISO-8601 UTC timestamp")
    args = parser.parse_args()

    info = collect(args.timestamp)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")

    g = info["git"]
    # dirty is None when git is unavailable (e.g. a slim image without git) — report
    # that as "unknown" rather than silently printing "clean", which would falsely
    # imply a verified-clean working tree.
    dirty = "unknown" if g["dirty"] is None else ("DIRTY" if g["dirty"] else "clean")
    print(f"version-info → {out}")
    print(f"  {g['describe']} ({g['branch']} @ {g['short_commit']}, {dirty})")


if __name__ == "__main__":
    main()
