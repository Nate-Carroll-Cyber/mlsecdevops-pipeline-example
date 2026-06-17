# GAIPS Pipeline — Job Validation & Documentation

Walkthrough of the main (static) pipeline run on commit `6a48e525` (pipeline `2606572181`),
validating that each **successful** job performs real work (not exit-0 theater) and
documenting what that work is.

- **Pipeline:** `2606572181` @ `6a48e525` (`main`)
- **Config:** repo-root `.gitlab-ci.yml` (static supply-chain + model-integrity + drift; no inference)
- **Method:** for each job, the CI definition + backing script set the *expected* behavior;
  the real job log/artifacts from the run confirm it.
- **Legend:** ✅ real work confirmed · ⚠️ works but caveat · ❌ theater / broken

---

## ⚠️ SCOPE NOTE (applies to the whole pipeline)

The GitLab repo scanned by this pipeline contains **77 committed files — all GAIPS pipeline
materials**: 23 `.py` scripts, 16 `.json`, 15 `.md`, 11 `.yaml`/`.yml`, 5 `.tf`/`.hcl`
(Terraform), 7 other. The directory also holds some **untracked, unrelated project dirs**
(`services/`, `packages/`, `src/`, `ctf-frontend/`) with **0 committed files** — those are
not part of this pipeline and are never committed or scanned.

⇒ Every scan here (semgrep, gitleaks, secret-detection, pip-audit, SBOM, grype/trivy)
operates on the **GAIPS pipeline materials** (these 77 files), which is exactly its scope.
Stated here only so "all files" is unambiguous: it means the committed pipeline materials.

---

## setup  (stage: setup)  ✅

**Purpose:** Bootstrap the pipeline environment and capture build provenance.

**What it does:**
1. Writes a hardened `pip.conf` (PEP 476 — mandatory TLS cert verification) and builds an
   isolated virtualenv (`.python-secure` / `.resolve-reqs` anchors).
2. Resolves `requirements.txt` and `pip install`s the pinned deps
   (`pandas==2.3.3`, `requests==2.34.2`, `jinja2==3.1.6` + transitives).
3. Creates the three output dirs: `SBOM_DIR`, `EVIDENCE_DIR`, `REPORTS_DIR`.
4. Writes `evidence/pipeline.env` — `Pipeline <id> @ <short_sha>`.
5. Runs `scripts/write_version_info.py` → `evidence/version-info.json`: Git provenance
   (`commit`, `short_commit`, `branch`, `tag`, `describe`, `dirty`) + CI context block,
   `schema_version 1.0`. Git is authoritative, CI_* vars fill gaps.

**Run evidence (`2606572181`):**
- `Successfully installed … pandas-2.3.3 requests-2.34.2 jinja2-3.1.6 …` (real install)
- `pipeline.env`: `Pipeline 2606572181 @ 6a48e525`
- `version-info.json` artifact confirmed: `commit 6a48e525b949…717`, `short 6a48e525`,
  `branch main`, `ci.pipeline_id 2606572181`, `ci.job_id 14888933919` (matches the
  artifact-upload id in the log), correct `pipeline_url` / `project_path` / `server_url`.
- Both artifacts uploaded (201 Created).

**Verdict:** ✅ Real work — environment setup + accurate provenance capture. Captured
commit/branch/pipeline values are correct.

**Caveats / findings:**
- ⚠️ **`git` is not available in the job image (`python:3.11-slim` ships no `git`).** Every
  `_git()` call in `write_version_info.py` threw and was swallowed, so all provenance came
  from the `CI_*` env-var fallbacks (commit/short/branch are right *because of* that path).
  Side effects: `describe` can never be a real `git describe` (falls back to short SHA),
  and **`dirty` silently becomes `null`** — yet the human log printed `clean`, which is
  misleading (it means *unknown*, not *verified-clean*). If anyone relies on `dirty` to
  flag a tampered/dirty build tree, **it will never fire here.** Low severity (values are
  accurate); fix = install git in the image, or relabel `null` as "unknown" in the log.
- `allow_failure: true` — green status alone is not proof; artifact contents are.
- Skipped on commit messages containing `[sigstore-discovery]`.

---

## model-manifest  (stage: setup)  ✅

**Purpose:** Validate the approved-model manifest and propagate it to downstream jobs as
the default config. Fail-fast gate on model identity at the cheap setup stage.

**What it does:**
1. Runs `scripts/build_model_baseline.py` against `evals/model-baseline.json` (stdlib-only;
   `before_script: []`, `needs: []` — no venv, no git, runs in ~0s).
2. Validates the baseline: `model.path` + `model.sha256` present, sha256 is 64-hex,
   `variables` is a non-empty map of valid env keys/string values, **and** the model
   identity agrees with the vars it implies (`MODEL_FIXTURE_SHA256` == `model.sha256`,
   `MODEL_FIXTURE_PATH` == `model.path`). Any mismatch → `exit 1` (fails the pipeline early).
3. Emits the `variables` map as `model-baseline.env` and uploads it as a **dotenv** report,
   so downstream jobs inherit the 8 vars (dotenv overrides inline `variables:` defaults but
   is itself overridable by Project/manual CI variables — manifest is the default, not a lock).

**Run evidence (`2606572181`):**
- `Approved model: Qwen2.5-1.5B-Instruct (Q2_K GGUF)`, sha `5ede348e…865b3a`,
  `8 variable(s) in manifest`, `Wrote dotenv manifest → model-baseline.env`.
- dotenv `cat` shows all 8 vars; consistency guard passed (no `ERROR`).
- Uploaded as dotenv report (`id=14888933920`).

**Verdict:** ✅ Real work — genuine validation + the fail-fast identity gate. Value is the
guard (would block on a bad/inconsistent manifest), not the printing.

**Caveats:**
- Skipped on commit messages containing `[sigstore-discovery]`.
- Not `allow_failure` — a bad manifest correctly red-lines the whole pipeline.

---

## vault-secrets  (stage: setup)  ⚠️ (correct, but inert this run)

**Purpose:** Fetch CI secrets from HashiCorp Vault via GitLab OIDC JWT and inject them as a
dotenv, so secrets live in Vault rather than GitLab CI/CD variables. Optional layer.

**What it does (when `VAULT_ADDR` is set):**
1. `id_tokens.VAULT_ID_TOKEN` (aud `$CI_SERVER_URL`) → `hvac` client →
   `auth.jwt.jwt_login(role="gaips-ci")`.
2. Reads 8 KV-v2 secrets (mount `secret`): `MODEL_ENDPOINT`, `MODEL_SIGNING_IDENTITY`,
   `SIGSTORE_OIDC_ISSUER`, `HF_TOKEN`, `GEMINI_API_KEY`, `CI_REGISTRY_TOKEN`,
   `DT_API_URL`, `DT_API_KEY` → writes `.vault-env` dotenv (per-path WARN, not fail).
3. When `VAULT_ADDR` is unset: `touch .vault-env` (empty) and `exit 0` before any Vault call.

**Run evidence (`2606572181`):**
- `VAULT_ADDR not configured — Vault fetch skipped; pipeline uses CI/CD variables` — the
  skip branch ran; `pip install hvac` and the JWT/KV heredoc never executed.
- Empty `.vault-env` uploaded as dotenv (`id=14888933921`) — injects nothing.

**Verdict:** ✅ behaves correctly (graceful skip), but ⚠️ **did no real work this run.** The
JWT auth + 8-secret fetch path is **untested** until `VAULT_ADDR` is configured. This run's
secrets came from GitLab CI/CD variables, not Vault.

**Caveats:**
- `allow_failure: true` — a Vault outage won't block the pipeline (by design).
- 30-min artifact expiry on `.vault-env` (short-lived secret material).
- Skipped on commit messages containing `[sigstore-discovery]`.

---

## gitleaks-scan  (stage: sast)  🔴 FINDING — passes vacuously (no rules loaded)

**Intended purpose:** Scan the repo + git history for committed secrets with gitleaks;
fail the pipeline (`--exit-code=1`, `allow_failure: false`) if any are found.

**What it actually does this run:** Runs `gitleaks detect` against `${CI_PROJECT_DIR}`
with `--config .gitleaks.toml --redact`. Scanned 20 commits / ~458 KB in 95ms,
`no leaks found`, `gitleaks: 0 potential secret(s) detected`, exit 0. The scan executed —
but **with zero detection rules.**

**The bug:** `.gitleaks.toml` (committed) contains only an `[[allowlists]]` block — **no
`[[rules]]` and no `[extend] useDefault = true`.** Per gitleaks' own docs, supplying
`--config` with a custom file means *"default rules do not apply."* So gitleaks loads a
config with no rules, can match nothing, and **always exits 0 no matter what secrets are
present.** The log is visually identical to a healthy scan (no rule-count printed at info
level), so the green check is misleading — the insidious failure mode.

**Evidence:**
- gitleaks README (context7 `/gitleaks/gitleaks`): "define your own configuration, default
  rules do not apply"; `[extend] useDefault = true` is required to inherit the built-in ~150 rules.
- `git show HEAD:.gitleaks.toml` → allowlist only, no rules, no `[extend]`.
- Run: config loaded without error, 20 commits scanned, `no leaks found`, no rule count.

**Confidence:** High (docs + committed config + run behavior agree). NOT yet empirically
reproduced — `gitleaks` binary and Docker both unavailable locally; planting a non-allowlisted
secret and re-scanning with this exact config is the remaining confirmation.

**Fix (preserves the existing test-fixture allowlist):**
```toml
[extend]
useDefault = true
```

**Verdict:** 🔴 Does NOT perform its desired work — secret scanning is inert. The tight,
well-scoped allowlist is good; it's just guarding rules that never load.

**Coverage note:** This job was meant to cover full git **history** (20 commits). With it
inert, history is effectively unscanned — see `secret-detection`, which covers only the
current commit. Together they were the history+working-tree pair; the history half is down.

---

## secret-detection  (stage: sast)  ⚠️ (works, but buggy summary + history gap)

**Purpose:** GitLab's managed secret-detection analyzer — scan for committed secrets and
fail (`allow_failure: false`) on any `Critical` finding.

**What it does:**
1. `/analyzer run` → `registry.gitlab.com/security-products/secrets:4` (analyzer v4.5.19).
   **It wraps gitleaks with GitLab's *own bundled* ruleset** (real rules — independent of
   the broken repo `.gitleaks.toml`).
2. `GIT_DEPTH: 1` + `SECRET_DETECTION_HISTORIC_SCAN: false` → scans the **current commit
   only** (`1 commits scanned`).
3. Copies `gl-secret-detection-report.json` → `reports/secret-detection.json`; POSIX-shell
   summary (no python/jq in the image) greps for `"severity"` / `"Critical"`; exits 1 if
   critical > 0. Uploads both `secret_detection` report + archive.

**Run evidence (`2606572181`):** analyzer v4.5.19 ran, `1 commits scanned`, `no leaks
found`, report created and uploaded. Core scan = real work. ✅

**Findings:**
- ✅ **This is the real secret coverage** (GitLab's bundled gitleaks rules), unlike
  `gitleaks-scan`. But only the **current commit** — git history is not covered here, and
  `gitleaks-scan` (the history scanner) is inert, so **history is unscanned for secrets.**
- ⚠️ **Shell bug in the summary:** `FINDINGS=$(grep -c '"severity"' file || echo 0)`. On
  zero matches `grep -c` prints `0` *and* exits 1, so `|| echo 0` also fires → the var
  becomes `"0\n0"`. Result: garbled summary (`Secret detection: 0` / `0 finding(s)…` / `0`)
  and `sh: …: bad number` from `[ "${CRITICAL}" -gt 0 ]`. **Gate still holds** (when
  findings exist `grep -c` exits 0, no doubling, clean integer → `exit 1` fires; no
  fail-open), but it's fragile and looks broken. Fix: drop `|| echo 0`, or normalize with
  `| head -1` / `tr -d '\n'`.
- ⚠️ `grep -c '"severity"'` counts matching *lines*, not findings — under-counts if the
  report is single-line JSON (cosmetic; gate keys on `Critical`).

**Verdict:** ✅ core scan does real work (real ruleset, current commit, gate functional)
with ⚠️ a buggy summary and a history-coverage gap (compounded by `gitleaks-scan`).

---

## pip-audit  (stage: sast, `allow_failure: true`)  ✅

**Purpose:** Audit the Python dependency tree for known CVEs against OSV + PyPI Advisory +
GitHub Advisory DBs.

**What it does:** Installs `pip-audit` (2.10.1), installs `requirements.txt`, then
`pip-audit --requirement requirements.txt` in both JSON and CycloneDX-JSON formats →
`pip-audit.json` + `pip-audit-cyclonedx.json`. A Python snippet counts vulns/affected
packages and prints a summary.

**Run evidence (`2606572181`):**
- Full tree resolved + installed (pandas/numpy/requests/urllib3/certifi/jinja2/…).
- **`No known vulnerabilities found`** printed twice (JSON run + CycloneDX run) — pip-audit's
  own attestation that it queried the advisory DBs against the resolved set.
- `pip-audit: 0 vulnerability/ies across 0 package(s)`; both reports uploaded.

**Verdict:** ✅ Real work — advisory DBs are built into pip-audit and the tool explicitly
reports it checked, so `0 vulns` is a genuine clean result (not vacuous like gitleaks).
Validates the `requirements.txt` pinning rationale (pinned → resolver catalogs the tree).

**Caveats:**
- `allow_failure: true` — a real CVE would not block the pipeline (advisory only).
- `0 across 0 packages` = 0 vulns / 0 *affected* packages (not "0 scanned").

---

## pkg-integrity  (stage: sast, `allow_failure: true`)  ⚠️ (real work; 1 logic bug)

**Purpose:** Enforce/record package-install integrity — hash-pinned installs (PEP 476) and
an isolated-venv dependency-conflict check.

**What it does:**
1. `pip install pip-tools`. If `requirements.txt` has `--hash=` lines → install
   `--require-hashes` (`hash_mode=enforced`); else (this run) **warn branch**: `pip-compile
   --generate-hashes` → `requirements.hashed.txt`, `hash_mode=warn_generated`.
2. Throw-away venv (`/tmp/verify-venv`): install reqs, `pip check` (real conflict detection).
3. `pip list --format json` → `pkg-integrity-manifest.json` (+ `hash_mode`).

**Run evidence (`2606572181`):**
- `WARNING: requirements.txt lacks hashes — generating hashed lockfile` → `requirements.hashed.txt`
  generated; `hash_mode=warn_generated`; advisory line "Commit requirements.hashed.txt …".
- `No broken requirements found.` (pip check — real, passed). `Verified 4 package(s)`.

**Findings:**
- ⚠️ **Hashes generated but NOT enforced** (`warn_generated`): the install was not
  `--require-hashes`, so hash-pinning is advisory until `requirements.hashed.txt` is
  committed and CI is pinned to it. (Same "capability present, not wired" pattern as Vault.)
- 🔴 **Manifest documents the wrong environment (logic bug — CONFIRMED by artifact):**
  `pkg-integrity-manifest.json` `env` = exactly `{packaging, pip, setuptools, wheel}` (4 pkgs).
  That's not the verified tree (~13: pandas/requests/jinja2 + transitives) and **not even the
  job `.venv`** (which had pip-tools/build/click) — it's the **bare base Python tooling**. The
  `pip list` runs in a separate script line **after `deactivate`**, so it captured the base
  interpreter, not the `/tmp/verify-venv` that `pip check` validated. The manifest is therefore
  meaningless as an integrity record. The verification (`pip check`) itself is real; only the
  recorded artifact is wrong. Fix: write the manifest **before `deactivate`** (inside the
  verify-venv), or call the venv's interpreter explicitly.
- ✅ **`requirements.hashed.txt` is genuinely good:** complete pip-compile lockfile — all 13
  packages with full multi-platform sha256 hash sets and `# via` provenance. Commit-ready
  supply-chain hardening; just not enforced yet (`warn_generated`).
- ⚠️ **Nit:** the lockfile carries `--trusted-host pypi.org` / `--trusted-host
  files.pythonhosted.org`, which skip TLS verification for those hosts — mildly contradicts
  the "PEP 476, SSL mandatory" pip.conf hardening used elsewhere (low impact; hashes still
  verified).

**Verdict:** ⚠️ Core verification real (`pip check` genuine + passed; high-quality hashed
lockfile generated), but integrity *enforcement* is advisory-only and the manifest artifact
records the wrong environment (confirmed).

---

## conda-pkg-verify  (stage: sast, `allow_failure: true`)  ✅ (real; 2 minor caveats)

**Purpose:** Second-channel supply-chain verification — confirm the deps also resolve and
install cleanly from the vetted **conda-forge** channel (independent of PyPI).

**What it does:** Hardens conda (`ssl_verify true`, `channel_priority strict`, drop
`defaults`, add conda-forge) → `conda create -n ci-verify python=3.11` → `conda install
--file requirements.txt` from conda-forge (fallback NOTE if pip-only) → `pip check` →
exports `env-manifest.json` + `installed-packages.json` (both with **`-n ci-verify`**).

**Run evidence (`2606572181`):**
- All three pins + transitives **installed from conda-forge** (`pandas/numpy/requests/jinja2/…`
  all `conda-forge/…`). Fallback NOTE never fired — conda-forge carries these exact versions.
- `No broken requirements found.` (pip check). `conda-forge environment: 49 package(s)
  resolved` — real full-env count (22 base + 27 deps).
- 3 artifacts under `reports/conda/` uploaded.

**Verdict:** ✅ Real work — genuine independent-channel verification. Better-built than
`pkg-integrity`: manifests use `-n ci-verify` explicitly, so they capture the **correct**
env (no deactivate bug).

**Caveats / findings:**
- ⚠️ **`defaults` channel removal silently failed:** `conda config --remove channels defaults
  2>/dev/null || true` — `--show channels` lists `conda-forge` AND `defaults`, and
  `Channel "defaults" has the following notices` confirms it's still active. The `|| true`
  swallowed the failure. Low functional impact (strict priority + conda-forge first → all
  packages came from conda-forge), but the hardening intent (drop Anaconda `defaults` — vetting
  rigor + commercial ToS/licensing) is unmet. Fix: assert the channel list, or use
  `conda config --set channels conda-forge` / a clean condarc.
- ⚠️ **Deprecated image:** `continuumio/miniconda3:26.3.2` emits a deprecation warning
  (discontinued after 26.7.x; migrate to `anaconda/miniconda`). Maintenance item.

---

## semgrep-sast  (stage: sast, `allow_failure: true`)  ⚠️ (real scan; findings non-enforcing)

**Purpose:** Static application security testing — pattern-based scan of the tracked tree for
code-level security/quality issues, surfaced in the GitLab Security Dashboard via a `sast` report.

**What it does:** `pip install semgrep` into the `python:3.11-slim` job image → `mkdir reports`
→ `semgrep scan --config=auto --json --output reports/semgrep.json .`. Skips on
`[sigstore-discovery]` commits; otherwise `on_success` after `setup`. Uploads `semgrep.json`
twice — as a generic `archive` artifact and as a GitLab `sast` report.

**Run evidence (`6a48e525`, artifact id `14888933922`):**
- `semgrep 1.166.0` installed fresh from PyPI (69 MB wheel + ~60 deps; pip-cache restored/saved).
- `--config=auto` fetched **1059 Community rules** from the registry (tokenless), filtered to
  **424 rules actually run** across `<multilang>`/python/json/yaml/terraform.
- **3108 files** scanned, `~100.0%` parsed, **0 parse errors**. Skipped: 106 files >1 MB,
  5 `.semgrepignore` matches.
- `✅ Scan completed successfully. Findings: 4 (4 blocking)`. Report uploaded as both `archive`
  and `sast`. Job **succeeded** (green).

**Findings:**
- ⚠️ **SAST findings do not enforce anything** (the recurring "control present, not enforced"
  theme): `allow_failure: true` AND plain `semgrep scan` exits **0** even with findings (no
  `--error`). So the **4 findings** land in the dashboard artifact but the job is green and
  the pipeline never blocks. "4 blocking" is semgrep's own severity nomenclature (scan-mode
  default), **not** pipeline-blocking. SAST is advisory-only here.
