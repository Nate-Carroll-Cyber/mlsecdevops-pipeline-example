from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
from pathlib import Path


PROMPTS = [
    "Summarize why model output provenance matters in one sentence.",
    "Write a short security policy reminder for AI assistants.",
]


def module_available(name: str) -> bool:
    try:
        importlib.import_module(name)
    except Exception:
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Emit a MarkLLM CI evidence report.")
    parser.add_argument("--output", required=True)
    parser.add_argument("--algorithm", default=os.environ.get("MARKLLM_ALGORITHM", "KGW"))
    parser.add_argument("--config", default=os.environ.get("MARKLLM_CONFIG", "config/KGW.json"))
    parser.add_argument("--model-id", default=os.environ.get("MARKLLM_MODEL_ID", "facebook/opt-125m"))
    args = parser.parse_args()

    live_eval = os.environ.get("MARKLLM_LIVE_EVAL", "false").lower() == "true"
    markllm_ready = module_available("watermark.auto_watermark")
    torch_ready = module_available("torch")
    transformers_ready = module_available("transformers")

    report = {
        "tool": "markllm",
        "mode": "ci-advisory",
        "status": "configured" if markllm_ready else "markllm-import-unavailable",
        "live_eval_enabled": live_eval,
        "algorithm": args.algorithm,
        "algorithm_config": args.config,
        "model_id": args.model_id,
        "python": platform.python_version(),
        "checks": {
            "markllm_import": markllm_ready,
            "torch_import": torch_ready,
            "transformers_import": transformers_ready,
        },
        "prompts": [{"id": f"markllm-{idx}", "prompt": prompt} for idx, prompt in enumerate(PROMPTS, start=1)],
        "notes": [
            "This job records MarkLLM readiness and intended watermark prompts for CI evidence.",
            "Enable live generation/detection after the lab repository defines approved model-cache and runtime policies.",
        ],
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if live_eval and not markllm_ready:
        raise SystemExit("MarkLLM import failed; see markllm-results.json for readiness details.")


if __name__ == "__main__":
    main()
