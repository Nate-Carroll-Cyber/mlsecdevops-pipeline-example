#!/usr/bin/env python3
"""Evidently data/feature drift + LLM text descriptors for the eval dataset.

`model-drift-detection` compares this run's *eval metrics* to a baseline. This is
the complementary input-side check: has the DATA itself drifted? Evidently's
DataDriftPreset (PSI) compares a committed reference snapshot of the dataset to
the current one, and TextEvals computes LLM-relevant descriptors (text length,
etc.) over the prompt-bearing columns — directly relevant to an LLM gateway. The
same report extends to live monitoring later.

Reference strategy mirrors the eval-baseline pattern: the reference dataset lives
in the repo (evals/dataset-reference.jsonl). On first run (no reference) it is
SEEDED to the report dir for the maintainer to commit; drift activates once it is
committed. No external state store.

Outputs an HTML report (evidence artifact) and a JSON summary. The CI job is
`allow_failure: true` (soft gate) — the script exits non-zero when drift is
detected so the job can be hardened later by removing allow_failure.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

TEXT_COLS = ("question", "prompt", "expected")
CAT_COLS = ("category",)


def load_dataframe(path: Path) -> pd.DataFrame:
    text = path.read_text(errors="replace")
    if path.suffix in (".jsonl", ".ndjson"):
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        data = json.loads(text)
        records = data if isinstance(data, list) else [data]
    return pd.DataFrame.from_records(records)


def find_drift(result: dict) -> dict:
    """Heuristically pull a drift verdict out of the snapshot dict.

    Evidently's serialized shape moves between versions; rather than bind to one
    layout, scan for the dataset-drift signal (a boolean 'drift detected' plus a
    drifted-column share/count) wherever it appears.
    """
    found = {"drift_detected": None, "drifted_columns": None, "drift_share": None}

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                kl = str(k).lower()
                if isinstance(v, bool) and "drift" in kl and "detected" in kl:
                    found["drift_detected"] = v
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    if "number_of_drifted_columns" in kl or ("drifted" in kl and "count" in kl):
                        found["drifted_columns"] = v
                    if "share_of_drifted_columns" in kl or "drift_share" in kl:
                        found["drift_share"] = v
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(result)
    return found


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", required=True, help="current eval dataset (json/jsonl)")
    parser.add_argument("--reference", required=True, help="committed reference dataset path")
    parser.add_argument("--report", required=True, help="output summary JSON path")
    parser.add_argument("--html", required=True, help="output HTML report path")
    parser.add_argument("--seed-out", required=True, help="where to write a seeded reference if none exists")
    args = parser.parse_args()

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    def write(report: dict) -> None:
        report_path.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")

    current_path = Path(args.current)
    if not current_path.exists():
        print(f"No current dataset at {current_path} — Evidently drift skipped (using fixtures)")
        write({"skipped": True, "reason": "no dataset present"})
        return

    current_df = load_dataframe(current_path)

    reference_path = Path(args.reference)
    if not reference_path.exists():
        seed = Path(args.seed_out)
        seed.parent.mkdir(parents=True, exist_ok=True)
        # Seed JSONL so the maintainer commits a stable reference snapshot.
        seed.write_text(
            "\n".join(json.dumps(r) for r in current_df.to_dict(orient="records")) + "\n",
            encoding="utf-8",
        )
        print(f"No reference at {reference_path} — seeded {len(current_df)} record(s) → {seed}")
        print(f"  Commit it to {reference_path} to activate data-drift detection.")
        write({"skipped": False, "seeded": True, "records": len(current_df), "drift_detected": False})
        return

    reference_df = load_dataframe(reference_path)

    from evidently import Dataset, DataDefinition, Report
    from evidently.presets import DataDriftPreset, TextEvals

    present_text = [c for c in TEXT_COLS if c in current_df.columns]
    present_cat = [c for c in CAT_COLS if c in current_df.columns]
    definition = DataDefinition(
        text_columns=present_text or None,
        categorical_columns=present_cat or None,
    )
    current_ds = Dataset.from_pandas(current_df, data_definition=definition)
    reference_ds = Dataset.from_pandas(reference_df, data_definition=definition)

    metrics = [DataDriftPreset(method="psi")]
    if present_text:
        metrics.append(TextEvals())
    report = Report(metrics, include_tests=True)
    snapshot = report.run(current_ds, reference_ds)

    # Persist artifacts — method names have been stable but guard anyway.
    html_path = Path(args.html)
    html_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        snapshot.save_html(str(html_path))
        print(f"Evidently HTML report → {html_path}")
    except Exception as exc:
        print(f"  NOTE: HTML save skipped ({exc})")

    result_dict: dict = {}
    for getter in ("dict", "as_dict"):
        fn = getattr(snapshot, getter, None)
        if callable(fn):
            try:
                result_dict = fn()
                break
            except Exception:
                continue

    drift = find_drift(result_dict)
    summary = {
        "skipped": False,
        "seeded": False,
        "reference_records": len(reference_df),
        "current_records": len(current_df),
        "text_columns": present_text,
        "categorical_columns": present_cat,
        **drift,
    }
    write(summary)

    if drift["drift_detected"]:
        print(f"DATA DRIFT DETECTED — drifted_columns={drift['drifted_columns']} "
              f"share={drift['drift_share']}; see {html_path.name}")
        raise SystemExit(1)
    print(f"No data drift — reference={len(reference_df)} vs current={len(current_df)} record(s)")


if __name__ == "__main__":
    main()
