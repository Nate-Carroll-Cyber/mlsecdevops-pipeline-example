# garak Lab

> **CI location:** `garak-scan` runs in the separate live-scan pipeline
> ([`../ci/live-scans.md`](../ci/live-scans.md)) — not the main pipeline, which does
> no inference. The lab steps below are unchanged.

Live CI runs garak against the configured model REST endpoint:

```bash
python -m pip install garak
python -m garak \
  --model_type rest \
  --model_name "${MODEL_ENDPOINT:-http://localhost:8080/v1}" \
  --probes all \
  --report_prefix reports/garak \
  2>&1 | tee reports/garak.log
```

CI publishes `reports/garak.log` plus any `reports/garak*.json` files emitted by garak. The job is advisory while a baseline is being established, so findings should be reviewed and promoted into guardrail regression once the team agrees on expected behavior.

Student task: identify which probes represent direct prompt injection, which are irrelevant to the app, which are endpoint/configuration failures, and which should become regression tests.