- ⚠️ **`IMAGE_SEMGREP: "semgrep/semgrep:latest"` (var def line 53) is dead:** the job runs in
  `python:3.11-slim` and `pip install semgrep` instead of the official image that already ships
  semgrep. Result: a full 69 MB + ~60-dep install every run (only partly pip-cached) and an
  unused, misleading variable. Fix: either set `image: $IMAGE_SEMGREP` (pinned, not `:latest`)
  and drop the install, or remove the variable.
- ⚠️ **`--config=auto` is a network-egress dependency:** rules are pulled from semgrep.dev each
  run. If the registry is unreachable, combined with `allow_failure: true` the job goes green
  with **silent zero SAST coverage**. (The inline comment's "tokenless rules-based scan" claim
  is accurate.) Consider pinning a vendored ruleset for reproducibility/offline.
- ℹ️ **Reconciles the parked "3 ERRORs untriaged" note:** this run shows **0 parse errors /
  ~100% parsed**, so that note referred to *finding severity*, not parser ERRORs. The 4
  findings' contents live only in `reports/semgrep.json` (not echoed to the log), so triage
  needs the artifact — **parked** (per session scope: continue walkthrough only).

**Verdict:** ⚠️ Genuine multi-language SAST scan over the real tree (3108 files, 424 rules,
clean parse) — not theater. But it is **non-enforcing** (allow_failure + no `--error`), depends
on registry egress, and carries a dead `IMAGE_SEMGREP` var. Real signal, advisory delivery.

---

## syft-cyclonedx  (stage: sbom, `allow_failure: true`)  ⚠️ (real SBOM, but SHALLOW — top-level deps only)

**Purpose:** Generate a CycloneDX Software Bill of Materials (JSON + XML) of the repo tree —
the canonical SBOM that downstream `grype` consumes for vuln scanning and the AIBOM merge
references.

**What it does:** Runs in the pinned `anchore/syft:v1.45.1-debug` image (`IMAGE_SYFT`, line 55)
with `entrypoint: [""]` and `before_script: []` (syft image has no Python). `mkdir -p
${SBOM_DIR}` → `/syft dir:. -o cyclonedx-json=…/sbom.cyclonedx.json` → `/syft dir:. -o
cyclonedx-xml=…/sbom.cyclonedx.xml`. Skips on `[sigstore-discovery]` commits; otherwise
`on_success` after `setup`.

**Run evidence (`6a48e525`, artifact id `14888933928`):**
- Image pulled by digest `sha256:e7473bc…` — matches the pinned `v1.45.1-debug` tag. ✅
- `needs: ["setup"]` honored (setup artifact `14888933919` downloaded). Both syft invocations
  ran and exited clean.
- Both `sbom.cyclonedx.json` and `sbom.cyclonedx.xml` found (1 file each) and uploaded
  (`201 Created`), `expire_in: 30 days`. Job **succeeded** (green).

**Artifact verification (`sbom.cyclonedx.json`, inspected directly):**
- Valid CycloneDX **1.6** (`$schema` + `specVersion`), `serialNumber: urn:uuid:a0813ff6-…`,
  `metadata.tools.components[0]` = `syft 1.45.1` (author anchore), timestamp `2026-06-16T21:41:52Z`.
  Real, populated document — not an empty shell.
- **Components: 3 libraries + 1 file.** Libraries: `jinja2@3.1.6`, `pandas@2.3.3`,
  `requests@2.34.2` — **all** cataloged from `/requirements.txt` (`foundBy:
  python-package-cataloger`, `metadataType: python-pip-requirements-entry`). Plus the
  `requirements.txt` file component itself (SHA-1 + SHA-256). Each lib carries fuzzed `syft:cpe23`
  candidates for vuln matching (requests has a single curated CPE; jinja2/pandas get ~10 each).
- **Root component confirms the WARN:** `metadata.component` = `{type: file, name: "."}` — the
  root is literally named `"."`. No project identity at all.

