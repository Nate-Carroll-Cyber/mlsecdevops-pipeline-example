# GAIPS CI Pipeline — CI/CD Variable Reference

Every variable `ci/.gitlab-ci.yml` reads, where it's set, and what it gates. Set
these in **GitLab → Settings → CI/CD → Variables** (or fetch from Vault via the
`vault-secrets` job — see the *Source* column).

**Legend**
- **Source:** `you` = set as a CI/CD variable · `vault` = fetched by `vault-secrets`
  from Vault (or set directly as a CI/CD variable if not using Vault) ·
  `gitlab` = predefined by GitLab · `id_tokens` = minted per-job, not user-set ·
  `default` = has a value in the CI file you rarely change.
- **Masked:** mark **Yes** variables as *Masked* (and *Protected* if your default
  branch is protected). Vault-sourced secrets are injected via a short-lived
  dotenv artifact and are **not** masked in logs — keep `vault-secrets` artifacts
  short-expiry (already 30 min) or prefer GitLab's native `secrets:` integration.

---

## 1. Bare minimum (nothing else configured → pipeline still runs green)

| Variable | Source | Masked | Default | Purpose |
| --- | --- | --- | --- | --- |
| `VAULT_ADDR` | you | No | _(unset)_ | Vault/HCP cluster URL. **Unset → `vault-secrets` skips and the pipeline reads plain CI/CD variables instead.** |
| `VAULT_NAMESPACE` | you | No | `""` | HCP Vault / Enterprise namespace (`admin` or `admin/gaips`). Blank for self-managed OSS Vault. |

> With just these (or nothing at all), the pipeline runs: every model/dataset/
> integration job skips cleanly, and the only hard gates — `secret-detection`,
> `gitleaks-scan`, `clamav-scan`, `artifact-signing-gate` — pass on
> a clean repo.

`secret-detection` uses a shallow HEAD checkout (`GIT_DEPTH: 1`) plus
`SECRET_DETECTION_LOG_OPTIONS="--max-count=1"` so current pipelines gate new
committed secrets without repeatedly failing on historic lab/app fixtures.
Run one-off historic scans or repository history cleanup separately when needed.

---

## 2. Secrets fetched by `vault-secrets` (or set directly if not using Vault)

Each maps to a Vault path `secret/data/gaips/ci/<name>` (field `value`). If you're
**not** using Vault, set these directly as CI/CD variables instead.

| Variable | Vault path (`…/ci/…`) | Masked | Seeded by TF? | Purpose / consuming jobs |
| --- | --- | --- | --- | --- |
| `MODEL_ENDPOINT` | `model-endpoint` | No | ✅ stub | Model API base URL. **Not used by this pipeline** (it does no inference) — it drives the endpoint-dependent evals in the separate live-scan pipeline ([`ci/live-scans.md`](live-scans.md)). |
| `MODEL_SIGNING_IDENTITY` | `model-signing-identity` | No | ✅ stub | Fulcio cert identity `signature-verification` checks model sigs against. |
| `SIGSTORE_OIDC_ISSUER` | `sigstore-oidc-issuer` | No | ✅ stub | OIDC issuer for `signature-verification`. |
| `HF_TOKEN` | `hf-token` | Yes | ✅ stub | HuggingFace token for gated/private repos (`hf-artifact-scan`). |
| `GEMINI_API_KEY` | `gemini-api-key` | Yes | ✅ stub | Model-provider key (available to eval jobs that need it). |
| `CI_REGISTRY_TOKEN` | `registry-token` | Yes | ✅ stub | Registry token (provisioned for app/registry use). |
| `DT_API_URL` | `dt-api-url` | No | ❌ add manually | Dependency-Track base URL (see §4). |
| `DT_API_KEY` | `dt-api-key` | Yes | ❌ add manually | Dependency-Track API key (needs BOM_UPLOAD + VIEW). |

For projects not using Vault yet, set `MODEL_SIGNING_IDENTITY` and
`SIGSTORE_OIDC_ISSUER` directly as GitLab project CI/CD variables after running
the one-shot `sigstore-identity-discover` job on `main`. Use the exact values
printed by that job. Keep masking and hiding off because these are public
verification identifiers, not secrets; leave variable expansion off.

> **"Seeded by TF?"** Terraform (`deployment/vault/terraform/`) creates the first
> six as fixture stubs (`ignore_changes`, so real values you `vault kv put` later
> survive applies). The last three are **not** seeded — add them only if you use
> those integrations; `vault-secrets` logs a WARN and continues without them.

---

## 3. Model & dataset scanning

