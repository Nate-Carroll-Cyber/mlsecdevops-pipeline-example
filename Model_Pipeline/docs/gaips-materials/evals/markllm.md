# MarkLLM Lab

MarkLLM adds LLM watermarking evidence to the GAIPS CI pipeline. The default CI integration is readiness-only: it verifies the MarkLLM package surface and writes `reports/markllm-results.json` without requiring a live model download or long-running generation job. It exits successfully in this mode even when the MarkLLM import surface is unavailable, so the artifact records readiness without burning the pipeline.

```bash
python -m pip install markllm torch transformers
python scripts/run_markllm_watermark_eval.py --output reports/markllm-results.json
```

Configure these variables when the lab repository is ready to run live watermark generation and detection:

```bash
MARKLLM_ALGORITHM=KGW
MARKLLM_CONFIG=config/KGW.json
MARKLLM_MODEL_ID=facebook/opt-125m
MARKLLM_LIVE_EVAL=true
```

Student task: explain how watermark generation and watermark detection support model-output provenance, then decide what policy should control model downloads, cache retention, and whether watermark failures should become a hard CI gate.
