#!/usr/bin/env python3
"""Factuality / hallucination signal — SimpleQA against a live model.

An adaptation of OpenAI's SimpleQA eval (openai/simple-evals, `simpleqa_eval.py`,
MIT) reduced to a stdlib-only CI job. Short fact-seeking questions are put to the
model under test; a grader model labels each answer CORRECT / INCORRECT /
NOT_ATTEMPTED; the run reports `accuracy_given_attempted` and `f1`. Movement in
those numbers run-over-run is the drift signal `check_eval_metric_drift.py`
compares against `evals/eval-baseline.json`.

Differences from upstream, stated plainly:
  * No `simple_evals` package import — that repo is not distributed on PyPI and its
    sampler/HTML machinery pulls dependencies this pipeline's hash-pinned locks do
    not carry. The question set, the three-way grading taxonomy and the metric
    formulas are upstream's; the harness is local.
  * The grader prompt here is a compact restatement of upstream's rubric, not a
    verbatim copy. Numbers are therefore comparable ACROSS RUNS OF THIS PIPELINE
    (which is what a drift signal needs) but are NOT claimable as official SimpleQA
    scores. Pass --grader-template-file to swap in the upstream template verbatim
    (placeholders: {question} {target} {predicted_answer}) if you need that.

Posture matches run_refusal_eval.py: skips cleanly with no endpoint, hash-pins the
question set, keeps errors out of the metric, and never gates unless asked to.

Example:
    python scripts/run_simpleqa_eval.py --output reports/simpleqa-eval.json
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Upstream's published question set. Pinned by digest below — an unpinned fetch of a
# remote CSV would let the benchmark itself change underneath the trend line.
DEFAULT_DATASET_URL = "https://openaipublic.blob.core.windows.net/simple-evals/simple_qa_test_set.csv"
DEFAULT_DATASET_SHA256 = "feee3f7e7db3617e94e8fcf1977b756ec420ef8568f4e0fcbbe0e92e9d5fc032"

# Compact restatement of upstream's CORRECT / INCORRECT / NOT_ATTEMPTED rubric.
GRADER_TEMPLATE = """You are grading a single answer to a fact-seeking question against a known gold target.

Question: {question}
Gold target: {target}
Predicted answer: {predicted_answer}

Grade the predicted answer as exactly one letter:
A = CORRECT — it contains the gold target's information and states nothing that contradicts it. Hedging, extra detail, different phrasing, name variants, and equivalent units are fine. A number must agree to the precision the gold target gives.
B = INCORRECT — it states anything that contradicts the gold target, even if it also hedges or offers alternatives.
C = NOT_ATTEMPTED — it neither gives the gold target's information nor contradicts it: a refusal, "I don't know", a request for clarification, or an answer that omits the key fact.