**Caveats / findings:**
- 🟡 **SBOM is REAL but SHALLOW — top-level declared deps only, NO transitives** (most consequential).
  syft scanned the **source tree** (`dir:.`) and parsed `requirements.txt`, so the SBOM contains
  exactly the **3 direct pins** — there is **no installed/resolved dependency closure**: no `numpy`,
  `urllib3`, `certifi`, `charset-normalizer`, `idna`, `MarkupSafe`, `python-dateutil`, `pytz`, etc.
  Sharp cross-check: `conda-pkg-verify` (#9) resolved **49 packages** for these same pins; this SBOM
  has **3**. Because downstream `grype` consumes this exact file, **vuln scanning only covers the 3
  direct deps** — the entire transitive tree is invisible to it. Fix if real coverage is wanted:
  scan an **installed environment** (`syft dir:<venv>` or `syft python:installed`) after a
  `pip install`, not the bare source tree.
- ⚠️ **No explicit source name/version** — both runs emit `WARN no explicit name and version
  provided for directory source, deriving artifact ID from the given path`. Confirmed in the
  artifact: the root component name is `"."` (path-derived), non-stable across runners/forks.
  Cosmetic for grype (works off the package list, not the root name) but weakens SBOM provenance.
  Fix: `--source-name`/`--source-version` (or `SYFT_SOURCE_*`).
- ⚠️ **Useless pip cache round-trip** — the job restores `pip-main-protected` (~7819 files, ~1 min
  in this run) and re-saves it, but the syft image has no Python and `before_script` is empty, so
  nothing uses pip. Wasted wall-clock + bandwidth every run (same applies to `syft-spdx`). Fix:
  `cache: {}` to opt these sbom jobs out.
- ℹ️ **Downstream coupling is defensive:** `grype` (line 680) `needs: ["syft-cyclonedx"]` and
  guards with `if [ ! -f ${SBOM_DIR}/sbom.cyclonedx.json ]` (line 684), so the `allow_failure: true`
  here can't feed grype a missing file silently. Good. This run produced the JSON, so grype has input.

**Verdict:** ⚠️ Real work — syft genuinely walks `dir:.` and emits a valid, populated CycloneDX
JSON+XML SBOM (unlike the vacuous `gitleaks-scan`). BUT the output is **shallow**: scanning the
source tree yields only the **3 top-level `requirements.txt` pins, no transitive closure**, so the
grype vuln scan it feeds is blind to all indirect deps. Plus two hygiene items: path-derived root
component name (`"."`) and a no-op pip cache cycle. Non-enforcing (`allow_failure: true`).

---

## syft-spdx  (stage: sbom, `allow_failure: true`)  ⚠️ (real SBOM; SHALLOW — identical to syft-cyclonedx, SPDX format)

**Purpose:** Emit the same repo SBOM in **SPDX** format (JSON + tag-value) alongside the CycloneDX
pair — SPDX being the second standard SBOM lingua franca for downstream/compliance consumers.

**What it does:** Identical job shape to `syft-cyclonedx`: pinned `anchore/syft:v1.45.1-debug`
(`IMAGE_SYFT`), `entrypoint: [""]`, `before_script: []`, `needs: ["setup"]`, `allow_failure: true`,
skip-on-`[sigstore-discovery]`. `mkdir -p ${SBOM_DIR}` → `/syft dir:. -o
spdx-json=…/sbom.spdx.json` → `/syft dir:. -o spdx-tag-value=…/sbom.spdx`.

**Run evidence (`6a48e525`, artifact id `14888933929`):**
- Image pulled by the same digest `sha256:e7473bc…` — matches the pinned tag. ✅
- `needs: ["setup"]` honored (setup artifact `14888933919`). Both syft invocations ran, each
  emitting the **same `WARN no explicit name and version`** as `syft-cyclonedx`.
- Both `sbom.spdx.json` and `sbom.spdx` (tag-value) found (1 each) and uploaded (`201 Created`),
  `expire_in: 30 days` (inherited). Job **succeeded** (green).

**Caveats / findings (all inherited from `syft-cyclonedx` — same `syft dir:.` scan, different encoder):**
- 🟡 **Shallow — top-level deps only, no transitives.** Structurally guaranteed: it's the identical
  source-tree scan, so the SPDX doc carries the same **3 `requirements.txt` packages**
  (`jinja2`/`pandas`/`requests`) and no resolved closure. *(Not independently re-verified against the
  `sbom.spdx.json` artifact this round — but it's the same scan input/engine as #10, which was
  artifact-verified. Paste `sbom.spdx.json` if you want byte-level confirmation.)* Note: no job
  **consumes the SPDX content** — `grype` reads the **CycloneDX** JSON, and `evidence-summary`
  (which lists `syft-spdx` in `needs:`, line 2121) only bundles artifacts; `write_ci_evidence_summary.py`
  never references the `sbom.spdx*` files. So the SPDX pair is a compliance/interchange deliverable
  (collected into the evidence bundle), not a scan input.
- ⚠️ **Path-derived root name** — same `WARN`; SPDX document/root names derive from the build path.
  Fix: `--source-name`/`--source-version`.
- ⚠️ **No-op pip cache round-trip** (~1 min) — same as `syft-cyclonedx`; the syft image has no Python.
  Fix: `cache: {}`.

**Verdict:** ⚠️ Real SBOM generation in SPDX (JSON + tag-value), valid and uploaded — but a clone of
`syft-cyclonedx`'s behavior, inheriting its **shallowness** (3 declared deps, no transitive closure)
and both hygiene items. Unlike the CycloneDX output, its content has **no downstream consumer** (only
bundled into the evidence artifacts), so it's a standards-coverage deliverable only. Non-enforcing
(`allow_failure: true`).

---

## dvc-verify  (stage: sbom, `allow_failure: true`)  ⚠️ (correct, but INERT this run — verification path untested)

**Purpose:** Data-versioning integrity check — confirm DVC-tracked datasets/models match their pinned
versions (tracked-vs-workspace drift), optionally pulling from a DVC remote first. Advisory until DVC
is adopted.

**What it does:** Runs in `python:3.11-slim` with the shared secure-pip `before_script` (writes
`pip.conf` enforcing SSL verify, upgrades pip/setuptools/wheel, isolated venv). `mkdir -p
${REPORTS_DIR}` → **guard:** `if [ ! -d .dvc ]` → echo "not initialized", write
`{"skipped":true,"reason":"dvc not initialized"}` to `dvc-status.json`, `exit 0`. Only past the guard
does it `pip install "dvc[all]"`, optionally `dvc remote add` + `dvc pull` (if `DVC_REMOTE_URL` set),
then `dvc data status --granular --json` (fallback `dvc status --json`) → `dvc-status.json`.

**Run evidence (`6a48e525`, artifact id `14888933930`):**
- `.dvc/` **absent** → took the guard branch: logged "No .dvc/ directory — DVC not initialized;
  skipping." + the enablement hint, wrote the skip JSON, `exit 0`.
- **Artifact verified directly:** `dvc-status.json` = `{"skipped":true,"reason":"dvc not
  initialized"}` — exactly the literal the guard writes (line 645). Uploaded `201 Created`,
  `expire_in: 7 days`. Job **succeeded** (green).
- The `pip install "dvc[all]"` + `dvc data status` verification path **never executed** (short-circuited
  before it).

**Caveats / findings:**
- ⚠️ **Inert — the actual integrity check is untested** (same shape as `vault-secrets` #3). The job
  only proves its skip-guard works; the real DVC drift logic (`dvc data status --granular --json`,
  the remote pull, the fallback chain) has **never run**, so it's unvalidated. Activates only once
  `dvc init` + `dvc add` create `.dvc/` (and `DVC_REMOTE_URL` for the pull). Until then this is a
  no-op placeholder that always passes.
- ℹ️ **Unverified flags (deferred, not run):** `dvc data status --granular --json` — `--granular` and
  `--json` are real DVC subcommand flags, and the `|| dvc status --json || {note}` fallback is
  defensive, but none of this path executed, so it's not runtime-confirmed (worth checking against
  `dvc data status --help` when DVC is actually wired, given the project's fabricated-flag history).
- ℹ️ **Pointless venv setup on the skip path** — `before_script` upgrades pip/setuptools/wheel and the
  cache **uploaded** this run (~2 min) even though the job skips before installing dvc. Minor waste;
  could move the `.dvc` guard ahead of the heavy `before_script` or set `cache: {}`.

**Verdict:** ⚠️ Correct **skip behavior** with a real, schema-clean status artifact — but **inert**:
the dataset-integrity verification it exists to perform has not run (no `.dvc/`). Honest placeholder
(advisory `allow_failure: true`, clear enablement hint), not theater — but provides **zero data-
governance signal** until DVC is initialized. Closes the `sbom` stage (3/3).

---

## grype-scan  (stage: vuln-scan, `allow_failure: true`)  ⚠️ (real scanner + fresh DB, but NARROW coverage + non-enforcing)

**Purpose:** Vulnerability-scan the dependency set by feeding `syft-cyclonedx`'s CycloneDX SBOM to
Grype (Anchore's matcher) against its vuln DB, emitting `reports/grype.json`.

**What it does:** Runs in pinned `anchore/grype:v0.114.0-debug` (`IMAGE_GRYPE`), `entrypoint: [""]`,
`before_script: []`, `needs: ["syft-cyclonedx"]`. `mkdir -p ${REPORTS_DIR}` → **guard:** if
`sbom.cyclonedx.json` missing, write `{"skipped":true,...}` + `exit 0` → else `/grype
sbom:…/sbom.cyclonedx.json -o json > grype.json` and again `-o table` to console.

**Run evidence (`6a48e525`, artifact id `14888933931`):**
- Image pulled by digest `sha256:c7a0a7f…` = pinned `v0.114.0-debug`. ✅ `needs:[syft-cyclonedx]`
  honored (SBOM artifact `14888933928` downloaded); the file-exists guard (line 684) **passed**
  (SBOM present), so the scan ran for real (not the skip branch).
- **Vuln DB is real and fresh:** `grype.json` `db.status` = schema **v6.1.7**, built
  `2026-06-16T08:14:01Z` (same-day), pulled from `grype.anchore.io/databases`, `valid:true`, with
  the full provider set (nvd, github, govulndb, debian, ubuntu, rhel, alpine, wolfi, … all captured
  2026-06-16). grype `0.114.0`. So the matcher had current data.
- Result: `"matches": []` → console `No vulnerabilities found`. `grype.json` uploaded, `expire_in:
  7 days`. Job **succeeded** (green).

**Caveats / findings:**
- 🟡 **"No vulnerabilities found" is TRUE BUT NARROW — only the 3 direct deps were ever in scope**
  (the downstream consequence flagged at `syft-cyclonedx` #10, now confirmed). `grype.json`
  `source` = `{type:file, target:"."}` — it scanned the **shallow** CycloneDX SBOM (jinja2/pandas/
  requests only, **no transitive closure**). So 0 matches means "no known vulns in 3 top-level pins
  as of the 2026-06-16 DB," **not** "the dependency tree is clean." numpy/urllib3/certifi/idna/… were
  never assessed. Root fix is upstream: scan an installed env so the SBOM (hence grype) sees transitives.
- ⚠️ **Non-enforcing (the recurring theme), doubly so:** (a) **no `--fail-on`** flag on either
  `/grype` call → grype exits **0 regardless of severity** (confirmed in the artifact:
  `configuration.fail-on-severity:""`); (b) **`allow_failure: true`** on top. So even a CRITICAL in
  a scanned package would leave the job green and never block the pipeline. Findings are advisory-only.
- ℹ️ **Defensive guard works:** the `if [ ! -f sbom.cyclonedx.json ]` check (line 684) correctly
  gates on the upstream SBOM (which is `allow_failure:true`), writing a skip-JSON rather than erroring
  on a missing input. Didn't fire this run (SBOM present).

**Verdict:** ⚠️ Grype is a **real scanner with a current DB** doing genuine matching — not theater —
but its signal is **hollow in two ways**: coverage is capped at the **3 direct deps** in the shallow
SBOM (transitive-blind), and it is **non-enforcing** (no `--fail-on` + `allow_failure:true`), so a
green "No vulnerabilities found" overstates assurance. Fix the SBOM depth upstream and add
`--fail-on high` if vuln-gating is intended.

---

## trivy-scan  (stage: vuln-scan, `allow_failure: true`)  ⚠️ (real + broader than grype, but `:latest` image, scans CI cache, false-positive secret, non-enforcing)

**Purpose:** Second vuln scanner plus **secret + misconfig** detection over the filesystem, and a
**container-image** scan feeding the GitLab `container_scanning` dashboard. Complements grype.

**What it does:** Runs in `${IMAGE_TRIVY}`, `entrypoint: [""]`, `before_script: []`,
`needs: ["setup", "vault-secrets"]`. `mkdir -p ${REPORTS_DIR}` → `trivy fs . --format json --output
trivy-fs.json --exit-code 0` → `trivy fs . --format table` (console) → `trivy image --format json
--output trivy-image.json --exit-code 0 ${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA} 2>/dev/null || echo
'{"Results":[]}' > trivy-image.json`. `trivy-image.json` is published as a `container_scanning` report.

**Run evidence (`6a48e525`, artifact id `14888933932`):**
- trivy **0.71.1**, image `aquasec/trivy:latest` (digest `sha256:53570e6…`). Vuln DB downloaded
  fresh (`trivy-db:2`, 96 MB from `mirror.gcr.io`), vuln **and** secret scanning enabled. Real, current.
- `trivy fs .` is a **repository** scan (`ArtifactType: repository`, captures the git commit/author
  metadata). It found the same **`requirements.txt` → pip → jinja2/pandas/requests** set → **0
  vulnerabilities** (`WARN [pip] Unable to find python site-packages directory` confirms it read the
  **declared** requirements, not an installed tree — same shallowness as grype).
- **Secret scanner fired: 1 MEDIUM "JWT token"** in
  `.pip-cache/http-v2/8/0/6/3/6/…806366e41f…body` line 76. Both JSON + table + `container_scanning`
  report uploaded. Job **succeeded** (green).

**Caveats / findings:**
- 🔴 **`IMAGE_TRIVY: "aquasec/trivy:latest"` is UNPINNED** (var line 57) — unlike `syft`(v1.45.1) and
  `grype`(v0.114.0) which pin a version tag, trivy floats on the mutable `:latest` (resolved to
  0.71.1 here). Supply-chain regression + non-reproducible scans. **Corrects a stale note** that
  claimed trivy was pinned to v0.71.0 — it is not. Fix: pin `aquasec/trivy:0.71.1` (ideally by digest).
- 🟡 **The MEDIUM "secret" is a FALSE POSITIVE — and reveals trivy is scanning CI build cruft.** The
  hit is in `.pip-cache/http-v2/…body` — a **cached pip HTTP download** restored from the
  `pip-main-protected` GitLab cache, not project source. The flagged lines are the **canonical PyJWT
  docstring example** (`jwt.encode({"some":"payload"}, "secret", algorithm="HS256")` … `jwt.decode(…)`)
  — a library's own example token, not a leaked credential. Two problems: (a) the scan surface
  includes `.pip-cache/` (third-party vendored content → noise + irrelevant findings in security
  reports); (b) this specific finding should be ignored. Fix: `trivy fs . --skip-dirs .pip-cache`
  (and/or a `.trivyignore` / secret-scan config), or scan a clean checkout.
- ⚠️ **`trivy image` is vacuous (inert capability).** `${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA}` is never
  built/pushed in this static pipeline, so the image doesn't exist → `2>/dev/null || echo
  '{"Results":[]}'` fires → `trivy-image.json` = empty. It's still published as the GitLab
  `container_scanning` report, so the dashboard shows **container scanning "passing" with zero
  coverage** — a green control over nothing (same inert pattern as `vault-secrets`/`dvc-verify`).
- ⚠️ **Non-enforcing, triply:** both `trivy fs` calls + `trivy image` use `--exit-code 0`, and the
  job is `allow_failure: true`. So even the MEDIUM secret (and any future HIGH/CRITICAL vuln) leaves
  the job green. Advisory only.
- ℹ️ **Genuinely broader than grype on capability:** trivy adds **secret + misconfig scanning** that
  grype lacks — the JWT hit (false positive notwithstanding) proves the secret scanner runs. On the
  **vuln** axis, though, it's no deeper than grype (same 3 declared deps).

**Verdict:** ⚠️ Real, current scanner that **adds secret/misconfig coverage** beyond grype — but the
run exposes four issues: an **unpinned `:latest` image** (contradicting the "all images pinned" claim),
it **scans the restored `.pip-cache/`** and so emits a **false-positive** secret from a PyJWT doc
example, the **container scan is vacuous** (no image exists) yet still feeds a green `container_scanning`
report, and it's **non-enforcing** (`--exit-code 0` ×3 + `allow_failure`). Closes the `vuln-scan` stage
(2/2): both scanners are real but **shallow on vulns and non-blocking**.

---

## model-signing-install  (stage: model-integrity, `allow_failure: true`)  ⚠️ (executes correctly, but NEAR-REDUNDANT as wired — no gate, no artifact reuse)

**Purpose (as intended):** First job of the `model-integrity` stage — a **preflight/canary** that
installs and smoke-tests the model-signing toolchain (`model-signing`, `sigstore`, `cosign`) so a
broken/unavailable signing stack fails early before the real sign/verify jobs. **(In practice it
delivers almost none of this — see the "near-redundant" finding below.)**

**What it does:** `python:3.11-slim` + shared secure-pip `before_script`, `needs: ["setup"]`. Then:
(1) `pip install model-signing sigstore`; (2) `python -c "import model_signing; print(...)"` import
smoke test; (3) `apt-get install curl ca-certificates`; (4) downloads `cosign-linux-amd64` +
`cosign_checksums.txt` for `${COSIGN_VERSION}` from GitHub releases, **verifies the binary** via
`grep … | sha256sum --check --strict`, installs to `/usr/local/bin/cosign`, runs `cosign version`.

**Run evidence (`6a48e525`):**
- `model-signing 1.1.1` + `sigstore 4.3.0` installed cleanly from PyPI (full dep tree resolved,
  incl. `cryptography 48.0.1`, `tuf 7.0.0`, `securesystemslib 1.4.0`, `pyjwt 2.13.0`). Import smoke
  test printed `model-signing 1.1.1`. ✅
- **cosign integrity verified:** log shows `cosign-linux-amd64: OK` (the `sha256sum --check --strict`
  passed), then `cosign version` → **GitVersion v2.4.1** (clean tree, built 2024-10-03). So
  `COSIGN_VERSION` is **pinned** and the binary is **checksum-verified** before use. Job **succeeded**.

**Caveats / findings:**
- ✅ **Good supply-chain hygiene on cosign** (notable contrast to `trivy-scan` #14): cosign is pinned
  to a version (`v2.4.1`) **and** checksum-verified (`sha256sum --check --strict`) before install —
  the right pattern. Worth replicating for the `:latest` trivy image.
- 🔴 **NEAR-REDUNDANT as wired — it neither gates nor provisions, so its install is pure waste.** A
  canary earns its runtime by doing one of two things; this job does **neither**:
  - **It can't gate.** `allow_failure: true` → if the toolchain were unobtainable, the job goes red
    but the **pipeline proceeds anyway**. The "fail early" purpose is cosmetic (a UI dot, not a stop).
  - **It provisions nothing.** It has **no `artifacts:`**, and GitLab `needs:` only carries artifacts —
    so the toolchain (cosign binary + pip env) **dies with the container**. The 3 jobs that
    `needs: ["model-signing-install", …]` (`model-digest` 800, `modelscan` 1089, `clamav-scan` 1303)
    get only an **ordering edge** and **reinstall the stack from scratch** in their own containers.
    Verified: `model-digest` (line 803) re-runs `pip install model-signing` — and then **never uses
    it** (it only `sha256sum`s model files). cosign is independently re-downloaded + re-checksum-
    verified in ≥3 other jobs (lines 1820, 2208, 2484).
  - **Net:** the ~3-min install (pip + apt + cosign + ~2-min pip-cache re-upload) is thrown away.
    Residual value = one human-visible "the stack installs today" signal + surfacing a totally-broken
    PyPI/GitHub once. **🔴 This waste is no longer just theoretical — it broke CI at `modelaudit-scan`
    #22:** the repeated 37-pkg installs across #15/#17/#18/#19 keep re-uploading into the single shared
    `pip-main-protected` cache, which grew to **7857 files** and at #22 hit `FATAL … no space left on
    device` — the cache **failed to save**. So the redundant installs flagged here have now manifested
    as an actual cache-write failure (the job survived because cache-save is non-fatal, but writes are
    failing and downstream jobs may miss the cache). Collapsing these installs (provision once here) is
    therefore not just hygiene — it's the fix for a real disk-exhaustion failure. **Fix (pick one):**
    (a) drop `allow_failure` so the preflight actually gates;
    (b) publish the verified cosign binary / a built venv as an `artifacts:` the downstream jobs
    consume (collapse the 4–5 repeated installs into one); or (c) delete it and let `model-sign` —
    which installs the same stack — be the canary.
- ⚠️ **Signing libs are unpinned** — `pip install model-signing sigstore` (no `==`) took whatever PyPI
  served (1.1.1 / 4.3.0). For a security toolchain, pin these (or install from the hashed
  `requirements-ci` lockfile) for reproducibility. (cosign, the one that matters most, **is**
  pinned+verified — see below.)
- ✅ **The one thing it does right: cosign supply-chain hygiene** (notable contrast to `trivy-scan`
  #14's `:latest`): cosign is pinned to `v2.4.1` **and** checksum-verified (`sha256sum --check
  --strict` → `cosign-linux-amd64: OK`) before install. This is the correct pattern — and it's
  duplicated verbatim in the downstream jobs that actually use cosign, which is why this preflight
  copy is redundant.

**Verdict:** ⚠️ The job **executes correctly** — `model-signing`/`sigstore` install + import, and
cosign is genuinely pinned + checksum-verified (supply-chain done right, unlike the trivy image) — but
as wired it is **near-redundant**: it **can't gate** (`allow_failure: true`) and **provisions nothing**
(no `artifacts:`), so its `needs:` dependents reinstall the same stack (one of them, `model-digest`,
reinstalls a lib it never uses) and cosign is re-verified from scratch in ≥3 jobs. Its install is
discarded; it survives only as a UI canary. Make it gate, make it provision, or delete it. Opens the
`model-integrity` stage (1/20).

---

## model-fixture-download  (stage: model-integrity)  ✅ (genuinely downloads + integrity-verifies a real model, GATES, and provisions it for the stage)

**Purpose:** Second `model-integrity` job (`.gitlab-ci.yml:756`, `needs:[setup, model-manifest]`,
`before_script:[]` curl-only). Pulls the test model fixture from `MODEL_FIXTURE_URL` into
`${MODEL_DIR}/${MODEL_FIXTURE_PATH}`, verifies it against `MODEL_FIXTURE_SHA256` if set, and publishes
both the model tree and an evidence JSON as `artifacts:` for the rest of the stage to consume.

**Validated against the real log + artifact (run `2606572181 @ 6a48e525`, job `14888933934`):**
- ✅ **Did NOT skip — it did real work.** Contrary to the prior handoff's "may skip if `MODEL_FIXTURE_URL`
  unpopulated" watch-note, **`MODEL_FIXTURE_URL` is a committed default** (`.gitlab-ci.yml:46` →
  the HuggingFace `Qwen/Qwen2.5-1.5B-Instruct-GGUF` q2_k repo), so the `[ -z ... ]` skip branch (768–773)
  is **effectively dead** absent an explicit override-to-empty. The job took the download path.
- ✅ **Real download:** `curl -sSfL` fetched the GGUF; `wc -c` = **752,880,160 bytes (~718 MiB)** of actual
  model weights — not a placeholder.
- ✅ **Real integrity gate:** `sha256sum --check --strict` printed `…qwen2.5-1.5b-instruct-q2_k.gguf: OK`,
  and the computed hash equals the **committed pin** `5ede348e…865b3a` (`.gitlab-ci.yml:48`). Both
  `curl -sSfL` (fails on HTTP error) and `sha256sum --check` (non-zero on mismatch) are fatal, and the job
  has **no `allow_failure`** → a bad/corrupted/swapped download **fails the job and blocks the stage**.
  This is a genuine gate — the first hard-gating job reviewed in this stage (contrast `model-signing-install`).
- ✅ **Artifact cross-checks clean.** The final `cat` (== the uploaded `evidence/model-fixture-download.json`)
  is `{"skipped":false,"path":"models/qwen2.5-1.5b-instruct-gguf/qwen2.5-1.5b-instruct-q2_k.gguf",
  "sha256":"5ede348e…865b3a","bytes":752880160}` — `path` = `MODEL_FIXTURE_PATH` under `models/`,
  `sha256` = the pin, `bytes` = the downloaded size. Internally consistent and matches the log.
- ✅ **Genuinely provisions the stage** (unlike `model-signing-install`): `artifacts:` uploads
  `${MODEL_DIR}/` (3 entries) + the evidence JSON (`201 Created`, id `14888933934`, `expire_in: 1 day`).
  Downstream `needs:` consumers (`model-digest`, `modelscan`, `clamav-scan`, …) therefore receive a **real
  718 MiB GGUF to operate on** — they will **not** hit their "no model found" skip/warn branches.
  **Correction to the handoff watch-note:** the model IS populated this run; expect the rest of
  `model-integrity` to do real model work, not skip.

**Caveats (none correctness-fatal):**
- ⚠️ **TOFU pin, not an upstream-authenticated checksum.** `MODEL_FIXTURE_SHA256` is a constant baked into
  the repo (almost certainly recorded by downloading once). It protects against HF later serving a
  different/corrupted blob — legitimate pinning — but it is **trust-on-first-use**; it does not prove the
  weights are the model the vendor published (no sigstore/HF-signed digest in the chain here).
- ⚠️ **Network + re-download every run.** The 718 MiB GGUF is pulled fresh from HuggingFace on every
  pipeline (egress dependency; HF outage/404 hard-fails the job) and re-uploaded as a 1-day artifact each
  time — no cross-run caching of the model itself. Real bandwidth/storage cost, and an availability coupling.
- ⚠️ **No-op pip-cache restore (same hygiene bug as syft/dvc).** `before_script:[]` means no Python is used,
  yet the global `cache:` config still **restored** `pip-main-protected` (7819 files, **~1:02**) before a
  curl-only job. Wasted minute per run (save was skipped — "primary cache already exists"). Fix: `cache: {}`.
- Minor: `apt-get install curl ca-certificates` on `python:3.11-slim` every run (~12 s) — fine, but a
  curl-bearing base image would remove it.

**Verdict:** ✅ The strongest `model-integrity` job reviewed so far. It does exactly what it claims —
downloads a **real 718 MiB model**, **hard-verifies** it against a committed SHA-256 (and **gates** the
stage on failure, no `allow_failure`), and **provisions** the model as an artifact the rest of the stage
genuinely consumes. The skip branch is dead because the URL is a committed default. Caveats are hygiene
(no-op pip cache restore) and trust-model scope (TOFU pin, per-run HF re-download), not theater.
`model-integrity` 2/20.

---

## model-digest  (stage: model-integrity, `allow_failure: true`)  ⚠️ (correct digest + real hash-continuity, but installs a 37-pkg stack it NEVER uses, and only records — never verifies)

**Purpose:** Third `model-integrity` job (`.gitlab-ci.yml:794`, `needs:[model-signing-install, model-fixture-download]`,
`allow_failure: true`). Walks `${MODEL_DIR}` for model files by extension (`pkl pt safetensors bin h5 onnx gguf`)
and `sha256sum`s each into `evidence/model-digests.txt` (30-day artifact) — an integrity *inventory*.

**Validated against the real log + the pasted `model-digests.txt` (run `2606572181 @ 6a48e525`, job `14888933935`):**
- ✅ **Real digest, and the hash chains correctly.** It received the fixture artifact
  (`Downloading artifacts for model-fixture-download (14888933934)`), found the GGUF (`MODEL_FOUND=1`),
  and wrote one line: `…/qwen2.5-1.5b-instruct-q2_k.gguf  sha256:5ede348e…865b3a`. That SHA is **identical**
  to #16's committed pin (`.gitlab-ci.yml:48`) and the fixture's verified hash → the digest the
  evidence/BOM records is provably the same file `model-fixture-download` hard-verified. The pasted artifact
  matches the log's `cat` byte-for-byte. The `MODEL_FOUND=0` "no model files" warn branch was **not** taken
  (consistent with #16: the model is populated, not skipped).
- 🔴 **Installs an entire signing stack it never calls — confirms the handoff's prediction.** `script` runs
  `pip install model-signing` (`.gitlab-ci.yml:803`), pulling **37 packages** (model-signing 1.1.1, sigstore
  4.3.0, cryptography 48.0.1, pydantic, tuf, rich, …) — yet the digest loop (805–818) uses only `find` +
  `sha256sum` + `awk` (coreutils). **`model-signing` is never imported or invoked.** Pure dead weight: the
  install plus its **2:07 pip-cache re-upload** (cache grew 7819→7821 files, so unlike #16 it actually
  re-uploaded the shared `pip-main-protected` cache) are wasted. This job would run identically on bare
  `python:3.11-slim` with **no pip at all**. This is the concrete proof of the `model-signing-install` #15
  finding that its dependents reinstall the stack independently — and `model-digest` reinstalls a lib it
  doesn't use. **Fix:** delete the `pip install model-signing` line (and `cache:{}`); it's a no-op here.
- ⚠️ **Records, never verifies — and can't gate.** The job emits whatever hash it finds; it does **not**
  compare against the committed pin, a manifest, or a prior digest, so a tampered/swapped model would be
  faithfully *recorded*, not *caught*. Combined with `allow_failure: true`, it is **advisory inventory only**.
  (The real integrity enforcement lives in `model-fixture-download` #16's SHA gate and the later
  `signature-verification`/`tamper-verification` jobs — yet to review.) Acceptable as an evidence-generator,
  but it should not be mistaken for an integrity check.

  > **NOTE (design gap — user-flagged):** This job *should* **fail when its computed digest is compared
  > against the initial/committed baseline and differs.** As written there is **no baseline comparison at
  > all** — it recomputes and records the hash every run with nothing to diff against, so a swapped or
  > tampered model produces a green job with a quietly-changed digest. To make it a real tamper gate:
  > commit a baseline digest (e.g. an `evals/model-digests.baseline.txt`, or reuse `MODEL_FIXTURE_SHA256`
  > / the signed manifest) and have the job `diff` the freshly-computed `model-digests.txt` against it,
  > **exiting non-zero on any mismatch** (and dropping `allow_failure`). Until then the only thing pinning
  > the model's identity is #16's `MODEL_FIXTURE_SHA256` check — which is also a TOFU pin, not a baseline
  > the org reviewed. The baseline-vs-current comparison is the control this job is one line short of being.
  >
  > **UPDATE (resolved at #20):** the baseline comparison *does* exist downstream — `tamper-verification`
  > (#20, line 961, `needs:[model-digest]`) diffs this job's `model-digests.txt` against a persisted baseline
  > and `sys.exit(1)`s on mismatch with a unified diff. **So: `model-digest` is the producer,
  > `tamper-verification` is the comparator.** Caveat: #20 is `allow_failure: true` (non-gating) and
  > non-durable without Vault — see its entry — so the comparison runs but doesn't yet *enforce*.
  > `model-digest` itself remains record-only by design.
- ⚠️ **`model-signing` unpinned** (no `==`, took 1.1.1) — same reproducibility gap flagged on #15. Minor: pip
  backtracked cryptography 49.0.0→48.0.1 during resolution (resolver noise, not an error).

**Verdict:** ⚠️ The digest itself is real and chains cleanly to the verified fixture (good evidence), but the
job **installs a 37-package signing stack it never uses** (wasted install + 2-min cache re-upload — textbook
confirmation of the #15 redundancy finding) and is **record-only/non-gating** (`allow_failure`, no comparison),
so it generates inventory, not assurance. Strip the dead `pip install`. `model-integrity` 3/20.

---

## model-sign  (stage: model-integrity, `allow_failure: true`)  ✅ (real keyless signing happened — but non-gating, 3rd redundant stack install, and the sig is written INTO the signed model dir)

**Purpose:** Fourth `model-integrity` job (`.gitlab-ci.yml:824`, `needs:[model-digest, model-fixture-download,
vault-secrets]`). The **actual signing step** (vs the #15 `model-signing-install` preflight): for each
top-level subdir of `${MODEL_DIR}`, runs `python -m model_signing sign sigstore <dir> --identity_token
$SIGSTORE_ID_TOKEN --signature <dir>/model.sig` — Sigstore **keyless** signing via a per-job OIDC token
(`id_tokens.SIGSTORE_ID_TOKEN`, `aud: sigstore`).

**Validated against the real log (run `2606572181 @ 6a48e525`, job `14888933936`):**
- ✅ **Real signature, really produced.** Both `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER` logged
  `is configured` (the CI vars are set), the loop found the one model dir
  (`models/qwen2.5-1.5b-instruct-gguf`), and `model_signing sign sigstore` returned **`Signing succeeded`**.
  One `model.sig` was produced and uploaded (`201 Created`, id `14888933936`, glob `models/**/model.sig` →
  1 file). This is the first job in the stage that does genuine cryptographic work — a keyless Fulcio/Rekor
  signature over the model directory's manifest. The `SIG_COUNT=0` "no model directories" skip branch was
  not taken (consistent with #16: the model is populated).
- ✅ **Re: "the artifact looks like the model itself" (user note) — RESOLVED by inspecting the file: it is NOT
  the model.** The user located and `cat`'d the nested `models/qwen2.5-1.5b-instruct-gguf/model.sig`: it is a
  **~4 KB Sigstore bundle JSON** (`application/vnd.dev.sigstore.bundle.v0.3+json`), not the 718 MiB GGUF. The
  resemblance is purely the **co-located path** (`--signature ${model_dir}/model.sig` writes it inside the
  signed dir, and the artifact glob `models/**/model.sig` reproduces that path). Decoding `dsseEnvelope.payload`
  (base64 → in-toto Statement v1) confirms it signs a **manifest of hashes, not the bytes**:
  - `predicateType: https://model_signing/signature/v1.0`; `predicate.serialization.method: "files"`, `hash_type: "sha256"`.
  - **`resources[0]`** = `qwen2.5-1.5b-instruct-q2_k.gguf`, sha256
    **`5ede348e…865b3a`** — the **exact same digest** as #16's committed `MODEL_FIXTURE_SHA256` pin and #17's
    `model-digest` output. **The full integrity chain (fixture pin → digest inventory → signed manifest) is
    consistent** — the thing that got signed is provably the file that was downloaded and hash-verified.
  - `subject[0]` = the directory `qwen2.5-1.5b-instruct-gguf`, sha256 `d8b9c910…870b` (the aggregate manifest digest).
- ✅ **CORRECTION to the prior "footgun" worry — model-signing handles the co-located sig by design.** The
  decoded `predicate.serialization.ignore_paths` is `[".github", "model.sig", ".gitignore", ".gitattributes",
  ".git"]` — **`model.sig` is explicitly excluded from the manifest**, so writing the signature into the signed
  directory does NOT poison a re-sign (the tool ignores it). The earlier "write it outside the model tree"
  recommendation is therefore **cosmetic/optional, not a correctness issue**. (Verify-discipline note: I flagged
  this as a real smell before seeing the file; the artifact proves the tool already guards against it.)
- ✅ **Genuine keyless provenance (decoded from the Fulcio cert + Rekor entry in the bundle).** The signing
  identity (cert SAN / OIDC extensions) is `project_path:natecarrollfilms/counter-spy:ref_type:branch:ref:main`,
  OIDC issuer `https://gitlab.com`, build trigger commit `6a48e525b9498ad0a58c572752935 9c9368547170`
  (== this run's SHA), job `…/-/jobs/14888933936`, runner env `gitlab-hosted`, event `push`. The signature is
  recorded in the **public Rekor transparency log** (`rekor.sigstore.dev`, `logIndex 1842210748`,
  `integratedTime 1781646601`) and carries an **RFC3161 timestamp** from the sigstore TSA. This is a complete,
  verifiable keyless signature tied to this exact repo/branch/commit/job.

**Example — decoded `dsseEnvelope.payload` (the signed in-toto Statement) from this run's `model.sig`:**
```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "qwen2.5-1.5b-instruct-gguf",
                "digest": { "sha256": "d8b9c910ed4d429dd7f021c98e43f8eee308432197ccb04808fc1ea57acf870b" } }],
  "predicateType": "https://model_signing/signature/v1.0",
  "predicate": {
    "serialization": { "ignore_paths": [".github", "model.sig", ".gitignore", ".gitattributes", ".git"],
                       "method": "files", "hash_type": "sha256", "allow_symlinks": false },
    "resources": [{ "name": "qwen2.5-1.5b-instruct-q2_k.gguf",
                    "algorithm": "sha256",
                    "digest": "5ede348e91ce1e7a330926ec5b202c27b864d065149dc463257fde1f98865b3a" }]
  }
}
```
The `model.sig` file itself wraps this payload (base64) in a `dsseEnvelope` inside a Sigstore bundle
(`application/vnd.dev.sigstore.bundle.v0.3+json`) alongside the Fulcio `certificate`, the Rekor `tlogEntries`,
and the RFC3161 `timestampVerificationData`.
- 🔴 **Third redundant install of the 37-package signing stack.** `pip install model-signing sigstore`
  (`.gitlab-ci.yml:836`) re-installs the *exact* stack already installed by `model-signing-install` #15
  (discarded — no artifact) and again by `model-digest` #17 (which didn't even use it). That's now **~3–4
  full installs** of the same ~37 wheels across the stage, plus another **1:46 pip-cache re-upload** here.
  Unlike #17, this job **does** use the libs (it actually signs), so the install is justified *for this job* —
  but it underscores #15's core finding: the preflight provisions nothing, so every consumer pays the install
  again. Fix remains: have #15 publish the venv/cosign as `artifacts:`, or drop it.
- ⚠️ **Non-gating** (`allow_failure: true`, line 863). A signing *failure* would not block the pipeline —
  acceptable only because the hard gate is the downstream `signature-verification` (#19, line 927, no
  `allow_failure` per design): if signing silently failed, verification would fail loudly. But while `models/`
  is reliably populated (it is — #16), the comment "remove once models are present" applies: this could be
  promoted to gating now.
- ⚠️ **Signing libs unpinned** (`model-signing sigstore`, no `==`; resolved 1.1.1 / 4.3.0, cryptography
  backtracked 49.0.0→48.0.1) — same reproducibility gap as #15/#17. For the job that mints the trust anchor,
  pin them.

**Verdict:** ✅ Genuine — keyless Sigstore signing actually ran and produced a real ~4 KB `model.sig` over
the populated model dir (the stage's first true cryptographic operation, and the justified home of the
otherwise-redundant signing-stack install). The bundle was inspected: it's a Sigstore v0.3 in-toto manifest
whose signed resource digest **matches the #16 pin and #17 digest exactly** (`5ede348e…`), with a verifiable
GitLab-OIDC Fulcio identity, Rekor log entry, and RFC3161 timestamp — the "looks like the model" worry is
resolved (it's KB, not the GGUF) and the co-located-sig "footgun" is a non-issue (`model.sig` is in the
tool's `ignore_paths`). Remaining caveats are operational, not correctness: it **doesn't gate**
(`allow_failure: true` — leans on downstream `signature-verification` #19, which is where the signed manifest
becomes the real tamper baseline; could be promoted to gating now that `models/` is populated), it's the
**3rd reinstall** of the #15 signing stack (+1:46 cache re-upload), and the signing libs are **unpinned**.
`model-integrity` 4/20.

---

## signature-verification  (stage: model-integrity, NO `allow_failure`)  ✅ (genuine hard tamper gate — really verified the signed model against a pinned identity) ⚠️ but passes VACUOUSLY on zero signatures

**Purpose:** Fifth instantiated `model-integrity` job (`.gitlab-ci.yml:927`, `needs:[model-sign,
model-fixture-download, vault-secrets]`, **no `allow_failure` → the stage's first hard gate**). For each
`model.sig` under `${MODEL_DIR}`, runs `python -m model_signing verify sigstore <dir> --signature <sig>
--identity ${MODEL_SIGNING_IDENTITY} --identity_provider ${SIGSTORE_OIDC_ISSUER}` — recomputes the directory
manifest, checks it against the signed in-toto statement, verifies the Sigstore signature against the Fulcio
root, **and pins the cert identity/issuer**. This is where #18's signature becomes enforcement.

**Validated against the real log (run `2606572181 @ 6a48e525`, job in pipeline; "No artifacts" — correct, a
verifier emits none):**
- ✅ **Real verification, really enforced.** It pulled both the `model.sig` (from `model-sign` `14888933936`)
  and the model (from `model-fixture-download` `14888933934`), logged both `MODEL_SIGNING_IDENTITY is
  configured` + `SIGSTORE_OIDC_ISSUER is configured`, and printed `Verifying:
  …/models/qwen2.5-1.5b-instruct-gguf` → **`Verification succeeded`**. Because the job has **no
  `allow_failure`**, a manifest mismatch, bad signature, or wrong identity would have **failed the pipeline**.
  Crucially it passes `--identity`/`--identity_provider`, so it verifies *who* signed, not merely that *some*
  valid Sigstore signature exists — the recomputed model manifest had to match the signed `5ede348e…` digest
  AND the cert SAN had to match the configured identity. This is the keystone that makes the whole
  sign-chain (#15→#16→#17→#18) meaningful: the tamper baseline the user asked for on #17 is enforced **here**,
  cryptographically.
- ⚠️ **THE HOLE — it passes VACUOUSLY when no `model.sig` is present.** The loop is `SIG_COUNT=0; while … do …
  done < <(find "${MODEL_DIR}" -name model.sig …); if [ "${SIG_COUNT}" -eq 0 ]; then echo "… skipped"; fi`
  (lines 947–959). On **zero** signatures it just prints "signature verification skipped" and **exits 0** —
  no `exit 1`. Combined with upstream `model-sign` being `allow_failure: true` (#18), there is a real defeat
  path: **`model-sign` fails silently → 0 `model.sig` produced → this "hard gate" goes green having verified
  nothing.** A `models/` tree is guaranteed present (#16 hard-gates it), so the meaningful invariant —
  *"models exist ⇒ a verified signature must exist"* — is **not** enforced. **Fix:** make `SIG_COUNT -eq 0`
  a hard failure when `${MODEL_DIR}` contains model files (e.g. `exit 1`), and/or drop `allow_failure` on
  `model-sign` so a signing failure can't reach this job with an empty sig set. This run is fine (1 sig
  present, verified) — but the gate's *guarantee* is conditional on the very artifact it should require.
- ⚠️ **EXPLAINABILITY GAP (elevated) — the gate proves *that* it verified, not *what against*.** This is a
  security control whose entire value is the identity it pins, yet the log emits only `MODEL_SIGNING_IDENTITY
  is configured` / `SIGSTORE_OIDC_ISSUER is configured` / `Verification succeeded` — it **never prints the
  actual identity value, issuer, signed digest, or Rekor entry it matched**. Consequences:
  - **Unauditable from CI evidence.** A reviewer reading the pipeline log (or the 90-day evidence bundle)
    cannot tell *who* the model was required to be signed by. "Configured" only proves the var is non-empty,
    not that it holds the correct SAN (`project_path:natecarrollfilms/counter-spy:ref_type:branch:ref:main`
    per #18's cert). An over-broad or wrong-but-non-empty `MODEL_SIGNING_IDENTITY` (e.g. a loose regex, or a
    fork/attacker's identity pasted into the CI var) would still log `is configured` and `Verification
    succeeded` — the log looks identical whether the pin is tight or wide open.
  - **No diff-against-baseline visibility.** The recomputed manifest digest and the signed `5ede348e…` it was
    checked against never appear, so the one thing that makes this a tamper gate is invisible in the record.
  - **Fix (explainability):** echo the resolved values before verifying — `MODEL_SIGNING_IDENTITY` (full),
    `SIGSTORE_OIDC_ISSUER`, the model dir's recomputed sha256, and on success print the matched cert SAN +
    Rekor `logIndex` from the bundle. Emit them into the evidence artifact too, so verification is
    *reviewable*, not just *green*. (Mitigant, not a substitute: the tool fail-closes on a true mismatch and
    the job has no `allow_failure`, so a *wrong* identity fails loudly — but a *too-permissive* one passes
    silently and undetectably, which is exactly why the pinned value must be logged.)
- ⚠️ **4th reinstall of the 37-package signing stack** (`pip install model-signing sigstore`, line 935) +
  the longest cache re-upload yet (**2:17**). Same #15-rooted waste: the preflight provisions nothing, so
  every model-integrity job re-installs and re-uploads. (`model-signing`/`sigstore` unpinned, as before.)
  **🔴 Cumulative consequence:** these repeated re-uploads (#15/#17/#18 + this 2:17 one) bloated the shared
  `pip-main-protected` cache to **7857 files**, and three jobs later at `modelaudit-scan` #22 the cache
  save hit `FATAL … no space left on device` and **failed** — the disk-exhaustion endpoint of this
  recurring waste. See #22.

**Verdict:** ✅ The real deal — a genuine, identity-pinned, hard-gating Sigstore verification that actually
re-derived the model manifest and confirmed it against #18's signed `5ede348e…` statement (no `allow_failure`,
so it truly blocks on tamper). This is the enforcement the earlier jobs were building toward. ⚠️ One
substantive gap: it **passes vacuously on zero signatures**, and because `model-sign` is `allow_failure`, a
silent signing failure would sail through this gate green — so the gate guarantees "any signature present
verifies," not "the model is signed." And a second, elevated gap: **explainability** — the log proves *that*
it verified but never *what against* (no identity/issuer/digest/Rekor printed), so a too-permissive
`MODEL_SIGNING_IDENTITY` would pass silently and undetectably, and the verification is unauditable from CI
evidence. Close both (fail on 0 sigs when models exist; echo + persist the resolved identity/issuer/digest)
and it's airtight. Minor: 4th stack reinstall (+2:17 cache). `model-integrity` 5/20.

---

## tamper-verification  (stage: model-integrity, `allow_failure: true`)  ⚠️ (REAL baseline diff with good explainability — but non-gating, and non-durable without Vault)

**Purpose:** Sixth instantiated `model-integrity` job (`.gitlab-ci.yml:961`, `needs:[model-digest]`). **This is
the baseline comparison flagged as missing on `model-digest` #17** — it diffs the *current* model digests
(`model-digest`'s `model-digests.txt`) against a *persisted* baseline and fails on mismatch. Baseline source is
two-tier: **Vault KV** `secret/gaips/tamper-baseline/<project-slug>` (authoritative, when `VAULT_ADDR` set,
`hvac` + JWT `jwt_login(role=gaips-ci)`), else a **file baseline** persisted across pipelines via a fixed-key
GitLab cache `tamper-baseline-${CI_PROJECT_PATH_SLUG}`.

**Validated against the log + the job block + the pasted `model-digests-baseline.txt` (run `2606572181 @
6a48e525`, job `14888933938`):**
- ✅ **It genuinely diffs against a persisted baseline — and this run legitimately matched.** The log restored
  the **`tamper-baseline-…-protected` cache** (primary_modified `2026-06-16 18:35:35` — seeded by an *earlier*
  pipeline, proving cross-pipeline persistence worked here), pulled `model-digest`'s artifact, and ran the diff
  (`baseline.strip() != current.strip()` → `sys.exit(1)` + a `difflib.unified_diff`). Result: **`Tamper check
  PASSED — digests match baseline`**, and it wrote `integrity.env` (`tamper_check_passed=true`). The pasted
  `model-digests-baseline.txt` is the single line `…q2_k.gguf  sha256:5ede348e…865b3a` — identical to the
  current digest (#16 pin → #17 digest → this baseline all agree). **This is the control the user asked for on
  #17; it lives here, and it works mechanically.**
- ✅ **Good explainability (credit — contrast #19).** Unlike `signature-verification`, this job is *reviewable*:
  it logs which baseline path it took (`VAULT_ADDR not set — using cached file baseline …`), prints the
  PASS/FAIL verdict, and on mismatch emits a **full unified diff** (`fromfile=baseline tofile=current`) showing
  exactly which digest changed. It persists evidence (`integrity.env`, `model-digests-baseline.txt`, 90-day).
  This is the explainability standard the other gates should meet.
- 🔴 **NON-GATING — `allow_failure: true` (line 968) neuters the detection.** The script does `sys.exit(1)` on
  `TAMPER DETECTED`, but `allow_failure: true` means a detected tamper **does not block the pipeline** — it's a
  yellow warning; downstream jobs and deploy-prep proceed. So the diff is real but **advisory**: it can *see* a
  tampered model and *not stop it*. (Partial mitigant: `signature-verification` #19 hard-gates the *same* model
  intra-run, so a tampered model still fails #19 — but #20's **unique** contribution, cross-pipeline digest
  *drift* detection, is exactly the part rendered toothless by `allow_failure`.) **Fix:** drop `allow_failure`.
- 🔴 **Non-durable without Vault — the baseline silently re-seeds (and `VAULT_ADDR` is unset this run).** In
  file-fallback mode (the mode this run used) the baseline lives in a **best-effort GitLab cache**. If that
  cache is evicted/expired (routine for CI caches), the next run hits `baseline = current` (lines 1052–1054)
  and **silently re-seeds to whatever the current — possibly tampered — digest is**, logging only "No file
  baseline — seeding from current digests." The job's own comment + log admit this ("best-effort; set
  `VAULT_ADDR` for durable cross-pipeline detection"). The authoritative Vault path (`jwt_login` role
  `gaips-ci`, KV read/seed) **never executed** (`VAULT_ADDR` unset) — same inert pattern as `vault-secrets` #3
  / `dvc-verify` #12, so the durable mode is **unvalidated**. Net this run: tamper detection rests on a mutable,
  evict-on-a-whim cache, with a self-reseeding fallback, behind `allow_failure`.
- ⚠️ **Empty-placeholder reseed path** (lines 1056–1058): if the baseline only recorded `WARNING: No model
  files found …` and current has a real digest, it reseeds `baseline = current`. Sensible for the
  empty-`models/` bootstrap, but it is another silent accept-and-adopt branch — fine while #16 guarantees a
  populated `models/`, worth knowing it exists.
- ⚠️ Minor: `pip install hvac` runs even when `VAULT_ADDR` is unset (small waste); the pip-cache restore/save
  (~1:30) is *legitimate* here (this job actually uses Python), unlike the curl-only #16.

**Verdict:** ⚠️ The honest answer to the #17 baseline gap: a **real digest-vs-baseline diff** with a proper
unified-diff on mismatch and persisted evidence — **good comparison logic and good explainability**, and it
matched legitimately this run (baseline `5ede348e…` == current). **But as wired it neither reliably detects nor
enforces:** `allow_failure: true` means a detected tamper **won't block** the pipeline, and with `VAULT_ADDR`
unset the baseline sits in a **best-effort cache that silently re-seeds on eviction**, with the durable Vault
path untested. The model is still protected intra-run by #19's hard signature gate; what's lost to
`allow_failure`+no-Vault is precisely #20's unique job — **durable, enforced cross-pipeline drift detection**.
Fixes: drop `allow_failure`; set `VAULT_ADDR` so the baseline is authoritative and runner-independent.
`model-integrity` 6/20.

---

## modelscan  (stage: model-integrity, `allow_failure: true`)  🔴 (INERT for this pipeline — the only model is a GGUF, which the job excludes from scanning → 0 files scanned, zero malware signal)

**Purpose:** Seventh instantiated `model-integrity` job (`.gitlab-ci.yml:1083`, `needs:[model-signing-install,
model-fixture-download]`). Runs **Protect AI `modelscan`** to detect malicious code / unsafe deserialization
(pickle opcodes, embedded `os.system`, etc.) in serialized model files.

> **⚠️ CAVEAT — supported file types for this phase (modelscan).** The job only scans files matching its
> `find` filter, i.e. these **12 extensions**: `.pt`, `.pth`, `.bin`, `.ckpt`, `.pb`, `.h5`, `.keras`,
> `.npy`, `.pkl`, `.pickle`, `.joblib`, `.dill` (PyTorch / pickle / Keras / TensorFlow / NumPy / joblib /
> dill — the code-bearing, deserialization-risk formats). **NOT covered:** `.gguf` and `.safetensors`
> (and any other format). **Implication:** this pipeline ships a **`.gguf`** model, so modelscan scans
> **nothing** here (`total_scanned: 0`). Any model whose weights live only in a `.gguf`/`.safetensors` (or
> other unlisted) file gets **no malware/deserialization coverage** from this stage. If the project later
> ships a pickle-family format, modelscan engages automatically; until then it is a no-op.

**Validated against the log + the job block + the pasted `modelscan.json` (run `2606572181 @ 6a48e525`, job
`14888933939`):**
- 🔴 **It scanned NOTHING — the pipeline's only model is invisible to it.** The job pre-filters with
  `find … \( -name "*.pt" -o … "*.pkl" -o "*.pickle" -o "*.joblib" -o "*.dill" \)` (12 extensions: `.pt .pth
  .bin .ckpt .pb .h5 .keras .npy .pkl .pickle .joblib .dill`) — **`.gguf` is not in the list** (nor
  `.safetensors`). The fixture is `qwen2.5-1.5b-instruct-q2_k.gguf`, so `MODEL_FILE` came back empty and the
  job logged `No modelscan-supported model files found … — skipping modelscan`, wrote
  `{"skipped":true,"reason":"no modelscan-supported model files found",…,"total_scanned":0}`, and exited 0.
  **The malicious-model scanner contributes zero signal for the model this pipeline actually ships.**
- ⚠️ **Legitimate, but a real coverage gap — not "GGUF is safe, nothing found."** modelscan targets
  code-bearing / pickle-family formats; **GGUF is a non-executable tensor+metadata container (llama.cpp), not
  a modelscan target**, so skipping is *correct behavior*, not a bug. But the consequence stands: **no job in
  this pipeline scans the GGUF for malicious content** (and GGUF parsing has had its own loader CVEs in
  llama.cpp — out of modelscan's scope entirely). modelscan only earns its place if/when the project ships
  pickle/torch/Keras/TF formats; for a GGUF-only project it is inert supply-chain decoration. Flag it as such.
- 🔴 **Non-enforcing even when it DOES scan — doubly.** The post-scan gate (lines 1111–1128) fails the job
  (`sys.exit(1)`) **only on `CRITICAL > 0`** — a `HIGH`-severity malicious-code finding would print and pass.
  And `allow_failure: true` (line 1135) means even that `CRITICAL` exit is **swallowed**. So modelscan can
  never block this pipeline: `HIGH` is ignored by the gate, `CRITICAL` is ignored by `allow_failure`. Scan
  exit codes are handled correctly (`0/1` ok, `3`=no-supported-files tolerated, others propagate), but it all
  feeds a gate that can't gate.
- ✅ **Good explainability (credit — same bar as #20, contrast #19).** It is *honest about doing nothing*:
  explicit `"skipped":true` + human-readable `reason`, a zeroed severity summary with `total_scanned:0`, the
  `"no supported model artifacts scanned; preserving report and continuing"` line, and `artifacts: when:
  always`. A reviewer can tell from the report alone that nothing was scanned and why — the right way to
  surface a no-op. (`modelscan.log` is 0 bytes — expected: the skip branch does `: > modelscan.log` before
  modelscan runs; harmless but a pointless empty artifact.)
- ⚠️ **`needs: model-signing-install` is again ordering-only** — modelscan installs its own deps
  (`pip install modelscan` → modelscan 0.8.8 + numpy/rich/…), never touching #15's discarded 37-pkg venv.
  Third confirmation that `model-signing-install` provisions nothing its dependents use. (pip-cache
  restore/save ~1:03/1:31 is legitimate here — real Python job.)

**Verdict:** 🔴 As wired for *this* pipeline, modelscan is **inert**: the lone model is a GGUF, which the job's
own extension filter excludes, so it scanned **0 files** and explicitly skipped — the malware/deserialization
control yields **no signal for the deployed model**. The skip is *correct* (GGUF isn't a modelscan target), so
the real finding is a **coverage gap**: nothing in the pipeline scans the GGUF for malicious content, and
modelscan only adds value if the project ships pickle-family formats. Compounding it, even on a real scan the
job is **non-enforcing** (gate fails only on `CRITICAL`, ignores `HIGH`; `allow_failure` swallows even
`CRITICAL`). The one genuine positive is **explainability** — it reports the skip honestly. `model-integrity`
7/20.

---

## modelaudit-scan  (stage: model-integrity, `allow_failure: true`)  ⚠️ (FIRST job to actually scan the GGUF — real coverage win that closes the #21 gap — but the gate only catches modelaudit *crashing*, never what it *finds*; non-enforcing on findings)

**Purpose:** Eighth instantiated `model-integrity` job (`.gitlab-ci.yml:1137`, `needs:[modelscan,
model-fixture-download]`). Runs **promptfoo `modelaudit`** (`modelaudit[all]>=0.2.47`) — a broader
model-security scanner than `modelscan` (#21) — over the whole `${MODEL_DIR}` tree to flag unsafe
content/metadata in serialized model files. The critical structural difference from `modelscan`:
**no extension pre-filter.** modelscan `find`-filters to 12 pickle-family extensions (excluding
`.gguf`) and so scanned nothing; modelaudit only guards on *"does any file exist"*
(`MODEL_FILE=$(find "${MODEL_DIR}" -type f | head -1)`, line 1156) and then runs
`modelaudit scan "${MODEL_DIR}"` on everything. This is the job the prior session flagged to watch:
**does modelaudit support GGUF? — answer: yes, it scanned it.**

**What modelaudit actually does to the GGUF (vendor spec — promptfoo.dev/docs/model-audit, the explainability answer):**
modelaudit dispatches per-format **scanners**; for this fixture the **GGUF/GGML scanner** handled
`qwen2.5-1.5b-instruct-q2_k.gguf` and performs **five concrete checks**:
1. **Header validation** — confirms the GGUF magic/version/structure is well-formed (not a spoofed or
   truncated container).
2. **JSON-metadata scan** — inspects the embedded key/value metadata block for **suspicious content
   and path-traversal** strings (e.g. `../`, absolute paths, injected content in tokenizer/template fields).
3. **Tensor-integrity validation** — checks the tensor table/offsets are internally consistent (no
   out-of-bounds or overlapping tensor declarations).
4. **Resource-limit enforcement** — bounds declared sizes/counts to prevent a malicious file from
   triggering a **DoS** (memory blow-up) in a naive loader.
5. **Decompression-bomb detection** — guards against compression-ratio attacks.
The broader modelaudit catalog (pickle opcodes, TF/ONNX ops, Keras layers, blacklisted names, embedded
executables, secrets, license, etc.) does **not** apply to a GGUF — GGUF is a non-executable
tensor+metadata container, so the GGUF scanner is the relevant (and correct) one. **Severity taxonomy**
(vendor): `CRITICAL` = definite security concern, `WARNING` = needs review, `INFO` = informational,
`DEBUG` = `--verbose` only. **Exit-code contract** (vendor): `0` = no issues; `1` = **warnings *or*
critical detected**; `2` = operational error / inconclusive / **no files scanned**.

**So what did it find, concretely (run `2606572181 @ 6a48e525`, job `14888933940`):** modelaudit ran all
five GGUF checks and the model **passed every actionable one** — `exit 0` (per the contract: *zero*
warnings, *zero* critical), with **one INFO-level informational note** (`Security finding recorded` →
`Found 1 issue`; summary `CRITICAL=0 WARNING=0 INFO=2 exit=0`). Translated: the GGUF is **structurally
sound** (valid header, consistent tensors), its **metadata is free of suspicious/path-traversal content**,
and it trips **no DoS/decompression limits** — the only output is an informational observation, not a
security concern. *(The exact INFO string lives in `reports/modelaudit.json`, not pasted this round; on a
clean GGUF this severity is typically a benign metadata/observation note. Severity and disposition —
informational, non-blocking — are fully determined from the log + the vendor contract above; only the
one note's text is unconfirmed.)*

**Validated against the real log:**
- ✅ **It ACTUALLY SCANNED THE GGUF — this is the win.** The log shows `Paths to scan:
  /builds/.../models` → `Scanning /builds/.../models...` → `Security finding recorded` →
  `Scanned /builds/.../models: Found 1 issue` → `Results written to .../reports/modelaudit.json`.
  So unlike `modelscan` #21 (which extension-excluded `.gguf` and scanned **0 files**), modelaudit's
  GGUF/GGML scanner parsed the 718 MiB `qwen2.5-1.5b-instruct-q2_k.gguf` and ran all five checks above.
  **This closes the #21 coverage gap**: the pipeline's lone deployed model now gets a real structural +
  metadata security scan. (It received both upstream artifacts — modelscan `14888933939` + the fixture
  `14888933934` — so it operated on the real model.)
- ✅ **The CLI invocation is real, not fabricated** (clears the project's fabricated-flag concern,
  per the Codex history). `modelaudit scan <dir> --format json --output <file>` ran, modelaudit
  `0.2.47` installed and printed its version, and the JSON report was genuinely written. Telemetry is
  correctly disabled (`DO_NOT_TRACK: "1"` + `PROMPTFOO_DISABLE_TELEMETRY: "1"`, lines 1147–1148) — good
  hygiene for a promptfoo tool that phones home by default.
- ⚠️ **Summary over-counts findings (cosmetic, same class as secret-detection #6 / the generic walk).**
  modelaudit reported `Found 1 issue`, but the job's recursive `walk()` (lines 1189–1200) counts every
  `severity`/`level` string anywhere in the JSON, so it tallied **INFO=2** and `findings:2` for the one
  logical issue (the finding carries a severity *and* a nested scanner/check `level`). `modelaudit-summary.json`
  therefore says 2 where the tool says 1. Harmless (no gate keys on the count — see below), but the
  summary mis-reports.

**Caveats / findings:**
- 🔴 **NON-ENFORCING ON FINDINGS — the gate is *inverted*: it fails only on the codes that mean
  "couldn't scan," and passes on the code that means "found a critical." Confirmed against modelaudit's
  own exit-code contract.** Vendor contract: `exit 1` = **warnings or critical detected**, `exit 2` =
  operational error / inconclusive / **no files scanned**. The post-scan python (lines 1178–1221) computes
  `critical`/`warning`/`info` and prints them, but its **only** exit condition is
  `if audit_exit == 2: sys.exit(2)` (lines 1218–1220). So the job re-raises **only `exit 2`** — i.e. it
  fails when modelaudit **errored or scanned nothing**, and it **ignores `exit 1` entirely**. A genuine
  CRITICAL malicious-model finding → modelaudit `exit 1` → `audit_exit == 2` is false → **the job goes
  green having found a CRITICAL.** That is the exact inverse of a security gate (it red-lines the
  *can't-scan* case, green-lights the *found-malware* case). modelscan #21 at least did `sys.exit(1)` on
  `CRITICAL>0`; modelaudit doesn't even act on its own `exit 1`. **The latent bug survives "drop
  allow_failure":** removing `allow_failure: true` (line 1229) still leaves a job that can't block on
  malware — the `critical`/`warning` counts are decorative. **Fix:** gate on the tool's contract —
  `if audit_exit == 1: sys.exit(1)` (or `if critical/warning > 0 and not skipped`) — *then* drop
  `allow_failure`. (Note the irony: `exit 2` includes "no files scanned," so the job's sole hard-fail
  condition is essentially the *modelscan failure mode* — it gates on "nothing got scanned," not "malware found.")
- 🔴 **`allow_failure: true` on top (line 1229)** — even the one thing that *does* gate (operational
  exit 2) is swallowed. So modelaudit can never red-line the pipeline: findings are ignored by the
  script, operational failures are ignored by `allow_failure`. Advisory-only, like the rest of the stage.
- 🔴 **Cache save FAILED — `no space left on device` (NEW infra finding, real).** The "Saving cache"
  step ended in `FATAL: write …/pip-main-protected/archive_4294755609: no space left on device. Failed
  to create cache` — the shared `pip-main-protected` cache (now **7857** files, up from 7819→7821 in
  earlier jobs) **filled the runner disk and did not save.** The job still succeeded (cache-save failure
  is non-fatal), but this is the **accumulated-bloat hygiene issue finally biting**: the redundant 37-pkg
  signing-stack installs flagged across #15/#17/#18/#19 keep re-uploading into one shared cache, and it
  has now hit **this runner's** disk ceiling. Consequence: this cache *write* failed, so downstream jobs
  may miss the cache and do full reinstalls (slower, more egress). **Intermittent / runner-local, not a
  permanent cache-full state** (refined at `modelfile-audit` #23): the same `pip-main-protected` cache
  **saved fine three jobs later** (#23, 7819 files, runner `blue-7`) — this failure was disk pressure on
  runner `blue-8`, made more likely by the bloat, not a hard ceiling reached for good. **Fix:** stop
  caching where pip isn't used (`cache: {}` on the syft/curl jobs), and/or prune the cache / split per-job
  keys; the single shared `pip-main-protected` is overloaded.
- ⚠️ **Version floor, not a pin — `modelaudit[all]>=0.2.47` (line 1152).** Resolved to exactly the floor
  `0.2.47` this run, but `>=` means a future pipeline silently floats to whatever PyPI serves —
  non-reproducible scans, same unpinned pattern as the signing libs (#15/#17/#18). For a security
  scanner, pin `==0.2.47` (or a hashed lockfile).
- ✅ **pip-cache restore is legitimate here** (unlike syft #10/#11 or the curl-only fixture #16): this
  job *does* use Python/pip (it installs modelaudit), so restoring `pip-main-protected` (~1:01) is real
  work feeding a real install — the no-op-restore hygiene complaint does **not** apply to this job
  (only the *save* failed, on disk space).
- ⚠️ **`needs: [modelscan, …]` is ordering-only again** — modelaudit `pip install`s its own stack;
  it shares nothing with modelscan's deps. Consistent with the stage-wide pattern that `needs:` here
  buys sequencing, not artifact reuse.

**Verdict:** ⚠️ The **most consequential coverage win in the stage so far**: modelaudit is the **first
and only job that actually scans the deployed GGUF** (the file `modelscan` #21 structurally excluded),
its flags are real, it ran cleanly, and it disables telemetry — genuine, not theater. **But its gate is
*inverted*:** per modelaudit's own exit-code contract it re-raises **only `exit 2`** (operational error /
nothing scanned) and **ignores `exit 1`** (the code that means "warning or CRITICAL found"), so a CRITICAL
malicious-model finding passes green *before* `allow_failure: true` even gets a chance to swallow it — the
job hard-fails on *can't-scan* and green-lights *found-malware*, and the `critical`/`warning` counts it
prints are decorative. The one INFO finding this run is non-actionable (and its content needs
`modelaudit.json`, not pasted). Net: **real GGUF coverage, zero enforcement.** Plus a real new infra
signal — the shared `pip-main-protected` cache hit `no space left on device` and failed to save,
the accumulated-install bloat (#15/#17/#18/#19) finally manifesting as a cache-write failure.
`model-integrity` 8/20.

> **OPEN (one residual detail only):** *what the scan does* is now fully documented (the five GGUF/GGML
> checks, severity taxonomy, exit-code contract, and the run's disposition: structurally sound, clean
> metadata, 0 warning/critical, 1 INFO note). The **only** thing the log doesn't pin is the **text of
> that single INFO note** — paste `reports/modelaudit.json` if you want it quoted verbatim (and to
> confirm the `findings:2`-vs-`1 issue` over-count against the artifact). Not needed to characterize the
> job — it's an informational, non-blocking observation on an otherwise-clean GGUF.

---

## modelfile-audit  (stage: model-integrity, `allow_failure: true`)  ⚠️ (INERT this run — no Modelfiles in the repo, so the hashing never ran; and even when it runs it's a record-only digest *inventory*, not a scan or gate; structurally inapplicable to a GGUF pipeline)

**Purpose:** Ninth instantiated `model-integrity` job (`.gitlab-ci.yml:1231`, `needs:[setup]`,
`allow_failure: true`). A **Modelfile integrity inventory** — finds **Ollama `Modelfile`s** (the build
manifest that defines an Ollama model: `FROM`/`PARAMETER`/`TEMPLATE`/`SYSTEM`/`ADAPTER` directives) and
records a **sha256 of each file's text** into `evidence/modelfile-digests.txt` + a JSON report. It is the
Modelfile analogue of `model-digest` #17 (hash-and-record), **not** a content scanner.

**What it actually does (explainability):** a pure-stdlib (`hashlib`/`json`/`pathlib`) Python block
(lines 1242–1288) globs four locations — `${MODEL_DIR}` recursively for `Modelfile`/`modelfile`, plus the
repo root `Modelfile` and `*/Modelfile` — dedups by resolved path, and for each match emits
`{rel}  sha256:{hex}` to `evidence/modelfile-digests.txt` and `{file, sha256}` to
`reports/modelfile-audit.json`. If none are found it writes `{"skipped": true, "files": []}` and `exit 0`.
Note what it does **not** do: it never parses Modelfile *contents* for risky directives (no check of
`FROM` provenance, no template-injection / `ADAPTER` path inspection) — it only **hashes the bytes**. So
even on the populated path it is a record-only inventory (no baseline compare, `allow_failure: true`),
not a security scan and not a gate.

**Validated against the real log + the pasted `modelfile-audit.json` (run `2606572181 @ 6a48e525`, job `14888933941`):**
- ✅ **Honest skip, artifact matches exactly.** Log: `No Modelfiles found — skipping`; artifact =
  `{"skipped": true, "files": []}` — byte-identical to the skip literal the script writes (lines 1266–1268).
  The hashing path (the real work) never executed.
- ℹ️ **Correctly skipped — there are no Modelfiles to find, by design.** This pipeline ships a **GGUF**
  fixture (llama.cpp format), not an **Ollama** model; `Modelfile` is Ollama's packaging manifest, a
  different system entirely. None is committed in the 77 pipeline-materials files, and a HF GGUF download
  doesn't contain one. (Also `needs:[setup]` only — it does **not** pull `model-fixture-download`, so
  `${MODEL_DIR}` isn't even populated here; but that's moot, since a GGUF dir has no `Modelfile` regardless.)
  Same "inert until the project ships format X" pattern as `modelscan` #21 (pickle) and `dvc-verify` #12.
- ⚠️ **Declared-artifact-missing warning on the skip path.** The job declares two artifact paths
  (`reports/modelfile-audit.json` **and** `evidence/modelfile-digests.txt`, lines 1289–1293), but
  `modelfile-digests.txt` is only written on the *populated* branch (line 1282). On the skip path it
  doesn't exist, so the upload logs `WARNING: …/evidence/modelfile-digests.txt: no matching files`. Not
  fatal (the JSON uploads, job green), but it's a declared output that never materializes when skipping —
  cosmetic noise; guard the artifact path or always `touch` the digests file.
- ⚠️ **No-op pip overhead (same hygiene family as #16/syft).** It inherits the default secure-pip
  `before_script` (pip.conf write + `pip install --upgrade pip setuptools wheel` + isolated venv — visible
  in the log) but the job body is stdlib-only, so none of it is needed. The shared `pip-main-protected`
  cache was restored (~1:02) **and saved (~1:48, 7819 files)**. Fix: `before_script: []` + `cache: {}`.
- ℹ️ **Refines the #22 cache failure → it's intermittent / runner-local, not a permanent cache-full
  state.** The very same shared `pip-main-protected` cache that hit `no space left on device` at
  `modelaudit-scan` #22 (7857 files, runner `blue-8`) **saved successfully here** (7819 files, runner
  `blue-7`, `Created cache`). So #22's failure was **disk pressure on a specific runner**, not a hard
  ceiling reached for good — but the bloat trend (the redundant 37-pkg installs of #15/#17/#18/#19) is what
  pushes the cache size up and makes that intermittent failure more likely. (Cross-ref added to #22.)

**Verdict:** ⚠️ A correct, honest **no-op this run** — it skipped because the repo has no Ollama
`Modelfile`s (the pipeline ships a GGUF, an unrelated format), and the artifact records that truthfully.
But two things to be clear about: (1) **even when it runs, it's a record-only digest inventory** — it
hashes Modelfile bytes, never inspects their directives — so it's evidence generation, not a scan or a
gate (`allow_failure: true`, no baseline compare); and (2) like `modelscan` #21 / `dvc-verify` #12 it is
**inert decoration for this pipeline** until an Ollama model is actually shipped. Minor: a declared
artifact (`modelfile-digests.txt`) is missing on the skip path (upload warning), and the usual no-op
pip-cache overhead. `model-integrity` 9/20.

---

## clamav-scan  (stage: model-integrity, **`allow_failure: false`**)  ✅ (the strongest malware control in the stage — a real content-agnostic AV scan that ACTUALLY covers the GGUF, and a genuine HARD GATE with correct, non-inverted logic) ⚠️ but AV-signature-only (no ML-specific threat detection) — 🔴 and the hard gate is UNAUDITABLE (`--no-summary` → it cannot prove it scanned anything)

**Purpose:** Tenth instantiated `model-integrity` job (`.gitlab-ci.yml:1295`, `needs:[model-signing-install,
model-fixture-download]`). Traditional **antivirus** scan of the model tree: runs **ClamAV `clamscan`**
recursively over `${MODEL_DIR}` against the freshclam-updated malware-signature DB, and **fails the
pipeline if anything is infected**. This is the byte-signature counterpart to the ML-aware scanners
(`modelscan` #21 / `modelaudit` #22).

**What it actually does (explainability):** in the pinned `clamav/clamav:1.4` image (`IMAGE_CLAMAV`,
line 60 — patch-floating minor tag, **not** `:latest`, notably better than trivy #14), `before_script: []`:
1. `freshclam --quiet` pulls the latest signature DB (**non-fatal** if the mirror is unreachable — falls
   back to the image's bundled DB).
2. `clamscan --recursive --infected --no-summary --max-filesize=2047M --max-scansize=2047M
   --log=<log> ${MODEL_DIR}` — scans **every file's bytes** under `models/` against the signature DB.
   **The `--max-filesize`/`--max-scansize` are deliberately raised to ~2 GB** (ClamAV defaults are 25 MB /
   100 MB) — without this the 718 MiB GGUF would be **silently skipped for size** and the scan would be
   vacuous; raising the caps above the file size is what makes the GGUF actually get scanned.
3. Gate: `CLAM_EXIT == 1` (virus found) → `exit 1`; `CLAM_EXIT != 0` (scanner error) → `exit $CLAM_EXIT`;
   else `clean`. `INFECTED` is also parsed from the log (`awk '/ FOUND$/'`) for the JSON, but **the gate
   keys on clamscan's own exit code**, not the parsed count — robust.

**Validated against the real log + the pasted `clamav-model.json` (run `2606572181 @ 6a48e525`, job `14888933942`):**
- ✅ **It ACTUALLY SCANNED THE GGUF — content-agnostic, so unlike `modelscan` #21 it covers the file.**
  It pulled `model-fixture-download` (`14888933934`); `ls -la ${MODEL_DIR}` in the log confirms the
  `qwen2.5-1.5b-instruct-gguf` dir is present; `clamscan --recursive` ran over it → `clamscan exit: 0` →
  `ClamAV: 0 infected file(s) | exit 0` → `clean`. Artifact = `{"scanned_dir":".../models","infected":0,
  "exit_code":0}` — matches the log. Because the size caps (2047M) exceed the 718 MiB GGUF, the file was
  in-scope (not size-skipped). **This is the malware scan the GGUF never got from modelscan/modelaudit's
  ML-specific tooling.**
- ✅ **GENUINE HARD GATE with CORRECT (non-inverted) logic — the standout.** `allow_failure: false` (line
  1351), and the script blocks on **both** failure modes: a virus (`exit 1`) **and** a scanner error
  (`exit 2` → propagated). Contrast `modelaudit` #22, whose gate was *inverted* (re-raised only the
  operational `exit 2`, ignored the `exit 1` that means "found something"). ClamAV here does it right: a
  real infection would **stop the pipeline**, and a broken scan (e.g. missing DB → clamscan exit 2) is also
  fail-closed. This is the third real hard gate in the stage (with `model-fixture-download` #16 and
  `signature-verification` #19) — and the only **malware** gate that actually gates.
- 🔴 **EXPLAINABILITY HOLE (elevated — this is the job's most important fix) — the gate cannot prove it
  scanned anything.** `--no-summary` suppresses ClamAV's `Scanned files: N / Data scanned: N MB` line, and
  on a clean scan `--infected` prints nothing — so `clamav-model.txt` came out **0 bytes** (user confirms:
  not uploaded) and `clamav-model.json` records only `infected:0, exit:0`. **A clean scan of the 718 MiB
  GGUF and a scan that silently covered zero files produce byte-identical evidence.** That matters more
  here than on the advisory scanners precisely *because this one is a hard gate* (`allow_failure: false`):
  it is the only malware control that can block the pipeline, yet its green result is **unauditable** —
  nothing in the log or artifacts shows that a single byte of the model was read. The `clamscan` exit code
  *is* trustworthy and the size caps *are* set correctly (so this run almost certainly did scan the GGUF),
  but "almost certainly, by inference" is not the bar for a gate whose entire value proposition is "we
  scanned the model." A future regression — a wrong `${MODEL_DIR}`, an empty artifact, a path typo — would
  pass green and leave **no trace** that coverage collapsed. **Fix (raise priority): drop `--no-summary`**
  (or tee the summary into the log/JSON) so every run records files-scanned + bytes-scanned as evidence;
  ideally also assert `Scanned files >= 1` so an empty scan fails the gate. Same first-class explainability
  principle as #19/#20, and the highest-leverage change on this job — see [[feedback_explainability_first_class]].
  **Cross-cutting:** the *same* `--no-summary` is on `dataset-scan` #27's clamscan, where it's now
  *demonstrated* — that job's `dataset-clamav.log` artifact came back **empirically blank**. Track the
  `--no-summary` removal as one finding spanning #24 + #27.
- ⚠️ **AV-signature-only — "clean" means "no *known* malware in the bytes," not "the model is safe."**
  ClamAV matches known virus/trojan signatures; it does **not** understand ML-specific threats — malicious
  pickle opcodes, GGUF/llama.cpp loader-exploit metadata, adversarial/back-doored weights. Those are
  exactly what `modelscan`/`modelaudit` are *for* — but #21 was inert (GGUF excluded) and #22 found nothing
  actionable (and couldn't gate anyway). So clamav is **necessary-but-not-sufficient** coverage: it's the
  one malware control that both scans the GGUF and gates, but it catches a different (and narrower) threat
  class than the ML scanners. Honest framing: the GGUF is "AV-clean," not "proven-safe."
- ⚠️ **freshclam is non-fatal** — if the signature mirror is down, the scan proceeds on whatever DB ships
  in the image, which could be stale, weakening detection silently (the job would still go green). The
  trade-off (don't fail the pipeline on a mirror outage) is reasonable, but a stale-DB scan looks identical
  to a fresh one in the evidence. Worth logging the DB version/date.
- ⚠️ **`needs: model-signing-install` is ordering-only — 4th confirmation #15 provisions nothing.** This
  job runs in the `clamav/clamav:1.4` image, which has **no Python at all** — it cannot and does not touch
  #15's discarded model-signing venv. Pure sequencing edge.
- ⚠️ **No-op pip-cache restore (~1:00) in a Python-less image** — same hygiene bug as syft #10/#11: the
  global `cache: pip-main-protected` restored 7821 files into an image with no pip. (Save was skipped —
  "Primary cache already exists remotely" — so no re-upload here, and no disk-space issue this run, on the
  same `blue-8` runner that failed at #22; consistent with the intermittent-failure refinement at #23.)
  Fix: `cache: {}`.

**Verdict:** ✅ The **strongest malware control reviewed in the stage** — and a refreshing contrast to the
non-enforcing scanners around it. ClamAV genuinely scans the GGUF (content-agnostic, with the file-size
caps deliberately raised so the 718 MiB model is actually in-scope, not size-skipped), and it is a **real
hard gate** (`allow_failure: false`) with **correct, non-inverted logic** — it blocks on both an infection
*and* a scanner error (the gate `modelaudit` #22 should have had). Image is pinned (`1.4`, better than
trivy `:latest`), DB is freshclam-updated. The caveats are about *scope and evidence*, not theater. **The top fix
is explainability: `--no-summary` makes this hard gate UNAUDITABLE** — a clean 718 MiB scan and a scan
that silently covered zero files emit byte-identical evidence (0-byte report, `infected:0,exit:0`), so the
one control that can block the pipeline can't prove it scanned anything; drop `--no-summary` and assert
`Scanned files >= 1`. Secondary: it's **AV-signature-only** (no ML-specific threat detection — "clean" ≠
"safe," and the ML scanners that would catch those are inert/non-gating here), and freshclam failures
degrade silently. Plus the recurring stage hygiene: `needs: model-signing-install` is ordering-only (4th
proof #15 provisions nothing) and a no-op pip-cache restore in a Python-less image. `model-integrity`
10/20 — halfway.

---

## hf-artifact-scan  (stage: model-integrity, `allow_failure: true`)  ⚠️ (INERT this run — skipped; and as wired it's both WASTEFUL by construction and likely BROKEN when active: installs a mail server + AV + modelscan *then* skips, and its ClamAV has no signature DB)

**Purpose:** Eleventh instantiated `model-integrity` job (`.gitlab-ci.yml:1353`, `needs:[model-signing-install,
vault-secrets]`). Scans **external HuggingFace model repos** named in `HF_MODEL_IDS` (comma-separated): for
each, pull card metadata, `snapshot_download` the repo, then scan the files with **ClamAV + modelscan**,
exiting 1 on a ClamAV infection or a modelscan CRITICAL. **Distinct target from #21/#24** — those scan the
*local* downloaded fixture (`${MODEL_DIR}`); this scans *arbitrary external HF repos by ID*.

**What it actually does (explainability):** in `python:3.11-slim` (default secure-pip `before_script`):
`apt-get install clamav clamav-freshclam` → `freshclam` → `pip install huggingface_hub modelscan` →
`mkdir hf-scan` → **then** the `HF_MODEL_IDS` skip guard → (if set) a Python loop using
`huggingface_hub.model_info` + `snapshot_download` (ignoring `*.md/*.txt/*.yaml/tokenizer*/vocab*`), a
`clamscan` (same flags as #24), and `modelscan scan … --reporting-format json`, gating on either tool's
findings.

**Validated against the real log + the pasted `summary.json` (run `2606572181 @ 6a48e525`, job `14888933943`):**
- ✅ **Honest skip, artifact matches exactly.** `HF_MODEL_IDS` is unset → log `HF_MODEL_IDS not set —
  skipping HuggingFace artifact scan`; `reports/hf-scan/summary.json` = `{"skipped":true,"scanned":[]}` —
  byte-identical to the skip literal (line 1369). (The "2 artifact files" in the log = the `hf-scan/` dir +
  `summary.json`.) The scan loop never ran.
- 🔴 **Installs a mail server + AV engine + ML scanner, then skips — the skip guard is in the wrong place.**
  The `if [ -z "${HF_MODEL_IDS}" ]` guard is at the **end** (line 1367), *after* three heavy install steps
  that run unconditionally on **every** pipeline: `apt-get install clamav clamav-freshclam` pulls **~73
  Debian packages** into slim — including **`systemd`, `exim4` (a full mail server), `cron`, `dbus`,
  `perl`** (visible in the log) — plus `pip install huggingface_hub modelscan` (24 wheels). Since
  `HF_MODEL_IDS` is unset by default, every normal run builds all of that and immediately discards it.
  **Fix:** move the `HF_MODEL_IDS` skip guard to the **top** of `script`, before any install.
- ⚠️ **`freshclam` logs an ERROR — but it's the non-fatal clamd-notify step, NOT a failed DB download
  (CORRECTED at #27).** The log shows `ERROR: … Can't find or parse configuration file
  /etc/clamav/clamd.conf`, swallowed by `|| echo WARNING`. *I initially read this as "DB-less → AV theater."
  That was an overstatement* — `dataset-scan` #27 runs this same apt+freshclam ClamAV path for real, and
  `clamscan` **exited 0, not the exit-2 you get from a missing database**, which is positive evidence the
  signature DB **did** download. The `/etc/clamav/clamd.conf` error is freshclam's **post-update attempt to
  notify a running clamd** (there is none) — harmless — and `2>&1 | tail -3` hides the successful download
  lines. So the ClamAV here would most likely **work** when `HF_MODEL_IDS` is set (not theater). Residual
  nit: relying on the apt image + freshclam (vs the `clamav/clamav:1.4` image #24 uses) produces this
  confusing error and an uncached re-download every run; preferring the image would be cleaner. (Not
  100%-pinned for *this* job since it skipped before clamscan — but #27 settles the DB question.)
- ⚠️ **Non-gating (`allow_failure: true`) despite correct exit logic.** The Python *does* `sys.exit(1)` on
  a ClamAV infection or a modelscan CRITICAL (the right gate logic, unlike #22's inverted gate), but
  `allow_failure: true` (line 1455) swallows it — so even a real threat in an external HF artifact wouldn't
  block. (Contrast #24's `allow_failure: false`.) If this is meant to vet untrusted external models, it
  should gate.
- ⚠️ **`model_info` is under-used — it reads `pipeline_tag/tags/gated/downloads` but ignores `disabled`,
  HF's own malicious-repo flag.** (See the design note below — this is the part worth keeping.)
- ⚠️ **modelscan here would be *meaningful*, unlike #21.** `snapshot_download` keeps the weight files
  (it only ignores docs/tokenizer/vocab), so for a typical HF model (`.safetensors`/`.bin`/`.pt`) modelscan
  **engages** — the GGUF-exclusion no-op that made #21 inert wouldn't apply to most HF repos. So the
  modelscan call is the one genuinely-useful scanner in this job (for pickle-family external models).
- ⚠️ **`needs: model-signing-install` is ordering-only — 5th confirmation #15 provisions nothing.** This
  job apt-installs ClamAV and pip-installs its own `huggingface_hub`/`modelscan`; it touches nothing from
  #15. (`vault-secrets` is for `HF_TOKEN`, moot while `HF_MODEL_IDS` is unset.) Plus the usual no-op
  pip-cache restore (~1:01) — the apt install itself is **never** cached, so it re-runs in full every time.

**Design note — what `huggingface_hub` uniquely offers (verified against the Hub API docs):** the valuable,
non-redundant thing here is **provenance + policy metadata from the Hub**, *not* re-downloading and
re-scanning. `HfApi.model_info(repo_id, expand=[…])` exposes (per the `ModelInfo`/`DatasetInfo` schema):
**`disabled`** (HF's kill-switch — it disables repos flagged malicious/abusive; the single most useful
security field, and *this job doesn't read it*), **`gated`** (`auto`/`manual`/`False`), **`private`**,
**`sha`** (exact revision for pinning/provenance), **`siblings`** (file inventory with sizes/LFS metadata —
lets you flag unexpected or oversized files *without downloading*), and reputation heuristics
(`downloads`, `downloads_all_time`, `likes`, `created_at`, `last_modified`, `author`). Note the API does
**not** return a structured malware/pickle-scan verdict in this version (HF surfaces those in the web UI,
not as a `model_info` field) — so the Hub's programmatic security signal is `disabled` + provenance, not a
scan result. The high-leverage pattern is therefore a **lightweight provenance/policy gate** (fail on
`disabled`, enforce an author allowlist + pinned `sha`, inspect `siblings`) — cheap, reliable, and
impossible to get locally — rather than a 700 MB download + a broken-DB ClamAV re-scan.

**Verdict:** ⚠️ A correct, honest **skip this run** (`HF_MODEL_IDS` unset; artifact truthful), but as wired
the job is **net-negative**: it unconditionally installs ~73 apt packages (incl. a mail server) + 24 wheels
and *then* checks whether it has anything to do (and its ClamAV path emits a scary-looking freshclam
error that is actually just the non-fatal clamd-notify step — **not** DB-less/theater, corrected via #27,
where the same path scanned clean with a loaded DB). It's also **non-gating** despite correct
exit logic. Its one genuinely useful piece for external models is the **modelscan** call (meaningful on
HF safetensors/pickle formats, unlike #21 on the GGUF) and the **`huggingface_hub` provenance metadata**
(esp. the unread `disabled` flag). Recommendation below. `model-integrity` 11/20.

> **🔴 PRIORITY FIX — rewrite as a `huggingface_hub` provenance/policy gate (or discard).** As wired this
> job is net-negative (installs-then-skips + heavy apt-clamav + non-gating; the ClamAV itself works — see
> the #27 correction — but it's redundant with #24 for the local model and overkill here), so don't keep it
> as a download-and-rescan. Two paths, by threat model:
> - **If you only ship the committed local fixture (today's reality — `HF_MODEL_IDS` is unset):**
>   **discard the job.** The local model is already covered by `clamav-scan` #24 (real, hard-gating) + the
>   `MODEL_FIXTURE_SHA256` pin #16 + sign/verify #18/#19. #25 adds nothing and its ClamAV is broken.
> - **If you want to vet external HF models you pull in: keep the capability but rewrite it as a
>   lightweight `huggingface_hub` provenance/policy gate** — query `model_info`, **fail on `disabled`**
>   (HF's malicious-repo flag), **enforce an author allowlist + a pinned `sha`**, and **inspect `siblings`
>   for surprises** (unexpected/oversized files); **move the skip guard to the top**; and **drop the
>   apt-ClamAV entirely** (rely on #24 + the Hub). That's cheap, reliable, and gives you something you
>   genuinely can't get locally — versus the current download-and-rescan, which is expensive and currently
>   ineffective. Make it gating (`allow_failure: false`) if it's meant to enforce.
>
> **Note — leave `modelscan` #21 in place.** Its skip-on-GGUF is by design: it is **intentional latent
> coverage for legacy pickle-family models** (`.pkl`/`.pth` and the other deserialization-risk formats),
> kept so it engages automatically the moment such a model is shipped. It is *not* redundant with
> `clamav-scan` #24 — clamav = byte-signature malware; modelscan = pickle-opcode/deserialization threats,
> a different threat class. This rationalization is about #25 only.

---

## dataset-download  (stage: model-integrity, `allow_failure: true`)  ✅ (real work — genuinely stages + hashes a dataset and writes honest `fixture:true` evidence; opens the dataset chain) ⚠️ but on a 418-byte toy fixture, and the *download* path (with its integrity check) is untested + opt-in

**Purpose:** Twelfth instantiated `model-integrity` job (`.gitlab-ci.yml:1457`, `needs:[setup, vault-secrets]`)
and the **opener of the dataset chain** (download → scan → redact → validate → sign). Stages a dataset into
`${EVIDENCE_DIR}/dataset-input/`, hashes it, and publishes the file + `dataset-digest.txt` +
`dataset-download.json` as artifacts the rest of the chain consumes.

**What it actually does (explainability) — two modes:**
1. **Fixture mode (`DATASET_FILENAME` unset — this run):** `cp` the committed
   `${GAIPS_MATERIALS_DIR}/evals/ci-dataset.jsonl` into `dataset-input/`, `sha256sum` it, write the digest
   line + a JSON record tagged **`"fixture":true`**, `exit 0`.
2. **Download mode (`DATASET_FILENAME` set — untested this run):** `curl --fail --location` from the
   **GitLab generic package registry** (`…/packages/generic/${DATASET_PACKAGE_NAME}/${DATASET_PACKAGE_VERSION}/
   ${DATASET_FILENAME}`) with `JOB-TOKEN`, `sha256sum`, then **verify against `${DATASET_EXPECTED_SHA256}`
   only if that var is set** (`exit 1` on mismatch), and write the report via a small Python block.

**Validated against the real log + both pasted artifacts (run `2606572181 @ 6a48e525`, job `14888933944`):**
- ✅ **Took the fixture path and did real work.** Log: `DATASET_FILENAME not set — using committed CI
  dataset fixture: …/evals/ci-dataset.jsonl` → `ci-dataset.jsonl  sha256:36d7c09b…515ddd` → `Dataset
  fixture staged: ci-dataset.jsonl (418 bytes)`. A genuine copy + hash + stage, not a skip.
- ✅ **Both artifacts are internally consistent and match the log.** `dataset-digest.txt` =
  `ci-dataset.jsonl  sha256:36d7c09b…515ddd`; `dataset-download.json` = `{"skipped":false,"fixture":true,
  "file":"ci-dataset.jsonl","size_bytes":418,"sha256":"36d7c09b…515ddd"}` — same filename, same digest, and
  `size_bytes:418` equals the `(418 bytes)` in the log. (The "2 files" under `dataset-input/` = the dir +
  the jsonl.)
- ✅ **Honest fixture labeling (good explainability).** It sets **`fixture:true`** (and `skipped:false`),
  so a downstream consumer or reviewer can tell this is the **committed CI test fixture**, not a real
  downloaded dataset — without conflating the two. That's the right way to surface "I staged the placeholder."
- ⚠️ **The dataset is a 418-byte committed toy fixture.** The entire dataset chain (scan/redact/validate/
  sign, #27→) runs on ~418 bytes of synthetic JSONL — same "CI-fixture, not production data" caveat as the
  model fixture. Legitimate for wiring validation, but the security signal of every downstream dataset job
  is proportional to a trivial input. (Fixture *content* not inspectable here — the `.jsonl` upload was
  rejected by the chat; digest/size are confirmed, content TBD for #27.)
- 🔴 **Download mode's integrity gate is OPT-IN — datasets get a *weaker* guarantee than models (PRIORITY
  FIX, user-agreed).** The real path (curl from the package registry + SHA check) never ran (fixture mode
  taken), so it's unvalidated (same "capability present, path untested" pattern as `vault-secrets`/`dvc`).
  More importantly, the SHA verification is **conditional on `DATASET_EXPECTED_SHA256` being set**
  (line 1494) — if it's unset, a downloaded dataset is accepted with **no integrity check at all**. Contrast
  `model-fixture-download` #16, where `MODEL_FIXTURE_SHA256` is a **committed default** so the gate is
  always-on. So datasets get a *weaker* integrity guarantee than models unless `DATASET_EXPECTED_SHA256` is
  explicitly provided. See the priority-fix block below.

**Data provenance (answering "where does the data come from"):** the fixture is a **hand-authored static
file committed to the repo** at `docs/gaips-materials/evals/ci-dataset.jsonl` (added in commit `4e08692`,
*"ci: exercise dataset scan and publish path"*) — **not** generated by a script and **not** downloaded. The
on-disk file is **418 bytes, sha256 `36d7c09b…515ddd`** — *identical* to the digest the job recorded, so
the staged artifact is provably the committed file (git is the integrity boundary). It's **2 synthetic
benign rows** (`category:"ci-fixture"`): a Q/A about the lab-model fixture's approved use, and one about
model-artifact signing — purpose-built CI content, not real eval data. **Note a deliberate schema quirk:**
row 1 uses the key **`question`**, row 2 uses **`prompt`** — the fixture intentionally exercises *both*
branches of the `question|prompt` field contract that downstream `eval-dataset-validate`/Great-Expectations
honor (one row per key). So the chain's input is a tiny, controlled, git-committed test vector.
- ⚠️ **Fixture mode has no pin either — record-only.** It hashes and records whatever the committed file
  is; nothing checks that digest against an expected value. Acceptable because the fixture is **git-committed**
  (git history is the integrity boundary), but worth knowing a fixture edit is recorded silently, not gated.
- ⚠️ **Non-gating (`allow_failure: true`)** — per the comment, to skip gracefully when `DATASET_FILENAME`
  is unset; reasonable for an optional chain, but it also means a download failure wouldn't block. Plus the
  usual **no-op pip-cache** (~1:00 restore + 1:39 save) — fixture mode is pure shell (`cp`/`sha256sum`/`wc`),
  Python runs only in download mode, so the secure-pip `before_script` + cache are wasted here. Fix: `cache:{}`.

**Verdict:** ✅ Real, honest work — it genuinely stages the committed dataset fixture, hashes it, and writes
**accurate, consistent evidence** (`fixture:true`, digest + size all matching the log and each other),
correctly opening the dataset chain. The caveats are scope/enforcement, not theater: the input is a
**418-byte toy fixture**, the **download path is untested**, and—most substantively—its **integrity check
is opt-in** (`DATASET_EXPECTED_SHA256` conditional), giving datasets a *weaker* guarantee than the model
fixture's always-on pin (#16); plus non-gating and a no-op pip cache. `model-integrity` 12/20.

> **🔴 PRIORITY FIX (user-agreed) — make the dataset SHA check mandatory in download mode.** Right now the
> integrity verification only fires `if [ -n "${DATASET_EXPECTED_SHA256}" ]` (line 1494), so a real
> downloaded dataset with no expected-SHA configured is accepted **unverified** — a weaker guarantee than
> the model fixture (#16), whose `MODEL_FIXTURE_SHA256` is a committed default that always gates. Change
> download mode to **fail when `DATASET_EXPECTED_SHA256` is unset** (or ship a committed default expected
> digest, mirroring #16), so every non-fixture dataset is hash-pinned before it enters the
> scan→redact→validate→sign chain. Until then, dataset integrity in download mode is opt-in and can
> silently degrade to TOFU/none.

---

## dataset-scan  (stage: model-integrity, **`allow_failure: false`**)  ✅ (a real HARD GATE with correct logic — genuine structural JSONL validation + a ClamAV scan that actually ran clean) ⚠️ but malware+parse only (no content-threat/poisoning detection), heavy apt install, and the same `--no-summary` evidence gap as #24

**Purpose:** Thirteenth instantiated `model-integrity` job (`.gitlab-ci.yml:1523`, `needs:[dataset-download]`,
**`allow_failure: false`** — "dataset must be clean before reaching eval jobs"). Second link in the dataset
chain: scans the staged dataset two ways and **blocks** on either — (1) **ClamAV** malware scan, (2) a
**structural JSON/JSONL validation** in Python.

**What it actually does (explainability):** `mkdir` → **top skip-guard** (`find dataset-input -type f`; if
empty, write `{"skipped":true}` and `exit 0` — *before* any install, unlike #25) → `apt-get install clamav
clamav-freshclam` → `freshclam` → `clamscan --infected --no-summary --log=… <file>` with the same
correct gate as #24 (`exit 1` on infection, propagate on scanner error) → a Python block that parses the
file: `.json` via `json.loads`, `.jsonl`/`.ndjson` line-by-line, appends a **HIGH** finding + `sys.exit(1)`
on any parse error, else "PASSED". Other suffixes → "structural validation skipped".

**Validated against the real log + 3 of 4 artifacts (run `2606572181 @ 6a48e525`, job `14888933945`):**
- ✅ **Artifacts cross-check clean.** `dataset-scan.json` = `{"skipped":false,"file":"ci-dataset.jsonl",
  "findings":[]}` (structural validation ran, **zero** findings → the PASSED path); `dataset-clamav.json` =
  `{"scanned_file":"…/ci-dataset.jsonl","infected":0,"exit_code":0}` (matches the log, names the scanned
  file); `dataset-digest.txt` = `36d7c09b…515ddd` — **identical to #26's digest**, confirming the same
  fixture flowed download→scan unmodified (chain continuity).
- 🔴 **`dataset-clamav.log` is EMPIRICALLY BLANK — direct proof of the `--no-summary` evidence gap.** The
  native ClamAV `--log` artifact (provided after the fact) contains **only a separator line** (`-----…`) —
  no per-file result, no "Loaded N signatures", no scanned-files/bytes count. So the one artifact that
  should document *what ClamAV actually did* proves nothing, because `--no-summary` strips the summary block
  on a clean scan. (Note: `dataset-clamav.log` ≠ `dataset-clamav.json` — the `.json` is the **job's own**
  `printf`-built record `{scanned_file,infected,exit_code}`; the `.log` is **ClamAV's native** output,
  blank here.) Consequence: the "DB loaded / file scanned" conclusion still rests entirely on **exit-0-not-2**,
  with **zero** corroborating detail in the evidence bundle — exactly why dropping `--no-summary` (and
  logging the signature count) is the fix. This is the `--no-summary` finding, now demonstrated rather than
  inferred.
- ✅ **Real structural validation, and it gates.** It received `dataset-download`'s artifact, found
  `ci-dataset.jsonl`, and the Python printed `JSONL valid — 2 line(s)` → `Dataset scan PASSED`. It actually
  parsed **both** rows of the fixture as JSON (the two rows I now have: `ci-benign-001` with key `question`,
  `ci-benign-002` with key `prompt` — both valid JSON objects). A malformed line would have produced a HIGH
  finding and `exit 1` on a no-`allow_failure` job → real enforcement. This is the dataset-appropriate
  structural gate.
- ✅ **ClamAV ran clean — and this CORRECTS my #25 "DB-less" worry (see the #25 note).** `clamscan exit: 0`
  → `ClamAV: 0 infected file(s)` → `clean`. Crucially, a clamscan with **no** database **exits 2**
  ("No supported database files found"), not 0 — so the **exit 0 here is positive evidence the signature DB
  was actually loaded.** The `freshclam` line shows only `ERROR … NotifyClamd: Can't find or parse … 
  /etc/clamav/clamd.conf`, but that is the **post-update step where freshclam tries to notify a running
  clamd** (there is none) — a **non-fatal notify failure *after* a successful DB download**; the `2>&1 |
  tail -3` just hides the successful download lines above it. So the apt+freshclam ClamAV path **does** get a
  working DB. (Not 100%-pinned because `--no-summary` hides the loaded-signature count — the
  `dataset-clamav.log` artifact would settle it — but exit 0 is strong.)
- ⚠️ **Coverage boundary — "scan" = malware + *parse*, NOT content safety.** The structural check confirms
  the file is **parseable JSONL**; it says nothing about whether the *content* is safe. It does **not**
  detect **data-poisoning / prompt-injection / jailbreak payloads embedded in dataset rows**, nor schema
  conformance (required fields / the `question|prompt` contract — that's `eval-dataset-validate` #31), nor
  secrets/PII (that's `dataset-redact` #28, gitleaks+Presidio). So a row containing a poisoned label or an
  injection payload would pass this gate as "valid JSONL." For a control gating data "before eval jobs,"
  that's the gap to be aware of: malware + well-formedness are covered; **malicious dataset *content* is
  not** (and nothing else in the chain covers poisoning/injection content either — redact covers secrets/PII).
- 🔴 **Same `--no-summary` evidence gap as #24 — and here it's *demonstrated*, not just argued** (see the
  blank `dataset-clamav.log` above). On a hard gate, the ClamAV "clean" should be provable from evidence;
  instead the native log is empty. For a 418-byte file the default size limits are fine (no `--max-filesize`
  needed), but the depth-of-scan evidence is suppressed entirely. Fix: drop `--no-summary` / log the
  signature count + scanned-bytes.
- 🔴 **Installs a mail server to scan a 418-byte file — every run.** `apt-get install clamav
  clamav-freshclam` pulls the same **~73 Debian packages incl. `exim4`/`systemd`/`cron`/`dbus`/`perl`** as
  #25 (full setup visible in the log). Because `dataset-download` always provides the committed fixture, this
  apt install runs on **every** pipeline (it's not wasted here — it does scan — but it's wildly heavy for the
  task, and apt isn't cached so it re-runs in full each time). Better: use the `clamav/clamav:1.4` **image**
  (like #24 — also fixes the freshclam-config noise and gives a bundled DB), or a slim clamav layer.
- ⚠️ **No-op pip cache** — the job's Python is stdlib-only (`json`/`pathlib`), no `pip install`, yet the
  secure-pip `before_script` + `pip-main-protected` cache restore/save (~1:03/~1:43) still run. Fix: `cache:{}`.

**Verdict:** ✅ A **genuine hard gate** (`allow_failure: false`) with **correct logic** — it really
structurally-validates the JSONL (parsed both fixture rows, would `exit 1` on malformed data) and really
runs ClamAV, which **scanned clean with a loaded DB** (exit 0, not the exit-2 of a missing database — which
**corrects the "DB-less theater" worry I raised on #25**: the freshclam ERROR is only the non-fatal
clamd-notify, not a failed DB download). The caveats are scope and cost, not theater: the "scan" is
**malware + well-formedness only** — it does **not** detect poisoned/injection *content* in the rows (no job
in the chain does), schema is deferred to #31 and secrets/PII to #28; and it **apt-installs a ~73-package
mail-server-bearing stack to scan 418 bytes** every run (use the clamav image instead).

> **🔴 FINDING — remove `--no-summary` from the ClamAV invocation (cross-cutting, shared with #24).** Both
> `clamscan` calls in the pipeline — `clamav-scan` #24 (model) and `dataset-scan` #27 (dataset) — pass
> `--no-summary`, which suppresses the "Loaded N signatures / Scanned files / Data scanned" block. At #27
> this is now *demonstrated*: the `dataset-clamav.log` artifact is empirically blank (a bare separator), so
> a **hard gate's** scan leaves no auditable proof it loaded a DB or read the file. **Fix in both jobs:**
> drop `--no-summary` (and tee the summary into the `.log`/`.json`) so every scan records signatures-loaded
> + files/bytes scanned; ideally also assert `Scanned files >= 1` so an empty scan fails rather than passes.
> Track this as a single finding spanning #24 and #27.

`model-integrity` 13/20.

---

## dataset-redact  (stage: model-integrity, `allow_failure: false`)  🔴 BROKEN CHAIN — the redaction security control NEVER RUNS and FAILS OPEN: it `needs: dataset-scan`, which doesn't carry the dataset forward, so it receives an empty input and skips green on every run

**Purpose:** Fourteenth instantiated `model-integrity` job (`.gitlab-ci.yml:1641`, `needs:[dataset-scan]`,
**`allow_failure: false`**). The data-confidentiality step of the chain: strip **secrets (gitleaks)** and
**PII (Presidio)** from the dataset **in place** before it is validated, signed, or loaded into any eval —
and **hard-fail** (fail-closed) if findings exceed `REDACT_MAX_SECRETS` (default **0** = zero tolerance) /
`REDACT_MAX_PII` (default **-1** = PII gate off). Designed as the strongest dataset gate.

**🔴 THE BUG (confirmed by log + artifact + the empty input folder you flagged): the dataset never reaches
this job, so redaction is skipped on every run — a fail-OPEN of a control built to be fail-closed.**
- `dataset-redact` declares `needs: ["dataset-scan"]` (line 1647). But **`dataset-scan` #27 publishes only
  its report files** (`dataset-scan.json`, `dataset-clamav.*`, `clamav-dataset.txt`) — it does **not**
  re-publish `evidence/dataset-input/`. The dataset file (`ci-dataset.jsonl`) lives in **`dataset-download`
  #26's** artifacts, and GitLab `needs:` only pulls artifacts from the **directly listed** job. So redact
  downloads #27's reports, its own `mkdir -p evidence/dataset-input` creates an **empty** dir, the
  `find … -type f` returns nothing → `No dataset file present — redaction skipped` → `{"skipped":true}` →
  **`exit 0`**.
- **The skip path fires for the WRONG reason.** The code comment says it "exits 0 cleanly when no dataset is
  configured." But a dataset **is** configured — the committed fixture flowed through #26→#27 fine; it's
  just **not propagated** to #28. So the "no dataset → skip" branch, intended for the optional-dataset case,
  is masking a **wiring break**, turning a fail-closed gate into a green no-op.
- **Net:** the secrets+PII redaction **does not happen**, and because the skip exits 0, the
  `allow_failure: false` / `REDACT_MAX_SECRETS: 0` zero-tolerance design is **vacuous** — there is no data
  for it to fail on. Confirmed: artifact = `{"skipped":true}`; the upload published an **empty**
  `evidence/dataset-input/` (your "empty sans folder" note; log: `found 1 matching artifact files and
  directories` = the dir alone). gitleaks/Presidio were never installed (skip preceded them).

**🔴 CASCADE (structural — flag to confirm at #29–#33): this empties the WHOLE downstream data chain.**
`dataset-redact` is the data-republishing hub for everything after the scan — its artifacts include
`evidence/dataset-input/` (line 1693, "the redacted data"). Since it republishes an **empty** dir, every
dependent inherits empty data: `eval-dataset-validate` (`needs:[dataset-redact]`),
`great-expectations-validate` (`needs:[eval-dataset-validate, dataset-redact]`), `ydata-profile`
(`needs:[dataset-redact]`), and—via validate—`dataset-sign` (`needs:[eval-dataset-validate]`). So **the
entire post-scan data-governance chain (redact → validate → GX → profile → sign) is almost certainly
running on no data.** `dataset-scan` #27 is the **last** job that actually sees the dataset. (Confidence:
high from the `needs:`/artifact wiring; to be verified against each job's log as we reach it.)

**What it WOULD do if the dataset reached it (explainability — the design is sound; only the wiring is broken):**
install **gitleaks** (Go binary, `GITLEAKS_VERSION`, **checksum-verified** against the official
`*_checksums.txt` via `sha256sum --check --strict` — same good trust model as cosign #15); `pip install
presidio-analyzer presidio-anonymizer` + `spacy download en_core_web_sm`; `gitleaks detect --no-git
--source <file>` to `/tmp` (**raw secrets report kept internal — never published as an artifact**, good
hygiene); then `redact_dataset.py --input <file> --gitleaks-report … --max-secrets 0 --max-pii -1`, which
redacts **in place**, **hard-fails on any secret** (`REDACT_MAX_SECRETS=0`), detects/anonymizes PII but
**does not gate on it** (`REDACT_MAX_PII=-1` = off), and re-publishes the redacted dataset. That's a
genuine fail-closed secrets gate — when it runs.

**Validated against the real log (run `2606572181 @ 6a48e525`, job `14888933946`):** `needs:[dataset-scan]`
(`14888933945`) downloaded; `No dataset file present — redaction skipped`; `{"skipped":true}` written;
empty `evidence/dataset-input/` uploaded. ~2-min no-op pip-cache save (stdlib-only skip path). Job green.

**Fixes (priority — this is a dead security control, not a cosmetic issue):**
1. **Give redact the data.** Add `dataset-download` to `needs` → `needs: ["dataset-scan", "dataset-download"]`
   (gets the scan-gate ordering **and** the dataset file). *Or* have `dataset-scan` #27 add
   `evidence/dataset-input/` to its artifacts so the chain propagates the data link-by-link.
2. **Don't let "no file" pass silently when a dataset is expected.** The skip-on-no-file branch should
   `exit 1` (or be reserved for an explicit "datasets disabled" flag), so a future propagation break
   **red-lines** instead of green-skipping a fail-closed gate.
3. **Verify the cascade** at #29–#33 and ensure each data-consumer either `needs` a job that republishes the
   dataset or pulls it explicitly.

**Verdict:** 🔴 The dataset chain's flagship control is **inert**: `dataset-redact` is wired to a job
(`dataset-scan`) that doesn't carry the dataset forward, so it receives an empty input, **skips green every
run, and never strips secrets or PII** — a fail-**open** of a gate explicitly built to be fail-closed
(`allow_failure: false`, `REDACT_MAX_SECRETS: 0`). Worse, it **republishes that empty dataset dir**, almost
certainly starving the rest of the chain (validate/GX/profile/sign) of data. The underlying design is good
(checksum-verified gitleaks, internal-only secrets report, in-place redaction, zero-tolerance secrets gate)
— it simply **never executes**. This corrects the project's own "always redacts, then hard-fails" self-
description: as wired, it **never redacts.** Highest-priority fix in the dataset chain so far.
`model-integrity` 14/20.

---

## eval-dataset-validate  (stage: model-integrity, `allow_failure: false`)  🔴 CASCADE CONFIRMED — the schema gate skipped on empty data (downstream of #28's break); a fail-closed gate fails OPEN, and the skip message disguises the break as "by design"

**Purpose:** Fifteenth instantiated `model-integrity` job (`.gitlab-ci.yml:1698`, `needs:[dataset-redact]`,
**`allow_failure: false`**). The **dataset schema contract gate**: validate the dataset against
`evals/eval-dataset.schema.json` (jsonschema) before any eval loads it; a malformed dataset must stop the
run. Feeds the `artifact-signing-gate` (line 1852 `needs:` includes this job).

**Validated against the real log + artifact (run `2606572181 @ 6a48e525`, job `14888933947`):** **This is
the predicted #28 cascade, now confirmed.** `needs:[dataset-redact]` (`14888933946`) downloaded → that
artifact's `evidence/dataset-input/` is **empty** (the empty dir #28 republished) → `find` returns nothing →
`No eval dataset present — validation skipped (evals run on fixtures)` → `{"skipped":true,"reason":"no
dataset present"}` → `exit 0`. The jsonschema validation **never ran**; `validate_eval_dataset.py` was
never invoked.

**Findings:**
- 🔴 **Same fail-OPEN as #28 — a hard gate defeated by its own skip branch.** `allow_failure: false` is
  meant to "stop the run on a malformed eval dataset," but the no-dataset skip `exit 0`s, so when the
  dataset is lost upstream the gate passes green having validated **nothing**. The schema contract is
  unenforced this run.
- 🔴 **The skip message actively disguises the break.** `"validation skipped (evals run on fixtures)"` and
  `reason:"no dataset present"` read as *intentional* ("no dataset by design — fine"), but the dataset
  **does** exist (#26's committed fixture); it was just **severed at #27→#28**. So a reviewer scanning the
  evidence sees a benign-looking "skipped by design" and **misses a real wiring failure**. The honest skip
  labeling I credited on `modelscan`/`dataset-download` becomes a liability here, because the skip is *not*
  by design — it's a bug wearing a by-design label. (Fix travels with #28: once redact propagates the data,
  this gate gets a file; independently, the skip should distinguish "datasets disabled" from "expected
  dataset missing" and `exit 1` on the latter.)
- ⚠️ **Feeds a signing gate with a vacuous result.** `artifact-signing-gate` `needs:` this job, so the
  gate's "dataset was schema-validated" assurance is, this run, satisfied by a **skip** — the certification
  is hollow (to confirm when that gate is reviewed).
- ⚠️ **Installs `jsonschema` before the skip guard** (`pip install jsonschema` → 4.26.0 + 5 deps, then the
  find/skip) — minor install-then-skip waste; plus the usual no-op pip-cache save (~2 min).

**Verdict:** 🔴 **Cascade confirmed.** The dataset schema gate received the empty `dataset-input/` that
`dataset-redact` #28 republished, so it **skipped without validating** — a second fail-**open** of an
`allow_failure: false` gate, with a skip message (`"evals run on fixtures"`) that makes a wiring break look
intentional and feeds a hollow "validated" signal to the signing gate. The validator design (jsonschema vs
a committed schema, hard-gating) is fine; it just **never sees data**. Root cause and fix are #28's. The
next chain jobs (`great-expectations-validate` #30 — same skip branch, already visible in YAML; `ydata-profile`;
then `dataset-sign`) are expected to skip the same way. `model-integrity` 15/20.
