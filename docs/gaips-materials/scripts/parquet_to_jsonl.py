#!/usr/bin/env python3
"""Offline converter: a Hugging Face Parquet split → schema-valid eval JSONL.

This is a ONE-TIME ingest/provenance tool, not a CI job. The pipeline's dataset
chain (`dataset-scan`, `redact_dataset.py`, `validate_eval_dataset.py`, Evidently,
Great Expectations, YData) is JSON/JSONL throughout, so inbound datasets are
normalised to JSONL at ingest rather than having every job read Parquet —
the same pattern as `csv_to_jsonl.py`. Unlike the CI scripts (stdlib-only), this
tool needs `pyarrow` to read Parquet; that dependency never enters the pipeline.

Each output record is made to satisfy `evals/eval-dataset.schema.json`, which
requires an `id` (or `case_id`) AND a prompt-bearing field (`question`/`prompt`).
The Lakera `gandalf_ignore_instructions` Parquet carries `text` + `similarity`
and neither required field, so we synthesise a deterministic `id` and map the
prompt-bearing column to `prompt`. Source/license/citation provenance lives once
in `evals/dataset-baseline.json`, not per-record, to keep the JSONL lean.

Example:
    python docs/gaips-materials/scripts/parquet_to_jsonl.py \
        --input ~/Downloads/test-00000-of-00001-bc92128b9288a6d1.parquet \
        --output docs/gaips-materials/evals/gandalf-ignore-instructions-test.jsonl \
        --text-field text --prompt-field prompt \
        --id-prefix gandalf-ignore-test --category prompt-injection \
        --keep similarity
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def convert(
    input_path: Path,
    output_path: Path,
    text_field: str,
    prompt_field: str,
    id_prefix: str,
    category: str | None,
    keep: list[str],
) -> int:
    try:
        import pyarrow.parquet as pq
    except ImportError:
        sys.exit("ERROR: pyarrow is required to read Parquet (pip install pyarrow).")

    rows = pq.read_table(input_path).to_pylist()
    if not rows:
        sys.exit(f"ERROR: {input_path} contains no rows.")
    if text_field not in rows[0]:
        sys.exit(
            f"ERROR: text field {text_field!r} not in Parquet columns "
            f"{sorted(rows[0])}. Pass --text-field."
        )

    width = max(4, len(str(len(rows))))
    written = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as fh:
        for i, row in enumerate(rows):
            text = row.get(text_field)
            if not isinstance(text, str) or not text.strip():
                # schema requires a non-empty prompt (minLength 1) — skip blanks.
                print(f"  skipping row {i}: empty/non-string {text_field!r}", file=sys.stderr)
                continue
            record: dict[str, object] = {
                "id": f"{id_prefix}-{i:0{width}d}",
                prompt_field: text,
            }
            if category:
                record["category"] = category
            for col in keep:
                if col in row and row[col] is not None:
                    record[col] = row[col]
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1

    print(f"Wrote {written} record(s) → {output_path}")
    return written


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", required=True, type=Path, help="source .parquet file")
    p.add_argument("--output", required=True, type=Path, help="destination .jsonl file")
    p.add_argument("--text-field", default="text", help="Parquet column carrying the prompt text")
    p.add_argument("--prompt-field", default="prompt", choices=["prompt", "question"],
                   help="schema prompt-bearing field to map the text into")
    p.add_argument("--id-prefix", required=True, help="prefix for the synthesised deterministic id")
    p.add_argument("--category", default=None, help="optional category tag added to every record")
    p.add_argument("--keep", nargs="*", default=[], help="extra Parquet columns to carry through verbatim")
    args = p.parse_args()

    convert(
        input_path=args.input,
        output_path=args.output,
        text_field=args.text_field,
        prompt_field=args.prompt_field,
        id_prefix=args.id_prefix,
        category=args.category,
        keep=args.keep,
    )


if __name__ == "__main__":
    main()
