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

## eval-dataset-validate  (stage: model-integrity, `allow_failure: false`)  ✅ REVISED — now a GENUINE hard schema gate that actually runs: validated 2 records against the committed contract (the #28 chain fix landed; the old cascade-skip is gone)

**Purpose:** Fifteenth instantiated `model-integrity` job (`.gitlab-ci.yml:1920`, `needs:["dataset-redact"]`,
**`allow_failure: false`**). The **dataset schema contract gate**: validate every record against
`evals/eval-dataset.schema.json` (Draft7 jsonschema) before any eval loads it; a malformed dataset must stop
the run. Feeds `artifact-signing-gate` (line 2107 `needs:` includes this job).

**⚠️ REVISES the prior 🔴 cascade finding.** Earlier (run `6a48e525`, pre-fix) this job took the empty-data
skip branch and passed green having validated nothing. **Fix #1 (`dataset-redact` `needs:[dataset-scan,dataset-download]`)
plus the skip-guard rewrite (`exit 1` on expected-but-missing) are now live**, so the gate executes for real.

**Validated against the real log + artifact (branch `gaips-pipeline-required-fixes` @ `8061900`, job
`14906999096`):** ran on the **redacted fixture carried from `dataset-redact`** (`14906999095` artifact
downloaded). The new skip guard's broken-chain `exit 1` branch was **NOT** hit — `DATASET_FILE` resolved to
`ci-dataset.jsonl`, so the chain is genuinely intact end-to-end. `pip install jsonschema` → 4.26.0; then
`validate_eval_dataset.py` parsed both JSONL rows and printed **`Eval dataset VALID — 2 record(s) conform to
eval-dataset.schema.json`**. Artifact `eval-dataset-validation.json`: `{"skipped":false,"valid":true,
"file":"ci-dataset.jsonl","records":2,"error_count":0,"errors":[]}` — byte-consistent with the log.

**What "VALID" actually enforces** (read `eval-dataset.schema.json`, Draft7): per record, `anyOf:[id, case_id]`
**and** `allOf[anyOf:[question, prompt]]`, every typed field `minLength: 1`, `additionalProperties: true`. So
the contract = "each record carries an identifier and at least one non-empty prompt-bearing field." The
fixture's deliberate quirk (row 1 `question`, row 2 `prompt`) **exercises both branches** of the prompt
`anyOf` — confirming the gate accepts either shape, as `inspect_eval.py`/`promptfoo.yaml` expect.

**Findings:**
- ✅ **Real, enforcing, fail-closed structure gate.** `allow_failure:false` + a malformed record (missing
  id/case_id, or no prompt-bearing field, or an empty string) → `iter_errors` populates `errors` → `exit 1`
  blocks the run. This is the contract gate working as designed, on real data, for the first time.
- ✅ **Confirms the #28 chain repair.** That this job found a `DATASET_FILE` (rather than tripping the new
  `exit 1` broken-chain guard) is direct evidence that `dataset-redact` now republishes `dataset-input/` and
  the post-scan data chain is alive — the single most important behavioural change from the fix set.
- ⚠️ **STRUCTURE only — deliberately permissive.** `additionalProperties:true` and presence/non-empty checks
  mean it cannot catch content problems: wrong-but-present values, off-distribution data, poisoning, or PII.
  Those are other rungs' jobs — content quality is `great-expectations-validate` #30, profiling is
  `ydata-profile` #31; secret/PII redaction is `dataset-redact` #28. Within its lane it's solid.
