"""Minimal GAIPS model gateway reference.

This is a teaching artifact. It provides a stable interface and evidence log shape for
local and hosted model calls without requiring production credentials.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class ModelCallEvidence:
    timestamp: float
    provider: str
    model: str
    prompt_category: str
    prompt: str
    response: str
    safety_observation: str
    cost_latency_observation: str


def redact(text: str) -> str:
    replacements = ["API_KEY", "PASSWORD", "TOKEN", "SECRET"]
    redacted = text
    for marker in replacements:
        redacted = redacted.replace(marker, f"[{marker}_REDACTED]")
    return redacted


def call_fixture_model(prompt: str) -> str:
    lower = prompt.lower()
    if "password" in lower:
        return "Users must use MFA, unique passwords, and identity verification for reset workflows. Source: password-policy.md"
    if "sensitive" in lower or "ai systems" in lower:
        return "Only approved non-sensitive data may be sent to AI systems. Source: security-guidelines.md"
    if "claim access" in lower:
        return "The assistant must not claim access to systems, documents, or tools that are not provided. Source: product-faq.md"
    return "Fixture response: answer only from provided context and cite sources."


def call_model(provider: str, model: str, prompt: str) -> str:
    if provider == "fixture":
        return call_fixture_model(prompt)
    if provider == "ollama":
        raise RuntimeError("Ollama live call intentionally omitted from fixture gateway. Use LiteLLM or the lab app when live execution is approved.")
    if provider == "hosted":
        raise RuntimeError("Hosted live call requires instructor-approved credentials and provider-specific implementation.")
    raise ValueError(f"Unsupported provider: {provider}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", default=os.getenv("GAIPS_PROVIDER", "fixture"))
    parser.add_argument("--model", default=os.getenv("GAIPS_MODEL", "fixture-model"))
    parser.add_argument("--category", default="baseline")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--evidence", default="evidence/model-calls.jsonl")
    args = parser.parse_args()

    start = time.time()
    response = call_model(args.provider, args.model, args.prompt)
    elapsed_ms = round((time.time() - start) * 1000, 2)
    evidence = ModelCallEvidence(
        timestamp=start,
        provider=args.provider,
        model=args.model,
        prompt_category=args.category,
        prompt=redact(args.prompt),
        response=redact(response),
        safety_observation="Fixture mode: no external provider called; response must still be evaluated for groundedness and policy compliance.",
        cost_latency_observation=f"elapsed_ms={elapsed_ms}; cost=0 fixture units",
    )
    path = Path(args.evidence)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(asdict(evidence)) + "\n")
    print(response)


if __name__ == "__main__":
    main()
