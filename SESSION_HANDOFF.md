# Session Handoff — GAIPS Model Pipeline (2026-06-17)

> **NAMING:** This is the **GAIPS model pipeline**. The repo/dir is named `counter-spy` and
> holds untracked, unrelated project dirs (`services/`, `packages/`, `src/`, `ctf-frontend/`)
> — those are a SEPARATE project, not part of this pipeline. Do not call this "Counter-Spy".

---

# ⏸️ STATUS (2026-06-17): ALL 22 FIXES APPLIED — re-run the pipeline, then resume at #30

**Update:** the 22-item REQUIRED-FIXES list below is **fully applied** (all boxes checked) in the working
tree (NOT yet committed/pushed — pushes trigger billable runs; commit when ready). **Next:** commit + push
to trigger one pipeline run, watch it, then resume the walkthrough at #30 against real (now-populated) data.

⚠️ **What changed behaviourally (watch on the re-run):**
- **The dataset chain now EXECUTES for the first time** (#28 `dataset-redact` → #29 validate → #30 GX →
  #31 profile → #32 sign). Previously it skipped green on empty data. `dataset-redact` (`needs:` now also
  `dataset-download`) installs presidio + spacy + gitleaks and redacts the committed fixture, fail-closed.
- **Several controls now ENFORCE** (`allow_failure:false`): `model-signing-install`, `model-sign`,
  `modelaudit-scan`, `tamper-verification`, `hf-artifact-scan`, plus the new `signature-verification`
  zero-sig / unset-identity hard fails. Per the run-`6a48e52` evidence these all passed their work, so they
  *should* stay green — but a previously-masked failure will now surface (that's the point).
- `signature-verification` now **requires** `MODEL_SIGNING_IDENTITY` + `SIGSTORE_OIDC_ISSUER` to be set
  (they were, per findings #18/#19) and emits per-sig SAN/issuer/Rekor-logIndex/recomputed-digest evidence
  via the new `scripts/explain_signature.py`.
- New CI variables: `DATASETS_DISABLED` (escape hatch — set "true" to intentionally run with the dataset
  chain off, exit 0), `DATASET_ALLOW_UNVERIFIED`, `HF_AUTHOR_ALLOWLIST`, `HF_PINNED_SHAS`,
  `MODEL_SIGNING_VERSION`/`SIGSTORE_PY_VERSION`/`MODELAUDIT_VERSION` (pins).
- **Deviations from the written fix:** Fix #16 (`dataset-scan`) keeps `python:3.11-slim` with
  `apt-get … --no-install-recommends clamav` instead of the `clamav/clamav` image — the job still needs
  python3 for its structural-JSONL gate, which that image lacks; `--no-install-recommends` is what actually
  removes the ~73-pkg exim4 mail-server stack. Fix #12 (`hf-artifact-scan`) was **rewritten** as a
  provenance gate (model_info: disabled / author-allowlist / pinned-sha), dropping its apt-ClamAV +
  modelscan re-download. Fix #13 (`model-signing-install`): chose the "gate" option (dropped allow_failure).

**Deliberate robustness choices (NOT omissions — flagged so a reviewer doesn't read them as gaps):**
- **Fix #5 ClamAV `Scanned files` assert** parses leniently (`grep -oE`) and, on a parse MISS, falls back to
  a file-count / `-s` check instead of failing. Reason: clamav-scan + dataset-scan are `allow_failure:false`
  HARD gates — a summary-format quirk must not false-fail a genuinely clean scan. It still fails on a
  positively-empty (0-file) scan, which is the actual hole the fix targets.
- **Fix #6 `explain_signature.py` is REPORT-ONLY (always exit 0).** A recomputed-vs-signed digest difference
  prints a loud WARNING but does not fail the job: model-signing's manifest digest isn't guaranteed to be a
  raw per-file sha256, so a naive recompute is an unreliable *gate*. `model_signing verify` (run immediately
  before, hard) remains the authoritative tamper gate; this step only adds the SAN/issuer/Rekor/digest
  evidence the fix asked for.
- **`DATASETS_DISABLED` is wired end-to-end:** `dataset-download` itself honours it (stages no fixture), so
  the flag actually disables the whole chain rather than being silently overridden by the always-on fixture.
- **Out of scope (intentionally not pinned):** `modelscan` (#21, "leave alone" per prior guidance) and the
  data-tooling installs (presidio/jsonschema/great-expectations/ydata/huggingface_hub) — Fix #11 was scoped
  to the signing/audit toolchain (model-signing/sigstore/modelaudit), which IS pinned (incl. the two
  out-of-list jobs model-signing-evidence + sigstore-identity-discover, pinned for consistency).

**Resume point (after the green re-run):** `great-expectations-validate` **#30**, then `ydata-profile` #31,
`dataset-sign` #32, `artifact-signing-gate` #33 — now against real, redacted data.

Per-job findings **#16–#29 are authoritative in `docs/gaips-materials/PIPELINE_JOB_VALIDATION.md`** (and
mirrored in auto-memory `project_gaips_pipeline.md`). The "Findings so far" list lower in THIS file covers
only **#1–#15** and is not maintained past that — use the validation doc for #16+.

---

# 🔧 REQUIRED FIXES (apply in this order)

Ordered by severity: **Tier 1 = green-but-does-nothing security controls** (fix first), then enforcement/
auditability gaps, then pinning/scope, then hygiene/waste. Each item: `job #` · problem · concrete fix.
Checkboxes so the next session can track progress.

### Tier 1 — Broken / inert security controls (highest priority)
- [x] **1. `dataset-redact` #28 — BROKEN CHAIN (cascades to #29–#32).** Redaction never runs and fails
  **open**: `needs:[dataset-scan]`, but `dataset-scan` #27 doesn't republish `evidence/dataset-input/`, so
  redact gets an empty input, **skips green**, and republishes an empty dir that starves validate/GX/
  profile/sign. **Fix:** set `needs: ["dataset-scan","dataset-download"]` (gate ordering + the file) — or
  have `dataset-scan` #27 add `evidence/dataset-input/` to its `artifacts`; **and** change the no-dataset
  skip branch to `exit 1` when a dataset is expected (reserve the silent skip for an explicit
  "datasets-disabled" flag). This single fix unblocks the whole post-scan dataset chain.
- [x] **2. `gitleaks-scan` #8 — THEATER (zero rules).** `.gitleaks.toml` has only an allowlist → gitleaks
  runs with **no rules** and always passes. **Fix:** add `[extend]\nuseDefault = true` to `.gitleaks.toml`
  (keep the existing test-fixture allowlist).
- [x] **3. `modelaudit-scan` #22 — INVERTED GATE.** Gates only on modelaudit `exit 2` (operational error /
  no-files) and **ignores `exit 1`** (the code for "warning or CRITICAL found") → a CRITICAL passes green.
  **Fix:** gate on findings — `if audit_exit == 1: sys.exit(1)` (and/or on the computed `critical`/`warning`
  counts) — **then** drop `allow_failure: true` if it's meant to enforce.
- [x] **4. `signature-verification` #19 — VACUOUS ON ZERO SIGNATURES.** Passes green if no `model.sig`
  exists (`SIG_COUNT==0` → "skipped", no `exit 1`); combined with `model-sign` #18 being `allow_failure:true`,
  a silent signing failure → empty sig set → green gate verifying nothing. **Fix:** `exit 1` when
  `SIG_COUNT==0` and `${MODEL_DIR}` has model files; and/or drop `allow_failure` on `model-sign` #18.

### Tier 2 — Enforcement / auditability gaps on real gates
- [x] **5. ClamAV `--no-summary` (cross-cutting: `clamav-scan` #24 + `dataset-scan` #27).** Both clamscan
  calls suppress the summary → the hard gate's `*.log` is empirically blank; can't prove a DB loaded or the
  file was read. **Fix in both:** drop `--no-summary` (tee summary into the `.log`/`.json`), record
  signatures-loaded + files/bytes scanned, and assert `Scanned files >= 1` so an empty scan fails.
- [x] **6. `signature-verification` #19 — EXPLAINABILITY.** Logs only "MODEL_SIGNING_IDENTITY is configured"
  / "Verification succeeded" — never the actual identity/issuer/digest/Rekor entry, so a too-permissive
  `MODEL_SIGNING_IDENTITY` passes undetectably. **Fix:** echo + persist the resolved identity (full), issuer,
  recomputed sha256, and matched cert SAN + Rekor `logIndex`.
- [x] **7. `dataset-download` #26 — OPT-IN INTEGRITY (weaker than model #16).** Download-mode SHA check only
  fires `if [ -n "${DATASET_EXPECTED_SHA256}" ]` → an unset var means a downloaded dataset is accepted
  unverified. **Fix:** make download mode **fail when `DATASET_EXPECTED_SHA256` is unset** (or ship a
  committed default digest, mirroring `MODEL_FIXTURE_SHA256`). *(User-agreed.)*
- [x] **8. `tamper-verification` #20 — NON-GATING + NON-DURABLE.** `allow_failure:true` neuters the
  `sys.exit(1)` on detected tamper, and with `VAULT_ADDR` unset the baseline sits in a best-effort cache that
  silently re-seeds on eviction. **Fix:** drop `allow_failure`; set `VAULT_ADDR` so the baseline is durable.

### Tier 3 — Supply-chain pinning / scope
- [x] **9. `IMAGE_TRIVY` #14 — UNPINNED `:latest`.** Contradicts the "all images pinned" claim. **Fix:** pin
  `aquasec/trivy:0.71.1` (ideally by digest).
- [x] **10. `trivy-scan` #14 — scans `.pip-cache/` CI cruft → false-positive secret.** **Fix:**
  `trivy fs . --skip-dirs .pip-cache` (kills the PyJWT-doc-example "JWT" finding + third-party noise).
- [x] **11. Unpinned security libs (#15/#17/#18/#19/#22).** `model-signing`/`sigstore` installed with no
  `==`; `modelaudit[all]>=0.2.47` is a floor. **Fix:** pin exact versions (or a hashed lockfile) for the
  signing/scanning toolchain.
- [x] **12. `hf-artifact-scan` #25 — net-negative as wired.** Installs-then-skips (apt clamav incl. exim4 +
  modelscan, *then* checks `HF_MODEL_IDS`); non-gating. **Fix:** **discard** (local model already covered by
  #24/#16/#18/#19), **or** rewrite as a lightweight `huggingface_hub` provenance/policy gate — `model_info`,
  **fail on `disabled`**, author allowlist + pinned `sha`, inspect `siblings`; skip-guard to the top; drop
  apt-ClamAV; make it gating. *(Leave `modelscan` #21 alone — intentional legacy `.pkl`/`.pth` coverage.)*

### Tier 4 — Redundancy / waste / hygiene
- [x] **13. `model-signing-install` #15 — provisions nothing, gates nothing.** Its install is discarded;
  dependents reinstall the stack. **Fix (pick one):** drop `allow_failure` so it gates; **or** publish the
  verified cosign binary + venv as `artifacts:` for reuse; **or** delete it (let `model-sign` be the canary).
- [x] **14. `model-digest` #17 — dead 37-pkg install.** `pip install model-signing` is never used (digest
  loop is pure `sha256sum`). **Fix:** delete the install line + `cache: {}`.
- [x] **15. Cache bloat → `no space left on device` (#22).** The shared `pip-main-protected` cache is
  re-uploaded by jobs that don't use pip; it hit the runner disk ceiling at #22 (intermittent/runner-local).
  **Fix:** `cache: {}` on Python-less / curl-only / stdlib-only jobs (syft #10/#11, model-fixture-download
  #16, dvc #12, modelfile-audit #23, dataset-* jobs); prune / split the shared cache key.
- [x] **16. `dataset-scan` #27 (+ #25) — apt-installs a ~73-pkg mail-server stack to scan bytes.** **Fix:**
  use the `clamav/clamav:1.4` image (like #24) instead of `apt-get install clamav` — also removes the
  freshclam-config error noise and ships a bundled DB.
- [x] **17. Install-then-skip ordering (#25, #29, #26).** Heavy installs run before the skip guard. **Fix:**
  move the skip/`HF_MODEL_IDS`/no-dataset guards **above** the install steps.

### Tier 5 — Lower-severity correctness / cosmetic
- [x] **18. `pkg-integrity` #7 — manifest records the wrong env** (post-`deactivate` base python). **Fix:**
  write the manifest before `deactivate` (or call the venv interpreter explicitly). Also: enforce the
  generated hashes (`--require-hashes`) once `requirements.hashed.txt` is committed.
- [x] **19. `secret-detection` #6 — shell bug** `grep -c … || echo 0` doubles to `"0\n0"` → garbled summary
  (gate still holds). **Fix:** drop `|| echo 0` / normalize with `| head -1`.
- [x] **20. `setup` #1 — `dirty` is non-functional** (no `git` in `python:3.11-slim`; prints "clean" meaning
  "unknown"). **Fix:** install git in the image, or relabel `null` as "unknown".
- [x] **21. `conda-pkg-verify` #9 — `defaults` channel removal silently failed** (`|| true`). **Fix:** assert
  the channel list / use a clean condarc.
- [x] **22. Skip messages that disguise breaks (#29, and the chain generally).** "evals run on fixtures" /
  "no dataset present" make a wiring break look intentional. **Fix:** skip reasons must distinguish
  "disabled by config" (ok, exit 0) from "expected-but-missing" (`exit 1`).

> After Fix #1 (+ #5/#16 to the clamav jobs), **re-run the pipeline** so the dataset chain populates, then
> resume the walkthrough at #30 to validate `great-expectations-validate` / `ydata-profile` / `dataset-sign`
> / `artifact-signing-gate` against real data.

---

# ACTIVE TASK (resume here AFTER fixes) — Pipeline job validation walkthrough

**Goal:** Walk through **every successful job** of pipeline run `2606572181 @ 6a48e525` (main)
and, for each: (1) validate it performs real work (not exit-0 theater), (2) document it.

**Output doc:** `docs/gaips-materials/PIPELINE_JOB_VALIDATION.md` (accumulates one entry per
job; legend ✅ real / ⚠️ works-but-caveat / 🔴 broken/theater).

**Method (per job):**
1. Read the job's block in `.gitlab-ci.yml` + its backing script in
   `docs/gaips-materials/scripts/` to set *expected* behavior.
2. **User pastes the real GitLab job log/artifacts** (no `glab`/docker locally; cannot pull
   them — user copies them in, step by step).
3. Validate paste vs expectation; write the doc entry. Go in pipeline-stage order.

**⚠️ VERDICT DISCIPLINE (lesson from this run — DO NOT REPEAT).** On `model-signing-install` #15 I
first wrote ✅ and buried the real problem under "caveats are scope/hygiene, not correctness." The
user pushed back ("what's the point of it?") and the honest answer was that the job is **near-
redundant** (can't gate — `allow_failure:true`; provisions nothing — no `artifacts:`; dependents
reinstall the stack). **Rule: lead the heading + verdict with the most damning true finding, not the
reassuring one.** A job that runs without error is NOT automatically ✅ — if it gates nothing,
provisions nothing, scans cruft, or covers ~nothing, say so up front. For every job explicitly ask:
**does it actually enforce/verify/cover anything, or is it green theater?** Trace `needs:` (GitLab
`needs:` carries ARTIFACTS only — a dependency on an artifact-less job is just ordering), check for
`allow_failure`/`--exit-code 0`/missing `--fail-on`, and check whether the thing it scans/signs even
exists this run. When unsure whether a caveat is cosmetic or fundamental, assume fundamental and dig.

**Progress: 29 / 50 jobs done (PAUSED for fixes — see REQUIRED FIXES above); `model-integrity` 15/20.**
`sast`+`sbom`+`vuln-scan` COMPLETE. Stage order:
setup·sast·sbom·vuln-scan·**model-integrity(20)**·ai-eval·guardrail·evidence·ai-bom·deploy-prep.
**Resume at #30 `great-expectations-validate`(1730)**, then `ydata-profile`(1765), `dataset-sign`(1794),
`artifact-signing-gate`(1847) — last 5 of `model-integrity`. (All 4 of those depend on the dataset chain;
they will skip on empty data until **Fix #1** lands and the pipeline is re-run.) After `model-integrity`:
`ai-eval`·`guardrail`·`evidence`·`ai-bom`·`deploy-prep` stages remain.

**⚠️ DRIFT GUARD — do NOT re-review #1–#29.** The 29 reviewed jobs each already have a `## ` heading in
`PIPELINE_JOB_VALIDATION.md` (the authoritative record). **`grep '^## ' docs/gaips-materials/PIPELINE_JOB_VALIDATION.md`
before adding any entry** to avoid duplicates. Reviewed so far, in walkthrough order:
setup, model-manifest, vault-secrets, gitleaks-scan, secret-detection, pip-audit, pkg-integrity,
conda-pkg-verify, semgrep-sast, syft-cyclonedx, syft-spdx, dvc-verify, grype-scan, trivy-scan,
model-signing-install, model-fixture-download, model-digest, model-sign, signature-verification,
tamper-verification, modelscan, modelaudit-scan, modelfile-audit, clamav-scan, hf-artifact-scan,
dataset-download, dataset-scan, dataset-redact, eval-dataset-validate. **NB:** `sigstore-identity-discover`
(line 866) does NOT instantiate on normal commits (manual-only rule) — skip it; the run is ~49 jobs, not 50.

**Findings so far (the real deliverable):**
- `setup` ✅ but ⚠️ `version-info.json` `dirty` is **non-functional** — job image `python:3.11-slim`
  has no `git`, so all provenance comes from `CI_*` env fallbacks; `dirty`→`null` while the log
  misprints `clean` (means "unknown"); `describe` can't work. Values themselves are correct.
- `model-manifest` ✅ — validates `evals/model-baseline.json` (Qwen2.5, 8 vars), fail-fast identity gate, dotenv propagated.
- `vault-secrets` ⚠️ **inert** — `VAULT_ADDR` unset → graceful skip; JWT + 8-secret KV fetch path **untested**.
- `gitleaks-scan` 🔴 **THEATER** — `.gitleaks.toml` has only an allowlist, **no `[[rules]]` and no
  `[extend] useDefault = true`** → gitleaks runs with **zero rules** → always passes regardless of
  secrets; log looks identical to a healthy scan. Confirmed via gitleaks docs (context7) + committed
  config + run behavior; NOT empirically reproduced (no docker/gitleaks locally). **Fix:** add
  `[extend]\nuseDefault = true` to `.gitleaks.toml`.
- `secret-detection` ⚠️ — GitLab `secrets:4` analyzer = gitleaks with GitLab's **real** bundled
  ruleset, but `GIT_DEPTH:1` = **current commit only**. With gitleaks-scan inert, **git history is
  unscanned for secrets.** Also a shell bug: `grep -c '"severity"' || echo 0` doubles to `"0\n0"` on
  zero matches → garbled summary + `sh: bad number`; gate still holds (no fail-open).
- `pip-audit` ✅ — genuine (OSV/PyPI/GitHub advisory DBs), `0` vulns, tool self-attests it scanned.
- `pkg-integrity` ⚠️ — `pip check` real + passed; `requirements.hashed.txt` is high-quality. BUT
  hashes **generated not enforced** (`warn_generated`), AND 🔴 the manifest records the **wrong env**
  (artifact = bare base python `{packaging,pip,setuptools,wheel}`, not the verified tree) because
  `pip list` runs **after `deactivate`**. Nit: lockfile has `--trusted-host` lines (TLS bypass).
- `conda-pkg-verify` ✅ — real second-channel verification, all deps installed **from conda-forge**
  (49 pkgs), manifests use `-n ci-verify` (correct env). Caveats: `conda config --remove channels
  defaults` **silently failed** (`|| true`) so `defaults` still active; deprecated miniconda image.
- `semgrep-sast` ⚠️ — genuine multi-language SAST (3108 files, 1059 Community rules fetched via
  `--config=auto` → 424 run, ~100% parsed, 0 parse errors, 4 findings). BUT **non-enforcing**:
  `allow_failure: true` + plain `semgrep scan` exits 0 even with findings (no `--error`) → 4
  findings land in the dashboard, job stays green ("4 blocking" = semgrep severity, not pipeline-
  blocking). Also: `IMAGE_SEMGREP` var (line 53) is **dead** (job uses `python:3.11-slim` + `pip
  install semgrep`); `--config=auto` is a registry-egress dependency (offline → silent zero
  coverage). **Carried-over "3 ERRORs" item RESOLVED:** that run had 0 parser errors — the note
  was about finding *severity*; the 4 findings' contents are only in `reports/semgrep.json` (not
  in the log), so per-finding triage is **parked** (out of walkthrough scope).
- `syft-cyclonedx` ⚠️ — **real but SHALLOW** (verified against the actual `sbom.cyclonedx.json`).
  syft (`anchore/syft:v1.45.1-debug`, digest matched pin) walks `dir:.` and emits valid CycloneDX
  1.6 **JSON + XML** (syft 1.45.1, real serialNumber/timestamp), both uploaded (`201 Created`).
  **KEY FINDING — only 3 components**: `jinja2@3.1.6`, `pandas@2.3.3`, `requests@2.34.2`, ALL from
  `/requirements.txt` (`python-pip-requirements-entry`) + the requirements.txt file. **NO transitive
  closure** (no numpy/urllib3/certifi/idna/MarkupSafe/…) — it scans the **source tree**, not an
  installed venv. Cross-check: `conda-pkg-verify` #9 resolved **49 pkgs** for the same pins; this
  SBOM has **3**. **Downstream `grype` consumes this exact file → grype only vuln-scans the 3 direct
  deps, blind to all transitives.** Fix for real coverage: scan an installed env (`syft dir:<venv>`
  after pip install). Minor caveats: (a) root component name = `"."` (path-derived, confirms `WARN
  no explicit name/version`; fix `--source-name`/`--source-version`); (b) no-op pip cache
  restore+save (~1 min) since syft image has no Python + `before_script:[]` — fix `cache: {}` (same
  applies to `syft-spdx`). Downstream `grype` (`needs:[syft-cyclonedx]`) guards with a file-exists
  check so `allow_failure:true` can't silently feed it a missing SBOM. **WATCH the grype review
  (vuln-scan stage): expect ≤3 packages scanned given this shallow input.**
- `syft-spdx` ⚠️ — **as predicted, a byte-for-byte clone of `syft-cyclonedx`** (same image digest,
  double `WARN`, `needs:[setup]`, no-op pip cache), emitting SPDX **json + tag-value**, both
  uploaded (`201 Created`, artifact `14888933929`). Inherits the **shallowness** (3 deps, no
  transitives — same scan engine/input as #10, not independently re-verified vs the `sbom.spdx.json`
  artifact) and both hygiene caveats. **Distinction:** the SPDX content has **no downstream
  consumer** — `grype` reads the CycloneDX json; `evidence-summary` lists `syft-spdx` in `needs:`
  (line 2121) but only **bundles** the artifact (`write_ci_evidence_summary.py` never references
  `sbom.spdx*`). So SPDX = compliance/interchange deliverable only.
- `dvc-verify` ⚠️ — **INERT** (same pattern as `vault-secrets`). `.dvc/` absent → took the skip-guard
  branch (line 642), wrote `{"skipped":true,"reason":"dvc not initialized"}` (artifact verified
  exactly), `exit 0`. The real integrity check (`pip install dvc[all]` → `dvc data status --granular
  --json`, remote pull) **never ran** — unvalidated until `dvc init`. Correct skip + clean artifact,
  honest advisory placeholder, but **zero data-governance signal** this run. Minor: `before_script`
  still upgrades pip + **uploaded** the cache (~2 min) on a job that skips (move the guard earlier /
  `cache: {}`). `--granular` flag unverified-at-runtime (real DVC flag, but path didn't execute).
- `grype-scan` ⚠️ — **real scanner, hollow signal.** CONFIRMS the #10 prediction: `grype.json`
  `source:{type:file,target:"."}`, `matches:[]` → "No vulnerabilities found", but it scanned the
  **shallow 3-dep CycloneDX SBOM** (jinja2/pandas/requests only) — **transitive-blind**
  (numpy/urllib3/certifi/idna never assessed), so 0 vulns ≠ clean tree. The vuln DB IS real+fresh
  (grype 0.114.0, DB schema **v6.1.7 built 2026-06-16T08:14:01Z**, full provider set, `valid:true`).
  **Non-enforcing twice:** no `--fail-on` (artifact: `fail-on-severity:""` → exits 0 any severity)
  **+** `allow_failure:true`. Defensive file-exists guard (line 684) gates correctly on the
  allow_failure upstream SBOM. Fix: deeper SBOM upstream + `--fail-on high` to actually gate.
- `trivy-scan` ⚠️ — **real + broader than grype, but 4 issues.** trivy 0.71.1, fresh `trivy-db:2`
  (96 MB), vuln+secret scanning. `trivy fs .` (repository scan) → `requirements.txt`→pip→3 deps → **0
  vulns** (same shallowness: `WARN no site-packages` = declared, not installed). **NEW capability:**
  secret scanner fired **1 MEDIUM "JWT token"** — but it's a **FALSE POSITIVE** in
  `.pip-cache/http-v2/…body` (a restored pip-cache HTTP download), the canonical **PyJWT docstring
  example**. Reveals trivy scans the restored `.pip-cache/` CI cruft (fix `--skip-dirs .pip-cache`).
  🔴 **`IMAGE_TRIVY = aquasec/trivy:latest` UNPINNED** (var line 57) — contradicts the "all images
  pinned" claim (corrected the stale "trivy v0.71.0" note in memory). `trivy image
  ${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA}` **vacuous** — no image built in this static pipeline →
  fallback `{"Results":[]}` but still published as the GitLab `container_scanning` report (green over
  zero coverage, like vault/dvc). **Non-enforcing triply:** `--exit-code 0` ×3 + `allow_failure:true`.
- `model-signing-install` ⚠️ — **executes correctly but NEAR-REDUNDANT as wired** (user asked "what's
  the point of it?"). It *does* install `model-signing 1.1.1`+`sigstore 4.3.0` + import smoke test, and
  cosign is **pinned v2.4.1 + checksum-verified** (`sha256sum --check --strict` → `cosign-linux-amd64:
  OK`) — good cosign hygiene, contrast `trivy:latest`. **But it neither gates nor provisions:**
  `allow_failure:true` → can't fail-fast (cosmetic red dot, pipeline proceeds); **no `artifacts:`** →
  `needs:` carries only an ordering edge, so the 3 dependents (`model-digest` 800 / `modelscan` 1089 /
  `clamav-scan` 1303) reinstall the stack themselves — **verified `model-digest` line 803 reinstalls
  `model-signing` then never uses it** (only `sha256sum`s files); cosign re-verified from scratch in ≥3
  jobs (1820/2208/2484). Its ~3-min install is discarded; survives only as a UI canary. **Fix:** drop
  `allow_failure` to gate, OR publish the verified cosign/venv as `artifacts:` for reuse, OR delete it
  and let `model-sign` be the canary. (Python signing libs also unpinned, no `==`.)
- **SCOPE NOTE:** repo = 77 committed files, all GAIPS pipeline materials; the untracked app dirs are
  a separate project (0 committed files) and are never scanned. "All files" = these 77.

**Recurring theme:** several controls are *present but not wired/enforced* (Vault secrets,
hash-pinning, gitleaks rules) — capability scaffolded, real enforcement off. Flag these.

---

## TL;DR (prior session — the split)
This session executed the **live-scan pipeline split** (planned in the prior handoff):
the 6 endpoint/inference eval jobs were removed from the main `.gitlab-ci.yml` and
cloned into a standalone `docs/gaips-materials/ci/live-scans.gitlab-ci.yml` for a
separate, inference-having project. The main pipeline is now **static supply-chain +
model-integrity + data-drift only — no inference, no `MODEL_ENDPOINT`**. All GAIPS tech
docs were updated to match, a `.gitignore` was added, and **three commits were made and
PUSHED to `gitlab/main` (`6a48e52`)** — a pipeline run is now triggered on that commit.

## Commit stack (PUSHED this session — newest first)
```
6a48e52  docs: reflect the live-scan pipeline split across all GAIPS tech docs
e3d3845  ci: split endpoint-dependent live evals into a separate pipeline
668153f  chore: add .gitignore for secrets, build output, and caches
```
`gitlab/main` moved `05dab5b..6a48e52` (this also pushed the prior session's 5 commits +
its handoff commit `bfdb8c4`, which had never been pushed). `main` == `gitlab/main`.

## ⚠️ Eval baseline seed — needed on OUTPUT to populate the NEXT pipeline
- `model-drift-detection` produces `eval-baseline.seed.json` when no committed baseline
  exists; `evidence-summary` bundles it into the 90-day evidence artifacts. **That seed
  is the output that must be carried into the next run:** download it from this run's
  evidence and commit it to `evals/eval-baseline.json`, or drift detection just re-seeds
  every run and `drift-gate` passes vacuously.
- **After the split this matters more:** the main (static) pipeline's drift job has **no
  live-eval metrics**, so the seed it emits here is thin/empty. The *meaningful*
  eval-metric baseline now comes from the **separate live-scan pipeline's** run — its
  `eval-baseline.seed.json` output is what should populate drift detection. Flow: run
  `live-scans.gitlab-ci.yml` against a real `MODEL_ENDPOINT`, take its eval-baseline
  seed output, and commit it so the next pipeline has real eval metrics to gate on.
- `GITLAB_PUSH_TOKEN` (PAT, scope `write_repository`) lets `model-baseline-commit`
  auto-commit the seed on the default branch; unset → grab it manually from artifacts.

## Repo / layout facts (evergreen — keep in mind)
- Working dir & git repo root: `/Users/nate/Documents/Counter-Spy Claude.ai/`
- **Authoritative CI config is repo-root `.gitlab-ci.yml`** (the static pipeline). The
  live-eval pipeline is `docs/gaips-materials/ci/live-scans.gitlab-ci.yml` — committed
  but NOT wired to run here; it's meant to be the root config of a *separate* project.
- GAIPS scripts/docs live under `docs/gaips-materials/` (scripts in `…/scripts/`).
- Remotes: `gitlab` = git@gitlab.com:natecarrollfilms/counter-spy.git (the pipeline),
  `origin` = the GitHub app repo. Branch: `main`.
- **The app and the pipeline are SEPARATE.** The untracked `services/`, `src/`,
  `packages/`, `ctf-frontend/`, `dist/`, `node_modules/`, `graphify-out/`, `.env.*.local`,
  `.DS_Store` are the separate app — **do NOT delete or commit them**. The new
  `.gitignore` now hides the cruft/secrets (`.env*.local`, `node_modules/`, `dist/`,
  `.pip-cache/`, `graphify-out/`, `.DS_Store`); `services/` + `packages/` are left
  untracked (source, not cruft). Always `git add` explicit paths, never `-A`/`.`.

## What was done this session
1. **Split (`e3d3845`):** deleted `promptfoo-eval`, `garak-scan`, `giskard-scan`,
   `inspect-ai-eval`, `pyrit-scan`, `guardrail-regression` from `.gitlab-ci.yml`; removed
   them from every `needs:` (`evidence-summary`, `ai-bom-assemble`,
   `model-drift-detection`) and dropped `model-drift-detection`'s now-empty `needs:`.
   Trimmed `write_ci_evidence_summary.py` `EXPECTED` so it no longer hard-fails on the
   moved live-eval reports (kept `semgrep.json`, `markllm-results.json`). Kept
   `pyrit_scan.py`'s `shlex.split` (no-shell) hardening for the relocated job.
   **Stayed in main:** `markllm-deps-audit`, `markllm-watermark-eval`,
   `model-drift-detection`, `model-baseline-commit`, `drift-gate`, `evidently-drift`.
2. **New standalone pipeline (`e3d3845`):** `ci/live-scans.gitlab-ci.yml` — self-contained
   (own `variables`, `.python-secure`/`.resolve-reqs` anchors, `default`), 6 jobs across
   `ai-eval` + `guardrail`, only internal edge `guardrail-regression → promptfoo + pyrit`.
   Requires `MODEL_ENDPOINT` (skips cleanly when unset) and the live-eval scripts/configs
   copied into the separate project.
3. **Docs (`6a48e52`):** added `ci/live-scans.md` (full reference for the separate
   pipeline) and updated README, SETUP, CI-VARIABLES, SBOM, the Vault secret map, and the
   per-eval lab docs (garak/giskard/pyrit/guardrail-regression). Mermaid diagrams,
   `MODEL_ENDPOINT` framing, and SBOM dependency tables all reflect the static-only main
   pipeline. `evals/markllm.md` unchanged (MarkLLM stays in main).
4. **`.gitignore` (`668153f`)** and pushed all three to `gitlab/main`.

Local validation: both YAMLs parse (custom `!reference` loader); no dangling `needs:`;
`write_ci_evidence_summary.py` exits 0 with only the staying reports present; doc
cross-links resolve; mermaid `ai-eval`/`guardrail` subgraphs match the 50 main-pipeline
jobs.

## Watch on THIS run (`6a48e52`)
- `ai-eval` → only `markllm-deps-audit` + `markllm-watermark-eval`. `guardrail` →
  `model-drift-detection`, `model-baseline-commit`, `evidently-drift`. `evidence-summary`
  should pass; `drift-gate` passes on the drift skip.
- **`semgrep-sast` is the likely failure** — the prior run had 5 findings (3 ERROR) and
  this session did NOT triage them. If it goes red, that's the carried-over open item, not
  the split. Pull `semgrep.json` from the run and triage the 3 ERRORs.

## Open / deferred
- **Re-seed drift from the live-scan pipeline** (see ⚠️ section above) — the real lever now.
- **Triage `semgrep-sast`** 3 ERRORs (carried over from prior session).
- **Wire the separate live-scan project:** stand up a project with `MODEL_ENDPOINT`, use
  `live-scans.gitlab-ci.yml` as its root config, copy the live-eval scripts/`evals/`.
- **Roll the model** by editing `evals/model-baseline.json` (the manifest is the lever).
- **Phase-2 cleanup (optional):** strip duplicated inline `MODEL_FIXTURE_*/MARKLLM_*`
  defaults once a green run proves the `model-manifest` dotenv path.
- **Wire creds:** `DT_API_URL`/`DT_API_KEY`, `GITLAB_PUSH_TOKEN`, optionally `VAULT_ADDR`.
- Harmless `.git/gc.log` "too many unreachable loose objects" warning on commits;
  `git prune`/`gc` clears it (user has steered away from cleanup).

## Conventions / preferences
- **Git commits: OMIT the `Co-Authored-By` trailer** (user override; in memory).
- **Commit/push only when asked.** Pushes trigger billable GitLab runs; credits are
  limited — batch into one green run.
- Verify library facts against real sources (PyPI/Snyk/`--help`/wheel), not memory —
  history of fabricated package/import names here.

## Verify current state
```
cd "/Users/nate/Documents/Counter-Spy Claude.ai"
git log --oneline -6          # 6a48e52 == gitlab/main (pushed)
git status -sb                # clean; untracked = services/, packages/ (the separate app)
python3 - <<'PY'              # both pipelines parse
import yaml; yaml.SafeLoader.add_constructor('!reference', lambda l,n: l.construct_sequence(n))
for f in ['.gitlab-ci.yml','docs/gaips-materials/ci/live-scans.gitlab-ci.yml']:
    yaml.safe_load(open(f)); print("OK", f)
PY
```
Watch the run at the project's CI/CD → Pipelines for `6a48e52`.
