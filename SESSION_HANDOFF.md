# Session Handoff — GAIPS Model Pipeline (updated 2026-06-19, session 5)

> **NAMING:** This is the **GAIPS model pipeline**. The repo/dir is named `counter-spy` and
> holds untracked, unrelated project dirs (`services/`, `packages/`, `src/`, `ctf-frontend/`)
> — those are a SEPARATE project, not part of this pipeline. Do not call this "Counter-Spy".

> **PATHS (absolute).** Repo root: `/Users/nate/Documents/Counter-Spy Claude.ai/`. This handoff:
> `/Users/nate/Documents/Counter-Spy Claude.ai/SESSION_HANDOFF.md`. Pipeline def:
> `/Users/nate/Documents/Counter-Spy Claude.ai/.gitlab-ci.yml`. GAIPS materials (scripts/docs/deployment):
> `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/`. All repo-relative paths below are under the repo root.

---

# ▶️ STATUS (2026-06-19, session 5): 🟢 **PIPELINE GREEN on `56beedc`.** Reviewed `e0311ab` (6 findings → `d7585b7`), then fixed 3 run failures across two pushes (`bd26e57` gitleaks+tamper, `56beedc` lockfile-audit) + added a per-job README reference. The feature-branch pipeline now passes end-to-end. RESUME AT: the protected/default-branch validation run for the signing/identity legs (the only substantive open item).

