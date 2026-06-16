# Session Handoff — GAIPS Model Pipeline (2026-06-16)

## TL;DR
This session reviewed the previous pipeline run's `operational-metrics.json`, fixed a
false-green (empty SBOM) and a false-red (tamper metric), corrected the model-digest
SHA-coverage metric, and added an **importable model-baseline manifest** as the approved
model source of truth. **Five commits are staged LOCALLY and NOT pushed** — `main` is
ahead of `gitlab/main` (`05dab5b`). One push = one billable pipeline run, and credits are
scarce, so **fix the remaining semgrep failure (below) before pushing** to land a single
green run.

## Commit stack (local, unpushed — newest first)
```
72ae993  docs: README reflects the model-baseline manifest and pinned-SBOM changes
9a0ff3c  Add importable model-baseline manifest as the approved model source of truth
68185f2  Fix operational-metrics parsers: tamper gate and model-digest SHA coverage
4effe57  Pin requirements.txt to exact, advisory-clean versions so the SBOM is non-empty
05dab5b  (gitlab/main) ci: activate drift baseline + bundle seed into evidence
```
(+ the commit that adds this handoff.) Nothing has triggered a pipeline yet.

## Repo / layout facts (unchanged — keep in mind)
- Working dir & git repo root: `/Users/nate/Documents/Counter-Spy Claude.ai/`
- **Authoritative CI config is repo-root `.gitlab-ci.yml`**. GAIPS scripts/docs live under `docs/gaips-materials/` (scripts in `docs/gaips-materials/scripts/`).
- Remotes: `gitlab` = git@gitlab.com:natecarrollfilms/counter-spy.git (the pipeline), `origin` = the GitHub app repo. Branch: `main`.
- **The app and the pipeline are SEPARATE.** The untracked `services/`, `src/`, `packages/`, `ctf-frontend/`, `dist/`, `node_modules/`, `graphify-out/`, `.env.*.local`, `.DS_Store` at the repo root are the separate app — **do NOT delete or commit them** (user is explicit and nervous about deletion). Always `git add` explicit paths, never `-A`/`.`.

## What was done this session (all LOCAL commits)
1. **Reviewed `operational-metrics.json`** (from the prior run at `52636f38`). Findings, grounded in the scripts:
   - **#1 (false-green):** CycloneDX SBOM had **0 components** → Grype/Trivy scanned an empty SBOM (vacuous "0 vulns"). Root cause: `syft dir:.` skips unpinned (`>=`) requirements, and nothing is installed in the checked-out tree. `pip-audit` (installed set) was the only real dep-vuln gate.
   - **#2 (false-red):** `tamper-verification` reported FAILED while the real gate was green. `write_operational_metrics.py` scanned joined `integrity.env` values for `PASS`/`FAIL`, which never matched the literal `tamper_check_passed=true`.
   - **#4 (false zero):** `model.digests.sha_coverage = 0` though SHA-256 is used. The parser read `split()[0]` (the filepath) and never stripped the `sha256:` prefix. The model **is** present and hashed (Qwen2.5-1.5B GGUF, `sha256:5ede348e…865b3a`).
