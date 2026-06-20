# GAIPS Materials

This directory contains the concrete starter artifacts and fixtures used by the GAIPS course docs. It is intentionally self-contained so a class can run without production accounts, private credentials, gated models, or undefined instructor assets.

## Repository File Tree

Every file tracked in this repo is part of the GAIPS model pipeline (the repo/dir is named `counter-spy`, but the unrelated app directories are **not** tracked here). This is the complete, authoritative layout:

```
counter-spy/   (GAIPS model pipeline — repo root)
├── .gitlab-ci.yml          ← the pipeline definition (static security pipeline)
├── requirements.txt        ← root runtime pins
├── .gitleaks.toml          ← secret-scan config
├── .gitignore
├── SESSION_HANDOFF.md       ← working/session log (not an end-user doc)
└── docs/
    ├── gitlab-pipeline-setup-notes.md
    └── gaips-materials/
        ├── README.md  SETUP.md  PIPELINE_JOB_VALIDATION.md  PIPELINE_FIX_PLAN_29-34.md
        ├── ci/
        │   ├── live-scans.gitlab-ci.yml   live-scans.md   ← endpoint-dependent live-eval pipeline
        │   ├── CI-VARIABLES.md  SBOM.md
        │   └── requirements-ci{,-markllm,-dataquality}.{in,txt}  ← grouped CI dep locks
        ├── scripts/         25 Python scripts — build_ai_bom, run_evidently_report,
        │                    write_ci_evidence_summary, redact_dataset, detect_model_drift,
        │                    dependency_track_upload, secure_software_scan, validate_eval_dataset, …
        ├── evals/           datasets + baselines + schema (model-baseline.json,
        │                    dataset-baseline.json, dataset-reference.jsonl,
        │                    gandalf-ignore-instructions-test.jsonl, eval-dataset.schema.json, …)
        ├── fixtures/        static red-team/eval outputs (garak, giskard, pyrit, inspect-ai)
        ├── guardrails/      llama-guard / prompt-guard / model-armor fixtures
        ├── hugging-face-hub/  HF scan fixture + review guide
        ├── model-signing/   lab-model, tampered-model, signing fixture
        └── deployment/
            ├── argocd/       application, appproject, verify-signatures PreSync hook
            ├── kubernetes/   rag-app, weaviate, network-policy, kyverno image-verify policy
            ├── dependency-track/  docker-compose + README
            └── vault/        terraform/, gaips-policy.hcl, jwt-auth-config.hcl
```

### Publishing to a Public GitHub Repo (hosting & sharing)

**CI continues to run in GitLab.** GitHub is a public mirror for hosting and sharing the product — not a second CI runner. `.gitlab-ci.yml` and `ci/live-scans.gitlab-ci.yml` ship **as-is**: they document the pipeline and execute in GitLab; GitHub simply displays them. No GitHub Actions port is intended. Before making the repo public:

