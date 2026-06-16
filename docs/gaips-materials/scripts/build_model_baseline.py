#!/usr/bin/env python3
"""Validate the approved model baseline and emit it as a CI dotenv manifest.

`evals/model-baseline.json` is the single source of truth for the approved
model: its identity (path + sha256) and the CI variables that identity implies
(fixture URL/path/sha, MarkLLM stack pins, transformers model id). The
`model-manifest` CI job runs this with `--emit-dotenv` so downstream jobs inherit
those variables via a GitLab dotenv report. Dotenv values override the inline
`variables:` defaults in .gitlab-ci.yml, but a Project/manual CI variable still
overrides the dotenv — so the manifest is the default, not a hard lock.

stdlib-only (the model-manifest job skips the venv bootstrap). Exits non-zero on
a malformed or internally-inconsistent baseline so a bad template fails fast at
the cheap setup stage rather than after the expensive scans.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_ENV_KEY_RE = re.compile(r"^[A-Z_][A-Z0-9_]*$")


def _fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load_baseline(path: Path) -> dict:
    if not path.exists():
        _fail(f"baseline not found: {path}")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        _fail(f"baseline is not valid JSON ({exc})")
    if not isinstance(data, dict):
        _fail("baseline must be a JSON object")

    model = data.get("model")
    if not isinstance(model, dict) or not model.get("path") or not model.get("sha256"):
        _fail("baseline.model must include non-empty 'path' and 'sha256'")
    if not _SHA256_RE.match(str(model["sha256"])):
        _fail(f"baseline.model.sha256 is not a 64-hex sha256: {model['sha256']!r}")

    variables = data.get("variables")
    if not isinstance(variables, dict) or not variables:
        _fail("baseline.variables must be a non-empty object")
    for key, value in variables.items():
        if not _ENV_KEY_RE.match(key):
            _fail(f"variable name is not a valid env key: {key!r}")
        if not isinstance(value, str):
            _fail(f"variable {key} must be a string (got {type(value).__name__})")
        if "\n" in value or "\r" in value:
            _fail(f"variable {key} value contains a newline")

    # Internal consistency: the model identity and the variables it implies must
    # agree, so the two can never silently drift apart in review.
    fx_sha = variables.get("MODEL_FIXTURE_SHA256")
    if fx_sha and fx_sha != model["sha256"]:
        _fail(f"MODEL_FIXTURE_SHA256 ({fx_sha}) != model.sha256 ({model['sha256']})")
    fx_path = variables.get("MODEL_FIXTURE_PATH")
    if fx_path and fx_path != model["path"]:
        _fail(f"MODEL_FIXTURE_PATH ({fx_path}) != model.path ({model['path']})")

    return data


def emit_dotenv(variables: dict, out: Path) -> None:
    lines = [f"{key}={value}" for key, value in variables.items()]
    out.write_text("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--baseline", required=True, type=Path,
                    help="path to evals/model-baseline.json")
    ap.add_argument("--emit-dotenv", type=Path, metavar="ENV_FILE",
                    help="write the variables map as a GitLab dotenv report")
    args = ap.parse_args()

    data = load_baseline(args.baseline)
    model = data["model"]
    variables = data["variables"]

    print(f"Approved model: {model.get('name', model['path'])}")
    print(f"  path   : {model['path']}")
    print(f"  sha256 : {model['sha256']}")
    print(f"  {len(variables)} variable(s) in manifest")

    if args.emit_dotenv:
        emit_dotenv(variables, args.emit_dotenv)
        print(f"Wrote dotenv manifest → {args.emit_dotenv}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
