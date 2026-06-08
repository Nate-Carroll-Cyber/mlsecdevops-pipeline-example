# GAIPS Materials

This directory contains the concrete starter artifacts and fixtures used by the GAIPS course docs. It is intentionally self-contained so a class can run without production accounts, private credentials, gated models, or undefined instructor assets.

## Directory Map

| Directory | Purpose |
| --- | --- |
| `starter-rag-app/` | Minimal capstone RAG app used when no class app exists. |
| `model-gateway/` | Reference provider wrapper and model-call evidence logging contract. |
| `data/` | Approved documents plus a benign malicious test document. |
| `evals/` | Promptfoo, garak, Giskard, Inspect AI, MarkLLM, and PyRIT lab instructions/config. |
| `evals/markllm.md` | MarkLLM watermark-readiness lab guidance for CI evidence and model-output provenance review. |
| `fixtures/` | Static red-team and eval outputs for fixture-mode labs. |
| `guardrails/` | Prompt Guard, Llama Guard 3, Model Armor, and regression fixtures. |
| `mcp/` | Lab-safe Cline MCP configuration. |
| `agent/` | Lab-safe agent fixture for tool permission and HackAgent review. |
| `buttercup/` | Automated vulnerability finding and patch-review fixture. |
| `ci/` | GitLab AI/ML security pipeline requiring project-level scripts, model artifacts, SBOM/vulnerability tooling, model-integrity checks, AI evals, and evidence outputs. See `ci/SBOM.md` for the pipeline's own dependency bill of materials. |
| `hugging-face-hub/` | Hub scanner and repository-settings review fixture. |
| `deployment/` | Kubernetes and Vault review fixtures. |
| `model-signing/` | Signed, unsigned, and tampered artifact review fixture. |
| `sagemaker/` | Sanitized Hugging Face Estimator notebook and training-script fixture. |
| `bedrock-knowledge-bases/` | Bedrock Knowledge Bases design-review fixture. |
| `model-customization/` | Completed Lab 12 customization matrix. |

## Student Copy Pattern

For a standalone lab repository, copy the needed subdirectories into the lab root:

```bash
mkdir -p gaips-labs
cp -R docs/gaips-materials/starter-rag-app gaips-labs/app
cp -R docs/gaips-materials/data gaips-labs/data
cp -R docs/gaips-materials/evals gaips-labs/evals
cp -R docs/gaips-materials/fixtures gaips-labs/fixtures
cp -R docs/gaips-materials/guardrails gaips-labs/guardrails
cp docs/gaips-materials/ci/.gitlab-ci.yml gaips-labs/.gitlab-ci.yml
```

Students should still explain each result. Fixture mode replaces unavailable execution, not analysis.

## CI Execution Policy

`ci/.gitlab-ci.yml` is a GitLab AI/ML security pipeline. It is intended for a lab repository that contains project-level dependencies, scripts, model artifacts, prompt/eval config, and guardrail baselines.

The pipeline stages are `setup`, `sast`, `sbom`, `vuln-scan`, `model-integrity`, `ai-eval`, `guardrail`, and `evidence`. It produces Semgrep, `pip-audit`, package-integrity, conda verification, Syft CycloneDX/SPDX, Grype, Trivy, ModelScan, Hugging Face artifact scan, model digest/signature/tamper, Promptfoo, garak, Giskard, Inspect AI, MarkLLM watermark-readiness, PyRIT, guardrail-regression, and evidence artifacts.

Before copying this CI file into a student lab repository, add or adapt `requirements.txt`, `models/`, `promptfooconfig.yaml`, `guardrails/baseline.json`, `scripts/rag_smoke_eval.py`, `scripts/pyrit_scan.py`, `scripts/guardrail_regression.py`, and `scripts/evidence_summary.py`. Configure endpoint, signing, and Hugging Face variables in GitLab CI/CD settings. Fixture files under `docs/gaips-materials/fixtures/` remain offline interpretation aids, not automatic CI pass-throughs.

## Pipeline Walkthrough

Jobs within each stage run in parallel unless a `needs:` dependency forces sequencing.

### Stage 1 — Setup

| Job | What it does |
| --- | --- |
| `setup` | Installs Python dependencies, creates `evidence/`, `sbom/`, and `reports/` directories, stamps pipeline ID and commit SHA into `evidence/pipeline.env`. |
| `vault-secrets` | Authenticates to Vault using a GitLab OIDC JWT and fetches six secrets (`MODEL_ENDPOINT`, `MODEL_SIGNING_IDENTITY`, `SIGSTORE_OIDC_ISSUER`, `HF_TOKEN`, `GEMINI_API_KEY`, `CI_REGISTRY_TOKEN`) into a dotenv artifact injected as environment variables into all downstream jobs. Falls back to GitLab CI/CD variables if `VAULT_ADDR` is not set. |

### Stage 2 — SAST