| Variable | Source | Masked | Default | Purpose |
| --- | --- | --- | --- | --- |
| `HF_MODEL_IDS` | you | No | `""` | Comma-separated HF repo IDs to scan, e.g. `org/model-a,org/model-b`. Blank → `hf-artifact-scan` skips. |
| `MODEL_FIXTURE_URL` | default/you | No | `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q2_k.gguf` | Direct model artifact URL downloaded into `MODEL_DIR` before digest/sign/scan jobs. Set to blank to skip. |
| `MODEL_FIXTURE_PATH` | default/you | No | `qwen2.5-1.5b-instruct-gguf/qwen2.5-1.5b-instruct-q2_k.gguf` | Relative path under `models/` for the downloaded fixture. |
| `MODEL_FIXTURE_SHA256` | default/you | No | `5ede348e91ce1e7a330926ec5b202c27b864d065149dc463257fde1f98865b3a` | Expected SHA-256 for `MODEL_FIXTURE_URL`; the download job fails if it does not match. |
| `DATASET_PACKAGE_NAME` | you | No | `""` | Generic Package Registry package holding the dataset. |
| `DATASET_PACKAGE_VERSION` | you | No | `latest` | Dataset package version tag. |
| `DATASET_FILENAME` | you | No | `""` | Dataset filename to download from the Generic Package Registry. Blank → use committed `evals/ci-dataset.jsonl` fixture so the dataset scan/sign/publish path still runs. |
| `DATASET_EXPECTED_SHA256` | you | No | `""` | Optional integrity pin — `dataset-download` fails on mismatch. |
| `REDACT_MAX_SECRETS` | default | No | `0` | `dataset-redact` hard-fails if secret findings exceed this (0 = zero tolerance). |
| `REDACT_MAX_PII` | default | No | `-1` | PII-count gate; `-1` disables the gate (data is still redacted). |

---

## 4. Integrations

| Variable | Source | Masked | Default | Purpose |
| --- | --- | --- | --- | --- |
| `DT_API_URL` | vault/you | No | `""` | Dependency-Track URL (no trailing `/api`). Blank → `dependency-track-upload` skips. |
| `DT_API_KEY` | vault/you | Yes | `""` | Dependency-Track API key. |
| `DT_FAIL_ON` | default | No | `FAIL` | `violationState`(s) that fail the DT policy gate (comma list). |
| `DVC_REMOTE_URL` | you | No | `""` | `s3://`/`gs://`/`azure://`/`ssh://` remote for `dvc-verify` to pull pinned data/models. Blank → reports status only. |
| `GITLAB_API_TOKEN` | you | Yes | `""` | Project/group access token with **`read_api`** scope. Enables the operational block of `metrics-normalize` (pipeline/job duration, queue time, status by stage via the GitLab API). **Blank → the operational block skips cleanly; report-derived metrics + the Pages dashboard still render.** |

---

## 5. Deploy-prep (sign → verify-at-deploy)

| Variable | Source | Masked | Default | Purpose |
| --- | --- | --- | --- | --- |
| `IMAGE_REF` | you | No | `""` | Built workload image to sign (prefer a digest `repo@sha256:…`). Blank → `image-sign` skips. |
| `IMAGE_REGISTRY_HOST` | you | No | `""` → `${CI_REGISTRY}` | Registry host for cosign to push the signature. |
| `IMAGE_REGISTRY_USER` | you | No | `""` → `${CI_REGISTRY_USER}` | Registry username. |
| `IMAGE_REGISTRY_PASSWORD` | you | Yes | `""` → `${CI_REGISTRY_PASSWORD}` | Registry password/token. |
| `EVIDENCE_PACKAGE_NAME` | default | No | `gaips-evidence` | Generic Package Registry package for `publish-signed-artifacts`. |
| `EVIDENCE_PACKAGE_VERSION` | default | No | `${CI_COMMIT_REF_SLUG}` | Package version — the PreSync `ARTIFACT_BASE_URL` must point here. |

---

## 6. Signing keys & baseline automation

| Variable | Source | Masked | Default | Purpose |
| --- | --- | --- | --- | --- |
| `CYCLONEDX_SIGNING_KEY` | you | Yes | _(unset)_ | RSA private key (PEM) for a **stable** AI-BOM signer identity. Unset → `ai-bom-sign` uses an ephemeral per-run keypair. |
| `CYCLONEDX_SIGNING_PUB` | you | No | _(unset)_ | Matching RSA public key (PEM); published as `aibom-signing.pub` for offline verify. |
| `GITLAB_PUSH_TOKEN` | you | Yes | _(unset)_ | Project Access Token (scope `write_repository`) so `model-baseline-commit` can auto-commit the seeded `evals/eval-baseline.json`. Unset → manual commit. |

---

## 7. Tuning thresholds (override only if needed)

