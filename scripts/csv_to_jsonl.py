from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def require_columns(fieldnames: list[str] | None, required: list[str]) -> None:
    if not fieldnames:
        raise SystemExit("CSV file has no header row.")
    missing = [name for name in required if name not in fieldnames]
    if missing:
        raise SystemExit(f"CSV is missing required columns: {', '.join(missing)}")


def clean_row(row: dict[str, str | None]) -> dict[str, str]:
    return {key: (value or "") for key, value in row.items()}


def convert_row(row: dict[str, str], schema: str, user_col: str, assistant_col: str, system_col: str | None) -> dict[str, object]:
    if schema == "records":
        return row

    if schema == "prompt-completion":
        return {
            "prompt": row[user_col],
            "completion": row[assistant_col],
        }

    messages: list[dict[str, str]] = []
    if system_col and row.get(system_col):
        messages.append({"role": "developer", "content": row[system_col]})
    messages.append({"role": "user", "content": row[user_col]})
    messages.append({"role": "assistant", "content": row[assistant_col]})
    return {"messages": messages}


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert a CSV training or eval dataset to JSONL.")
    parser.add_argument("--input", required=True, help="Path to the source CSV file.")
    parser.add_argument("--output", required=True, help="Path to write JSONL output.")
    parser.add_argument(
        "--schema",
        choices=["records", "prompt-completion", "chatml"],
        default="chatml",
        help="Output JSONL shape. Default: chatml.",
    )
    parser.add_argument("--user-column", default="prompt", help="CSV column for user prompt/input.")
    parser.add_argument("--assistant-column", default="completion", help="CSV column for assistant target/output.")
    parser.add_argument("--system-column", default=None, help="Optional CSV column for developer/system instructions.")
    parser.add_argument("--encoding", default="utf-8-sig", help="CSV input encoding. Default handles UTF-8 BOM.")
    parser.add_argument("--overwrite", action="store_true", help="Allow replacing an existing output file.")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise SystemExit(f"Input CSV does not exist: {input_path}")
    if output_path.exists() and not args.overwrite:
        raise SystemExit(f"Output exists: {output_path}. Use --overwrite to replace it.")

    with input_path.open("r", encoding=args.encoding, newline="") as source:
        reader = csv.DictReader(source)
        required = []
        if args.schema in {"prompt-completion", "chatml"}:
            required.extend([args.user_column, args.assistant_column])
        if args.system_column:
            required.append(args.system_column)
        require_columns(reader.fieldnames, required)

        rows = [clean_row(row) for row in reader]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as target:
        for row in rows:
            record = convert_row(row, args.schema, args.user_column, args.assistant_column, args.system_column)
            target.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(
        json.dumps(
            {
                "input": str(input_path),
                "output": str(output_path),
                "schema": args.schema,
                "rows_written": len(rows),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
