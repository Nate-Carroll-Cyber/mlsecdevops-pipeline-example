# GAIPS CI Pipeline — Software Bill of Materials

**Pipeline:** `ci/.gitlab-ci.yml`  
**Date:** 2026-06-08  
**Last updated:** 2026-06-08  
**Scope:** All tools, images, and packages installed or invoked by the pipeline at runtime. This is the pipeline's own dependency surface — not the project code it scans.

> **Pin status key**  
> ✅ Pinned — explicit version locked in the CI file  
> ⚠️ Unpinned — installs latest at job runtime; pin before production use

---

## Container Images

| Image | Tag | Used by | Pin status |
| --- | --- | --- | --- |
| `python` | `3.11-slim` | All jobs (default) | ⚠️ Unpinned minor — use `python:3.11.x-slim` with digest |
| `python` | `3.10-slim` | `markllm-watermark-eval`, `markllm-deps-audit` | ⚠️ Unpinned minor |
| `semgrep/semgrep` | `v1.165.0` | `semgrep-sast` | ✅ Pinned |
| `continuumio/miniconda3` | `26.3.2` | `conda-pkg-verify` | ✅ Pinned |
| `anchore/syft` | `v1.45.1` | `syft-cyclonedx`, `syft-spdx` | ✅ Pinned |
| `anchore/grype` | `v0.114.0` | `grype-scan` | ✅ Pinned |
| `aquasec/trivy` | `v0.71.0` | `trivy-scan` | ✅ Pinned |
| `node` | `20-slim` | `promptfoo-eval` | ⚠️ Unpinned minor |

---

## Binary Tools (installed at job runtime)

| Tool | Version | Source | Used by | Pin status |
| --- | --- | --- | --- | --- |
| `cosign` | `v2.4.1` | `github.com/sigstore/cosign/releases` | `model-signing-install`, `model-signing-evidence` | ✅ Pinned + checksum verified |
| `promptfoo` | `0.121.15` | `npm install -g promptfoo` | `promptfoo-eval` | ✅ Pinned |

---

## Python Packages (pip install)

All packages below are installed fresh in each job container. None are pinned in the CI file — each installs the latest available version at pipeline runtime.

| Package | Extras | Used by | Pin status | Notes |
| --- | --- | --- | --- | --- |
| `model-signing` | — | `model-signing-install`, `model-digest`, `model-sign`, `signature-verification`, `model-signing-evidence` | ⚠️ Unpinned | Core signing/verification library; pin to avoid breaking API changes |
| `sigstore` | — | `model-signing-install`, `model-sign`, `signature-verification`, `model-signing-evidence` | ⚠️ Unpinned | Sigstore Python SDK; used for keyless signing via Fulcio/Rekor |
| `hvac` | — | `vault-secrets`, `tamper-verification` | ⚠️ Unpinned | HashiCorp Vault Python client |
| `pip-audit` | — | `pip-audit` | ⚠️ Unpinned | Audits `requirements.txt` against OSV and advisory DBs |
| `pip-tools` | — | `pkg-integrity` | ⚠️ Unpinned | `pip-compile` for generating hashed lockfiles |
| `modelscan` | — | `modelscan`, `hf-artifact-scan` | ⚠️ Unpinned | Detects malicious serialization payloads in model files |
| `huggingface_hub` | — | `hf-artifact-scan` | ⚠️ Unpinned | Downloads HuggingFace model snapshots for scanning |
| `garak` | — | `garak-scan` | ⚠️ Unpinned | Adversarial LLM probe framework |
| `giskard` | `[llm]` | `giskard-scan` | ⚠️ Unpinned | LLM vulnerability scanner (bias, hallucination, injection) |
| `requests` | — | `giskard-scan` | ⚠️ Unpinned | HTTP client (transitive dep; listed explicitly) |
| `pandas` | — | `giskard-scan` | ⚠️ Unpinned | Data manipulation (required by giskard) |
| `inspect-ai` | — | `inspect-ai-eval` | ⚠️ Unpinned | Structured AI evaluation framework |
| `inspect-evals` | — | `inspect-ai-eval` | ⚠️ Unpinned | Built-in eval tasks (MMLU, TruthfulQA, WMDP, GDM CTF) |
| `markllm` | — | `markllm-watermark-eval` | ⚠️ Unpinned | LLM watermark detection |
| `torch` | — | `markllm-watermark-eval` | ⚠️ Unpinned | PyTorch (required by markllm) |
| `transformers` | — | `markllm-watermark-eval` | ⚠️ Unpinned | Hugging Face Transformers (required by markllm) |
| `pyrit` | — | `pyrit-scan` | ⚠️ Unpinned | Microsoft PyRIT adversarial red-teaming framework |
| `jinja2` | — | `evidence-summary` | ⚠️ Unpinned | Template rendering for evidence summary |
| `pip` / `setuptools` / `wheel` | — | All Python jobs (before_script) | ⚠️ Unpinned | Upgraded to latest in every job before_script |

---

## Vault Integration Dependencies

| Component | Version | Notes |
| --- | --- | --- |
| HashiCorp Vault | ≥ 1.12 | Required for JWT auth backend and KV v2. Version set by your deployment. |
| Vault Terraform provider (`hashicorp/vault`) | `~> 4.0` | Pinned in `deployment/vault/terraform/main.tf` |
| Terraform | ≥ 1.6 | Required by `deployment/vault/terraform/main.tf` |
| GitLab `id_tokens` | GitLab ≥ 15.7 | Required for OIDC JWT issuance (`VAULT_ID_TOKEN`, `SIGSTORE_ID_TOKEN`). Falls back to `CI_JOB_JWT_V2` on older instances (deprecated in GitLab 16.x). |

---

## Remediation Status

| Risk | Status | Notes |
| --- | --- | --- |
| `cosign` binary downloaded with no checksum verification | ✅ Fixed | Both install sites now download `cosign_checksums.txt` and verify via `sha256sum --check --strict` before installing |
| `promptfoo` unpinned | ✅ Fixed | Pinned to `0.121.15` via `PROMPTFOO_VERSION` variable at top of CI file |
| `torch` + `transformers` unaudited | ✅ Fixed | New `markllm-deps-audit` job runs `pip-audit` against `torch`, `transformers`, and `markllm` before `markllm-watermark-eval` |
| Container images use `:latest` | ✅ Fixed | All images pinned via `IMAGE_*` variables at top of CI file: `semgrep/semgrep:v1.165.0`, `continuumio/miniconda3:26.3.2`, `anchore/syft:v1.45.1`, `anchore/grype:v0.114.0`, `aquasec/trivy:v0.71.0`. `python:3.11-slim` and `node:20-slim` remain unpinned at minor version. |
| All pip packages unpinned | ✅ Structured | `ci/requirements-ci.in` created listing all pipeline packages. **Remaining action:** run `pip-compile --generate-hashes requirements-ci.in` on a Python 3.11-slim Linux container to produce `requirements-ci.txt`, commit it, then switch each CI job from inline `pip install` to `pip install -r ci/requirements-ci.txt` |
