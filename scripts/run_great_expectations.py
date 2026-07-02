#!/usr/bin/env python3
"""Great Expectations content-quality gate for the eval/training dataset.

`eval-dataset-validate` already enforces STRUCTURE (JSON Schema). This adds the
complementary CONTENT gate: null rates, value ranges, uniqueness, cardinality —
the things a schema cannot express. It runs as a GX checkpoint whose pass/fail
result gates the pipeline, and emits Data Docs as a human-readable evidence
artifact (the natural companion to the YData profile).

GX Core 1.x API (context → data source → batch definition → suite → validation
definition → checkpoint). A file-backed context is used so `build_data_docs()`
renders a static site we can publish; the project root is thrown away with the
job. Expectations come from --suite (JSON) when present, else a conservative set
derived from the columns actually found in the dataset.

Skips cleanly (exit 0) when no dataset is present — evals may run on fixtures.
Exits non-zero when expectations fail; the CI job is `allow_failure: true` for
now (soft gate), so flip that to false once thresholds are tuned to harden it.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import pandas as pd


def load_dataframe(path: Path) -> pd.DataFrame:
    """Flatten a JSON array / single object / JSONL file into a DataFrame."""
    text = path.read_text(errors="replace")
    if path.suffix in (".jsonl", ".ndjson"):
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    else:
        data = json.loads(text)
        records = data if isinstance(data, list) else [data]
    return pd.DataFrame.from_records(records)


def default_expectations(df: pd.DataFrame) -> list[dict]:
    """A conservative content suite inferred from the columns that are present.

    Mirrors the eval-dataset contract: an identifier (id|case_id) that must be
    fully populated and unique, a prompt-bearing field that should be non-empty,
    and a row-count floor. `mostly` tolerates partially-populated optional text
    so a mixed question/prompt dataset does not hard-fail.
    """
    exps: list[dict] = [
        {"type": "ExpectTableRowCountToBeBetween", "kwargs": {"min_value": 1}},
    ]
    id_col = next((c for c in ("id", "case_id") if c in df.columns), None)
    if id_col:
        exps.append({"type": "ExpectColumnValuesToNotBeNull", "kwargs": {"column": id_col}})
        exps.append({"type": "ExpectColumnValuesToBeUnique", "kwargs": {"column": id_col}})
    for col in ("question", "prompt", "expected"):
        if col in df.columns:
            exps.append({
                "type": "ExpectColumnValueLengthsToBeBetween",
                "kwargs": {"column": col, "min_value": 1, "mostly": 0.95},
            })
    if "category" in df.columns:
        exps.append({
            "type": "ExpectColumnValuesToNotBeNull",
            "kwargs": {"column": "category", "mostly": 0.9},
        })
    return exps


def build_suite(gx, name: str, specs: list[dict]):
    suite = gx.core.expectation_suite.ExpectationSuite(name=name)
    for spec in specs:
        exp_cls = getattr(gx.expectations, spec["type"], None)
        if exp_cls is None:
            print(f"  WARN: unknown expectation '{spec['type']}' — skipped")
            continue
        suite.add_expectation(exp_cls(**spec.get("kwargs", {})))
    return suite


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, help="eval dataset file (json/jsonl)")
    parser.add_argument("--suite", help="optional expectation-suite JSON ({'expectations': [...]})")
    parser.add_argument("--report", required=True, help="output result JSON path")
    parser.add_argument("--docs-dir", required=True, help="dir to publish Data Docs into")
    parser.add_argument("--gx-root", required=True, help="scratch project root for the GX context")
    args = parser.parse_args()

    import great_expectations as gx

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    def write(report: dict) -> None:
        report_path.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")

    dataset = Path(args.dataset)
    if not dataset.exists():
        print(f"No eval dataset at {dataset} — content validation skipped (using fixtures)")
        write({"skipped": True, "reason": "no dataset present"})
        return

    df = load_dataframe(dataset)
    print(f"Loaded {len(df)} record(s), columns: {list(df.columns)}")

    if args.suite and Path(args.suite).exists():
        specs = json.loads(Path(args.suite).read_text()).get("expectations", [])
        print(f"Using expectation suite: {args.suite} ({len(specs)} expectation(s))")
    else:
        specs = default_expectations(df)
        print(f"No suite file — using {len(specs)} inferred expectation(s)")

    # Drop column-targeting expectations whose column is absent from this dataset
    # (the contract allows id|case_id and question|prompt, so a fixed suite would
    # otherwise error on a dataset that uses the alternate field).
    cols = set(df.columns)
    applicable = [s for s in specs if "column" not in s.get("kwargs", {}) or s["kwargs"]["column"] in cols]
    dropped = [s["kwargs"]["column"] for s in specs if s not in applicable]
    if dropped:
        print(f"  skipping expectations for absent column(s): {sorted(set(dropped))}")
    specs = applicable

    gx_root = Path(args.gx_root)
    gx_root.mkdir(parents=True, exist_ok=True)
    context = gx.get_context(mode="file", project_root_dir=str(gx_root))

    data_source = context.data_sources.add_pandas("gaips_pandas")
    data_asset = data_source.add_dataframe_asset(name="eval_dataset")
    batch_definition = data_asset.add_batch_definition_whole_dataframe("whole_dataset")

    suite = context.suites.add(build_suite(gx, "gaips_content", specs))
    validation_definition = context.validation_definitions.add(
        gx.core.validation_definition.ValidationDefinition(
            name="gaips_content_validation", data=batch_definition, suite=suite,
        )
    )

    # UpdateDataDocsAction renders the static evidence site after validation.
    actions = []
    try:
        from great_expectations.checkpoint import UpdateDataDocsAction
        actions = [UpdateDataDocsAction(name="update_data_docs")]
    except Exception as exc:  # pragma: no cover — older/newer action layout
        print(f"  NOTE: Data Docs action unavailable ({exc}); will try build_data_docs()")

    checkpoint = context.checkpoints.add(
        gx.checkpoint.checkpoint.Checkpoint(
            name="gaips_content_checkpoint",
            validation_definitions=[validation_definition],
            actions=actions,
        )
    )
    result = checkpoint.run(batch_parameters={"dataframe": df})

    # Publish Data Docs (best-effort) into the artifact dir.
    docs_dir = Path(args.docs_dir)
    try:
        context.build_data_docs()
        built = gx_root / "gx" / "uncommitted" / "data_docs" / "local_site"
        if built.exists():
            if docs_dir.exists():
                shutil.rmtree(docs_dir)
            shutil.copytree(built, docs_dir)
            print(f"Data Docs published → {docs_dir}")
    except Exception as exc:
        print(f"  NOTE: Data Docs build skipped ({exc})")

    result_dict = result.describe() if hasattr(result, "describe") else {}
    if isinstance(result_dict, str):
        try:
            result_dict = json.loads(result_dict)
        except Exception:
            result_dict = {"describe": result_dict}

    report = {
        "skipped": False,
        "file": dataset.name,
        "records": len(df),
        "success": bool(result.success),
        "expectations_evaluated": len(specs),
        "result": result_dict,
    }
    write(report)

    if result.success:
        print(f"Great Expectations PASSED — {len(specs)} expectation(s) met across {len(df)} record(s)")
    else:
        print("Great Expectations FAILED — content expectations not met; see Data Docs")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
