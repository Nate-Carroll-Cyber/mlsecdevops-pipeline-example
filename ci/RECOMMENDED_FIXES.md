# Pipeline — Recommended Fixes

Per-job recommended fixes from CI validation (verifying each successful job does real,
enforcing work — not exit-0 theater). Annotated per validated job.

**Run under review:** pipeline `2617684429` @ commit `dbc5f19d` (branch `main`).

Severity: 🔴 correctness/enforcement gap · ⚠️ hygiene/explainability · ✅ confirmed good

---

## Implementation status — Fix #0-A env-audit (applied to `.gitlab-ci.yml`, not yet run/committed)

The per-job env-audit (`.audit-env`) was reworked to fix the defects this validation found.
**Gating was intentionally NOT added** (per decision — keep advisory). Changes:

- **Env-correct (correctness).** `.audit-env` now audits the environment the job actually used:
  default jobs re-enter `$VENV_DIR`; jobs with a separate interpreter set `AUDIT_PIP_RUN` to a runner
  prefix. `conda-pkg-verify` sets `AUDIT_PIP_RUN: "conda run -n ci-verify"` so it audits `ci-verify`,
  not the miniconda base (kills the misattributed 24-vuln count).
- **`model-manifest` hardened.** Dropped `before_script: []` so it inherits `.python-secure` (hardened
  `pip.conf` + upgraded build tools in a venv) — it no longer runs on / audits the stock base-image
  `pip`/`setuptools`/`wheel` that produced the 6 spurious vulns.
- **Evidence persisted.** `reports/pip-audit-env-*.json` is now retained: added to `default.artifacts`
  (covers the 5 jobs with no `artifacts:` block) and appended to the `artifacts:paths` of all 38 Python
  jobs that declare their own artifacts (9 non-Python jobs skip the audit, so left alone).
- **NOT done (deferred by decision):** gating. The audit stays in `after_script` (advisory; cannot fail
  the job). Reaching it later requires moving the audit into `script:` — out of scope for now.

Verification pending a run: `conda-pkg-verify` audit should reflect `ci-verify` (clean-ish, not 24);
`model-manifest` should audit clean; `pip-audit-env-*.json` present in each Python job's artifacts.

---

## `setup` (sast stage)

**Purpose:** Establishes the hardened build base and the provenance record downstream jobs trust —
writes a cert-verifying `pip.conf` (PEP 476), upgrades pip/setuptools/wheel, installs
`requirements.txt`, creates `evidence/`/`sbom/`/`reports/`, and writes `evidence/version-info.json`
(git commit/branch/describe/dirty). Provisions `pipeline.env` + `version-info.json`.

