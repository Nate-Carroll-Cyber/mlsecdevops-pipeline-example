# Implementation Fix Plan — Registry #29–#34 (session 4, 2026-06-18)

> **✅ IMPLEMENTED (session 4, 2026-06-18, UNPUSHED).** All six were applied and fixture-validated offline:
> #29 `vulnerabilities[]`, #30a/b counts+modelCard, #31 advisory content gate, #32 abs-path root + verified
> state, #33 verdict-aware evidence gate — all code-applied; **#34** is infra-ready (compose + runbook added)
> pending a DT instance + the billable re-run. Teeth on #31/#33 deferred (advisory) per Fix #0/#23. The plan
> below is preserved as the design record; see [`SESSION_HANDOFF.md`](../../SESSION_HANDOFF.md) STATUS for the
> authoritative applied state and the per-fix `✅ APPLIED` tags in its REQUIRED FIXES list.

Concrete, code-grounded plan for the six fixes promoted from per-job blocks into the numbered registry in
[`SESSION_HANDOFF.md`](../../SESSION_HANDOFF.md). Each was validated against the actual scripts / YAML below,
not the audit prose. **Bare `#NN` = job number** (validation doc); **`Fix #NN` / bold ordinal = registry item.**

> **Posture (unchanged from Fix #0/#23):** land COVERAGE first, keep `allow_failure` / advisory until the
> pipeline is otherwise green, then drop the soft flags for TEETH. Don't paint the pipeline red while broken
> chains still exist.

---

## 0. Sequence & dependency map

```
#17 abs-path one-liner ──┬─► clears #41-F5 (build_ai_bom paths)  ─┐
 (model-digest YAML)     └─► clears #40-F4 (sign-evidence digests)│
                                                                  │
#29 vulnerabilities[] ──► #31 content-gate asserts it ──► #34 DT ingests + gates on it
 (build_ai_bom.py)         (new python step)               (infra only)
                                                                  ▲
#30a counts split  ┐                                              │ enforcement of #29
#30b modelCard/eval├─ all in build_ai_bom.py (one PR)             │ lands only once DT wired
#32b model.verified┘                                              │
                                                                  │
#32a sign-evidence verified-state ──► full verify needs #19 (protected branch); record `unverified` now
#33 evidence-summary verdicts ──► standalone (write_ci_evidence_summary.py)
```

| Fix | File(s) | Type | Can land NOW (offline, fixture-tested)? | Blocked on |
|-----|---------|------|------|------|
| **#29** vulnerabilities[] | `build_ai_bom.py` | code | ✅ | — (enforcement needs #34) |
| **#30a** counts split | `build_ai_bom.py` | code | ✅ (labels/counts); real closure needs **#35** SBOM depth | #35 (syft #10) for accuracy |
| **#30b** modelCard/eval | `build_ai_bom.py` | code | ✅ | — |
| **#31** content gate | new `assert_ai_bom_content.py` + YAML job | code | ✅ | consumes #29 output |
| **#32a** sign-evidence verify | `sign-evidence` YAML | code | ⚠️ partial (record `unverified`); full verify needs #19 | #19 (protected branch) |
| **#32b** model.verified prop | `build_ai_bom.py` | code | ⚠️ partial (false/unknown until #19) | #19 |
| **#32 root** abs-path | `model-digest` YAML L972 | code | ✅ (one line) | — |
| **#33** evidence verdicts | `write_ci_evidence_summary.py` | code | ✅ | teeth deferred (hard gate) |
| **#34** wire DT | infra + CI vars | infra | ❌ needs a DT instance + re-run | environment |

**Recommended order:** (1) #17 abs-path one-liner → (2) build_ai_bom PR = #29 + #30a + #30b + #32b together →
(3) #31 content gate → (4) #33 verdicts → (5) #32a sign-evidence → (6) #34 DT infra (last; enables #29/#31 teeth).
Items 1–4 are offline + fixture-testable in this branch with no billable re-run.

---

## #29 — AI-BOM emits a real CycloneDX `vulnerabilities[]`  ·  `build_ai_bom.py`  · Tier 2 (highest)

**Current:** the BOM has **no `vulnerabilities` array**. Vuln signal exists only as scalar properties —
`vulns.count` on watermark components ([`build_ai_bom.py:161`](scripts/build_ai_bom.py#L161)),
`modelscan.*` / `modelaudit.*` on models (L202–205). `markllm-deps-audit.json` already carries
`dependencies[].vulns[]` and is read for the count at L159. DT (and any auditor) gets nothing structured.

**Change:**
1. Add `_vulnerabilities(reports_dir, components) -> list[dict]` that harvests from the bundle's existing
   vuln sources, in priority order:
   - `markllm-deps-audit.json` → `dependencies[].vulns[]` (id, fix_versions already present).
   - `pip-audit-cyclonedx.json` (already referenced L120) + the Fix #0 per-job `pip-audit-<job>.json` env reports.
   - `grype-scan` / `trivy-scan` JSON in `reports_dir` (map their native severity → CycloneDX `ratings`).
2. Emit CycloneDX 1.6 vulnerability objects:
   ```json
   {"bom-ref":"vuln:<id>:<purl>","id":"CVE-…","source":{"name":"osv|grype|trivy"},
    "ratings":[{"severity":"critical|high|…"}],"affects":[{"ref":"<component bom-ref>"}],
    "description":"…","recommendation":"upgrade to <fix_versions>"}
   ```
3. **Prerequisite:** give software components a stable `bom-ref` so `affects[].ref` can target them. In
   `_software_components` / `_watermark_stack_components`, set `c["bom-ref"] = c.get("purl") or f"lib:{name}"`.
   Dedup vulns by `(id, purl)`.
4. Attach `bom["vulnerabilities"] = _vulnerabilities(...)` in `build_bom` (after `components`), and add
   `_prop("bom.counts.vulnerabilities", len(vulns))` to metadata (L491–493) + the stdout summary (L526–529).

**Validation:** fixture run with a `markllm-deps-audit.json` holding the 2 known RCE-class vulns → assert
`vulnerabilities[]` length ≥ 2, each with a resolvable `affects[].ref`, then `cyclonedx validate --fail-on-errors`
(schema still passes). **Risk:** low — additive; CycloneDX 1.6 `vulnerabilities` is optional + well-specified.

---

## #30 — BOM content completeness  ·  `build_ai_bom.py`  · Tier 3

### 30a — stop fusing two dependency universes
**Current:** `software = syft components + watermark-stack components` (L452–453), reported as one flat
`bom.counts.software` (L493). Watermark comps already carry `gaips:source=markllm-deps-audit` (L158); syft
comps carry no source label.
**Change:** in `_software_components`, tag each lifted component `_prop("source","syft-sbom")` (or
`main-pipeline`). Replace the single count with a breakdown in metadata: `bom.counts.software.pipeline` +
`bom.counts.software.markllm` (keep `bom.counts.software` as the total for back-compat). 
**Depends on #35** (syft `syft-cyclonedx` #10 SBOM depth) for the *pipeline* side to reflect the real transitive
closure — the label/count split is independent and lands now; the accuracy of the pipeline count follows #35.

### 30b — populate the hollow `modelCard` + fold the real eval
**Current:** `model_card` is hardcoded with empty `modelParameters: {}` / `quantitativeAnalysis: {}`
([`build_ai_bom.py:210-219`](scripts/build_ai_bom.py#L210-L219)); only HF metadata ever fills `task`.
`markllm-results.json` is **never read** (not in `EVAL_REPORTS`, L325–332).
**Change:** add a `_markllm_card(reports_dir)` reader for `markllm-results.json` (schema per #27a:
`status`, `metrics:{prompt_count,detections_completed}`, `model_id`, `device`, `prompts`). Fold into the
matching model component's `quantitativeAnalysis.performanceMetrics` (detections/prompt counts, watermark
detect rate) and `modelParameters` (model_id/device/task). Map by `model_id` ↔ digest path, mirroring the
existing HF fold loop (L221–228).
**Validation:** fixture `markllm-results.json` → assert the model component's `quantitativeAnalysis` is
non-empty and schema-valid.

---

## #31 — `ai-bom-validate` checks SUBSTANCE, not just FORM  ·  new step  · Tier 2

**Current:** [`ai-bom-validate`](../../.gitlab-ci.yml#L2794) runs `/cyclonedx validate --fail-on-errors`
(schema-conformance only) in the **.NET cyclonedx-cli image, which has no Python** (L2803). Every #29/#30
content gap is schema-valid, so it passes green.
**Change (recommended):** add a small **`assert_ai_bom_content.py`** run in a `python:3.11-slim` step — either a
new job `ai-bom-content-gate` (`needs: ["ai-bom-assemble"]`, same stage) or appended to `ai-bom-assemble` as a
post-build self-check (it already holds the source data). Assertions:
- **fail** when the audit reports recorded vulns (Σ `markllm-deps-audit` + `pip-audit` findings > 0) but
  `aibom.vulnerabilities[]` is empty — directly enforces #29.
- **assert** every `machine-learning-model` component has `gaips:signed=true` **and** `gaips:model.verified=true`
  (ties to #32); downgrade `verified` to WARN while #19 defers.
- else **relabel** the existing gate's log line "schema-conformance only" so green isn't misread.
**Posture:** ship as advisory (`allow_failure: true`) until #29 + #34 land, then drop the flag for teeth.

---

## #32 — "signed ≠ verified" + absolute paths  · Tier 2

### Root one-liner first — abs-path (#40-F4 + #41-F5)  ·  `model-digest` YAML
**Current:** [`model-digest:972`](../../.gitlab-ci.yml#L972) echoes `"${f}  sha256:…"` where `$f` is the
absolute `find` path under `${MODEL_DIR}`. That string flows verbatim into (a) `build_ai_bom` `artifact.path`
+ `bom-ref:model:<path>` (L201/L232) and (b) `sign-evidence` `model.recorded_digests[].path`
([`.gitlab-ci.yml:2659`](../../.gitlab-ci.yml#L2659)).
**Change (one line):** relativize before writing — `rel="${f#${CI_PROJECT_DIR}/}"` (or
`realpath --relative-to="${CI_PROJECT_DIR}" "$f"`), echo `${rel}`. Clears **both** findings at the source. Add
a defensive `os.path.relpath` in `build_ai_bom` as belt-and-suspenders (the dataset path already does this,
L257–262).

### 32a — `sign-evidence` notarizes the recorded digest, never re-verifies (#40-F1)
**Current:** the job self-verifies its OWN signature (L2717–2726 ✅) but `model.recorded_digests` is trusted
from #17 and only compared to one `approved_sha256` baseline (`digest_match`, L2660–2664). No re-hash / no
signature verification of the model bytes; #19 defers on unprotected branches.
**Change:** add `model["verified"]` to the bundle (L2660 area), sourced from the
`signature-verification` (#19) verdict artifact if present; when #19 deferred, set
`{"verified": false, "unverified_reason": "signature-verification deferred (unprotected ref)"}` so the bundle
is **self-declaring** rather than implying assurance. (Full binding = run `cosign verify-blob` over each
model + `model.sig` here, which only succeeds once #19 runs on a protected branch.)

### 32b — BOM `gaips:model.verified` property (#41-F4)  ·  `build_ai_bom.py`
**Current:** L207 emits only `gaips:signed` (= "a signature file exists"). 
**Change:** add `_prop("model.verified", <value>)` next to it, sourced from the same #19 verdict (false/unknown
until #19 verifies). Distinguishes "a signature exists" from "we checked it."

---

## #33 — `evidence-summary` reads VERDICTS, not just presence  ·  `write_ci_evidence_summary.py`  · Tier 2

**Current:** [`write_ci_evidence_summary.py`](scripts/write_ci_evidence_summary.py) only checks `.exists()`
and `raise SystemExit(1)` solely when a **required file is missing** — a bundle of failing/empty evidence
passes green. It's a `NO-allow_failure` (hard) gate, so changes here have immediate teeth.
**Change:** for each present artifact, read its verdict and classify pass / fail / inert (3-state):
- `semgrep.json` → error-severity count; `markllm-results.json` → `status == "failed"`;
  `modelaudit-summary.json` → `critical > 0`; `great-expectations.json` → `success == false`;
  `evidently-drift.json` → `drift_detected` (polarity-aware, per #28); `dependency-track.json` →
  `failing_violations` non-empty.
- Gate (`exit 1`) on **required** (`EXPECTED`) failures only; **advisory** (`ADVISORY`) failures → `WARNING:`
  line, no fail (matches the existing required/advisory split, L6–24).
- **Or** the honest-minimum: rename the gate "bundle-completeness check" so green isn't read as
  "evidence is valid."
**Posture:** given the hard gate, ship verdict-reading as WARN-only first; flip required failures to `exit 1`
once the pipeline is green (teeth-last). Also covers F2/F3 (thin required set / 3-state).

---

## #34 — Wire Dependency-Track  ·  infra only  · Tier 1 enabler

**Not code.** [`dependency_track_upload.py`](scripts/dependency_track_upload.py) is a complete client (upload →
poll → findings → violations → policy gate) that **skips clean (`exit 0`) when `DT_API_URL`/`DT_API_KEY` are
unset** (L150–153). Tasks:
1. Stand up a Dependency-Track instance (apiserver + frontend) reachable from the CI runners.
2. Create an API key with permissions: `BOM_UPLOAD`, `PROJECT_CREATION_UPLOAD`, `VIEW_VULNERABILITY`,
   `VIEW_POLICY_VIOLATION`.
3. Set masked+protected CI vars `DT_API_URL` + `DT_API_KEY`.
4. Define DT **policies** with `violationState = FAIL` for the conditions you want blocking (severity
   threshold, license, outdated-component) — this is what gates the model/data components that don't get CVE
   matches.
5. Confirm the nested AI-BOM project hierarchy renders (parentName/version wiring, L57–59 / L176–179).
6. **Billable re-run** to validate the upload + gate round-trip end-to-end.

**Pairing:** DT does its own CVE matching on software purls, so it adds value before #29 — but #29's
`vulnerabilities[]` is what makes the AI-BOM's own vuln record enforceable, and the DT policy gate is what
gives #29 teeth. Land #29 first, then #34 enforces it.

---

## Validation strategy (offline, no billable re-run for #29–#33 code)

- **Fixtures:** the repo already ships `fixtures/` — add minimal `markllm-deps-audit.json` (with the 2
  RCE-class vulns), `markllm-results.json`, and a small `model-digests.txt` (relative paths).
- **Per-fix unit check:** run `build_ai_bom.py` against the fixtures → assert (#29) `vulnerabilities[]` ≥ 2 +
  resolvable `affects`, (#30a) split counts present + source labels, (#30b) non-empty `quantitativeAnalysis`,
  (#32b) `model.verified` present.
- **Schema gate:** pipe the fixture BOM through `cyclonedx validate --fail-on-errors` (v1_6) — every change
  must stay schema-valid.
- **#33:** run `write_ci_evidence_summary.py` against a fixtures dir with a deliberately-failing
  `semgrep.json` / `modelaudit-summary.json` → assert WARN now, `exit 1` once teeth enabled.
- **#31:** run `assert_ai_bom_content.py` against a BOM with empty `vulnerabilities[]` but a non-empty audit →
  assert it fails.

**Then** one billable re-run (the same one already pending for deferred legs #30/#31/#32 + this session's
default-branch-only edits) validates #34 + #32a's full verify path on a protected branch.

---

## Out of scope / surfaces as it lands

- **#35 (untracked):** syft `syft-cyclonedx` #10 SBOM depth (transitive closure). #30a's *pipeline* count is
  only as honest as #10 is deep — promote #35 if you want #30a fully closed.
- **#19 dependency:** #32a/#32b can only report `verified=true` once `signature-verification` runs on a
  protected branch (today it defers). Until then they record `verified=false` + reason — which is itself the
  correct, honest state.
