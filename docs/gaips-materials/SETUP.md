# GAIPS CI Pipeline — End-to-End Setup Runbook

This is the full path from an empty GitLab project to a green run of
`ci/.gitlab-ci.yml` with **HCP Vault Dedicated** as the secrets backend, and on to
deploy-time signature verification. Each part is independent — the pipeline runs
green with **nothing** configured (every integration skips cleanly), so wire them
in as you need them.

**Conventions**
- `…` placeholders are yours to fill (`<gitlab-host>`, `<cluster>`, etc.).
- "CI/CD variable" = GitLab → **Settings → CI/CD → Variables**. Mark anything
  secret as **Masked** (and **Protected** if your default branch is protected).
- Secret paths shown as `secret/data/gaips/…` are KV v2 logical paths; on HCP Vault
  they resolve **inside** your namespace (Part A).

---

## Prerequisites

| Need | Why |
| --- | --- |
| GitLab **≥ 15.7** | `id_tokens:` OIDC issuance (Vault + Sigstore keyless). Older → `CI_JOB_JWT_V2` fallback (deprecated 16.x). |
| Terraform **≥ 1.6**, `vault` CLI | Provision Vault (Part A). |
| An **HCP Vault Dedicated** cluster (or self-managed Vault ≥ 1.12) | Secrets backend. Optional — see Part B3 to skip Vault entirely. |
| A GitLab runner | Default Docker runner is fine. |

---

# Part A — Provision the secrets backend (HCP Vault)

> Skip this whole part if you are **not** using Vault — see **Part B3** to supply
> secrets as plain CI/CD variables instead. The `vault-secrets` job falls back
> automatically when `VAULT_ADDR` is unset.

### A1. Create the cluster and namespace
1. In the HCP portal, create a **Vault Dedicated** cluster. Enable the **public
   endpoint** if your runners are GitLab.com SaaS runners; otherwise plan HVN
   peering so runners can reach it privately.
2. HCP gives you a root namespace `admin`. Either use it, or create a child:
   ```bash
   export VAULT_ADDR="https://<cluster>.vault.<region>.hashicorp.cloud:8200"
   export VAULT_TOKEN="<hcp-admin-token>"     # from the HCP portal
   export VAULT_NAMESPACE="admin"
   vault namespace create gaips                # → namespace "admin/gaips"
   export VAULT_NAMESPACE="admin/gaips"        # use the child from here on
   ```
   Self-managed OSS Vault: leave `VAULT_NAMESPACE` unset.

### A2. Confirm GitLab → Vault reachability
HCP Vault must reach your GitLab JWKS endpoint to validate CI tokens:
```bash
curl -fsS https://<gitlab-host>/-/jwks >/dev/null && echo "JWKS reachable"
```
If GitLab is private, expose `/-/jwks` to HCP (or use self-managed Vault inside
your network instead).

### A3. Fill in Terraform variables
In `deployment/vault/terraform/`, copy the example and edit it (it's git-ignored,
along with state):
```bash
cp terraform.tfvars.example terraform.tfvars
```
```hcl
vault_addr          = "https://<cluster>.vault.<region>.hashicorp.cloud:8200"
vault_namespace     = "admin/gaips"                      # "" for OSS Vault
gitlab_jwks_url     = "https://<gitlab-host>/-/jwks"
gitlab_issuer       = "https://<gitlab-host>"
gitlab_namespace    = "<your-group>"                     # bound_claims scope
gitlab_project_path = "<your-group>/<your-project>"
```

### A4. Apply
```bash
cd deployment/vault/terraform
export VAULT_ADDR VAULT_TOKEN VAULT_NAMESPACE
terraform init
terraform apply
```
This creates, **inside your namespace**:
- KV v2 mount at `secret/`
- JWT auth backend at `jwt/`, JWKS-configured for your GitLab
- Role **`gaips-ci`** (15-min tokens, bound to your group/project claims)
- Policy **`gaips-ci`** (read `…/ci/*` + `…/model-providers/*`, read/write
  `…/tamper-baseline/*`, deny `…/admin/*`)