**Confirmed good:** image now digest-pinned (`python:3.11-slim@sha256:ae52c5be…`); git installed so
provenance fields are real; per-job env-audit (Fix #0A) present and clean here, covering the full
installed transitive closure; pip cache bloat resolved (2508 files, saved cleanly).

**Recommended fixes:**
- 🔴 **Make `dirty` reflect tracked changes only.** A fresh detached-HEAD checkout reports
  `"dirty": true` while `"describe": "dbc5f19"` (no `-dirty` suffix) says the tracked tree is clean.
  The `dirty` boolean is almost certainly counting untracked build outputs (restored `.pip-cache/`,
  the venv, `evidence/`/`sbom/`/`reports/`, `pipeline.env`) created before `write_version_info` runs,
  so it will read dirty on every run and the provenance flag is noise. Compute it from tracked changes
  (`git diff --quiet HEAD`, or trust `git describe --dirty`), **and/or** write `version-info.json`
  *before* the dirs/cache litter the checkout. *(Inference from log + artifact; confirm against
  `scripts/write_version_info.py` and step order.)*
- ⚠️ **Persist + itemize the env-audit.** The `after_script` audit prints a one-line result but uploads
  no report and lists no packages. Add `reports/pip-audit-env-*.json` to `artifacts:paths` (see global
  fix below).

---

## `model-manifest` (sast stage)

**Purpose:** Runs `build_model_baseline.py` to emit `model-baseline.env` — the single source of truth
for the approved model fixture (URL, path, expected SHA256) and the pinned MarkLLM stack
(markllm 0.1.5 / torch 2.12.0 / transformers 4.57.6). Uploaded as a **dotenv report**, so the 8
variables propagate to downstream jobs (e.g. the SHA `model-fixture-download` gates on). Declares the
baseline; verifies nothing itself.

**Confirmed good:** SHA `5ede348e…865b3a` matches the pin carried through every prior run's
fixture→digest→signed-manifest chain (continuity holds); dotenv propagation is real.

**Recommended fixes:**
- 🔴 **The env-audit found 6 real vulns in 2 packages → job green.** It runs in `after_script`, whose
  exit code GitLab ignores, so it can **never** gate — "drop allow_failure" is a no-op here because
  after_script has no allow_failure. Decide its home: keep advisory in `after_script`, **or** move to
  `script:` to actually gate. (Likely the 2 packages are the stock base-image `pip`/`setuptools`/`wheel`
  this job leaves un-upgraded, whereas `setup` upgrades them and audits clean — confirm via the report.)
- 🔴 **The finding was discarded.** Only `model-baseline.env` is uploaded; `reports/pip-audit-env-model-manifest.json`
  is written but not in `artifacts:`, so the record of which 6 CVEs / 2 packages exists only in the
  ephemeral log. Add `reports/` to this job's `artifacts:paths`.
- ⚠️ **Pin `MARKLLM_MODEL_REVISION`** — it is empty, so `markllm-watermark-eval` pulls
  `Qwen/Qwen2.5-1.5B-Instruct` at whatever HEAD is current. The manifest pins the GGUF by SHA but not
  the transformers-repo revision (the #35 chain-of-custody gap). Pin it to a commit SHA.

---

## `vault-secrets` (sast stage)

**Purpose:** Fetch CI secrets from HashiCorp Vault (KV v2, JWT auth via hvac) and export them as a
dotenv for downstream jobs; fall back to GitLab CI/CD variables when Vault is unavailable.

**This run:** `VAULT_ADDR` unset → Vault fetch skipped → uploads an empty `.vault-env` dotenv. The
entire Vault path (hvac, JWT login, KV v2 read) never runs — inert placeholder, same family as
`dvc-verify`. Honest skip, but zero secret-management signal; pipeline runs on GitLab CI/CD variables
only. Knock-on: `tamper-verification`'s Vault-backed *durable* baseline path is never exercised either.

**Corroborates `model-manifest`:** this job shows the hardened before_script (`pip.conf` + tool
upgrade) and audits clean, like `setup`. `model-manifest` showed neither and found 6 vulns — confirming
`model-manifest` skips the hardened before_script and ships the stock (vulnerable) base-image build tools.

**Recommended fixes:**
- ⚠️ **Activate or stop implying Vault.** Set `VAULT_ADDR` (+ deploy the instance) for any
  secret-management / durable-baseline signal; otherwise document that secrets are GitLab-CI-vars-only
  and Vault is decorative (don't let the BOM/README imply Vault-backed secrets).
- ⚠️ **`before_script: []` + `cache: {}`** — body uses no Python; the cache restore/save + tool upgrade
  (~1 min) is pure overhead.
- 🔴 **(model-manifest) give it the hardened before_script** — it lacks the `pip.conf` SSL enforcement
  and the tool upgrade that `setup`/`vault-secrets` run, which is why it ships vulnerable build tooling
  and audits dirty.

---

## `conda-pkg-verify` (sast stage)

**Purpose:** Build an isolated conda env from conda-forge only (no `defaults`/`anaconda` channels) for
the declared deps (python 3.11, pandas/requests/jinja2), assert channel isolation, and export a
resolved 49-package manifest as reproducible supply-chain provenance.

**Confirmed fixed:** channel isolation now enforces (was "silently failed") — solve is conda-forge-only,
all 49 packages from `conda-forge/{linux-64,noarch}`, and the assertion fires:
*"Channel isolation verified — no package resolved from a defaults/anaconda channel."* (Fix #21 holds.)
Image digest-pinned (`miniconda3:26.3.2@sha256:a297…`); manifest uploaded (`reports/conda/`, 3 files).

**Recommended fixes:**
- 🔴 **Audit the env the job actually builds.** The after_script env-audit found **24 vulns in 8
  packages**, but `setup` (same logical deps) audited clean and `ci-verify` is all fresh 2026
  conda-forge builds — so the audit is almost certainly running against the **miniconda base
  `/opt/conda`**, not the `ci-verify` env. Run it inside the target env (`conda run -n ci-verify
  pip-audit`) or the number is noise about the base image. *(Confirm via the report.)*
- 🔴 **Upload the audit report.** Job uploads only `reports/conda/`; the audit's
  `reports/pip-audit-env-conda-pkg-verify.json` is in `reports/` and not in `artifacts:` — the 24-vuln
  finding is discarded. (Global fix.)
- ⚠️ **Drop `defaults` from the condarc.** The written config still lists `defaults` as a channel; the
  per-package assertion catches leakage, but any conda call without `--override-channels` could pull it.
- 🛠️ **Migrate off the deprecated base image** — `continuumio/miniconda3` is discontinued after
  `26.7.x`; move to `anaconda/miniconda`.

---

## `gitleaks-scan` (sast stage)

**Purpose:** Scan the repo's git history for committed secrets and block the pipeline if any are found.

**Confirmed fixed (theater resolved):** `.gitleaks.toml` now has `[extend] useDefault = true`, so the full
default ruleset loads (previously: allowlist-only, zero rules → always passed). Allowlist is narrowly
scoped (`condition = AND`: path + fake-secret regex). Hard gate (`--exit-code=1` + `allow_failure: false`),
digest-pinned image (`v8.30.1@sha256:…`), scans git history. "no leaks found" is now a real result.

**Recommended fixes:**
- ⚠️ **Make the gate independent of `pipefail`.** `gitleaks … | tee` makes the pipeline exit status
  `tee`'s (0); the gate only captures gitleaks' real exit via `|| GITLEAKS_EXIT=${PIPESTATUS[0]}`, which
  needs `pipefail`. GitLab's bash sets it by default so it works today, but the computed `LEAKS` count is
  printed and never used to gate. Add `[ "${LEAKS}" -gt 0 ] && exit 1` (or set `-o pipefail` explicitly).
- ⚠️ **Scan full history.** GitLab fetched `git depth 20`, so secrets deeper in history aren't seen. Use
  `GIT_DEPTH: 0` for a complete secret-history audit.

---

## `image-provenance-verify` (sast stage)

**Purpose:** Verify the provenance of the container images the pipeline uses — confirm a genuine
upstream signature where one exists (cosign keyless, identity-pinned), else record the image as
digest-pinned-only. Artifact: `{"signed_checked":1,"verify_failures":0,"digest_pinned_only":10}`.

**Confirmed good:** real verification — Trivy's image was cosign-verified against a pinned identity
(`…aquasecurity/trivy/.github/workflows/…`), claims + transparency-log + cert all checked. cosign v3.1.1
pinned + checksum-verified. All 11 images are digest-pinned.

**Recommended fixes:**
- 🔴 **Report-only — it can't block a bad image.** Log: *"report-only (set IMAGE_VERIFY_REQUIRE=true to
  gate)."* A signed image that FAILED verification would still pass green. Set `IMAGE_VERIFY_REQUIRE=true`
  to make a verify failure actually fail the job. (Policy choice; gating decision is the user's.)
- ⚠️ **Thin verification coverage: 1 of 11.** Only Trivy has a verification identity configured; the other
  10 are trusted on the committed digest alone (TOFU — nothing authenticates that the pinned digest is the
  right one). Add verification identities for any other images whose vendors publish keyless signatures;
  for those that don't, digest-pin is the realistic ceiling — state that explicitly.

---

## `lockfile-audit` (#0-B, sast stage)

**Purpose:** The deep dependency audit — compiles each `requirements-ci*.in` group into a fully
hash-pinned lockfile and audits it (297 packages here), vs. the shallow 3-package scans elsewhere.

**Confirmed good:** real depth, and the **CORE security toolchain group is clean** — model-signing,
sigstore, modelscan, presidio, cyclonedx, hvac, etc. all show zero known vulns at pinned versions.

**Findings (verified against `lockfile-audit.json`):** 8 vulns / 3 packages, **all in the DATAQUALITY
group** (dvc/evidently/ydata + cloud-SDK deps) — NOT the core security tools. (Correction: an earlier
read mis-attributed these to the core group; the merged artifact shows the vulnerable versions are the
dataquality copies. The `requirements-ci*.txt` glob sorts `-dataquality` before `.txt`, so the log's
first "Found 8" block is the dataquality lock, not core.)
- `diskcache 5.6.3` — CVE-2025-69872 pickle RCE (needs write access to cache dir). **No fix available.**
- `cryptography 43.0.3` — 4 issues (CVE-2024-12797, CVE-2026-26007, CVE-2026-34073/PYSEC-2026-35×2,
  GHSA-537c-gmf6-5ccf). All fixed by ≥48.0.1 — which the core group already uses.
- `pyopenssl 24.2.1` — CVE-2026-27448, CVE-2026-27459. Both fixed in 26.0.0; core already uses 26.2.0.

**Recommended fixes:**
- 🔴 **Advisory — found 8 (incl. an unfixable RCE) and passed green.** `allow_failure: true`. This is the
  intended "teeth" of the #0 dependency-audit design but it cannot fail. Blast radius is the
  data-observability side tools (themselves non-gating), so proportionate — but the enforcement gap stands.
- ✅ **APPLIED — slimmed `dvc[all]` → `dvc`** in `requirements-ci-dataquality.in`. Metadata-verified:
  `pydrive2` (gdrive extra) hard-caps `pyOpenSSL<=24.2.1`, which in turn caps `cryptography<44` — so a
  force-upgrade was impossible; removing the `[all]` extras drops `pydrive2`/`oss2` → drops pyOpenSSL →
  lifts the cryptography cap. Clears the 6 cryptography+pyopenssl CVEs at the source, no upgrade risk.
  PENDING: faithful recompile + re-audit on linux/py3.11 (CI `lockfile-audit` recompiles from the `.in`);
  the committed `requirements-ci-dataquality.txt` is now stale and should be regenerated in that env
  (NOT hand-edited on py3.9/macOS). Add `dvc[s3]` etc. only if a remote is actually used.
- ✅ **`diskcache` has no fix** (PyPI latest = 5.6.3) — core via `dvc-data`. **ACCEPTED RISK**,
  annotated in the AI BOM itself: `build_ai_bom.py` emits a CycloneDX VEX `analysis`
  (`state: not_affected`, `justification: requires_environment`) on CVE-2025-69872 (local-pickle,
  CI-only; revoke if a fix ships or DVC gets a real/shared writable remote).

---

## `markllm-deps-audit` (sast stage)

**Purpose:** Audit the heavy AI stack (torch/transformers/pillow + CUDA tree) that `lockfile-audit`
skips, by auditing the declared pins without installing the multi-GB closure.

**Finding:** 11 vulns / 3 packages — torch (CVE-2025-3000, no fix), transformers (X-CLIP RCE no fix +
Trainer RCE fixed only in 5.0.0rc3), Pillow 9.4.0 (6–7 CVEs). All welded to `markllm==0.1.5` (latest &
last release; hard-pins `Pillow==9.4.0`; predates transformers 5.x). No safe upgrade exists.

**Resolution:** ✅ **ACCEPTED RISK — leave in place** (per owner decision). No dependency change.
Annotated in the AI BOM itself: `build_ai_bom.py` attaches a CycloneDX VEX `analysis`
(`state: not_affected`, `justification: code_not_reachable`, `response: can_not_fix`/`will_not_fix`)
to each CVE — torch CVE-2025-3000, transformers PYSEC-2025-217 / CVE-2026-1839, the Pillow CVEs — with
the exposure rationale in `analysis.detail`. The audit report is retained, so the exposure is recorded
as machine-readable VEX in the signed BOM, not hidden on green.
- ⚠️ **Coverage excludes the markllm (torch/transformers) group** — deliberately delegated to
  `markllm-deps-audit`; so this "clean-ish" picture omits the AI libs that historically carried RCE-class
  vulns. Make sure that delegation is actually auditing + (eventually) gating them.

---

## Global fixes (span multiple jobs)

- 🔴 **Per-job env-audit (Fix #0A) is non-uniform, mis-targeted, and not persisted.** Across four jobs
  it already behaves inconsistently: `setup`/`vault-secrets` audit clean (they run the hardened
  before_script + tool upgrade), `model-manifest` finds 6 vulns (skips that before_script → stock
  build tools), `conda-pkg-verify` finds 24 (audits the miniconda **base** env, not the `ci-verify`
  env it built). Fixes:
  - (a) **Persist:** add `reports/pip-audit-env-*.json` to *every* job's `artifacts:paths` — currently
    most jobs don't upload it, so findings exist only in the ephemeral log.
  - (b) **Target the right env:** the anchor assumes `pip` resolves to the job's deliverable env. On
    jobs that build/activate a separate env (conda, venvs), audit *that* env explicitly (e.g.
    `conda run -n <env> pip-audit`), not whatever is active in after_script.
  - (c) **Uniform baseline:** standardize the hardened before_script (cert-enforcing `pip.conf` + tool
    upgrade) across jobs so the audit isn't flagging un-upgraded base tooling.
  - (d) **Gating policy:** it runs in `after_script`, whose exit code GitLab ignores → it can *never*
    gate, and "drop allow_failure" is a no-op. Coverage-only is fine now, but migrate to `script:`
    when ready to enforce.
