#!/usr/bin/env python3
"""Semantic checks for .gitlab-ci.yml that the YAML parser cannot make.

Malformed YAML is caught the moment GitLab tries to create the pipeline, so linting
the file inside its own pipeline proves nothing. The failures worth catching are the
ones that leave every job GREEN while quietly producing a wrong result:

  1. `needs:` naming a job that does not exist.
  2. `needs:` on a job in a LATER stage (GitLab rejects it, but late).
  3. A job whose script reads a report file that ANOTHER job produces, without that
     producer in its `needs`. GitLab only downloads artifacts from jobs named in
     `needs`, so the file is simply absent — and helpers that treat an unreadable
     report as "that step was skipped" then emit an incomplete result with no error
     anywhere. That is how a signed AI-BOM can silently omit a component.

Run it locally or as a pre-commit hook — NOT as a pipeline job, for the reason above.

    python3 scripts/check_pipeline_wiring.py            # repo root
    python3 scripts/check_pipeline_wiring.py --ci path/to/.gitlab-ci.yml

Exits 1 if any check fails.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("ERROR: PyYAML is required (pip install pyyaml). This is a local dev tool.")

RESERVED = {"variables", "default", "stages", "include", "workflow", "image", "services"}
# Report/evidence files are what jobs actually hand each other.
FILE_RE = re.compile(r'["\']([A-Za-z0-9._-]+\.(?:json|jsonl|md|txt|env))["\']')
SCRIPT_RE = re.compile(r'scripts/([A-Za-z0-9_]+\.py)')


class Loader(yaml.SafeLoader):
    """GitLab's `!reference [.tpl, script]` tag is not standard YAML."""


Loader.add_constructor("!reference", lambda loader, node: loader.construct_sequence(node))


def load_jobs(path: Path) -> tuple[dict, list[str]]:
    doc = yaml.load(path.read_text(encoding="utf-8"), Loader=Loader)
    stages = doc.get("stages") or []
    jobs = {
        name: body for name, body in doc.items()
        if name not in RESERVED and not name.startswith(".") and isinstance(body, dict)
        and "stage" in body
    }
    return jobs, stages


def needs_of(job: dict) -> list[str]:
    out = []
    for entry in job.get("needs") or []:
        out.append(entry if isinstance(entry, str) else entry.get("job"))
    return [n for n in out if n]


def script_text(job: dict) -> str:
    chunks = []
    for key in ("before_script", "script", "after_script"):
        value = job.get(key)
        if isinstance(value, list):
            for item in value:
                chunks.append(item if isinstance(item, str) else str(item))
        elif isinstance(value, str):
            chunks.append(value)
    return "\n".join(chunks)


def produced_files(job: dict) -> set[str]:
    """Basenames a job publishes. Globs are kept as-is and matched separately."""
    paths = ((job.get("artifacts") or {}).get("paths")) or []
    return {Path(p).name for p in paths if isinstance(p, str)}


def check(ci_path: Path, repo_root: Path) -> list[str]:
    jobs, stages = load_jobs(ci_path)
    findings: list[str] = []

    # ── 1 + 2. needs referential integrity and stage order ────────────────────
    for name, job in jobs.items():
        for dep in needs_of(job):
            if dep not in jobs:
                findings.append(f"{name}: needs '{dep}', which is not a job in this file")
                continue
            if stages:
                here, there = job.get("stage"), jobs[dep].get("stage")
                if here in stages and there in stages and stages.index(there) > stages.index(here):
                    findings.append(
                        f"{name} (stage {here}): needs '{dep}' from the LATER stage {there}")

    # ── 3. report-file dependencies not covered by needs ──────────────────────
    # Which job publishes which file. A file published by several jobs is ambiguous,
    # so it is skipped rather than guessed at.
    producers: dict[str, set[str]] = {}
    for name, job in jobs.items():
        for filename in produced_files(job):
            if "*" in filename:
                continue
            producers.setdefault(filename, set()).add(name)

    script_cache: dict[str, str] = {}
    for name, job in sorted(jobs.items()):
        body = script_text(job)
        own = produced_files(job)
        referenced: set[str] = set(FILE_RE.findall(body))
        for script_name in set(SCRIPT_RE.findall(body)):
            if script_name not in script_cache:
                source = repo_root / "scripts" / script_name
                script_cache[script_name] = source.read_text(encoding="utf-8") if source.is_file() else ""
                if not script_cache[script_name]:
                    findings.append(f"{name}: runs scripts/{script_name}, which does not exist")
            referenced |= set(FILE_RE.findall(script_cache[script_name]))

        satisfied = set(needs_of(job))
        for filename in sorted(referenced):
            if filename in own:
                continue                      # the job makes it itself
            owners = producers.get(filename)
            if not owners or len(owners) > 1:
                continue                      # unknown or ambiguous — not actionable
            producer = next(iter(owners))
            if producer == name or producer in satisfied:
                continue
            findings.append(
                f"{name}: reads '{filename}' produced by '{producer}', which is not in its needs "
                f"— the file will be absent at runtime, with no error")
    return findings


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ci", type=Path, default=Path(".gitlab-ci.yml"))
    p.add_argument("--root", type=Path, default=None, help="repo root (default: the CI file's dir)")
    args = p.parse_args()

    ci_path = args.ci
    if not ci_path.is_file():
        sys.exit(f"ERROR: {ci_path} not found")
    root = args.root or ci_path.resolve().parent

    findings = check(ci_path, root)
    jobs, _ = load_jobs(ci_path)
    if not findings:
        print(f"pipeline wiring OK — {len(jobs)} jobs, no dangling needs, "
              f"no stage-order violations, no unfetched report dependencies")
        return
    print(f"{len(findings)} wiring problem(s) across {len(jobs)} jobs:\n")
    for f in findings:
        print(f"  - {f}")
    raise SystemExit(1)


if __name__ == "__main__":
    main()