- **Six stub CI secrets** (fixture values, `ignore_changes` so future applies
  won't clobber real ones).

### A5. Replace the stub secrets with real values
Terraform seeds fixtures; overwrite them (the CI reads the **`value`** field):
```bash
export VAULT_NAMESPACE="admin/gaips"
vault kv put secret/gaips/ci/model-endpoint        value="https://<your-model-api>/v1"
vault kv put secret/gaips/ci/model-signing-identity value="<fulcio-cert-SAN>"        # see note
vault kv put secret/gaips/ci/sigstore-oidc-issuer  value="https://<gitlab-host>"     # see note
vault kv put secret/gaips/ci/hf-token              value="<hf_token_or_blank>"
vault kv put secret/gaips/ci/gemini-api-key        value="<gemini_key_or_blank>"
vault kv put secret/gaips/ci/registry-token        value="<registry_token_or_blank>"
```
> **`model-signing-identity` / `sigstore-oidc-issuer`** are what
> `signature-verification` checks model signatures against. For GitLab keyless
> signing they are the Fulcio cert identity (your CI job's SAN, e.g.
> `https://<gitlab-host>/<group>/<project>//.gitlab-ci.yml@refs/heads/main`) and
> the OIDC issuer (`https://<gitlab-host>` or `https://oauth2.sigstore.dev/auth`).
> Confirm the exact values from a real `cosign`/`model_signing` signature before
> hardening the verify job.
>
> Do **not** create a `SIGSTORE_ID_TOKEN` CI/CD variable. GitLab mints it
> automatically from each signing job's `id_tokens:` block. The `model-sign` job
> passes that short-lived token to `model_signing` with `--identity_token`; if the
> log prints a browser OAuth URL, the token was not used.

### A6. (Optional) add the secrets Terraform does NOT seed
`dt-api-url` and `dt-api-key` are read by `vault-secrets` but not created by
Terraform (the job just logs a WARN and continues). Add them only if you use the
Dependency-Track integration (Part D3):
```bash
vault kv put secret/gaips/ci/dt-api-url value="https://dtrack.<your-host>"
vault kv put secret/gaips/ci/dt-api-key value="<dt-api-key>"
```

---

# Part B — GitLab project setup

### B1. Get the pipeline + materials into the repo
The CI file references scripts under `${CI_PROJECT_DIR}/docs/gaips-materials/`, so
the simplest layout is to keep the whole `docs/gaips-materials/` tree in your repo
and place the pipeline at the root:
```bash
cp docs/gaips-materials/ci/.gitlab-ci.yml .gitlab-ci.yml
git add .gitlab-ci.yml docs/gaips-materials
```
(If you instead flatten the materials, update `GAIPS_MATERIALS_DIR` at the top of
the CI file to wherever the `scripts/`, `evals/`, `mcp/`, `agent/` dirs land.)

### B2. Add the project files the jobs expect
All optional — absent files make their jobs skip — but for a full run, provide:

| Path | Used by | Notes |
| --- | --- | --- |
| `requirements.txt` | `setup`, `pip-audit`, `pkg-integrity`, `conda-pkg-verify` | Your app deps. Absent → install/audit steps skip. |
| `models/<name>/...` | `model-digest/sign`, `modelscan`, `modelaudit-scan`, `clamav-scan` | One subdir per model; weights in `.pkl/.pt/.safetensors/.gguf/.bin/.h5/.onnx`. ModelScan inspects unsafe serialization formats; ModelAudit adds static coverage for GGUF/GGML, safetensors, ONNX, manifests, archives, and related model artifacts, with broad optional dependencies installed for future formats and remote sources. Absent → signing skips. |
| `evals/promptfoo.yaml` | `promptfoo-eval` (live-scan pipeline) | Already shipped in materials. See [`ci/live-scans.md`](ci/live-scans.md). |
| `evals/eval-dataset.schema.json` | `eval-dataset-validate` | Already shipped. |
| `guardrails/baseline.json` | `guardrail-regression` (live-scan pipeline) | Regression baseline. See [`ci/live-scans.md`](ci/live-scans.md). |
| `evals/eval-baseline.json` | `model-drift-detection` (eval-metric drift unit; its gate lives in the live-scans pipeline, not here) | **Seeded on first run** — see Part C2. |

The collector/runner scripts (`build_ai_bom.py`, `run_guardrail_regression.py`,
`write_ci_evidence_summary.py`, `detect_model_drift.py`, etc.) already ship under
`docs/gaips-materials/scripts/`.

### B3. Set CI/CD variables
> Full variable catalog (every var, where it's set, what it gates, masking):
> [`ci/CI-VARIABLES.md`](ci/CI-VARIABLES.md).

**If using Vault (Part A):**

| Variable | Value | Masked? |
| --- | --- | --- |
| `VAULT_ADDR` | your HCP cluster URL | no |
| `VAULT_NAMESPACE` | `admin/gaips` (HCP) or blank (OSS) | no |

That's it — `vault-secrets` fetches the rest into later jobs via a short-lived
dotenv artifact.

**If NOT using Vault:** leave `VAULT_ADDR` unset and set the secrets directly as
CI/CD variables (mask the sensitive ones):
`MODEL_SIGNING_IDENTITY`, `SIGSTORE_OIDC_ISSUER`, `HF_TOKEN`, `GEMINI_API_KEY`,
`CI_REGISTRY_TOKEN`, plus `DT_API_URL` and `DT_API_KEY` if you use Dependency-Track.
(`MODEL_ENDPOINT` is **not** needed by this pipeline — it does no inference. It
belongs to the separate live-scan pipeline; see [`ci/live-scans.md`](ci/live-scans.md).)

For GitLab keyless model signing, first discover the exact verification inputs:

1. Push/run the one-shot `sigstore-identity-discover` CI job on `main`. The job
   signs a throwaway probe with the same GitLab `SIGSTORE_ID_TOKEN` flow used by
   `model-sign`.
2. Copy the two values printed in the job log:
   `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER`.
3. Add them as GitLab project CI/CD variables in **Settings → CI/CD → Variables**.
   Use type `Variable`, visibility `Visible`, environment scope `All`, masked off,
   hidden off, and variable expansion off. Protect them only if `main` is protected
   and you want verification limited to protected-branch pipelines.

These two values are public Sigstore identity strings, not secrets, but they are
exact-match verification inputs. Do not guess or hand-edit the identity string.

### B4. Confirm OIDC issuance
The Vault/Sigstore jobs declare `id_tokens:` blocks (GitLab ≥ 15.7). Nothing to
configure — but on older GitLab the jobs fall back to `CI_JOB_JWT_V2`; upgrade if
you see "id_tokens requires GitLab 15.7+".

---

# Part C — First pipeline run

### C1. Push and watch
```bash
git commit -m "ci: add GAIPS AI/ML security pipeline" && git push
```
On a clean repo with no models/datasets, expect:
- **Always-run hard gates pass:** `secret-detection`, `gitleaks-scan`,
  `clamav-scan`, `artifact-signing-gate`.
- **Everything model/dataset/integration-specific skips cleanly** (logs say so).
- `artifact-signing-gate` passes because `tamper-verification` seeds its baseline
  and writes `integrity.env`.

Native `secret-detection` is scoped to the current HEAD checkout. It still blocks
new committed secrets, while historic secret remediation remains a separate repo
hygiene task. During repeated CI debugging, enable GitLab auto-cancel redundant
pipelines so `interruptible: true` can stop superseded jobs before they burn
runner minutes.

If a hard gate fails, it's a real finding (a committed secret, an infected file, a
malformed dataset) — fix the input, not the gate.

### C2. Activate drift detection (seed the baseline)
The first run with eval metrics seeds `eval-baseline.seed.json`. To make
eval-metric drift detection meaningful on later runs, that seed must become
`evals/eval-baseline.json`. **Note:** the enforcing eval-metric drift gate lives in
the **live-scans** pipeline (where the eval metrics are produced) — the static main
pipeline no longer has a `drift-gate` (it was removed as vacuous; see `README.md`).
Two options:

- **Automatic:** create a Project Access Token (scope `write_repository`), set it
  as masked CI/CD variable **`GITLAB_PUSH_TOKEN`**, and run on the default branch
  — `model-baseline-commit` commits it for you (with `[skip ci]`).
- **Manual:** download the `eval-baseline.seed.json` artifact from
  `model-drift-detection` and commit it to `evals/eval-baseline.json`.

### C3. (Optional) seed the input-drift reference
Same pattern for `evidently-drift`: commit its `dataset-reference.seed.jsonl`
artifact to `evals/dataset-reference.jsonl` once you have a representative dataset.

---

# Part D — Wire optional integrations

Each is independent; set the variable(s) and the corresponding job activates.

| # | Integration | Set | Effect |
| --- | --- | --- | --- |
| D1 | **Dataset scan/redact/sign** | Optional: `DATASET_PACKAGE_NAME`, `DATASET_FILENAME` (+ `DATASET_EXPECTED_SHA256`) | Downloads from the Generic Package Registry when configured; otherwise uses the committed CI dataset fixture. Then AV+structural scan → secret/PII redaction → schema validate → cosign sign. |
| D2 | **HF model scan** | `HF_MODEL_IDS="org/model-a,org/model-b"` (+ `HF_TOKEN` for gated) | ClamAV + ModelScan each HF repo. |
| D3 | **Dependency-Track** | `DT_API_URL`, masked `DT_API_KEY` (+ `DT_FAIL_ON`, default `FAIL`) | Uploads SBOM + AI-BOM for continuous CVE/policy analysis; **hard policy gate**. |
| D4 | **Stable AI-BOM signer** | masked `CYCLONEDX_SIGNING_KEY` + `CYCLONEDX_SIGNING_PUB` (RSA PEM) | Signs the AI-BOM with a persistent identity instead of an ephemeral per-run key. |
| D5 | **DVC lineage** | `DVC_REMOTE_URL` (+ `.dvc/` in repo) | Verifies workspace vs pinned dataset/model versions. |

---

# Part E — Deploy-time verification (closes the sign→verify loop)

This runs **in-cluster, outside CI**. The `deploy-prep` stage produces the two
signed artifacts; the cluster verifies them.

### E1. Sign the workload image
1. Your app's own pipeline builds + pushes the container image.
2. Set CI/CD variable **`IMAGE_REF`** to that image (prefer a digest:
   `repo@sha256:…`). For cosign to push the signature, also set
   `IMAGE_REGISTRY_USER` / masked `IMAGE_REGISTRY_PASSWORD` (or rely on the
   GitLab-provided `CI_REGISTRY_*`).
3. `image-sign` applies a **Cosign keyless** signature (Fulcio identity = this
   CI job).

### E2. Publish the signed evidence
`publish-signed-artifacts` uploads the signed AI-BOM (+ public key), the signed
dataset, and (when present) the model bundle to the Generic Package Registry at:
```
${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/${EVIDENCE_PACKAGE_NAME}/${EVIDENCE_PACKAGE_VERSION}
```
Defaults: `EVIDENCE_PACKAGE_NAME=gaips-evidence`,
`EVIDENCE_PACKAGE_VERSION=${CI_COMMIT_REF_SLUG}`. Note the printed URL — it's the
`ARTIFACT_BASE_URL` the PreSync hook needs.

### E3. Kyverno — verify the image at admission
Apply `deployment/kubernetes/policies/kyverno-verify-image-signatures.yaml`.
- Replace the placeholder `subjectRegExp` / issuer with **your** CI signer
  identity and OIDC issuer.
- It ships as `validationFailureAction: Audit`. Once you confirm a signed digest
  is admitted in Audit mode, flip to **`Enforce`** to make it a hard gate.

### E4. Argo CD — verify blob signatures before sync
Apply `deployment/argocd/verify-signatures-presync-hook.yaml`.
- Set its `ARTIFACT_BASE_URL` (ConfigMap) to the package URL from E2.
- Provide the AI-BOM public key (`aibom-signing.pub`) to the hook via the
  `/keys` mount (a Secret/ConfigMap) so `cyclonedx verify all` can run.
- The hook verifies the AI-BOM (`cyclonedx verify all`), dataset
  (`cosign verify-blob`), and model bundle (`model_signing verify` — **not**
  cosign), and aborts the sync on any failure.

---

# Part F — Verification checklist

- [ ] `terraform apply` clean; `terraform output` shows the `gaips-ci` role +
      `secret/` mount in your namespace.
- [ ] `vault kv get -mount=secret gaips/ci/model-endpoint` returns your real value
      (with `VAULT_NAMESPACE` exported).
- [ ] Pipeline is green; `vault-secrets` log shows `N/8 secret(s) written`.
- [ ] `artifact-signing-gate` passed.
- [ ] `evals/eval-baseline.json` committed (eval-metric drift detection now active in the live-scans pipeline).
- [ ] (If signing) `signature-verification` passed against your real
      `MODEL_SIGNING_IDENTITY` / `SIGSTORE_OIDC_ISSUER`.
- [ ] (If deploying) `image-sign` + `publish-signed-artifacts` produced artifacts;
      Kyverno admits the signed image; Argo CD PreSync verifies and syncs.

> **Hardening after first green run:** pin `gitleaks/gitleaks` and `clamav/clamav`
> off `:latest` (see `ci/SBOM.md` remediation), generate
> `ci/requirements-ci.txt` via `pip-compile --generate-hashes` and switch jobs to
> it, and flip the staying soft gates (Great Expectations / Evidently data-drift) to
> `allow_failure: false` once baselines are stable. (The live-eval soft gates
> `garak`/`giskard` now live in the separate [live-scan pipeline](ci/live-scans.md).)