- ⚠️ **Toy-fixture signal.** "2 records" is the 418-byte committed fixture; the gate's assurance is only as
  broad as the data it sees. Real coverage scales with a real dataset (download-mode, #26).
- ⚠️ Minor: `jsonschema` install runs *after* the skip guard (good — guard-before-install, per Fix #17), but
  the job still saves the pip cache (3611 files). Legitimate here (it does use pip), unlike the stdlib/curl
  jobs Fix #15 targeted.

**Verdict:** ✅ **Genuine hard schema-contract gate, now executing on real data** — the prior 🔴 cascade is
resolved by Fix #1. It validated both fixture records against a committed Draft7 schema and would `exit 1`
(blocking, `allow_failure:false`) on any off-contract record. Honest scope boundary: it enforces *structure*,
not *content* (that's #30). The fact that it ran at all is the proof that the dataset chain is repaired.
`model-integrity` 15/20.

---

## great-expectations-validate (#30) · ydata-profile (#31) · dataset-sign (#32) — ⏸️ DEFERRED (no run evidence yet)

These three dataset-chain jobs depend on the `ff9bd7e` fixes (GX `ci-fixture` category, ydata `setuptools<81`,
`dataset-sign` `needs:[…,dataset-redact]`), which were **not present in the run documented here** (branch
`gaips-pipeline-required-fixes` @ `8061900`) and have **not yet been run**. Per verdict discipline (a job
that merely *parses* ≠ ✅), they are **not documented from code-reading alone**. Expectations are pre-recorded
so the next session can confirm against a real run:
- **#30 `great-expectations-validate`** (`allow_failure:true`, soft) — on `8061900` the suite `value_set`
  lacked `ci-fixture` while both fixture rows are `category:"ci-fixture"`, so `ExpectColumnValuesToBeInSet`
  (mostly 0.9) gets 0/2 in-set → `result.success=False` → `exit 1` (allowed-fail). `ff9bd7e` adds
  `ci-fixture` → should go green (6 expectations, 2 records). **Confirm after re-run.**
- **#31 `ydata-profile`** (`allow_failure:true`, advisory) — failed on `8061900` with `No module named
  'pkg_resources'` (setuptools 81 dropped it). `ff9bd7e` pins `setuptools<81`. **Confirm after re-run.**
- **#32 `dataset-sign`** (`allow_failure:true`) — `needs:` republished only the report on `8061900`, so it'd
  trip the broken-chain guard. `ff9bd7e` adds `dataset-redact` to `needs:` (carries the redacted bytes).
  Also a protected-var caveat: keyless `cosign sign-blob` uses `SIGSTORE_ID_TOKEN` (id_tokens) — verify it
  actually signs vs. logs "unsigned" on the branch. **Confirm after re-run.**

## artifact-signing-gate  (stage: model-integrity, **`allow_failure: false`**)  ✅ (a real enforcing chokepoint — fails closed on missing/failed integrity evidence) ⚠️ but does NOT inspect the signature-verification result it `needs:`, and its ModelScan arm passes vacuously on the 0-file GGUF scan

**Purpose:** Final `model-integrity` job (`.gitlab-ci.yml:2101`, **`allow_failure:false`**, `before_script:[]`
stdlib-only). The **defence-in-depth chokepoint**: no `ai-eval` job runs unless model integrity passed. It
re-asserts the integrity evidence the upstream jobs produced — `needs:` all 9 integrity jobs
(`signature-verification`, `tamper-verification`, `modelscan`, `modelaudit-scan`, `modelfile-audit`,
`clamav-scan`, `hf-artifact-scan`, `dataset-scan`, `eval-dataset-validate`).

**Validated against the real log (branch `gaips-pipeline-required-fixes` @ `8061900`):** all 9 `needs:`
artifacts downloaded (tamper `14906999087`, signature-verification `14906999086`, modelscan `…088`,
modelaudit `…089`, modelfile-audit `…090`, clamav `…091`, hf-artifact `…092`, dataset-scan `…094`,
eval-dataset-validate `…096`). The gate then ran its checks and printed:
```
ModelScan gate check PASSED: no supported artifacts scanned
ModelScan gate check PASSED
ModelAudit gate check PASSED
Artifact signing gate PASSED — proceeding to evaluation
```
So: `integrity.env` existed and `tamper_check_passed=true` (no `GATE FAILED` on the tamper arm);
`modelscan.json` had 0 CRITICAL (and 0 scanned — see below); `modelaudit-summary.json` was not `failed` and 0
CRITICAL. Gate **PASSED**, `ai-eval` is unblocked.

**Findings:**
- ✅ **Genuine enforcing chokepoint, fail-closed by construction.** `allow_failure:false`, and every arm
  `exit 1`s on the bad path: missing `integrity.env` → fail; `tamper_check_passed != true` → fail; missing
  or CRITICAL-bearing `modelscan.json` → fail; missing/`failed`/CRITICAL `modelaudit-summary.json` → fail.
  This is the real "stop before eval if integrity failed" lever, and it depends on the now-hard
  `tamper-verification` (Fix #8 dropped its `allow_failure`) for the `tamper_check_passed` signal it trusts.
- ⚠️ **It NEVER inspects the signature-verification result — despite the name "signing gate".** It downloads
  `signature-verification`'s artifact (`14906999086`) but the script reads only `integrity.env` (tamper),
  `modelscan.json`, and `modelaudit-summary.json` — never any signature evidence. So `needs:[signature-verification]`
  is effectively just an ordering edge for this gate. **Consequence on this branch:** `signature-verification`
  *defers* (protected identity vars are empty on an unprotected ref — POST-PUSH FIX #2), so **no signature
  was actually verified anywhere this run, yet the gate named `artifact-signing-gate` still passes green.**
  The signing assurance rests entirely on `signature-verification`'s own `allow_failure:false`, not on this
  gate. Honest read: this is a *model-integrity* gate (tamper + malware), not a *signing* gate.
- ⚠️ **ModelScan arm is vacuous this run.** `"no supported artifacts scanned"` — the gate explicitly treats
  `total_scanned == 0` as PASS (lines 2142–2144), which is exactly the #21 GGUF coverage gap surfacing in
  the chokepoint: the only model is a GGUF that modelscan excludes, so the gate's modelscan check contributes
  zero signal. The real malware coverage in the gate comes from the **modelaudit** arm (#22 *does* scan the
  GGUF) and, upstream, the hard `clamav-scan` (#24). So the gate is meaningful, but one of its three arms is
  inert here.
- ⚠️ Minor hygiene: `before_script:[]` (stdlib-only, no pip), yet the job still **restored** the
  `pip-…-protected` cache (~53s, 3912 files) before doing pure-`python3` work — a cache:{} candidate in the
  spirit of Fix #15 (this job wasn't in that fix's explicit list). Upload was skipped ("primary cache already
  exists remotely"), so only the restore is wasted.

**Verdict:** ✅ **Real enforcing chokepoint — it fails closed on missing/failed tamper + modelaudit + modelscan
evidence and correctly gated this run as PASS.** Two honest caveats keep it off an unqualified ✅: (1) it does
**not** verify the signature path it's named for — the deferred `signature-verification` on this branch means
nothing in the chain actually checked a signature, and this gate wouldn't catch that; (2) its ModelScan arm
passes vacuously on the 0-file GGUF scan, so real malware coverage in the gate is carried solely by ModelAudit
(+ upstream ClamAV). Within "did model integrity (tamper) pass?" it's a solid hard gate. **`model-integrity`
stage COMPLETE — 17/20 documented (#30/#31/#32 deferred pending a run).**

---

## markllm-watermark-eval  (stage: ai-eval, `allow_failure: true`)  ✅ (genuinely works — it really loaded a 1.5B model on CPU and embedded + detected KGW watermarks, not theater) ⚠️ but it evaluates a DIFFERENT, UNVERIFIED artifact than the one the whole model-integrity chain just protected — a chain-of-custody break

**Purpose:** First `ai-eval` job documented (`.gitlab-ci.yml:2199`, `image: python:3.10-slim`,
`needs:["artifact-signing-gate","model-manifest"]`, **`allow_failure: true`** — explicitly advisory: the
comment notes the live eval pulls a multi-GB model onto a small runner, so a failure should record evidence,
not block the security pipeline). Runs a live MarkLLM watermark eval: derive a model id, install
torch/transformers/markllm, embed a KGW watermark into generated text for 2 prompts, then detect it —
emitting `markllm-results.json` as evidence.

**Validated against the real log + artifact (branch `gaips-pipeline-required-fixes` @ `8061900`, job
`14906999102`):** **it PASSED with real work** (I expected a small-runner failure; it succeeded). Log:
`MarkLLM model id (resolved): Qwen/Qwen2.5-1.5B-Instruct`; installed the pinned stack; ran on `device: cpu`
(step took 05:22); generated + detected watermarks for both prompts. Artifact `markllm-results.json`:
`status:"passed"`, `algorithm:"KGW"` (bundled `markllm/config/KGW.json`), `metrics.prompt_count:2`,
`detections_completed:2`, both prompts `detection.is_watermarked:true` (scores **6.25** and **4.53**). This
is a genuine, functioning watermark eval — embedding and statistical detection actually happened.

**Findings:**
- ⚠️ **HEADLINE: chain-of-custody break — the evaluated model is NOT the verified model.** The whole
  `model-integrity` stage (sign #18 / verify #19 / tamper #20 / modelaudit #22 / clamav #24 / gate #33)
  protected the **q2_k GGUF** (`qwen2.5-1.5b-instruct-q2_k.gguf`, sha `5ede348e…`). But this job's id
  derivation takes `MODEL_FIXTURE_URL` (`…/Qwen/Qwen2.5-1.5B-Instruct-GGUF/…`), strips the `-GGUF` suffix,
  and resolves **`Qwen/Qwen2.5-1.5B-Instruct`** — a *different artifact* (full-precision transformers
  safetensors repo), pulled **fresh from Hugging Face at eval time with NO integrity check** (no sha pin, no
  signature verify, `model_revision: null` = unpinned revision). So immediately after the
  `artifact-signing-gate` chokepoint certifies model integrity, the very next stage downloads and runs an
  **unverified, different model**. The gate's assurance does not extend to the thing actually evaluated.
  Root cause is structural: MarkLLM needs a transformers model, but the integrity path ships a llama.cpp
  GGUF — the two formats can't be the same bytes, so the pipeline verifies one and evals the other. *Fix
  direction:* sign/verify the transformers artifact too (pin `MARKLLM_MODEL_ID` + a revision/sha and verify
  it), or eval the GGUF via a GGUF-capable runner so the verified bytes are the evaluated bytes.
- ⚠️ **Dead `min_length` constraint (config bug, silently overridden).** Twice: `UserWarning: Unfeasible
  length constraints: min_length (160) is larger than the maximum possible length (141/138)… max_length is
  set to 141`. `MARKLLM_MIN_LENGTH=160` exceeds the effective `max_length` (prompt + default
  `max_new_tokens=128`), so transformers ignores it and stops early. The watermark still embedded/detected,
  but the 160-token floor the config asks for is never enforced — shorter generations could weaken detection
  reliability without any signal. Reconcile `MARKLLM_MIN_LENGTH` with `MARKLLM_MAX_NEW_TOKENS`.
- 🔴 **Cache `FATAL: … no space left on device` — recurrence of the #22 runner-disk exhaustion, now at the
  ai-eval stage.** Saving `pip-…-protected` (4528 files) failed: the accumulating shared pip cache (torch +
  transformers are huge) filled the runner disk again. Cache save is **best-effort and post-script**, so the
  job still went green (`markllm-results.json` uploaded `201`, "Job succeeded") — which **disguises a real
  reliability defect**.
  - **Why it's not cosmetic — it's self-reinforcing.** The save *failed*, so the cache was **not persisted**;
    the next run re-downloads the multi-GB stack, which *grows* the shared key further, which makes the next
    save fail again. The disk pressure compounds run over run.
  - **Intermittent/runner-local** (per #23, the same cache saved fine on other runners), so it passes
    sometimes and fails others — the flake profile that erodes trust in a green pipeline.
  - **Latent escalation risk.** Today it only hits the post-script save. If disk fills *during* a script step
    (a larger model, more deps), a job that should pass hard-fails for an infra reason unrelated to its work.
  - **Fix (concrete options):** Fix #15's `cache:{}` cleanup deliberately skipped the ai-eval jobs because
    they *do* use pip — but the shared `pip-…-protected` key is the root problem. Pick one: (a) give the
    heavy ai-eval installs a **separate, smaller cache key** so they stop bloating the key every other job
    restores; (b) **prune/cap** the shared key (size limit / periodic clear); or (c) `cache:{}` on these jobs
    and accept the re-download cost. (a) is preferred — keeps the speedup without the shared-key blowup.
- ✅ **Real, not theater — within its advisory remit.** `allow_failure:true` means it never gates, by
  explicit design (multi-GB model on a small runner). It happened to succeed here and produced genuine
  watermark evidence; on a failure it would still write `status:"failed"` evidence and not block. That's the
  intended behaviour, honestly implemented.

**Verdict:** ✅ **Genuinely functional live watermark eval** — it really loaded a 1.5B transformers model on
CPU and embedded + detected KGW watermarks (both `is_watermarked:true`), which is more than I expected from a
small runner. But the lead caveat is substantive and non-obvious: **it evaluates `Qwen/Qwen2.5-1.5B-Instruct`
(an unverified, unpinned, freshly-downloaded transformers repo) — NOT the q2_k GGUF the entire
model-integrity chain just signed/verified/scanned.** So the integrity guarantees the pipeline works hard to
establish do not cover the artifact this eval actually runs. Plus a dead `min_length` config constraint and a
recurring runner-disk-full on cache save (the #22 pattern at the heaviest install). Advisory job, so none of
this blocks — but the chain-of-custody gap is the kind of thing that makes a "signed + verified model"
narrative misleading if the evaluated/deployed artifact is something else. `ai-eval` 1/2 documented.

---

## markllm-deps-audit  (stage: ai-eval, `allow_failure: true`)  ✅ (real — `pip-audit` genuinely ran over the markllm dep tree and found real vulns, with GOOD explainability: every finding is logged + persisted) 🔴 but report-only — it found two arbitrary-code-execution vulns in the very libraries it audits (`torch`, `transformers`) and passed green; it's evidence, not a gate

**Purpose:** Second/last `ai-eval` job. Runs `pip-audit` against the freshly-resolved markllm dependency
environment (torch + full CUDA-13 stack + transformers + markllm), prints a per-finding summary, and persists
`reports/markllm-deps-audit.json`. Run `80619005` (branch `gaips-pipeline-required-fixes`): **Passed / "Job
succeeded"**, on `python:3.10-slim`, cache `pip-gaips-pipeline-required-fixes-protected`.

**Findings:**

- 🔴 **Lead finding — it found two RCE-class vulns in the exact libraries it exists to audit and passed
  green.** `Found 11 known vulnerabilities in 3 packages`, "Job succeeded" immediately below → **non-gating,
  confirmed by behaviour.** A deps *audit* that enforces nothing on what it finds is a report, not a control.
  The three packages that matter (pillow is noise — see below):
  - `torch 2.12.0` — **CVE-2025-3000**: memory corruption via `torch.jit.script` (critical), **no fix**
    (`fix_versions=[]`).
  - `transformers 4.57.6` — **PYSEC-2025-217 / CVE-2025-14929**: X-CLIP checkpoint **deserialization RCE**,
    **no fix** (`fix_versions=[]`).
  - `transformers 4.57.6` — **CVE-2026-1839**: `Trainer._load_rng_state()` calls `torch.load()` without
    `weights_only=True` → **RCE** via a malicious `rng_state.pth`; **fixable** (`5.0.0rc3`).
  - So even the *fixable* RCE doesn't block, and two of the three have **no fix at all** — a gating policy
    here couldn't auto-remediate; it would force a risk-accept/pin-back decision the job never surfaces. The
    job emits raw `pip-audit` output with **no policy layer** (no severity threshold, ignore-list, or
    fix-available filter).
- 🔴 **Chain relevance — ties directly to the #35 chain-of-custody break.** CVE-2026-1839 is the same
  `torch.load`-without-`weights_only` deserialization class, in the *same* `transformers` that #35
  markllm-watermark-eval loads its (unverified, unpinned) model with. #35 already evals an artifact outside
  the integrity chain; #34 adds that the load path runs on a `transformers` with a known, **fixable** RCE in
  its checkpoint loader — and neither job blocks on it.
- ⚠️ **The "11" headline is inflated — 8 of 11 are pillow, off the threat path.** Pillow is transitive
  (matplotlib / sentence-transformers), an *image* library in a *text*-watermark pipeline. Its CVEs (libwebp,
  PDF-DoS, ImageMath eval, etc.) pad the count. The honest signal is **3 vulns in 2 model-loading packages**,
  not 11. `markllm 0.1.5` itself: 0 vulns.
- ✅ **Explainability is GOOD here — credit vs clamav #24.** The job prints every `id + package +
  fix_versions` to the log *and* persists `markllm-deps-audit.json`. You can fully audit what it found and
  what it chose to ignore. Right pattern; just wired to a non-enforcing outcome.
- ⚠️ **Audits this job's own freshly-resolved venv, not necessarily #35's runtime env.** Representative of
  markllm's dependency tree, but a parallel install — not the literal artifact the eval ran on.
- ✅ **Cache saved fine this run** (4323 files, blue-1) — **no disk-full**, unlike #22/#35. Reconfirms the
  disk-full is **intermittent/runner-local**, not deterministic.
- Minor: non-gating *mechanism* not visible — the `pip-audit \` invocation is collapsed in the log, so
  whether it's `|| true`, `--exit-code 0`, or relies on `allow_failure:true` can't be read off; the
  green-on-11-vulns *behaviour* is what's confirmed. Cross-ref: `setuptools 81.0.0` sits in this venv (the
  exact version #31 ydata-profile pins *below* for `pkg_resources`) — harmless here, just loose across the
  pipeline.

- 🔴 **It audits the AI stack in the wrong place, and only contingently.** There are *two* `pip-audit`
  jobs and they audit **disjoint** dependency universes: the `sast`-stage `pip-audit` (line 447) audits the
  root `requirements.txt` = `{pandas, requests, jinja2}` only (torch/transformers/markllm aren't in it, and
  the transitive tree under those three never reaches them — so the early "vuln scanning" stages are
  *structurally incapable* of seeing these CVEs); this job (line 2164) is the **only** place the ML stack is
  ever resolved/scanned. And it sits at stage 6 behind `needs: ["artifact-signing-gate", ...]` — so if any
  model-integrity gate hard-fails, the **only** audit of torch/transformers never runs. The CVE check that
  matters most is the easiest one to skip. *Fix:* decouple from the integrity chain so AI deps are audited
  regardless, and/or audit the ML stack in the early stage too (without bloating `requirements.txt`/the SBOM).
- 🔴 **The audit runs concurrently with — not before — the job that executes the audited deps.** #34 and #35
  markllm-watermark-eval are sibling `ai-eval` jobs both `needs:["artifact-signing-gate","model-manifest"]`;
  **#35 does not `needs:` #34**, so they run in parallel. #35 `pip install`s `torch/transformers/markllm`
  (line 2213) and live-loads a transformers model — the exact `torch.load`-without-`weights_only` path of
  CVE-2026-1839 — at the same time as / before the audit flagging it completes. The audit has **zero causal
  relationship** to whether the vulnerable deps get executed: scan and run happen together, and the scan is
  advisory. Both jobs read the *same* version vars (`TORCH_VERSION 2.12.0` / `TRANSFORMERS_VERSION 4.57.6` /
  `MARKLLM_VERSION 0.1.5`), so #34 audits *exactly* what #35 installs → it would make a valid gate. *Minimum
  fix:* `markllm-watermark-eval` → `needs:[markllm-deps-audit,...]` so the audit runs first. *Proper fix:*
  gate the audit on fixable criticals (drop `|| true`/`allow_failure`; fail when any vuln has non-empty
  `fix_versions`) so a known-RCE `transformers` can't be installed-and-executed downstream. "Audit before you
  run untrusted code" — currently it's "audit *while* you run it."

**Verdict:** ✅ **Real and well-instrumented advisory audit** — `pip-audit` genuinely ran, found genuine
vulns, and logged + persisted them auditably. But the headline is the same shape as the rest of the AI
controls: **it surfaces RCE-class vulns (including a fixable one) in `torch`/`transformers`, the libraries
that load and run the model, and passes green** because it's report-only. Worse than report-only on placement:
it's the **only** scan of the AI dependency stack, it sits behind the entire model-integrity chain (skipped if
any of those gates fail), and it runs **concurrently with** rather than **before** #35, which installs and
executes those exact deps — so the audit can't prevent the vulnerable load even in principle. Combined with
#35, the `ai-eval` stage *describes* AI risk well and *enforces* none of it. `ai-eval` **2/2 complete.**

---

## model-drift-detection  (stage: guardrail, `allow_failure: true`)  🔴 (DEAD-BY-CONSTRUCTION — a guardrail-stage drift control that can NEVER fire in this pipeline: it reads six eval files that were moved to a different project, and ignores the one eval this pipeline produces) — honest skip, `allow_failure` by design

**Purpose:** First `guardrail` job (`.gitlab-ci.yml:2248`, `python:3.11-slim`). Runs
[`detect_model_drift.py`](scripts/detect_model_drift.py): extract normalized numeric metrics from the AI-eval
stage's report files, compare to the committed baseline `evals/eval-baseline.json`, flag any metric moving
beyond `DRIFT_THRESHOLD 0.10`. Report producer, never blocks — the comment names `drift-gate` (after the BOM)
as the hard gate. Run `80619005`: **Passed**, `model-drift.json = {"skipped":true,"reason":"no metrics"}`, log
`No eval metrics found — drift detection skipped`.

**Findings:**

- 🔴 **It reads six metric files that NO job in this pipeline produces.** `extract_metrics()` looks for
  `inspect-ai-results.json`, `garak-results.json`, `pyrit-results.json`, `giskard-results.json`,
  `guardrail-regression.json`, `promptfoo-results.json`. `grep` for those job names in `.gitlab-ci.yml` → **0**:
  all six (`promptfoo-eval`/`garak-scan`/`giskard-scan`/`inspect-ai-eval`/`pyrit-scan`/`guardrail-regression`)
  were split out to `docs/gaips-materials/ci/live-scans.gitlab-ci.yml` (the separate inference project, 2026-06-16).
  So in the static pipeline those reports are **never generated** → `extract_metrics()` always returns `{}` →
  it skips **every run, by architecture**. This is not "inert pending input" like the dataset jobs — nothing
  you can do to *this* pipeline makes it fire.
- 🔴 **The one eval that DOES run here is invisible to it.** #35 markllm-watermark-eval writes
  `markllm-results.json` (real watermark scores). `detect_model_drift.py` has **no branch** for that filename
  → the only live eval in this pipeline is dropped. The detector looks for metrics this pipeline doesn't make,
  and ignores the metric it does.
- ⚠️ **The committed baseline confirms (and cements) the mismatch — resolves a stale OPEN item.** The "seed
  must be captured + committed" open item is DONE: `evals/eval-baseline.json` exists with
  `{giskard.high_findings:0.0, guardrail.pass_rate:1.0}` — but both metrics come from **live-scans-only** jobs
  (giskard, guardrail-regression). So the baseline measures the *other* pipeline's world while current metrics
  here are always empty; the detector can't even fall into the harmless seed path — it has a real baseline it
  will never compare against.
- ✅ **Honest skip / good explainability** — `{skipped:true,reason:"no metrics"}` + clear log line; does not
  pretend to have checked drift (consistent with don't-disguise-breaks).
- ✅ **`allow_failure:true` is correct by design** — explicit report-producer; hard gate is `drift-gate` after
  the BOM. **But it hands the problem downstream:** `model-drift.json` is permanently `{skipped:true}`, so
  whatever `drift-gate` does with a *skipped* report decides whether the whole drift mechanism is vacuous.
  **SCRUTINIZE `drift-gate` hard** when reached — if it treats "skipped" as pass, drift detection is
  end-to-end theater in the static pipeline.
- ⚠️ Artifact WARNING `eval-baseline.seed.json: no matching files` — declared artifact never written (script
  returns at the no-metrics branch before the seed branch). Cosmetic, job green; same skip-path family as #23.
- Minor: pure-stdlib script yet spins a venv + `pip install --upgrade pip setuptools wheel` and restores/saves
  the 4323-file pip cache (~2 min) for nothing (`cache:{}`/no-venv candidate, Fix #15 waste family). Downloads
  ~30 upstream artifacts to scan for 6 filenames, none present — wasteful `needs:` breadth, harmless. Cache
  saved fine (4323, blue-2), no disk-full.

**Verdict:** 🔴 **A guardrail control that cannot fire in the pipeline it ships in.** Honestly *reported* as
skipped, `allow_failure` by design — but dead in substance: it reads six eval files relocated to another
project and ignores `markllm-results.json`, the only eval this pipeline produces; the committed baseline is
sourced from the other pipeline too. Same "green-but-does-nothing" class as the Tier-1 fixes. **Resolved diagnosis (Fix
#24):** this job's detector reads *only* the six live-scan eval files — its sole purpose is to consume their
output, so when those six jobs were split to `live-scans.gitlab-ci.yml` (2026-06-16) **`model-drift-detection`
should have moved with them and was missed.** It's not a wiring bug to patch here; it's a job in the wrong
pipeline. **Fix = Fix #24a: MOVE the eval-metric unit (`model-drift-detection` + `detect_model_drift.py` +
`eval-baseline.json` + its bootstrap logic) into live-scans, DELETE that unit here** (rejected grafting a
`markllm-results.json` branch — overloads one job + leaves six dead readers; watermark-score drift, if wanted,
is a separate check next to #35). Knock-on: `drift-gate` here loses its eval-drift input → re-scope/remove it.
**Do NOT blanket-delete `model-baseline-commit` #37** — the bootstrap is needed for the *data*-drift baseline
that stays here (Fix #24b: re-point it at evidently-drift #38's `dataset-reference.jsonl`).

> **🔧 UPDATE (2026-06-18):** the knock-on is now actioned — **`drift-gate` was REMOVED** from the static pipeline (confirmed theater at #44). `model-drift-detection` here stays a (dead-by-construction) report producer pending the Fix #24a relocation to live-scans; it no longer feeds any gate. See the #44 UPDATE note.

---

## model-baseline-commit  (stage: guardrail, `allow_failure: true`)  ⛔ DOES NOT INSTANTIATE on this branch (default-branch-only; not a skip — absent from the run, like `sigstore-identity-discover`)

`rules: if $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH` (line 2291) → no job on the `gaips-pipeline-required-fixes`
run; present in git (`8061900:2277`, working tree `2284`, added `fa04752`) — **not removed**, just gated off.
`needs:[model-drift-detection]`; sole purpose = auto-commit the seeded `eval-baseline.json` to the default
branch when `GITLAB_PUSH_TOKEN` is set (else prints a manual-commit hint). **Per user: it was run MANUALLY**,
which is how the committed `eval-baseline.json` (115 B, live-scans-sourced metrics) got into the repo — i.e.
the baseline is a **manual artifact, not a normal-pipeline product**, reinforcing the wrong-universe finding.
**Fix #24 — KEEP, do NOT delete (revised from the earlier over-collapsed "delete all four").** This is the
self-bootstrap that writes a seeded baseline back to the repo (`cp seed → dest`, `git commit`, `git push -o
ci.skip HEAD:default`) — **without it a drift control has no baseline and stays in seed-mode forever.** Only
the *eval-baseline* commit logic moves to live-scans with the detector (Fix #24a); the job itself **stays in
this pipeline, re-pointed at evidently-drift #38's seed** (`dataset-reference.seed.jsonl` →
`evals/dataset-reference.jsonl`) — because #38 (the real data-drift control here) currently has **no
baseline-commit job → its reference never auto-materializes → it can never compare** (Fix #24b). 🛑 **CRITICAL
(the precise defect):** as written, #37 **commits the WRONG baseline** — it hardcodes `eval-baseline.seed.json
→ evals/eval-baseline.json` ([.gitlab-ci.yml:2301-2302](.gitlab-ci.yml#L2301-L2302)) (the eval-metric baseline
for the dead #36) and **never touches `evals/dataset-reference.jsonl`**. So the one bootstrap the pipeline has
feeds a dead control and starves the live one; this is what keeps #38 permanently in seed-mode. Caveats: the
bootstrap fires only on **default branch + `GITLAB_PUSH_TOKEN` + a real seed** (never on feature branches —
why today's `eval-baseline.json` is a MANUAL artifact, not auto-path-proven), and commits **straight to `main`
bypassing MR**. Not a per-run-validatable job on this branch. `guardrail` **2/3 defined (1 instantiated + 1
default-branch-only); #38 evidently-drift next.**

---

## evidently-drift  (stage: guardrail, `allow_failure: true`)  ⚠️🔴 ran in SEED-MODE — never compared, never imported Evidently

**Purpose:** The pipeline's input-side **data-drift** control (the complement to #36's *eval-metric* drift). It is meant to compare this run's eval dataset against a committed reference snapshot (`evals/dataset-reference.jsonl`) via Evidently's `DataDriftPreset(method="psi")` + `TextEvals` text descriptors, write an HTML drift report into the 90-day evidence bundle + a JSON summary, and (currently `allow_failure:true`) harden to a hard gate once a reference is committed and tuned.

**Verdict:** ⚠️🔴 Correctly *designed* and it *did run* (unlike #36, which is dead-by-construction) — but this run it did **no drift work**. With no committed reference it took the seed branch and **returned before importing Evidently**, so PSI/`DataDriftPreset`/`TextEvals` never executed; the green `drift_detected:false` is the seed default, not a measured result; `evidence/evidently/` is an empty dir (no HTML). With no auto-commit path for its reference (Fix #24b) it is **structurally stuck in seed-mode**. The one genuine positive: the redacted dataset reached it (records=2), re-proving the #1 chain fix. **`guardrail` stage COMPLETE — 3/3** (#36 dead-by-construction, #37 default-branch-only/absent, #38 ran-but-seed-mode).

**What it did this run (`80619005`, artifact `14906999104`):**
1. `pip install evidently pandas` → **evidently 0.7.21** + a ~73-package stack (unpinned; see findings).
2. `find ${EVIDENCE_DIR}/dataset-input` → **DATASET_FILE found** (the bash "no dataset present" skip did NOT fire) → `run_evidently_report.py` invoked with `--current <redacted fixture>`. Confirms `dataset-redact`'s bytes propagated via `needs:[dataset-redact, eval-dataset-validate]` (records=2 = the 2-row fixture). ✅
3. Reference **absent** → seed branch ([run_evidently_report.py:96-107](scripts/run_evidently_report.py#L96-L107)): wrote `reports/dataset-reference.seed.jsonl`, returned **before** `from evidently import …` (line 111).
4. Report: `{"skipped":false,"seeded":true,"records":2,"drift_detected":false}`. Job **succeeded** (green).

**Findings (most damning first):**
- 🔴 **F1 — Seed-mode = vacuous green; it never compared anything.** `drift_detected:false` is the hard-coded seed default ([line 106](scripts/run_evidently_report.py#L106)), not a computed "no drift." Evidently was installed but never imported (early `return` at line 107 precedes the import at line 111) → zero drift signal behind a green check. Same "present but inert" pattern as vault/dvc/trivy-image.
- 🔴 **F2 — Permanent seed-mode, no activation path (Fix #24b, hard-confirmed).** The seed is only an artifact; activating drift requires a human to copy it to `evals/dataset-reference.jsonl` and commit. **No auto-commit job targets it** — `model-baseline-commit` #37 bootstraps `eval-baseline.json` (the eval-metric baseline), not this one. Pre-run `git ls-files` showed no `dataset-reference.jsonl` anywhere; the run confirmed the seed path. So #38 re-seeds every run and can never compare.
- 🔴 **F3 — Empty evidence folder confirms it (user-observed).** `evidence/evidently/` upload = `found 1 … files and directories` = just the empty `mkdir`'d dir. The HTML save ([line 133](scripts/run_evidently_report.py#L133)) is *after* the seed-branch return, so no `drift-report.html` is ever produced — a hollow evidence contribution.
- 🔴 **F4 — Seed corrupted #1: Presidio over-redacted a KEY field (a `dataset-redact` #28 quality bug).** Source `ci-dataset.jsonl` row 2 is `"id":"ci-benign-002"`; the redacted output is `"id":"<PERSON>"`. #28's Presidio misclassified the synthetic id as a PERSON and replaced it — and **non-deterministically**: the near-identical `ci-benign-001` survived. So the seed is **non-reproducible**, and multiple PERSON-flagged ids would collide on `<PERSON>`. First concrete evidence of #28's redaction *quality* (it runs, but over-redacts).
- 🔴 **F5 — Seed corrupted #2: invalid JSON (`NaN`).** The two rows have disjoint columns (`question` vs `prompt`); pandas unioned + NaN-filled them and `json.dumps(allow_nan=True)` emitted literal `NaN` ([lines 100-101](scripts/run_evidently_report.py#L100-L101)). `NaN` is not valid JSON (RFC 8259) — `json.loads` tolerates it but jq / strict validators / the `eval-dataset.schema.json` contract reject it. Two of three text columns are now 50% NaN (vacuous even if compared).
- ⚠️ **F6 — Unpinned bleeding-edge stack.** `pip install evidently pandas` (no `==`) floated to evidently 0.7.21, **pandas 3.0.3 (major 3.x)**, numpy 2.4.6, scikit-learn 1.9.0, scipy 1.17.1, pyarrow 24.0.0. Non-reproducible, and since the comparison path never ran, **compat of evidently 0.7.21 with pandas-3/numpy-2 is UNVERIFIED** — the first real run will be its first test.
- ⚠️ **F7 — Shared-cache bloat (ties to Fix #15 + the #22/#35 `no space left`).** Re-saved the shared `pip-gaips-pipeline-required-fixes-protected` cache (4022 files) after adding ~250 MB of wheels (pyarrow 48 MB, scipy 35 MB, numpy 17 MB, plotly 19 MB…) the seed path never uses — into the same key that hit `no space left on device`.
- ⚠️ **F8 — 2-row fixture → statistically vacuous even when activated.** PSI/Wasserstein over 2 records is meaningless; the control needs a realistically-sized reference, not just *any* committed file.

Seed contents (pasted `dataset-reference.seed.jsonl`):
```
{"id":"ci-benign-001","question":"What is the approved use…","expected":"…","category":"ci-fixture","prompt":NaN}
{"id":"<PERSON>","question":NaN,"expected":"…model artifact signing…","category":"ci-fixture","prompt":"Summarize the purpose of model artifact signing…"}
```

**🔴🔴 drift-gate watch (carry to #39+):** #38 emits `drift_detected:false` (seed default) and #36 emits `{skipped:true}`. If **`drift-gate`** (line 2645) PASSes on these, the entire guardrail-drift layer is **theater**. Verify its logic explicitly when documenting it. → **[RESOLVED at #44, 2026-06-18: `drift-gate` DID pass on the `{skipped}` report (confirmed theater) and was subsequently REMOVED. Consequence: `evidently-drift` #38 data drift is now UNGATED in the static pipeline — if enforcement is wanted, add a small gate over #38 once it has a real reference; see the #44 UPDATE note.]**

**How activation works (for understanding — the compare logic already exists, it's just gated behind a missing file):** `run_evidently_report.py` contains the **full** drift-comparison path; it never runs only because it early-returns at the **seed branch** ([:96-107](scripts/run_evidently_report.py#L96-L107)) when `evals/dataset-reference.jsonl` is absent. The instant that reference file exists, control falls through to the real run ([:109-164](scripts/run_evidently_report.py#L109-L164)): Evidently builds the current+reference `Dataset`s, runs `DataDriftPreset(method="psi")` + `TextEvals`, saves `evidence/evidently/drift-report.html`, writes the full `evidently-drift.json` verdict (`drift_detected`, `drifted_columns`, `drift_share`, record counts), and **`raise SystemExit(1)` on detected drift** ([:160-163](scripts/run_evidently_report.py#L160-L163)). ⇒ **No code change is needed to make it *document* drift — only a committed reference.** (And because the script already `exit 1`s on drift, *enforcing* it needs only dropping this job's `allow_failure: true` — no separate gate, especially now that `drift-gate` is removed.)

**Recommended fixes** (finding → fix):
1. 🛑 **CRITICAL — F1/F2 (no activation path): `model-baseline-commit` #37 commits the WRONG baseline.** #37 is the pipeline's *only* auto-commit job, but it hardcodes `eval-baseline.seed.json → evals/eval-baseline.json` ([.gitlab-ci.yml:2301-2302](.gitlab-ci.yml#L2301-L2302)) — the **eval-metric** baseline for the dead-by-construction #36 — and **never touches `evals/dataset-reference.jsonl`**, the reference *this* data-drift control needs. So #38's reference can never auto-materialize and #38 is **structurally stuck in seed-mode forever** (no amount of re-running activates it). **Fix (Fix #24b):** add/clone a data-drift bootstrap that commits the data-drift seed (`reports/dataset-reference.seed.jsonl → evals/dataset-reference.jsonl`), reusing #37's mechanism — **but** with a **sanitize/validate** step, NOT a raw `cp seed → dest`, because this run's seed is corrupted (F4 `<PERSON>` over-redaction + F5 invalid `NaN` JSON + F8 2-row).
   - **#37's mechanism, to clone (the template):** it runs **only on the default branch** (`rules: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`) and **only when all three hold** — (a) a seed file was produced this run, (b) `GITLAB_PUSH_TOKEN` (a `write_repository` PAT) is set, and (c) the destination baseline doesn't already exist. Those guards make it a **one-time, self-disabling bootstrap** (it won't clobber an existing baseline or fire on feature branches). When they hold it does `cp seed → dest` → `git commit -m "… [skip ci]"` → `git push -o ci.skip HEAD:<default>`; **both** `[skip ci]` and `-o ci.skip` stop that push from triggering a fresh pipeline (no commit→pipeline→commit loop). It pushes **straight to the default branch, bypassing MR review** — acceptable for a CI bot seeding a baseline, but record it as a deliberate **governance exception**.
2. **F3 (empty evidence)** → resolved once F1/F2 land and the comparison path runs (it writes the HTML); meanwhile don't bundle an empty `evidently/` dir as evidence.
3. **F4 (Presidio over-redaction of id)** → fix `dataset-redact` #28: exclude id/key fields from PII redaction (or allow-list the `ci-benign-*` id pattern); prefer building the reference from *pre*-redaction data, since redaction non-determinism is itself a drift source.
4. **F5 (invalid-JSON `NaN`)** → normalize missing fields before serializing the seed (drop NaN / emit `null`); reconcile the row-1/row-2 schema heterogeneity so columns aren't half-missing.
5. **F6 (unpinned stack)** → pin the drift stack (mirror the signing-toolchain pins) and verify the comparison path against the pinned versions once a real reference exists. **⚠️ Pairing required — see CRITICAL Fix #0:** the entire drift stack (`evidently` + ~73 pkgs incl. `cryptography 49.0.0`, `scipy`, `scikit-learn`, `pandas 3.0.3`) is **audited by NO `pip-audit` job** — the sast audit covers only `requirements.txt` (pandas 2.3.3/requests/jinja2), and #34 only torch/transformers/markllm. Pinning a library nothing audits just freezes a blind spot; F6 must be paired with extending `pip-audit` to cover this job's installed env (Fix #0). Note the audit/runtime mismatch: pip-audit cleared pandas **2.3.3**, this job runs pandas **3.0.3**.
6. **F7 (cache bloat)** → scope a separate/smaller cache key for the heavy drift/eval jobs, or `cache:{}` on the seed path.
7. **F8 (2-row fixture)** → commit a realistically-sized, clean reference snapshot before flipping `allow_failure:false`.
8. **drift-gate watch** → verify `drift-gate` does not treat `{seeded}`/`{skipped}` as PASS (else the guardrail-drift layer is vacuous). *(Moot as of #44 — `drift-gate` was confirmed to do exactly this and was removed; #38 is now ungated.)*

**Resume at `evidence` stage: #39 evidence-summary, #40 model-signing-evidence.**

---

## evidence-summary  (stage: evidence, NO `allow_failure`)  ⚠️ real bundler + a genuine gate — but the gate checks file PRESENCE, never the artifacts' verdicts

**Purpose:** Assemble the end-of-pipeline **evidence bundle** (90-day artifact): run `write_ci_evidence_summary.py` over `${REPORTS_DIR}` to emit a human-readable `evidence-summary.md` listing which report artifacts are present, bundle the seeded drift baseline (for the maintainer to commit) + the approved `model-baseline.json` (records the exact pinned model identity), and — with **no `allow_failure`** — gate the pipeline on the required evaluation artifacts.

**Verdict:** ⚠️ It does genuine work (downloads all ~26 upstream artifacts, writes the summary, bundles `model-baseline.json`) and is a **real gate** (no `allow_failure` → it *would* red-line the pipeline if a required artifact were absent) — but the gate is a **file-PRESENCE check, not a verdict check**. It tests only that `semgrep.json` and `markllm-results.json` *exist* (`.exists()`, [write_ci_evidence_summary.py:37-41](scripts/write_ci_evidence_summary.py#L37-L41)) and **never opens them**, so a run where semgrep found 100 issues or markllm failed detection passes green as long as the two files are written. The summary's own wording is technically honest ("All required live-evaluation artifact **paths** are present") but reads as an evaluation verdict at a glance. Real enforcement lives in the individual jobs, not here.

**What it did this run (`80619005`, artifact `14906999105`):**
1. `pip install jinja2` → jinja2 3.1.6 (unpinned; Fix #0 instance — see F6).
2. Downloaded ~26 `needs:` artifacts; ran the script → `evidence-summary.md`.
3. **Required (gated):** `semgrep.json`=True, `markllm-results.json`=True → "All required … paths are present" → exit 0.
4. **Advisory (display-only):** `modelaudit-summary.json`=True, `evidently-drift.json`=True, `dvc-status.json`=True; `great-expectations.json`=**False**, `ydata-profile.json`=**False**, `dependency-track.json`=**False**.
5. Bundled `model-baseline.json` ✅. **`eval-baseline.seed.json` → upload WARNING "no matching files"** (the seed #36 was meant to produce doesn't exist). Job **succeeded**.

**Findings (most damning first):**
- 🔴 **F1 — Presence ≠ pass; the gate never reads the artifacts.** `EXPECTED = [semgrep.json, markllm-results.json]`, checked via `.exists()` only — the script opens no file and inspects no finding/verdict. semgrep findings, a markllm watermark-detection failure, etc. all pass as long as the files exist. An existence gate presented as an "evaluation gate."
- 🔴 **F2 — The "required" set is just 2 weak files; the strongest controls aren't checked at all.** Post-split, `EXPECTED` was trimmed to `semgrep.json` + `markllm-results.json`. None of the hard gates' outputs — `clamav-scan`, `signature-verification`/`tamper-verification`, `dataset-scan`, `artifact-signing-gate`, `pip-audit` — are in `EXPECTED` *or even* `ADVISORY`. So a core integrity report silently going missing would **not** trip this gate; it verifies the integrity chain produced nothing.
- ⚠️ **F3 — Advisory `False` rows blur "skipped-by-design" vs "broken."** `great-expectations.json`=False (#30 deferred, ff9bd7e unpushed), `ydata-profile.json`=False (#31 same), `dependency-track.json`=False (DT creds unset) — all legitimately absent here, but the table renders a bare `False` with no 3-state distinction. A genuinely broken producer looks identical to a deferred one (same skip-disguises-break theme as #22/#29).
- ⚠️ **F4 — It bundles vacuous/empty evidence as if it were signal.** `evidently-drift.json`=True is the **seed-mode** report (`{seeded:true,drift_detected:false}` — no drift assessment, per #38), and the bundle also carries #38's empty `evidence/evidently/` dir. "Present:True" overstates — a drift report exists but contains no drift verdict.
- ⚠️ **F5 — The drift-baseline bundle path is dead (confirms #36).** Lines 2409-2411 bundle `eval-baseline.seed.json` *if present* — it isn't (upload WARNING), because #36 skipped before producing a seed (dead-by-construction). The advertised "grab the seed from the evidence bundle and commit it" workflow has nothing to grab. Upload WARNs; job still succeeds (the path sits unconditionally in `artifacts:`).
- ⚠️ **F6 — Unpinned + unaudited `pip install jinja2` (Fix #0 instance).** Resolved to 3.1.6 here, but the command floats and this install is audited by no `pip-audit` job — jinja2 is pinned/audited in `requirements.txt` yet re-installed via a separate floating command here. Concrete Fix #0 example. (Minor: 4323-file shared-cache save for a one-package install.)

**Positives:** genuinely produces the readable summary, records the exact pinned model identity (`model-baseline.json`), and is a *real* (non-`allow_failure`) gate that would fail on an absent required artifact — not theater, just a shallow gate.

**Recommended fixes** (finding → fix):
1. **F1 (presence-only gate)** → make it read verdicts: parse `semgrep.json` (fail on error-severity / over-threshold findings), `markllm-results.json` (fail on `is_watermarked:false`), etc. — or reframe it honestly as a "bundle-completeness" check and keep enforcement in the individual jobs. Don't call it an evaluation gate if it only checks existence.
2. **F2 (thin required set)** → add the integrity-chain outputs that must exist (clamav, signature/tamper, dataset-scan, pip-audit, artifact-signing-gate result) to `EXPECTED`, so a silently-absent core control trips the gate.
3. **F3 (skipped vs broken)** → have each producer always emit a status artifact (`{skipped:true,reason}` when inert) and render a 3-state column (present / skipped-by-design / MISSING), failing only on MISSING.
4. **F4 (vacuous bundled as signal)** → surface each report's verdict in the table (e.g. evidently → `seeded` vs `compared`), not bare presence; don't bundle the empty evidently HTML dir.
5. **F5 (dead seed bundle)** → resolved once #36/#38's baselines actually produce a seed (Fix #24a/#24b); until then flag the step as inert rather than WARN-and-continue.
6. **F6 (unpinned/unaudited jinja2)** → CRITICAL Fix #0 (audit the job's installed env) + install the pinned `requirements.txt` jinja2 rather than a floating `pip install jinja2`.

**`evidence` stage 1/2. Next: #40 model-signing-evidence** (protected-var caveat may apply — see POST-PUSH FIX #2).

---

## model-signing-evidence  (stage: evidence, NO `allow_failure`)  ✅ genuine keyless Sigstore signing really happened (NOT deferred — the protected-var caveat does NOT apply here) ⚠️ but it NOTARIZES a recorded digest rather than verifying anything, the signature has NO downstream verifier (write-only), and it installs a 37-pkg signing stack it never uses

**Purpose:** Produce a signed, transparency-logged **provenance attestation** for the model: build a small JSON evidence bundle (pipeline id, commit, ref, timestamp, the model SHA-256 digests recorded by `model-digest` #17), then **keyless-sign it via Sigstore/cosign** so an external auditor can later prove "this pipeline, at this commit, recorded this model digest." This is the signing-side companion to the verification-side `signature-verification` #19.

**What it does:** Runs in `python:3.11-slim` with the shared secure-pip `before_script`. `pip install model-signing==${MODEL_SIGNING_VERSION} sigstore==${SIGSTORE_PY_VERSION}` (pinned 1.1.1 / 4.3.0 per Fix #11) → `apt-get install curl ca-certificates` → builds `evidence/model-signing-evidence.json` from `CI_*` vars + `evidence/model-digests.txt` ([.gitlab-ci.yml:2444-2461](.gitlab-ci.yml#L2444-L2461)) → downloads cosign pinned by `COSIGN_VERSION` and **checksum-verifies it** (`sha256sum --check --strict`) → `cosign sign-blob --yes` the bundle, emitting `.sig` + `.pem` ([.gitlab-ci.yml:2475-2485](.gitlab-ci.yml#L2475-L2485)). Keyless OIDC comes from the GitLab-native `id_tokens.SIGSTORE_ID_TOKEN` (aud `sigstore`), which cosign reads automatically. `needs: [artifact-signing-gate, model-digest, evidence-summary]`. Skips on `[sigstore-discovery]`; no `allow_failure`. Artifacts (`.json`/`.sig`/`.pem`) expire in 90 days.

**What it did this run (`80619005`, pipeline `2609319649`, artifact `14906999106`):**
1. Installed `model-signing 1.1.1` + `sigstore 4.3.0` + a ~37-pkg transitive stack (cryptography 48.0.1, pydantic, tuf, securesystemslib, …). Installed `curl`.
2. Wrote the bundle: `schema_version 1.0`, `pipeline_id 2609319649`, `commit_sha 8061900…`, `ref gaips-pipeline-required-fixes`, one `model_digests` entry = `/builds/…/qwen2.5-1.5b-instruct-q2_k.gguf  sha256:5ede348e…865b3a`.
3. cosign **pinned + checksum-verified** → `cosign-linux-amd64: OK`.
4. **Real keyless signing executed** (the `[ -n "${SIGSTORE_ID_TOKEN}" ]` branch fired — the else/unsigned branch did NOT): `Successfully verified SCT`, ephemeral Fulcio cert issued, **`tlog entry created with index: 1853780818`** (real Rekor entry), wrote `.sig` + `.pem`, `Evidence bundle signed via Sigstore keyless`. Job **succeeded** (green). All three artifacts uploaded (`201 Created`).

**Signing identity (decoded from the ephemeral `.pem`):** SAN URI `https://gitlab.com/natecarrollfilms/counter-spy//.gitlab-ci.yml@refs/heads/gaips-pipeline-required-fixes`; OIDC issuer `https://gitlab.com`; build-trigger `push`; bound to commit `8061900…`, job `14906999106`, project `natecarrollfilms/counter-spy`; 10-minute validity (`18:22:21`→`18:32:21Z`). A genuine, well-formed GitLab-CI workload identity — not a configured `MODEL_SIGNING_IDENTITY`.

**Findings (most damning first):**
- ✅ **NOT deferred — the handoff's protected-var caveat does NOT apply to this job.** Unlike `signature-verification` #19 (which keys off the **protected** `MODEL_SIGNING_IDENTITY`/`SIGSTORE_OIDC_ISSUER` vars and therefore defers on a feature branch), this job signs with the **GitLab-native `id_tokens` OIDC token**, which is injected on *any* ref. Confirmed: `MODEL_SIGNING_IDENTITY` appears nowhere in this job's block (only in #19's, [.gitlab-ci.yml:900-1024](.gitlab-ci.yml#L900-L1024)). So real signing evidence (SAN/issuer/Rekor index) exists here on the unprotected branch — document it as-is, no `main`-run needed.
- 🔴 **F1 — It NOTARIZES, it does not VERIFY.** The job signs whatever digest string `model-digest` #17 wrote into `model-digests.txt` — and #17 only *records* (`sha256sum`), never verifies (its own finding). `signature-verification` #19 (the real tamper gate) **defers on this branch**. So the signing chain here is "faithfully sign a recorded digest" with **no independent integrity check binding into it**: if #17 had recorded a tampered/wrong digest, this job would sign it just as happily and still go green. It's provenance notarization, not assurance.
- 🔴 **F2 — The signature is WRITE-ONLY: nothing verifies it downstream.** Grep confirms **no consumer** of `model-signing-evidence.{sig,pem,json}` anywhere in `.gitlab-ci.yml` or the scripts — the only `cosign verify` in the pipeline ([.gitlab-ci.yml:2768](.gitlab-ci.yml#L2768)) targets the container `IMAGE_REF` in `image-sign`, not this bundle. The `.sig`/`.pem` are merely bundled into the 90-day artifacts. So in-pipeline this is an unread attestation; its value is purely external (an auditor running `cosign verify-blob` later) — same "deliverable, no consumer" shape as `syft-spdx` #11.
- ⚠️ **F3 — Dead 37-pkg install of `model-signing` + `sigstore` (Fix #14 / #15 / #17 pattern).** All signing is done by the **cosign binary**; the `model-signing` and `sigstore` Python packages (and their cryptography/pydantic/tuf transitive tree) are **never imported or invoked**. The pin (1.1.1/4.3.0) is correct hygiene but pins a stack the job doesn't use — wasted ~install time and an **unaudited dependency surface** (no `pip-audit` covers it → Tier-0 Fix #0). This is the same "installs a stack it never uses" defect already flagged on `model-digest` #17 and `model-signing-install` #15.
- ⚠️ **F4 — The signed `model_digests` value carries the absolute runner build path.** The entry is `/builds/natecarrollfilms/counter-spy/models/…/qwen2.5-1.5b-instruct-q2_k.gguf  sha256:5ede348e…` — the meaningful part is the sha256; the leading `/builds/…` path is runner-specific and non-portable, weakening the attestation's readability/stability across runners (inherited from #17's `tee` format).
- ✅ **Genuine strengths:** cosign is **pinned + `sha256sum --check --strict`-verified** (`cosign-linux-amd64: OK`) — good binary-supply-chain hygiene (contrast `trivy:latest` #14); the signing pins are exact (Fix #11); `SCT` verified and a **real Rekor transparency-log entry** (index `1853780818`) was created; and with **no `allow_failure`** the job fails closed on its own operation (missing `model-digests.txt`, cosign/Fulcio failure, or checksum mismatch would red-line it).

**Recommended fixes** (finding → fix):
1. **F1 (notarizes, doesn't verify)** → sequence/condition this *after* a real verification: have it sign only once `signature-verification` #19 has actually verified the model on this ref (or fold the recomputed-vs-signed digest assertion in), so the attestation certifies a *verified* digest rather than a merely *recorded* one. On unprotected branches where #19 defers, mark the attestation `unverified: true` in the bundle.
2. **F2 (write-only signature)** → add a `cosign verify-blob --certificate-identity-regexp … --certificate-oidc-issuer https://gitlab.com` self-check on the freshly written `.sig`/`.pem` (mirrors the `image-sign` post-sign verify at [.gitlab-ci.yml:2768](.gitlab-ci.yml#L2768)), and/or document the external `verify-blob` command auditors should run. Don't ship an unverified signature as evidence.
3. **F3 (dead signing-lib install)** → drop `pip install model-signing sigstore` (cosign does all the work here) — or, if kept for some future use, add the installed env to pip-audit coverage (Fix #0). Either way `cache: {}` this job (the bundle build needs no pip cache).
4. **F4 (absolute path in attestation)** → record digests as `sha256:<hex>  <repo-relative-path>` in `model-digest` #17 so the signed evidence is portable.

**Verdict:** ✅ **Real keyless Sigstore signing genuinely happened** — Fulcio ephemeral cert, SCT verified, Rekor index `1853780818`, valid `.sig`/`.pem` — and it did so **on the unprotected branch** because it uses GitLab-native `id_tokens`, so the protected-var caveat that defers #19 does **not** apply here (important correction to the resume note). But the job **notarizes rather than verifies** (it faithfully signs whatever digest #17 recorded, with #19 deferred → no tamper check binds in), its signature is **write-only** (no in-pipeline `cosign verify-blob` consumer), and it carries the now-familiar **dead 37-pkg signing-lib install** + an absolute-path digest string. Genuine cryptographic provenance, thin assurance. **`evidence` stage COMPLETE (2/2). Next: #41 `ai-bom-assemble` (ai-bom stage).**

> **🔧 UPDATE (2026-06-17, post-validation overhaul — NOT yet run; pending the next pipeline):** this job was **renamed `model-signing-evidence` → `sign-evidence`** and substantially rebuilt to address the findings above. Changes in [.gitlab-ci.yml](.gitlab-ci.yml) (`sign-evidence:`):
> - **Moved to a new terminal `attest` stage (now the last stage in the pipeline, after `deploy-prep`).** It previously ran mid-pipeline in the `evidence` stage, so its "whole-run" hash-manifest structurally **could not see the `ai-bom` or `deploy-prep` outputs** — including the **signed AI-BOM** (`aibom.cyclonedx.{json,xml}` + `aibom-signing.pub`), the keystone attestable inventory. As the terminal job it now `needs:` all 38 artifact-producing jobs (stages 2–10) and hashes them. Verified safe: nothing `needs:` `sign-evidence` (no cycle), all 38 needs resolve to earlier stages, no stage-order violations. *(model blob NOT pulled — it `needs:` `model-digest`, not `model-fixture-download`, so the ~700 MB GGUF artifact is never downloaded.)*
> - **Bundle enriched from 6 fields to a full run-evidence manifest** (`schema_version 2.0`, `kind: gaips-run-evidence`) — rich pipeline metadata (url/source/created_at/ref_protected/triggered_by/runner/job), model identity from `model-baseline.json` (`approved_sha256` vs `recorded_digests` + a `digest_match` boolean), and a **sha256 hash-manifest of every file under `reports/`, `sbom/`, and `evidence/`** — so the single signature binds the integrity of the **whole run's** evidence set, addressing the "WAY too light" gap.
> - **F2 (write-only) addressed** — added a `cosign verify-blob` self-verify of the freshly-produced `.sig`/`.pem`, which `exit 1`s the job on a bad signature.
> - **F3 (dead install) removed** — dropped `pip install model-signing sigstore` (cosign does all signing; user confirmed cosign-over-model-signing is fine) and set `before_script: []` + `cache: {}` (stdlib-only manifest build).
>
> Still open: F1 (it still signs digests #17 *recorded*; binding it to a real verify needs #19 to not defer) and F4 (the absolute `/builds/…` path persists in `recorded_digests` until #17's `tee` format is fixed). **One design consequence of the terminal move:** `publish-signed-artifacts` (deploy-prep) runs *before* `sign-evidence`, so the run-evidence seal is **not** distributed to the deploy registry this run — it's a retained 90-day audit artifact. The deploy-facing attestation remains the signed AI-BOM (published by `publish-signed-artifacts`). If you'd instead want the seal itself published to the deploy gate, that's the alternative wiring — but it'd force `sign-evidence` **before** publish, which reintroduces the blind spot (it could no longer capture `deploy-prep`). You can't have both in one job; getting both would require a small two-part split (seal-and-publish the core artifacts mid-pipeline, then a terminal full-run hash). **Validate against the next run's `sign-evidence.json` (now in the `attest` stage) + the `Self-verify OK` log line.**

---

## ai-bom-assemble  (stage: ai-bom, **no `allow_failure`**)  ✅ (real work — assembles a genuine, populated CycloneDX 1.6 AI-BOM: 99 components with embedded real cosign signatures + faithful scan verdicts, not theater) ⚠️ but the "97 software components" FUSES TWO DISJOINT DEPENDENCY UNIVERSES (3 shallow `requirements.txt` pins + the ~94-pkg MarkLLM eval stack) into one flat list that misrepresents the run's real closure, and it emits NO CycloneDX `vulnerabilities[]` despite recording 11 known vulns (2 RCE-class)

**Purpose:** Consolidate every element the pipeline produced — software SBOM, the ML model (digest + signature + scan verdicts), the dataset (digest + scan + redaction + signature), and AI-eval / data-quality / drift evidence — into ONE CycloneDX 1.6 **AI-BOM** (`aibom.cyclonedx.json`). This is the pipeline's single attestable inventory; `ai-bom-sign` #43 then enveloped-signs it and `publish-signed-artifacts` ships it to the deploy gate.

**What it does:** `python3 build_ai_bom.py` ([scripts/build_ai_bom.py](scripts/build_ai_bom.py)) merges, all stdlib, graceful-degrade (missing input skipped, never fatal): (1) software ← lifts `components[]` from syft's `sbom.cyclonedx.json`; (2) **+ watermark stack** ← `markllm-deps-audit.json` deps not already present, deduped by purl/name; (3) model ← `model-digests.txt` + embedded `model.sig`/`model.pem` (base64 `data:` URI) + ModelScan/ModelAudit/ClamAV/HF verdicts as `gaips:` properties; (4) data ← `dataset-download/scan/redact.json` + `dataset.sig`, hash = **redacted** digest; (5) eval + data-quality evidence → root-component properties/refs. `needs:` 23 producers. **No `allow_failure`** (hard job).

**Run evidence (`80619005`, pipeline `2609319649`, artifact `14906999107`):** `AI BOM written … models=1 datasets=1 software=97 (total components=99)`. Valid CycloneDX 1.6, `serialNumber urn:uuid:e6f7818b…`, real `data:` URIs, job **succeeded** (green). Populated, not a shell.

**Findings (most damning first):**
- 🟡 **F1 — `software=97` fuses two disjoint, inconsistent dependency universes and overstates the run's real closure.** The syft half contributes only the **3 shallow `requirements.txt` pins** (`jinja2`/`pandas 2.3.3`/`requests`) + the `requirements.txt` file component — i.e. the same transitive-blind source-tree scan from `syft-cyclonedx` #10 (no `numpy`/`urllib3`/`certifi`/… for the *main* deps). The other **~93 components are the MarkLLM eval stack** grafted in from `markllm-deps-audit` (torch, transformers, all `nvidia-*` CUDA, `numpy 2.2.6`, `datasets`, `matplotlib`, …), each tagged `gaips:source=markllm-deps-audit`. These are **installed only in the ai-eval jobs, not in the static pipeline's runtime** — yet they sit in one flat `components[]` with the 3 main pins and no scope boundary. Net effect: an auditor reading "97 software components" sees an apparently-coherent closure that is really *3 declared root deps (transitive tree still missing) + 94 eval-only packages*. Even overlapping names mislead: `urllib3 2.7.0`/`certifi 2026.6.17`/`idna 3.18` appear, but as the **eval** env's versions, not the main env's. The dedupe + provenance tagging is good; the **conflation of two environments into one count** is the problem. Fix is partly upstream (#10 SBOM depth).
- ⚠️ **F2 — No CycloneDX `vulnerabilities[]` despite 11 known vulns (2 RCE-class) in hand.** `markllm-deps-audit` #34 found 11 vulns (torch 1, transformers 2 incl. the X-CLIP / `torch.load` RCE-class CVEs, pillow 8). The BOM records these only as `gaips:vulns.count` **property integers** on the torch/transformers/pillow components — it emits **no standard `vulnerabilities` array**. A consumer (Dependency-Track ingests this very BOM) gets no structured vuln data from the document; the two arbitrary-code-execution findings are invisible to any tool that reads the CycloneDX vuln schema. Under-uses the format for the one signal that matters most.
- ⚠️ **F3 — The dataset is recorded as UNSIGNED (`gaips:dataset.signed=false`), confirming `dataset-sign` #32 did not run on this commit.** `_signature_refs` found no `dataset-input/dataset.sig` → `signed=false`. Consistent with the handoff: #32's broken-chain fix is in the **unpushed `ff9bd7e`**, so on `8061900` the dataset was never cosign-signed. The model, by contrast, **is** signed (next finding). So this run's AI-BOM ships a signed model + an **unsigned dataset** — `publish-signed-artifacts`' dataset arm would have nothing to publish.
- ⚠️ **F4 — `signed=true` on the model conflates SIGNED with VERIFIED.** The model component embeds a **genuine Sigstore bundle** (decoded: `application/vnd.dev.sigstore.bundle.v0.3+json` with a Fulcio cert + Rekor tlog entry + DSSE over the GGUF) — real proof that `model-sign` #18 keyless-signed the model **on this branch** (it uses `id_tokens`, so unlike #19 it doesn't defer). But `signature-verification` #19 **deferred** on this unprotected ref, so nothing *verified* that signature this run. The BOM exposes `gaips:signed=true` with **no `verified` property**, so a reader can mistake "a signature exists" for "the signature was checked against the pinned identity."
- ⚠️ **F5 — Absolute runner path baked into the model `bom-ref` and `gaips:artifact.path`** (`model:/builds/natecarrollfilms/counter-spy/models/…/qwen2.5-…q2_k.gguf`). Non-portable / non-stable across runners — the same F4-class issue carried from `model-digest` #17's `tee` format, now propagated into the BOM's primary key for the model.
- ⚠️ **F6 — The "AI evaluation evidence" section is hollow in this static pipeline.** All six behavioural evals record `eval.{garak,giskard,inspect-ai,promptfoo,guardrail-regression,pyrit}.present=false` (correct — they moved to the live-scan pipeline), and `build_ai_bom.py`'s `EVAL_REPORTS` does **not** include `markllm-results.json`, so the one eval this pipeline *does* run (#35 watermark) is **not folded in**. Data-drift shows `data_drift.status=reference-seeded` — honest, but it's the vacuous seed-mode signal from `evidently-drift` #38. So the "AI" half of this AI-BOM carries no behavioural verdict.
- ℹ️ **F7 — `gaips:version.dirty=true` recorded.** The embedded provenance (from `version-info.json`) reports a **dirty build tree** — notable given `setup` #1 found `dirty` was `null` (no git) on the `main` run; here it resolves to `true`, so either git is now present (Fix #20) and the tree is genuinely dirty at setup time, or the before_script mutated the tree before stamping. Worth confirming, but it's a `setup`/#17 provenance detail, faithfully surfaced here, not an ai-bom bug.
- ✅ **Genuine strengths:** real CycloneDX 1.6, hard job (no `allow_failure`), graceful-degrade design; **embeds the actual cosign model signature** as a self-describing `data:` URI (the sig covers the model bytes, not the BOM — embedding is sound); **faithfully records the real scan verdicts** (modelscan 0 critical/0 high, modelaudit `findings=2`/critical=0 — the #22 findings, clamav infected=0); correctly hashes the **redacted** dataset bytes (`4a7286e2…`, matching what was signed) and records the redaction counts (pii=1 — which we know is the #28/#38 Presidio false positive, faithfully surfaced); dedupes the watermark stack against syft by purl/name.

**Recommended fixes** (finding → fix):
1. **F1 (fused universes)** → fix the upstream SBOM depth (`syft-cyclonedx` #10 — scan an installed env so the *main* transitive closure is real), and scope the MarkLLM stack as a clearly-delimited eval sub-assembly (e.g. a nested `component` or a `gaips:scope=eval-runtime` boundary) so `bom.counts.software` no longer conflates two environments into one closure.
2. **F2 (no `vulnerabilities[]`)** → emit a CycloneDX `vulnerabilities` array from `markllm-deps-audit` (and `pip-audit`) — at minimum the 11 known vulns with their purls/severities — so Dependency-Track ingests structured findings, not property counts.
3. **F3 (unsigned dataset)** → resolved once `dataset-sign` #32 runs (push `ff9bd7e`); the BOM already reports it correctly meanwhile.
4. **F4 (signed≠verified)** → add a `gaips:model.verified` property sourced from `signature-verification` #19 (value `verified` / `deferred` / `failed`) so the BOM distinguishes "a signature exists" from "we checked it."
5. **F5 (absolute path)** → make `model-digest` #17 emit a repo-relative path; it flows into the BOM `bom-ref`/`artifact.path` automatically.
6. **F6 (hollow eval section)** → add `markllm-results.json` to `build_ai_bom.py`'s `EVAL_REPORTS` and fold `is_watermarked` into the root eval evidence; note the behavioural evals live in the live-scan pipeline.

**Verdict:** ✅ **Real work** — `ai-bom-assemble` genuinely consolidates the run into a valid, populated **CycloneDX 1.6 AI-BOM** (99 components), with an **embedded real cosign model signature** and **faithfully-recorded scan/redaction verdicts**; it's a hard job and not theater. But the keystone inventory has substance gaps: its **`software=97` fuses the 3 shallow main-pipeline pins with the ~94-package MarkLLM eval stack** into one flat count that overstates the real dependency closure (and inherits #10's transitive-blindness); it emits **no `vulnerabilities[]`** despite holding 11 known vulns (2 RCE-class); it ships a **signed model but an unsigned dataset** (confirms #32 deferred on `8061900`) and surfaces **`signed` without `verified`** (since #19 deferred); and its **behavioural-eval section is empty** in this static pipeline. **`ai-bom` stage 1/5. Next: #42 `ai-bom-validate` (schema 1.6 + XML render).**

---

## ai-bom-validate  (stage: ai-bom, **no `allow_failure`**)  ✅ (a real HARD schema-conformance gate — `cyclonedx validate --fail-on-errors` against CycloneDX 1.6, pinned CLI image, plus a faithful JSON→XML render for `ai-bom-sign`) ⚠️ but it validates FORM, not SUBSTANCE — "BOM validated successfully" means well-formed, not complete/correct, so every #41 content gap passes cleanly

**Purpose:** Gate the AI-BOM on CycloneDX 1.6 **schema conformance** (so downstream consumers — Dependency-Track, cosign, the deploy-time `cyclonedx verify` — can parse it), and render the canonical **XML** that `ai-bom-sign` #43 enveloped-signs.

**What it does:** Runs in the pinned `cyclonedx/cyclonedx-cli:0.32.0` image (`IMAGE_CYCLONEDX`, `entrypoint:[""]`, `before_script:[]`), `needs:["ai-bom-assemble"]`. (1) `/cyclonedx validate --input-file aibom.cyclonedx.json --input-format json --input-version v1_6 **--fail-on-errors**` ([.gitlab-ci.yml:2708-2712](.gitlab-ci.yml#L2708-L2712)); (2) `/cyclonedx convert … --output-format xml --output-version v1_6` → `aibom.cyclonedx.xml`. No `allow_failure` (hard gate).

**Run evidence (`80619005`, artifact `14906999108`):** image pulled by digest `sha256:9a858a15…` (= pinned `0.32.0`). `Validating JSON BOM... **BOM validated successfully.**` Convert ran; `aibom.cyclonedx.xml` found + uploaded (`201 Created`). Job **succeeded** (green).

**XML artifact cross-check (inspected directly):** faithful round-trip of the JSON — same `serialNumber urn:uuid:e6f7818b…`, all 99 components, the model's embedded cosign `data:` URI preserved intact, the redacted dataset hash (`4a7286e2…`), and the `gaips:` property set. Render is lossless.

**Findings (most damning first):**
- ⚠️ **F1 — Structural-only: it validates FORM, not SUBSTANCE.** `--fail-on-errors` checks CycloneDX 1.6 **schema conformance** — it does not (and cannot) catch any of the #41 content problems, all of which are perfectly schema-valid: the fused `software=97` count, the **missing `vulnerabilities[]`** despite 11 known vulns, `signed` without `verified`, the absolute-path `bom-ref`. So "BOM validated successfully" attests *well-formedness*, not completeness or correctness. It's a legitimate gate (and honestly labeled in the config as a schema check) — just don't read the green as "the AI-BOM is good."
- ℹ️ **F2 — The rendered `modelCard` is a near-empty shell.** In the validated XML, `<modelParameters />` and `<quantitativeAnalysis />` are empty elements (inherited from #41); only a one-line `technicalLimitations` note is populated. Schema-valid, so it passes — but the ML-specific surface the AI-BOM exists to carry (parameters, eval metrics) is hollow. Fix belongs upstream in `build_ai_bom.py` (#41), not here.
- ℹ️ **F3 — The XML carries a leading UTF-8 BOM marker** (`EF BB BF`). Cosmetic; `cyclonedx sign/verify` handle it, but it's the exact byte stream `ai-bom-sign` #43 will sign — worth noting for the signature step. Low priority.
- ✅ **Strengths:** genuine hard gate (`--fail-on-errors`, no `allow_failure` → a malformed BOM red-lines the pipeline), **pinned CLI by digest** (`0.32.0` — good supply-chain hygiene, contrast `trivy:latest` #14), `entrypoint:[""]`/`before_script:[]` correct for the toolchain image, and a **lossless XML render** that correctly feeds the signing step.

**Recommended fixes** (finding → fix):
1. **F1 (form-not-substance)** → if semantic guarantees are wanted, add content assertions after the schema check (e.g. fail when an audit reported vulns but the BOM has no `vulnerabilities[]`; assert model `signed`+`verified`; sanity-check `bom.counts.software` against the real closure) — otherwise keep it, but label the gate "schema conformance only" so green isn't over-read as "complete/correct."
2. **F2 (empty modelCard)** → populate `modelParameters`/`quantitativeAnalysis` in `build_ai_bom.py` (#41); schema can't enforce non-empty, so this must be fixed at assembly.
3. **F3 (UTF-8 BOM marker)** → optional cleanliness: strip the BOM on convert; verify #43's `cyclonedx sign` is byte-stable over it (it is, but confirm at the signing step).

**Verdict:** ✅ **Real work** — a genuine, pinned, hard **CycloneDX 1.6 schema-conformance gate** (`--fail-on-errors`, no `allow_failure`) plus a **lossless JSON→XML render** for the signing step; not theater, and well-built. The only caveat is scope: it's **structural-only**, so "BOM validated successfully" certifies the AI-BOM is *well-formed*, not that its contents are complete or correct — every substance gap flagged in #41 passes this gate cleanly. **`ai-bom` stage 2/5. Next: #43 `ai-bom-sign` (enveloped XML Digital Signature over `aibom.cyclonedx.xml`).**

---

## ai-bom-sign  (stage: ai-bom, `allow_failure: true`)  ✅ (a real enveloped XML signature was generated AND round-trip-verified in-job, with good private-key hygiene) 🔴 but it signed with an EPHEMERAL, identity-less keypair minted in the job and published alongside the BOM — so the BOM's OWN signature gives tamper-evidence but ZERO authenticity/provenance and pins no stable signer across runs (and `allow_failure` lets the BOM ship unsigned)

**Purpose:** Apply the AI-BOM's **own** signature — a native CycloneDX **enveloped XML Digital Signature** embedded in `aibom.cyclonedx.xml` — so a downstream verifier (the Argo CD PreSync hook's `cyclonedx verify`) can confirm the BOM is intact and from a trusted signer before a rollout. (Distinct from the **model** cosign signature embedded *inside* the BOM by #41.)

**What it does:** Runs in pinned `cyclonedx/cyclonedx-cli:0.32.0` (`entrypoint:[""]`, `before_script:[]`), `needs:["ai-bom-validate"]`, **`allow_failure: true`**. (1) guard: no XML → skip `exit 0`; (2) key: **prefer a stable `CYCLONEDX_SIGNING_KEY`/`CYCLONEDX_SIGNING_PUB`** from CI vars, **else generate an ephemeral keypair** ([.gitlab-ci.yml:2750-2760](.gitlab-ci.yml#L2750-L2760)); (3) `/cyclonedx sign bom … --key-file aibom-signing.key` (enveloped XMLDSig); (4) `/cyclonedx verify all … --key-file aibom-signing.pub` round-trip; (5) `rm aibom-signing.key` (never publish the private key). Artifacts: `aibom.cyclonedx.xml` + `aibom-signing.pub`.

**Run evidence (`80619005`, artifact `14906999109`):** image by digest `sha256:9a858a15…` (pinned). `**CYCLONEDX_SIGNING_KEY not set — generating EPHEMERAL keypair (intra-run verification only)**` → keygen → `sign bom` (`Generating signature… Saving signature…`) → `verify all`: `Found 1 signatures… Verifying signature 1... verified. All signatures verified.` → `rm` private key. `aibom.cyclonedx.xml` + `aibom-signing.pub` uploaded (`201 Created`). Job **succeeded** (green).

**Signed-XML cross-check (inspected directly):** the XML now carries a trailing `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` — c14n `xml-c14n-20010315`, `rsa-sha256`, **enveloped-signature** transform, `Reference URI=""` (covers the whole document), real `DigestValue` + `SignatureValue`. So the enveloped signature is genuinely present and spans the entire BOM (incl. the embedded model cosign sig).

**Findings (most damning first):**
- 🔴 **F1 — Signed with an EPHEMERAL, identity-less key → tamper-evidence, NOT authenticity.** `CYCLONEDX_SIGNING_KEY` is unset, so the job minted a throwaway RSA keypair, signed with it, **deleted the private key**, and **published the public key next to the BOM**. Anyone holding `aibom.cyclonedx.xml` also holds the only key that verifies it — and that key was created fresh this run with **no attestation of who it belongs to**. So the BOM's own signature proves "not corrupted since signing," but establishes **no signer identity / no provenance** — unlike the **model** signature embedded inside it (cosign keyless: real Fulcio identity + Rekor tlog). The job's own log is honest about it: *"EPHEMERAL keypair (intra-run verification only)."*
- 🔴 **F2 — No stable signer across runs → the deploy-time verification can't pin an identity.** Because the key is regenerated every run, the Argo PreSync `cyclonedx verify` either trusts whatever pub key ships with the BOM (trust-on-first-use against a key that changes every pipeline — i.e. integrity only) or fails. The "stable signer identity across runs" path the config describes is **dormant until `CYCLONEDX_SIGNING_KEY`/`_PUB` are wired** — the same "capability present, not enabled" pattern as Vault #3 / DVC #12. As-is, BOM authenticity is non-functional end-to-end.
- ⚠️ **F3 — `allow_failure: true` → the BOM can ship UNSIGNED.** Signing failure (or the no-XML skip) doesn't block delivery; `publish-signed-artifacts` would then push an unsigned (or absent-signature) BOM. Defensible as "delivery shouldn't hinge on signing," but it means the signature is advisory, not guaranteed.
- ✅ **Genuine strengths:** the sign **and** verify round-trip really executed (`All signatures verified`) — not theater; **good key hygiene** (`rm` the private key before upload, only pub + signed XML published); the enveloped signature **covers the whole BOM** (Reference URI="" + enveloped transform); **pinned CLI by digest**. The mechanics are sound — it's the *key provenance* that's hollow.
- ℹ️ **F4 — Signs the UTF-8-BOM-prefixed XML (#42 F3) cleanly.** XML c14n operates on the parsed infoset, so the leading BOM marker doesn't break the signature — the in-job `verify all` passing confirms byte-stability. Closes the #42 F3 worry.

**Recommended fixes** (finding → fix):
1. 🛑 **MANDATORY / CRITICAL — F1/F2 (ephemeral, identity-less key): replace the RSA enveloped signature with cosign keyless.** Sign the AI-BOM the same way everything else in this pipeline is signed — `cosign sign-blob` via the GitLab `SIGSTORE_ID_TOKEN` (the model #18, dataset #32, and `sign-evidence` #40 already do this). That binds a real **Fulcio identity + Rekor transparency-log entry** (genuine provenance, publicly verifiable, no key to distribute), eliminates the throwaway-key anti-pattern entirely, and makes the BOM's own signature **consistent with the rest of the pipeline** instead of being the lone identity-less RSA signature. This supersedes the weaker "just wire `CYCLONEDX_SIGNING_KEY`" stopgap — do the cosign-keyless conversion, not the stable-RSA-key patch. (Tracked as **Fix #25** in `SESSION_HANDOFF.md`.)
2. **F2 (key distribution)** → moot once cosign keyless is adopted (Rekor is the trust anchor; nothing to distribute). If a stable RSA key is used as an interim stopgap instead, the trusted pub key must be distributed out-of-band so verifiers don't trust-on-first-use the key shipped inside the artifact.
3. **F3 (`allow_failure`)** → once cosign-keyless BOM signing is in place and meant to be guaranteed, drop `allow_failure` so an unsigned BOM can't silently reach `publish-signed-artifacts`.

**Verdict:** ✅ **Real work** — `ai-bom-sign` genuinely produces a native CycloneDX **enveloped XML signature over the whole BOM and verifies it in-job** (`All signatures verified`), with sound key hygiene and a pinned CLI; not theater. 🔴 But the signature is made with an **ephemeral, identity-less keypair** generated in the job and published beside the BOM (`CYCLONEDX_SIGNING_KEY` unset), so it delivers **integrity/tamper-evidence but no authenticity or provenance**, and pins **no stable signer** for the deploy-time verifier — and `allow_failure: true` lets the BOM ship unsigned. The BOM's *own* signature is therefore far weaker than the cosign keyless signature it carries *inside* it. 🛑 **MANDATORY FIX (Fix #25): convert this job to cosign keyless** (Fulcio + Rekor) so the BOM is signed with real provenance, consistent with the model/dataset/`sign-evidence` — not the interim "wire a stable RSA key" patch. **`ai-bom` stage 3/5. Next: #44 `drift-gate` (⚠️ WATCH — does it PASS on a `{skipped}`/seed-mode drift report? if so the guardrail-drift layer is theater).**

---

## drift-gate  (stage: ai-bom, **`allow_failure: false`**)  🔴 CONFIRMED THEATER — a HARD gate that is STRUCTURALLY UNABLE TO FAIL in this pipeline: its only input (`model-drift-detection` #36) is dead-by-construction and always emits `{skipped}`, which the gate treats as PASS, so the entire guardrail-drift enforcement layer shows green over zero drift checking

**Purpose:** Be the **enforcing chokepoint** for the guardrail-drift layer — read the eval-metric drift verdict (`model-drift.json` from `model-drift-detection` #36) and **fail the pipeline** (`allow_failure: false`) if behavioural eval metrics have drifted beyond threshold from the committed baseline.

**What it does ([.gitlab-ci.yml:2796-2811](.gitlab-ci.yml#L2796-L2811)):** stdlib Python, `needs:["model-drift-detection","ai-bom-sign"]`, **no `allow_failure`**. Reads `${REPORTS_DIR}/model-drift.json` and branches: (1) **file missing → "gate passes (drift detection skipped)" `exit 0`**; (2) **`skipped` OR `seeded` → "baseline seeded/skipped — pass" `exit 0`**; (3) `drift_detected → exit 1` (real fail, names the drifted metrics); (4) else → "PASSED — within threshold" `exit 0`.

**Run evidence (`80619005`):** downloaded `model-drift-detection` (`14906999103`) + `ai-bom-sign` artifacts; printed **`Drift gate: baseline seeded/skipped — pass`** → **branch (2) fired** → `exit 0`. Job **succeeded** (green). No artifacts.

**Findings (most damning first):**
- 🔴 **F1 — The hard gate CANNOT FAIL in this pipeline (confirmed theater).** `drift-gate` is `allow_failure: false` — presented as a real enforcing chokepoint — but its **sole verdict input, `model-drift-detection` #36, is dead-by-construction**: #36 reads the six live-scan eval files (`inspect-ai`/`garak`/`pyrit`/`giskard`/`guardrail-regression`/`promptfoo`) that were **moved to the separate live-scans pipeline** on 2026-06-16, finds none, and emits `{"skipped":true,"reason":"no metrics"}` **every run**. The gate's branch (2) treats `skipped` as **pass**. So the only reachable outcomes here are pass (branches 1/2/4); the `exit 1` drift path (branch 3) is **unreachable** because `drift_detected` can never be set when the producer never computes a metric. The green "Drift gate: … pass" therefore certifies **nothing was checked**, not "no drift" — the whole guardrail-drift enforcement layer is **vacuous** on the static pipeline. This is exactly the theater outcome the prior session flagged as the WATCH item — now **confirmed from the run**.
- 🔴 **F2 — It fails OPEN twice over.** Branch (1) passes on a **missing** report and branch (2) passes on a **skipped/seeded** report. So a hard gate that exists to *fail* on drift will go green if its input is absent, skipped, or seeded — i.e. on every non-happy-path. A gate that can only ever pass is not a gate.
- ⚠️ **F3 — It never looks at DATA drift at all.** `drift-gate` keys solely on `model-drift.json` (eval-metric drift, #36). It does **not** read `evidently-drift.json` (the data/feature-drift control #38), which itself ran in **seed mode** (#38). So the one drift control in this pipeline that *did* execute (Evidently) is **not gated by anything**, and the gate that does run has no real input. Neither drift axis is actually enforced.
- ℹ️ **F4 — The gate LOGIC, in isolation, is defensible — the vacuity is a SYSTEM property.** Treating "no baseline yet → seeded → don't red-line" as pass is correct *first-run* behaviour, and branch (3)'s `exit 1` is a real fail path. The problem is that the upstream producer is **permanently** stuck in skip/seed (dead-by-construction #36 + #38 has no baseline-commit job, per Fix #24a/#24b), so "seeded/skipped → pass" is **permanent**, not first-run-only — and the gate doesn't distinguish "skipped because first-run" (ok) from "skipped because the producer can never produce here" (should not read as a cleared gate). So the fix is mostly upstream (#24), but the gate should also stop fail-opening and stop implying coverage it doesn't have.

**Recommended fixes** (finding → fix):
1. **F1 (root cause)** → apply **Fix #24a/#24b**: move the eval-metric drift unit (`model-drift-detection`) to the live-scans pipeline where its six inputs exist, and in THIS pipeline **re-point `drift-gate` at the DATA-drift control** (`evidently-drift` #38) once #38 has a real committed `dataset-reference.jsonl` (the #37 bootstrap). Until a producer can actually emit a verdict here, a hard `drift-gate` is green theater — either wire a real input or remove the gate rather than ship a chokepoint that can't fire.
2. **F2 (fails open)** → for a hard gate, treat **missing report** and **never-compared/producer-dead** as a **failure** (or an explicit non-passing neutral state), not `exit 0`. Reserve the "pass" on skip strictly for a genuine *first-run, no-baseline-yet* signal (e.g. require an explicit `{first_run:true}` marker), so a permanently-skipped producer can't masquerade as a cleared gate.
3. **F3 (data drift ungated)** → have `drift-gate` also read `evidently-drift.json` and fail on `drift_detected` there, so data/feature drift is actually enforced (and don't treat its `seeded` state as a permanent pass either).

**Verdict:** 🔴 **Confirmed theater (by construction).** `drift-gate` is dressed as the guardrail-drift layer's one hard enforcing chokepoint (`allow_failure: false`), but in this pipeline it is **structurally incapable of failing**: its sole input `model-drift-detection` #36 is dead-by-construction and emits `{skipped}` every run, which the gate counts as a pass — and it additionally fails open on a missing report and ignores the data-drift control (#38) entirely. The green "Drift gate … pass" attests that **nothing was checked**, not that the model is drift-free. The gate's own logic is individually defensible (first-run seeding, a real `exit 1` path), so this is fixed primarily upstream via **Fix #24a/#24b** (give it a producer that can actually emit a verdict) plus hardening the gate to stop failing open. **`ai-bom` stage 4/5. Next: #45 `dependency-track-upload` (hard policy gate; skips cleanly when `DT_API_URL`/`DT_API_KEY` unset).**

> **🔧 UPDATE (2026-06-18 — `drift-gate` REMOVED, per user decision):** rather than keep a hard gate that can't fail, `drift-gate` was **deleted from the static pipeline** ([.gitlab-ci.yml](.gitlab-ci.yml)). Knock-on edits (validated: parses, no dangling needs, no cycle): (1) `image-sign` `needs:["drift-gate"]` → **`needs:["dependency-track-upload"]`** (the ai-bom stage's remaining hard gate, so image signing still follows an ai-bom gate); (2) removed `drift-gate` from the `sign-evidence` attest needs (38→37); (3) updated the `model-drift-detection` comment + README/SBOM mermaids & tables, SETUP, CI-VARIABLES, live-scans docs. **Consequence (supersedes the #24b "re-point" half):** with `drift-gate` gone, **data drift (`evidently-drift` #38) is now ungated** in the static pipeline even once it has a real baseline. The eval-metric drift unit + an enforcing gate belong in the **live-scans** pipeline (Fix #24a, where the inputs live). If data-drift *enforcement* is wanted in the static pipeline later, add a small gate over `evidently-drift` (not a revived `drift-gate` over the dead `model-drift-detection`).

---

## dependency-track-upload  (stage: ai-bom, **`allow_failure: false`**)  ⚠️ INERT this run (DT unconfigured → clean skip, `exit 0`) — so the upload + continuous-analysis + policy gate did NOTHING; but it is the **best-built gate of the vuln family** and *would* be a real hard policy gate once Dependency-Track is wired

**Purpose:** Push the SBOM + AI-BOM into a **Dependency-Track** server for *continuous* analysis — DT ingests the CycloneDX docs once, then re-scans them against new CVEs + policy conditions over time (turning the point-in-time grype/trivy scans into ongoing monitoring), and **fails the pipeline** on any non-suppressed blocking policy violation. Now also `image-sign`'s gate anchor (after `drift-gate`'s removal).

**What it does ([dependency_track_upload.py](scripts/dependency_track_upload.py)):** `needs:["syft-cyclonedx","ai-bom-assemble","vault-secrets"]`, `allow_failure: false`. `pip install requests` → guard: if `DT_API_URL`/`DT_API_KEY` unset → write `{skipped:true}` + `exit 0`. When configured: POST the app SBOM (`autoCreate=true`) → POST the AI-BOM **nested under** the app project (`parentName/parentVersion`) → poll until DT finishes processing → pull findings + policy violations → **gate: `exit 1` if any non-suppressed violation's `violationState` ∈ `DT_FAIL_ON` (default `FAIL`)** (VEX-suppressed violations never gate).

**Run evidence (`80619005`, artifact `14906999111`):** downloaded the SBOM + AI-BOM, `pip install requests`, then `DT_API_URL / DT_API_KEY not set — Dependency-Track upload skipped`. Artifact verified exactly: `{"skipped":true,"reason":"DT_API_URL/DT_API_KEY not configured"}`. Job **succeeded** (green).

**Findings (most damning first):**
- ⚠️ **F1 — INERT this run (clean skip ≠ ✅).** DT unconfigured → it wrote the skip JSON and exited 0; the **entire upload → continuous-analysis → policy-gate path never ran** and is **untested** until `DT_API_URL`/`DT_API_KEY` are wired (the same dormant-capability pattern as vault-secrets #3 / dvc-verify #12 / trivy-image #14). The green check means "nothing was uploaded," **not** "the BOM is clean in DT." Honest skip + schema-clean artifact, but zero supply-chain signal this run.
- ⚠️ **F2 — When wired, the gate keys on POLICY violations, not CVE severity — so a DT with no policies passes green even with criticals.** The gate fails only on non-suppressed violations whose `violationState ∈ DT_FAIL_ON` ([:205-210](scripts/dependency_track_upload.py#L205-L210)). CVE **findings** are pulled and reported (`findings_by_severity`) but **do not gate** — only authored DT **policies** do. So "wire DT" is necessary but **not sufficient**: without blocking policies configured in the DT instance, the hard gate is vacuous even with HIGH/CRITICAL CVEs present.
- ℹ️ **F3 — CVE matching covers SOFTWARE components only (honest, documented).** Per the script's own scope note, DT's vuln matching targets the software components; the AI-BOM's **model/data components ride along as inventory + policy targets but receive no CVE matches**. Acknowledged by design (they're *tracked, not scanned*); the policy gate does still apply to them. Combined with #41-F1, DT's CVE surface is the **fused/shallow** software set (3 declared pins + the markllm eval stack), not the real main-pipeline closure.
- ✅ **F4 — Genuinely the best-built gate of the vuln family.** Unlike grype #13 (no `--fail-on` + `allow_failure`) and trivy #14 (`--exit-code 0` ×3 + `allow_failure`), this is `allow_failure: false` with a real `exit 1` path, proper async handling (polls DT until processing completes), correct AI-BOM nesting, and VEX-suppression awareness. It is the **only vuln/policy control in the pipeline that actually blocks** — once wired. It also **re-derives CVEs itself** from component purls/cpes, so #41-F2 (the BOM carrying no `vulnerabilities[]`) doesn't blind DT — this is *where* continuous CVE matching is meant to happen.
- ℹ️ **F5 — Now `image-sign`'s gate anchor, and inert too.** After `drift-gate`'s removal, `image-sign` `needs: dependency-track-upload`. Because DT skips cleanly (`exit 0`), `image-sign` still proceeds — so the "hard gate before deploy-image signing" is also inert this run. Fine as wiring, but note the deploy precondition has no teeth until DT is configured.
- ⚠️ **F6 — `pip install requests` unpinned** (Fix #0 family) — floats, and this job's installed env is audited by no `pip-audit`. Low impact (single dep), but it's another instance of the pipeline-wide unaudited-install gap.

**Recommended fixes** (finding → fix):
1. **F1 (inert)** → wire `DT_API_URL`/`DT_API_KEY` (the Vault secret map already lists them) to activate continuous monitoring; until then apply verdict discipline — green = *not uploaded*, not *clean*.
2. **F2 (policy-dependent gate)** → author blocking **DT policies** (e.g. CVE severity ≥ threshold, banned licenses, outdated components) so the gate actually bites — a wired DT with no policies still passes on criticals. Consider also gating on `findings_by_severity` directly, not only on policy `violationState`.
3. **F3/#41-F1 (software-only + shallow surface)** → fix the upstream SBOM depth (`syft-cyclonedx` #10 / #41-F1) so DT scans the real dependency closure; accept model/data as inventory+policy targets (not a CVE gap).
4. **F5 (inert deploy anchor)** → once DT is wired (and policies authored), `image-sign`'s dependency becomes a real precondition; until then document that the deploy-image gate is inert.
5. **F6 (unpinned `requests`)** → pin + add this job's env to `pip-audit` coverage (CRITICAL Fix #0).

**Verdict:** ⚠️ **Inert this run** — DT unconfigured, so it cleanly skipped (`{skipped:true}`, `exit 0`) and the upload + continuous-analysis + policy gate were **never exercised** (clean skip ≠ ✅; the path is untested, vault/dvc pattern). But the **code is the best-built gate in the pipeline's vuln family** — a genuine `allow_failure: false` hard gate with a real `exit 1`, async polling, AI-BOM nesting, and VEX awareness — and it's where continuous CVE matching is *meant* to live. Two things to know before trusting it once wired: the gate fires on **authored DT policies, not raw CVE severity** (no policies ⇒ green even with criticals), and its CVE surface is the **software** components only (inheriting #41's shallow/fused set). **`ai-bom` stage COMPLETE (4/4 after `drift-gate` removal). Next: #46 `image-sign` (deploy-prep; cosign keyless on the workload image — likely inert, no `IMAGE_REF` built in this static pipeline).**

---

## image-sign  (stage: deploy-prep, `allow_failure: true`)  ⚠️ INERT this run (no `IMAGE_REF` → clean skip, `exit 0`) — by design, since this static pipeline builds no container image; when wired it does proper cosign **keyless** image signing + a post-sign verify

**Purpose:** Close the **image** half of the deploy-time sign→verify loop — apply a **cosign keyless** signature to the already-built workload **container image** (`IMAGE_REF`, e.g. `ghcr.io/…/gaips-rag-app@sha256:…`) so **Kyverno** admits a Pod only if its image carries a signature from this CI identity. This signs the *deployable app container that serves the model* — **not** the model and not the BOM; the pipeline has **three distinct signing jobs**, each over a different artifact and verified by a different deploy-time gate:

| Job | Signs | Mechanism | Verified at deploy by |
| --- | --- | --- | --- |
| `model-sign` #18 | the **model** (GGUF weights blob) | cosign keyless (Fulcio + Rekor) | Argo CD PreSync hook (`model_signing verify`) |
| `ai-bom-sign` #43 | the **AI-BOM document** | enveloped XMLDSig (ephemeral RSA — 🛑 Fix #25: convert to keyless) | Argo CD PreSync hook (`cyclonedx verify`) |
| `image-sign` #46 | the **workload container image** | cosign keyless (Fulcio + Rekor) | **Kyverno** ClusterPolicy (admission control) |

*(Aside: `sign-evidence` #40 adds a fourth — cosign keyless over the whole-run evidence manifest — for audit retention, not a deploy gate.)*

**What it does ([.gitlab-ci.yml:2854-2893](.gitlab-ci.yml#L2854-L2893)):** `needs:["dependency-track-upload"]` (its anchor since `drift-gate` was removed), `id_tokens.SIGSTORE_ID_TOKEN` (aud `sigstore`), `allow_failure: true`. Guard: `IMAGE_REF` unset → skip `exit 0`. When set: `cosign sign --yes ${IMAGE_REF}` (keyless via Fulcio), then a **post-sign `cosign verify`** with `--certificate-identity-regexp`/`--certificate-oidc-issuer-regexp` to confirm the signature is present + Rekor-logged.

**Run evidence (`80619005`):** `IMAGE_REF unset — image signing skipped (set it to the built+pushed workload image to enable)`. No artifacts. Job **succeeded** (green).

**Findings:**
- ⚠️ **F1 — INERT this run (clean skip ≠ ✅), but legitimately by design.** `IMAGE_REF` is empty because this **static supply-chain pipeline builds no container image** — so the cosign image-signing path is **untested here** (same dormant-capability pattern as `trivy image` #14 / vault #3 / DT #45). Unlike those, the skip is *architecturally correct*: the workload image would be built+pushed by a separate app pipeline, which would set `IMAGE_REF`. Green = "no image to sign," not "image signed."
- ✅ **F2 — When active, it's the GOOD keyless pattern + verifies itself.** Uses cosign **keyless** (`SIGSTORE_ID_TOKEN`, Fulcio identity + Rekor) — consistent with `model-sign` #18 / `dataset-sign` #32 / `sign-evidence` #40 — and **verifies the signature right after creating it** (the present+Rekor-logged self-check). This is exactly the pattern `ai-bom-sign` #43 should adopt (reinforces **Fix #25**: #43 is the lone ephemeral-RSA outlier; image-sign shows the keyless way done right).
- ℹ️ **F3 — `allow_failure: true` is correct by design.** A CI signing hiccup must not block BOM/evidence delivery; **Kyverno is the real deploy-time gate** (it refuses unsigned images at admission), so signing here is a deploy *enabler*, not a pipeline gate. Documented clearly in the job comment.
- ℹ️ **F4 — Its `needs` anchor (`dependency-track-upload`) is also inert this run**, so the "hard gate before image signing" carries no teeth on this run (noted at #45-F5). Resolves once DT is wired.

**Recommended fixes** (finding → fix):
1. **F1 (inert)** → set `IMAGE_REF` to the built+pushed workload image (prefer a digest `repo@sha256:…`) from whatever builds the app container, to activate signing; until then it's a correct placeholder. Verdict discipline: green = *not signed*.
2. **F2 (none — exemplar)** → no fix; use this job as the reference implementation when converting `ai-bom-sign` #43 to cosign keyless (Fix #25).

**Verdict:** ⚠️ **Inert this run** — no `IMAGE_REF` (this static pipeline builds no container image), so it cleanly skipped (`exit 0`); the cosign image-signing path is **untested here** (clean skip ≠ ✅). But unlike the other inert jobs the skip is **architecturally correct** (the workload image is a separate app pipeline's output), and the code is **well-built**: cosign **keyless** (Fulcio + Rekor) with a **post-sign verify**, `allow_failure: true` because **Kyverno** is the actual deploy-time gate. It's the exemplar for how `ai-bom-sign` #43 *should* sign (Fix #25). **`deploy-prep` 1/4. Next: #47 `publish-signed-artifacts` (pushes the signed AI-BOM/dataset/model to the registry the Argo PreSync hook fetches — likely partial/inert: AI-BOM present, dataset unsigned on `8061900`, no model bundle).**

---

## publish-signed-artifacts  (stage: deploy-prep, `allow_failure: true`)  ✅ (real work — genuinely staged + pushed the signed deploy set to the GitLab generic package registry the Argo PreSync hook fetches, all `201 Created`, and emitted the `ARTIFACT_BASE_URL` pointer) ⚠️ but it ships a signed model + an **ephemeral-key** AI-BOM and **NO dataset** (dataset-sign #32 didn't run on `8061900`), and `allow_failure: true` lets a failed publish pass green

**Purpose:** The pipeline's **distribution endpoint** — collect the artifacts that downstream **deploy-time** verification needs and publish them to a stable, fetchable URL. It does **not** create trust material; it gathers what upstream jobs already signed (the AI-BOM from `ai-bom-sign` #43, the model from `model-sign` #18 + `model-fixture-download` #15, the dataset from `dataset-sign` #32) and `PUT`s them to a **GitLab generic package** (`gaips-evidence/<branch>`). The published set is what the **Argo CD PreSync hook** pulls and verifies before a deploy (`model_signing verify` for the model bundle, `cyclonedx verify` for the AI-BOM). This is `deploy-prep` 2/4.

**What it does ([.gitlab-ci.yml:2903-2976](.gitlab-ci.yml#L2903-L2976)):** `needs:["ai-bom-sign","dataset-sign","model-sign","model-fixture-download"]`, `allow_failure: true` ("a publish hiccup must not fail the run; re-publishable from artifacts"). Guard: if `CI_API_V4_URL`/`CI_PROJECT_ID` unset → "publish skipped" `exit 0`; else `apt-get install curl ca-certificates`. Then a `stage()` helper copies each source into `evidence/publish/`, appending its name to `artifacts-manifest.txt` (and printing `staged →` / `(absent, skipped)`):
- **AI-BOM:** `${SBOM_DIR}/aibom.cyclonedx.xml` + `aibom-signing.pub` (the verification key) ([:2929-2931](.gitlab-ci.yml#L2929-L2931)).
- **Dataset:** the data file (→ `dataset.dat`), `dataset.sig`, `dataset.pem` from `evidence/dataset-input/` ([:2932-2937](.gitlab-ci.yml#L2932-L2937)).
- **Model bundle:** only if `MODEL_DIR` holds **weights** (`pkl/pt/safetensors/gguf/bin/h5/onnx`) **AND** a `model.sig` → `tar`s `MODEL_DIR` into `model-bundle.tar` ([:2945-2955](.gitlab-ci.yml#L2945-L2955)).

Then ([:2957-2972](.gitlab-ci.yml#L2957-L2972)): if the manifest is empty → "Nothing signed to publish" `exit 0`; else loop the manifest, `curl -sSf --retry 3 --header "JOB-TOKEN:…" --upload-file` each to `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/${EVIDENCE_PACKAGE_NAME}/${EVIDENCE_PACKAGE_VERSION}/<file>`, then print the `ARTIFACT_BASE_URL` PreSync pointer. Only `artifacts-manifest.txt` is kept as a job artifact (90 days) — the published bytes live in the package registry, not job artifacts ([:2973-2976](.gitlab-ci.yml#L2973-L2976)).

**Run evidence (`80619005`, job 14906999113):** Pulled `model-sign`, `model-fixture-download`, `ai-bom-sign` artifacts. Staged **three** files and pushed all to `…/packages/generic/gaips-evidence/gaips-pipeline-required-fixes`, each `{"message":"201 Created"}`:
```
staged → aibom.cyclonedx.xml
staged → aibom-signing.pub
staged → model-bundle.tar (model_signing bundle of /builds/natecarrollfilms/counter-spy/models)
(absent, skipped) …/evidence/dataset-input/dataset.sig
(absent, skipped) …/evidence/dataset-input/dataset.pem
```
`artifacts-manifest.txt` (the 3 published names) uploaded as the job artifact (201). PreSync pointer emitted: `→ Point the PreSync ConfigMap ARTIFACT_BASE_URL at: https://gitlab.com/api/v4/projects/83297857/packages/generic/gaips-evidence/gaips-pipeline-required-fixes`. Job **succeeded** (green).

**Findings:**
- ✅ **F1 — Real distribution happened.** Three signed artifacts genuinely uploaded (all `201 Created`) to the GitLab generic package registry, and the run emitted the exact `ARTIFACT_BASE_URL` the Argo PreSync ConfigMap consumes. This is the one job that actually *delivers* the supply-chain evidence to the deploy gate — not theater. The published manifest matches the three uploads exactly.
- 🟢 **F2 — The model bundle WAS published — correcting #46's "no model bundle" prediction.** `model-bundle.tar` shipped as a real `model_signing` bundle (weights + `model.sig`, tarred from `MODEL_DIR`). It works because **`model-fixture-download` #15 is in `needs`** and provisions the GGUF weights into `MODEL_DIR`, while `model-sign` #18 supplies `model.sig` → `HAVE_WEIGHTS=1` and the sig check both pass. ⚠️ **The in-YAML comment ([:2938-2944](.gitlab-ci.yml#L2938-L2944)) is STALE/MISLEADING:** it reasons only about `model-sign` ("publishes only `**/model.sig`, not the weights, so via `needs` alone this stays empty and the bundle is correctly skipped") and **forgets `model-fixture-download` also being a `needs`** that carries the weights. The bundle ships on **every** run where the fixture is present, not "correctly skipped" — the comment should be fixed so future readers don't assume the bundle is absent.
- ⚠️ **F3 — Dataset arm fully absent → the deploy set has no dataset to verify.** `dataset.dat`/`.sig`/`.pem` all skipped because **`dataset-sign` #32 did not run on `8061900`** (its broken-chain fix is in the unpushed `ff9bd7e`; see #28/#41-F3). So PreSync receives a signed model + AI-BOM but **zero dataset provenance** — the dataset half of the chain-of-custody simply isn't distributed. Honest skip (the `stage()` helper logs `(absent, skipped)`), but it means "published evidence" ≠ "complete evidence" on this commit. Re-validate once `ff9bd7e` lands and #32 runs.
- 🔴 **F4 — The published AI-BOM carries an EPHEMERAL, identity-less signature (inherits #43 / Fix #25).** `aibom-signing.pub` is the throwaway RSA public key `ai-bom-sign` #43 minted in-job. Publishing the `.pub` next to the BOM gives **tamper-evidence** (the XML matches *a* key) but **zero authenticity/provenance** — anyone can re-sign a modified BOM with a fresh ephemeral key and a matching `.pub`, and no stable signer is pinned across runs. The deploy gate's `cyclonedx verify` can confirm the envelope is intact but cannot attest *who* signed it. Closing **Fix #25** (convert #43 to cosign keyless, à la `image-sign` #46) fixes this at the source.
- ⚠️ **F5 — `allow_failure: true` → a failed publish passes green.** A `curl` upload failure (or the no-API/empty-manifest guards) doesn't fail the run, so the deploy registry can silently retain **stale** artifacts while the pipeline shows success. Defensible ("re-publishable from artifacts" — the manifest is retained 90 days), but a failed publish produces no red signal; nothing alerts that the registry is out of date.
- ⚠️ **F6 — Branch-scoped package version.** `EVIDENCE_PACKAGE_VERSION` resolved to the branch (`gaips-pipeline-required-fixes`), so the emitted `ARTIFACT_BASE_URL` is **branch-specific**. Correct for this test branch, but the real PreSync ConfigMap must track the final merged branch/tag path, or it will fetch from a stale/absent package version after merge.
- ℹ️ **F7 — Publish runs BEFORE `sign-evidence` (by design; see #40).** Because `sign-evidence` is now terminal (`attest` stage), the whole-run evidence **seal is NOT in this published deploy set** — it's a retained 90-day audit artifact, not distributed to the deploy gate. The deploy-facing attestations are the signed AI-BOM + model bundle only. (Documented at [#40](.gitlab-ci.yml#L2437); reaffirmed here.)
- ℹ️ **F8 — Chain-of-custody on the bundle is plausible but verify at deploy.** `model-bundle.tar` merges `model-fixture-download`'s weights with `model-sign`'s `model.sig` into one tar; these derive from the same checkout so they should match, but the *binding* is only proven when the **PreSync `model_signing verify`** runs against the bundle. Green here = "bundle shipped," not "bundle verifies."

**Recommended fixes** (finding → fix):
1. **F2 (stale comment)** → rewrite the [:2938-2944](.gitlab-ci.yml#L2938-L2944) comment to reflect that `model-fixture-download` (a `needs`) provides the weights, so the bundle ships whenever the fixture is present — not "correctly skipped." Keep the empty-bundle safety check; just fix the rationale.
2. **F3 (no dataset)** → land `ff9bd7e` so `dataset-sign` #32 runs and the dataset arm publishes `dataset.dat`/`.sig`/`.pem`; until then, treat the deploy set as model+BOM only and ensure PreSync doesn't hard-require a dataset signature it will never receive.
3. **F4 (ephemeral BOM key)** → **Fix #25**: convert `ai-bom-sign` #43 to cosign keyless (Fulcio + Rekor, the `image-sign` #46 / `model-sign` #18 pattern); then the published `.pub`/signature carry real provenance.
4. **F5 (`allow_failure`)** → keep `allow_failure` for transient hiccups, but add a non-fatal **publish-status signal** (e.g. write a `publish-result.json` / emit a warning artifact) so a failed/partial publish is visible rather than silently green.
5. **F6 (branch-scoped URL)** → confirm `EVIDENCE_PACKAGE_VERSION` resolves to the intended stable path on the merge target, and update the PreSync ConfigMap `ARTIFACT_BASE_URL` accordingly at cutover.

**Verdict:** ✅ **Real work** — `publish-signed-artifacts` genuinely staged and pushed the signed deploy set (AI-BOM XML + its verification key + a real `model_signing` model bundle) to the GitLab generic package registry the Argo PreSync hook fetches, all `201 Created`, and emitted the correct `ARTIFACT_BASE_URL` pointer. **The #46 prediction was half-right:** AI-BOM present ✅ and dataset unsigned/absent ✅ (#32 deferred on `8061900`), but the **model bundle DID publish** ✅ — `model-fixture-download`'s weights + `model-sign`'s `model.sig` satisfy the bundle guard (and the in-YAML comment claiming it's "correctly skipped" is stale). ⚠️ Caveats that limit the *strength* of the delivery, not its execution: the AI-BOM's signature is **ephemeral/identity-less** (Fix #25), **no dataset evidence** ships this run (#32 deferred), and `allow_failure: true` means a failed publish would pass green with no red signal. **`deploy-prep` 2/4. Next: #48 `metrics-normalize` (no `needs:` — pulls ALL earlier-stage artifacts into one normalised `operational-metrics.json`; reporting-only, `allow_failure: true` — expect a real normalise over reports/evidence/sbom, with the GitLab-API operational block skipping cleanly if `GITLAB_API_TOKEN` is unset).**

---

## metrics-normalize  (stage: deploy-prep, no `needs:`, `allow_failure: true`)  ✅ (real aggregation — genuinely read 27/37 report/evidence/sbom sources into ONE normalised `operational-metrics.json` with 18 numeric metrics, and gracefully skipped the 10 absent inputs the no-`needs` design promises to tolerate) ⚠️ but it is **reporting-only (zero enforcement)**, its `gates` block is a curated *signal* subset (NOT the pipeline's real gating topology), and several **present** sources silently normalise to `null` (producer↔normaliser schema drift)

**Purpose:** Collapse every signal the pipeline emitted — security scans, SBOM/AI-BOM, model-integrity, data-quality, drift, AI-eval — plus (optionally) the GitLab pipeline/job API into **one normalised JSON** (`operational-metrics.json`) that the `pages` job (#49) renders into the dashboard. This is the **observability layer**: it records *what every job said* and flattens it for display/time-series. It is deliberately the **penultimate** job and **never gates** — "a dashboard must survive partial input."

**What it does ([.gitlab-ci.yml:2989-3014](.gitlab-ci.yml#L2989-L3014)):** **No `needs:` on purpose** — as a `deploy-prep` (final-stage) job it downloads artifacts from **all** earlier-stage jobs by default, so `reports/`, `evidence/`, and `sbom/` arrive without a brittle 34-job list (the log confirms it pulled ~34 jobs' artifacts). `allow_failure: true` (reporting only). Script: `pip install requests` (only the GitLab-API block needs it), `mkdir REPORTS_DIR`, then `scripts/write_operational_metrics.py --reports … --evidence … --sbom … --out operational-metrics.json --gitlab-token-env GITLAB_API_TOKEN` and `cat`s the result. The normaliser **skips any input that is absent or malformed**; the GitLab-API operational block runs only if `GITLAB_API_TOKEN` is set. Artifact: `operational-metrics.json`, 90 days ([:3011-3014](.gitlab-ci.yml#L3011-L3014)).

**Run evidence (`80619005`, job 14906999114):** `operational-metrics → reports/operational-metrics.json` · **`sources: 27/37 present`** · **`metrics: 18 numeric`** · **`gates: 10 passed, 1 failed, 0 skipped`** · `gitlab-api: skipped (GITLAB_API_TOKEN not set)`. Artifact uploaded (201). Job **succeeded**. The emitted document records: `gates.failed=[semgrep-sast: 4 finding(s)]` (the only non-pass), `supply_chain.ai_bom.components=99` (1 model + 1 data + 96 library + 1 file), `data_quality.redaction.pii_redactions=1` (`PERSON`), `model_integrity` all-clean (modelscan 0/0/0/0, clamav 0, tamper passed), `evidently.drift_detected=false`, and provenance `dirty:true` @ `8061900`.

**Findings:**
- ✅ **F1 — Real, faithful normalisation across the whole pipeline.** It genuinely ingested 27 of 37 known sources into one document and flattened 18 numeric metrics — and **gracefully skipped the 10 absent inputs** (`promptfoo`, `garak`, `inspect`, `pyrit`, `giskard`, `guardrail-regression`, `great-expectations`, `ydata-profile`, `gl-secret-detection-report`), exactly the resilience the no-`needs` "survive partial input" design intends. No crash on missing/extra artifacts. This is the pipeline's single aggregated audit record, and it's honest (it surfaces the semgrep failure rather than burying it).
- ⚠️ **F2 — Reporting-only; enforces nothing (`allow_failure: true`).** It *records* `semgrep-sast: 4 findings (2 ERROR)` as a "failed" gate but takes no action — semgrep is itself advisory, and this job can't fail the run regardless. Correct by design (observability ≠ control), but it means **"1 failed" here does NOT mean the pipeline failed.**
- ⚠️ **F3 — The `gates` block is a curated SIGNAL subset, not the pipeline's real gating topology.** The 10-passed/1-failed list mixes advisory signals with no relation to actual enforcement: `semgrep-sast` (advisory, `allow_failure: true`) is the lone "failed" gate, while the pipeline's **actual hard gates** — `signature-verification` #19, `artifact-signing-gate` #33, `dataset-scan` #25, `dataset-redact` #26, `eval-dataset-validate` #28, `ai-bom-assemble`/`ai-bom-validate` #41/#42, `drift-gate` #44, `dependency-track-upload` #45 — are **absent from this list**. So the dashboard's gate tally must not be read as "what would block a deploy." (And several of those real gates pass *vacuously* per their own findings — a nuance this flat summary can't show.)
- ⚠️ **F4 — Present-but-`null` extraction gaps (producer↔normaliser schema drift).** Some sources are `"present"` yet normalise to all-`null` sections, which downstream is **indistinguishable from a thin/absent source**:
  - `ai_evaluation.markllm.{ready,import_ok}=null` though `markllm-results.json` is **present** and `markllm-watermark-eval` #38 **genuinely ran** (loaded a 1.5B model) → a **real mapping gap**, not inert.
  - `model_integrity.hf_scan.*=null` (`hf-scan/summary.json` present) — legitimately inert (#22 skipped), but reads identically to the markllm gap.
  - `data_quality.download.size=null` (sha256 present); `security.package_integrity.mode="unknown"` (`pkg-integrity.env` present). Minor field-level misses.
  
  A present file yielding `null` masks whether the data is genuinely missing or just unparsed.
- ℹ️ **F5 — `generated_at` is the pipeline-creation time, not this job's runtime.** The normaliser sets `ts = args.timestamp or CI_PIPELINE_CREATED_AT or "unknown"` ([write_operational_metrics.py:632](scripts/write_operational_metrics.py#L632)) and the YAML passes no `--timestamp`, so `generated_at` (`2026-06-17T17:49:20Z`) is `CI_PIPELINE_CREATED_AT` — which is why it *coincides* with `pipeline.provenance.timestamp` (both ≈ pipeline start) rather than marking when this JSON was written. (The nested `provenance.ci.job_id` `14906999067` is separately setup's, correctly, since provenance comes from `version-info.json`.) Fine for pinning, but the name reads like build time. (→ Fix #27c.)
- ℹ️ **F6 — The "operational" half is empty this run.** `GITLAB_API_TOKEN` unset → `operational.skipped=true`, so there are **no pipeline/job duration, queue-time, or status-by-stage metrics** — the file is entirely report-derived despite the name `operational-metrics.json`. Graceful by design, but the operational block contributes nothing on this run.
- ℹ️ **F7 — It faithfully carries known caveats forward (good).** It does not sanitise: `ai_bom.components=99` still includes the **96 `library`** entries that fuse the two disjoint dependency universes (#41-F-fusion), the dataset shows as a recorded component while being **unsigned** upstream (#41-F3 / #47-F3), the **PII redaction of 1 `PERSON`** is recorded (#26/#27), and `dirty:true` provenance is preserved. The dashboard reflects reality rather than smoothing it.

**Recommended fixes** (finding → fix):
1. **F4 (present→null)** → align `write_operational_metrics.py`'s extractors with the producers' current schemas (`markllm-results.json`, `dataset-download.json` size, `pkg-integrity.env` mode), and emit an explicit `"present-but-unparsed"` marker so a `null` from a present file is distinguishable from an absent source.
2. **F3 (gate semantics)** → add an `enforcing: true|false` flag per signal (or split advisory vs hard gates) so the rendered "failed" count can't be misread as deploy-blocking; ideally include the real hard gates' verdicts.
3. **F5 (timestamp label)** → rename `generated_at` → `pipeline_provenance_ts`, or add a separate `normalised_at` set to this job's runtime.
4. **F2/F6** → none required (reporting-by-design); document in the dashboard that it is observability, not enforcement, and that operational/timing metrics require `GITLAB_API_TOKEN`.

**Verdict:** ✅ **Real aggregation work** — `metrics-normalize` genuinely normalised 27/37 sources into one honest `operational-metrics.json` (18 numeric metrics) and tolerated the 10 absent inputs exactly as its no-`needs` "survive partial input" design intends; it faithfully records the run's real state (semgrep failure surfaced, model-integrity clean, AI-BOM 99 components, 1 PII redaction, `dirty:true`). ⚠️ Limits are about *interpretation*, not execution: it is **reporting-only** (`allow_failure: true`, enforces nothing), its `gates` tally is a **signal subset** that omits the pipeline's actual hard gates (so "1 failed" ≠ pipeline failed), and a handful of **present sources silently normalise to `null`** (notably markllm, which really ran) — masking schema drift between producers and the normaliser. The operational/timing half is empty without `GITLAB_API_TOKEN`. **`deploy-prep` 3/4. Next: #49 `pages` (FINAL job — `needs: metrics-normalize`, `allow_failure: true`; renders this JSON into a self-contained static GitLab Pages dashboard at `public/index.html` — expect a real HTML render and the pipeline's last green job).**

---

## pages  (stage: deploy-prep, `needs: metrics-normalize`, `allow_failure: true`)  ✅ (real render — genuinely turned #48's normalised JSON into a self-contained, JS-free GitLab Pages dashboard with an empty-input fallback, and published `public/`) ⚠️ but presentation-fidelity gaps: it **mis-colors negative-polarity booleans** (`drift_detected:false` shows **RED**), surfaces #48's **present-but-`null`** values as ambiguous blank cells, and re-presents the **advisory** "1 failed" as a red headline with no advisory/enforcing distinction

**Purpose:** The pipeline's FINAL job — render `operational-metrics.json` (#48) into `public/index.html` so **GitLab Pages** serves a human-readable, dependency-free dashboard (gate banner, per-section cards, gate ledger, input-sources table, flat-metrics map). Pure observability; it never gates. This is `deploy-prep` 4/4 and the last job in the pipeline.

**What it does ([.gitlab-ci.yml:3018-3037](.gitlab-ci.yml#L3018-L3037)):** `needs: metrics-normalize` (artifacts), `allow_failure: true`, `before_script: []`; runs `render_metrics_dashboard.py --metrics ${REPORTS_DIR}/operational-metrics.json --out-dir public`. The renderer ([render_metrics_dashboard.py:244-265](scripts/render_metrics_dashboard.py#L244-L265)): if the metrics file is **absent**, it renders an empty-but-valid dashboard so Pages stays publishable (`:254-259`); else it loads the JSON, **copies it into `public/`** (the "raw JSON" link), and writes `public/index.html` with `encoding="utf-8"` (`:264`). Self-contained by design — **inline CSS, no JavaScript, no CDN** (`:6`). Artifact: `public/`, 90 days.

**Run evidence (`80619005`, job 14906999115):** `dashboard → public/index.html`; `public: found 3 matching artifact files and directories` (the `public/` dir + `index.html` + the copied `operational-metrics.json`); uploaded 201. Job **succeeded** — the pipeline's final green job.

**Findings:**
- ✅ **F1 — Real, dependency-free render.** It genuinely produced a static dashboard from #48's JSON — banner (10/1/0), security / supply-chain / model-integrity / data-quality cards, the 11-row gate ledger, the 37-row sources table, and 18 flat metrics — with **inline CSS only and a raw-JSON link**, so it survives offline with no external fetch. The empty-input fallback (`:254-259`) keeps Pages publishable even if the normaliser produced nothing — correct "a dashboard must survive partial input."
- 🔴 **F2 — Negative-polarity booleans are mis-colored (confirmed renderer bug).** `render_value` (`:71-73`) colors **every** boolean `true→ok(green)` / `false→bad(red)`. So `data_quality.evidently.drift_detected:false` renders as a **red `pill bad`** (`<span class="pill bad">False</span>`) — the lone red pill in the Data-Quality card — even though **no-drift is the GOOD outcome**. The logic is polarity-blind: any future `infected`/`vulnerable`/`dirty` boolean would be mis-colored the same way. (→ **Fix #28a**.)
- ⚠️ **F3 — #48's present-but-`null` gaps surface as ambiguous blank cells.** `markllm.{ready,import_ok}`, `hf_scan.*`, and `download.size` render as empty `<td></td>` (a `None` scalar falls to `fmt(None)` → blank, `:76`), **indistinguishable from a missing input** — a viewer cannot tell "ran but unparsed" (markllm, which genuinely ran #38) from "absent." This is #27a / #48-F4 made visible at the presentation layer. (→ **Fix #27a** data-side + **Fix #28b** render-side.)
- ⚠️ **F4 — Gate-semantics carry through (#27b / #48-F3).** The red banner tile "**1 gates failed**" and the ledger's red `semgrep-sast` row present an **advisory** (`allow_failure`) finding as a failure, with no advisory/enforcing distinction and **none of the real hard gates shown**. "10 passed / 1 failed" reads like deploy state when it isn't. (→ **Fix #27b**.)
- ℹ️ **F5 — Otherwise faithful, safe, and correctly encoded.** Values are `esc()`'d throughout (no injection from detail strings), and it accurately renders `ai_bom=99` (incl. 96 `library`), `1 PII PERSON`, and 27-present/10-absent sources. **The output is clean UTF-8** — the renderer's source bytes are verified clean (`c2 b7` for `·`, not double-encoded), `write_text(..., encoding="utf-8")`, and `<meta charset="utf-8">`. ⇒ **The mojibake seen in a copied/pasted `index.html` (`GAIPS CI Metrics â …`, `Â·`, garbled emoji) is a transport/paste artifact, NOT a renderer bug.** If the *live* Pages site is garbled, investigate GitLab Pages' served `Content-Type`/charset — not this script.
- ℹ️ **F6 — Empty operational section rendered honestly.** With `operational.skipped=true`, the card shows `Skipped — GITLAB_API_TOKEN not set` (`:124-125`) — no timing/jobs data this run, consistent with #48-F6.

**Recommended fixes** (finding → fix):
1. **F2** → **Fix #28a**: in `render_value` (`:71-73`) replace the uniform `true=ok/false=bad` with a polarity-aware rule — a set of negative-polarity keys (`drift_detected`, `infected`, `vulnerable`, `dirty`, …) whose colors invert (`false→ok`, `true→bad`); leave positive-polarity bools (`valid`/`clean`/`passed`) as-is.
2. **F3** → **Fix #28b** (render) + **Fix #27a** (data): render `None` as an explicit `n/a`/`unparsed` instead of a blank cell, and once #27a adds the `"present-but-unparsed"` Sources state, badge those inputs distinctly so a parse gap is visible rather than blank.
3. **F4** → **Fix #27b**: thread an `enforcing` flag into the gate ledger + banner so advisory findings (semgrep) are visually distinct from hard-gate failures.

**Verdict:** ✅ **Real work** — `pages` genuinely renders #48's JSON into a self-contained, JavaScript-free GitLab Pages dashboard (verified clean-UTF-8 output, `esc()`'d, with an empty-input fallback) and is the pipeline's **final green job**. ⚠️ Its weaknesses are presentation-fidelity, not execution: it **mis-colors negative-polarity booleans** (`drift_detected:false` shows red — Fix #28a), surfaces #48's **present-but-`null`** values as ambiguous blank cells (Fix #27a/#28b), and re-presents the **advisory** "1 failed" as a red headline with no advisory/enforcing distinction (Fix #27b). The mojibake in the pasted HTML is a transport artifact, not a bug.

---

## 🏁 WALKTHROUGH COMPLETE — `deploy-prep` 4/4; all jobs documented

Every job that instantiated on `8061900` (`gaips-pipeline-required-fixes`) has now been validated against its CI definition + backing script + real run log/artifacts, from `setup` through `pages`. Two legs remain **DEFERRED** pending a re-run of the unpushed `ff9bd7e` fixes: #30 `great-expectations-validate` / #31 `ydata-profile` / #32 `dataset-sign` (no run evidence on this commit). Next phase is **applying the REQUIRED FIXES** (see `SESSION_HANDOFF.md`): Tier-0 #0, plus #23, #24a/b, #25, and the walkthrough-surfaced #26 (`publish-signed-artifacts`), #27 (`metrics-normalize`), and #28 (`pages`) — ideally folded into one billable re-run that also exercises the deferred #30/#31/#32 and this session's uncommitted CI edits together.
