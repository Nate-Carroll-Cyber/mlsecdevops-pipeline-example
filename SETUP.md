# MLSECDEVOPS GitLab Pipeline — End-to-End Setup Runbook

This is the full path from an empty GitLab project to a green run of the
repo-root `.gitlab-ci.yml` and on to deploy-time signature verification. By default,
secrets are supplied as **GitLab CI/CD variables**; **HCP Vault Dedicated** (Part A) is
an optional production-grade backend. Each part is independent — the pipeline runs
green with **nothing** configured (every integration skips cleanly), so wire them
in as you need them.

> **Secrets management.** HashiCorp Vault remains the recommended production-grade secrets management option for this pipeline, especially when centralized auditability, short-lived credentials, and policy-based secret access are required. To reduce operating costs for lab, demo, and early validation environments, this repository also supports standard GitLab CI/CD variables as a lower-cost fallback when `VAULT_ADDR` is not configured.

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
| Terraform **≥ 1.6**, `vault` CLI | **Optional** — only to provision Vault (Part A). Skip if using GitLab CI/CD variables. |
| An **HCP Vault Dedicated** cluster (or self-managed Vault ≥ 1.12) | Secrets backend. Optional — see Part B3 to skip Vault entirely. |
| A GitLab runner | Default Docker runner is fine. |

---

# Part A — (Optional) Provision HashiCorp Vault for production secrets

