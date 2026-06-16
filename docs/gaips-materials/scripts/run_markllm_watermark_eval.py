from __future__ import annotations

import argparse
import json
import os
import platform
import traceback
from pathlib import Path
from typing import Any


PROMPTS = [
    "Summarize why model output provenance matters in one sentence.",
    "Write a short security policy reminder for AI assistants.",
]


def json_safe(value: Any) -> Any:
    try:
        json.dumps(value)
    except TypeError:
        if isinstance(value, dict):
            return {str(k): json_safe(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [json_safe(v) for v in value]
        return str(value)
    return value


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(json_safe(report), indent=2) + "\n", encoding="utf-8")


def fail(out: Path, report: dict[str, Any], reason: str, exc: Exception | None = None) -> None:
    report["status"] = "failed"
    report["failure_reason"] = reason
    if exc is not None:
        report["exception"] = {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
    write_report(out, report)
    raise SystemExit(reason)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a live MarkLLM watermark eval and emit CI evidence.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--algorithm", default=os.environ.get("MARKLLM_ALGORITHM", "KGW"))
    parser.add_argument("--config", default=os.environ.get("MARKLLM_CONFIG", ""))
    parser.add_argument("--model-id", default=os.environ.get("MARKLLM_MODEL_ID", ""))
    parser.add_argument("--model-revision", default=os.environ.get("MARKLLM_MODEL_REVISION", ""))
    parser.add_argument("--max-new-tokens", type=int, default=int(os.environ.get("MARKLLM_MAX_NEW_TOKENS", "128")))
    parser.add_argument("--min-length", type=int, default=int(os.environ.get("MARKLLM_MIN_LENGTH", "160")))
    args = parser.parse_args()

    out = Path(args.output)
    model_id = args.model_id.strip()
    model_revision = args.model_revision.strip() or None

    # Resolve the algorithm config. A real file path wins; otherwise pass None so
    # MarkLLM loads the config bundled inside the installed package for the chosen
    # algorithm (markllm/config/<ALGORITHM>.json), rather than a relative path that
    # does not exist in CI.
    config_arg = args.config.strip()
    algorithm_config = config_arg if config_arg and Path(config_arg).is_file() else None

    report: dict[str, Any] = {
        "tool": "markllm",
        "mode": "live-eval",
        "status": "running",
        "algorithm": args.algorithm,
        "algorithm_config": algorithm_config or f"<bundled markllm/config/{args.algorithm}.json>",
        "model_id": model_id,
        "model_revision": model_revision,
        "python": platform.python_version(),
        "prompts": [],
    }

    if not model_id:
        fail(out, report, "MARKLLM_MODEL_ID is required for markllm-watermark-eval")

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from markllm.watermark.auto_watermark import AutoWatermark
        from markllm.utils.transformers_config import TransformersConfig
    except Exception as exc:
        fail(out, report, "MarkLLM, torch, and transformers must import successfully for live eval", exc)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    report["device"] = device

    revision_kwargs = {"revision": model_revision} if model_revision else {}
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_id, **revision_kwargs)
        model = AutoModelForCausalLM.from_pretrained(model_id, **revision_kwargs).to(device)
        vocab_size = len(tokenizer)
        transformers_config = TransformersConfig(
            model=model,
            tokenizer=tokenizer,
            vocab_size=vocab_size,
            device=device,
            max_new_tokens=args.max_new_tokens,
            min_length=args.min_length,
            do_sample=True,
            no_repeat_ngram_size=4,
        )
        watermark = AutoWatermark.load(
            args.algorithm,
            algorithm_config=algorithm_config,
            transformers_config=transformers_config,
        )
    except Exception as exc:
        fail(
            out,
            report,
            f"Could not load MARKLLM_MODEL_ID={model_id!r} as a MarkLLM-compatible causal LM",
            exc,
        )

    results: list[dict[str, Any]] = []
    try:
        for idx, prompt in enumerate(PROMPTS, start=1):
            watermarked_text = watermark.generate_watermarked_text(prompt)
            detection = watermark.detect_watermark(watermarked_text)
            results.append(
                {
                    "id": f"markllm-{idx}",
                    "prompt": prompt,
                    "watermarked_text": watermarked_text,
                    "watermarked_text_length": len(watermarked_text),
                    "detection": detection,
                }
            )
    except Exception as exc:
        report["prompts"] = results
        fail(out, report, "MarkLLM live generation/detection failed", exc)

    report["status"] = "passed"
    report["prompts"] = results
    report["metrics"] = {
        "prompt_count": len(results),
        "detections_completed": sum(1 for item in results if item.get("detection") is not None),
    }
    write_report(out, report)


if __name__ == "__main__":
    main()