| Variable | Source | Default | Purpose |
| --- | --- | --- | --- |
| `DRIFT_THRESHOLD` | default | `0.10` | Absolute eval-metric movement that flags drift (`model-drift-detection`; the enforcing gate lives in the live-scans pipeline — the static pipeline's `drift-gate` was removed). |

The following tuning variables belong to the separate **live-scan pipeline**
([`ci/live-scans.md`](live-scans.md)), not this one:

| Variable | Source | Default | Purpose |
| --- | --- | --- | --- |
| `INSPECT_PASS_THRESHOLD` | you (env) | `0.60` | Accuracy floor below which an Inspect AI eval counts as a fail. |
| `GARAK_REST_MODEL` | you (env) | `gaips` | `model` field sent in garak's REST request body. |
| `REST_API_KEY` | you | _(unset)_ | Bearer token added to garak's REST calls when present. |

---

## 8. Pinned versions & package mirrors (defaults at top of the CI file)

Change these in one place to roll the whole pipeline. Override per-project only to
match an internal mirror or bump a tool.

| Variable | Default | Purpose |
| --- | --- | --- |
| `COSIGN_VERSION` | `v2.4.1` | cosign release (checksum-verified at install). |
| `GITLEAKS_VERSION` | `8.30.1` | gitleaks **binary** for `dataset-redact` (checksum-verified). |
| `PROMPTFOO_VERSION` | `0.121.15` | `npm install -g promptfoo@…` (used by the separate [live-scan pipeline](live-scans.md), not this one). |
| `MARKLLM_VERSION` | `0.1.5` | Pinned `markllm` for `markllm-deps-audit` + `markllm-watermark-eval`. |
| `TORCH_VERSION` | `2.12.0` | Pinned `torch` for the MarkLLM watermark stack. |
| `TRANSFORMERS_VERSION` | `4.57.6` | Pinned `transformers` for the MarkLLM stack — held on the **4.x** line because markllm 0.1.5 predates the transformers 5.x major release. |
| `MARKLLM_MODEL_ID` | `""` (derived) | Hugging Face **transformers** repo id for `markllm-watermark-eval`. Leave empty and the job derives it from `MODEL_FIXTURE_URL` at runtime — the HF GGUF repo (e.g. `Qwen/Qwen2.5-1.5B-Instruct-GGUF`) is mapped to its transformers repo (`Qwen/Qwen2.5-1.5B-Instruct`), since `AutoModelForCausalLM` can't load GGUF. Set explicitly to override. The job fails only if no id can be resolved (empty and no `MODEL_FIXTURE_URL`). |
| `MARKLLM_MODEL_REVISION` | `""` | Optional pinned branch, tag, or commit for the model loaded by MarkLLM. Recommended for reproducible evidence. |
| `IMAGE_SEMGREP` | `semgrep/semgrep:v1.165.0` | SAST image. |
| `IMAGE_MINICONDA` | `continuumio/miniconda3:26.3.2` | conda verify image. |
| `IMAGE_SYFT` | `anchore/syft:v1.45.1` | SBOM image. |
| `IMAGE_GRYPE` | `anchore/grype:v0.114.0` | Vuln-scan image. |
| `IMAGE_TRIVY` | `aquasec/trivy:v0.71.0` | FS/container scan image. |
| `IMAGE_CYCLONEDX` | `cyclonedx/cyclonedx-cli:0.32.0` | AI-BOM validate/sign image. |
| `IMAGE_GITLEAKS` | `gitleaks/gitleaks:v8.30.1` | `gitleaks-scan` SAST image (matches the `GITLEAKS_VERSION` binary). |
| `IMAGE_CLAMAV` | `clamav/clamav:1.4` | `clamav-scan` image (patch-floating line; append a digest to hard-pin). |
| `PIP_INDEX_URL` | `https://pypi.org/simple/` | Swap for an internal Artifactory/Nexus/GitLab PyPI mirror. |
| `PIP_TRUSTED_HOST` | `pypi.org files.pythonhosted.org` | Trusted hosts for the index above. |
| `CONDA_CHANNEL` | `conda-forge` | Strict-priority conda channel for `conda-pkg-verify`. |

> **All scanner images are now tag-pinned** via these `IMAGE_*` variables — no job
> uses `:latest`. Remaining hardening (see `SBOM.md`): append `@sha256:…` digests
> for byte-exact reproducibility, and pin `python`/`node` to a full minor.

---

## 9. Auto-provided (do not set)

`VAULT_ID_TOKEN` and `SIGSTORE_ID_TOKEN` are minted per-job by `id_tokens:`
blocks (GitLab ≥ 15.7). `CI_*` variables (`CI_PROJECT_DIR`, `CI_REGISTRY`,
`CI_JOB_TOKEN`, `CI_COMMIT_SHA`, `CI_DEFAULT_BRANCH`, …) are predefined by GitLab.
On GitLab < 15.7, the Vault jobs fall back to `CI_JOB_JWT_V2` (deprecated 16.x).

`SIGSTORE_ID_TOKEN` is not a project secret and should not be added in
GitLab Settings. Jobs that need keyless signing declare:

```yaml
id_tokens:
  SIGSTORE_ID_TOKEN:
    aud: "sigstore"
```

GitLab then injects a short-lived OIDC JWT into that job only. `model-sign`
passes this token explicitly to `model_signing` with `--identity_token` so the
Sigstore signer uses noninteractive GitLab OIDC instead of starting a browser
OAuth flow. If a signing job logs an OAuth URL, the job is not using the minted
token path.
