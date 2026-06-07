# Giskard Lab

Live CI wraps the configured chat-completions endpoint and runs selected Giskard LLM detectors:

```bash
python -m pip install "giskard[llm]" requests pandas
```

The CI wrapper reads:

- `MODEL_BASE_URL`, defaulting to `http://localhost:8080`
- `MODEL_API_KEY`, defaulting to an empty string
- `MODEL_ENDPOINT`, defaulting to `gpt-4o-mini`

It sends chat-completions requests to `${MODEL_BASE_URL}/v1/chat/completions`, runs detectors such as prompt injection, output formatting, information disclosure, harmful content, stereotypes, hallucination/misinformation, and sycophancy, then writes `reports/giskard/scan-report.html` and `reports/giskard/summary.json`.

Student task: map each finding to an app control, endpoint behavior, evidence file, and residual risk. If the endpoint is unavailable, record that as an evidence gap rather than treating fixture JSON as a live scan.