> **What this session did.** A review of `e0311ab` (the #29–#34 implementation commit) found **6 findings where
> behavior didn't match the docs/commit claims**. All fixed in one commit (`d7585b7`), then the branch was
> **pushed to `gitlab`** — which **triggered a pipeline run** on `gaips-pipeline-required-fixes`.
>
> **P1 (functional gaps):**
> - **P1-1 DT child not gated** — `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/scripts/dependency_track_upload.py`
>   uploaded the AI-BOM as a nested child but only evaluated the PARENT project; an unresolved parent also wrote a
>   success report (silent pass). **Fix:** new `evaluate_project()` run for **both** parent and AI-BOM child; gate
>   fails if EITHER has a blocking violation OR, post-upload, can't be resolved; report now carries both project
>   UUIDs + dashboard URLs as proof of evaluation.
> - **P1-2 hollow modelCard for the default model** — in
>   `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/scripts/build_ai_bom.py` the MarkLLM/HF fold
>   matched mixed-case HF id (`Qwen/...`) against the lowercase GGUF path **case-sensitively** (never matched), and
>   the `name in res["prompts"]` fallback was dead (prompts is a list of dicts). **Fix:** case-insensitive match on
>   path/name; dropped the dead fallback. The default Qwen model now folds its watermark metrics into `modelCard`
>   (closes the overstated #30b claim).
> - **P1-3 scanners still on `:latest`** — in `/Users/nate/Documents/Counter-Spy Claude.ai/.gitlab-ci.yml`,
>   `IMAGE_SEMGREP`/`IMAGE_GITLEAKS` were `:latest`, and `semgrep-sast` ran an UNPINNED `pip install semgrep` (never
>   used `IMAGE_SEMGREP`). **Fix:** pinned both vars (`semgrep/semgrep:1.165.0`, `gitleaks/gitleaks:v8.30.1`);
>   `semgrep-sast` now runs **in** the pinned image (`before_script:[]`, no pip install).
>
> **P2:**
> - **P2-1 AI-BOM vuln surface incomplete (#29)** — `build_ai_bom.py` never parsed `lockfile-audit.json` (doesn't
>   match the `pip-audit*` glob), and `ai-bom-assemble` didn't even `need:` lockfile/grype/trivy (so that parsing
>   was dead). **Fix:** parse `lockfile-audit.json`; add `lockfile-audit`/`grype-scan`/`trivy-scan` to
>   `ai-bom-assemble` needs and `pip-audit`/`lockfile-audit` to `ai-bom-content-gate` needs so BOTH jobs read the
>   IDENTICAL audit surface (the gate calls the same `build_ai_bom._vulnerabilities()`). Per-job `pip-audit-env-*`
>   left OUT of scope on purpose (would require lockstep `needs` on both jobs to avoid undercount).
> - **P2-2 DT compose not turnkey** —
>   `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/deployment/dependency-track/docker-compose.yml`
>   had `ALPINE_DATABASE_MODE: external` with no DB service → `docker compose up -d` fails. **Fix:** switched to
>   **embedded H2** (all-in-one demo), with a comment on the external-DB production path.
> - **P2-3 stale README publish/verify wording** —
>   `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/README.md` said the AI-BOM is published "+ its
>   public key" and verified via `cyclonedx verify`. **Fix:** corrected to the `.xml`/`.sig`/`.pem` trio + `cosign verify-blob`.
>
> **Follow-up doc/comment drift (same commit):** dropped the literal `:latest` from descriptive comments + fixed the
> stale "AI-BOM public key" comment (`.gitlab-ci.yml:123`); reconciled Syft/Grype/Trivy rows in
> `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/ci/SBOM.md` +
> `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/ci/CI-VARIABLES.md` to the ACTUAL CI values
> (`anchore/syft:v1.45.1-debug`, `anchore/grype:v0.114.0-debug`, `aquasec/trivy:0.71.1`); added an authoritative
> **"Evidence & Report Artifacts (per stage / job)"** section to the README documenting every job's artifact
> filenames/filetypes + retention (extracted from the `artifacts:` blocks).
>
> **Validated offline before push:** both changed Python scripts compile; mocked tests confirm the DT dual-project
> gate (child FAIL → exit 1; unresolved → None→fail) and the case-insensitive modelCard match; a fixture confirms
> `lockfile-audit.json` is now ingested; `.gitlab-ci.yml` parses (`!reference` tag) with the new `needs` edges; the
> compose parses in embedded mode. **No new tests run on CI yet** — that's the pipeline now running.
>
> **Git state — branch is now FULLY PUSHED (this supersedes session 4's "nothing pushed / ahead by 4").**
> `gitlab/gaips-pipeline-required-fixes` == `HEAD` == `d7585b7` (0 ahead / 0 behind). The push moved the remote
> `8061900..d7585b7`, so session-4's local-only commits (`459a562`, `7cbcd01`, `a113877`, `ff9bd7e`) **plus** the
> newer `e0311ab` (#29–#34 impl) and `7daca48` (session-4 handoff) are all on the remote now.
> ```
> d7585b7  Fix review findings on e0311ab before test push          ← THIS session (pushed; CI running)
> e0311ab  feat(gaips): implement + document required-fixes #29–#34  ← what this session reviewed
> 7daca48  docs(gaips): session-4 handoff — fixes applied; resume = re-run
> 459a562  ci(gaips): apply open required-fixes #0,#23,#24a/b,#25,#26,#27,#28
> 8061900  ci: dataset-redact — install click for the spaCy CLI      ← former remote tip
> ```
>
> **➡️ NEXT SESSION:**
> 1. **Watch the pipeline** triggered by `d7585b7` (MR-create link:
>    `https://gitlab.com/natecarrollfilms/counter-spy/-/merge_requests/new?merge_request%5Bsource_branch%5D=gaips-pipeline-required-fixes`).
>    Verify the jobs touched this session: `semgrep-sast` (now runs in `semgrep/semgrep:1.165.0`), `ai-bom-assemble`
>    + `ai-bom-content-gate` (new `needs:` → grype/trivy/lockfile artifacts actually present; `vulnerabilities[]`
>    should now include lockfile-audit findings), and `dependency-track-upload` (inert unless `DT_API_URL`/`DT_API_KEY`
>    set — the child-gate code can't run until DT is wired).
> 2. **⚠️ This is still an UNPROTECTED feature branch**, so the protected-var signing/identity legs (`signature-verification`
>    #19 and anything reading `MODEL_SIGNING_IDENTITY`/`MODEL_ENDPOINT`/etc.) **defer** here — see POST-PUSH FIX LOG #2.
>    Session 4's deeper open action — **one validation run on the DEFAULT/protected branch** (for keyless `ai-bom-sign`,
>    `data-drift-baseline-commit`, real signature verification) — is **still open**; this feature-branch run does not
>    cover it.
> 3. **Non-blocking follow-ups unchanged from session 4:** commit the `lockfile-audit` artifact as
>    `/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/ci/requirements-ci.txt` for `--require-hashes`
>    (#0 teeth), then drop `allow_failure` on the per-env/lockfile audits + `markllm-deps-audit` (#23) once green.
>    **Do NOT touch the separate app dirs** (`packages/`, `services/`) — excluded via `.git/info/exclude`.

> **POST-PUSH FIX LOG (session 5 cont., `d7585b7` pipeline run) — 2 job failures, both self-inflicted by `d7585b7`'s own
> fixes, both fixed in the working tree (committed this turn):**
> - **`gitleaks-scan` — `pull access denied for gitleaks/gitleaks`.** P1-3 pinned `IMAGE_GITLEAKS: gitleaks/gitleaks:v8.30.1`,
>   but gitleaks has **no Docker Hub repo** — the official image is on **GHCR**. Fix: `ghcr.io/gitleaks/gitleaks:v8.30.1`
>   (`.gitlab-ci.yml:65`). Version `8.30.1` was correct (the `dataset-redact` GitHub-release curl already uses it). The
>   semgrep pin `semgrep/semgrep:1.165.0` IS a valid Docker Hub repo, so only gitleaks was affected.
> - **`tamper-verification` — false-positive `TAMPER DETECTED`.** #32 changed `model-digest` to emit repo-relative paths
>   (was absolute `/builds/…`); the cached baseline (pre-#32) still held the absolute-path line, and the tamper check
>   compared **whole lines** (`baseline.strip() != current.strip()`) → mismatch despite **identical sha256**. Fix:
>   compare the **set of sha256 digests** (path-insensitive) + migrate the stored baseline (file/Vault) to the new
>   relative form on a content match so it self-heals (`.gitlab-ci.yml` tamper-verification block). Validated offline:
>   YAML parses, embedded Python compiles, unit test confirms path-only change → PASS, real hash change → FAIL.
>   ⚠️ On the re-run the tamper baseline migrates to relative-path format on its first green run. `VAULT_ADDR` still unset
>   (best-effort cache durability, unchanged).
>
> **Those two were committed `bd26e57` + PUSHED (`d7585b7..bd26e57`).** A second pipeline run on `bd26e57` came back
> green except ONE advisory job:
> - **`lockfile-audit` — `pip-compile` ResolutionImpossible.** P2-1 wired this job into the AI-BOM `needs`, so its
>   compile finally runs — and the `ci/requirements-ci.in` set can't co-resolve: **`inspect-evals`** demands
>   `huggingface_hub>=1.2` / `pillow>=11.3` while `transformers==4.57.6` + `markllm==0.1.5` pin `<1.0` / `Pillow==9.4.0`.
>   **Root insight (user catch):** the AI red-team/eval tools (`garak`/`giskard`/`inspect-ai`/`inspect-evals`/`pyrit`)
>   belong to the **live-scans** pipeline, NOT this static one — they were stale in `requirements-ci.in`. **Fix:**
>   (a) dropped them from this pipeline's audit scope (which also removed the conflict source); (b) split the source
>   into independently-resolvable GROUP files — `requirements-ci.in` (core), `requirements-ci-markllm.in`,
>   `requirements-ci-dataquality.in` — and rewrote `lockfile-audit` to **compile+audit EACH group and merge** into one
>   `lockfile-audit.json` (pip-audit-native shape `build_ai_bom.py` reads); a group that still can't resolve is a loud
>   **WARNING, not a failure** (covered by the per-job `.audit-env`). Validated offline: YAML parses, embedded merge
>   Python compiles, merge/dedup + unresolved-NOTE unit-tested, POSIX-clean shell loop. (Two stray group files I first
>   created — `requirements-ci-redteam.in`, `requirements-ci-inspect-evals.in` — were removed; those tools aren't here.)
>
> **Also this turn — README per-job reference.** Added a **"Per-Job Reference — Purpose & Step-by-Step"** section to
> `docs/gaips-materials/README.md` documenting **all 50 jobs across 11 stages** (purpose + plain-English steps + output
> file + gate posture), in the user's requested format. Authored via 6 parallel sub-agents (one per stage group) that
> read each job block + backing script; assembled and verified (50 `####` blocks, 11 `### Stage` headers).
>
> **✅ RESULT — 3rd run on `56beedc` PASSED (full pipeline GREEN).** All three run failures are resolved and
> confirmed on CI: `gitleaks-scan` pulls from GHCR, `tamper-verification` passes (content-based compare; baseline
> migrated to relative-path form on first green run), and `lockfile-audit` is green (per-group compile/audit/merge).
> The whole feature-branch pipeline now passes end-to-end.
>
> **➡️ NEXT (only substantive open item):** the **protected/default-branch validation run** for the legs that can't
> execute on this unprotected feature branch — `signature-verification` #19 (real verify vs DEFER), keyless
> `ai-bom-sign` / `model-sign` identity binding, and `data-drift-baseline-commit` (needs default branch +
> `GITLAB_PUSH_TOKEN`). Non-blocking follow-ups still parked: commit the `lockfile-audit` core lock as
> `ci/requirements-ci.txt` for `--require-hashes` (#0 teeth), then drop `allow_failure` on the audits + `markllm-deps-audit`
> (#23) once green there. Housekeeping: stale `.git/gc.log` (auto-gc paused) — clear with `git gc` when convenient.

---

# ▶️ STATUS (2026-06-18, session 4): #0–#28 APPLIED; #29–#34 PROMOTED then APPLIED (code) + fixture-validated, except #34 (infra-ready, not wired). RESUME AT: one billable re-run to validate all of it + the deferred legs.

> **Registry now = 35 items (#0–#34): 34 code-applied, 1 infra-ready (#34).** #0–#28 applied earlier this
> session; **#29–#34** were promoted from per-job blocks and then implemented this turn:
> - **#29** ✅ CycloneDX `vulnerabilities[]` from pip-audit/grype/trivy with `affects` → component bom-refs.
> - **#30a** ✅ software count split (pipeline vs markllm) + source labels; **#30b** ✅ markllm eval folded into modelCard.
> - **#31** ✅ new advisory `ai-bom-content-gate` (substance assertions); **#33** ✅ evidence-summary reads verdicts (WARN-first).
> - **#32** ✅ abs-path root fixed at `model-digest` L972 (clears #40-F4 + #41-F5); `model.verified`/`verified_reason`
>   recorded in `build_ai_bom` + `sign-evidence` (honest `false`/deferred until #19 on a protected ref).
> - **#34** 🟡 client was already complete; added compose + runbook. Needs a DT instance + CI vars + re-run.
>
> **Validated offline:** all 3 changed/new Python scripts compile; `.gitlab-ci.yml` parses (`!reference` tag);
> end-to-end fixture run asserts #29 vulns + affects, #30a/b counts + modelCard, #32 relative paths + verified
> state, #31 advisory-pass-with-warnings (+ `--enforce` fails on empty vulns[]), #33 WARN-vs-`--enforce` gating.
> **Teeth deferred** on #31/#33 (advisory until the pipeline is green, per Fix #0/#23). Plan +
> per-fix detail: [`docs/gaips-materials/PIPELINE_FIX_PLAN_29-34.md`](docs/gaips-materials/PIPELINE_FIX_PLAN_29-34.md).
>
> **Session 4 = the fix-application session (#0–#28).** The walkthrough was complete; this session **applied every
> then-open fix** in one sweep and committed it. **Nothing is pushed** (cost deferred per user).
>
> **Git state (newest first, all UNPUSHED — branch `gaips-pipeline-required-fixes`, ahead of remote by 4):**
> ```
> 459a562  ci(gaips): apply open required-fixes #0,#23,#24a/b,#25,#26,#27,#28   ← THIS session's fix sweep
> 7cbcd01  ci(gaips): checkpoint session pipeline edits before fix sweep        ← backup/restore point
> a113877  docs: update handoff — fixes done, resume documenting #29–#49
> ff9bd7e  ci: fix dataset-sign needs, ydata pkg_resources, GX category set
> 8061900  ci: dataset-redact — install click for the spaCy CLI                 ← last PUSHED tip
> ```
>
> **What was applied (all in `459a562`; checkboxes flipped in the REQUIRED FIXES list below):**
> - **#0 audit coverage (the big one).** (A) `default: after_script` + `.audit-env` anchor → **every job
>   pip-audits its OWN installed environment** (model-signing/sigstore/presidio/evidently/modelaudit/…),
>   advisory, no-ops on non-Python images. (B) new **`lockfile-audit`** job compiles `ci/requirements-ci.in`
>   with `--generate-hashes` and audits the full stack the 3-pkg root `requirements.txt` shadowed.
> - **#24b** — `model-baseline-commit` **repurposed → `data-drift-baseline-commit`**: **sanitizes** the
>   evidently seed (drops null/non-finite, never a raw `cp`) and commits `evals/dataset-reference.jsonl`;
>   seed source (`run_evidently_report.py`) fixed too. Unsticks `evidently-drift` from seed-mode.
> - **#24a** — `model-drift-detection` **relocated into `ci/live-scans.gitlab-ci.yml`** (wired to its six
>   eval inputs) and **deleted from the static pipeline**; dropped the now-dead `needs` edges in
>   `evidence-summary` / `sign-evidence` / `ai-bom-assemble` (these caught a would-be pipeline-lint break).
> - **#25** — `ai-bom-sign` → **cosign keyless** (Fulcio + Rekor), **hardened to a gate** (`allow_failure:false`);
>   PreSync hook now `cosign verify-blob`s the BOM; dead cyclonedx-cli install + public-key Secret removed.
> - **#23** — `markllm-deps-audit` → `stage: sast`, `needs: ["setup"]` (gating still deferred).
> - **#26** — stale model-bundle comment rewritten (26a); per-file upload tracking + `publish-result.json`
>   signal, non-green on partial upload (26b); branch-scoped `ARTIFACT_BASE_URL` guidance (26c);
>   publishes `.sig`/`.pem` not `.pub`.
> - **#27** — real markllm schema + `present-but-unparsed` state (27a); enforcing-vs-advisory gate flag from
>   the job API (27b); `generated_at` → `pipeline_created_at`, schema `1.1` (27c).
> - **#28** — polarity-aware boolean coloring (`drift_detected:false` is green, not red) (28a); `null` → `n/a`
>   (28b); gate ledger shows enforcing/advisory.
>
> **Validated:** YAML parses (both pipelines + PreSync hook); **needs-graph integrity verified** on both;
> all three edited Python scripts compile; **metrics/dashboard scripts smoke-tested** (assertions on every
> #27/#28 behavior). Operator docs synced (README, SETUP, CI-VARIABLES, SBOM, live-scans);
> `PIPELINE_JOB_VALIDATION.md` left as the historical audit record with a resolution banner.
>
> **➡️ NEXT (the only open action):** **one billable re-run on the default branch** validates, in a single shot,
> (a) the deferred legs **#30/#31/#32** (need `ff9bd7e`) AND (b) this session's edits — especially the paths that
> only run live: `data-drift-baseline-commit` + keyless `ai-bom-sign` (both need default-branch + `GITLAB_PUSH_TOKEN`
> / OIDC). **Follow-ups (non-blocking):** commit the `lockfile-audit` artifact as `ci/requirements-ci.txt` to enable
> `--require-hashes` (#0 "teeth"); then drop `allow_failure` on the per-env/lockfile audits + `markllm-deps-audit`
> (#23 gating) once the pipeline is otherwise green. **The separate app dirs (`packages/`, `services/`) are NOT part
> of this pipeline — do not touch or commit them; they're locally excluded via `.git/info/exclude`.**

---

# ▶️ STATUS (2026-06-18, session 3): #46 image-sign documented (⚠️ inert skip, by design — no container image built); RESUME AT #47 publish-signed-artifacts (deploy-prep 1/4 done)

> **#46 `image-sign` — DONE (⚠️ INERT, by design).** `IMAGE_REF` unset → clean skip `exit 0`, green. Signs the deployable
> **container image** (`ghcr.io/…/gaips-rag-app@sha256:…`) — NOT the model (#18) or BOM (#43); verified at deploy by
> **Kyverno** admission. This static pipeline builds no container image, so the skip is architecturally correct (the image
> is a separate app pipeline's output). When active: cosign **keyless** (Fulcio+Rekor) + **post-sign verify** — the GOOD
> pattern, the exemplar for converting #43 (Fix #25). `allow_failure:true` correct (Kyverno is the real gate). needs anchor
> = dependency-track-upload (also inert this run). Clean skip ≠ ✅ (signing path untested here).

> **#45 `dependency-track-upload` — DONE (⚠️ INERT this run).** DT unconfigured (`DT_API_URL`/`DT_API_KEY` unset) →
> clean skip `{skipped:true}` `exit 0`, green. Upload + continuous-analysis + policy gate NEVER ran (untested; vault/dvc
> pattern — clean skip ≠ ✅). **But it's the BEST-BUILT gate of the vuln family:** real `allow_failure:false` hard gate
> with `exit 1`, async polling, AI-BOM nested under app project, VEX-aware — the ONLY vuln/policy control that actually
> blocks (vs grype #13 / trivy #14 non-enforcing); re-derives CVEs itself from purls so #41-F2 (no vulnerabilities[])
> doesn't blind it. **2 caveats when wired:** (F2) gate fires on authored DT POLICIES not raw CVE severity → a DT with
> no policies passes green even with criticals; (F3) CVE matching = SOFTWARE components only (model/data are inventory),
> on the #41 shallow/fused set. Now also `image-sign`'s gate anchor (post-drift-gate-removal) → also inert this run.

> **`drift-gate` REMOVED (2026-06-18, user decision).** Confirmed vacuous theater (#44), so deleted from the static
> pipeline. Edits (YAML validated — parses, no dangling needs, no cycle, no stage-order violations): job block removed;
> `image-sign` `needs:["drift-gate"]`→`["dependency-track-upload"]`; dropped from `sign-evidence` needs (38→37); stale
> comment + README/SBOM mermaids&tables + SETUP + CI-VARIABLES + live-scans docs all updated. **Consequence (supersedes
> #24b re-point):** data drift (`evidently-drift` #38) is now **ungated** in the static pipeline. Eval-metric drift unit
> + a real gate belong in live-scans (Fix #24a). If static-pipeline data-drift enforcement is wanted later, add a small
> gate over #38 — do NOT revive drift-gate over the dead model-drift-detection.

> **#44 `drift-gate` — DONE (🔴 CONFIRMED THEATER).** The WATCH item is confirmed from the run. drift-gate is a HARD gate
> (`allow_failure:false`) but **structurally cannot fail** here: its only input `model-drift-detection` #36 is
> dead-by-construction → emits `{skipped}` every run → gate branch (2) "skipped/seeded → pass". Log: "Drift gate:
> baseline seeded/skipped — pass". The `exit 1` drift path (branch 3) is unreachable. **F2:** fails open TWICE (missing
> report → pass; skipped → pass). **F3:** never reads `evidently-drift.json` (data drift #38, which ran seed-mode) → the
> one drift control that executed is gated by NOTHING; neither drift axis is enforced. **F4:** gate logic is individually
> defensible (first-run seeding + real exit-1 path) — vacuity is a SYSTEM property (producer permanently skipped). Root
> fix = **Fix #24a/#24b** (give it a producer that can emit a verdict — move #36 to live-scans, re-point gate at #38) +
> harden gate to stop failing open. Green "drift gate pass" = nothing checked, NOT drift-free.

> **#43 `ai-bom-sign` — DONE (✅/🔴).** Real native CycloneDX enveloped XML signature (rsa-sha256, c14n, enveloped
> transform, Reference URI="" covers whole BOM) + in-job `verify all` round-trip ("All signatures verified"). Good key
> hygiene (rm private key, publish only pub+signed XML), pinned CLI by digest. **🔴 F1/F2:** `CYCLONEDX_SIGNING_KEY`
> UNSET → signed with an EPHEMERAL keypair minted in-job + published beside the BOM → tamper-evidence only, ZERO
> authenticity/provenance, NO stable signer across runs (deploy-time `cyclonedx verify` can't pin an identity; dormant
> until CYCLONEDX_SIGNING_KEY/_PUB wired — Vault/DVC "present-not-enabled" pattern). The BOM's OWN sig is WEAKER than the
> cosign model sig embedded inside it — fix = wire stable key OR sign BOM with cosign keyless (consistent + Rekor). **F3**
> allow_failure:true → BOM can ship unsigned. F4: signs UTF-8-BOM XML cleanly (closes #42 F3).

> **#42 `ai-bom-validate` — DONE (✅/⚠️).** Real HARD CycloneDX 1.6 schema-conformance gate (`/cyclonedx validate
> --fail-on-errors`, no allow_failure, pinned `cyclonedx-cli:0.32.0` by digest) + lossless JSON→XML render for #43.
> Log: "BOM validated successfully." XML cross-checked: faithful round-trip (same serialNumber, 99 comps, embedded sig).
> **Caveat (F1):** structural-only — validates FORM not SUBSTANCE, so every #41 content gap (fused software=97, no
> vulnerabilities[], signed≠verified, abs path) passes cleanly; green = well-formed, not complete/correct. F2 modelCard
> rendered as empty shell (modelParameters/quantitativeAnalysis empty — a #41 fix). F3 XML has leading UTF-8 BOM marker
> (cosmetic; it's the exact bytes #43 signs).

> **#41 `ai-bom-assemble` — DONE (✅/⚠️).** Real CycloneDX 1.6 AI-BOM, 99 components (models=1/datasets=1/software=97),
> hard job (no allow_failure), embeds the REAL cosign model sig (decoded: Sigstore bundle v0.3 + Fulcio cert — model-sign
> #18 DID sign on the branch via id_tokens) + faithful scan verdicts. **Caveats:** F1 `software=97` FUSES two disjoint dep
> universes — 3 shallow `requirements.txt` pins (syft, #10-blind) + ~94 MarkLLM eval-stack pkgs (markllm-deps-audit, NOT in
> the static runtime) — overstating the real closure; F2 NO CycloneDX `vulnerabilities[]` despite 11 known vulns (2 RCE-class)
> recorded only as `gaips:vulns.count` props; F3 `dataset.signed=false` → confirms dataset-sign #32 didn't run on 8061900
> (fixed only in unpushed ff9bd7e); F4 `signed=true` w/o `verified` (#19 deferred); F5 abs `/builds/…` path in model bom-ref;
> F6 eval section hollow (all 6 behavioural evals absent → live-scan pipeline; markllm NOT folded in). F7 version.dirty=true.

> **#40 `model-signing-evidence` — DONE (✅/⚠️).** Real Sigstore keyless signing executed on the branch run
> `8061900` (pipeline `2609319649`): Fulcio ephemeral cert, SCT verified, **Rekor index 1853780818**, `.sig`+`.pem`
> written. **KEY CORRECTION:** the protected-var caveat does **NOT** apply here — the job signs via GitLab-native
> `id_tokens.SIGSTORE_ID_TOKEN`, NOT the protected `MODEL_SIGNING_IDENTITY`, so it works on any ref (it does not
> defer like #19). **Caveats:** (F1) it NOTARIZES a digest `model-digest` #17 merely *recorded* — with #19 deferred,
> no tamper check binds in; (F2) the signature is **write-only** — no in-pipeline `cosign verify-blob` consumer
> (only `image-sign` line 2768 verifies, and that's the container image); (F3) **dead 37-pkg `model-signing`+`sigstore`
> install** — all signing is cosign (same waste pattern as #15/#17, unaudited per Fix #0); (F4) signed `model_digests`
> string carries the absolute `/builds/…` runner path. ✅ cosign pinned+checksum-verified, pins exact (Fix #11),
> no `allow_failure` (fails closed on its own op).
>
> **🔧 OVERHAULED THIS SESSION (local, NOT pushed — pending next run):** renamed `model-signing-evidence` →
> **`sign-evidence`** and **moved to a new terminal `attest` stage** (last in the pipeline, after deploy-prep) so it
> can hash+sign the WHOLE run incl. the signed AI-BOM (it ran in `evidence` before, missing ai-bom/deploy-prep).
> Bundle is now a `schema_version 2.0` run-evidence manifest: rich pipeline metadata + model identity
> (`approved_sha256` vs `recorded` + `digest_match`) + **sha256 hash-manifest of all reports/sbom/evidence files**
> (`needs:` all 38 producers; model blob NOT pulled). Added **cosign verify-blob self-verify** (closes F2 write-only);
> **dropped the dead model-signing/sigstore install** (closes F3; `before_script:[]`+`cache:{}`). Open: F1 (still signs
> #17's recorded digest — needs #19 to not defer), F4 (abs path in #17's `tee`). Note: the seal is NOT published by
> `publish-signed-artifacts` (runs before attest) — it's a retained audit artifact. Docs updated (README/SBOM mermaid+tables,
> validation-doc UPDATE note). YAML verified: parses, no dangling needs, no cycle, no stage-order violations, python compiles + smoke-tested.

**Where things stand:** the 22-item REQUIRED-FIXES list is fully applied + pushed; the branch run surfaced and
fixed 7 latent defects (POST-PUSH FIX LOG below). This session **continued the per-job walkthrough** against the
branch run `8061900` (the PUSHED tip — does NOT include the local-only `ff9bd7e` fixes). Documented earlier:
**#29 revised 🔴→✅, #33 ✅, #35 ✅**. Documented THIS continuation: **#34 ✅/🔴, #36 🔴, #37 ⛔absent** + added
**Fix #23 and Fix #24 (a/b)**.

> ⚠️ **NOTE for the fresh context window (why we reset): the prior thread kept OVER-COLLAPSING distinct things
> into one** (two `pip-audit` jobs treated as one; the eval-metric drift baseline vs the data-drift baseline;
> "delete the whole drift unit" when half of it must stay). **Discipline going forward: keep distinct jobs /
> baselines / controls SEPARATE; verify each against the YAML before merging them in prose.** Fix #24 in
> particular was wrong twice before landing as a SPLIT (24a move eval-metric unit to live-scans; 24b KEEP +
> re-point `model-baseline-commit` for the data-drift baseline). Don't re-collapse it.

**RESUME AT #47 `publish-signed-artifacts`** (deploy-prep). Done through #46; only #47–#49 remain. See the
"SESSION-3 LOCAL CHANGES" + "NEXT SESSION" blocks below for the uncommitted CI edits and the resume detail.

> **#38 `evidently-drift` — DONE (⚠️🔴 ran in SEED-MODE).** It ran but never compared: no committed
> `dataset-reference.jsonl` → seed branch → `{seeded:true,drift_detected:false}` (the seed default, NOT a
> verdict), and it **returned before importing Evidently** — so PSI/TextEvals never executed and
> `evidence/evidently/` is an empty dir (no HTML). Chain positive: the redacted dataset DID reach it (2 records),
> re-proving the #1 chain fix. **The pasted seed exposed two more defects + a #28 finding:** (1) Presidio
> #28 over-redacted the benign key `ci-benign-002` → **`<PERSON>`** (false positive on a synthetic id;
> non-deterministic — `ci-benign-001` survived → seed is non-reproducible); (2) the seed is **invalid JSON**
> (`NaN` tokens from pandas NaN-filling the two rows' disjoint columns). **Caveat added to Fix #24b: do NOT
> commit this seed verbatim** — it would enshrine `<PERSON>` + `NaN` + a 2-row half-empty frame as the drift
> baseline; author a clean, realistically-sized reference instead. Also: unpinned bleeding-edge stack
> (evidently 0.7.21 / pandas 3.0.3 / numpy 2.4.6 — comparison-path compat UNVERIFIED since it never ran) and a
> shared-cache bloat round-trip (~250 MB of unused wheels into the `no space left` key from #22/#35).

### ✅ Documented THIS session (all in `PIPELINE_JOB_VALIDATION.md` + MEMORY.md running log):
- **#29 `eval-dataset-validate`** — REVISED 🔴→✅. Now a GENUINE executing hard schema gate (`allow_failure:false`):
  downloaded `dataset-redact`'s artifact, found `DATASET_FILE` (broken-chain `exit 1` guard NOT hit → **Fix #1
  chain repair CONFIRMED end-to-end**), jsonschema validated both fixture rows → `Eval dataset VALID — 2
  record(s)`. STRUCTURE-only (content = GX #30). The fact it RAN proves the dataset chain is alive.
- **#33 `artifact-signing-gate`** — ✅ real enforcing chokepoint (`allow_failure:false`), PASSED. ⚠️ TWO honest
  caveats: (1) it downloads `signature-verification`'s artifact but **NEVER reads it** — keys only off
  `integrity.env`(tamper)+modelscan+modelaudit, so on this branch (where sig-verify DEFERS) **nothing actually
  verified a signature yet the "signing gate" passes green** — it's a tamper gate, not a signing gate; (2)
  ModelScan arm vacuous on the 0-file GGUF scan → malware coverage = ModelAudit #22 + ClamAV #24 only.
  **MODEL-INTEGRITY STAGE COMPLETE — 17/20** (#30/#31/#32 deferred).
- **#35 `markllm-watermark-eval`** — ✅ genuinely works (loaded Qwen2.5-1.5B on CPU, embedded+detected KGW
  watermarks, both `is_watermarked:true`, scores 6.25/4.53). ⚠️ HEADLINE caveat: **chain-of-custody break** —
  it evals `Qwen/Qwen2.5-1.5B-Instruct` (full transformers repo, freshly downloaded from HF, UNVERIFIED,
  `revision:null`), **NOT the q2_k GGUF the entire model-integrity chain just signed/verified/scanned**. The
  integrity guarantees don't cover the evaluated artifact. Also: dead `min_length=160` constraint (silently
  overridden, infeasible vs max_length 141/138); 🔴 **cache `no space left on device` again** (the #22 pattern
  recurring at the heaviest install — self-reinforcing: save fails → not persisted → re-download grows the key
  → next save fails; fix = separate/smaller cache key for ai-eval jobs). `ai-eval` 1/2 documented.
- **#34 `markllm-deps-audit`** — ✅ real + good explainability (logs every id+pkg+fix_versions, persists JSON)
  but 🔴 **report-only**: found 11 vulns/3 pkgs incl TWO RCE-class in the libs it audits — `torch` CVE-2025-3000
  (no fix), `transformers` PYSEC-2025-217/CVE-2025-14929 (X-CLIP deserialization RCE, no fix), `transformers`
  CVE-2026-1839 (`torch.load` w/o `weights_only`, **fixable** 5.0.0rc3) — and passed green. 8/11 are pillow
  noise. → **Fix #23**: wrong place (only ML-stack scan, sits behind integrity chain) + wrong order (runs
  *concurrently* with #35 which executes those deps). `ai-eval` **2/2 COMPLETE**.
- **#36 `model-drift-detection`** — 🔴 DEAD-BY-CONSTRUCTION: `detect_model_drift.py` reads only the six
  live-scan eval files (all moved to `live-scans.gitlab-ci.yml` 2026-06-16) → `{skipped:true,"no metrics"}`
  every run; ignores `markllm-results.json` (the only eval here). → **Fix #24a** (move eval-metric unit to
  live-scans). `allow_failure` correct by design (producer; gate is `drift-gate`). 🔴🔴 WATCH `drift-gate`: if
  it PASSes on a `{skipped}` report the whole guardrail-drift layer is theater.
- **#37 `model-baseline-commit`** — ⛔ DOES NOT INSTANTIATE on this branch (default-branch-only rule; present
  in git, not removed; user ran it MANUALLY → that's how `eval-baseline.json` got committed). IMPORTANT, not
  deletable: it's the self-bootstrap that writes a drift baseline back to the repo. → **Fix #24b**: KEEP +
  re-point at evidently-drift #38's `dataset-reference.jsonl` (which has NO commit job → #38 can't bootstrap).
- **#38 `evidently-drift`** — ⚠️🔴 RAN IN SEED-MODE (full detail in the STATUS callout above + the doc).
  **Purpose:** input-side data-drift control (PSI/TextEvals vs a committed reference). **Findings:** F1 seed-mode
  vacuous green (returned before importing Evidently → never compared); F2 no activation path (no auto-commit job
  → Fix #24b); F3 empty evidence dir; F4 Presidio #28 over-redacted `ci-benign-002`→`<PERSON>` (non-deterministic);
  F5 seed is invalid JSON (`NaN`); F6 unpinned/unaudited stack (→ Fix #0); F7 cache bloat; F8 2-row fixture vacuous.
  **Recommended fixes:** (1) F1/F2 → re-point #37 at the seed *with sanitize/validate*, not raw `cp` (#24b);
  (2) F3 → resolved once comparison runs; (3) F4 → exclude id/key fields from PII redaction, build ref from
  pre-redaction data; (4) F5 → normalize NaN→null before serializing; (5) F6 → pin **and** audit the drift stack
  (Fix #0); (6) F7 → separate/smaller cache key; (7) F8 → realistically-sized reference before `allow_failure:false`;
  (8) verify `drift-gate` doesn't treat `{seeded}` as PASS.
- **#39 `evidence-summary`** — ⚠️ real bundler + genuine gate (NO `allow_failure`) but a **file-PRESENCE gate,
  never opens the artifacts**. **Purpose:** assemble the 90-day evidence bundle (`evidence-summary.md` + bundle
  the drift seed + `model-baseline.json`) and gate on required artifacts. **Findings:** F1 `EXPECTED=[semgrep.json,
  markllm-results.json]` checked via `.exists()` only (script:37-41) → a run full of findings passes green;
  F2 the 2 required files are weak — clamav/signature/tamper/dataset-scan/artifact-signing-gate/pip-audit outputs
  aren't in `EXPECTED` *or* `ADVISORY`; F3 advisory `False` rows (GX/ydata/DT) blur skipped-by-design vs broken;
  F4 bundles seed-mode `evidently-drift.json` + #38's empty HTML dir as if signal; F5 `eval-baseline.seed.json`
  bundle path DEAD (upload WARNING — confirms #36 dead-by-construction); F6 unpinned+unaudited `pip install jinja2`
  (→ Fix #0). **Recommended fixes:** (1) F1 → parse verdicts (semgrep error-severity / markllm `is_watermarked`),
  or rename it a completeness check; (2) F2 → add integrity-chain outputs to `EXPECTED`; (3) F3 → producers emit
  `{skipped:true,reason}` + 3-state column, fail only on MISSING; (4) F4 → show each report's verdict not bare
  presence, don't bundle the empty HTML dir; (5) F5 → resolved by Fix #24a/#24b, flag inert meanwhile; (6) F6 →
  Fix #0 + use the pinned `requirements.txt` jinja2. **`evidence` stage 1/2; resume at #40 model-signing-evidence.**

**Two-drift / two-baseline model (do not re-collapse — see the over-collapse note in STATUS):**
`model-drift-detection` #36 = EVAL-METRIC drift (six live-scan files; belongs in live-scans, Fix #24a).
`evidently-drift` #38 = DATA drift (dataset vs `dataset-reference.jsonl`; stays here). `model-baseline-commit`
#37 = the baseline bootstrap (Fix #24b: re-point to #38). `ydata-profile` #31 = single-dataset descriptive
profile, NO baseline (not a drift control). Evidently (Context7-confirmed) uses per-column stattests
(PSI/Wasserstein/chisquare), so #36's flat `±0.10` scalar is a crude proxy — fine for aggregate pass-rates.

### ⏸️ DEFERRED — #30/#31/#32 (no run evidence; need a re-run of the `ff9bd7e` fixes):
These three dataset-chain jobs depend on the LOCAL-ONLY `ff9bd7e` fixes (NOT in the `8061900` run), so they
were documented only as "pending-confirm" (a placeholder block sits between #29 and #33 in the validation doc).
On `8061900` they'd fail: **#30 GX** on category-in-set (`ci-fixture` not in `value_set`, 0/2 vs mostly 0.9);
**#31 ydata** on `No module named 'pkg_resources'` (setuptools 81); **#32 dataset-sign** on the broken-chain
guard. **To confirm them: push `ff9bd7e` for a green branch run, then validate the three logs.**

**Branch / commit state (newest first; `ff9bd7e` + `a113877` are LOCAL-only, the rest are pushed):**
```
a113877  docs: update handoff — fixes done, resume documenting               ← NOT pushed (+ further edits this session)
ff9bd7e  ci: fix dataset-sign needs, ydata pkg_resources, GX category set     ← NOT pushed yet
8061900  ci: dataset-redact — install click for the spaCy CLI                 ← pushed (THIS is the run being documented)
14ffa87  ci: make conda-forge isolation real (--override-channels)            ← pushed
c4d86f1  ci: make signature-verification protected-branch-aware              ← pushed
5cf4c55  ci: install curl in dataset chain jobs                               ← pushed
beca04b  ci: apply 22 GAIPS pipeline required-fixes                           ← pushed
```
### 🔴 SESSION-3 LOCAL CHANGES — now COMMITTED in `7cbcd01` (session 4 backup), still NOT pushed / NOT run-validated
> _Session-4 update: these session-3 working-tree edits were committed as the `7cbcd01` checkpoint before the
> fix sweep, so they are no longer loose in `git status` — but they remain **unpushed and unvalidated on CI**.
> The original description is preserved below._
This session made **real `.gitlab-ci.yml` edits** (not just docs) while documenting. They are in the working tree
only — `git status` will show `.gitlab-ci.yml` + several `docs/gaips-materials/*` modified. **None have run on a
pipeline** — they need a billable re-run to validate. Summary:
1. **`sign-evidence` overhaul** (was `model-signing-evidence` #40): renamed → `sign-evidence`; moved to a new
   terminal **`attest`** stage (last in the pipeline); bundle rebuilt into a `schema_version 2.0` run-evidence
   manifest (pipeline metadata + model identity + **sha256 hash-manifest of all reports/sbom/evidence files**);
   added **cosign verify-blob self-verify**; dropped the dead `model-signing`/`sigstore` pip install
   (`before_script:[]`+`cache:{}`). `needs:` = 37 artifact-producers.
2. **`drift-gate` REMOVED** (#44 confirmed theater): job deleted; `image-sign` re-pointed
   `needs:["drift-gate"]`→`["dependency-track-upload"]`; removed from `sign-evidence` needs.
3. **Docs updated to match:** README + SBOM mermaids/tables (added `attest`, removed `drift-gate`, added the
   **four-signature chart**: model/dataset/ai-bom/image — what signs what + verifier), SETUP, CI-VARIABLES,
   live-scans.
4. **New CRITICAL fixes added** to the REQUIRED FIXES list: **#25** (`ai-bom-sign` → cosign keyless, MANDATORY)
   and **#24b elevated to CRITICAL** (`model-baseline-commit` commits the WRONG baseline — `eval-baseline.json`,
   not `dataset-reference.jsonl` — `.gitlab-ci.yml:2301-2302`). Later (next session) **#26** (`publish-signed-artifacts`
   #47: stale model-bundle comment / no failed-publish signal / branch-scoped `ARTIFACT_BASE_URL` cutover) and **#27**
   (`metrics-normalize` #48: present-but-`null` extraction gaps / gate-semantics labeling / `generated_at` mislabel)
   and **#28** (`pages` #49: negative-polarity boolean mis-color — `drift_detected:false` shows red — + blank-cell rendering
   of present-but-`null` values) were added to the walkthrough-surfaced list — Tier 2–5, not critical.
**ALL local CI edits validated statically** (YAML parses, no dangling `needs:`, no cycle, no stage-order
violations, embedded Python compiles + smoke-tested) — but **never run on CI.**

**Branch reminder:** `8061900` is the pushed tip being documented; `ff9bd7e`+`a113877` were already local-only
before this session. So the working tree now = `8061900` + `ff9bd7e`/`a113877` (uncommitted) + this session's CI
+ doc edits (uncommitted). Decide whether to commit/squash these before the next billable run.

### ▶️ NEXT SESSION — start here:
1. **🏁 WALKTHROUGH COMPLETE *and* ALL REQUIRED FIXES APPLIED (session 4).** #1–#22 done+pushed earlier;
   #0, #23, #24a/b, #25, #26, #27, #28 applied this session in `459a562` (UNPUSHED) over the `7cbcd01` backup.
   See the **session-4 STATUS block at the top** for the per-fix summary + validation. **The only open
   action is the billable re-run.**
2. **▶️ DO THIS FIRST — the single billable re-run** (default branch, no `[sigstore-discovery]`). It validates
   in one shot: (a) the **DEFERRED legs #30/#31/#32** (`great-expectations-validate` / `ydata-profile` /
   `dataset-sign` — need `ff9bd7e`, never had run evidence on `8061900`); (b) the **session-3** edits
   (`sign-evidence`/`attest`, `drift-gate` removal); (c) the **session-4 fix sweep**, especially the paths that
   only execute live: `data-drift-baseline-commit` and the keyless `ai-bom-sign` (both need default-branch +
   `GITLAB_PUSH_TOKEN` / OIDC). Decide commit/squash strategy for `ff9bd7e`+`a113877`+`7cbcd01`+`459a562` before pushing.
3. **Method (for re-run validation):** USER pastes each real GitLab job log/artifact (no glab/docker locally); read
   the job block in `.gitlab-ci.yml` (grep the name — line numbers shifted) + backing script in
   `docs/gaips-materials/scripts/` FIRST to set expectations; lead each verdict with the most damning TRUE finding;
   keep distinct jobs/controls separate (anti-collapse). **REPORT FORMAT (user requirement, from #39 on — in CHAT
   *and* the doc):** every per-job report states (1) **Purpose** (plain terms) and (2) **Recommended fixes**
   (finding→fix list). See memory `feedback-job-purpose-and-fixes`.
4. **Post-re-run follow-ups (non-blocking, deferred by design):** commit the `lockfile-audit` artifact as
   `ci/requirements-ci.txt` to enable `--require-hashes` (#0 "teeth"); then **drop `allow_failure`** on the per-env
   audits, `lockfile-audit`, and `markllm-deps-audit` (#23) once the pipeline is otherwise green; add a small
   enforcing gate over `evidently-drift` #38 (data-drift) and over `model-drift-detection` in live-scans (#24a)
   once their references/baselines are committed.

**Method unchanged:** read the job block in `.gitlab-ci.yml` (grep the name — line numbers shifted) + its
backing script in `docs/gaips-materials/scripts/` to set expectations, then the USER pastes the real GitLab
job log/artifact (no glab/docker locally), validate paste vs expectation, write the entry. Lead each verdict
with the most damning TRUE finding (see VERDICT DISCIPLINE below).

## ⚠️ POST-PUSH FIX LOG (failures the branch run surfaced, in order — all now fixed)
Each is a genuine pre-existing defect that only appeared once the fix made the job actually run/enforce:
1. **`dataset-redact` — `curl: command not found`** (`5cf4c55`). python:3.11-slim has no curl; the gitleaks
   download needs it. Added `apt --no-install-recommends curl ca-certificates` after the skip guard. Same
   fix pre-emptively added to `dataset-sign` (curls cosign) + `dataset-download` download branch.
2. **`signature-verification` — identity `<unset>`** (`c4d86f1`). `MODEL_SIGNING_IDENTITY` /
   `SIGSTORE_OIDC_ISSUER` are **GitLab PROTECTED variables** — injected only on protected refs. On `main`
   (run 6a48e52) they were set and verification succeeded (finding #19); on this unprotected feature branch
   they arrive empty. Made the gate **protection-aware** via `CI_COMMIT_REF_PROTECTED`: hard-fail on a
   protected ref with no identity (real misconfig), DEFER with an evidenced skip on an unprotected ref.
   → **CONSEQUENCE FOR DOCUMENTING #19:** on the branch, signature-verification DEFERS (does not truly
   verify). The real #19 verification evidence (SAN/issuer/Rekor/digest) only exists on a **protected-branch
   / `main`** run. Document #19 from a `main` run, or note the defer.
3. **`conda-pkg-verify` — `defaults` channel still active** (`14ffa87`). Confirmed finding #9: the config
   `--remove channels defaults` never actually dropped it. Switched to `--override-channels --channel
   conda-forge` (real isolation at resolution) + assert on the RESOLVED package channels. allow_failure:true.
4. **`dataset-redact` — `No module named 'click'`** (`8061900`). presidio pulls typer 0.26.x which no longer
   hard-depends on click, but spaCy's CLI imports it. Added explicit `click`. → redact then PASSED.
5. **`dataset-sign` — broken chain** (`ff9bd7e`). needs:[eval-dataset-validate] republished only the report,
   not `dataset-input/`. Added `dataset-redact` to needs (carries the redacted bytes). Same class as Fix #1.
6. **`ydata-profile` — `No module named 'pkg_resources'`** (`ff9bd7e`). setuptools 81 removed pkg_resources;
   pinned `setuptools<81`. allow_failure:true.
7. **`great-expectations-validate` — content gate failed** (`ff9bd7e`). Only the category-in-set expectation
   failed: the fixture's category `ci-fixture` was missing from the suite `value_set`; added it. Soft gate
   (allow_failure:true); the question/prompt length checks pass via GE's non-null evaluation.

**Confirmed GREEN on the branch run so far:** `dataset-download`, `dataset-scan`, `dataset-redact`,
`eval-dataset-validate` (the dataset chain is alive end-to-end through #29). #30/#31/#32 fixed in `ff9bd7e`.

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

# 📝 RESUME HERE — document jobs #29–#49 in `PIPELINE_JOB_VALIDATION.md`

The fixing phase is done; **return to the per-job validation walkthrough.** Findings #1–#28 are already
written (#16–#28 authoritative in `docs/gaips-materials/PIPELINE_JOB_VALIDATION.md`). Pick up at **#29 and
document through #49** — but note the dataset chain now RUNS, so several of these have fresh, real evidence
that the earlier "broken-chain / skipped" findings must be REVISED against:

- **#29 `eval-dataset-validate`** — REVISE: previously documented as a cascade-skip (broken chain). It now
  RUNS and PASSES on the redacted fixture (jsonschema vs eval-dataset.schema.json). Re-document against the
  real run.
- **#30 `great-expectations-validate`** — now runs; content gate green after the `ci-fixture` category fix
  (soft gate, allow_failure:true). Loaded 2 records, 6 expectations.
- **#31 `ydata-profile`** — now runs (advisory profile) after the setuptools<81 fix.
- **#32 `dataset-sign`** — now runs; cosign keyless sign-blob of the redacted bytes (needs-fix landed).
- **#33 `artifact-signing-gate`** — the model-integrity chokepoint (hard gate); document whether it passes.
- **#34–#49** — the remaining stages, in order: `ai-eval` (markllm-deps-audit, markllm-watermark-eval),
  `guardrail` (model-drift-detection, model-baseline-commit, evidently-drift), `evidence`
  (evidence-summary, model-signing-evidence), `ai-bom` (ai-bom-assemble, ai-bom-validate, ai-bom-sign,
  drift-gate), `deploy-prep` (dependency-track-upload, image-sign, publish-signed-artifacts,
  metrics-normalize, pages). Several skip cleanly when their creds/inputs are unset (DT, IMAGE_REF, etc.) —
  apply the same verdict discipline (a clean skip ≠ ✅; say what it would do and why it's inert this run).

**⚠️ PROTECTED-BRANCH CAVEAT for documenting the signing path:** `signature-verification` #19 DEFERS on this
unprotected branch (the identity pins are protected vars — see POST-PUSH FIX LOG #2). Its real verification
evidence only exists on a `main` / protected-branch run. Same may affect any job reading
`MODEL_SIGNING_IDENTITY`/`MODEL_ENDPOINT`/`GEMINI_API_KEY`/`CI_REGISTRY_TOKEN`. Document those from a `main`
run or explicitly note "deferred on unprotected branch".

Per-job findings **#16–#28 are authoritative in `docs/gaips-materials/PIPELINE_JOB_VALIDATION.md`** (and
mirrored in auto-memory `project_gaips_pipeline.md`). The "Findings so far" list lower in THIS file covers
only **#1–#15** and is not maintained past that — use the validation doc for #16+.

---

# 🔧 REQUIRED FIXES (apply in this order)

Ordered by severity: **Tier 0 = CRITICAL foundational gap**, then **Tier 1 = green-but-does-nothing security
controls**, then enforcement/auditability gaps, then pinning/scope, then hygiene/waste. Each item: `job #` ·
problem · concrete fix. Checkboxes so the next session can track progress.

### 🛑 Tier 0 — CRITICAL (foundational; should have been done at the start)
- [x] **0. ✅ APPLIED (s4, `459a562`) — `.audit-env` per-job env audit + `lockfile-audit` job.** `pip-audit` must vuln-scan ALL jobs' libraries — today it covers almost none.** **Problem
  (verified against `.gitlab-ci.yml`):** there are only two audit jobs and between them they audit a small
  slice of what the pipeline actually installs. `pip-audit` (sast, line 467) audits **only `requirements.txt`**
  = `pandas==2.3.3` / `requests==2.34.2` / `jinja2==3.1.6` (+ their resolved transitives). `markllm-deps-audit`
  #34 (line 2177) audits **only** a synthetic `torch`/`transformers`/`markllm` list. **Every other job
  `pip install`s libraries that NO pip-audit ever sees** — and crucially this includes the **security toolchain
  that guards the model, which is itself never vuln-scanned**: `model-signing`/`sigstore`/`cryptography`
  (785/886/935/997/2425), `modelaudit[all]` (1257), `modelscan` (1203), `presidio-analyzer`/`presidio-anonymizer`
  (dataset-redact 1846), `huggingface_hub` (1518), `hvac` (256/1075), `semgrep` (332), `pip-tools` (496),
  `dvc[all]` (680), `jsonschema` (1920), `great-expectations` (1962), `ydata-profiling` (2001), `evidently`
  (2325, pulls cryptography 49.0.0 + a ~73-pkg tree). **Two failure modes:** (i) *zero coverage* for all the
  above; (ii) *audit/runtime version mismatch* even where a name overlaps `requirements.txt` — e.g.
  evidently-drift runs `pandas 3.0.3`/`numpy 2.4.6` while pip-audit only ever cleared `pandas 2.3.3`; `jinja2`
  / `requests` are re-installed unpinned in evidence/DT/metrics jobs. **Consequence:** a CVE in any of these
  (or a poisoned `modelaudit`/`presidio`/`cryptography`) would pass green undetected — and **pinning a library
  that nothing audits just freezes a blind spot** (this is why the #38 F6 "pin the drift stack" rec is
  necessary-but-insufficient on its own, and it generalizes Fix #23 from torch/transformers to the whole
  pipeline). **Fix (coverage now, teeth later — same posture as #23):**
  - **(A) Per-job env audit (catches the version-mismatch):** add a shared `.pip-audit-env` script anchor that
    every job with an ad-hoc install calls **after** its install — `pip-audit` against the **live installed
    environment** (no `--requirement`, so it audits exactly what the job will run) → per-job
    `${REPORTS_DIR}/pip-audit-<job>.json`.
  - **(B) Lockfile audit (reproducible set):** consolidate the ad-hoc installs into hash-pinned lockfiles
    (`ci/requirements-*.in` → `pip-compile --generate-hashes`) and have the central `pip-audit` job audit that
    full set, not just the 3-line `requirements.txt`.
  - **Best = A + B** (lockfile for reproducibility + per-job env audit for "audit what you actually run").
  - **Gating:** wire coverage first; keep `allow_failure:true` / `|| true` until the pipeline is otherwise
    green (per Fix #23), **then** drop `allow_failure` and fail when any vuln has a non-empty `fix_versions`.
  - **NB:** this supersedes the standalone pin recommendations — every "pin X" fix (#11, #38 F6) must be paired
    with adding X to audited coverage here.

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

### Walkthrough-surfaced fixes (session 3, 2026-06-17 — beyond the original 22)
- [x] ✅ **APPLIED (s4, `459a562`): moved to `stage: sast`, `needs:["setup"]`; gating still deferred.** **23. `markllm-deps-audit` #34 — AI deps audited in the wrong place, contingently, and concurrently
  with the job that executes them.** It's the **only** scan of the ML stack (the sast `pip-audit` #5-job
  audits root `requirements.txt` = `{pandas,requests,jinja2}` only — torch/transformers aren't in it or its
  transitives), yet it sits in `ai-eval` (stage 6) behind `needs:["artifact-signing-gate","model-manifest"]`
  — so any model-integrity gate failure suppresses it entirely. Worse, it and `markllm-watermark-eval` #35
  are sibling `ai-eval` jobs with **no edge between them** (#35 doesn't `needs:` #34), so they run in
  parallel: #35 `pip install`s + live-loads torch/transformers (the CVE-2026-1839 `torch.load`-without-
  `weights_only` path) at the same time as / before the audit flagging it finishes. The job's script has **no
  real dependency** on stages 3–6 (it audits a synthetic `torch==/transformers==/markllm==` requirement list
  from the static version vars; touches no model/dataset/signing artifact) — the current `needs:` is
  vestigial convention. **Fix (this item — the MOVE only):** `stage: sast` + `needs: ["setup"]` (drop
  `artifact-signing-gate`/`model-manifest`). This puts both `pip-audit` jobs side by side over their two
  disjoint dep universes, decouples the AI-stack scan from the integrity chain (can't be skipped by a gate
  failure), and makes it run **before** #35 executes those deps. **GATING IS DEFERRED / NON-BLOCKING for now**
  (per user): **keep `allow_failure: true` and `|| true`** until all pipeline bugs are fixed — turning on
  enforcement (drop `allow_failure`; `exit 1` when any vuln has non-empty `fix_versions`; `#35 needs:[34]`)
  while broken chains still exist would just paint the pipeline red. Ordering moves now; teeth come last.
- [x] ✅ **APPLIED (s4, `459a562`): 24a — `model-drift-detection` moved to live-scans, deleted from static (+ dead `needs` edges dropped); 24b — `data-drift-baseline-commit` sanitizes + commits `dataset-reference.jsonl`.** **24. Drift baselines are in the wrong pipeline / missing — SPLIT, do NOT blanket-delete.** Background:
  there are TWO independent drift controls and TWO baselines, and they were conflated. (i) **model/eval-metric
  drift** = `model-drift-detection` #36 + `detect_model_drift.py` (reads ONLY the six live-scan eval files
  `inspect-ai`/`garak`/`pyrit`/`giskard`/`guardrail-regression`/`promptfoo`-results.json) + its baseline
  `evals/eval-baseline.json` + the bootstrap `model-baseline-commit` #37. (ii) **data/feature drift** =
  `evidently-drift` #38 (`run_evidently_report.py --current ${DATASET_FILE} --reference
  evals/dataset-reference.jsonl`) + its baseline `evals/dataset-reference.jsonl`. **`model-baseline-commit` is
  IMPORTANT, not deletable:** it is the self-bootstrap that writes a seeded baseline back into the repo
  (default-branch + `GITLAB_PUSH_TOKEN` + a seed produced → `cp seed → dest`, `git commit`, `git push -o
  ci.skip HEAD:default`); **without an auto-commit step a drift control has no baseline and stays in seed-mode
  forever** (seed every run, never compare).
  - **24a (MOVE to live-scans):** relocate the *eval-metric* unit — `model-drift-detection` +
    `detect_model_drift.py` + `evals/eval-baseline.json` + the eval-baseline bootstrap logic — into
    `ci/live-scans.gitlab-ci.yml`, where its six input files actually exist; DELETE that unit from this
    pipeline. It was left behind by the 2026-06-16 split (`extract_metrics()` → `{}` →
    `{skipped:true,"reason":"no metrics"}` every run here; baseline `eval-baseline.json` is itself seeded from
    live-scans-only metrics `giskard.high_findings`/`guardrail.pass_rate` = committed to the wrong repo).
    Do NOT graft a `markllm-results.json` branch on (rejected: overloads one job + leaves six dead readers;
    watermark-score drift, if wanted, is a separate small check next to #35). **Knock-on — DONE (2026-06-18):**
    `drift-gate` was **REMOVED** from the static pipeline (confirmed vacuous theater at #44 — it PASSed on the
    `{skipped}` report). `image-sign` re-pointed to `needs:["dependency-track-upload"]`; removed from `sign-evidence`
    needs; docs updated. ⚠️ This **supersedes the #24b "re-point drift-gate at evidently-drift" plan**: data drift
    (#38) is now **ungated** in the static pipeline. If data-drift *enforcement* is wanted here later, add a small
    gate over `evidently-drift` #38 (once it has a real committed reference) — do NOT revive `drift-gate` over the
    dead `model-drift-detection`. The eval-metric drift unit + its enforcing gate still need to MOVE to live-scans.
  - 🛑 **24b (CRITICAL — KEEP + RE-POINT in this pipeline):** this pipeline's REAL drift control is
    `evidently-drift` #38 (data drift on the dataset), and **it has NO baseline-commit job → its
    `dataset-reference.jsonl` never auto-materializes → #38 is stuck in seed-mode and can never actually compare**
    unless a human hand-commits the reference.
    - **The precise defect (why this is critical):** `model-baseline-commit` #37 is the pipeline's ONLY auto-commit
      job, but it commits the **WRONG baseline** — it hardcodes `eval-baseline.seed.json → evals/eval-baseline.json`
      (`.gitlab-ci.yml:2301-2302`), i.e. the **eval-metric** baseline for the **dead-by-construction #36**, and
      **never touches `evals/dataset-reference.jsonl`**. So the one bootstrap the pipeline has **feeds a dead control
      and starves the live one** (#38). Confirmed at #44/#38 in the validation doc.
    - **Understanding — the compare logic already exists, only the file is missing:** `run_evidently_report.py` holds
      the FULL compare path; it early-returns at the seed branch (`:96-107`) only because `evals/dataset-reference.jsonl`
      is absent. The moment that file exists, it falls through to the real run (`:109-164`) — PSI `DataDriftPreset` +
      `TextEvals`, writes `evidently-drift.json` + `evidence/evidently/drift-report.html`, and **`exit 1`s on drift**
      (`:160-163`). ⇒ **No code change needed to DOCUMENT drift — only a committed reference.** To ENFORCE drift, just
      drop `evidently-drift`'s `allow_failure: true` (the script self-`exit 1`s) — no gate needed (drift-gate is gone).
    - **Fix:** add/clone a data-drift bootstrap that commits `reports/dataset-reference.seed.jsonl →
      evals/dataset-reference.jsonl`, reusing #37's mechanism — **but with a sanitize/validate step, NOT a raw `cp`**
      (the seed is corrupted: F4 `<PERSON>` over-redaction + F5 invalid `NaN` JSON + F8 2-row).
    - **#37's mechanism, to clone (template):** runs **only on the default branch** (`rules: $CI_COMMIT_BRANCH ==
      $CI_DEFAULT_BRANCH`) and **only when all three hold** — (a) a seed was produced this run, (b) `GITLAB_PUSH_TOKEN`
      (`write_repository` PAT) is set, (c) the dest baseline doesn't already exist. Those guards make it a **one-time,
      self-disabling bootstrap** (won't clobber an existing baseline; never fires on feature branches — which is why
      today's `eval-baseline.json` is a MANUAL artifact, not auto-path-proven). When they hold: `cp seed → dest` →
      `git commit -m "… [skip ci]"` → `git push -o ci.skip HEAD:<default>`; **both** `[skip ci]` and `-o ci.skip` stop
      that push from triggering a new pipeline (no commit→pipeline→commit loop). It commits **straight to the default
      branch, bypassing MR review** — fine for a CI bot, but record as a deliberate **governance exception**. Gating
      posture per Fix #23 (non-blocking until bugs fixed).
    - **⚠️ Caveat from the #38 run — do NOT auto-commit the seed verbatim.** The actual
      `dataset-reference.seed.jsonl` is corrupted: (a) Presidio #28 redacted the benign id `ci-benign-002` →
      `<PERSON>` (false positive, non-deterministic — `ci-benign-001` survived → seed not reproducible), and
      (b) it's invalid JSON (`NaN` from NaN-filling the two rows' disjoint columns). Auto-committing it would
      enshrine a redaction artifact + non-portable JSON + a 2-row half-empty frame as the drift baseline. The
      reference must be hand-authored, clean, realistically-sized (possibly from *pre*-redaction data). So #24b's
      path needs a sanitize/validate step, not a raw `cp seed → dest`.
- [x] ✅ **APPLIED (s4, `459a562`): `cosign sign-blob` keyless via `SIGSTORE_ID_TOKEN`; PreSync hook → `cosign verify-blob`; `allow_failure:false`; RSA key + public-key Secret removed.** 🛑 **25. `ai-bom-sign` #43 — sign the AI-BOM with cosign keyless (MANDATORY / CRITICAL).** Today the job signs
  the BOM with a native CycloneDX **enveloped RSA XMLDSig using an EPHEMERAL keypair** minted in-job (because
  `CYCLONEDX_SIGNING_KEY` is unset), deletes the private key, and publishes the throwaway public key beside the BOM.
  Result: the BOM's OWN signature is **tamper-evidence only — zero authenticity/provenance**, pins no stable signer
  across runs, and the deploy-time `cyclonedx verify` (Argo PreSync) can only trust-on-first-use the key that ships
  inside the artifact. It is the **lone identity-less signature** in a pipeline where the model #18, dataset #32, and
  `sign-evidence` #40 all sign **cosign keyless** (Fulcio identity + Rekor transparency log). **Fix (do this, not the
  stopgap):** convert `ai-bom-sign` to **`cosign sign-blob` via the GitLab `SIGSTORE_ID_TOKEN`** (id_tokens, works on
  any ref — same pattern as #40), emitting a `.sig`/`.pem` over the BOM with a real Fulcio identity + Rekor entry;
  update the Argo PreSync hook to `cosign verify-blob` (identity/issuer regexp) instead of `cyclonedx verify`. This
  **supersedes** the weaker "just wire a stable `CYCLONEDX_SIGNING_KEY`" option — that was the interim stopgap; the
  mandatory fix is cosign keyless for consistency + real provenance. Then drop `allow_failure` so an unsigned BOM can't
  silently reach `publish-signed-artifacts`. (Documented in `PIPELINE_JOB_VALIDATION.md` #43.)
- [x] ✅ **APPLIED (s4, `459a562`): 26a stale comment rewritten; 26b per-file upload tracking + `publish-result.json`, non-green on partial; 26c branch-scoped URL guidance; now publishes `.sig`/`.pem`.** **26. `publish-signed-artifacts` #47 — three deploy-distribution hygiene fixes.** The job genuinely publishes
  the signed set (AI-BOM + key + `model-bundle.tar`) to the GitLab generic package registry and emits the PreSync
  `ARTIFACT_BASE_URL` — these are quality/safety gaps, not breakage. (NB: its other two findings are already tracked
  elsewhere — the **ephemeral BOM key** is **Fix #25**, and the **absent dataset arm** rides the dataset-chain re-run
  under **#24b / deferred #30–#32**; do not duplicate them here.)
  - **26a (Tier 5 — stale/misleading comment, comment-only edit).**
    - **Current (`.gitlab-ci.yml:2938-2944`):** the comment above the bundle guard asserts *"model-sign publishes only
      `**/model.sig` as artifacts, not the weights, so via `needs` alone this stays empty and the bundle is correctly
      skipped."* The guard it annotates (`:2945-2955`) sets `HAVE_WEIGHTS=1` if `MODEL_DIR` holds any
      `pkl|pt|safetensors|gguf|bin|h5|onnx`, then tars the dir iff weights **and** a `model.sig` are present.
    - **Why it's wrong:** the comment reasons about `model-sign` alone and **ignores that `model-fixture-download` is
      also in `needs:` (`:2909`)** and provisions the GGUF weights into `MODEL_DIR`. So `HAVE_WEIGHTS=1`, the guard
      passes, and `model-bundle.tar` ships on **every** run where the fixture is present — proven by the `80619005`
      log (`staged → model-bundle.tar (model_signing bundle of …/models)`). The bundle is the norm, not the exception.
    - **Fix:** rewrite the comment to credit `model-fixture-download` for the weights (and `model-sign` for `model.sig`),
      i.e. *"the bundle ships whenever the fixture provisioned weights + model.sig are both present; it is skipped only
      when neither needs-source populated `MODEL_DIR`."* **No logic change.** While here, optionally add a one-line
      assert that the bundled `model.sig` is the one `model-sign` produced (chain-of-custody, cross-ref #47-F8).
  - **26b (Tier 2 — no failed-publish signal).**
    - **Current:** the whole job is `allow_failure: true` (`:2910`). The upload loop (`:2963-2972`) runs
      `curl -sSf --retry 3 … --upload-file` per manifest line; if a file fails after 3 retries the step errors but
      `allow_failure` swallows it → **green**. The two early-outs (`:2914-2917` no GitLab API; `:2960-2962` empty
      manifest) also `exit 0`. Net: a failed/partial publish, or a publish of *nothing*, is indistinguishable from a
      full success — the deploy registry can silently retain stale artifacts.
    - **Fix:** keep `allow_failure: true` (a transient registry hiccup shouldn't fail the run), but make the outcome
      **observable**: accumulate per-file results in the loop and write `${STAGE_DIR}/publish-result.json`
      `{"published":[…],"failed":[…],"skipped_reason":null|"<guard>"}`, add it to `artifacts:paths` (`:2974`), and emit
      a `WARNING:`/`::warning::` log line if `failed` is non-empty. Then `metrics-normalize` #48 can surface a
      publish-health signal instead of the run going invisibly green on a partial/empty publish.
  - **26c (Tier 3 — branch-scoped URL cutover).**
    - **Current:** `BASE` (`:2959`) = `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/${EVIDENCE_PACKAGE_NAME}/${EVIDENCE_PACKAGE_VERSION}`,
      and on this run `EVIDENCE_PACKAGE_VERSION` resolved to the **branch** (`gaips-pipeline-required-fixes`), so the
      emitted `ARTIFACT_BASE_URL` is branch-specific. The Argo PreSync hook
      (`deployment/argocd/verify-signatures-presync-hook.yaml`) fetches from a ConfigMap `ARTIFACT_BASE_URL` that must
      match this exact path.
    - **Fix:** at merge, decide the stable `EVIDENCE_PACKAGE_VERSION` for the deploy-facing package (a release **tag** /
      semver, or `$CI_DEFAULT_BRANCH`) so the path doesn't move per feature branch, then update the PreSync ConfigMap
      `ARTIFACT_BASE_URL` to that path. Otherwise PreSync keeps pointing at the now-stale `gaips-pipeline-required-fixes`
      package version after merge and fetches nothing. (Documented in `PIPELINE_JOB_VALIDATION.md` #47.)
- [x] ✅ **APPLIED (s4, `459a562`): 27a real markllm schema + `present-but-unparsed` state; 27b enforcing-vs-advisory gate flag; 27c `generated_at`→`pipeline_created_at` (schema 1.1).** **27. `metrics-normalize` #48 — dashboard fidelity fixes** (all in `docs/gaips-materials/scripts/write_operational_metrics.py`).
  The job genuinely normalises 27/37 sources into one honest `operational-metrics.json` and tolerates absent inputs by
  design; these fixes harden *interpretation*. It is reporting-only (`allow_failure: true`) — that's correct, no
  enforcement fix needed.
  - **27a (Tier 2 — present-but-`null` extraction gaps; real schema drift, with the markllm one confirmed).**
    - **Confirmed defect (markllm):** the normaliser (`:443-446`) reads
      `markllm.get("ready", markllm.get("readiness"))` and `markllm.get("import_ok", markllm.get("import_status"))` —
      but **the producer `run_markllm_watermark_eval.py` writes none of those keys.** It emits `status`
      (`"running"|"passed"|"failed"`, `:73/:142/:36`), `failure_reason` (`:37`), and `metrics:{prompt_count,
      detections_completed}` (`:144-146`), plus `model_id`/`device`/`prompts`. So both `.get()` chains miss → the
      section is all-`null` even though #38 genuinely ran (loaded a 1.5B model). Same class, lower-confidence:
      `data_quality.download.size` (`:339` reads `size`/`bytes`, but `dataset-download.json` has neither → confirm the
      producer's real key) and `security.package_integrity.mode="unknown"` (`:191`, from `pkg-integrity.env`).
    - **Fix:** map to the keys the producers actually write — e.g. `ready` ← `status == "passed"`,
      `import_ok` ← `failure_reason` absent (or `status != "failed"`), and surface `detections_completed`/`prompt_count`
      from `metrics`; reconcile `download.size` and `package_integrity.mode` against their producers the same way. AND
      add a third `Sources` state: when a file loads but its section comes back all-`null`, mark it
      `"present-but-unparsed"` (not `"present"`), so a parse gap is distinguishable downstream from a genuinely absent
      input. (The `Sources` status is currently binary present/absent — extend it.)
  - **27b (Tier 2 — gate-semantics labeling can mislead).**
    - **Current:** `Metrics.gate(name, state, detail)` (`:129-132`) buckets signals into passed/failed/skipped with **no
      notion of enforcement**, and the output (`:644-648`) reports a flat `passed/failed/skipped` count. So the run's
      lone "failed" is `semgrep-sast` — which is **advisory** (`allow_failure: true`) — while the pipeline's actual hard
      gates (`signature-verification` #19, `artifact-signing-gate` #33, `clamav-scan`, `dataset-scan`/`-redact`,
      `eval-dataset-validate`, `ai-bom-assemble`/`ai-bom-validate`, `dependency-track-upload`) aren't even in the list.
      "10 passed, 1 failed" therefore reads as deploy-blocking when it isn't.
    - **Fix:** extend the gate signature to `gate(name, state, detail, enforcing=False)` and record `enforcing` in each
      entry; pass `enforcing=True` only for the `allow_failure: false` gates above. The dashboard (`pages` #49) can then
      separate "advisory finding" from "hard-gate failure," so the headline count reflects enforcement reality.
  - **27c (Tier 5 — `generated_at` is the pipeline timestamp, not the build time).**
    - **Current:** `:632` sets `ts = args.timestamp or CI_PIPELINE_CREATED_AT or "unknown"`, and the YAML invocation
      (`.gitlab-ci.yml:3004-3009`) passes no `--timestamp`, so `generated_at` = `CI_PIPELINE_CREATED_AT` (pipeline
      *creation* time) — which is why it coincides with `provenance.timestamp`, not when this JSON was actually written.
    - **Fix:** either rename `generated_at` → `pipeline_created_at` (truthful), or keep it and add a separate
      `normalised_at` stamped at write time (`datetime.now(timezone.utc)`), so consumers can tell "when the pipeline
      ran" from "when the dashboard JSON was produced."
  - ℹ️ Also note (no fix): the **operational/timing half is empty** without `GITLAB_API_TOKEN` (`operational.skipped=true`,
    graceful by design) — document that pipeline/job duration + queue metrics require the token.
    (Documented in `PIPELINE_JOB_VALIDATION.md` #48.)
- [x] ✅ **APPLIED (s4, `459a562`): 28a polarity-aware boolean coloring (`drift_detected:false`→green); 28b `null`→`n/a`; gate ledger shows enforcing/advisory.** **28. `pages` #49 — dashboard presentation-fidelity fixes** (in `docs/gaips-materials/scripts/render_metrics_dashboard.py`).
  The job genuinely renders a self-contained, JS-free GitLab Pages dashboard with an empty-input fallback; output is
  correctly UTF-8 encoded. These fixes are about how it *presents* #48's data, not whether it runs.
  - **28a (Tier 2 — negative-polarity booleans mis-colored; confirmed).**
    - **Current:** `render_value` (`:71-73`) does `cls = "ok" if value else "bad"` for **every** boolean — uniformly
      `true→green`, `false→red`. So `data_quality.evidently.drift_detected: false` renders as a **red `pill bad`**
      (`<span class="pill bad">False</span>`), the lone red pill in the Data-Quality card, even though **no drift is the
      desired outcome**. The rule is polarity-blind: any future `infected`/`vulnerable`/`dirty` boolean mis-colors the
      same way (true should be red, false green).
    - **Fix:** make coloring polarity-aware — define a `NEGATIVE_POLARITY` key set
      (`{"drift_detected","infected","vulnerable","dirty",…}`) and, when the rendered key is in it, invert
      (`cls = "bad" if value else "ok"`); leave positive-polarity bools (`valid`/`clean`/`passed`/`changed`) on the
      existing `true→ok` rule. Pass the `key` (already available in `render_value(key, value)`) into the decision.
  - **28b (Tier 5 — `None` renders as a blank cell, ambiguous with absent; render-side companion to #27a).**
    - **Current:** a `None` scalar falls through to `fmt(value)` (`:76`) and renders as an empty `<td></td>` — so
      `markllm.{ready,import_ok}`, `hf_scan.*`, and `download.size` show as blank cells **indistinguishable from a
      missing input**, even though markllm genuinely ran (#38). (The data-layer root cause is **#27a**.)
    - **Fix:** render `None` as an explicit `n/a` / `unparsed` (muted) rather than blank, and once #27a adds the
      `"present-but-unparsed"` Sources state, badge those rows distinctly (e.g. an amber pill) so a parse gap reads as a
      gap, not "no data."
  - ℹ️ Also (no NEW fix — consumer of **#27b**): the banner tile "**1 gates failed**" + the red `semgrep-sast` ledger row
    present an **advisory** (`allow_failure`) finding as a failure, with no advisory/enforcing distinction and none of the
    real hard gates shown. Once #27b adds an `enforcing` flag, thread it into the ledger + banner here so the headline
    can't be misread as deploy state.
  - ℹ️ Also (no fix — NOT a bug): the mojibake in a pasted copy of `index.html` (`GAIPS CI Metrics â …`, `Â·`, garbled
    emoji) is a **transport/paste artifact**. The renderer is correctly UTF-8 (source bytes verified `c2 b7` for `·`,
    `write_text(..., encoding="utf-8")` at `:264`, `<meta charset="utf-8">`). If the **live** Pages site is garbled,
    investigate GitLab Pages' served `Content-Type`/charset — not this script. (Documented in `PIPELINE_JOB_VALIDATION.md` #49.)

### Promoted from per-job blocks (session 4, 2026-06-18 — #39–#45 reviews; were doc-only, never in this registry)

> These six were substantive recommendations from the #39–#42 / #45 walkthrough that lived **only** in
> `PIPELINE_JOB_VALIDATION.md` per-job blocks, so the apply-the-fixes pass (which works off THIS list) would
> have silently missed them. All **OPEN**. Two cross-cutting roots are noted inline rather than given their own
> slots: **absolute paths** (#40-F4 + #41-F5 → one upstream fix in `model-digest` #17 / Fix #14: emit
> repo-relative paths) and **"signed ≠ verified"** (#41-F4 + #40-F1 → both trace to `signature-verification`
> #19 deferring on unprotected branches). NB: bare `#NN` = job number (validation doc); `Fix #NN` / the bold
> ordinal = this registry.
>
> **📋 Implementation plan:** code-grounded fix plan for all six (files, exact lines, change sketches,
> sequence, offline-vs-re-run split) → [`docs/gaips-materials/PIPELINE_FIX_PLAN_29-34.md`](docs/gaips-materials/PIPELINE_FIX_PLAN_29-34.md).

- [x] ✅ **APPLIED (s4): `build_ai_bom._vulnerabilities()` emits CycloneDX `vulnerabilities[]` from pip-audit
  (`markllm-deps-audit` + per-job `pip-audit-*`) / grype / trivy, deduped, with `affects[].ref` → component
  bom-refs (software comps now get stable bom-refs). `bom.counts.vulnerabilities` added. Fixture-verified.**
  🛑 **29. `ai-bom-assemble` #41 — AI-BOM emits NO `vulnerabilities[]` (#41-F2; Tier 2 — highest of the
  promoted set).** The BOM records 11 known vulns (2 RCE-class) only as **property counts** and emits no
  CycloneDX `vulnerabilities` array — so Dependency-Track ingests **nothing structured** and the policy gate
  has nothing to evaluate. **Fix:** emit a real CycloneDX `vulnerabilities[]` from the audit data already in
  the bundle (`markllm-deps-audit` #34 / `pip-audit` / grype / trivy), each entry with `id`, `source`,
  `ratings`, `affects`. (Higher real-world impact than several Tier-3/4 items above; pairs with **#34** — the
  array is unenforced until DT ingests it.) (Documented in `PIPELINE_JOB_VALIDATION.md` #41 F2.)
- [x] ✅ **APPLIED (s4): 30a — syft comps tagged `gaips:source=syft-sbom`; flat `bom.counts.software` split into
  `…software.pipeline` + `…software.markllm`. 30b — `markllm-results.json` folded into the modelCard
  (`quantitativeAnalysis.performanceMetrics` + `modelParameters`). Fixture-verified. ⚠️ 30a's pipeline closure is
  only as deep as syft #10 — see #35.** **30. `ai-bom-assemble` #41 — BOM content completeness (#41-F1 + #41-F6 / #42-F2; Tier 3).**
  - **30a — `software=97` conflates two disjoint dependency universes (#41-F1).** The flat count fuses the **3
    main-pipeline pins** with the **~94-pkg MarkLLM stack** into one number, misrepresenting the real closure.
    **Fix:** separate/scope/label the two component sets so the count reflects the actual deployed surface.
    **Depends on** fixing SBOM depth in `syft-cyclonedx` #10 (today shallow/top-level only — see #10's ⚠️).
  - **30b — hollow eval section / empty `modelCard` (#41-F6, #42-F2).** The eval block and
    `modelCard.modelParameters` are empty even though markllm genuinely ran. **Fix:** fold
    `markllm-results.json` + `modelParameters` into the assembly so the BOM carries the eval evidence it
    claims. (Documented in `PIPELINE_JOB_VALIDATION.md` #41 F1/F6, #42 F2.)
- [x] ✅ **APPLIED (s4, advisory): new `assert_ai_bom_content.py` + `ai-bom-content-gate` job (python:3.11-slim,
  `allow_failure:true`). Asserts audit-found-vulns ⇒ BOM `vulnerabilities[]` non-empty, and models signed
  (+verified WARN until #19). `--enforce` flips to a hard gate; teeth deferred per Fix #0/#23. Fixture-verified
  (advisory pass-with-warnings; `--enforce` fails on empty vulns[]).** **31. `ai-bom-validate` #42 — validates FORM, not SUBSTANCE (#42-F1; Tier 2).** "BOM validated" today
  means only **well-formed / schema-conformant**, so every #29/#30 content gap passes the gate cleanly. **Fix:**
  add **content assertions** — fail when an audit found vulns but the BOM's `vulnerabilities[]` is empty (ties
  to #29), and assert **signed + verified** (ties to #32) — **or** honestly relabel the gate
  "schema-conformance only" so it isn't read as a content guarantee. (Documented in
  `PIPELINE_JOB_VALIDATION.md` #42 F1.)
- [x] ✅ **APPLIED (s4): root abs-path fixed at `model-digest` L972 (repo-relative `${f#${CI_PROJECT_DIR}/}`) +
  defensive `relpath` in `build_ai_bom` & `sign-evidence` (clears #41-F5 + #40-F4). 32a — `sign-evidence` now
  `needs: signature-verification` and records `model.verified` + `verified_reason` from the #19 jsonl. 32b —
  `build_ai_bom` emits `gaips:model.verified` (+ `.reason`) beside `signed`. Both honestly report `false`/deferred
  until #19 runs on a protected ref. Fixture-verified.** **32. "signed ≠ verified" — notarization without verification (#40-F1 + #41-F4; Tier 2). Cross-cutting
  root: `signature-verification` #19 deferring on unprotected branches.**
  - **32a — `sign-evidence` #40 notarizes, doesn't verify (#40-F1).** It signs whatever digest `model-digest`
    #17 recorded; there is no bound verify step. **Fix:** bind it to a real `cosign verify-blob` (requires #19
    to NOT defer on this branch — Fix #4/#6 territory), **or** stamp `unverified:true` in the evidence bundle so
    a notarized-but-unverified digest is self-declaring.
  - **32b — `ai-bom-assemble` #41 signs without a verified marker (#41-F4).** **Fix:** add a
    `gaips:model.verified` property set from the actual verify result (false/absent until #19 verifies), so the
    BOM distinguishes "a signature exists" from "we checked it."
  - ℹ️ **Also under `sign-evidence` #40 — absolute path (#40-F4; Tier 5):** `recorded_digests` still carries an
    absolute `/builds/…` path. Root-caused to `model-digest` #17 emitting absolute paths (same root as #41-F5);
    **one upstream repo-relative fix in #17 (Fix #14) clears both** — track here, fix there. (Documented in
    `PIPELINE_JOB_VALIDATION.md` #40 F1/F4, #41 F4/F5.)
- [x] ✅ **APPLIED (s4, WARN-first): `write_ci_evidence_summary.py` now reads VERDICTS (3-state pass/fail/inert
  per artifact: semgrep ERROR-sev, markllm status, modelaudit critical, GX success, evidently drift
  (polarity-aware), DT violations). Summary table gains Verdict/Detail columns; required-missing still hard-fails;
  required-FAIL warns by default, `--enforce-verdicts` makes it block (teeth-last). Fixture-verified.** **33. `evidence-summary` #39 — PRESENCE-only gate (#39-F1, +F2/F3; Tier 2).** The `evidence` gate checks
  only that files **exist**, never their **verdicts** — so a bundle of failing/empty evidence passes green.
  **Fix:** make it **read the verdicts** (3-state: pass / fail / inert), failing closed on a real fail, **or**
  honestly relabel it a **bundle-completeness** check (not an evidence-validity gate); also address F2/F3
  (thin-set / 3-state handling). (Documented in `PIPELINE_JOB_VALIDATION.md` #39 F1–F3.)
- [~] 🟡 **INFRA-READY (s4), not wired: client code was already complete; added a turnkey
  `deployment/dependency-track/docker-compose.yml` + a step-by-step runbook
  (`deployment/dependency-track/README.md`); `DT_API_URL`/`DT_API_KEY`/`DT_FAIL_ON` already in CI-VARIABLES §4.
  REMAINING (user/env): stand up the instance, mint the API key, set the two CI vars, define a FAIL policy, and
  validate on the billable re-run. This is what gives #29 teeth.** **34. `dependency-track-upload` #45 — wire Dependency-Track (ENABLER, not a bug; Tier 1 enabler).** Not a
  defect in the job — it's the enabler that makes the pipeline's **best-built policy gate actually run**. With
  DT wired, the structured `vulnerabilities[]` from #29 gets ingested and the DT policy gate evaluates it.
  **Fix:** stand up / configure the DT endpoint + API key and confirm the upload + policy evaluation
  round-trips. (Pairs with **#29** — DT is inert without structured vulns; #29 is unenforced without DT.)
  (Documented in `PIPELINE_JOB_VALIDATION.md` #45.)

> After Fix #1 (+ #5/#16 to the clamav jobs), **re-run the pipeline** so the dataset chain populates, then
> resume the walkthrough at #30 to validate `great-expectations-validate` / `ydata-profile` / `dataset-sign`
> / `artifact-signing-gate` against real data.

---

# ACTIVE TASK (RESUME HERE) — Pipeline job validation walkthrough, document #29–#49

**Goal:** Walk through every job and, for each: (1) validate it performs real work (not exit-0 theater),
(2) document it. Findings #1–#28 are written; **resume at #29 and go through #49.**

**Evidence source has shifted:** #1–#28 were validated against the original `main` run `6a48e525`. The
fixes changed behaviour, so #29+ should be documented against the **post-fix branch run**
(`gaips-pipeline-required-fixes`, HEAD `ff9bd7e` once pushed) where the dataset chain actually executes —
EXCEPT the protected-var signing jobs (#19 signature-verification et al.), which only produce real evidence
on a `main`/protected-branch run (see POST-PUSH FIX LOG #2 at the top).

**⚠️ Line numbers in `.gitlab-ci.yml` have SHIFTED** from all the fixes — the old `(1730)`-style refs below
are stale. `grep -n '^<job-name>:' .gitlab-ci.yml` to relocate a job before reading it.

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

**Progress: 28 / ~49 documented; fixes done; RESUME DOCUMENTING at #29.** `sast`+`sbom`+`vuln-scan`
COMPLETE. Stage order: setup·sast·sbom·vuln-scan·**model-integrity(20)**·ai-eval·guardrail·evidence·ai-bom·
deploy-prep. **Resume at #29 `eval-dataset-validate`** (REVISE — now runs+passes, was a broken-chain skip),
then #30 `great-expectations-validate`, #31 `ydata-profile`, #32 `dataset-sign`, #33 `artifact-signing-gate`
(close out `model-integrity`), then the `ai-eval`·`guardrail`·`evidence`·`ai-bom`·`deploy-prep` stages
(#34–#49). The dataset chain now executes, so #29–#33 have REAL evidence (no longer the empty-data skips).
See the "RESUME HERE" section at the top of this file for the per-job pointers and the protected-branch
caveat.

**⚠️ DRIFT GUARD — do NOT re-review #1–#28** (write #29 onward). EXCEPTIONS to revise against the post-fix
run: **#29 `eval-dataset-validate`** (now runs+passes vs the old cascade-skip), and the fixed jobs whose
prior findings are now stale — **#9 conda-pkg-verify** (now real conda-forge isolation), **#19
signature-verification** (now explainable + protection-aware; defers on branch), **#22 modelaudit-scan**
(gate fixed + enforcing), **#28 dataset-redact** (now executes, was the broken chain). Each reviewed job has
a `## ` heading in `PIPELINE_JOB_VALIDATION.md`. **`grep '^## ' docs/gaips-materials/PIPELINE_JOB_VALIDATION.md`
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
