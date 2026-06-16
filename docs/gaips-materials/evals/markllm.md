# MarkLLM Lab

MarkLLM adds live LLM watermarking evidence to the GAIPS CI pipeline. The CI job must run against the model being evaluated, selected by `MARKLLM_MODEL_ID` and optionally pinned with `MARKLLM_MODEL_REVISION`. It does not substitute a default model and does not downgrade to readiness-only evidence.

```bash
python -m pip install markllm torch transformers
MARKLLM_MODEL_ID=your-org/your-model \
python scripts/run_markllm_watermark_eval.py --output reports/markllm-results.json
```

Configure these variables before running the CI job:

```bash
MARKLLM_ALGORITHM=KGW
MARKLLM_CONFIG=config/KGW.json
MARKLLM_MODEL_ID=""        # required: Hugging Face model id for the evaluated model
MARKLLM_MODEL_REVISION=""  # optional but recommended: pinned branch, tag, or commit
```

Student task: explain how watermark generation and watermark detection support model-output provenance, then decide what policy should control model downloads, cache retention, and whether watermark failures should block release evidence.
