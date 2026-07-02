#!/usr/bin/env python3
"""YData Profiling — automated profile of the eval/training dataset.

Advisory companion to the Great Expectations gate: where GX asserts content
rules, this generates a full descriptive profile (types, distributions, null
counts, cardinality, correlations, alerts). The natural workflow is profile →
read the alerts → author/refine the GX expectation suite. Never gates the
pipeline — it produces an HTML + JSON artifact only.

Skips cleanly when no dataset is present.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def load_dataframe(path: Path) -> pd.DataFrame:
    text = path.read_text(errors="replace")
    if path.suffix in (".jsonl", ".ndjson"):
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        data = json.loads(text)
        records = data if isinstance(data, list) else [data]
    return pd.DataFrame.from_records(records)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="eval dataset file (json/jsonl)")
    parser.add_argument("--html", required=True, help="output HTML profile path")
    parser.add_argument("--json", required=True, help="output JSON profile path")
    args = parser.parse_args()

    dataset = Path(args.dataset)
    if not dataset.exists():
        print(f"No dataset at {dataset} — profiling skipped (using fixtures)")
        return

    df = load_dataframe(dataset)
    print(f"Profiling {len(df)} record(s), columns: {list(df.columns)}")

    from ydata_profiling import ProfileReport

    # minimal=True keeps CI fast and avoids expensive correlations/interactions
    # on large text columns; flip off for the full report when investigating.
    profile = ProfileReport(df, title="MLSECDEVOPS GitLab Pipeline eval dataset profile", minimal=True)

    html_path, json_path = Path(args.html), Path(args.json)
    html_path.parent.mkdir(parents=True, exist_ok=True)
    profile.to_file(html_path)
    json_path.write_text(profile.to_json(), encoding="utf-8")
    print(f"Profile written → {html_path} / {json_path}")


if __name__ == "__main__":
    main()