2. **Fixed #1** (`4effe57`): pinned `requirements.txt` to exact versions verified clean on PyPI + Snyk — `pandas==2.3.3` (held on 2.x; 3.0 is a breaking major), `requests==2.34.2`, `jinja2==3.1.6`. Syft now catalogs the direct deps so the SBOM is non-empty and Grype scans real components. Transitive coverage still comes from `pip-audit`.
3. **Fixed #2 + #4** (`68185f2`, `write_operational_metrics.py`): tamper gate now reads the `tamper_check_passed` key directly; model digests counted with the canonical `DIGEST_RE` mirrored from `build_ai_bom.py` (so the "no models" warning line is no longer miscounted and `sha_coverage` is correct). Verified against the real artifacts: `count=1, sha_coverage=1`.
4. **Added the model-baseline manifest** (`9a0ff3c`):
   - `docs/gaips-materials/evals/model-baseline.json` — the **single reviewed source** for the approved model identity (path + sha256) and the CI variables it implies (`MODEL_FIXTURE_URL/PATH/SHA256`, `MARKLLM_MODEL_ID`, MarkLLM/torch/transformers pins).
   - `docs/gaips-materials/scripts/build_model_baseline.py` — stdlib-only; validates the baseline (asserts `model.sha256` == `MODEL_FIXTURE_SHA256`, etc.) and `--emit-dotenv`.
   - New **`model-manifest`** job (setup stage) emits the variables as a GitLab **dotenv report**. Threaded into `needs:` of the three consumers: `model-fixture-download`, `markllm-deps-audit`, `markllm-watermark-eval`. `giskard-scan`/`pyrit-scan` left untouched (they share the `needs` anchor but don't use these vars).
   - GitLab precedence (verified): dotenv (#7) **overrides** the inline `variables:` defaults (#9) but is itself overridable by Project/manual CI vars (#3–6). Inline defaults kept as a **fallback**; `model-manifest` is **not** `allow_failure` so a bad baseline fails fast at the cheap setup stage. `MARKLLM_MODEL_ID` is now set explicitly (was sed-derived; same value).
   - `evidence-summary` now bundles `model-baseline.json` into the 90-day final-report artifacts.
5. **README** (`72ae993`, `docs/gaips-materials/README.md`): documented the `model-manifest` job, the pinned-SBOM rationale, `model-baseline.json` as canonical, the explicit `MARKLLM_MODEL_ID`, and the evidence bundling.

Local validation done: scripts `py_compile` clean; `build_model_baseline.py` tested (happy path + consistency guard); `.gitlab-ci.yml` parses (custom `!reference` loader) and the three `needs:` are wired correctly.

## OPEN — do this before pushing
- **#3 `semgrep-sast`: 5 findings (3 ERROR) — the one GENUINE gate failure** on the prior run (the other "failure", tamper, was the metrics bug now fixed). If pushed as-is, the run goes red on semgrep. **Triage the 3 ERRORs first** so the single push lands fully green. Ask the user for `semgrep.json` from the last run, or re-run semgrep locally against the tracked scripts. (User offered last-run artifacts on request.)

## Known honest gaps (documented in README, still open in code)
- Entire AI-eval stage advisory (`allow_failure: true`): garak, giskard, inspect-ai, promptfoo, pyrit.
- garak / inspect-ai / promptfoo skip when `MODEL_ENDPOINT` unset; giskard scans a local stub; pyrit doesn't run PyRIT by default.
- `secret-detection` trips only on Critical; `model-sign` signs only immediate subdirs of `models/`; `conda-pkg-verify` non-gating; `dataset-redact` PII degrades open on Presidio import failure; `evidently-drift` seeds (no committed reference); DT upload inert without `DT_*`.
- Genuinely-blocking gates: `clamav-scan`, `artifact-signing-gate`, `dataset-scan`, `dataset-redact`, `eval-dataset-validate`, `ai-bom-validate`, `drift-gate`.

## Planned / deferred (user decisions)
- **Split live/endpoint-dependent scans** into a separate inference-having pipeline (garak/inspect-ai/promptfoo/pyrit). This pipeline has no inference; `models/` is dormant bytes (present + hashed, never served). Keep `markllm-watermark-eval` (in-process). Reconsider `giskard-scan` (stub).
- **Re-seed the drift baseline** (`evals/eval-baseline.json`) once live evals are wired (currently thin: 2 metrics).
- **Roll the model** by editing `evals/model-baseline.json` (the manifest is now the lever).
- **Phase-2 cleanup (optional):** strip the now-duplicated inline `MODEL_FIXTURE_*/MARKLLM_*` defaults once a green run proves the dotenv path (kept as fallback for now, deliberately).
- **Wire creds:** `MODEL_ENDPOINT`, `DT_API_URL`/`DT_API_KEY`, `GITLAB_PUSH_TOKEN` (PAT, `write_repository`, for auto baseline-commit), optionally `VAULT_ADDR`.
- Consider updating `ci/CI-VARIABLES.md` to note `model-baseline.json` is the canonical source for the model/MarkLLM vars.

## Conventions / preferences
- **Git commits: OMIT the `Co-Authored-By` trailer** (user override; in memory).
- **Commit/push only when asked.** Pushes trigger billable GitLab pipelines; credits are limited — batch into one green run.
- Verify library facts against real sources (PyPI/Snyk/`--help`/wheel), not memory — history of fabricated package/import names here.
- Harmless `.git/gc.log` "too many unreachable loose objects" warning on commits; `git prune`/`gc` would clear it (user steered away from cleanup).

## Verify current state
```
cd "/Users/nate/Documents/Counter-Spy Claude.ai"
git log --oneline -6          # 5 local commits on top of 05dab5b (gitlab/main)
git status -sb                # ahead of gitlab/main; untracked = the separate app (leave alone)
python3 docs/gaips-materials/scripts/build_model_baseline.py \
  --baseline docs/gaips-materials/evals/model-baseline.json --emit-dotenv /tmp/m.env && cat /tmp/m.env
```
When the user is ready (and after #3 is fixed): `git push gitlab main` triggers the single run. Watch `model-manifest` (setup), `model-fixture-download` (sha check, now manifest-sourced), `semgrep-sast`, and `evidence-summary` (bundles `model-baseline.json`).