- **Secret / identity hygiene (do this first).** Confirm nothing sensitive is committed: no PATs or tokens, no real internal hosts or signer identities (the committed examples use placeholders — e.g. the ArgoCD ConfigMap's `MODEL_SIGNING_IDENTITY: ci-signer@example.invalid`; the real value lives only in GitLab protected CI/CD variables, not in the repo), and fixtures/datasets contain only synthetic or sanitized data. The `gitleaks-scan` + `secret-detection` jobs already gate this in CI — confirm they're green before publishing.
- **Exclude internal working docs** from the public repo: `SESSION_HANDOFF.md`, `PIPELINE_JOB_VALIDATION.md`, `PIPELINE_FIX_PLAN_29-34.md`, `gitlab-pipeline-setup-notes.md` (session/working artifacts, not end-user material).
- **Add a `LICENSE`** for public distribution, and keep this README as the product entry point.
- Everything else — `scripts/`, `evals/`, `fixtures/`, `guardrails/`, `model-signing/`, `deployment/`, the `.md` docs, `requirements*.{in,txt}`, `.gitleaks.toml` — is shareable as-is.

## Directory Map

| Directory | Purpose |
| --- | --- |
| `model-gateway/` | Reference provider wrapper and model-call evidence logging contract. |
| `evals/` | Promptfoo, garak, Giskard, Inspect AI, MarkLLM, and PyRIT lab instructions/config. |
| `evals/markllm.md` | MarkLLM live watermark evaluation lab guidance for CI evidence and model-output provenance review. |
| `evals/model-baseline.json` | Approved model identity (path + sha256) and the CI variables it implies (`MODEL_FIXTURE_*`, MarkLLM stack); imported by the `model-manifest` job as a dotenv manifest and the reviewed source of truth for the model-integrity baseline. |
| `evals/dataset-baseline.json` | Approved dataset identity, provenance (HF source + revision), license, and integrity pin (`DATASET_EXPECTED_SHA256`) for the committed eval dataset (`gandalf-ignore-instructions-test.jsonl`); the data-side counterpart to `model-baseline.json`, read by `build_ai_bom.py` to stamp license + provenance onto the AI-BOM `data` component. |
| `fixtures/` | Static red-team and eval outputs for fixture-mode labs. |
| `guardrails/` | Prompt Guard, Llama Guard 3, Model Armor, and regression fixtures. |
| `mcp/` | Lab-safe Cline MCP configuration. |
| `agent/` | Lab-safe agent fixture for tool permission and HackAgent review. |
| `buttercup/` | Automated vulnerability finding and patch-review fixture. |
| `ci/` | GitLab AI/ML security pipeline requiring project-level scripts, model artifacts, SBOM/vulnerability tooling, model-integrity checks, AI evals, and evidence outputs. See `ci/SBOM.md` for the pipeline's own dependency bill of materials. |
| `hugging-face-hub/` | Hub scanner and repository-settings review fixture. |
| `deployment/` | Kubernetes, Weaviate components, Weaviate `values.yaml` TLS/encryption review, gRPC LoadBalancer, and Vault review fixtures. |
| `model-signing/` | Signed, unsigned, and tampered artifact review fixture. |
| `sagemaker/` | Sanitized Hugging Face Estimator notebook and training-script fixture. |
| `bedrock-knowledge-bases/` | Bedrock Knowledge Bases design-review fixture. |
| `model-customization/` | Completed Lab 12 customization matrix. |
| `scripts/csv_to_jsonl.py` | CSV-to-JSONL converter for training, eval, and ChatML-style message datasets. |
| `scripts/parquet_to_jsonl.py` | Offline Hugging Face Parquet → schema-valid eval JSONL converter (one-time ingest; `pyarrow`-only, never runs in CI). |
| `scripts/weaviate_ollama_sdk_example.py` | Weaviate Python SDK example that maps a collection to an Ollama-hosted embedding model. |

## Student Copy Pattern

For a standalone lab repository, copy the needed subdirectories into the lab root:

```bash
mkdir -p gaips-labs
cp -R docs/gaips-materials/evals gaips-labs/evals
cp -R docs/gaips-materials/fixtures gaips-labs/fixtures
cp -R docs/gaips-materials/guardrails gaips-labs/guardrails
cp .gitlab-ci.yml gaips-labs/.gitlab-ci.yml
```

Students should still explain each result. Fixture mode replaces unavailable execution, not analysis.

## CSV To JSONL Dataset Conversion

Use `scripts/csv_to_jsonl.py` when a lab receives a CSV training or eval dataset but the model, eval, or fine-tuning workflow expects JSONL. The script uses only the Python standard library.

Default ChatML-style conversion expects `prompt` and `completion` columns:

```bash
python docs/gaips-materials/scripts/csv_to_jsonl.py \
  --input data/training.csv \
  --output data/training.jsonl \
  --schema chatml
```

Optional developer/system instructions may be supplied with `--system-column system`. For raw row preservation, use `--schema records`. For simple prompt/completion JSONL, use `--schema prompt-completion`.

Before conversion, verify the CSV contains only approved synthetic or sanitized data. After conversion, record row count, schema, source path, output path, and any redaction performed in lab evidence.

## Parquet To JSONL Dataset Conversion

**Purpose.** Hugging Face datasets ship as Parquet, but the pipeline's dataset chain (`dataset-scan`, `redact_dataset.py`, `validate_eval_dataset.py`, Evidently, Great Expectations, YData) is JSON/JSONL throughout. Rather than teach six jobs to read a columnar binary format, inbound datasets are normalised to JSONL **once, offline, at ingest** — the same pattern as `csv_to_jsonl.py`. JSONL is also diffable and reviewable, which matters because the result becomes a signed, git-committed integrity baseline. `scripts/parquet_to_jsonl.py` is the only tool here that needs `pyarrow`; that dependency is deliberately **not** part of the CI surface (see [`ci/SBOM.md`](ci/SBOM.md)).

**Task.** Each record is made to satisfy `evals/eval-dataset.schema.json`, which requires an `id` (or `case_id`) **and** a prompt-bearing field (`question`/`prompt`). The converter synthesises a deterministic `id`, maps the chosen text column to `prompt`, optionally tags a `category`, and carries through any extra columns named with `--keep`. Source/license/citation provenance lives once in `evals/dataset-baseline.json`, not per record.

```bash
python docs/gaips-materials/scripts/parquet_to_jsonl.py \
  --input ~/Downloads/test-00000-of-00001-bc92128b9288a6d1.parquet \
  --output docs/gaips-materials/evals/gandalf-ignore-instructions-test.jsonl \
  --text-field text --prompt-field prompt \
  --id-prefix gandalf-ignore-test --category prompt-injection \
  --keep similarity
```

**Output.** A JSONL file under `evals/`, one record per line, validating against `eval-dataset.schema.json`. After conversion: record the source dataset + revision + license in `evals/dataset-baseline.json`, compute the file's SHA-256, and set it as `DATASET_EXPECTED_SHA256` (the integrity pin). The committed Lakera `gandalf_ignore_instructions` test split (112 records, MIT) was produced this way.

## Activating Data-Drift Detection

**Purpose.** `evidently-drift` watches the **input** side for distribution drift: Evidently's `DataDriftPreset` (PSI) compares the *current* dataset against a **committed reference snapshot** at `evals/dataset-reference.jsonl`. Until that reference exists the job runs in **seed-mode** — it emits a `{"seeded": true, "drift_detected": false}` placeholder (that is the seed default, **not** a real "no drift" verdict) and writes a candidate reference to `reports/dataset-reference.seed.jsonl` for you to commit. Activation is what turns the placeholder into an actual comparison.

**How activation works (the seed → commit → compare chain).** Activation deliberately spans **two default-branch runs**:

1. **Seed.** On a default-branch run with no committed reference, `evidently-drift` writes `reports/dataset-reference.seed.jsonl` (a snapshot of the current dataset).
2. **Commit the reference.** The seed is **sanitized** (null / non-finite values dropped per record, re-emitted as strict JSONL, aborts if zero valid records — never a raw `cp`) and committed to `evals/dataset-reference.jsonl`. Two ways:
   - **Automatic** — `data-drift-baseline-commit` does this for you on the default branch **if `GITLAB_PUSH_TOKEN` is set** (a PAT with `write_repository`). It commits with `[skip ci]` + `-o ci.skip` so it never loops, and never overwrites an existing reference.
   - **Manual** (when `GITLAB_PUSH_TOKEN` is unset) — download the seed from the `evidently-drift` job artifact, sanitize it the same way, and commit it:
     ```bash
     # from the evidently-drift job artifacts: reports/dataset-reference.seed.jsonl
     python3 - reports/dataset-reference.seed.jsonl docs/gaips-materials/evals/dataset-reference.jsonl <<'PY'
     import json, math, sys
     src, dst = sys.argv[1], sys.argv[2]
     out = [{k: v for k, v in json.loads(l).items()
             if v is not None and not (isinstance(v, float) and not math.isfinite(v))}
            for l in open(src, encoding="utf-8") if l.strip()]
     out = [r for r in out if r]
     assert out, "seed produced zero valid records — refusing to commit an empty reference"
     open(dst, "w", encoding="utf-8").write("\n".join(json.dumps(r, sort_keys=True) for r in out) + "\n")
     print(f"sanitized {len(out)} record(s) -> {dst}")
     PY
     git add docs/gaips-materials/evals/dataset-reference.jsonl && git commit -m "ci: seed data-drift reference"
     ```
3. **Compare.** The **next** default-branch pipeline finds `evals/dataset-reference.jsonl`, so `evidently-drift` runs the PSI comparison and emits a real verdict (`"seeded": false`, `"drift_detected": true|false`). (The automatic commit uses `[skip ci]`, so its *next* run is the first to compare; a manual commit pushed normally triggers that comparison run directly.)

**⚠️ The reference must be a representative "normal" corpus, or the signal is vacuous.** PSI drift only means something when the committed reference is a realistic baseline of *expected* data and the current data can plausibly diverge from it. If the reference is the **same fixture** the pipeline re-uses every run (e.g. the single-class adversarial `gandalf` set), then reference ≈ current on every run → "no drift" forever, and the gate is plumbing-only theater. In that mode, **integrity/tamper detection is already covered better** by the deterministic `DATASET_EXPECTED_SHA256` pin (`dataset-download`) plus `dataset-sign` — drift adds nothing over those until a real reference exists. `evidently-drift` is a **soft gate** (`allow_failure: true`) and never blocks the pipeline; treat its verdict as monitoring, not enforcement, until a representative reference is in place.

**Output.** `evals/dataset-reference.jsonl` committed (the activated baseline) → subsequent `evidently-drift` runs report a real PSI verdict in `reports/evidently-drift.json` and an HTML/JSON report under `evidence/evidently/`.

## CI Execution Policy

The repo-root `.gitlab-ci.yml` is a GitLab AI/ML security pipeline. It is intended for a lab repository that contains project-level dependencies, scripts, model artifacts, prompt/eval config, and guardrail baselines. A companion [`ci/live-scans.gitlab-ci.yml`](ci/live-scans.gitlab-ci.yml) holds the endpoint-dependent live evals as a separate pipeline for a project with a model endpoint — see [`ci/live-scans.md`](ci/live-scans.md).

> **Secrets management.** HashiCorp Vault remains the recommended production-grade secrets management option for this pipeline, especially when centralized auditability, short-lived credentials, and policy-based secret access are required. To reduce operating costs for lab, demo, and early validation environments, this repository also supports standard GitLab CI/CD variables as a lower-cost fallback when `VAULT_ADDR` is not configured.

> **Full setup runbook:** [`SETUP.md`](SETUP.md) walks the entire path end to end — GitLab CI/CD variables and the first pipeline run, optional HashiCorp Vault provisioning with Terraform (production), other optional integrations (Dependency-Track, HF/dataset scanning, DVC), and deploy-time Kyverno + Argo CD verification.
> **CI/CD variable catalog:** [`ci/CI-VARIABLES.md`](ci/CI-VARIABLES.md) lists every variable the pipeline reads, its source (you / Vault / GitLab), masking, default, and what it gates. Terraform inputs: [`deployment/vault/terraform/terraform.tfvars.example`](deployment/vault/terraform/terraform.tfvars.example).

The pipeline stages are `setup`, `sast`, `sbom`, `vuln-scan`, `model-integrity`, `ai-eval`, `guardrail`, `evidence`, `ai-bom`, and `deploy-prep`. It produces Git version provenance, Semgrep, `pip-audit`, package-integrity, conda verification, Syft CycloneDX/SPDX, Grype, Trivy, OSS dependency reputation/malware screening (ReversingLabs Spectra Assure Community), ModelScan, ModelAudit, Hugging Face artifact scan, model digest/signature/tamper, dataset redaction (secrets + PII), eval-dataset schema validation, MarkLLM live watermark evaluation, model-drift detection, evidence, a consolidated CycloneDX 1.6 AI BOM artifact (also pushed to Dependency-Track), a Cosign-signed workload image, and a published signed-artifact bundle for deploy-time verification. It performs **no inference** and needs no model endpoint.

> **Live evals run in a separate pipeline.** The endpoint-dependent evals — `promptfoo-eval`, `garak-scan`, `giskard-scan`, `inspect-ai-eval`, `pyrit-scan`, and `guardrail-regression` — were split out into a standalone config, [`ci/live-scans.gitlab-ci.yml`](ci/live-scans.gitlab-ci.yml), meant to run as the root pipeline of a *separate* project that has a live model endpoint. See [`ci/live-scans.md`](ci/live-scans.md).

Before copying this CI file into a student lab repository, add or adapt `requirements.txt`, `models/`, `scripts/write_ci_evidence_summary.py`, `scripts/build_ai_bom.py`, `scripts/write_version_info.py`, `scripts/validate_eval_dataset.py`, `scripts/redact_dataset.py`, `scripts/detect_model_drift.py`, the data-quality collectors (`scripts/run_great_expectations.py`, `scripts/run_evidently_report.py`, `scripts/run_ydata_profile.py`, `scripts/run_markllm_watermark_eval.py`, `scripts/dependency_track_upload.py`, `scripts/secure_software_scan.py`), `evals/eval-dataset.schema.json`, and (after the first run seeds it) `evals/eval-baseline.json`. Configure signing and Hugging Face variables in GitLab CI/CD settings (no model endpoint is needed — this pipeline does no inference). Fixture files under `docs/gaips-materials/fixtures/` remain offline interpretation aids, not automatic CI pass-throughs.

The endpoint-dependent live-eval materials (`evals/promptfoo.yaml`, `guardrails/baseline.json`, `scripts/pyrit_scan.py`, `scripts/run_guardrail_regression.py`, `scripts/collect_garak_report.py`, `scripts/collect_inspect_report.py`, `scripts/run_giskard_live.py`) belong to the separate live-scan pipeline — see [`ci/live-scans.md`](ci/live-scans.md).

## Pipeline Walkthrough

Jobs within each stage run in parallel unless a `needs:` dependency forces sequencing.

### Process Flow

The pipeline is a DAG: the `model-integrity` stage converges on `artifact-signing-gate`, which blocks all AI evaluation until model and dataset integrity is proven. The `ai-bom` stage rolls every prior element into one signed CycloneDX 1.6 AI BOM. The terminal `deploy-prep` stage then **signs the workload image** and **publishes the signed artifacts**, closing the sign→verify-at-deploy loop that **Kyverno** (container image) and the **Argo CD PreSync hook** (model / dataset / AI-BOM signatures) enforce at admission and sync time — the dashed edges below. (Rendered natively by GitLab.)

```mermaid
flowchart TD
    setup[setup<br/>+ vault-secrets]

    subgraph SAST [sast]
      sast_jobs[semgrep · secret-detection · gitleaks<br/>pip-audit · secure-software-scan · pkg-integrity · conda-verify]
    end
    subgraph SBOM [sbom]
      sbom_jobs[syft-cyclonedx · syft-spdx · dvc-verify]
    end
    subgraph VULN [vuln-scan]
      vuln_jobs[grype-scan · trivy-scan]
    end
    subgraph MI [model-integrity]
      mi_jobs[model-digest/sign/verify · tamper-verify · modelfile-audit<br/>modelscan · modelaudit · clamav · hf-scan<br/>dataset: download→scan→redact→validate→sign<br/>great-expectations · ydata-profile]
      gate{{artifact-signing-gate}}
      mi_jobs --> gate
    end
    subgraph EVAL [ai-eval]
      eval_jobs[markllm-deps-audit · markllm-watermark-eval]
    end
    subgraph GUARD [guardrail]
      guard_jobs[evidently-drift<br/>data-drift-baseline-commit]
    end
    livescan[[separate live-scan pipeline<br/>ci/live-scans.gitlab-ci.yml<br/>promptfoo · garak · giskard · inspect-ai · pyrit<br/>guardrail-regression · model-drift-detection]]
    subgraph EVID [evidence]
      evid_jobs[evidence-summary]
    end
    subgraph AIBOM [ai-bom]
      assemble[ai-bom-assemble<br/>→ aibom.cyclonedx.json<br/>+ vulnerabilities[] · version · redaction · drift<br/>embeds model/dataset cosign sigs] --> validate[ai-bom-validate<br/>schema 1.6 + XML] --> aibom_sign[ai-bom-sign<br/>cosign keyless sign-blob]
      assemble --> content_gate[ai-bom-content-gate<br/>substance assertions · advisory]
      dtrack[dependency-track-upload<br/>continuous BOM policy gate]
    end
    subgraph DEPLOY [deploy-prep]
      imgsign[image-sign<br/>cosign keyless → workload image]
      publish[publish-signed-artifacts<br/>AI-BOM + dataset → package registry]
    end
    subgraph ATTEST [attest]
      signev[sign-evidence<br/>sha256 hash-manifest of the WHOLE run<br/>+ cosign keyless sign + self-verify]
    end
    subgraph VERIFY [deploy-time verification — outside CI, in-cluster]
      kyverno[[Kyverno ClusterPolicy<br/>verify image signature at admission]]
      presync[[Argo CD PreSync hook<br/>verify AI-BOM / dataset / model sigs]]
    end

    setup --> SAST & SBOM & MI
    SBOM --> VULN
    gate --> EVAL --> GUARD
    SAST & VULN & GUARD & MI --> EVID
    EVID --> AIBOM
    AIBOM --> DEPLOY
    DEPLOY --> ATTEST
    imgsign -. "signature verified by" .-> kyverno
    publish -. "artifacts fetched & verified by" .-> presync
```

### Stage 1 — Setup

| Job | What it does |
| --- | --- |
| `setup` | Installs Python dependencies, creates `evidence/`, `sbom/`, and `reports/` directories, stamps pipeline ID and commit SHA into `evidence/pipeline.env`, and records Git/CI version provenance (commit, `git describe`, tag, branch, dirty state) to `evidence/version-info.json` for traceability of every downstream artifact. |
| `model-manifest` | Validates `evals/model-baseline.json` (the approved model source of truth) with `scripts/build_model_baseline.py` and emits its `variables` map as a GitLab **dotenv report**, so `model-fixture-download`, `markllm-deps-audit`, and `markllm-watermark-eval` inherit `MODEL_FIXTURE_*` / `MARKLLM_*` from one reviewed file. Per GitLab variable precedence, the dotenv **overrides** the inline `variables:` defaults but is itself overridable by a Project/manual CI variable. Not `allow_failure`: a malformed or internally-inconsistent baseline fails fast at this cheap stage rather than after the expensive scans. |
| `vault-secrets` | Authenticates to Vault using a GitLab OIDC JWT and fetches the CI secrets (`MODEL_ENDPOINT`, `MODEL_SIGNING_IDENTITY`, `SIGSTORE_OIDC_ISSUER`, `HF_TOKEN`, `GEMINI_API_KEY`, `CI_REGISTRY_TOKEN`, `DT_API_URL`, `DT_API_KEY`) into a dotenv artifact injected as environment variables into all downstream jobs. Falls back to GitLab CI/CD variables if `VAULT_ADDR` is not set. Works against self-managed Vault or **HCP Vault Dedicated** — for HCP, set `VAULT_NAMESPACE` (`admin` or a child); see `deployment/vault/sample-secret-map.md`. |

### Stage 2 — SAST

| Job | What it does |
| --- | --- |
| `semgrep-sast` | Runs Semgrep `--config=auto` across the full codebase; outputs a GitLab SAST report. |
| `secret-detection` | Runs GitLab native Secret Detection against the current HEAD checkout (`GIT_DEPTH: 1`, `SECRET_DETECTION_LOG_OPTIONS: "--max-count=1"`). `allow_failure: false`, but the gate trips **only on `Critical`-severity findings** — High/Medium/Low are reported, not blocked. Historic secret cleanup is handled as a separate repository hygiene task so old training/app fixtures do not keep blocking current CI. |
| `gitleaks-scan` | Runs the configurable Gitleaks hard gate with the repo's `.gitleaks.toml`; this complements native Secret Detection and remains enabled. |
| `pip-audit` | Audits `requirements.txt` against OSV, PyPI advisory DB, and GitHub Advisory DB; outputs JSON and CycloneDX (use CycloneDX for CVSS score analysis). |
| `secure-software-scan` | The malware-equivalent of `lockfile-audit`: polls the ReversingLabs Spectra Assure **Community** catalogue across the **full accessed-library surface** — the `ci/requirements-ci*.txt` group locks plus the markllm group's `torch`/`transformers`/`markllm` pins (deduped purls, batched 5/request), not the 3-package root manifest — and gates on a recent **malware/tampering** verdict. Enforcement switch `RL_FAIL_ON` (blank = report-only; `malware,tampering` = gate). Skips cleanly when `RL_TOKEN` is unset. Backing script: `scripts/secure_software_scan.py`. |
| `pkg-integrity` | Checks for hash-pinning in `requirements.txt`; generates a hashed lockfile if absent; verifies no dependency conflicts in an isolated venv via `pip check`. |
| `conda-pkg-verify` | Advisory cross-resolution of `requirements.txt` in a `conda-forge`-only environment with strict channel priority, recording an environment manifest. Non-gating: the `conda install` and `pip check` are best-effort (`|| true`), and it reads `requirements.txt` directly (no `.resolve-reqs` fallback), so if that file is absent or conda-incompatible the manifest reflects a near-empty environment rather than the project's packages. |

### Stage 3 — SBOM

| Job | What it does |
| --- | --- |
| `syft-cyclonedx` | Generates a Software Bill of Materials in CycloneDX JSON and XML formats. `requirements.txt` is pinned to exact versions so Syft's Python cataloger emits components for them — Syft skips unpinned (`>=`) requirements, which would otherwise leave the SBOM with zero components and make the downstream Grype scan vacuous. Transitive dependencies are not pinned here, so the authoritative dependency-vulnerability gate remains `pip-audit` over the installed set. |
| `syft-spdx` | Generates a Software Bill of Materials in SPDX JSON and tag-value formats. |

### Stage 4 — Vulnerability Scan

| Job | What it does |
| --- | --- |
| `grype-scan` | Feeds the CycloneDX SBOM into Grype and scans for known CVEs; outputs a JSON findings report and a human-readable table. |
| `trivy-scan` | Runs Trivy against the filesystem and the container image (if a registry image exists for this commit); outputs a GitLab container scanning report. |

`grype-scan` skips cleanly with a small JSON report when its CycloneDX input is absent, for example when the SBOM producer could not run. This avoids a misleading secondary failure while preserving the SBOM producer as the root cause to investigate.

### Stage 5 — Model Integrity

This stage runs as a sequential chain that fans out into parallel checks before converging on a hard gate.

**Sequential chain:**

1. **`model-signing-install`** — Installs the `model-signing` and `sigstore` Python packages; downloads and installs the `cosign` Go binary from GitHub releases.
2. **`model-fixture-download`** — Downloads the checksum-pinned Qwen GGUF fixture into `models/` by default so the model-integrity jobs exercise real model bytes without committing weights to Git. Set `MODEL_FIXTURE_URL` to an empty value to skip the download.
3. **`model-digest`** — SHA-256 hashes every model file (`.pkl`, `.pt`, `.safetensors`, `.gguf`, `.bin`, `.h5`, `.onnx`) under `models/` and writes the digest list to `evidence/model-digests.txt`. Paths are recorded **repo-relative** (stripped of the absolute `/builds/…` build prefix), so the digests that flow downstream into the AI-BOM `bom-ref`s and the `sign-evidence` manifest stay portable (Fix #32 root — clears the absolute-path findings #40-F4 / #41-F5).
4. **`model-sign`** — Gets a short-lived `SIGSTORE_ID_TOKEN` OIDC JWT from GitLab's per-job `id_tokens:` block (audience `"sigstore"`) and passes it to `python -m model_signing sign sigstore --identity_token` for each **immediate subdirectory** of `models/` (`find -mindepth 1 -maxdepth 1 -type d`), producing a noninteractive `model.sig` Sigstore bundle inside each one. Note the scope: a model file placed directly in `models/` (not inside a subdirectory) is not signed, and an empty `models/` only logs a "skipped" message rather than failing. This token is not a GitLab project variable; if signing logs a browser OAuth URL, the token path is broken. Publishes the `.sig` files as artifacts.

**Parallel checks (run after `model-digest` or `model-sign`):**

| Job | What it does |
| --- | --- |
| `signature-verification` | Finds every `model.sig` produced by `model-sign` and calls `python -m model_signing verify sigstore` on each, validating the signature against `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER` from Vault or GitLab project CI/CD variables. Discover the exact values with the one-shot `sigstore-identity-discover` job before enabling real verification. A failed verification fails the job. |
| `tamper-verification` | Compares the current digest list against a stored baseline. On first run, seeds the baseline. On subsequent runs, any digest change prints a diff and fails. Baseline is stored in Vault (`secret/data/gaips/tamper-baseline/{project-slug}`) for permanent storage; falls back to a 90-day GitLab artifact (plus a best-effort job cache) when Vault is unavailable. |
| `modelscan` | Runs ModelScan across supported serialized formats (`.pt`, `.pth`, `.bin`, `.ckpt`, `.pb`, `.h5`, `.keras`, `.npy`, `.pkl`, `.pickle`, `.joblib`, `.dill`) to detect malicious serialization payloads (pickle exploits, unsafe operators). GGUF, safetensors, and ONNX are skipped because ModelScan does not inspect those formats. The job remains advisory for reporting, but `artifact-signing-gate` parses `modelscan.json` and blocks evaluation on any CRITICAL finding. |
| `modelaudit-scan` | Runs the standalone ModelAudit CLI (`modelaudit scan`) after `modelscan` across `models/`, including GGUF/GGML, safetensors, ONNX, manifests, archives, and other static model artifacts. The job uses a Python image, asserts Python 3.10+, and installs `modelaudit[all]>=0.2.47` so dependency backtracking cannot silently downgrade scanner coverage. It writes `modelaudit.json` plus a normalized `modelaudit-summary.json`; `artifact-signing-gate` blocks on operational scan failure or CRITICAL findings. |
| `modelfile-audit` | SHA-256 hashes any Ollama `Modelfile` found under `models/` or one level below the repo root, recording digests to `evidence/modelfile-digests.txt` (separate file to avoid a write race with `model-digest`). Skips cleanly when none are present. |
| `clamav-scan` | Runs ClamAV (`clamav/clamav` image, fresh signatures via `freshclam`) recursively across `models/`. Hard gate (`allow_failure: false`) — any infected file fails the pipeline. |
| `hf-artifact-scan` | Downloads each HuggingFace model listed in `HF_MODEL_IDS` and runs ClamAV + ModelScan against it. Skips cleanly if `HF_MODEL_IDS` is not set. |
| `dataset-download` → `dataset-scan` → `dataset-redact` → `eval-dataset-validate` → `dataset-sign` | The training/eval data runs a chain: **(0)** `dataset-download` — pulls `DATASET_FILENAME` from the Generic Package Registry and verifies `DATASET_EXPECTED_SHA256`; when unset, it stages the committed fixture named by `DATASET_FIXTURE_FILE` (default the Lakera `gandalf_ignore_instructions` test split) so the scan/sign/publish path is still exercised — and when `DATASET_EXPECTED_SHA256` is pinned it verifies the **staged fixture** against it too, so dataset-tamper detection works without a package registry (the check is on the raw, pre-redaction bytes, so Presidio's non-determinism can't false-trip it); **(1)** `dataset-scan` — ClamAV + structural (JSON/JSONL) scan (hard gate); **(2)** `dataset-redact` — strips secrets (gitleaks) and PII (Microsoft Presidio) from free-text fields **in place**, so confidential data never reaches signing/eval (report records counts only, never raw values); structural identifier/label keys (`id`/`case_id`/`category`, via `--skip-keys`) are left verbatim so PII false-positives can't corrupt record identifiers. Fail-closed (`allow_failure: false`); after redacting, the job **hard-fails** if findings exceed `REDACT_MAX_SECRETS` or `REDACT_MAX_PII`. Zero-tolerance for secrets holds only because the CI job sets `REDACT_MAX_SECRETS: "0"` explicitly — the script's own default is `-1` (disabled), so if that variable is unset (or the script is reused elsewhere) secrets pass silently; `REDACT_MAX_PII` defaults to `-1` (disabled). Note the secret path fails closed on tooling errors, but a Presidio import failure degrades **open** (PII left unredacted with only a warning); **(3)** `eval-dataset-validate` — validates every record against `evals/eval-dataset.schema.json` (fails the run on off-contract data, gating the AI-eval stage); **(4)** `dataset-sign` — `cosign sign-blob` over the **redacted, validated** bytes (`SIGSTORE_ID_TOKEN`, audience `"sigstore"`) → `dataset.sig` / `dataset.pem`, giving data the same Sigstore provenance as models. |

The dataset content-quality jobs `great-expectations-validate` (null rates, ranges, uniqueness — soft gate) and `ydata-profile` (advisory auto-profile, never gates) also run in this stage on the redacted data; they are not gate inputs.

To exercise the primary model-integrity path without committing a model to Git, set:

```text
MODEL_FIXTURE_URL=https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q2_k.gguf
MODEL_FIXTURE_PATH=qwen2.5-1.5b-instruct-gguf/qwen2.5-1.5b-instruct-q2_k.gguf
MODEL_FIXTURE_SHA256=5ede348e91ce1e7a330926ec5b202c27b864d065149dc463257fde1f98865b3a
```

These three values — plus the MarkLLM stack pins and `MARKLLM_MODEL_ID` — are defined canonically in `evals/model-baseline.json` and imported by the `model-manifest` job (above); the matching `variables:` entries in `.gitlab-ci.yml` are kept only as a fallback. `model-fixture-download` checksum-verifies the downloaded fixture against `MODEL_FIXTURE_SHA256` (now manifest-sourced) with `sha256sum --check --strict`, so the approved baseline governs model integrity for every subsequent run — roll the model forward by editing `model-baseline.json`.

**Gate:**

**`artifact-signing-gate`** — Waits for all nine integrity checks (`signature-verification`, `tamper-verification`, `modelscan`, `modelaudit-scan`, `modelfile-audit`, `clamav-scan`, `hf-artifact-scan`, `dataset-scan`, `eval-dataset-validate`). Confirms `tamper_check_passed=true`. Nothing in the AI evaluation stage runs until this gate passes.

### Stage 6 — AI Evaluation

After the gate passes, this stage now runs only the **MarkLLM** jobs — a static dependency audit and a local-inference watermark self-test. Both are advisory (`allow_failure: true`) and neither needs a model endpoint. (The endpoint-dependent evals — `promptfoo`, `garak`, `giskard`, `inspect-ai`, `pyrit` — were split into the separate [live-scan pipeline](ci/live-scans.md).)

| Job | What it does |
| --- | --- |
| `markllm-deps-audit` | Runs `pip-audit` against `torch`, `transformers`, and `markllm` (the heavy watermark stack) on `python:3.10-slim` before `markllm-watermark-eval`. Advisory (`allow_failure: true`). |
| `markllm-watermark-eval` | Runs a live MarkLLM generation/detection eval. Resolves the model id from `MARKLLM_MODEL_ID` — now set explicitly (`Qwen/Qwen2.5-1.5B-Instruct`) by the `model-manifest` dotenv from `evals/model-baseline.json` — or, when that is empty (manifest unavailable), derives it dynamically from `MODEL_FIXTURE_URL` (the HF GGUF repo is mapped to its transformers repo, since `AutoModelForCausalLM` can't load GGUF). Advisory (`allow_failure: true`): a missing model id, an unloadable model, or a generation/detection error records the failure in `markllm-results.json` without blocking the pipeline. Artifacts always include `markllm-results.json` when the helper starts. |

#### What the MarkLLM watermark eval actually does

This is the most-misunderstood job, so to be explicit:

**Watermarking marks *text*, not the model.** A watermark is not something baked into a model's weights that you could scan for — the model is unchanged. Watermarking is a technique applied *while the model writes*: it nudges the model's word choices using a secret key, invisibly, so the output still reads normally but is statistically skewed in a way only the key-holder can recognize. The point of doing this is **output provenance** — given only a piece of text later, you can prove it came from your model, because the fingerprint travels inside the words (a cryptographic signature can't do this; it lives on a file, not on copied-out text).

The job runs a **self-test** of that machinery against the model under test (by default the `MODEL_FIXTURE_URL` model — a stand-in, not a deployed model):

1. **Generate** — load the model's weights (real in-process inference via `transformers`, on CPU) and have it write a couple of short passages with watermarking turned on.
2. **Detect** — run the detector over that same text and confirm the watermark is recoverable.
3. **Record** — write the generate→detect result to `markllm-results.json`.

What it is **not**:
- It does **not** detect whether some model "came pre-watermarked" — that isn't a meaningful question (watermarks live in generated text, and detecting one requires its secret key/scheme). This job only detects the watermark it inserted itself.
- It does **not** sign or verify the model artifact — that is the `model-sign` / `signature-verification` / `tamper-verification` / `modelscan` / ClamAV jobs.
- It is **not** a runtime protection and does **not** apply to closed API models (KGW-style watermarking needs access to the model's logits, so it only works on a self-hosted open-weight model whose weights you load).

So in this pipeline it is a **demonstrative capability check + evidence artifact**: proof that output-provenance watermarking round-trips on the model you point it at, should you choose to use it.

### Stage 7 — Guardrail / Drift

The `guardrail-regression` job moved to the separate [live-scan pipeline](ci/live-scans.md) (it depends on the live evals). This stage now carries the drift jobs.

| Job | What it does |
| --- | --- |
| `model-drift-detection` | **Relocated to the live-scans pipeline (Fix #24a).** Extracts normalised eval metrics from `reports/` and compares them to the committed baseline `evals/eval-baseline.json`; any metric moving beyond `DRIFT_THRESHOLD` (default ±0.10) flags drift. Its six inputs (inspect-ai/garak/pyrit/giskard/guardrail-regression/promptfoo) are produced only by the live-scan jobs, so it lives there alongside them — in the static pipeline it had no inputs and was dead-by-construction (the former `drift-gate` that consumed it was removed). See `ci/live-scans.gitlab-ci.yml`. |
| `data-drift-baseline-commit` | **Automates data-drift activation (Fix #24b).** On the default branch, when `evidently-drift` just seeded a reference and none exists in the repo, **sanitizes** the seed (drops null/non-finite values — never a raw `cp`) and commits it `dataset-reference.seed.jsonl` → `evals/dataset-reference.jsonl`, pushing with `[skip ci]` + `-o ci.skip` (no pipeline loop). Requires `GITLAB_PUSH_TOKEN` (PAT, scope `write_repository`); if unset, falls back to the manual artifact. Never overwrites an existing reference. `allow_failure: true`. (Replaces the former `model-baseline-commit`, which seeded the wrong — eval-metric — baseline; that duty moved to live-scans with `model-drift-detection`.) |
| `evidently-drift` | Data/feature drift on the **input** side. Evidently's `DataDriftPreset` (PSI) compares a committed reference snapshot (`evals/dataset-reference.jsonl`) to the current dataset; TextEvals adds LLM-relevant text descriptors over prompt columns. Seeds the reference on first run; `data-drift-baseline-commit` then bootstraps it on the default branch (Fix #24b), so drift detection activates without a manual commit. Soft gate (`allow_failure: true`); skips cleanly when no dataset is present. |

### Stage 8 — Evidence

| Job | What it does |
| --- | --- |
| `evidence-summary` | Collects all reports from every prior job and renders a human-readable Markdown evidence summary to `evidence/evidence-summary.md`. **Reads each artifact's VERDICT, not just its presence** (Fix #33 — 3-state pass/fail/inert per artifact: semgrep error-severity, markllm status, modelaudit critical, GX success, evidently drift (polarity-aware), DT violations), surfacing them in the table's Verdict/Detail columns. A *missing* required artifact still hard-fails the gate; a *present-but-failing* required verdict warns by default and blocks under `--enforce-verdicts` (teeth-last, per Fix #0/#23). Also bundles the approved `model-baseline.json` (and a freshly-seeded `dataset-reference.seed.jsonl`, when present) into the final-report artifacts, so the run records the exact model identity and variable manifest it was pinned to. Retained for 90 days. |

### Stage 9 — AI BOM

The final stage rolls every prior element into **one CycloneDX 1.6 AI BOM** — the single attestable inventory an auditor reads to see *all* elements of the system: software libraries, ML models, datasets, and evaluation evidence together.

| Job | What it does |
| --- | --- |
| `ai-bom-assemble` | Runs `scripts/build_ai_bom.py`, merging the Syft software SBOM (`library` components), models (`machine-learning-model` components with a `modelCard`, digest, ModelScan/ModelAudit/ClamAV/Hugging Face verdicts, and the embedded `model.sig`), datasets (`data` components with digest, scan verdict, embedded `dataset.sig`, and — from `evals/dataset-baseline.json` via `--dataset-baseline` — a CycloneDX `licenses` entry plus `gaips:dataset.source/.revision/.split/.citation` provenance, closing the gap where datasets carried only a bare digest while models carried full HF provenance), and AI-eval results (root-component properties + external references) into `sbom/aibom.cyclonedx.json`. **Emits a CycloneDX `vulnerabilities[]` array** (Fix #29) built from the run's audit reports — pip-audit (`markllm-deps-audit` + the per-job `pip-audit-*`), grype, and trivy — deduped, each with `affects[].ref` pointing at the offending component's `bom-ref` (so Dependency-Track ingests structured vulns, not just property counts). The **software count is split** into `bom.counts.software.pipeline` vs `…software.markllm` so the two disjoint dependency universes are no longer fused (Fix #30a), and the previously-hollow **`modelCard` is populated** from `markllm-results.json` (`quantitativeAnalysis.performanceMetrics` + `modelParameters`, Fix #30b). Each model component now carries **`gaips:model.verified`** alongside `gaips:signed` (Fix #32b), distinguishing "a signature exists" from "we checked it" — sourced from `signature-verification` #19 (honestly `false`/deferred until #19 runs on a protected ref). The per-component **cosign** signatures for models and datasets are embedded here as base64 `data:`-URI external references; the BOM's own signature is applied downstream by `ai-bom-sign`. It also folds in **Git version provenance** (from `version-info.json`), the **dataset redaction** verdict (redacted SHA + secret/PII counts, so the `data` component hash reflects the redacted bytes), and the **model-drift** verdict. Each input is optional, so the BOM degrades gracefully as stages light up — with the live evals split out, their results are recorded as `eval.*.present: false` here unless the live-scan pipeline's reports are fed into `reports/`. Retained for 90 days. |
| `ai-bom-validate` | Validates the BOM against the CycloneDX 1.6 JSON schema with `cyclonedx validate --fail-on-errors`, then converts it to `sbom/aibom.cyclonedx.xml` — the form the next job signs. Hard gate (no `allow_failure`): a schema-invalid BOM fails the pipeline rather than shipping a malformed attestation. **This is a FORM check only** — a well-formed BOM can still be substantively hollow, so the companion `ai-bom-content-gate` (below) asserts content. |
| `ai-bom-content-gate` | Runs `scripts/assert_ai_bom_content.py` (Fix #31) — the SUBSTANCE counterpart to `ai-bom-validate`'s schema check, in a `python:3.11-slim` image (the cyclonedx-cli image has no Python). Asserts the BOM **says something**: if the run's audit reports found vulns but the BOM's `vulnerabilities[]` is empty it flags a gap (enforces #29), and every `machine-learning-model` component must be `gaips:signed=true` (+ `gaips:model.verified=true`, WARN-only while #19 defers). **Advisory** (`allow_failure: true`) per the teeth-last posture; pass `--enforce` to make the coverage/signing assertions block once the pipeline is otherwise green. |
| `ai-bom-sign` | Applies the BOM's **own** signature with **cosign keyless** (`cosign sign-blob` over `aibom.cyclonedx.xml`, via the GitLab `SIGSTORE_ID_TOKEN`), emitting a detached `aibom.cyclonedx.sig` + Fulcio `aibom.cyclonedx.pem` recorded in Rekor — the same identity-bound mechanism as `model-sign`/`dataset-sign`/`sign-evidence` (Fix #25, replacing the old ephemeral identity-less RSA enveloped signature). **Hardened to a gate** (`allow_failure: false`): an unsigned AI-BOM is never delivered green; skips only when there is genuinely no BOM. The deploy-time PreSync hook verifies it with `cosign verify-blob` against the CI signer identity — no public-key Secret. Models and datasets keep their own cosign signatures (embedded by `ai-bom-assemble`). |
| `dependency-track-upload` | Ingests the Syft SBOM and the AI BOM (nested under it via `parentName`/`parentVersion`) into **Dependency-Track** for *continuous* analysis — re-scanning against new CVEs and policy conditions over time, and ingesting the structured `vulnerabilities[]` that `ai-bom-assemble` now emits (Fix #29). Hard policy gate **when configured**: fails on any non-suppressed violation whose `violationState` is in `DT_FAIL_ON` (default `FAIL`). Skips cleanly when `DT_API_URL`/`DT_API_KEY` are unset — so in a default run with no Dependency-Track credentials, nothing is uploaded and the gate is inert (the "also pushed to Dependency-Track" behaviour applies only once DT is wired). **To wire it** (Fix #34): a turnkey instance + step-by-step runbook live in [`deployment/dependency-track/`](deployment/dependency-track/) (docker-compose + API-key permissions + the CI vars + a gating policy). This is what gives #29 teeth. |

The pipeline default is `interruptible: true` so superseded jobs can be canceled by GitLab when a newer pipeline replaces them. Enable GitLab's project-level auto-cancel redundant pipelines setting to turn that into runner-minute savings during CI debugging.

### Stage 10 — Deploy Prep

This stage produces the two artifacts the **deploy-time verifiers** consume, closing the sign→verify loop. Both skip cleanly when their inputs aren't configured, so the pipeline runs unchanged until the image and an artifact store are wired in.

| Job | What it does |
| --- | --- |
| `image-sign` | Applies a **Cosign keyless** signature to the already-built workload image (`IMAGE_REF`), using the GitLab `SIGSTORE_ID_TOKEN` (audience `"sigstore"`). The resulting Fulcio certificate's identity matches the gitlab branch of the **Kyverno** `ClusterPolicy` regex, so admission control admits a Pod only when its image carries this signature. Without this job, flipping that Kyverno policy to `Enforce` would block every deploy. Skips when `IMAGE_REF` is unset; `allow_failure: true` (Kyverno is the deploy-time gate). |
| `publish-signed-artifacts` | Uploads the cosign-signed **AI-BOM** trio (`aibom.cyclonedx.xml` + detached `.sig` + Fulcio `.pem`), the cosign-signed **dataset** (normalised to `dataset.dat`/`.sig`/`.pem`), and — when present — the **model bundle** to the GitLab **Generic Package Registry** at `${EVIDENCE_PACKAGE_NAME}/${EVIDENCE_PACKAGE_VERSION}`. This is exactly the path the **Argo CD PreSync hook** fetches via `ARTIFACT_BASE_URL` to verify signatures *before* a rollout (AI-BOM and dataset via `cosign verify-blob`, model via `model_signing verify`). Uses `CI_JOB_TOKEN` — no extra secret. Emits `artifacts-manifest.txt` recording what was published. |

> **Deploy-time verification (in-cluster, outside CI).** The loop is closed by two manifests under `deployment/`: `kubernetes/policies/kyverno-verify-image-signatures.yaml` (verifies the **image** signature at admission — `Audit` by default; flip to `Enforce` once `image-sign` has run for the deployed digest) and `argocd/verify-signatures-presync-hook.yaml` (a PreSync Job that verifies the **AI-BOM / dataset / model** signatures and aborts the sync on failure). See `deployment/vault/sample-secret-map.md` for the (secretless) wiring.

#### The pipeline's signing jobs (what signs what, and who verifies it)

The pipeline signs **four distinct artifacts** — they are easy to confuse, so the table below is the canonical map. Note `image-sign` signs the deployable *container image*, **not** the model; the model is a separate artifact signed by `model-sign`.

| Job | Signs | Mechanism | Verified at deploy by |
| --- | --- | --- | --- |
| `model-sign` | the **model** (GGUF weights blob) | cosign keyless (Fulcio + Rekor) | Argo CD PreSync hook (`model_signing verify`) |
| `dataset-sign` | the **redacted dataset** | cosign keyless (Fulcio + Rekor) | Argo CD PreSync hook (`cosign verify-blob`) |
| `ai-bom-sign` | the **AI-BOM document** | cosign keyless (Fulcio + Rekor) | Argo CD PreSync hook (`cosign verify-blob`) |
| `image-sign` | the **workload container image** | cosign keyless (Fulcio + Rekor) | **Kyverno** ClusterPolicy (admission control) |

*(A fifth, `sign-evidence`, cosign-keyless-signs the whole-run evidence manifest for 90-day audit retention — it is not a deploy gate.)*

### Stage 11 — Attest

Terminal stage — runs dead-last so it can seal the **entire** run (including the AI-BOM and deploy-prep outputs) in one signature.

| Job | What it does |
| --- | --- |
| `sign-evidence` | Builds a comprehensive run-evidence manifest (`sign-evidence.json`): rich pipeline metadata (id/url/source/commit/ref/protected/triggerer/runner), the approved-vs-recorded model identity with a `digest_match` check **plus a `model.verified` + `verified_reason` field** sourced from `signature-verification` #19 (Fix #32a — the manifest now records whether the recorded digest was actually *verified* against a signature, not merely notarized; honestly `false`/deferred until #19 runs on a protected ref), and a **sha256 hash-manifest of every report, SBOM, and evidence artifact across the whole run** (it `needs:` all artifact-producing jobs in stages 2–10, now including `signature-verification`). Recorded model paths are repo-relative (Fix #40-F4). Signs it with `cosign sign-blob` using the GitLab `SIGSTORE_ID_TOKEN` and **self-verifies** the signature, producing a `.sig` + `.pem` — one transparency-logged signature that binds the integrity of the entire run's evidence set. (Renamed from `model-signing-evidence`, which ran mid-pipeline in the `evidence` stage and over only the model digest; the model artifact itself is signed by `model-sign`.) |

> **Design note — why `sign-evidence` is terminal, and what that trades off.** Placing it last is what lets its hash-manifest cover the **entire** run, including the signed AI-BOM and the `deploy-prep` outputs. The consequence is that `publish-signed-artifacts` runs *before* it, so the run-evidence seal is **not** distributed to the deploy gate this run — it is a retained 90-day audit artifact (the deploy-facing attestation remains the signed **AI-BOM**, which `publish-signed-artifacts` does push). If you'd instead want the seal itself published to the deploy gate, that's the alternative wiring — but it'd force `sign-evidence` **before** publish, which reintroduces the blind spot (it could no longer capture `deploy-prep`). You can't have both in one job; getting both would require a small two-part split (seal-and-publish the core artifacts mid-pipeline, then a terminal full-run hash).

## Evidence & Report Artifacts (per stage / job)

The authoritative map of **what each job emits** — every GitLab `artifacts:` path and its filetype, with retention (`expire_in`). Paths are shown relative to `${CI_PROJECT_DIR}`; the four output roots are `reports/` (machine-readable scan output), `sbom/` (bills of materials), `evidence/` (signed/retained provenance), and `models/` (fixture bytes + signatures). A trailing `/` denotes a directory artifact. "GitLab report" marks an `artifacts:reports:` entry that also feeds a native GitLab feature (Security Dashboard, MR widget, dotenv inheritance). Jobs with no row under a stage (e.g. `model-signing-install`, `artifact-signing-gate`, `ai-bom-content-gate`, `image-sign`, `data-drift-baseline-commit`) are pure gates/installers and publish no artifacts.

### Stage 1 — Setup

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `setup` | `evidence/pipeline.env` (.env), `evidence/version-info.json` (.json) | 1 day |
| `model-manifest` | `model-baseline.env` (.env — GitLab **dotenv** report) | 90 days |
| `vault-secrets` | `.vault-env` (.env — GitLab **dotenv** report) | 30 min |

### Stage 2 — SAST

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `semgrep-sast` | `reports/semgrep.json` (.json — GitLab **sast** report) | 7 days |
| `secret-detection` | `gl-secret-detection-report.json` (.json — GitLab **secret_detection** report), `reports/secret-detection.json` (.json) | 7 days |
| `gitleaks-scan` | `reports/gitleaks.json` (.json), `reports/gitleaks.log` (.log) | 7 days |
| `pip-audit` | `reports/pip-audit.json` (.json), `reports/pip-audit-cyclonedx.json` (.json — CycloneDX) | 7 days |
| `secure-software-scan` | `reports/secure-software.json` (.json — per-dependency reputation/malware verdicts + gate result) | 30 days |
| `lockfile-audit` | `reports/requirements-ci.txt` (.txt — hash-pinned lock), `reports/lockfile-audit.json` (.json), `reports/lockfile-audit-cyclonedx.json` (.json — CycloneDX) | 7 days |
| `markllm-deps-audit` † | `reports/markllm-deps-audit.json` (.json) | 7 days |
| `pkg-integrity` | `reports/pkg-integrity.env` (.env), `reports/pkg-integrity-manifest.json` (.json), `requirements.hashed.txt` (.txt) | 7 days |
| `conda-pkg-verify` | `reports/conda/` (dir — env manifest) | 7 days |

† `markllm-deps-audit` runs in the **sast** stage (it must finish before the AI-eval `markllm-watermark-eval`), even though the Stage 6 walkthrough discusses it alongside the other MarkLLM job.

### Stage 3 — SBOM

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `syft-cyclonedx` | `sbom/sbom.cyclonedx.json` (.json), `sbom/sbom.cyclonedx.xml` (.xml) | 30 days |
| `syft-spdx` | `sbom/sbom.spdx.json` (.json), `sbom/sbom.spdx` (tag-value) | 30 days |
| `dvc-verify` | `reports/dvc-status.json` (.json) | 7 days |

### Stage 4 — Vulnerability Scan

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `grype-scan` | `reports/grype.json` (.json) | 7 days |
| `trivy-scan` | `reports/trivy-fs.json` (.json), `reports/trivy-image.json` (.json — GitLab **container_scanning** report) | 7 days |

### Stage 5 — Model Integrity

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `model-fixture-download` | `models/` (dir — fixture bytes), `evidence/model-fixture-download.json` (.json) | 1 day |
| `model-digest` | `evidence/model-digests.txt` (.txt — SHA-256 list) | 30 days |
| `model-sign` | `models/**/model.sig` (.sig — Sigstore bundle per model dir) | 30 days |
| `signature-verification` | `evidence/signature-verification.txt` (.txt), `evidence/signature-verification.jsonl` (.jsonl) | 90 days |
| `tamper-verification` | `evidence/integrity.env` (.env), `evidence/model-digests-baseline.txt` (.txt) | 90 days |
| `modelscan` | `reports/modelscan.json` (.json), `reports/modelscan.log` (.log) | 7 days |
| `modelaudit-scan` | `reports/modelaudit.json` (.json), `reports/modelaudit-summary.json` (.json), `reports/modelaudit.log` (.log) | 7 days |
| `modelfile-audit` | `reports/modelfile-audit.json` (.json), `evidence/modelfile-digests.txt` (.txt) | 7 days |
| `clamav-scan` | `reports/clamav-model.json` (.json), `reports/clamav-model.txt` (.txt), `reports/clamav-model.log` (.log) | 7 days |
| `hf-artifact-scan` | `reports/hf-scan/` (dir — per-model ClamAV + ModelScan) | 7 days |
| `dataset-download` | `evidence/dataset-input/` (dir), `evidence/dataset-digest.txt` (.txt), `reports/dataset-download.json` (.json) | 1 day |
| `dataset-scan` | `reports/dataset-scan.json` (.json), `reports/dataset-clamav.json` (.json), `reports/dataset-clamav.log` (.log), `reports/clamav-dataset.txt` (.txt) | 7 days |
| `dataset-redact` | `reports/dataset-redact.json` (.json — counts only, never raw values), `evidence/dataset-input/` (dir — redacted in place) | 7 days |
| `eval-dataset-validate` | `reports/eval-dataset-validation.json` (.json) | 7 days |
| `dataset-sign` | `evidence/dataset-input/` (dir — incl. `dataset.sig`/`dataset.pem`) | 90 days |
| `great-expectations-validate` | `reports/great-expectations.json` (.json), `evidence/great-expectations/` (dir) | 30 days |
| `ydata-profile` | `reports/ydata-profile.json` (.json), `evidence/ydata-profile/` (dir) | 30 days |
| `sigstore-identity-discover` | `.sigstore-identity-discover/probe/model.sig` (.sig — one-shot identity probe) | 1 hour |

### Stage 6 — AI Evaluation

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `markllm-watermark-eval` | `reports/markllm-results.json` (.json — generate→detect result + metrics) | 7 days |

### Stage 7 — Guardrail / Drift

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `evidently-drift` | `reports/evidently-drift.json` (.json), `reports/dataset-reference.seed.jsonl` (.jsonl — first-run seed), `evidence/evidently/` (dir — HTML/JSON report) | 30 days |

### Stage 8 — Evidence

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `evidence-summary` | `evidence/evidence-summary.md` (.md — human-readable roll-up), `evidence/model-baseline.json` (.json — pinned identity), `evidence/dataset-reference.seed.jsonl` (.jsonl — when seeded) | 90 days |

### Stage 9 — AI BOM

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `ai-bom-assemble` | `sbom/aibom.cyclonedx.json` (.json — CycloneDX 1.6 AI BOM) | 90 days |
| `ai-bom-validate` | `sbom/aibom.cyclonedx.xml` (.xml — schema-validated, the form `ai-bom-sign` signs) | 90 days |
| `ai-bom-sign` | `sbom/aibom.cyclonedx.xml` (.xml), `sbom/aibom.cyclonedx.sig` (.sig — detached cosign), `sbom/aibom.cyclonedx.pem` (.pem — Fulcio cert) | 90 days |
| `dependency-track-upload` | `reports/dependency-track.json` (.json — findings/violations + dashboard URLs for the SBOM **and** AI-BOM child) | 30 days |

### Stage 10 — Deploy Prep

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `publish-signed-artifacts` | `evidence/publish/artifacts-manifest.txt` (.txt — what was published), `evidence/publish/publish-result.json` (.json) | 90 days |
| `metrics-normalize` | `reports/operational-metrics.json` (.json) | 90 days |
| `pages` | `public/` (dir — GitLab Pages site) | 90 days |

### Stage 11 — Attest

| Job | Artifacts (file — type) | Retention |
| --- | --- | --- |
| `sign-evidence` | `evidence/sign-evidence.json` (.json — whole-run hash-manifest), `evidence/sign-evidence.sig` (.sig — detached cosign), `evidence/sign-evidence.pem` (.pem — Fulcio cert) | 90 days |

## Per-Job Reference — Purpose & Step-by-Step

> A plain-English walkthrough of **every job in every stage**: what it is for, what it actually does step by step, and the output file(s) it leaves behind. This complements the at-a-glance tables in the *Pipeline Walkthrough* and *Evidence & Report Artifacts* sections above — read those for the quick map, this for the detail. Each heading shows the gate posture: **hard gate** (`allow_failure: false` — can fail the pipeline) vs **advisory** (`allow_failure: true` — reports without blocking). Nearly every job also skips when the commit message carries the `[sigstore-discovery]` marker (the one-shot identity probe run).

### Stage 1 — Setup

#### `setup` — stage: `setup` · advisory (allow_failure) · output: `evidence/version-info.json`

**What this job is for**
This is the first job in the pipeline and lays the groundwork every later stage assumes. It creates the shared evidence/SBOM/reports directories, installs the project's Python requirements if any exist, and records the exact Git revision the run is built from so all downstream artifacts (the AI BOM, the signed evidence bundle assembled in the `attest` stage) can be traced to a precise source state. It runs alongside `model-manifest` and `vault-secrets` in the setup stage and is the named upstream dependency of the SAST jobs.

**Step by step, in plain English**
1. Installs `git` and CA certificates, since the slim Python image ships neither and provenance capture needs Git.
2. Resolves a requirements file via the shared `.resolve-reqs` logic (root `requirements.txt`, else the CI lockfile, else the `.in` source), and `pip install`s it if found, otherwise skips cleanly.
3. Creates the `sbom/`, `evidence/`, and `reports/` directories used by the whole pipeline.
4. Writes a one-line `evidence/pipeline.env` recording the pipeline ID and short commit SHA.
5. Picks a timestamp from `CI_PIPELINE_CREATED_AT` (or the current UTC time as fallback).
6. Runs `scripts/write_version_info.py`, which shells out to Git for the commit, short commit, branch, tag, `git describe`, and a working-tree "dirty" flag, filling any gaps from `CI_*` environment variables, and writes it all to `evidence/version-info.json`.
7. A missing Git reports `dirty` as "unknown" rather than falsely "clean".

**Output file(s):** `evidence/version-info.json` — JSON provenance record (commit, branch, tag, describe, dirty flag, CI context); also `evidence/pipeline.env` — one-line pipeline-ID/commit marker.

#### `model-manifest` — stage: `setup` · hard gate · output: GitLab dotenv report (`model-baseline.env`)

**What this job is for**
This job turns the reviewed `evals/model-baseline.json` into the single source of truth for the approved model's identity and the CI variables it implies. By emitting those variables as a GitLab dotenv report, downstream jobs like `model-fixture-download` and the MarkLLM jobs inherit `MODEL_FIXTURE_*` and `MARKLLM_*` from one validated place instead of the inline `variables:` defaults. It is a hard gate on purpose: a malformed or internally inconsistent baseline fails fast and cheaply here rather than after the expensive scan and model-integrity stages.

**Step by step, in plain English**
1. Skips the Python venv bootstrap (the backing script is stdlib-only) and runs with no dependencies on other jobs.
2. Runs `scripts/build_model_baseline.py` against `evals/model-baseline.json`, asking it to emit a dotenv file named `model-baseline.env`.
3. The script loads and parses the baseline JSON, failing if it is missing, not valid JSON, or not a JSON object.
4. It validates that `model.path` and `model.sha256` are present and that the sha256 is a real 64-hex digest.
5. It validates the `variables` map: each key must be a valid env-var name and each value a newline-free string.
6. It cross-checks internal consistency, failing if `MODEL_FIXTURE_SHA256` or `MODEL_FIXTURE_PATH` disagree with the model's own `sha256`/`path` so the two can't silently drift.
7. On success it writes each variable as a `KEY=value` line to `model-baseline.env`; the job then `cat`s the file for the log.

**Output file(s):** GitLab dotenv report `model-baseline.env` — validated `MODEL_FIXTURE_*` / `MARKLLM_*` (and related) variables injected into later jobs; dotenv values override inline defaults but remain overridable by a Project/manual CI variable.

#### `vault-secrets` — stage: `setup` · advisory (allow_failure) · output: dotenv report (`.vault-env`)

**What this job is for**
This job centrally brokers secrets from HashiCorp Vault into the pipeline as CI variables (model endpoint, signing identity, Sigstore issuer, HF token, registry token, Dependency-Track creds, etc.) so later jobs don't each need their own Vault wiring. It runs in setup alongside `setup` and `model-manifest` and is a named dependency of jobs such as `trivy-scan`. It is advisory and degrades gracefully: if `VAULT_ADDR` is unset it skips cleanly and the pipeline falls back to GitLab CI/CD variables.

**Step by step, in plain English**
1. Requests a per-job OIDC JWT (`VAULT_ID_TOKEN`) via `id_tokens`, with `CI_JOB_JWT_V2` as the legacy fallback.
2. Touches an empty `.vault-env` so the dotenv artifact always exists, even when Vault is unreachable.
3. If `VAULT_ADDR` is empty, prints a skip notice and exits 0 (clean skip; CI variables are used instead).
4. Otherwise installs `hvac` and runs an inline Python script that builds an `hvac` client using `VAULT_ADDR` and optional `VAULT_NAMESPACE` (required on HCP/Enterprise Vault).
5. Authenticates to Vault via JWT login against the `gaips-ci` role, erroring if no JWT is available.
6. Reads a fixed set of KV v2 secret paths under the `secret` mount, mapping each to a CI variable name; per-secret failures are logged as warnings rather than failing the job.
7. Writes the fetched `VAR=value` lines into `.vault-env`, published as a dotenv report and injected into later jobs.

**Output file(s):** dotenv report `.vault-env` — fetched secrets as CI variables injected downstream (short ~30-minute expiry limits exposure; empty-but-present when Vault is skipped/unreachable).

### Stage 2 — SAST

#### `semgrep-sast` — stage: `sast` · advisory (allow_failure) · output: `reports/semgrep.json` (+ GitLab SAST report)

**What this job is for**
This job runs static application security testing over the whole repository to catch insecure code patterns, feeding findings into the GitLab Security Dashboard and MR widget. It is one of several SAST-stage scanners (alongside `secret-detection`, `gitleaks-scan`, `pip-audit`, and the dependency/integrity jobs) and depends on `setup`. It runs inside the pinned `IMAGE_SEMGREP` image, which already ships Semgrep, so there is no unpinned `pip install`.

**Step by step, in plain English**
1. Uses the pinned Semgrep container and skips the Python venv bootstrap (the image is self-contained).
2. Creates the `reports/` directory.
3. Runs `semgrep scan --config=auto` — a tokenless, rules-based scan (not the managed `semgrep ci` workflow that needs `SEMGREP_APP_TOKEN`).
4. Outputs results as JSON to `reports/semgrep.json`, scanning the current directory.
5. Publishes that file both as a GitLab `sast` report and as a plain artifact.

**Output file(s):** `reports/semgrep.json` — Semgrep findings in JSON, registered as a GitLab SAST report.

#### `secret-detection` — stage: `sast` · hard gate (trips only on Critical) · output: `gl-secret-detection-report.json`, `reports/secret-detection.json`

**What this job is for**
This is GitLab's native secret-detection analyzer, scanning the commit for leaked credentials and surfacing them in the Security Dashboard and MR widget. It complements `gitleaks-scan` (configurable rules, explicit history depth) and runs in the SAST stage after `setup`. It is a hard gate, but deliberately narrow: it fails the pipeline only when a Critical-severity secret is found.

**Step by step, in plain English**
1. Runs in the pinned GitLab secrets analyzer image with no Python bootstrap, scanning only HEAD (`GIT_DEPTH: 1`, historic scan off).
2. Creates `reports/` and invokes the analyzer via `/analyzer run`.
3. Copies the produced `gl-secret-detection-report.json` into `reports/secret-detection.json` so the evidence-summary stage can collect it.
4. If no report was produced, prints a notice and exits 0.
5. Using POSIX shell only (no Python/jq in the image), counts total findings and Critical findings, guarding the `grep -c` exit-1-on-zero pitfall so counts default to 0.
6. Prints the finding and critical counts.
7. If the Critical count is greater than zero, exits 1 (fails the pipeline); otherwise passes.

**Output file(s):** `gl-secret-detection-report.json` — GitLab-native secret-detection report (registered as a `secret_detection` report); copy at `reports/secret-detection.json` for the evidence summary.

#### `gitleaks-scan` — stage: `sast` · hard gate · output: `reports/gitleaks.json`, `reports/gitleaks.log`

**What this job is for**
This job runs Gitleaks as a second, configurable secret scanner that complements the GitLab-native `secret-detection` analyzer with project-specific rules and explicit git-history depth control. It runs in the SAST stage after `setup`, inside the pinned `IMAGE_GITLEAKS` GHCR image. It is a hard gate: any detected secret fails the pipeline.

**Step by step, in plain English**
1. Runs in the pinned Gitleaks image (entrypoint cleared) with no Python bootstrap and creates `reports/`.
2. Runs `gitleaks detect` over the project directory using the repo's `.gitleaks.toml`, writing JSON to `reports/gitleaks.json`.
3. Uses `--redact` so matched secret values are masked in the report and log, teeing console output to `reports/gitleaks.log`.
4. Captures Gitleaks' real exit code from `PIPESTATUS` (the `tee` would otherwise mask it).
5. Runs an inline Python snippet to count entries in the JSON report, defaulting to 0 on parse error.
6. Prints the count of potential secrets detected.
7. If the captured exit code is non-zero, exits 1. Artifacts are saved `when: always` so reports survive a failing run.

**Output file(s):** `reports/gitleaks.json` — Gitleaks findings (values redacted); `reports/gitleaks.log` — redacted run log.

#### `pip-audit` — stage: `sast` · advisory (allow_failure) · output: `reports/pip-audit.json`, `reports/pip-audit-cyclonedx.json`

**What this job is for**
This job audits the project's declared Python dependencies against known-vulnerability databases (OSV, PyPI Advisory DB, GitHub Advisory DB). It is the manifest-level dependency audit, scoped to the resolved root requirements; the broader hash-pinned, per-group coverage of the full pipeline stack lives in `lockfile-audit`, and each job's actually-installed packages are covered by the `.audit-env` after_script. It runs after `setup` and is advisory.

**Step by step, in plain English**
1. Installs `pip-audit` and creates `reports/`.
2. Resolves a requirements file via the shared `.resolve-reqs` logic.
3. If no requirements file is found, writes an empty `{"dependencies":[]}` report and exits cleanly.
4. Otherwise installs the requirements, then runs `pip-audit --requirement` producing JSON at `reports/pip-audit.json` (capturing but not failing on its exit code).
5. Runs `pip-audit` again in CycloneDX-JSON format to `reports/pip-audit-cyclonedx.json` (which carries CVSS data).
6. Runs an inline Python snippet to total the vulnerabilities and affected packages and print the summary.

**Output file(s):** `reports/pip-audit.json` — findings in pip-audit's native `{"dependencies":[...]}` shape; `reports/pip-audit-cyclonedx.json` — same audit in CycloneDX JSON (for CVSS analysis).

#### `lockfile-audit` — stage: `sast` · advisory (allow_failure) · output: `reports/lockfile-audit.json`

**What this job is for**
This is the hash-pinned dependency audit (Fix #0-B) that covers the full static pipeline stack the manifest-level `pip-audit` never reaches (model-signing, sigstore, modelscan, huggingface_hub, presidio, evidently, ydata-profiling, great-expectations, the MarkLLM stack). Because those packages don't reliably co-resolve as one lockfile, the job treats EACH `ci/requirements-ci*.in` as an independent GROUP, compiles and audits each on its own, and merges the results. Groups that can't resolve stay covered at runtime by the per-job `.audit-env` after_script. It is advisory for now; the core group's lock can later be committed and the gate hardened.

**Step by step, in plain English**
1. Installs `pip-tools` and `pip-audit`, creates `reports/`, and truncates `reports/lockfile-unresolved-groups.txt`.
2. Loops over every `ci/requirements-ci*.in` file, running `pip-compile --generate-hashes --allow-unsafe` to produce a fully hash-pinned per-group lock at `reports/<stem>.txt`.
3. If a group fails to compile, it logs a loud WARNING (not a failure), removes any partial lock, and records the group in `lockfile-unresolved-groups.txt`.
4. If no `.in` files exist at all, prints a notice and exits cleanly.
5. Audits each successfully compiled lock with `pip-audit` in both JSON and CycloneDX-JSON formats (reading the manifest, no install).
6. Merges all per-group JSON audits into one `reports/lockfile-audit.json` in pip-audit's native `{"dependencies":[...]}` shape (the shape `build_ai_bom.py` reads), deduplicating by `(name, version)`.
7. Prints totals and notes which groups were unresolvable.

**Output file(s):** `reports/lockfile-audit.json` — merged, deduplicated audit across all resolvable groups; plus per-group `reports/requirements-ci*.txt` locks, `reports/requirements-ci*-audit*.json` per-group audits, and `reports/lockfile-unresolved-groups.txt`.

#### `secure-software-scan` — stage: `sast` · gate driven by `RL_FAIL_ON` (report-only by default) · output: `reports/secure-software.json`

**What this job is for**
The malware-equivalent of `lockfile-audit`: where `pip-audit`/`lockfile-audit` find *known CVEs*, this screens for *malicious packages* — typosquats, account-takeover injections, and removed/tampered releases — by polling the ReversingLabs Spectra Assure **Community** catalogue. It covers the **full accessed-library surface** — the committed group locks `ci/requirements-ci.txt` (core) + `ci/requirements-ci-dataquality.txt` **plus** the markllm group's `torch`/`transformers`/`markllm` pins from `ci/requirements-ci-markllm.in` — i.e. where the RCE-class CVEs actually live, **not** the 3-package root `requirements.txt`. It reads each package version's malware/tampering verdict and gates on a recent incident, closing the upstream-reputation gap in the supply-chain chain. It sits in `sast` next to `pip-audit`, ahead of the SBOM-driven `vuln-scan` stage.

**Step by step, in plain English**
1. Runs on the default Python image; `needs: ["pip-audit", "vault-secrets"]`, so it runs **after `pip-audit`** — the local CVE audit — before spending any external API quota (ordering only: `pip-audit` is advisory/`allow_failure`, so this still runs regardless of its findings). Installs `requests`.
2. **Token pre-flight:** runs `secure_software_scan.py --check-token`, which validates the token against the **no-quota** account endpoint (`GET {base}/user/account`; default base is the free Community API `https://data.reversinglabs.com/api/oss/community/v2/free`, overridable via `RL_API_URL` for Portal accounts). A present-but-invalid/expired token **fails the job fast and cheap here** with a clear message instead of mid-scan; an unset token is a no-op (exit 0) so the scan step below skips cleanly. You can run the same command locally before pushing: `RL_TOKEN='<PAT>' python3 docs/gaips-materials/scripts/secure_software_scan.py --check-token`.
3. Discovers the dependency **groups** under `ci/`: for each `requirements-ci*.in` it scans the committed hash-pinned lock (`requirements-ci*.txt`) when present, else the `.in` source (the markllm group has no committed lock — its pins are read straight from `.in`). Clean-skips with a note if no group files are found.
4. Skips cleanly when `RL_TOKEN` is unset — the pipeline runs unchanged until a Community token is wired in.
5. Parses every group file into `pkg:pypi/<name>@<version>` purls, **merges and de-duplicates** the pins across files (the core/dataquality locks overlap heavily, so ~300 unique packages are scanned once, not the sum of the lockfiles; PEP 440 local segments like `torch 2.12.0+cpu` are normalized to the published release `2.12.0`), and submits them to `{base}/find/packages` **in batches of five** (the Community Free-plan per-request cap), retrying briefly on rate-limit (429).
6. For each package, matches the **pinned version** and reads *that version's* `assessments.malware.status` / `assessments.tampering.status` (the RL verdict; requires a non-`compact` response, which the script requests), its version-level `incidents`, and the package `all_malicious` rollup. The package's **lifetime** incident counts (e.g. a mature package's hundreds of historical yanks) are recorded as `package_incident_history` for context but **never gate** — only the pinned version's own signals do, to avoid false positives.
7. Applies the **enforcement switch** `RL_FAIL_ON`: blank → report-only (always exit 0, just publishes the report); `malware,tampering` → fail the pipeline on a hit. A 404 means the package isn't in the Community catalogue (typical for private/internal deps) and is recorded as `not_in_catalogue`, not a gate failure; other API errors (401/402/429/500) fail an enforced gate so it never passes green without evaluating.

**Output file(s):** `reports/secure-software.json` — per-dependency reputation/malware verdicts, packages not in the catalogue, operational errors, and the gate result.

> **Scope — PyPI by design.** This gate's mechanism is the Spectra Assure Community *purl-catalogue* search, so it reputation-rates **package-ecosystem** dependencies (PyPI here). The pipeline's other pulled third-party classes — container images, GitHub-release binaries (`cosign`/`gitleaks`), and model weights — aren't indexed by that catalogue and are vetted by *different* controls (image pinning + `trivy`/`grype`; `sha256sum` checksum verification; `modelscan`/`modelaudit`/`clamav` + signing). The full artifact-class → control map, including the explicit residual gaps, is in [`ci/SBOM.md`](ci/SBOM.md) → *Supply-Chain Control Coverage by Artifact Class*.

#### `pkg-integrity` — stage: `sast` · advisory (allow_failure) · output: `reports/pkg-integrity.env`, `reports/pkg-integrity-manifest.json`, `requirements.hashed.txt`

**What this job is for**
This job verifies the integrity of the Python dependency set: whether requirements are hash-pinned (PEP 476 / secure install) and whether they install cleanly with no hidden dependency conflicts. It complements the vulnerability-focused `pip-audit` and `lockfile-audit` by focusing on install reproducibility and hash enforcement. It runs after `setup` and is advisory.

**Step by step, in plain English**
1. Installs `pip-tools`, creates `reports/`, and resolves a requirements file via `.resolve-reqs`.
2. If no requirements file exists, records `hash_mode=skipped` in `reports/pkg-integrity.env` and exits cleanly.
3. If requirements already contain `--hash=` lines, installs with `--require-hashes` and records `hash_mode=enforced`.
4. If not hash-pinned, warns, picks a `.in` source (else the requirements file itself), runs `pip-compile --generate-hashes` to produce `requirements.hashed.txt`, and records `hash_mode=warn_generated`.
5. Creates a throwaway `/tmp/verify-venv`, installs the requirements there (honouring hashes when present), and runs `pip check` to fail on broken/missing dependencies.
6. While that venv is active, snapshots its package list to `reports/pkg-list.json`.
7. Combines the package list and hash mode into `reports/pkg-integrity-manifest.json` and prints the verified package count.

**Output file(s):** `reports/pkg-integrity.env` — `hash_mode` (skipped/enforced/warn_generated); `reports/pkg-integrity-manifest.json` — verified-venv package manifest plus hash mode; `requirements.hashed.txt` — generated hash-pinned lockfile (when requirements lacked hashes).

#### `conda-pkg-verify` — stage: `sast` · advisory (allow_failure) · output: `reports/conda/`

**What this job is for**
This job verifies the dependency set under Conda, proving packages can be resolved exclusively from the trusted `conda-forge` channel with no leakage from the Anaconda `defaults`/`main` channels. It complements the pip-side integrity work in `pkg-integrity` and runs after `setup` inside the pinned `IMAGE_MINICONDA` image. Advisory until a full conda environment spec is defined.

**Step by step, in plain English**
1. Runs in the pinned Miniconda image (manages its own Python) and creates `reports/conda/`.
2. Hardens conda config: enables SSL verification, sets strict channel priority, and adds `conda-forge`; it does not trust config-list editing to drop `defaults`.
3. Creates an isolated `ci-verify` env with `--override-channels --channel conda-forge`, so resolution ignores every other channel including `defaults`.
4. Attempts to install `requirements.txt` packages from conda-forge only, falling back gracefully, then runs `conda run ... pip check`.
5. Exports the resolved environment and installed package list to JSON under `reports/conda/`.
6. Proves isolation from the resolved package set (not config strings): a denial regex flags any package whose channel matches `defaults`/`pkgs/main`/`anaconda`/etc.
7. Prints the resolved package count; exits 1 if any package leaked from a defaults/Anaconda channel (advisory overall).

**Output file(s):** `reports/conda/` — `env-manifest.json` (exported reproducible env) and `installed-packages.json` (resolved package list with channels).

#### `markllm-deps-audit` — stage: `sast` · advisory (allow_failure) · output: `reports/markllm-deps-audit.json`

**What this job is for**
This is a dedicated vulnerability audit of the heavy MarkLLM watermark stack — `torch`, `transformers`, `markllm` at their pinned versions — that the main `pip-audit` and the core `lockfile-audit` group don't cover (those pins are heavy and conflict-prone, e.g. `huggingface_hub<1.0`). It runs after `setup` in a `python:3.10-slim` image and is advisory. Its report feeds `ai-bom-assemble`'s `vulnerabilities[]` and is re-checked by `ai-bom-content-gate`.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs after `setup` in `python:3.10-slim`.
2. Installs `pip-audit` and creates `reports/`.
3. Synthesizes a three-line requirement set from the pins (`torch==`, `transformers==`, `markllm==`) via process substitution and runs `pip-audit` over it — resolving their dependency tree and checking each package against OSV/PyPI/GitHub advisory DBs, writing JSON (`|| true`, so findings don't fail the step here).
4. An inline Python snippet totals the vulnerabilities and affected packages.
5. It prints each finding's package, advisory id, and `fix_versions` for explainability.
6. Advisory (`allow_failure: true`): records findings without blocking — known to surface RCE-class advisories in `torch`/`transformers` that currently have no fix.

**Output file(s):** `reports/markllm-deps-audit.json` — pip-audit findings for the pinned MarkLLM stack; consumed by `ai-bom-assemble` and `ai-bom-content-gate`.

### Stage 3 — SBOM

#### `syft-cyclonedx` — stage: `sbom` · advisory (allow_failure) · output: `sbom/sbom.cyclonedx.json`, `sbom/sbom.cyclonedx.xml`

**What this job is for**
This job produces the project's Software Bill of Materials (SBOM) in CycloneDX format, cataloguing every dependency present in the repository. The CycloneDX SBOM is the direct input that `grype-scan` consumes to find known vulnerabilities, so this sits at the head of the supply-chain evidence chain. It runs alongside `syft-spdx` (same inventory, different format).

**Step by step, in plain English**
1. Runs inside the pinned Syft container image (no Python, so venv bootstrap and pip cache are skipped).
2. Skips on the `[sigstore-discovery]` probe commit.
3. Waits only on `setup`.
4. Creates the SBOM output directory.
5. Runs Syft over the whole repository and writes the inventory as CycloneDX JSON.
6. Runs Syft again to write the same inventory as CycloneDX XML.
7. Uploads both files as artifacts. Advisory.

**Output file(s):** `sbom/sbom.cyclonedx.json`, `sbom/sbom.cyclonedx.xml` — the dependency inventory in CycloneDX JSON and XML; the JSON is the input for `grype-scan`.

#### `syft-spdx` — stage: `sbom` · advisory (allow_failure) · output: `sbom/sbom.spdx.json`, `sbom/sbom.spdx`

**What this job is for**
This job generates the same dependency inventory as `syft-cyclonedx` but in the SPDX format, giving downstream consumers and auditors an alternative, widely-recognized SBOM standard. It exists to maximize interoperability of the supply-chain evidence; some tools and compliance regimes expect SPDX rather than CycloneDX.

**Step by step, in plain English**
1. Runs inside the pinned Syft container image (no Python).
2. Skips on the `[sigstore-discovery]` probe commit.
3. Waits only on `setup`.
4. Creates the SBOM output directory.
5. Runs Syft over the whole repository and writes the inventory as SPDX JSON.
6. Runs Syft again to write the inventory in SPDX tag-value (plain text) form.
7. Uploads both files as artifacts. Advisory.

**Output file(s):** `sbom/sbom.spdx.json`, `sbom/sbom.spdx` — the dependency inventory in SPDX JSON and SPDX tag-value formats.

#### `dvc-verify` — stage: `sbom` · advisory (allow_failure) · output: `reports/dvc-status.json`

**What this job is for**
This job adds DVC (Data Version Control) lineage checking on top of the digest/signature/version-info provenance the rest of the pipeline records. Where the SBOM jobs inventory code dependencies, this verifies that large datasets and models in the workspace match their pinned DVC versions (and pulls them from a remote store when one is configured). It is opt-in and skips cleanly when the repo is not using DVC.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `setup`.
2. Creates the reports output directory.
3. Checks for a `.dvc/` directory; if absent, writes a `{"skipped":true,...}` status file and exits 0 (DVC not initialized).
4. Installs `dvc[all]` and prints the DVC version.
5. If `DVC_REMOTE_URL` is set, configures it and runs `dvc pull` (a pull failure is a warning, not a hard error); otherwise reports tracked-vs-workspace status only.
6. Records which DVC-tracked artifacts differ from their pinned versions via `dvc data status --granular --json`, with fallbacks.
7. Prints the resulting status JSON and uploads it. Advisory.

**Output file(s):** `reports/dvc-status.json` — machine-readable report of DVC-tracked artifacts that differ from their pinned versions (or a skip/no-output note).

### Stage 4 — Vulnerability Scan

#### `grype-scan` — stage: `vuln-scan` · advisory (allow_failure) · output: `reports/grype.json`

**What this job is for**
This job scans the project's dependencies for known vulnerabilities (CVEs) by feeding the CycloneDX SBOM produced by `syft-cyclonedx` into Grype. It depends directly on `syft-cyclonedx` and runs in parallel with the broader filesystem/image scanning done by `trivy-scan`. It clean-skips if the SBOM input is missing.

**Step by step, in plain English**
1. Runs inside the pinned Grype container image (no Python).
2. Skips on the `[sigstore-discovery]` probe commit; otherwise depends on `syft-cyclonedx`.
3. Creates the reports output directory.
4. Checks whether the CycloneDX SBOM exists; if not, writes a `{"skipped":true,...}` report and exits 0.
5. Runs Grype against the CycloneDX SBOM and writes results as JSON.
6. Runs Grype again to print a human-readable table to the log.
7. Uploads the JSON report. Advisory.

**Output file(s):** `reports/grype.json` — Grype's JSON vulnerability findings derived from the CycloneDX SBOM (or a skip note if the SBOM was missing).

#### `trivy-scan` — stage: `vuln-scan` · advisory (allow_failure) · output: `reports/trivy-fs.json`, `reports/trivy-image.json`

**What this job is for**
This job uses Trivy to scan both the repository filesystem and the built container image for vulnerabilities and secrets, complementing the SBOM-driven `grype-scan` with a direct source-and-image scan. Its image report is also wired into GitLab's native container-scanning report.

**Step by step, in plain English**
1. Runs inside the pinned Trivy container image (no Python).
2. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `setup` and `vault-secrets`.
3. Creates the reports output directory.
4. Scans the filesystem with Trivy, skipping `.pip-cache` (third-party download cruft that produced a false-positive "JWT token" finding), writing JSON with exit code forced to 0.
5. Runs the same filesystem scan again to print a human-readable table.
6. Scans the container image `${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA}` and writes JSON; if the image is unavailable, falls back to an empty `{"Results":[]}` report so the artifact always exists.
7. Uploads both JSON reports and registers the image report as GitLab's `container_scanning` report. Advisory.

**Output file(s):** `reports/trivy-fs.json`, `reports/trivy-image.json` — Trivy's JSON findings for the repository filesystem and the built container image respectively.

### Stage 5 — Model Integrity

This is the largest stage: a model-signing chain, a fan-out of malware/format scanners, a parallel dataset chain, and a converging hard gate (`artifact-signing-gate`).

#### `model-signing-install` — stage: `model-integrity` · hard gate · output: none

**What this job is for**
This is the toolchain installer/gate at the head of the model-integrity stage. It verifies the signing stack (`model-signing` + `sigstore` Python packages) installs and imports, and that the pinned cosign binary matches its published checksum, so any breakage fails fast here rather than wasting time in the downstream jobs (`model-digest`, `modelscan`, etc.) that each reinstall the same stack.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `setup`.
2. Installs the version-pinned `model-signing` and `sigstore` Python packages.
3. Imports `model_signing` and prints its version to confirm the install works.
4. Installs `curl` and `ca-certificates` (needed to fetch cosign, a Go binary not on PyPI).
5. Downloads the pinned cosign Linux binary and its checksums file from the Sigstore GitHub releases.
6. Verifies the binary against its checksum line with `sha256sum --check --strict` (a mismatch fails the job).
7. Installs the verified cosign binary and prints its version. Any failure hard-fails the pipeline.

**Output file(s):** None — this is a gate/installer; it produces no artifact.

#### `model-fixture-download` — stage: `model-integrity` · hard gate · output: `models/`, `evidence/model-fixture-download.json`

**What this job is for**
This job fetches the model fixture that the rest of the model-integrity chain operates on, pinning it to a known SHA-256 so a swapped or corrupted download is caught immediately. It feeds `model-digest` (hashing), `model-sign` (signing), and `modelscan`. A checksum mismatch stops the pipeline; when no fixture URL is configured it clean-skips.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `setup` and `model-manifest`.
2. Runs as a curl-only job; installs `curl` and `ca-certificates`.
3. Creates the model and evidence output directories.
4. If `MODEL_FIXTURE_URL` is unset, writes a `{"skipped":true,...}` evidence file and exits 0.
5. Downloads the fixture from `MODEL_FIXTURE_URL` to its path under the model directory.
6. If `MODEL_FIXTURE_SHA256` is set, verifies the download with `sha256sum --check --strict` (a mismatch hard-fails).
7. Records the byte size and writes an evidence JSON with the repo-relative path, expected SHA-256, and byte count.
8. Uploads the model directory and the evidence file as artifacts.

**Output file(s):** `models/` — the downloaded, checksum-pinned model fixture; `evidence/model-fixture-download.json` — record of the download (path, sha256, byte count, or skip reason).

#### `model-digest` — stage: `model-integrity` · advisory (allow_failure) · output: `evidence/model-digests.txt`

**What this job is for**
This job computes SHA-256 digests of every model file downloaded by `model-fixture-download`, producing the canonical digest list that flows into `tamper-verification` (baseline comparison), `sign-evidence` (recorded digests), and the AI-BOM. Per Fix #32 it records repo-relative paths rather than absolute runner paths, so those consumers receive clean, portable path strings.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `model-signing-install` and `model-fixture-download`.
2. Uses no Python deps or pip cache — the loop is pure `find`/`sha256sum`.
3. Creates the evidence directory and an empty digest file.
4. Iterates over known model file extensions (`pkl pt safetensors gguf bin h5 onnx`) under the model directory.
5. For each file, computes its SHA-256.
6. Strips the project-dir prefix to record a repo-relative path (Fix #32), then appends `"<rel-path>  sha256:<hash>"` to the digest file.
7. If no model files are found, writes a `WARNING: No model files found...` line instead.
8. Prints the digest file and uploads it.

**Output file(s):** `evidence/model-digests.txt` — one line per model file (`<repo-relative-path>  sha256:<hash>`), or a warning line if none were found.

#### `model-sign` — stage: `model-integrity` · hard gate · output: `models/**/model.sig`

**What this job is for**
This job keylessly signs each model directory with cosign/Sigstore using a GitLab-issued per-job OIDC token, producing the `model.sig` bundles that `signature-verification` later validates against the pinned signer identity. It is a hard gate so a signing failure cannot pass green and leave `signature-verification` with nothing to verify.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `model-digest`, `model-fixture-download`, and `vault-secrets`.
2. GitLab issues a per-job OIDC JWT (`SIGSTORE_ID_TOKEN`, audience `sigstore`), which Fulcio requires for keyless signing.
3. Installs the pinned `model-signing` and `sigstore` packages.
4. Logs whether `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER` are configured (informational here).
5. Finds each immediate subdirectory of the model directory and runs `python -m model_signing sign sigstore` with the per-job token, writing a `model.sig` into each.
6. Counts how many directories were signed.
7. If zero were signed but real model files exist, hard-fails ("models present but unsigned"); if there are genuinely no model directories, it reports nothing to sign and passes.
8. Uploads all `model.sig` bundles. A signing failure hard-fails the pipeline.

**Output file(s):** `models/**/model.sig` — one Sigstore signature bundle per signed model directory.

#### `sigstore-identity-discover` — stage: `model-integrity` · advisory (allow_failure) · output: `.sigstore-identity-discover/probe/model.sig`

**What this job is for**
This is a manual, one-shot diagnostic probe used to discover the exact signer identity and OIDC issuer that GitLab's keyless signing produces, so an operator can copy them into the protected `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER` variables that `signature-verification` enforces against. It signs a throwaway probe file rather than a real model. It runs only on `main` with the `[sigstore-discovery]` marker, set to manual.

**Step by step, in plain English**
1. Only offered (manually) when the branch is `main` and the commit message contains `[sigstore-discovery]`. Has no `needs`, so it can run standalone.
2. GitLab issues the same per-job OIDC JWT (`SIGSTORE_ID_TOKEN`, aud `sigstore`) used by `model-sign`.
3. Installs the pinned `model-signing` and `sigstore` packages plus `cryptography`.
4. Creates a probe directory and writes a tiny placeholder probe file.
5. Signs the probe directory with `model_signing sign sigstore`, producing a `model.sig` bundle.
6. An inline Python script loads the bundle, decodes the signing certificate, and extracts the SubjectAlternativeName URI (signer identity) and the Fulcio OIDC issuer extension.
7. Prints a clearly delimited "COPY THESE" block with `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER`.
8. Uploads the probe `model.sig`. Advisory.

**Output file(s):** `.sigstore-identity-discover/probe/model.sig` — the throwaway probe signature bundle whose certificate yields the identity/issuer values.

#### `signature-verification` — stage: `model-integrity` · hard gate · output: `evidence/signature-verification.txt`, `evidence/signature-verification.jsonl`

**What this job is for**
This is the enforcing verifier for the signatures produced by `model-sign`: it confirms each `model.sig` is cryptographically valid against the pinned `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER`, then records what was verified via `scripts/explain_signature.py`. Because those pinned values are protected CI/CD variables (injected only on protected branches/tags), it is protection-aware: on an unprotected branch it deliberately defers rather than failing.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `model-sign`, `model-fixture-download`, and `vault-secrets`.
2. Installs the pinned `model-signing` and `sigstore` packages and pre-creates the two (initially empty) evidence files so `artifacts: when: always` never warns.
3. Logs the identity/issuer it will verify against plus the branch's protected status.
4. If `MODEL_SIGNING_IDENTITY` or `SIGSTORE_OIDC_ISSUER` is unset: on a protected ref this is a real misconfiguration and the job hard-fails; on an unprotected ref it records whether a `model.sig` is present, writes a "DEFERRED" evidence record, and exits 0 (verification is enforced later on the protected branch).
5. Otherwise, for each `model.sig` it runs `model_signing verify sigstore` against the pinned identity and issuer — the authoritative check.
6. After each successful verify, runs `scripts/explain_signature.py`, which records the certificate SAN (matched identity), the Fulcio OIDC issuer, each Rekor entry (logIndex + integratedTime), and the signed in-toto subject digests, plus a recomputed-vs-signed sha256 per file (a mismatch is a non-fatal WARNING).
7. If zero signatures were verified but real model files exist, hard-fails (the anti-vacuous-pass guard); if there are no models either, it passes.
8. Uploads both evidence files (`when: always`).

**Output file(s):** `evidence/signature-verification.txt` — human-readable record of each verified signature (identity, issuer, Rekor entries, subjects); `evidence/signature-verification.jsonl` — one JSON record per verified (or deferred) signature.

#### `tamper-verification` — stage: `model-integrity` · hard gate · output: `evidence/integrity.env`, `evidence/model-digests-baseline.txt`

**What this job is for**
This is the cross-pipeline drift gate: it compares the model digests from `model-digest` against a stored baseline so a model file whose content changes (or is added/removed) between pipelines is detected as tampering. The baseline is kept durably in Vault when `VAULT_ADDR` is set, falling back to a best-effort job cache otherwise.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `model-digest`. GitLab issues a per-job `VAULT_ID_TOKEN`.
2. Installs `hvac` and reads the current digests from `evidence/model-digests.txt`.
3. If `VAULT_ADDR` is set, authenticates to Vault and reads the baseline from `secret/gaips/tamper-baseline/<project-slug>`; on first run it seeds the baseline. If Vault fails it falls back to the file baseline.
4. Without Vault, it reads the baseline from the cached `model-digests-baseline.txt`, seeding from current digests if none exists.
5. If the stored baseline only recorded an empty-model placeholder but current digests are real, it reseeds with the current digests.
6. Comparison is content-based and path-insensitive: it reduces both baseline and current to the SET of sha256 hashes, so a path-format change (e.g. the Fix #32 absolute→relative move) is NOT treated as tampering — only an actual hash change or an added/removed file is.
7. If both sets are non-empty and differ, it prints each digest missing-from-current and each new-in-current as "TAMPER DETECTED" and exits 1. Otherwise it prints "Tamper check PASSED".
8. On a content match it migrates the stored baseline to the current relative-path form (file + Vault), so the baseline self-heals and stops carrying stale absolute-path lines, then writes `tamper_check_passed=true` to `integrity.env`.
9. Uploads `integrity.env` and the file-fallback baseline.

**Output file(s):** `evidence/integrity.env` — `tamper_check_passed=true` on success; `evidence/model-digests-baseline.txt` — the file-fallback baseline digest list (Vault is authoritative when `VAULT_ADDR` is set).

#### `modelscan` — stage: `model-integrity` · advisory (allow_failure) · output: `reports/modelscan.json`, `reports/modelscan.log`

**What this job is for**
This is the local serialized-model scanner: it inspects pickle/PyTorch/TensorFlow/Keras artifacts under the model directory for unsafe operators (e.g. arbitrary-code execution embedded in a pickle). It runs early in model-integrity, feeding `modelaudit-scan` (which lists it in `needs`). Although advisory, its report is consumed by `artifact-signing-gate`, which fails if `modelscan.json` is missing or reports CRITICAL issues.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs after `model-signing-install` and `model-fixture-download`.
2. Installs `modelscan` and ensures the reports and model directories exist.
3. Searches for any supported serialized format (`.pt .pth .bin .ckpt .pb .h5 .keras .npy .pkl .pickle .joblib .dill`); if none, writes a "skipped" stub report plus an empty log and exits clean.
4. Runs `modelscan scan`, writing JSON to `modelscan.json` and teeing console output to `modelscan.log`.
5. Interprets the exit code: 0 (clean), 1 (findings), 3 (no supported files) are tolerated; any other code is treated as a real error.
6. Parses the JSON summary and prints a CRITICAL/HIGH/MEDIUM/LOW/SCANNED tally.
7. Notes (without failing) when zero artifacts were scanned.
8. Exits non-zero only on a CRITICAL issue; even then `allow_failure: true` keeps it advisory.

**Output file(s):** `reports/modelscan.json` — scan results (or a "skipped" stub); `reports/modelscan.log` — the raw scan transcript.

#### `modelaudit-scan` — stage: `model-integrity` · hard gate · output: `reports/modelaudit.json`, `reports/modelaudit-summary.json`, `reports/modelaudit.log`

**What this job is for**
This is the second, stricter pass over local model files using the ModelAudit CLI, run after `modelscan`. Unlike the advisory `modelscan`, this is a hard gate: it fails on operational errors, CRITICAL findings, or any reported warnings. It runs in its own pinned `python:3.11-slim` image with telemetry disabled, and covers GGUF/safetensors/ONNX/manifests/archives that ModelScan does not.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; runs in `python:3.11-slim` with `before_script` cleared and telemetry off.
2. Asserts Python >= 3.10, upgrades pip/setuptools/wheel, installs `modelaudit[all]` pinned to `MODELAUDIT_VERSION`, and prints the version.
3. If no files exist under the model directory, writes "skipped" stubs for both JSON reports plus an empty log and exits clean.
4. Runs `modelaudit scan` in JSON mode, capturing the log and report and recording the exit code.
5. If no report was produced, synthesizes a "failed" JSON report carrying the exit code.
6. Walks the report to count severities (CRITICAL, warning-class, INFO) and writes the rolled-up `modelaudit-summary.json`.
7. Applies the gate per ModelAudit's exit contract: exit 2 (operational failure), any CRITICAL, or exit 1 (warnings) fail the job.
8. Always uploads all three artifacts; `allow_failure: false` makes this a real blocker.

**Output file(s):** `reports/modelaudit.json` — full findings; `reports/modelaudit-summary.json` — derived severity counts and pass/fail flag; `reports/modelaudit.log` — raw CLI transcript.

#### `modelfile-audit` — stage: `model-integrity` · advisory (allow_failure) · output: `reports/modelfile-audit.json`, `evidence/modelfile-digests.txt`

**What this job is for**
This job records integrity evidence for Ollama `Modelfile` definitions by hashing them, so their exact contents are pinned and auditable. It is a lightweight, stdlib-only companion to the binary scanners (`modelscan`, `modelaudit-scan`, `clamav-scan`); where those inspect model weights, this fingerprints the build recipes. Advisory; cleanly skips when no Modelfiles exist.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs after `setup` with the pip cache disabled.
2. Ensures the reports and evidence directories exist.
3. Searches for Modelfiles recursively under the model directory plus `Modelfile` at the repo root and one level below, de-duplicating by resolved path.
4. If none are found, writes a "skipped" `modelfile-audit.json` and exits clean.
5. For each Modelfile, reads its text and computes a SHA-256.
6. Writes `rel-path  sha256:<digest>` lines to `evidence/modelfile-digests.txt` (separate file to avoid a write race with `model-digest`).
7. Writes structured results to `reports/modelfile-audit.json` and prints how many were hashed.

**Output file(s):** `reports/modelfile-audit.json` — per-Modelfile SHA-256 digests (or a "skipped" marker); `evidence/modelfile-digests.txt` — plaintext path/digest evidence lines.

#### `clamav-scan` — stage: `model-integrity` · hard gate · output: `reports/clamav-model.log`, `reports/clamav-model.txt`, `reports/clamav-model.json`

**What this job is for**
This is the antivirus/malware gate over the model bytes, run in the pinned `clamav/clamav` image. It is the only hard-gating malware control in the pipeline, so it is deliberately defensive about proving a scan actually happened (it refuses to pass on an empty scan). It complements the model-format scanners `modelscan` and `modelaudit-scan` by checking for conventional malware.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs after `model-signing-install` and `model-fixture-download`, with `before_script` cleared (the image has no Python).
2. Ensures the reports and model directories exist, then runs `freshclam` to refresh virus signatures (non-fatal: a failed update falls back to the cached DB).
3. Runs `clamscan` recursively with large file/scan-size limits, writing the detailed log and console output, and records the exit code.
4. Counts infected files by tallying ` FOUND` lines.
5. Parses the summary to extract "Scanned files" and "Known viruses" counts.
6. Writes `clamav-model.json` (scanned dir, infected count, scanned-file count, signature count, exit code) and prints a one-line status.
7. Fails on exit 1 (virus) or any other non-zero (scan error).
8. Empty-scan guard: fails if "Scanned files" parsed to < 1; if the summary couldn't be parsed, falls back to a `find` file count and fails only when nothing exists to scan. `allow_failure: false`.

**Output file(s):** `reports/clamav-model.log` — detailed clamscan log; `reports/clamav-model.txt` — console transcript and exit line; `reports/clamav-model.json` — parsed summary (infected/scanned/signatures/exit).

#### `hf-artifact-scan` — stage: `model-integrity` · hard gate · output: `reports/hf-scan/`

**What this job is for**
This is a HuggingFace provenance/policy gate over EXTERNAL Hub repositories, not a byte scanner. Rather than re-downloading weights (already covered by `clamav-scan`, `modelscan`, and the model digest/sign/verify jobs), it queries `huggingface_hub.model_info` to enforce policy: rejecting Hub-disabled repos, enforcing an author allowlist, and detecting commit-SHA drift from pins. It is opt-in and cleanly skips when `HF_MODEL_IDS` is unset.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs after `setup` and `vault-secrets`.
2. Creates `reports/hf-scan/` first, then checks `HF_MODEL_IDS`; if empty, writes a "skipped" `summary.json` and exits clean.
3. Installs `huggingface_hub` only when there are repos to gate.
4. Parses `HF_MODEL_IDS`, the optional `HF_AUTHOR_ALLOWLIST`, and optional `HF_PINNED_SHAS` (`id=sha`); reads optional `HF_TOKEN`.
5. For each model id, calls `model_info` and records author, sha, disabled/gated/private flags, and file count.
6. Evaluates policy per repo: a disabled repo, an author not on the allowlist (when set), or a live sha differing from its pin are violations; any `model_info` exception is also a violation.
7. Aggregates per-repo records into `reports/hf-scan/summary.json` and prints OK or the specific violations.
8. Exits non-zero on any violation; with `allow_failure: false`, that fails the pipeline.

**Output file(s):** `reports/hf-scan/summary.json` — per-repo provenance records and policy violations, or a "skipped" marker when `HF_MODEL_IDS` is unset.

#### `dataset-download` — stage: `model-integrity` · advisory (allow_failure) · output: `evidence/dataset-input/`

**What this job is for**
This is the head of the dataset chain. It puts a dataset on disk so the downstream gates (`dataset-scan`, `dataset-redact`, `eval-dataset-validate`, `great-expectations-validate`, `ydata-profile`, `dataset-sign`) have something to operate on. Advisory so it can skip gracefully; when the chain is intentionally turned off it deliberately stages nothing so every downstream job hits its own clean skip. It is also the **dataset-integrity gate**: in both modes, when `DATASET_EXPECTED_SHA256` is pinned (from `evals/dataset-baseline.json`), the staged bytes must match it or the job fails — so any modification to the dataset trips the pipeline. The check runs on the **raw, pre-redaction** bytes, so it is deterministic and unaffected by Presidio's non-deterministic redaction downstream.

**Step by step, in plain English**
1. Creates `evidence/dataset-input/` and the reports directory.
2. If `DATASETS_DISABLED=true`, writes a `skipped` report and exits 0, staging no dataset.
3. If `DATASET_FILENAME` is unset, falls back to the committed fixture named by `DATASET_FIXTURE_FILE` (default `gandalf-ignore-instructions-test.jsonl`; set to `ci-dataset.jsonl` for the minimal plumbing fixture): copies it in, computes its SHA-256, and — when `DATASET_EXPECTED_SHA256` is set — verifies the staged fixture against it (`exit 1` on mismatch), then writes `dataset-digest.txt`, a `fixture:true` report, and exits.
4. Otherwise (download mode) it requires an integrity pin: if `DATASET_EXPECTED_SHA256` is unset and `DATASET_ALLOW_UNVERIFIED` is not `true`, it errors out (fail-closed).
5. Installs `curl`/CA certs and downloads the file from the GitLab generic package registry using the job token.
6. Computes the download's SHA-256 and writes it to `dataset-digest.txt`.
7. If a pin was given, compares the digest to `DATASET_EXPECTED_SHA256` and fails on mismatch; if unverified mode was opted into, logs a warning and proceeds.
8. Emits the final `reports/dataset-download.json` (filename, size, sha256).

**Output file(s):** `evidence/dataset-input/` — the staged dataset bytes (fixture or downloaded); also `evidence/dataset-digest.txt` and `reports/dataset-download.json`.

#### `dataset-scan` — stage: `model-integrity` · hard gate · output: `reports/dataset-scan.json`

**What this job is for**
The first hard gate on the data, sitting after `dataset-download` and before `dataset-redact`. It ensures the dataset is malware-free (ClamAV) and structurally well-formed (JSON/JSONL parses) before anything downstream redacts, validates, or loads it. It fails closed: a missing-but-expected dataset is a broken chain, not a skip.

**Step by step, in plain English**
1. Locates the dataset file under `evidence/dataset-input/`.
2. If none found: skips clean only when `DATASETS_DISABLED=true`; otherwise treats it as a broken chain and fails.
3. Installs ClamAV and runs `freshclam`, falling back to the cached DB on failure.
4. Runs `clamscan --infected`, teeing output and capturing the exit code.
5. Parses the summary for infected count, files scanned, and signatures loaded, then writes `reports/dataset-clamav.json`.
6. Fails on ClamAV exit 1 (infected) or any other non-zero (scan error).
7. Empty-scan guard: if 0 files were scanned it fails; if the summary couldn't be parsed it verifies the file is non-empty instead.
8. Runs a Python structural check: `.json` must parse as JSON, `.jsonl`/`.ndjson` each non-blank line must parse; any HIGH finding is written to `reports/dataset-scan.json` and fails the job.

**Output file(s):** `reports/dataset-scan.json` — structural-scan result with findings; also `reports/dataset-clamav.log`, `reports/dataset-clamav.json`, `reports/clamav-dataset.txt` (AV evidence).

#### `dataset-redact` — stage: `model-integrity` · hard gate · output: `reports/dataset-redact.json`

**What this job is for**
Defence-in-depth on data confidentiality, run after `dataset-scan` clears the data and before it is validated, profiled, or signed. It strips secrets (via gitleaks findings) and PII (via Presidio) out of the dataset in place, so the redacted bytes are what every later job consumes. It needs both `dataset-scan` (ordering) and `dataset-download` (which carries the `dataset-input/` artifact). Backing script: `scripts/redact_dataset.py`.

**Step by step, in plain English**
1. Locates the dataset under `dataset-input/` (ignoring any `dataset.sig`/`dataset.pem`).
2. If none found: skips clean only when `DATASETS_DISABLED=true`; otherwise fails as a broken chain.
3. Installs `curl`/CA certs, then downloads and checksum-verifies the pinned gitleaks release before installing it.
4. Installs Presidio (`presidio-analyzer`, `presidio-anonymizer`, `click`) and downloads the spaCy `en_core_web_sm` model.
5. Runs `gitleaks detect --no-git` over the dataset, producing a secrets report at `/tmp` (kept internal, never published).
6. Calls `scripts/redact_dataset.py` with the dataset, the gitleaks report, and the `REDACT_MAX_SECRETS=0` / `REDACT_MAX_PII=-1` thresholds.
7. The script walks string values inside JSON/JSONL records, replacing matched secrets with `[REDACTED-SECRET]` and Presidio PII with `<ENTITY>` tokens, rewriting the file in place; it records counts only, never raw values. **Structural identifier/label fields are skipped** (`--skip-keys`, default `id,case_id,category`): these are eval-dataset *contract* values, not free-text PII candidates, and scanning them is a false positive that corrupts them — Presidio mis-tagged synthetic ids like `gandalf-ignore-test-0001` as `DATE_TIME`/`PERSON`, collapsing unique ids into duplicates and breaking downstream id-uniqueness and record identity (in the signed dataset and the AI-BOM). Free-text fields (`prompt`/`question`/`expected`) are still fully redacted.
8. It writes the report (original/redacted SHA, counts, PII-by-type, `skipped_keys`) first, then exits non-zero if findings exceed the thresholds — so the data is always redacted even when the gate fails (zero-tolerance for secrets; PII gate disabled by default with `-1`).

**Output file(s):** `reports/dataset-redact.json` — redaction counts, before/after SHA-256, `skipped_keys`, and any threshold breaches; also republishes `evidence/dataset-input/` containing the redacted data.

#### `eval-dataset-validate` — stage: `model-integrity` · hard gate · output: `reports/eval-dataset-validation.json`

**What this job is for**
A contract gate that runs after `dataset-redact` and confirms every record conforms to `evals/eval-dataset.schema.json` before any AI-eval job loads the data. It catches off-contract/malformed records up front. It is the STRUCTURE gate that `great-expectations-validate` later complements with a CONTENT gate. Backing script: `scripts/validate_eval_dataset.py`.

**Step by step, in plain English**
1. Locates the redacted dataset under `dataset-input/` (ignoring sig/pem files).
2. If none found: skips clean only when `DATASETS_DISABLED=true`; otherwise fails as a broken chain.
3. Installs `jsonschema`, then invokes `scripts/validate_eval_dataset.py` with the dataset and schema.
4. The script iterates records (JSON array, single object, or JSONL/NDJSON) and validates each with a Draft7 validator.
5. Collects per-record errors (record number, JSON path, message), capping at `--max-errors` (default 20).
6. On unparseable JSON/JSONL it writes a `valid:false` parse-error report and exits 1.
7. Writes `reports/eval-dataset-validation.json` with record count, error count, and the error list.
8. Exits non-zero if any schema errors were found.

**Output file(s):** `reports/eval-dataset-validation.json` — validity flag, record count, and any per-record schema errors.

#### `great-expectations-validate` — stage: `model-integrity` · advisory (soft gate) · output: `reports/great-expectations.json`

**What this job is for**
The content-quality gate one rung above `eval-dataset-validate`'s structure check: it asserts null rates, value ranges, uniqueness, and cardinality — things a JSON Schema cannot express — over the redacted, on-contract data. It is currently a soft gate (`allow_failure: true`), intended to flip to a hard gate once expectations are tuned. It pairs with `ydata-profile` (profile → read alerts → refine the suite). Backing script: `scripts/run_great_expectations.py`.

**Step by step, in plain English**
1. Installs `great-expectations` and `pandas`, then creates the reports and `evidence/great-expectations/` dirs.
2. Locates the dataset; if absent, skips clean only under `DATASETS_DISABLED=true`, else reports a broken chain (non-blocking because advisory).
3. Invokes `scripts/run_great_expectations.py`, which loads the JSON/JSONL into a pandas DataFrame.
4. Uses the suite from `evals/great-expectations-suite.json` if present; otherwise infers a conservative suite (row-count floor, non-null/unique id, non-empty prompt/question/expected fields, mostly-non-null category).
5. Drops any column-targeting expectations whose column is absent from this dataset.
6. Builds a file-backed GX context, data source, batch, suite, validation definition, and checkpoint, then runs the checkpoint.
7. Best-effort renders Data Docs and copies the HTML site into `evidence/great-expectations/`.
8. Writes `reports/great-expectations.json` and exits non-zero if expectations failed — but `allow_failure: true` keeps that non-blocking for now.

**Output file(s):** `reports/great-expectations.json` — checkpoint pass/fail and per-expectation results; also `evidence/great-expectations/` (Data Docs site).

#### `ydata-profile` — stage: `model-integrity` · advisory (allow_failure) · output: `reports/ydata-profile.json`

**What this job is for**
An advisory automated profile of the redacted dataset (types, distributions, null counts, cardinality, correlations, alerts), running after `dataset-redact`. It never gates — it exists to inform the `great-expectations-validate` suite: the intended workflow is profile, read the alerts, then author/refine expectations. Backing script: `scripts/run_ydata_profile.py`.

**Step by step, in plain English**
1. Installs `setuptools<81` (pinned because ydata-profiling still imports `pkg_resources`), `ydata-profiling`, and `pandas`.
2. Creates the reports and `evidence/ydata-profile/` dirs.
3. Locates the dataset; if absent, skips clean only under `DATASETS_DISABLED=true`, else reports a broken chain (non-blocking).
4. Invokes `scripts/run_ydata_profile.py`, which loads the JSON/JSONL into a pandas DataFrame.
5. Builds a `ProfileReport` with `minimal=True` (skips expensive correlations/interactions to keep CI fast on large text columns).
6. Writes the HTML profile to `evidence/ydata-profile/profile.html`.
7. Writes the JSON profile to `reports/ydata-profile.json`.
8. Returns success regardless of dataset content — evidence only, never fails on quality grounds.

**Output file(s):** `reports/ydata-profile.json` — machine-readable dataset profile; also `evidence/ydata-profile/profile.html`.

#### `dataset-sign` — stage: `model-integrity` · advisory (allow_failure) · output: `evidence/dataset-input/` (`.sig`/`.pem`)

**What this job is for**
Signs the dataset only after it is clean, redacted, and on-contract, attesting the redacted bytes (never the raw download). It needs both `eval-dataset-validate` (proving validation passed) and `dataset-redact` (which carries the redacted bytes). It uses cosign keyless signing via the GitLab OIDC token, the same mechanism as `model-sign`. Advisory, so it skips gracefully when no dataset is present.

**Step by step, in plain English**
1. Ensures `evidence/dataset-input/` exists and locates the dataset (ignoring existing `.sig`/`.pem`).
2. If none found: skips clean under `DATASETS_DISABLED=true`, else fails as a broken chain.
3. Installs `curl`/CA certs, then downloads cosign and checksum-verifies it before installing.
4. Re-locates the dataset file to sign.
5. If `SIGSTORE_ID_TOKEN` is present (from the `id_tokens` block, aud `sigstore`), runs `cosign sign-blob --yes` over the dataset.
6. Cosign performs keyless signing, getting a Fulcio certificate recorded in Rekor.
7. Writes the detached signature to `dataset-input/dataset.sig` and the certificate to `dataset-input/dataset.pem`.
8. If no token is available, logs that the dataset is left unsigned rather than failing.

**Output file(s):** `evidence/dataset-input/` — republished dataset plus `dataset.sig` (detached signature) and `dataset.pem` (Fulcio certificate).

#### `artifact-signing-gate` — stage: `model-integrity` · hard gate · output: none

**What this job is for**
The enforcing chokepoint of the model-integrity stage: no evaluation job runs unless model integrity has passed. It depends on the nine integrity checks (`signature-verification`, `tamper-verification`, `modelscan`, `modelaudit-scan`, `modelfile-audit`, `clamav-scan`, `hf-artifact-scan`, `dataset-scan`, `eval-dataset-validate`) and is a defence-in-depth backstop. It produces no artifact — it only passes or fails — and must stay `allow_failure: false`, or the gate becomes a no-op.

**Step by step, in plain English**
1. Skips the venv bootstrap (`before_script: []`) since it only needs stdlib.
2. Fails closed if `evidence/integrity.env` is missing (tamper-verification never wrote evidence).
3. Sources `integrity.env` and fails unless `tamper_check_passed=true`.
4. Loads `reports/modelscan.json`; fails if missing, or if the summary reports any CRITICAL issues.
5. Loads `reports/modelaudit-summary.json`; fails if missing.
6. Fails if ModelAudit had an operational scan failure or reported any CRITICAL issues.
7. If every check passes, prints "Artifact signing gate PASSED — proceeding to evaluation" and exits 0.

**Output file(s):** None — this is a gate; it produces no artifact (it gates the AI-eval stage on tamper evidence plus the ModelScan/ModelAudit reports).

### Stage 6 — AI Evaluation

#### `markllm-watermark-eval` — stage: `ai-eval` · advisory (allow_failure) · output: `reports/markllm-results.json`

**What this job is for**
This is the pipeline's live AI-watermarking self-test: it proves the model can both produce a watermarked generation and have that watermark detected, end to end. It runs after `artifact-signing-gate` and `model-manifest`. It is advisory because the eval pulls a multi-GB transformers model and a heavy watermark stack onto a small runner, so a load or runtime failure records evidence without blocking; that verdict is later read by `evidence-summary`.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs on success.
2. Installs pinned `markllm`, `torch`, and `transformers` and creates the reports directory.
3. Resolves the model id: `MARKLLM_MODEL_ID` wins if set, otherwise derives `<org>/<repo>` from `MODEL_FIXTURE_URL`, stripping a trailing `-GGUF`/`-GGML` so the GGUF integrity fixture maps to the transformers repo MarkLLM loads; hard-errors if none can be resolved.
4. Runs `run_markllm_watermark_eval.py`, which loads the tokenizer and causal LM (CUDA if available, else CPU), builds a `TransformersConfig`, and loads the watermark algorithm (default `KGW`).
5. For two fixed prompts it generates watermarked text and then runs detection on that text, recording the prompt, output, length, and detection result.
6. Writes a JSON report with `status` (`passed`/`failed`), per-prompt results, and metrics; any import/load/generation failure writes a `failed` report and exits non-zero.
7. Artifacts are uploaded `when: always`.

**Output file(s):** `reports/markllm-results.json` — the watermark generate-then-detect self-test result, including per-prompt outputs, detection results, and an overall pass/fail `status` that `evidence-summary` reads as an **advisory** verdict (this job is `allow_failure` and evaluates a model that is not the signed integrity-path artifact, so its result is displayed and a failure is logged but does not block the gate).

### Stage 7 — Guardrail / Drift

#### `data-drift-baseline-commit` — stage: `guardrail` · advisory (allow_failure) · output: none

**What this job is for**
This job bootstraps input-side drift detection by committing the drift reference that `evidently-drift` seeds on its first run. It `needs: ["evidently-drift"]` and consumes that job's `dataset-reference.seed.jsonl`. Once it commits `evals/dataset-reference.jsonl`, `evidently-drift` leaves seed-mode and begins comparing against that reference on the **next** default-branch pipeline. Advisory so a failed auto-commit never breaks the build; runs on the default branch only.

> **Activation takes two default-branch runs.** This job commits the reference with `[skip ci]` + `-o ci.skip`, so the commit deliberately does **not** trigger a pipeline. The run that *seeds and commits* the reference therefore does no comparison; `evidently-drift` first compares against the committed reference on the **following** default-branch pipeline. Plan for two runs when you expect to see drift detection go live.

**Step by step, in plain English**
1. Runs only on the default branch and never on `[sigstore-discovery]` commits; installs git in `before_script`.
2. Exits cleanly if `evidently-drift` did not seed a reference this run (no seed file).
3. Exits cleanly if a reference already exists at `evals/dataset-reference.jsonl` — it never overwrites an existing reference.
4. Exits cleanly if `GITLAB_PUSH_TOKEN` is not set, printing manual instructions instead.
5. Sanitizes the seed rather than raw-copying it: an inline Python script drops null and non-finite (NaN/inf) values per record and re-emits strict, key-sorted JSONL (the raw seed can carry NaN-filled columns); it aborts if sanitization yields zero records.
6. Configures a CI git identity and commits the sanitized `evals/dataset-reference.jsonl` with a `[skip ci]` message.
7. Pushes to the default branch using `oauth2:${GITLAB_PUSH_TOKEN}` with `-o ci.skip` so it does not trigger a new pipeline.

**Output file(s):** None (no CI artifact). Its effect is a git commit of `evals/dataset-reference.jsonl` to the default branch, which activates `evidently-drift` comparisons on later runs.

#### `evidently-drift` — stage: `guardrail` · advisory (allow_failure) · output: `reports/evidently-drift.json`

**What this job is for**
This is the input-side data/feature drift check, complementing the eval-metric drift control (`model-drift-detection`, now in the live-scans pipeline). It uses Evidently's `DataDriftPreset` (PSI) to compare a committed reference snapshot of the dataset against the current one, adding text descriptors over prompt columns. On the very first run, before any reference is committed, it seeds one for `data-drift-baseline-commit` to commit.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs after `dataset-redact` and `eval-dataset-validate`.
2. Installs `evidently` and `pandas` and creates the reports and `evidence/evidently/` directories.
3. Clean-skips when no dataset is present: if none is found under `evidence/dataset-input`, writes `{"skipped":true,...}` and exits 0.
4. Otherwise runs `run_evidently_report.py` with the current dataset, the committed reference (`evals/dataset-reference.jsonl`), and output paths.
5. Seed-mode on first run: if no reference exists yet, it strips null/non-finite values and writes a seeded JSONL reference plus a `seeded:true` summary, then returns without a comparison.
6. When a reference exists, it builds Evidently `Dataset`/`DataDefinition` objects, runs `DataDriftPreset(method="psi")` (plus `TextEvals` if text columns are present), and saves the HTML report.
7. It walks the serialized snapshot for the drift verdict, writes the JSON summary, and exits non-zero if drift is detected (recorded but non-blocking).
8. If a reference was seeded, prints a hint to commit `dataset-reference.seed.jsonl`.

**Output file(s):** `reports/evidently-drift.json` — drift summary (skipped/seeded/pass/fail + drifted-column stats); `reports/dataset-reference.seed.jsonl` — first-run seeded reference (consumed by `data-drift-baseline-commit`); `evidence/evidently/` — directory with the human-readable `drift-report.html`.

### Stage 8 — Evidence

#### `evidence-summary` — stage: `evidence` · hard gate · output: `evidence/evidence-summary.md`

**What this job is for**
This is the pipeline's consolidating gate: it gathers reports from across the run (its `needs` lists ~25 upstream jobs) and renders a single evidence summary that records not just whether each artifact is present but what its verdict is. It is a hard gate so a missing required artifact stops the run. Its sibling `sign-evidence` depends on a superset of this collection set (every artifact-producing job) to hash-and-sign the whole bundle afterward.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise installs `jinja2` and creates the evidence directory.
2. Runs `write_ci_evidence_summary.py` against the reports directory — invoked WITHOUT `--enforce-verdicts`, so it runs in advisory-verdict mode (teeth deferred).
3. For the required artifact (`semgrep.json`) it reads a 3-state VERDICT — pass / fail / inert (present but no pass/fail signal) — and treats a missing file as `absent`. A missing required artifact is the only thing that hard-fails the gate.
4. For advisory artifacts (`markllm-results.json`, `evidently-drift.json`, `modelaudit-summary.json`, `great-expectations.json`, `dependency-track.json`, etc.) it records the same 3-state verdict but never gates on them — so a markllm disk/OOM hiccup that prevents the file being written can no longer cascade into a blocking `evidence-summary` failure.
5. Builds the `evidence-summary.md` tables (Artifact / Present / Verdict / Detail) plus a Gate section, and emits warnings to the log for failing verdicts.
6. Hard-fails (exit 1) only when a REQUIRED artifact is MISSING; a present-but-failing required verdict merely warns and would only block under `--enforce-verdicts`.
7. Bundles `dataset-reference.seed.jsonl` into the evidence dir if a drift reference was seeded this run (commit it to `evals/dataset-reference.jsonl` to activate drift detection).
8. Copies the committed `evals/model-baseline.json` into the evidence dir so the report records the exact model identity the run was pinned to.

**Output file(s):** `evidence/evidence-summary.md` — the rendered report (per-artifact presence + verdict tables and the gate decision); `evidence/dataset-reference.seed.jsonl` — present only when a drift reference was seeded; `evidence/model-baseline.json` — a copy of the approved model identity/variable manifest.

### Stage 9 — AI BOM

#### `ai-bom-assemble` — stage: `ai-bom` · hard gate · output: `sbom/aibom.cyclonedx.json`

**What this job is for**
This is the keystone assembly step: it merges every prior pipeline element — the software SBOM, ML model components (digests, signatures, ModelScan/ModelAudit/ClamAV verdicts, HuggingFace provenance metadata — repo, author, revision SHA, gated/private status), datasets, AI evaluation evidence, and parsed vulnerabilities — into one CycloneDX 1.6 AI BOM. It consumes artifacts from a large `needs` list because GitLab only downloads artifacts from jobs named in `needs`. Its JSON output is then schema-checked by `ai-bom-validate`, substance-checked by `ai-bom-content-gate`, and signed by `ai-bom-sign`.

**Step by step, in plain English**
1. Creates the `sbom/` output directory.
2. Stamps a build timestamp from `CI_PIPELINE_CREATED_AT` (falling back to `date` for local runs).
3. Runs `scripts/build_ai_bom.py`, pointing it at the SBOM, reports, evidence, and model directories, plus `--dataset-baseline evals/dataset-baseline.json` for dataset license/provenance.
4. The script gathers software components from the syft SBOM plus the MarkLLM watermark stack, kept as two disjoint counts (Fix #30a).
5. It builds machine-learning-model components from `model-digests.txt`, embeds the cosign `model.sig`/`dataset.sig` signatures as base64 `data:` URIs, and folds in scan verdicts, the populated `modelCard` (Fix #30b), and `gaips:model.verified` (Fix #32b).
6. It adds data components from the dataset digest and download/scan reports — stamping the reviewed `dataset-baseline.json` license (CycloneDX `licenses`) and `gaips:dataset.*` provenance onto each — and attaches AI-eval and data-quality evidence to the root component.
7. It parses the audit reports (pip-audit, lockfile-audit, markllm-deps-audit, grype, trivy) into a CycloneDX `vulnerabilities[]` array with `affects[].ref` per component (Fix #29), and records count properties.
8. Writes the assembled document to `sbom/aibom.cyclonedx.json`. Any missing input is skipped, never fatal, so the BOM degrades gracefully.

**Output file(s):** `sbom/aibom.cyclonedx.json` — the consolidated, canonical CycloneDX 1.6 AI BOM that every downstream ai-bom job operates on.

#### `ai-bom-validate` — stage: `ai-bom` · hard gate · output: `sbom/aibom.cyclonedx.xml`

**What this job is for**
This job proves the AI BOM produced by `ai-bom-assemble` is well-formed against the CycloneDX 1.6 schema, then renders it to XML — the byte form that `ai-bom-sign` signs. It runs in the .NET `cyclonedx-cli` image (no Python), so the substance checks live separately in `ai-bom-content-gate`. It is a FORM check only.

**Step by step, in plain English**
1. Runs in the `cyclonedx-cli` image with the entrypoint cleared (no Python or venv setup).
2. Hard-validates `sbom/aibom.cyclonedx.json` with `/cyclonedx validate --input-format json --input-version v1_6 --fail-on-errors`.
3. Calls the binary by absolute path because PATH may not include `/` once the entrypoint is cleared.
4. Converts the validated JSON to XML with `/cyclonedx convert ... --output-format xml --output-version v1_6`.
5. Writes the XML to `sbom/aibom.cyclonedx.xml` — the artifact `ai-bom-sign` signs.

**Output file(s):** `sbom/aibom.cyclonedx.xml` — the schema-valid XML rendering of the AI BOM, produced as the signing target for `ai-bom-sign`.

#### `ai-bom-content-gate` — stage: `ai-bom` · advisory (allow_failure) · output: none

**What this job is for**
Where `ai-bom-validate` proves the BOM is well-formed, this job asserts it is substantive — that it actually says something. It re-runs the same vulnerability parser `ai-bom-assemble` used (so it must pull the identical audit surface: `pip-audit`, `lockfile-audit`, `markllm-deps-audit`, `grype-scan`, `trivy-scan`) and checks that every model component is signed and verified. Advisory by default per the project's teeth-last posture; `--enforce` makes it a hard gate once the pipeline is otherwise green.

**Step by step, in plain English**
1. Runs `scripts/assert_ai_bom_content.py` against `sbom/aibom.cyclonedx.json` and the reports dir, in a Python image.
2. If the BOM is absent (assemble skipped), it prints a notice and exits cleanly.
3. Counts vulnerabilities the audit reports found using `build_ai_bom._vulnerabilities()` — the exact parser that populates the BOM — and flags an empty BOM `vulnerabilities[]` when audits found vulns.
4. For every `machine-learning-model` component, checks `gaips:signed=true` (error if not signed).
5. Checks `gaips:model.verified=true`, but only WARNS when unverified (signature-verification legitimately defers on unprotected refs).
6. Prints `::warning::`/`::error::` annotations and a pass/fail summary.
7. Without `--enforce` (the configured default), it always exits 0 even on substance gaps.

**Output file(s):** None — a pure gate. It gates (advisory) on vulnerability coverage and on every model component being signed (and ideally verified) in the BOM.

#### `ai-bom-sign` — stage: `ai-bom` · hard gate · output: `sbom/aibom.cyclonedx.xml`, `.sig`, `.pem`

**What this job is for**
This seals the AI BOM with a cosign keyless signature, making the auditor's keystone inventory tamper-evident. It signs the XML from `ai-bom-validate` using Sigstore keyless signing — Fulcio issues an identity-bound certificate, the signature is recorded in Rekor — driven by GitLab's `SIGSTORE_ID_TOKEN` (same mechanism as `model-sign`, `dataset-sign`, `sign-evidence`), so no signing-key variable is needed. Hardened to a hard gate: an unsigned BOM must not ship green. It skips cleanly only when there is genuinely no XML BOM (validate skipped).

**Step by step, in plain English**
1. Issues a per-job OIDC token via `id_tokens` with `aud: "sigstore"`.
2. Checks for `sbom/aibom.cyclonedx.xml`; if absent, prints a notice and exits 0 — the only clean-skip path.
3. Installs `curl` + CA certs (the `python:3.11-slim` image ships neither).
4. Downloads cosign at the pinned `COSIGN_VERSION`, verifies its SHA-256 against the checksums, and installs it.
5. If `SIGSTORE_ID_TOKEN` is unavailable (needs GitLab 15.7+), it errors out and exits 1 — it refuses to pass green with an unsigned BOM.
6. Runs `cosign sign-blob --yes` over the XML, emitting a detached signature and the Fulcio certificate.
7. Cosign reads the token automatically; the signature is logged to Rekor.

**Output file(s):** `sbom/aibom.cyclonedx.xml` (the signed bytes), `sbom/aibom.cyclonedx.sig` (detached keyless signature), `sbom/aibom.cyclonedx.pem` (Fulcio cert for offline `verify-blob`) — the trio `publish-signed-artifacts` ships for the Argo PreSync hook.

#### `dependency-track-upload` — stage: `ai-bom` · hard gate when configured · output: `reports/dependency-track.json`

**What this job is for**
This pushes the BOMs into Dependency-Track for continuous analysis, turning the point-in-time grype/trivy scan into ongoing monitoring against new CVEs and policy conditions over time. It uploads the syft SBOM as the parent project and the AI BOM nested beneath it. It is a hard gate on blocking policy violations, but skips cleanly when `DT_API_URL`/`DT_API_KEY` are unset, so the pipeline runs unchanged until a DT instance is wired in. Backing script: `scripts/dependency_track_upload.py`.

**Step by step, in plain English**
1. Installs `requests` and runs `scripts/dependency_track_upload.py`.
2. If `DT_API_URL`/`DT_API_KEY` are unset, writes a `skipped` report and exits 0.
3. POSTs the app SBOM with `autoCreate=true` to get a processing token, then POSTs the AI BOM nested under the app project (`parentName`/`parentVersion`).
4. Polls each BOM's processing token until DT finishes ingesting.
5. Resolves each uploaded project's UUID and pulls its findings and policy violations.
6. Evaluates the gate for every uploaded project — including the nested AI BOM, whose model/data components get no CVE match but ARE policy targets.
7. Writes the report and fails (exit 1) if any project could not be resolved, or if any non-suppressed violation matches `DT_FAIL_ON` (default `FAIL`); VEX-suppressed violations never gate.

**Output file(s):** `reports/dependency-track.json` — per-project findings, policy violations, the gate fail-states, and the skip reason when DT is unconfigured.

### Stage 10 — Deploy Prep

#### `image-sign` — stage: `deploy-prep` · advisory (allow_failure) · output: none

**What this job is for**
This is the image half of the sign→verify-at-deploy loop: it applies a cosign keyless signature to the already-built workload image so the `kyverno-verify-image-signatures` policy can admit a Pod only when its image carries a signature from this CI identity. Advisory because Kyverno is the real deploy-time gate. It skips cleanly when `IMAGE_REF` is unset, and `needs` `dependency-track-upload`.

**Step by step, in plain English**
1. If `IMAGE_REF` is empty, prints a skip notice and exits 0.
2. Installs `curl` + CA certs, then downloads and checksum-verifies cosign at `COSIGN_VERSION`.
3. Logs in to the registry using `IMAGE_REGISTRY_*` vars, falling back to GitLab's `CI_REGISTRY_*` creds.
4. Signs the image with `cosign sign --yes "${IMAGE_REF}"`, using the `id_tokens` `SIGSTORE_ID_TOKEN` for keyless Fulcio+Rekor signing.
5. Self-verifies that a signature from a gitlab/oauth2 issuer is present and Rekor-logged, using permissive identity/issuer regexps (strict matching is Kyverno's job).
6. Warns rather than fails if the post-sign verify doesn't match the issuer regexp.

**Output file(s):** None — no CI artifact; the signature is pushed to the registry alongside the image. It enables (but does not enforce) the Kyverno admission gate.

#### `publish-signed-artifacts` — stage: `deploy-prep` · advisory (allow_failure) · output: `evidence/publish/artifacts-manifest.txt`, `evidence/publish/publish-result.json`

**What this job is for**
This is the evidence half of the deploy loop: it uploads the signed artifacts the Argo CD PreSync hook fetches at deploy time to the GitLab Generic Package Registry, using the job's `CI_JOB_TOKEN`. It publishes the signed AI-BOM trio (`.xml`/`.sig`/`.pem` from `ai-bom-sign`), the signed dataset (normalised to `dataset.dat`/`.sig`/`.pem`), and the model bundle (from `model-sign` + `model-fixture-download`), and emits the `ARTIFACT_BASE_URL` pointer the PreSync ConfigMap must use. Advisory since a publish hiccup is re-publishable. It `needs` `ai-bom-sign`, `dataset-sign`, `model-sign`, and `model-fixture-download`.

**Step by step, in plain English**
1. If `CI_API_V4_URL`/`CI_PROJECT_ID` are unset, prints a notice and exits 0.
2. Stages the signed AI-BOM trio into `evidence/publish/`, recording each into `artifacts-manifest.txt`.
3. Stages the dataset, normalising it to `dataset.dat` (the cosign blob signature is over the bytes, not the name) plus its `.sig`/`.pem`.
4. Detects model weights and a `model.sig` in the model directory; if both present, tars a `model-bundle.tar` (verified by `model_signing verify` at deploy), otherwise skips it.
5. If nothing was staged, writes a `skipped` `publish-result.json` and exits 0.
6. Iterates the manifest, `curl --upload-file` PUTting each file to `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/${EVIDENCE_PACKAGE_NAME}/${EVIDENCE_PACKAGE_VERSION}/<file>` with the `JOB-TOKEN` header, counting uploads and failures.
7. Writes `publish-result.json` (status ok/partial/skipped, base URL, counts) and prints whether this is a canonical default-branch publish or a branch-scoped preview for `ARTIFACT_BASE_URL`.
8. Exits non-zero on any partial upload so a half-published set is not reported as success.

**Output file(s):** `evidence/publish/artifacts-manifest.txt` — the exact list of files published; `evidence/publish/publish-result.json` — upload status, base URL, and uploaded/failed counts (persisted `when: always`).

#### `metrics-normalize` — stage: `deploy-prep` · advisory (allow_failure) · output: `reports/operational-metrics.json`

**What this job is for**
This folds every CI signal into one normalised JSON document — answering "what do the artifacts say?" where `evidence-summary` answers "were they produced?". It reads the security, supply-chain, model-integrity, AI-eval, and data-quality reports plus the GitLab pipeline/job API into a single document the `pages` dashboard renders. It has no `needs`: as a final-stage job it inherits artifacts from all earlier stages by default. Advisory — reporting only.

**Step by step, in plain English**
1. Installs `requests` (only the GitLab-API block uses it) and creates the reports dir.
2. Runs `scripts/write_operational_metrics.py` over the reports, evidence, and sbom directories.
3. Parses each domain defensively; a missing or malformed input is recorded in `sources` as absent/error and omitted, never aborting.
4. Reads provenance from version-info, then calls the GitLab Pipelines/Jobs API when `GITLAB_API_TOKEN` (read_api) is set, skipping cleanly when it is not.
5. Marks each derived gate as enforcing vs advisory by reading each job's `allow_failure` from the job API.
6. Emits three views of the same data — grouped `sections`, a flat `metrics` map, and pass/fail/skip `gates` — plus pipeline metadata and the `sources` presence table.
7. Writes `reports/operational-metrics.json` and prints it; always exits 0.

**Output file(s):** `reports/operational-metrics.json` — the normalised, tool-agnostic operational-metrics document consumed by `pages`.

#### `pages` — stage: `deploy-prep` · advisory (allow_failure) · output: `public/`

**What this job is for**
This turns the normalised JSON from `metrics-normalize` into a self-contained static dashboard served by GitLab Pages. The job must be named `pages` and publish a `public/` directory for Pages to serve it. It `needs` `metrics-normalize`'s artifacts and is advisory — a dashboard must survive partial input and never gate the run.

**Step by step, in plain English**
1. Runs `scripts/render_metrics_dashboard.py` with `--metrics reports/operational-metrics.json` and `--out-dir public`.
2. Creates the `public/` output directory.
3. Reads the normalised document and renders a single `index.html` with inline CSS and SVG only — no external CDN or JavaScript — so it works under a strict CSP and survives offline archival.
4. Lays out four bands: a gate banner (passed/failed/skipped + per-signal ledger), pipeline/ops summary, section cards (security, supply chain, model integrity, AI eval, data), and a sources/metrics table.
5. Copies the metrics JSON into `public/` alongside the HTML for download.
6. Writes `public/index.html` and prints the output path.

**Output file(s):** `public/` — the directory GitLab Pages serves, containing `index.html` (the rendered dashboard) and a downloadable copy of `operational-metrics.json`.

### Stage 11 — Attest

#### `sign-evidence` — stage: `attest` · hard gate when `EVIDENCE_SIGNING_REQUIRED=true` (teeth-last) · output: `evidence/sign-evidence.json`, `.sig`, `.pem`

**What this job is for**
This is the terminal job of the whole pipeline: it seals the run by building a hash-manifest of every report, SBOM, and evidence artifact produced, then signs that manifest with cosign keyless (Fulcio + Rekor) and self-verifies it. Placed in the last `attest` stage, its `needs` list is a superset of `evidence-summary`'s collection set (it additionally pulls the artifact-producing jobs `evidence-summary` omits — `setup`, `lockfile-audit`, `model-fixture-download`, `dataset-sign`, `markllm-deps-audit`) plus all ai-bom and deploy-prep jobs, so the hash-manifest genuinely covers every artifact in the run — including the signed AI-BOM. Signing requires a `SIGSTORE_ID_TOKEN` (minted by `id_tokens`, GitLab 15.7+). **Enforcement is teeth-last (Fix #0/#23):** by default (`EVIDENCE_SIGNING_REQUIRED: "false"`) a missing token logs that the bundle is unsigned and exits green so development pipelines aren't blocked; set `EVIDENCE_SIGNING_REQUIRED=true` in production and a missing token becomes a **hard failure** — the run refuses to ship an unsigned seal. Independently, *when signing does run*, a failed self-verify always fails the job.

**Step by step, in plain English**
1. Installs `curl` + CA certs and creates the evidence directory.
2. An inline stdlib-only Python script walks the reports, SBOM, and evidence directories, SHA-256-hashing every file (excluding its own output trio) into an `artifacts[]` manifest with sizes.
3. Records model identity — the approved baseline SHA vs the digests `model-digest` recorded — and computes `digest_match`.
4. Reads `signature-verification.jsonl` to mark whether the model was actually VERIFIED (true/false/unknown with a reason), so the bundle is self-declaring.
5. Captures full pipeline provenance (id, URL, commit, ref, runner, signing job) and writes `evidence/sign-evidence.json`.
6. Downloads and checksum-verifies cosign at `COSIGN_VERSION`.
7. **If `SIGSTORE_ID_TOKEN` is set**, runs `cosign sign-blob --yes` over the manifest, emitting the detached `.sig` and Fulcio `.pem` (logged to Rekor). If the token is absent: when `EVIDENCE_SIGNING_REQUIRED=true` the job fails (exit 1) rather than ship an unsigned seal; otherwise it logs the bundle is unsigned and exits 0, and the `.sig`/`.pem` are not produced.
8. When signing ran, self-verifies with `cosign verify-blob` against the just-produced cert/signature; if self-verify fails, the job fails rather than shipping an unverified seal.

**Output file(s):** `evidence/sign-evidence.json` (the whole-run hash-manifest + provenance + model verdict, always produced), `evidence/sign-evidence.sig` (detached keyless signature) and `evidence/sign-evidence.pem` (Fulcio cert) — the latter two present only when a `SIGSTORE_ID_TOKEN` was available to sign. When signed and self-verified, this is the terminal seal over the entire run.
