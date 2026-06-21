#!/usr/bin/env python3
"""Evidently data/feature drift + LLM text descriptors for the eval dataset.

This is the input-side drift check: has the DATA itself drifted? Evidently's
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
detected so the job can be hardened later by removing allow_failure. It also
exits non-zero (fails CLOSED) if the drift verdict cannot be located in the
Evidently snapshot, so a serialization-shape change can never surface as a
silent "no drift" green.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

TEXT_COLS = ("question", "prompt", "expected")
CAT_COLS = ("category",)
NUM_COLS = ("similarity", "score")
# Identifier columns are excluded from drift entirely — every value is unique, so
# PSI over them is meaningless noise (and high-cardinality).
ID_COLS = ("id", "case_id")


def load_dataframe(path: Path) -> pd.DataFrame:
    text = path.read_text(errors="replace")
    if path.suffix in (".jsonl", ".ndjson"):
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        data = json.loads(text)
        records = data if isinstance(data, list) else [data]
    return pd.DataFrame.from_records(records)


def find_drift(result: dict) -> dict:
    """Extract the dataset-drift verdict from Evidently 0.7.x's serialized snapshot.

    `DataDriftPreset` emits a drifted-columns summary metric whose value is
    ``{"count": <n>, "share": <0..1>}``; drift is flagged when that share meets the
    metric's ``drift_share`` threshold (default 0.5). We locate that metric by its
    value SHAPE — not a positional index — because `TextEvals` adds sibling metrics
    (scalar floats) whose order is not guaranteed. Verified against evidently 0.7.21:
    a self-comparison yields share 0.0 (drift_detected False); a fully-shifted
    dataset yields share 1.0 (drift_detected True).
    """
    found = {"drift_detected": None, "drifted_columns": None, "drift_share": None}
    for metric in (result.get("metrics") or []):
        value = metric.get("value")
        if isinstance(value, dict) and "count" in value and "share" in value:
            share = value.get("share")
            threshold = (metric.get("config") or {}).get("drift_share", 0.5)
            found["drifted_columns"] = value.get("count")
            found["drift_share"] = share
            if isinstance(share, (int, float)) and not isinstance(share, bool):
                found["drift_detected"] = bool(share >= threshold)
            break
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
        # DataFrame.from_records back-fills missing cells with NaN across
        # heterogeneous records; strip NaN/None-valued keys so the seeded
        # reference matches the real per-record schema (no spurious columns, no
        # non-finite JSON literals that strict parsers reject). Fix #24b.
        def _clean(rec: dict) -> dict:
            out = {}
            for k, v in rec.items():
                if v is None:
                    continue
                if isinstance(v, float) and not math.isfinite(v):
                    continue
                out[k] = v
            return out

        seed.write_text(
            "\n".join(json.dumps(_clean(r)) for r in current_df.to_dict(orient="records")) + "\n",
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
    present_num = [c for c in NUM_COLS if c in current_df.columns]
    # PSI drift applies to CATEGORICAL + NUMERICAL columns ONLY. Free-text columns
    # (prompt/question) are handled by TextEvals descriptors instead — running PSI on
    # a text feature raises StatTestInvalidFeatureTypeError — and identifier columns
    # (id/case_id) are excluded entirely (unique values → meaningless drift).
    drift_cols = present_cat + present_num
    definition = DataDefinition(
        text_columns=present_text or None,
        categorical_columns=present_cat or None,
        numerical_columns=present_num or None,
    )
    current_ds = Dataset.from_pandas(current_df, data_definition=definition)
    reference_ds = Dataset.from_pandas(reference_df, data_definition=definition)

    if not drift_cols:
        # Text-only dataset: TextEvals could still describe it, but there is no
        # categorical/numerical column to PSI-compare, so there is no drift verdict
        # to gate on. Report no-drift (don't fail closed) and stop.
        print("No categorical/numerical columns to drift-test — PSI skipped (text-only dataset).")
        write({"skipped": False, "seeded": False, "reference_records": len(reference_df),
               "current_records": len(current_df), "text_columns": present_text,
               "categorical_columns": present_cat, "numerical_columns": present_num,
               "verdict_extracted": False, "drift_detected": False,
               "note": "no categorical/numerical columns to PSI-test"})
        return

    metrics = [DataDriftPreset(columns=drift_cols, method="psi")]
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
    verdict_extracted = drift["drift_detected"] is not None
    summary = {
        "skipped": False,
        "seeded": False,
        "reference_records": len(reference_df),
        "current_records": len(current_df),
        "text_columns": present_text,
        "categorical_columns": present_cat,
        "numerical_columns": present_num,
        "drift_columns": drift_cols,
        "verdict_extracted": verdict_extracted,
        **drift,
    }
    write(summary)

    if not verdict_extracted:
        # FAIL CLOSED. find_drift() walks Evidently's serialized snapshot for the
        # drift verdict, and that shape moves between Evidently versions. If we
        # can't locate it, we must NOT print "no drift" and exit 0 — that would be
        # a silent green over an unread result. Exit non-zero so the (soft) job
        # surfaces it instead of masking a parse failure as a clean run.
        raise SystemExit(
            "Could not locate a drift verdict in the Evidently report — failing "
            "closed. The serialized shape likely changed; pin/inspect the evidently "
            f"version and update find_drift(). See {html_path.name}."
        )

    if drift["drift_detected"]:
        print(f"DATA DRIFT DETECTED — drifted_columns={drift['drifted_columns']} "
              f"share={drift['drift_share']}; see {html_path.name}")
        raise SystemExit(1)
    print(f"No data drift — reference={len(reference_df)} vs current={len(current_df)} record(s)")


if __name__ == "__main__":
    main()