> **Optional, production-grade path.** Skip this whole part for lab/demo/early
> validation — see **Part B3** to supply secrets as plain GitLab CI/CD variables
> instead. The `vault-secrets` job falls back automatically when `VAULT_ADDR` is
> unset. Use Vault when you need centralized auditability, short-lived credentials,
> and policy-based secret access.

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
- **Five stub CI secrets** (fixture values, `ignore_changes` so future applies
  won't clobber real ones). The 6th path the CI reads, `secure-software-token`
  (`RL_TOKEN`), is **not** seeded by Terraform — add it in A5 only if you use ReversingLabs.

### A5. Replace the stub secrets with real values
Terraform seeds fixtures; overwrite them (the CI reads the **`value`** field):
```bash
export VAULT_NAMESPACE="admin/gaips"
vault kv put secret/gaips/ci/model-endpoint        value="https://<your-model-api>/v1"
vault kv put secret/gaips/ci/model-signing-identity value="<fulcio-cert-SAN>"        # see note
vault kv put secret/gaips/ci/sigstore-oidc-issuer  value="https://<gitlab-host>"     # see note
vault kv put secret/gaips/ci/hf-token              value="<hf_token_or_blank>"
vault kv put secret/gaips/ci/registry-token        value="<registry_token_or_blank>"
vault kv put secret/gaips/ci/secure-software-token value="<reversinglabs_token_or_blank>"  # RL_TOKEN; optional, not TF-seeded
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

---

# Part B — GitLab project setup

### B1. Get the pipeline + materials into the repo
This is a standalone pipeline repo: the materials (`scripts/`, `evals/`, `ci/`, …)
sit at the repo root and the pipeline is the root `.gitlab-ci.yml`. `GAIPS_MATERIALS_DIR`
at the top of the CI file is set to `${CI_PROJECT_DIR}` to match:
```bash
git add .gitlab-ci.yml scripts evals ci model-signing hugging-face-hub deployment
```
(If you instead nest these dirs under a subfolder, update `GAIPS_MATERIALS_DIR` at the
top of the CI file to wherever the `scripts/`, `evals/` dirs land.)

### B2. Add the project files the jobs expect
All optional — absent files make their jobs skip — but for a full run, provide:

| Path | Used by | Notes |
| --- | --- | --- |
| `requirements.txt` | `setup`, `pip-audit`, `pkg-integrity`, `conda-pkg-verify` | Your app deps. Absent → install/audit steps skip. |
| `models/<name>/...` | `model-digest/sign`, `modelscan`, `modelaudit-scan`, `clamav-scan` | One subdir per model; weights in `.pkl/.pt/.safetensors/.gguf/.bin/.h5/.onnx`. ModelScan inspects unsafe serialization formats; ModelAudit adds static coverage for GGUF/GGML, safetensors, ONNX, manifests, archives, and related model artifacts, with broad optional dependencies installed for future formats and remote sources. Absent → signing skips. |
| `evals/eval-dataset.schema.json` | `eval-dataset-validate` | Already shipped. |

The collector/runner scripts (`build_ai_bom.py`,
`write_ci_evidence_summary.py`, etc.) already ship under
`scripts/`.

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
`MODEL_SIGNING_IDENTITY`, `SIGSTORE_OIDC_ISSUER`, `HF_TOKEN`,
`CI_REGISTRY_TOKEN`.
(`MODEL_ENDPOINT` is **not** needed by this pipeline — it does no inference.)

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

#### Optional: enforcement switches (teeth-last — gates are OFF by default)

Several checks **run and report on every pipeline regardless of these variables** —
the variable only decides whether a failure **blocks** the pipeline. They default to
off so a fresh pipeline goes green; turn each on (as a GitLab CI/CD variable) once
you've seen it pass and want it to bite. You do **not** need to set any of these to
make the checks run.

| Variable | Default | Set to | Effect when enabled |
| --- | --- | --- | --- |
| `IMAGE_VERIFY_REQUIRE` | `""` (report-only) | `true` | `image-provenance-verify` **fails the pipeline** if a *signed* tool image (today: trivy) fails cosign verify. Verification itself always runs and writes `reports/image-provenance.json` either way; unsigned/digest-only images never gate. |
| `RL_FAIL_ON` | `""` (report-only) | `malware,tampering` | `secure-software-scan` **fails the pipeline** on a malware/tampering verdict (needs `RL_TOKEN`). |
| `EVIDENCE_SIGNING_REQUIRED` | `"false"` | `true` | `sign-evidence` **fails** if it can't sign the evidence bundle (no `SIGSTORE_ID_TOKEN`) instead of shipping it unsigned. |

> Recommended order: run the pipeline once and confirm the check passes in its
> report, *then* flip the corresponding switch to `true`.

### B4. Confirm OIDC issuance
The Vault/Sigstore jobs declare `id_tokens:` blocks (GitLab ≥ 15.7). Nothing to
configure — but on older GitLab the jobs fall back to `CI_JOB_JWT_V2`; upgrade if
you see "id_tokens requires GitLab 15.7+".

---

# Part C — First pipeline run

### C1. Push and watch
```bash
git commit -m "ci: add MLSECDEVOPS GitLab Pipeline AI/ML security pipeline" && git push
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

### C2. Seed the input-drift reference (auto on the default branch)
- **Automatic:** set masked CI/CD variable **`GITLAB_PUSH_TOKEN`** (Project Access
  Token, scope `write_repository`) and run on the default branch — once
  `evidently-drift` seeds a reference, `data-drift-baseline-commit` **sanitizes
  and commits** it to `evals/dataset-reference.jsonl` for you (with `[skip ci]`),
  activating data-drift detection (Fix #24b).
- **Manual:** download the `dataset-reference.seed.jsonl` artifact from
  `evidently-drift`, sanitize it, and commit it to `evals/dataset-reference.jsonl`.

---

# Part D — Wire optional integrations

Each is independent; set the variable(s) and the corresponding job activates.

| # | Integration | Set | Effect |
| --- | --- | --- | --- |
| D1 | **Dataset scan/redact/sign** | Optional: `DATASET_PACKAGE_NAME`, `DATASET_FILENAME` (+ `DATASET_EXPECTED_SHA256`) | Downloads from the Generic Package Registry when configured; otherwise uses the committed CI dataset fixture. Then AV+structural scan → secret/PII redaction → schema validate → cosign sign. |
| D2 | **HF provenance gate** | `HF_MODEL_IDS="org/model-a,org/model-b"` (+ `HF_TOKEN` for gated) | `model_info` provenance/policy check per HF repo (disabled/author/SHA-pin). |
| D3 | **AI-BOM signing** | _none_ — keyless via GitLab `SIGSTORE_ID_TOKEN` (Fix #25) | `ai-bom-sign` signs the AI-BOM with cosign keyless (Fulcio + Rekor), like the model/dataset. No signing-key variable to set. |
| D4 | **DVC lineage** | `DVC_REMOTE_URL` (+ `.dvc/` in repo); optional `DVC_REQUIRE` | Verifies workspace vs pinned dataset/model versions. Teeth-last: blank `DVC_REQUIRE` → drift is reported/warned but does not block; `DVC_REQUIRE=true` → a drift (or a non-verifiable run) **fails the pipeline** (same pattern as `RL_FAIL_ON`/`IMAGE_VERIFY_REQUIRE`). No effect until `.dvc/` exists. |

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
`publish-signed-artifacts` uploads the signed AI-BOM (+ its `.sig` + Fulcio
`.pem`), the signed dataset, and (when present) the model bundle to the Generic
Package Registry at:
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
- Set `MODEL_SIGNING_IDENTITY` / `SIGSTORE_OIDC_ISSUER` (ConfigMap) to your CI
  signer identity — all three artifacts now verify keyless against it, so **no
  public-key Secret is required** (Fix #25).
- The hook verifies the AI-BOM (`cosign verify-blob`), dataset
  (`cosign verify-blob`), and model bundle (`model_signing verify` — **not**
  cosign), and aborts the sync on any failure.

---

# Part F — Verification checklist

- [ ] `terraform apply` clean; `terraform output` shows the `gaips-ci` role +
      `secret/` mount in your namespace.
- [ ] `vault kv get -mount=secret gaips/ci/model-endpoint` returns your real value
      (with `VAULT_NAMESPACE` exported).
- [ ] Pipeline is green; `vault-secrets` log shows `N/6 secret(s) written`.
- [ ] `artifact-signing-gate` passed.
- [ ] (If signing) `signature-verification` passed against your real
      `MODEL_SIGNING_IDENTITY` / `SIGSTORE_OIDC_ISSUER`.
- [ ] (If deploying) `image-sign` + `publish-signed-artifacts` produced artifacts;
      Kyverno admits the signed image; Argo CD PreSync verifies and syncs.

> **Hardening after first green run:** pin `gitleaks/gitleaks` and `clamav/clamav`



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
This job centrally brokers secrets from HashiCorp Vault into the pipeline as CI variables (model endpoint, signing identity, Sigstore issuer, HF token, registry token, etc.) so later jobs don't each need their own Vault wiring. It runs in setup alongside `setup` and `model-manifest` and is a named dependency of jobs such as `trivy-scan`. It is advisory and degrades gracefully: if `VAULT_ADDR` is unset it skips cleanly and the pipeline falls back to GitLab CI/CD variables.

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

#### `semgrep-sast` — stage: `sast` · hard gate on ERROR-severity findings · output: `reports/semgrep.json` (+ GitLab SAST report)

**What this job is for**
This job runs static application security testing over the whole repository to catch insecure code patterns, feeding findings into the GitLab Security Dashboard and MR widget. It is one of several SAST-stage scanners (alongside `secret-detection`, `gitleaks-scan`, `pip-audit`, and the dependency/integrity jobs) and depends on `setup`. It runs inside the pinned `IMAGE_SEMGREP` image, which already ships Semgrep, so there is no unpinned `pip install`.

**Step by step, in plain English**
1. Uses the pinned Semgrep container and skips the Python venv bootstrap (the image is self-contained).
2. Creates the `reports/` directory.
3. Runs `semgrep scan --config=auto --severity ERROR --error` — a tokenless, rules-based scan (not the managed `semgrep ci` workflow that needs `SEMGREP_APP_TOKEN`). `--error` makes Semgrep exit `1` on findings (without it, `scan` exits `0` even with findings, so the job could never block); `--severity ERROR` scopes the run and the gate to ERROR-severity rules, so a high-severity finding fails the pipeline (`allow_failure` defaults false) while low-severity INFO/WARNING hints don't red the build. Widen with `--severity WARNING`, or drop `--severity` to block on any finding.
4. Outputs results as JSON to `reports/semgrep.json`, scanning the current directory.
5. Publishes that file both as a GitLab `sast` report and as a plain artifact.

**Output file(s):** `reports/semgrep.json` — Semgrep findings in JSON, registered as a GitLab SAST report.

> **Why ERROR-only gating (and not "report all, block on high").** `--severity` filters the *whole run*, so scoping the gate to ERROR also drops INFO/WARNING from the report. Semgrep OSS `scan` has no native "report every severity but fail only on high" mode — that capability lives in `semgrep ci` + AppSec-Platform Block-mode policies, or in custom JSON post-processing. Both were intentionally avoided to keep this a tokenless, dependency-free scan. The downstream `evidence-summary` verdict for `semgrep.json` is already error-severity-based, so ERROR-scoped gating is consistent end-to-end.

> **Future-proofing — pin the ruleset to make this scan reproducible and hermetic.** `--config=auto` fetches the rule set from semgrep.dev **at scan time** (this run pulled ~1,000 Community rules and ran 424 of them) and sends repository metadata to tailor them. That makes it the **one un-pinned, network-dependent input** in an otherwise digest-pinned pipeline: the *same commit* can yield *different findings* on different days as the registry changes, so `semgrep.json` isn't a stable evidence artifact, and rule selection depends on an external service. To close this, replace `--config=auto` with a **fixed** source — either a named registry pack (e.g. `--config=p/ci`, more stable than `auto` but still fetched over the network and not version-locked) or, for genuinely reproducible/offline scans, a **vendored rules directory committed into the repo** (e.g. `--config=./ci/semgrep-rules/`, pinned to a known [`semgrep-rules`](https://github.com/semgrep/semgrep-rules) commit). The vendored-directory option is the only one that is fully deterministic and sends nothing externally; its cost is committing and periodically refreshing the rule files. Not done here because it requires curating that rule set — tracked as a deliberate follow-up.

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
2. **Token pre-flight:** runs `secure_software_scan.py --check-token`, which validates the token against the **no-quota** account endpoint (`GET {base}/user/account`; default base is the free Community API `https://data.reversinglabs.com/api/oss/community/v2/free`, overridable via `RL_API_URL` for Portal accounts). A present-but-invalid/expired token **fails the job fast and cheap here** with a clear message instead of mid-scan; an unset token is a no-op (exit 0) so the scan step below skips cleanly. You can run the same command locally before pushing: `RL_TOKEN='<PAT>' python3 scripts/secure_software_scan.py --check-token`.
3. Discovers the dependency **groups** under `ci/`: for each `requirements-ci*.in` it scans the committed hash-pinned lock (`requirements-ci*.txt`) when present, else the `.in` source (the markllm group has no committed lock — its pins are read straight from `.in`). Clean-skips with a note if no group files are found.
4. Skips cleanly when `RL_TOKEN` is unset — the pipeline runs unchanged until a Community token is wired in. **Branch behavior:** because `RL_TOKEN` is a *protected* CI/CD variable, it injects only on protected refs (e.g. `main`). On an unprotected feature branch the token is absent, so this job clean-skips there and the full-surface scan only actually runs on the protected branch — the same protection-aware pattern as `signature-verification`. (Set `RL_REQUIRE_TOKEN=true` to turn a missing token into a hard failure once you intend it to run everywhere.)
5. Parses every group file into `pkg:pypi/<name>@<version>` purls, **merges and de-duplicates** the pins across files (the core/dataquality locks overlap heavily, so ~300 unique packages are scanned once, not the sum of the lockfiles; PEP 440 local segments like `torch 2.12.0+cpu` are normalized to the published release `2.12.0`), and submits them to `{base}/find/packages` **in batches of five** (the Community Free-plan per-request cap), retrying briefly on rate-limit (429).
6. For each package, matches the **pinned version** and reads *that version's* `assessments.malware.status` / `assessments.tampering.status` (the RL verdict; requires a non-`compact` response, which the script requests), its version-level `incidents`, and the package `all_malicious` rollup. The package's **lifetime** incident counts (e.g. a mature package's hundreds of historical yanks) are recorded as `package_incident_history` for context but **never gate** — only the pinned version's own signals do, to avoid false positives.
7. Applies the **enforcement switch** `RL_FAIL_ON`: blank → report-only (always exit 0, just publishes the report); `malware,tampering` → fail the pipeline on a hit. A 404 means the package isn't in the Community catalogue (typical for private/internal deps) and is recorded as `not_in_catalogue`, not a gate failure; other API errors (401/402/429/500) fail an enforced gate so it never passes green without evaluating.
8. Handles the **`warning`** verdict (the middle of RL's `pass`/`warning`/`fail` scale) honestly: a warning is always recorded in the report's `warnings[]` array and printed as a `WARN [...] — non-blocking` summary line, but by default does **not** block — only a `fail` (or an `all_malicious` rollup / a malware-or-removal incident on the pinned version) does. Set `RL_WARN_AS_FAIL` (e.g. `tampering` or `malware,tampering`) to promote a warning in those categories to a blocking hit. The gate's pass message distinguishes the two states — *"no malware/tampering verdicts"* only when there are genuinely none, vs. *"no BLOCKING verdicts; N non-blocking warning(s) surfaced"* when warnings exist — so a warning can never hide behind a green check.

**Output file(s):** `reports/secure-software.json` — per-dependency reputation/malware verdicts, packages not in the catalogue, operational errors, the gate result (`failing[]`), and surfaced non-blocking `warnings[]`.

> **Reading the report — `package_incident_history` is informational, not a gate input.** Each result carries a `package_incident_history` block (e.g. in a real run `scikit-learn` `malware:81`, `pyparsing` `malware:14`, `orjson` `malware:8`, `pillow` `malware:7`). These are **lifetime, all-version** incident tallies for the package across its entire history — *not* a verdict on the pinned version you actually use. They are recorded for context and **never gate** ([`secure_software_scan.py`](scripts/secure_software_scan.py) → `package_incident_history(...)`, "informational, never gates"); the gate fires only on the **pinned version's own** signals (`assessments.<category>.status=fail`, an `all_malicious` rollup, or a malware/removal incident on *that* version). So a package can show a large historical malware count and still pass correctly because the version in the lockfile is clean. Treat these numbers as decorative background, not as a finding.

> **Scope — PyPI by design.** This gate's mechanism is the Spectra Assure Community *purl-catalogue* search, so it reputation-rates **package-ecosystem** dependencies (PyPI here). The pipeline's other pulled third-party classes — container images, GitHub-release binaries (`cosign`/`gitleaks`), and model weights — aren't indexed by that catalogue and are vetted by *different* controls (image pinning + `trivy`/`grype`; `sha256sum` checksum verification; `modelscan`/`modelaudit`/`clamav` + signing). The full artifact-class → control map, including the explicit residual gaps, is in [`ci/SBOM.md`](ci/SBOM.md) → *Supply-Chain Control Coverage by Artifact Class*.

#### `image-provenance-verify` — stage: `sast` · gate driven by `IMAGE_VERIFY_REQUIRE` (report-only by default) · output: `reports/image-provenance.json`

**What this job is for**
The container-image counterpart to the dependency reputation gate. Digest-pinning the `IMAGE_*` references fixes **integrity** (we run the exact bytes recorded); this job adds **provenance** — `cosign verify` that those bytes were published by the genuine maintainer, the same control `image-sign` + Kyverno apply to the workload image, applied here to the CI tool/base images (the job execution environment, which sees the repo and injected secrets). It can only verify images whose publisher signs with Sigstore keyless; an OCI referrers-API probe established that **trivy** is the only image in this set carrying a discoverable signature, so the rest are covered by the digest pin alone and logged explicitly — never implied-covered.

**Step by step, in plain English**
1. Runs on the default Python image, `needs: []` (early, independent of the rest of `sast`). Installs a pinned, checksum-verified `cosign` **v3** (`COSIGN_VERIFY_VERSION`) — required because publishers now store image signatures as OCI-referrers `sigstore.bundle.v0.3` artifacts (no legacy `.sig` tag) that cosign 2.x reports as "no signatures found"; the signing jobs deliberately stay on `COSIGN_VERSION` 2.4.1 (a 2→3 bump there is an unrelated breaking-change risk).
2. **Verifies signed images:** runs `cosign verify` against each image that has a publisher-documented keyless identity — currently **trivy** (`--certificate-identity-regexp 'https://github.com/aquasecurity/trivy/.github/workflows/.+'`, issuer `https://token.actions.githubusercontent.com`, from the Aqua docs). New entries are added as identities are confirmed.
3. **Logs digest-pinned-only images:** anchore `syft`/`grype`, `semgrep`, `miniconda`, `cyclonedx-cli`, `clamav`, `gitleaks`, `python`, and the GitLab secrets image publish no discoverable cosign signature (verified by the referrers probe — including anchore's `ghcr.io` images), so each is printed as "digest-pinned only (no verifiable upstream signature)". This keeps the gap visible instead of hiding it behind a single green check.
4. Writes `reports/image-provenance.json` (`signed_checked`, `verify_failures`, `digest_pinned_only` counts).
5. Applies the **enforcement switch** `IMAGE_VERIFY_REQUIRE` (teeth-last, mirrors `RL_FAIL_ON`): blank → report-only (`exit 0` even on a verify failure); `true` → the job `exit 1`s if a *signed* image fails to verify. Unsigned/digest-only images never gate. Because the switch lives in the script's exit code, `allow_failure:false`. **You do not need to set this variable for verification to happen** — steps 2–4 always run and write the report on every pipeline; the switch only decides whether a *signed-image* verify **failure** blocks. Set it to `true` (a GitLab CI/CD variable) once you've confirmed a green run and want the gate to bite. See [`ci/CI-VARIABLES.md`](ci/CI-VARIABLES.md) and [`SETUP.md`](SETUP.md) → *enforcement switches*.

**Output file(s):** `reports/image-provenance.json` — counts of images verified, verify failures, and digest-pinned-only.

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
This job produces the project's Software Bill of Materials (SBOM) in CycloneDX format. It is the direct input that `grype-scan` consumes to find known vulnerabilities, so this sits at the head of the supply-chain evidence chain. Rather than a bare `dir:.` scan (which would find only the three packages in the root `requirements.txt`), it inventories a **scoped `sbom-input/` dir** assembled from the root manifest plus the freshly compiled hash-pinned locks from `lockfile-audit` — hence `needs: ["setup","lockfile-audit"]`. (`syft-spdx` is a separate format but currently still scans `dir:.`, so the two are not byte-for-byte the same inventory.)

**Step by step, in plain English**
1. Runs inside the pinned Syft container image (no Python, so venv bootstrap and pip cache are skipped).
2. Skips on the `[sigstore-discovery]` probe commit.
3. Depends on `setup` **and `lockfile-audit`** (it consumes the latter's freshly compiled `reports/requirements-ci*.txt` locks).
4. Creates the SBOM output dir and an `sbom-input/` dir, then copies in the root `requirements.txt` and the fresh CI locks — deliberately the freshly compiled locks, not the possibly-stale committed `ci/requirements-ci*.txt`.
5. Runs Syft over `dir:sbom-input` and writes CycloneDX JSON, passing `--source-name`/`--source-version` so the BOM's root component is identified (see callout below).
6. Runs Syft again to write the same inventory as CycloneDX XML (same source flags).
7. Uploads both files as artifacts. Advisory.

**Output file(s):** `sbom/sbom.cyclonedx.json`, `sbom/sbom.cyclonedx.xml` — the dependency inventory in CycloneDX JSON and XML; the JSON is the input for `grype-scan`.

> **Stamp the BOM's root component (`--source-name` / `--source-version`) — now applied.** On a `dir:` scan Syft has no inherent project identity, so it logs `no explicit name and version provided for directory source, deriving artifact ID from the given path (which is not ideal)` and falls back to the path (`sbom-input`). In CycloneDX that fallback becomes the BOM's top-level `metadata.component` — which is why earlier runs left it the anonymous `{"type":"file","name":"."}`. Since this document is meant to be *the* attestable root inventory (and the AI-BOM builds on it), both Syft invocations now pass `--source-name "mlsecdevops-pipeline" --source-version "${CI_COMMIT_SHA}"` (optionally `--source-supplier`), e.g. `syft dir:sbom-input --source-name "mlsecdevops-pipeline" --source-version "${CI_COMMIT_SHA}" -o cyclonedx-json=…`. The equivalent env vars (`SYFT_SOURCE_NAME` / `SYFT_SOURCE_VERSION`) work too. This silences the warning and makes the root component carry the project + commit instead of the path. `syft-spdx` now passes the same flags — but note it still scans `dir:.` (whole repo), so it picks up the **committed** `ci/requirements-ci*.txt` (and any other requirements files in the tree), whereas `syft-cyclonedx` scans the scoped `sbom-input/` with the **freshly compiled** locks. The two SBOMs therefore describe different inventories; only the CycloneDX one feeds `grype-scan`.

#### `syft-spdx` — stage: `sbom` · advisory (allow_failure) · output: `sbom/sbom.spdx.json`, `sbom/sbom.spdx`

**What this job is for**
This job produces an SPDX-format SBOM, giving downstream consumers and auditors an alternative, widely-recognized SBOM standard; some tools and compliance regimes expect SPDX rather than CycloneDX. Note it is **not** byte-for-byte the same inventory as `syft-cyclonedx`: this job scans `dir:.` (the whole repo, so it catalogs the *committed* `ci/requirements-ci*.txt` and any other requirements files), whereas `syft-cyclonedx` scans the scoped `sbom-input/` dir with the freshly compiled locks. Only the CycloneDX SBOM feeds `grype-scan`; this SPDX output is for interoperability/attestation.

**Step by step, in plain English**
1. Runs inside the pinned Syft container image (no Python).
2. Skips on the `[sigstore-discovery]` probe commit.
3. Waits only on `setup` (unlike `syft-cyclonedx`, it does **not** consume `lockfile-audit`'s fresh locks).
4. Creates the SBOM output directory.
5. Runs Syft over the whole repository (`dir:.`) and writes the inventory as SPDX JSON, passing `--source-name`/`--source-version` so the BOM's root document carries the project + commit (see the `syft-cyclonedx` callout above).
6. Runs Syft again to write the inventory in SPDX tag-value (plain text) form (same source flags).
7. Uploads both files as artifacts. Advisory.

**Output file(s):** `sbom/sbom.spdx.json`, `sbom/sbom.spdx` — the dependency inventory in SPDX JSON and SPDX tag-value formats.

#### `requirements-lock-check` — stage: `sbom` · drift gate (teeth-last via `LOCK_DRIFT_REQUIRE`) · default branch only · output: none

**What this job is for**
The committed hash-pinned CI locks (`ci/requirements-ci*.txt`) can drift stale as the `.in` inputs change, and recompiling them requires linux/py3.11 — so the check has to happen in CI, not on a contributor's machine. This job verifies those committed locks still match what `lockfile-audit` freshly compiles each run, so the locks that `secure-software-scan` and the resolve-reqs fallback consume can't silently lag behind reality. It is **detection only** — it deliberately does **not** write back to the repository: security-sensitive lockfiles change through a reviewed MR, never via a bot push token on a security pipeline.

> **Caveat — why the fix isn't automated (GitLab token limits).** Auto-committing the refreshed locks back to the default branch from CI would require a dedicated write-capable credential — a project or group access token scoped to `write_repository` and permitted to push to protected `main`. The number of access tokens available to this project is capped by its GitLab plan, and that allotment is already committed to other pipeline needs, so there is no spare token to dedicate to an automated lock push. Deliberately sharing one broad push credential across jobs would also widen the attack surface on a pipeline whose whole purpose is supply-chain integrity. The pipeline therefore treats lock drift as a **signal only**: `requirements-lock-check` makes it loud (a yellow allowed-failure warning, or a hard block under `LOCK_DRIFT_REQUIRE`), and **a human recompiles on linux/py3.11 and merges the refreshed `ci/requirements-ci*.txt` via a reviewed MR.**

**Step by step, in plain English**
1. Runs only on the default branch; skips on the `[sigstore-discovery]` probe commit.
2. Depends on `lockfile-audit` and reuses its freshly compiled `reports/requirements-ci*.txt` (does not recompile).
3. Compares each fresh lock against the committed `ci/requirements-ci*.txt`; if all match, exits 0.
4. On any drift (or a missing committed lock) it prints the exact `pip-compile --generate-hashes` command per drifted file and exits non-zero.
5. Teeth-last via `LOCK_DRIFT_REQUIRE`: blank (default) → the drift surfaces as a **yellow allowed-failure warning** that never blocks the build; `"true"` → drift is a **hard failure** that blocks.
6. A human then recompiles on linux/py3.11 and merges the refreshed `ci/requirements-ci*.txt` through a normal reviewed MR.

**Output file(s):** none — its effect is a pass/warn/fail signal; the fix lands as a reviewed commit of refreshed `ci/requirements-ci*.txt`.

#### `dvc-verify` — stage: `sbom` · gate on drift (teeth-last via `DVC_REQUIRE`) · output: `reports/dvc-status.json`

**What this job is for**
This job adds DVC (Data Version Control) lineage checking on top of the digest/signature/version-info provenance the rest of the pipeline records. Where the SBOM jobs inventory code dependencies, this verifies that large datasets and models in the workspace match their pinned DVC versions (and pulls them from a remote store when one is configured). It is opt-in and skips cleanly when the repo is not using DVC.

**Step by step, in plain English**
1. Skips on the `[sigstore-discovery]` probe commit; otherwise runs after `setup`.
2. Creates the reports output directory.
3. Checks for a `.dvc/` directory; if absent, writes a `{"skipped":true,...}` status file and exits 0 (DVC not initialized).
4. Installs a **pinned** `dvc==3.67.1` with only the backend extra the configured remote needs (`s3://`→`dvc[s3]`, `gs://`→`dvc[gs]`, `azure://`→`dvc[azure]`, `ssh://`→`dvc[ssh]`, none→base `dvc`) — not the heavy unpinned `dvc[all]`.
5. If `DVC_REMOTE_URL` is set, configures it and runs `dvc pull` to fetch the pinned versions; otherwise verifies tracked-vs-workspace status only.
6. Runs `dvc status --json` (empty = workspace matches the pinned hashes; populated = drift) and hands it to `scripts/dvc_verify.py`, which **decides the gate**. `dvc data status --granular --json` is also captured as richer context.
7. **The gate (teeth-last, `DVC_REQUIRE`):** drift from the pinned versions — or an inability to verify (pull/status failed) — is **reported and warned but does not block** by default. Set `DVC_REQUIRE=true` to make a drift or a non-verifiable run **fail the pipeline** (`allow_failure` is `false`, and `dvc-verify.py` owns the exit code — the same teeth-last pattern as `RL_FAIL_ON`/`IMAGE_VERIFY_REQUIRE`). Note: `dvc status` does **not** exit non-zero on drift, which is why the helper parses the JSON rather than trusting the exit code.

**Output file(s):** `reports/dvc-status.json` — normalized verdict (`in_sync` / `drift_count` / `evaluated`, or a skip note) that `evidence-summary` reads as a pass/fail/inert verdict; plus `dvc-status.raw.json` and `dvc-data-status.json` for raw context.

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

> **Refreshing an existing reference.** Normally step 3 below stops the job dead when a reference already exists — a fixed baseline is what gives drift meaning. To *deliberately* adopt the current dataset as the new normal, push a commit whose message contains **`[refresh-drift-reference]`**. That same flag makes `evidently-drift` re-seed from the current data (`--force-seed`), so a seed exists this run, and lets this job overwrite the committed reference (commit message `ci: refresh data-drift reference [skip ci]`). It is still two runs (replace, then compare) and still needs `GITLAB_PUSH_TOKEN`. **Caution:** refresh makes whatever the current data is the new baseline — only tag a run whose data you want treated as normal going forward.

**Step by step, in plain English**
1. Runs only on the default branch and never on `[sigstore-discovery]` commits; installs git in `before_script`.
2. Detects a refresh: sets an internal flag if the commit message contains `[refresh-drift-reference]`.
3. Exits cleanly if `evidently-drift` did not seed a reference this run (no seed file).
4. Exits cleanly if a reference already exists at `evals/dataset-reference.jsonl` **and** this is not a refresh — it never overwrites an existing reference unless `[refresh-drift-reference]` is set (in which case it logs that it is replacing it).
5. Exits cleanly if `GITLAB_PUSH_TOKEN` is not set, printing manual instructions instead.
6. Sanitizes the seed rather than raw-copying it: an inline Python script drops null and non-finite (NaN/inf) values per record and re-emits strict, key-sorted JSONL (the raw seed can carry NaN-filled columns); it aborts if sanitization yields zero records.
7. Stages the sanitized `evals/dataset-reference.jsonl`; if nothing changed (e.g. a refresh whose snapshot is byte-identical) it exits cleanly instead of erroring on an empty commit.
8. Configures a CI git identity and commits with a `[skip ci]` message — `ci: seed …` on first activation, `ci: refresh …` on a refresh.
9. Pushes to the default branch using `oauth2:${GITLAB_PUSH_TOKEN}` with `-o ci.skip` so it does not trigger a new pipeline.

**Output file(s):** None (no CI artifact). Its effect is a git commit of `evals/dataset-reference.jsonl` to the default branch, which activates (or, on refresh, updates) `evidently-drift` comparisons on later runs.

#### `evidently-drift` — stage: `guardrail` · advisory (allow_failure) · output: `reports/evidently-drift.json`

**What this job is for**
This is the input-side data/feature drift check. It uses Evidently's `DataDriftPreset` (PSI) to compare a committed reference snapshot of the dataset against the current one, adding text descriptors over prompt columns. On the very first run, before any reference is committed, it seeds one for `data-drift-baseline-commit` to commit.

**Step by step, in plain English**
1. Skips on `[sigstore-discovery]` commits; otherwise runs after `dataset-redact` and `eval-dataset-validate`.
2. Installs `evidently` and `pandas` and creates the reports and `evidence/evidently/` directories.
3. Clean-skips when no dataset is present: if none is found under `evidence/dataset-input`, writes `{"skipped":true,...}` and exits 0.
4. Otherwise runs `run_evidently_report.py` with the current dataset, the committed reference (`evals/dataset-reference.jsonl`), and output paths.
5. Seed-mode on first run: if no reference exists yet, it strips null/non-finite values and writes a seeded JSONL reference plus a `seeded:true` summary, then returns without a comparison.
6. When a reference exists, it builds Evidently `Dataset`/`DataDefinition` objects, runs `DataDriftPreset(method="psi")` (plus `TextEvals` if text columns are present), and saves the HTML report. If `--force-seed` is passed (a `[refresh-drift-reference]` run), it *also* re-writes the seed from the current dataset first — so the reference can be refreshed — while still comparing against the old reference so the run shows how far the data moved.
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
4. For advisory artifacts (`markllm-results.json`, `evidently-drift.json`, `modelaudit-summary.json`, `great-expectations.json`, etc.) it records the same 3-state verdict but never gates on them — so a markllm disk/OOM hiccup that prevents the file being written can no longer cascade into a blocking `evidence-summary` failure.
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

### Stage 10 — Deploy Prep

#### `image-sign` — stage: `deploy-prep` · advisory (allow_failure) · output: none

**What this job is for**
This is the image half of the sign→verify-at-deploy loop: it applies a cosign keyless signature to the already-built workload image so the `kyverno-verify-image-signatures` policy can admit a Pod only when its image carries a signature from this CI identity. Advisory because Kyverno is the real deploy-time gate. It skips cleanly when `IMAGE_REF` is unset, and `needs` `ai-bom-sign`.

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

> off `:latest` (see `ci/SBOM.md` remediation), generate
> `ci/requirements-ci.txt` via `pip-compile --generate-hashes` and switch jobs to
> it, and flip the staying soft gates (Great Expectations / Evidently data-drift) to
> `allow_failure: false` once baselines are stable.