| Job | What it does |
| --- | --- |
| `semgrep-sast` | Runs Semgrep `--config=auto` across the full codebase; outputs a GitLab SAST report. |
| `pip-audit` | Audits `requirements.txt` against OSV, PyPI advisory DB, and GitHub Advisory DB; outputs JSON and CycloneDX (use CycloneDX for CVSS score analysis). |
| `pkg-integrity` | Checks for hash-pinning in `requirements.txt`; generates a hashed lockfile if absent; verifies no dependency conflicts in an isolated venv via `pip check`. |
| `conda-pkg-verify` | Re-verifies the same packages in a `conda-forge`-only conda environment with strict channel priority; produces a reproducible environment manifest. |

### Stage 3 — SBOM

| Job | What it does |
| --- | --- |
| `syft-cyclonedx` | Generates a Software Bill of Materials in CycloneDX JSON and XML formats. |
| `syft-spdx` | Generates a Software Bill of Materials in SPDX JSON and tag-value formats. |

### Stage 4 — Vulnerability Scan

| Job | What it does |
| --- | --- |
| `grype-scan` | Feeds the CycloneDX SBOM into Grype and scans for known CVEs; outputs a JSON findings report and a human-readable table. |
| `trivy-scan` | Runs Trivy against the filesystem and the container image (if a registry image exists for this commit); outputs a GitLab container scanning report. |

### Stage 5 — Model Integrity

This stage runs as a sequential chain that fans out into parallel checks before converging on a hard gate.

**Sequential chain:**

1. **`model-signing-install`** — Installs the `model-signing` and `sigstore` Python packages; downloads and installs the `cosign` Go binary from GitHub releases.
2. **`model-digest`** — SHA-256 hashes every model file (`.pkl`, `.pt`, `.safetensors`, `.gguf`, `.bin`, `.h5`, `.onnx`) under `models/` and writes the digest list to `evidence/model-digests.txt`.
3. **`model-sign`** — Gets a `SIGSTORE_ID_TOKEN` OIDC JWT (audience `"sigstore"`) from GitLab and runs `python -m model_signing sign sigstore` on each subdirectory under `models/`, producing a `model.sig` Sigstore bundle inside each one. Publishes the `.sig` files as artifacts.

**Parallel checks (run after `model-digest` or `model-sign`):**

| Job | What it does |
| --- | --- |
| `signature-verification` | Finds every `model.sig` produced by `model-sign` and calls `python -m model_signing verify sigstore` on each, validating the signature against `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER` from Vault. A failed verification fails the job. |
| `tamper-verification` | Compares the current digest list against a stored baseline. On first run, seeds the baseline. On subsequent runs, any digest change prints a diff and fails. Baseline is stored in Vault (`secret/data/gaips/tamper-baseline/{project-slug}`) for permanent storage; falls back to a 90-day GitLab artifact when Vault is unavailable. |
| `modelscan` | Runs ModelScan across `models/` to detect malicious serialization payloads (pickle exploits, unsafe operators). Fails immediately on any CRITICAL finding. |
| `hf-artifact-scan` | Downloads each HuggingFace model listed in `HF_MODEL_IDS` and runs ModelScan against it. Skips cleanly if `HF_MODEL_IDS` is not set. |

**Gate:**

**`artifact-signing-gate`** — Waits for all four parallel checks. Confirms `tamper_check_passed=true`. Nothing in the AI evaluation stage runs until this gate passes.

### Stage 6 — AI Evaluation

All jobs run in parallel after the gate passes.

| Job | What it does |
| --- | --- |
| `rag-smoke-eval` | Runs a local RAG smoke test against the GAIPS course materials. |
| `promptfoo-eval` | Runs adversarial prompt evaluations defined in `evals/promptfoo.yaml`. |
| `garak-scan` | Probes the live model endpoint (from `MODEL_ENDPOINT`) with all Garak probe modules to test for jailbreaks, extraction, and unsafe outputs. |
| `giskard-scan` | Runs Giskard's LLM scan against the live model for bias, hallucination, and prompt injection. |
| `inspect-ai-eval` | Runs structured capability and safety evaluations using `inspect-ai`. Uses project task files if present; otherwise runs MMLU (knowledge), TruthfulQA (honesty), WMDP bio/chem/cyber (hazard refusal), and GDM in-house CTF (agent safety). |
| `markllm-watermark-eval` | Tests whether model outputs can be watermark-detected using MarkLLM. |
| `pyrit-scan` | Runs Microsoft PyRIT adversarial probes against the model endpoint. |

### Stage 7 — Guardrail Regression

**`guardrail-regression`** — Waits for `promptfoo-eval` and `pyrit-scan`. Compares current results against a baseline to detect regressions — catches cases where a previously-blocked attack now succeeds.

### Stage 8 — Evidence

| Job | What it does |
| --- | --- |
| `evidence-summary` | Collects all reports from every prior job and renders a human-readable Markdown evidence summary to `evidence/evidence-summary.md`. Retained for 90 days. |
| `model-signing-evidence` | Builds a JSON bundle containing pipeline ID, commit SHA, branch, timestamp, and the full model digest list. Signs it with `cosign sign-blob` using the GitLab `SIGSTORE_ID_TOKEN`, producing a `.sig` and `.pem` certificate — a tamper-evident, publicly-verifiable record of the pipeline run. |