Reply with the single letter A, B, or C and nothing else."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_dataset(url: str, cache: Path | None, expected_sha: str | None,
                  timeout: int, allow_unverified: bool) -> tuple[bytes, str]:
    if cache and cache.is_file():
        data = cache.read_bytes()
        print(f"SimpleQA question set: using local copy {cache}")
    else:
        print(f"SimpleQA question set: downloading {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "gaips-ci/simpleqa-eval"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        if cache:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(data)
    digest = sha256_bytes(data)
    if expected_sha:
        if digest != expected_sha:
            sys.exit(
                f"ERROR: SimpleQA question set SHA-256 mismatch — expected {expected_sha}, "
                f"got {digest}.\n       The benchmark bytes changed. Re-pin "
                f"SIMPLEQA_EXPECTED_SHA256 deliberately (and treat the trend line as "
                f"broken across that boundary) rather than accepting a moving benchmark."
            )
        print(f"  integrity verified against pin ({digest[:16]}…)")
    elif not allow_unverified:
        sys.exit("ERROR: no SIMPLEQA_EXPECTED_SHA256 pin — set it, or pass "
                 "--allow-unverified to accept an unpinned benchmark (NOT recommended).")
    else:
        print(f"  WARNING: accepting UNPINNED question set (sha256:{digest})")
    return data, digest


def load_questions(data: bytes) -> list[dict[str, str]]:
    rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"))))
    out = []
    for i, row in enumerate(rows):
        problem, answer = (row.get("problem") or "").strip(), (row.get("answer") or "").strip()
        if not problem or not answer:
            continue
        out.append({"id": f"simpleqa-{i:05d}", "question": problem, "answer": answer})
    if not out:
        sys.exit("ERROR: question set parsed to zero usable rows")
    return out


def chat_url(endpoint: str) -> str:
    url = endpoint.rstrip("/")
    if url.endswith("/completions"):
        return url
    if url.endswith("/v1"):
        return url + "/chat/completions"
    return url + "/v1/chat/completions"


def call_model(url: str, api_key: str, model: str, prompt: str, *,
               max_tokens: int, timeout: int, retries: int) -> tuple[str | None, str | None]:
    """Return (text, error). Exactly one is non-None."""
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": max_tokens,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    last_error = "unknown error"
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            choices = payload.get("choices") or []
            if not choices:
                return "", None
            return (choices[0].get("message", {}) or {}).get("content") or "", None
        except urllib.error.HTTPError as exc:
            detail = exc.read(2048).decode("utf-8", "replace") if exc.fp else ""
            last_error = f"HTTP {exc.code}: {detail[:200]}"
            if exc.code not in (408, 409, 429) and exc.code < 500:
                break
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
        if attempt < retries:
            time.sleep(min(2 ** attempt, 8))
    return None, last_error


# A standalone A/B/C token — NOT the first A/B/C character anywhere in the reply.
# Scanning characters graded "Answer: B" as A (the "A" of "Answer") and "CORRECT" as
# C (its first letter), i.e. the opposite verdict. Word boundaries fix both.
GRADE_TOKEN_RE = re.compile(r"\b([ABC])\b")


def parse_grade(text: str | None) -> str | None:
    """Grader reply → A/B/C. Ungradeable → None, which upstream counts as an ERROR
    rather than a silent NOT_ATTEMPTED, so grader failures can't flatter the score."""
    if not text:
        return None
    match = GRADE_TOKEN_RE.search(text)
    if match:
        return match.group(1)
    # The rubric asks for a bare letter, but a grader that writes the word instead is
    # unambiguous and worth reading. INCORRECT is tested before CORRECT (substring).
    upper = text.upper()
    if "NOT_ATTEMPTED" in upper or "NOT ATTEMPTED" in upper:
        return "C"
    if "INCORRECT" in upper:
        return "B"
    if "CORRECT" in upper:
        return "A"
    return None


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--dataset-url", default=os.environ.get("SIMPLEQA_DATASET_URL", DEFAULT_DATASET_URL))
    p.add_argument("--dataset-file", type=Path, default=None,
                   help="local CSV (offline/air-gapped runners); also used as the download cache")
    p.add_argument("--dataset-sha256",
                   default=os.environ.get("SIMPLEQA_EXPECTED_SHA256", DEFAULT_DATASET_SHA256))
    p.add_argument("--allow-unverified", action="store_true",
                   default=os.environ.get("SIMPLEQA_ALLOW_UNVERIFIED", "").lower() == "true")
    p.add_argument("--endpoint", default=os.environ.get("MODEL_ENDPOINT", ""))
    p.add_argument("--model", default=os.environ.get("EVAL_MODEL_ID", ""))
    p.add_argument("--grader-endpoint", default=os.environ.get("SIMPLEQA_GRADER_ENDPOINT", ""),
                   help="defaults to --endpoint; point at a stronger model when you have one")
    p.add_argument("--grader-model", default=os.environ.get("SIMPLEQA_GRADER_MODEL", ""))
    p.add_argument("--grader-template-file", type=Path, default=None,
                   help="replace the built-in rubric (placeholders: {question} {target} {predicted_answer})")
    p.add_argument("--api-key-env", default="MODEL_API_KEY")
    p.add_argument("--grader-api-key-env", default="SIMPLEQA_GRADER_API_KEY")
    p.add_argument("--sample-size", type=int,
                   default=int(os.environ.get("SIMPLEQA_SAMPLE_SIZE", "100") or 0),
                   help="0 = all 4326 questions; default 100 keeps CI cost bounded")
    p.add_argument("--seed", type=int, default=int(os.environ.get("EVAL_SAMPLE_SEED", "20260824")))
    p.add_argument("--concurrency", type=int, default=int(os.environ.get("EVAL_CONCURRENCY", "4")))
    p.add_argument("--max-tokens", type=int, default=int(os.environ.get("EVAL_MAX_TOKENS", "256")))
    p.add_argument("--timeout", type=int, default=int(os.environ.get("EVAL_TIMEOUT", "60")))
    p.add_argument("--retries", type=int, default=int(os.environ.get("EVAL_RETRIES", "2")))
    p.add_argument("--keep-transcripts", action="store_true",
                   default=os.environ.get("SIMPLEQA_KEEP_TRANSCRIPTS", "").lower() == "true",
                   help="retain full answers in the report (benign content — off only to keep artifacts small)")
    p.add_argument("--min-f1", type=float, default=float(os.environ.get("SIMPLEQA_MIN_F1", "0") or 0),
                   help="fail the job below this F1; 0 = report-only (teeth-last default)")
    args = p.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    def write(doc: dict) -> None:
        args.output.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")

    grader_endpoint = args.grader_endpoint or args.endpoint
    grader_model = args.grader_model or args.model

    if not args.endpoint:
        print("MODEL_ENDPOINT not set — SimpleQA factuality signal skipped (pipeline does no inference by default).")
        write({"schema_version": "1.0", "kind": "simpleqa-eval", "skipped": True,
               "reason": "MODEL_ENDPOINT not set"})
        return
    if not args.model:
        print("EVAL_MODEL_ID not set — SimpleQA factuality signal skipped.")
        write({"schema_version": "1.0", "kind": "simpleqa-eval", "skipped": True,
               "reason": "EVAL_MODEL_ID not set"})
        return
    if not grader_model:
        print("No grader model (SIMPLEQA_GRADER_MODEL / EVAL_MODEL_ID) — SimpleQA signal skipped.")
        write({"schema_version": "1.0", "kind": "simpleqa-eval", "skipped": True,
               "reason": "no grader model configured"})
        return

    data, digest = fetch_dataset(args.dataset_url, args.dataset_file,
                                 args.dataset_sha256 or None, args.timeout,
                                 args.allow_unverified)
    questions = load_questions(data)
    total_available = len(questions)
    if args.sample_size and args.sample_size < len(questions):
        questions = sorted(random.Random(args.seed).sample(questions, args.sample_size),
                           key=lambda q: q["id"])

    template = GRADER_TEMPLATE
    if args.grader_template_file:
        template = args.grader_template_file.read_text(encoding="utf-8")

    answer_url, grade_url = chat_url(args.endpoint), chat_url(grader_endpoint)
    answer_key = os.environ.get(args.api_key_env, "")
    grade_key = os.environ.get(args.grader_api_key_env, "") or answer_key
    print(f"SimpleQA: {len(questions)}/{total_available} question(s) → "
          f"{urllib.parse.urlsplit(answer_url).netloc} [model={args.model}], "
          f"graded by {grader_model} @ {urllib.parse.urlsplit(grade_url).netloc}")

    def evaluate(q: dict) -> dict:
        out = {"id": q["id"], "question": q["question"], "target": q["answer"]}
        answer, error = call_model(answer_url, answer_key, args.model, q["question"],
                                   max_tokens=args.max_tokens, timeout=args.timeout,
                                   retries=args.retries)
        if error is not None:
            return {**out, "error": f"answer: {error}", "grade": None}
        prompt = template.format(question=q["question"], target=q["answer"],
                                 predicted_answer=answer)
        verdict, error = call_model(grade_url, grade_key, grader_model, prompt,
                                    max_tokens=8, timeout=args.timeout, retries=args.retries)
        if error is not None:
            return {**out, "error": f"grader: {error}", "grade": None}
        grade = parse_grade(verdict)
        if grade is None:
            return {**out, "error": f"grader returned no A/B/C verdict: {(verdict or '')[:80]!r}",
                    "grade": None}
        rec = {**out, "grade": grade,
               "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest()}
        if args.keep_transcripts:
            rec["answer"] = answer
        return rec

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        results = list(pool.map(evaluate, questions))

    errors = [r for r in results if r.get("error")]
    graded = [r for r in results if r.get("grade")]
    n = len(graded)
    correct = sum(1 for r in graded if r["grade"] == "A")
    incorrect = sum(1 for r in graded if r["grade"] == "B")
    not_attempted = sum(1 for r in graded if r["grade"] == "C")

    # Upstream's metric definitions (simple-evals/simpleqa_eval.py).
    is_correct = round(correct / n, 4) if n else None
    is_incorrect = round(incorrect / n, 4) if n else None
    is_not_attempted = round(not_attempted / n, 4) if n else None
    attempted = correct + incorrect
    accuracy_given_attempted = round(correct / attempted, 4) if attempted else None
    f1 = None
    if accuracy_given_attempted and is_correct:
        f1 = round(2 * accuracy_given_attempted * is_correct /
                   (accuracy_given_attempted + is_correct), 4)
    elif n:
        f1 = 0.0

    doc = {
        "schema_version": "1.0",
        "kind": "simpleqa-eval",
        "skipped": False,
        "status": "passed" if graded else "failed",
        "model": args.model,
        "grader_model": grader_model,
        "endpoint_host": urllib.parse.urlsplit(answer_url).netloc,
        "dataset": {
            "source": "openai/simple-evals — simple_qa_test_set.csv",
            "url": args.dataset_url,
            "sha256": digest,
            "pinned": bool(args.dataset_sha256),
            "questions_available": total_available,
            "questions_sampled": len(questions),
            "sample_seed": args.seed,
        },
        "grader_template": "upstream-file" if args.grader_template_file else "built-in-rubric",
        "metrics": {
            "questions": len(questions),
            "graded": n,
            "errors": len(errors),
            "correct": correct,
            "incorrect": incorrect,
            "not_attempted": not_attempted,
            "is_correct": is_correct,
            "is_incorrect": is_incorrect,
            "is_not_attempted": is_not_attempted,
            "accuracy_given_attempted": accuracy_given_attempted,
            "f1": f1,
            "error_rate": round(len(errors) / len(questions), 4) if questions else None,
        },
        "transcripts_retained": bool(args.keep_transcripts),
        "results": results,
    }
    if not graded:
        doc["failure_reason"] = "every question errored — no factuality metrics could be computed"

    write(doc)
    print(f"  graded {n}/{len(questions)} (errors={len(errors)}): correct={correct} "
          f"incorrect={incorrect} not_attempted={not_attempted}")
    print(f"  accuracy_given_attempted={accuracy_given_attempted} f1={f1}")

    if not graded:
        print("ERROR: SimpleQA eval produced no usable measurements.")
        raise SystemExit(1)
    if args.min_f1 and f1 is not None and f1 < args.min_f1:
        print(f"ERROR: f1 {f1} < SIMPLEQA_MIN_F1 {args.min_f1}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
