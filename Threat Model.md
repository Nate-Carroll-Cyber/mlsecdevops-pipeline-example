# Threat Model Assessment

## 1. Understanding Confirmed

MAESTRO v2.0 threat model of `Nate-Carroll-Cyber/mlsecdevops-pipeline-example` — a GitLab CI/CD security pipeline for ML model and dataset supply-chain assurance, producing signed artifacts, SBOMs, AI-BOMs, vulnerability reports, and deploy-time verification materials.

## 2. Scope and Assumptions

**Scope:** The pipeline system as documented in the README, `.gitlab-ci.yml`, deployment manifests, and scripts. The system under assessment is the pipeline itself (the control plane), not the downstream ML application it protects.

**Assumptions:**
- This is a **demo/portfolio piece**, not a production deployment. The README's "Validation Status & Known Gaps" section is treated as authoritative evidence of what has and hasn't executed.
- Deployment model: The pipeline is **infrastructure** (AaI) — the owner controls the full CI/CD stack, consumes models from Hugging Face (MP), uses GitLab as CSP/OSP, and targets Kubernetes with Kyverno/ArgoCD for deploy-time verification.
- The pipeline is **not agentic**. There is no autonomous agent, no tool-using LLM, no orchestration loop, no sub-agents. MAESTRO is partially over-scoped for a CI/CD pipeline, but layers L1 (infra), L2 (model handling), L3 (data handling), L5 (deployment), L6 (tool ecosystem), L7 (identity/signing), L8 (safety), L9 (monitoring), and L10 (governance) all have evidenced components.

**Key framing:** This pipeline is itself a security control system. The threat model therefore asks: *what could compromise the controls*, not *what could the controls catch*. A threat model of the watchtower, not the fortress.

## 3. System Summary

An 11-stage GitLab CI/CD pipeline (`setup` → `sast` → `sbom` → `vuln-scan` → `model-integrity` → `ai-eval` → `guardrail` → `evidence` → `ai-bom` → `deploy-prep` → `attest`) that produces supply-chain assurance evidence for an ML system. The pipeline handles a Qwen 1.5B GGUF model fixture, a Lakera Gandalf prompt-injection eval dataset, and generates signed CycloneDX 1.6 AI-BOMs. It uses Sigstore/Cosign keyless signing, optional HashiCorp Vault for secrets, and targets Kubernetes with Kyverno admission policy and ArgoCD PreSync verification hooks.

The system is **not agentic** — no LLM takes autonomous action. The MarkLLM watermark eval performs local in-process inference on CPU but does not constitute an agent. MAESTRO is applied here to the pipeline's own attack surface: its identity model, supply chain, data handling, deployment artifacts, and governance posture.

## 4. Evidence Available

- README.md (comprehensive — ~4,000 words of pipeline walkthrough, artifact maps, validation status, control alignment)
- Repository file tree (all directories and key files listed)
- Validation Status & Known Gaps section (explicit honest accounting of validated vs. unvalidated controls)
- Control Alignment section (explicit mapping to CSA AICM, NIST, ISO 42001)
- Deployment manifests referenced (Kyverno, ArgoCD, Vault/Terraform)
- `.gitleaks.toml`, `requirements.txt`, `requirements.hashed.txt` (evidenced)

**Not directly inspected** (GitHub fetch limitations): `.gitlab-ci.yml` source, individual Python scripts, deployment YAML files, eval datasets. Assessment is based on the README's detailed descriptions of these artifacts.

## 5. Immediate Gaps / Missing Information

- **`.gitlab-ci.yml` source code** not directly inspected — all pipeline behavior is inferred from README descriptions (which are exceptionally detailed but are documentation, not the artifact itself)
- **Deploy-time verification is unvalidated** — the README explicitly states Kyverno, ArgoCD PreSync, Vault, and `image-sign` have never executed
- **`secure-software-scan` is pending first protected-main run** — the ReversingLabs malware gate has not proven it works
- **No runtime/inference-time security** — explicitly out of scope per the README ("no dynamic adversarial testing, guardrail scanning, or prompt-injection / input-output validation")
- **The standalone repo has not yet run CI on the new project** — the first run is pending post-migration

## 6. MAESTRO Layer Mapping

| Layer | Domain | Evidenced Components | Status |
| --- | --- | --- | --- |
| **L1 — Infrastructure** | 1 | GitLab CI runners; digest-pinned container images for tools (Syft, Grype, Trivy, Semgrep, ClamAV); `image-provenance-verify` cosign checks on tool images | Evidenced |
| **L2 — Cognitive Core** | 1 | Qwen 2.5-1.5B-Instruct GGUF fixture (SHA-256 pinned); MarkLLM local inference for watermark eval; model baseline manifest (`model-baseline.json`) | Evidenced |
| **L3 — Data, Memory, Knowledge** | 1 | Lakera Gandalf eval dataset (SHA-256 pinned); dataset-baseline.json (provenance, license, integrity pin); dataset redaction pipeline (Gitleaks + Presidio); eval-dataset schema validation; Evidently drift detection | Evidenced |
| **L4 — Orchestration** | 2 | No agentic orchestration. GitLab DAG pipeline sequencing with `needs:` dependencies and `artifact-signing-gate` convergence point | Minimally applicable |
| **L5 — Deployment** | 2 | Kubernetes manifests; Kyverno ClusterPolicy; ArgoCD PreSync hook; `image-sign` (Cosign keyless); `publish-signed-artifacts` to GitLab Package Registry; Vault Terraform IaC | Evidenced (unvalidated) |
| **L6 — Tools, Ecosystem** | 2 | 53 CI jobs; external tool integrations (Semgrep, Gitleaks, pip-audit, Syft, Grype, Trivy, ModelScan, ModelAudit, ClamAV, ReversingLabs Spectra Assure, MarkLLM, Evidently, Great Expectations, YData, Cosign, model-signing); Hugging Face Hub integration | Evidenced |
| **L7 — Identity & Autonomy** | 3 (H) | Sigstore/Cosign keyless signing (4 distinct artifacts: model, dataset, AI-BOM, image); GitLab OIDC `SIGSTORE_ID_TOKEN`; Vault OIDC JWT auth; `MODEL_SIGNING_IDENTITY` + `SIGSTORE_OIDC_ISSUER` verification; `sigstore-identity-discover` probe job | Evidenced |
| **L8 — Safety & Security** | 3 (H) | Multi-layer scanning (SAST, secret detection, vulnerability, malware, model integrity, dataset integrity); `artifact-signing-gate` hard gate; tamper verification with Vault-backed baseline; PII/secret redaction; `allow_failure` teeth-last enforcement model | Evidenced |
| **L9 — Monitoring & Observability** | 3 (H) | Evidence-summary with 3-state verdict extraction; `sign-evidence` whole-run hash manifest; `metrics-normalize` operational metrics; GitLab Pages dashboard; Evidently drift monitoring | Evidenced |
| **L10 — Governance & Compliance** | 3 (H) | Control alignment mapping (CSA AICM, NIST 800-53, ISO 42001, NIST AI RMF); CycloneDX 1.6 AI-BOM with `vulnerabilities[]` array; Validation Status & Known Gaps (explicit honest gap accounting); Apache-2.0 license; `ai-bom-content-gate` substance assertions | Evidenced |

## 7. Assessment Status by Layer

| Layer | Status |
| --- | --- |
| L1 — Infrastructure | Assessable. Tool images digest-pinned; provenance verification partially proven. |
| L2 — Cognitive Core | Assessable. Model fixture SHA-256 pinned; signing proven; watermark eval advisory. |
| L3 — Data, Memory, Knowledge | Assessable. Dataset integrity chain evidenced; drift detection vacuous on current fixture. |
| L4 — Orchestration | Minimally applicable. Not agentic; pipeline DAG is deterministic. |
| L5 — Deployment | Partially assessable. Manifests exist; deploy-time verification never executed. |
| L6 — Tools/Ecosystem | Assessable. Large tool surface with known coverage gaps (GGUF in ModelScan). |
| L7 — Identity | Assessable. Signing architecture well-designed; verification pending protected-main run. |
| L8 — Safety | Assessable. Comprehensive scanning; teeth-last enforcement model creates a known gap window. |
| L9 — Monitoring | Assessable. Evidence collection is strong; continuous monitoring is point-in-time only. |
| L10 — Governance | Assessable. Explicit gap accounting is a governance strength; no formal risk classification. |

## 8. Detailed Threat Analysis

---

### L1-T01 — Infrastructure Compromise via Supply Chain Attack (CI Tool Images)

**MAESTRO Layer:** L1: Infrastructure (Domain 1)

**Current Evidence:**
- CI tool images are digest-pinned (e.g., `python:3.11-slim@sha256:...`)
- `image-provenance-verify` cosign-verifies images that carry keyless signatures (currently only Trivy proven)
- Other tool images (Syft, Grype, Semgrep, ClamAV) are logged as "digest-pinned-only" after referrers-API probe found no signature
- `IMAGE_VERIFY_REQUIRE` is blank (report-only) by default

**Reasonable Inferences:**
- Digest pinning prevents tag-mutation attacks but does not verify publisher identity
- A compromised tool image (e.g., a malicious Grype binary) would produce false-clean scan results, undermining every downstream control that depends on it

**Assessment Status:** Answerable

**Attack Vector:** An attacker publishes a malicious image with a valid digest. Since most tool images are "digest-pinned-only" (no signature verification), the pipeline would pull and execute the compromised image if the digest were updated in `.gitlab-ci.yml`. The attack requires write access to the pipeline definition or a compromise of the image registry.

**Cross-Layer Impact:** L6 (all scanning tools run inside these images), L8 (compromised scanners produce false negatives), L9 (evidence integrity depends on scanner integrity)

**Likelihood / Impact / Risk:**
- Likelihood: Low — requires pipeline-definition write access or registry compromise, and digest pinning must be defeated
- Impact: Critical — a compromised scanner silently passes malicious artifacts through every downstream gate
- Risk: **Medium**

**Recommended Mitigations:**
- Set `IMAGE_VERIFY_REQUIRE=true` once keyless signatures are available for all tool images
- For images without keyless signatures, verify against known-good digests from a second source (e.g., compare against the upstream project's published digests)
- Consider running critical scanners redundantly from different images/vendors

**SSRM Ownership:**
- Primary: AIC (digest pin maintenance, image selection)
- Shared: CSP (GitLab runner image pull integrity), Tool Provider (image publishers)
- Agent Owner accountable: yes

---

### L2-T04 — Model Supply-Chain Attack (Fixture Download)

**MAESTRO Layer:** L2: Cognitive Core (Domain 1)

**Current Evidence:**
- Model fixture downloaded from Hugging Face (`Qwen/Qwen2.5-1.5B-Instruct-GGUF`)
- SHA-256 checksum verified via `sha256sum --check --strict` against `MODEL_FIXTURE_SHA256`
- Model baseline defined in `evals/model-baseline.json` (approved source of truth)
- `model-manifest` job validates baseline consistency and emits dotenv
- ModelScan excludes `.gguf` (scans 0 files on the shipped model)
- ModelAudit and ClamAV cover GGUF

**Reasonable Inferences:**
- The SHA-256 pin is the primary integrity control for the model fixture; if the pin is correct, the downloaded bytes are correct
- ModelScan's GGUF exclusion is a known coverage gap explicitly documented in the README

**Unknowns / Missing Evidence:**
- Whether the SHA-256 value in `model-baseline.json` was verified against a second source when first committed
- Whether the Hugging Face download uses TLS certificate pinning or just standard HTTPS

**Assessment Status:** Answerable

**Attack Vector:** The primary risk is a TOCTOU gap: the SHA-256 pin was set at some point in the past. If the original Hugging Face artifact were compromised *before* the pin was established (or if the pin itself were committed by a compromised contributor), all subsequent runs would verify against a malicious baseline. Once the pin is established and correct, the integrity chain holds.

**Cross-Layer Impact:** L8 (ModelScan gap on GGUF means only ModelAudit + ClamAV catch serialization attacks), L7 (model signing signs whatever was downloaded — a poisoned model gets a valid signature)

**Likelihood / Impact / Risk:**
- Likelihood: Low — requires pre-pin compromise or baseline-file tampering
- Impact: High — a poisoned model passes all integrity checks and receives a valid Cosign signature
- Risk: **Medium**

**Recommended Mitigations:**
- Document the provenance of the initial SHA-256 pin (how was it first verified?)
- Consider a secondary integrity check (e.g., verify against Hugging Face's `refs/` API for the commit SHA)
- Monitor ModelScan for GGUF support; when available, remove the exclusion
- The existing ModelAudit + ClamAV coverage is a reasonable compensating control

**SSRM Ownership:**
- Primary: AIC (baseline establishment, pin verification)
- Shared: MP (Hugging Face artifact integrity)
- Agent Owner accountable: yes

---

### L3-T01 — Dataset Poisoning (Eval Dataset Integrity)

**MAESTRO Layer:** L3: Data, Memory, and Knowledge (Domain 1)

**Current Evidence:**
- Dataset SHA-256 pinned via `DATASET_EXPECTED_SHA256`
- Dataset chain: download → ClamAV scan → Gitleaks + Presidio redaction → schema validation → Cosign signing
- `dataset-baseline.json` records provenance (HF source, revision, license, citation)
- Redaction is fail-closed (`allow_failure: false`) with configurable thresholds (`REDACT_MAX_SECRETS`, `REDACT_MAX_PII`)
- **However:** `REDACT_MAX_SECRETS` defaults to `-1` (disabled) in the script itself; the CI job explicitly sets `"0"` — if reused outside CI, secrets pass silently
- Presidio import failure degrades **open** (PII left unredacted with only a warning)

**Assessment Status:** Answerable

**Attack Vector:**
1. **Script reuse without CI variable context:** The `redact_dataset.py` script's own default is `-1` (disabled) for secret thresholds. If someone reuses the script outside the CI pipeline without setting `REDACT_MAX_SECRETS=0`, secrets in the dataset pass through without blocking. This is documented but is a footgun.
2. **Presidio degradation:** If `presidio-analyzer` fails to import, PII redaction degrades open — the dataset proceeds with PII intact. A dependency conflict or version incompatibility silently disables PII protection.

**Cross-Layer Impact:** L2 (poisoned eval data produces misleading evaluation results), L8 (PII in eval data is a data-protection failure), L10 (compliance gap if PII reaches the signed AI-BOM)

**Likelihood / Impact / Risk:**
- Likelihood: Medium — the script-default footgun is documented but relies on users reading the docs; Presidio import failures are plausible with Python dependency churn
- Impact: Medium — affects eval integrity and PII exposure, not production model behavior (this is an eval dataset, not training data)
- Risk: **Medium**

**Recommended Mitigations:**
- Change the script default for `REDACT_MAX_SECRETS` from `-1` to `0` (fail-closed by default, not just when the CI variable is set)
- Fail closed on Presidio import failure rather than degrading open — or at minimum, mark the dataset as "PII-unredacted" in the signed evidence
- The existing SHA-256 pin and Cosign signing are strong integrity controls for the committed fixture

**SSRM Ownership:**
- Primary: AIC
- Agent Owner accountable: yes

---

### L5-T06 — Deployment Rollback Exploitation (Unvalidated Deploy-Time Controls)

**MAESTRO Layer:** L5: Deployment and Execution (Domain 2)

**Current Evidence:**
- Kyverno ClusterPolicy, ArgoCD PreSync hook, and Vault integration are **wired but never executed**
- The README explicitly states: "CI success alone does not prove the cluster enforced anything"
- Deployment manifests carry example identities (`ghcr.io/example/*`, `ci-signer@example.invalid`)
- `image-sign` is inert (`IMAGE_REF` unset → skips; the pipeline builds no container image)
- Vault auth/fetch path is unvalidated (`VAULT_ADDR` unset → CI-vars fallback)

**Assessment Status:** Answerable

**Attack Vector:** The pipeline produces signed artifacts and publishes them to the GitLab Package Registry. But the consumers of those signatures (Kyverno admission, ArgoCD PreSync) have never verified anything. An attacker who deploys an unsigned or tampered artifact to the target cluster would not be stopped — the verification infrastructure exists as YAML but has never executed. The example identities in the manifests would need to be replaced with real values before they could work.

**Cross-Layer Impact:** L7 (signing identity chain is untested end-to-end), L8 (the deploy-time safety net is theoretical), L10 (the control alignment section maps to these controls, but they're unvalidated)

**Likelihood / Impact / Risk:**
- Likelihood: High — the deploy-time controls are definitionally non-functional without infrastructure
- Impact: N/A in current context (demo repo, no production cluster) — but **Critical** if these manifests were deployed as-is to a real cluster (example identities would either fail open or need manual replacement)
- Risk: **Low** (demo context) / **Critical** (if deployed without modification)

**Recommended Mitigations:**
- The README's honest gap accounting is itself the right mitigation for a demo — it prevents false claims
- For production: validate the full sign→verify loop end-to-end before claiming deploy-time integrity
- Replace example identities with real values and test Kyverno in `Enforce` mode
- Validate the Vault auth path independently

**SSRM Ownership:**
- Primary: AIC (deployment infrastructure, identity configuration)
- Shared: CSP (Kubernetes, Kyverno)
- Agent Owner accountable: yes

---

### L6-T03 — Business Logic Abuse (Teeth-Last Enforcement Model)

**MAESTRO Layer:** L6: Tools, Application, Environment, and Ecosystem (Domain 2)

**Current Evidence:**
- 29 of 46 jobs that declare `allow_failure` are `true` (advisory) out of 53 total jobs
- Most gates report rather than block, by explicit "teeth-last" design
- Enforcement switches exist (`RL_FAIL_ON`, `IMAGE_VERIFY_REQUIRE`, `LOCK_DRIFT_REQUIRE`, `--enforce`) but are blank/disabled by default
- The README frames this as intentional: controls start advisory and are hardened incrementally

**Reasonable Inferences:**
- The teeth-last model is a deliberate design choice for iterative hardening, not an oversight
- However, in the current state, a pipeline run can succeed (green) while carrying known vulnerabilities, unsigned images, drifted dependencies, and unverified tool provenance

**Assessment Status:** Answerable

**Attack Vector:** This is not a traditional exploitation — it's a **control-gap window**. An attacker (or an honest mistake) can merge code that triggers advisory-only findings without blocking the pipeline. The signed AI-BOM and evidence summary will record the findings, but the pipeline exits green. If downstream consumers treat "green pipeline" as "all controls passed," the teeth-last posture creates a false-assurance gap.

**Cross-Layer Impact:** L8 (safety controls don't block), L9 (evidence records the gap but doesn't prevent it), L10 (control alignment claims must be qualified by enforcement state)

**Likelihood / Impact / Risk:**
- Likelihood: High — this is the current default state
- Impact: Medium — mitigated by the AI-BOM and evidence summary recording findings; the gap is between "evidence exists" and "evidence blocks release"
- Risk: **Medium**

**Recommended Mitigations:**
- The `ai-bom-content-gate` with `--enforce` is the right mechanism — enable it
- Document which enforcement switches must be flipped for each control to be "active" vs. "enforced" (the README partially does this already)
- Consider a "control-enforcement-state" summary in the evidence output that explicitly states which gates are advisory vs. blocking for each run
- The README's "control-state model" paragraph acknowledges this — formalize it

**SSRM Ownership:**
- Primary: AIC
- Agent Owner accountable: yes

---

### L7-T02 — Credential Theft and Replay (Signing Identity)

**MAESTRO Layer:** L7: Identity and Autonomy (Domain 3, Horizontal)

**Current Evidence:**
- Signing uses Cosign keyless (Fulcio + Rekor) with GitLab OIDC `SIGSTORE_ID_TOKEN`
- Tokens are short-lived, scoped per-job via GitLab `id_tokens:` block
- `signature-verification` validates signatures against `MODEL_SIGNING_IDENTITY` and `SIGSTORE_OIDC_ISSUER`
- **However:** `signature-verification` has not yet run on a protected-main ref — `gaips:model.verified` is honestly reported as `false`/deferred
- Vault OIDC auth is configured but unvalidated
- `GITLAB_PUSH_TOKEN` (PAT with `write_repository` scope) is used for drift-reference commits

**Assessment Status:** Partially Answerable

**Attack Vector:**
1. **Pre-verification window:** Until `signature-verification` runs on a protected-main ref, the pipeline signs artifacts but does not verify them. The `sign-evidence` manifest honestly records `model.verified: false`. An attacker who compromises the signing identity during this window produces artifacts that are signed but carry an unverified signature.
2. **PAT exposure:** `GITLAB_PUSH_TOKEN` has `write_repository` scope. If leaked, an attacker can push commits to the repo (including modifying `model-baseline.json` or `.gitlab-ci.yml`).

**Unknowns / Missing Evidence:**
- Whether the `GITLAB_PUSH_TOKEN` is a fine-grained PAT scoped to this repo only
- Whether Rekor transparency log entries are monitored for unexpected signing events

**Likelihood / Impact / Risk:**
- Likelihood: Low — Sigstore keyless with short-lived tokens is a strong design; PAT exposure requires a separate breach
- Impact: High — a compromised signing identity produces trusted-looking artifacts
- Risk: **Medium**

**Recommended Mitigations:**
- Complete the first protected-main run to close the verification gap
- Scope `GITLAB_PUSH_TOKEN` to the minimum required (single repo, no admin)
- Monitor Rekor for signing events from unexpected identities
- The honest `model.verified: false` reporting is the right transparency control for the current state

**SSRM Ownership:**
- Primary: AIC (signing identity management, PAT scoping)
- Shared: CSP (GitLab OIDC token issuance)
- Agent Owner accountable: yes

---

### L9-T01 — Monitoring Blind Spots (Point-in-Time Only)

**MAESTRO Layer:** L9: Monitoring and Observability (Domain 3, Horizontal)

**Current Evidence:**
- The README explicitly states: "this monitoring is point-in-time, per pipeline run"
- Dependency vulnerability scanning re-evaluates only when a pipeline runs
- "A CVE disclosed against an already-shipped component is not caught until the next run touches it"
- Continuous SBOM re-analysis (e.g., Dependency-Track) was removed as "operationally heavier"
- Evidently drift is vacuous on the current fixture (self-compares → "no drift" forever)

**Assessment Status:** Answerable

**Attack Vector:** A CVE is disclosed against a dependency already present in a deployed artifact. Because there is no continuous monitoring of published SBOMs against new advisories, the vulnerability exists in production until the next pipeline run (which may be days or weeks later). The README acknowledges this gap and frames it as out of scope.

**Cross-Layer Impact:** L8 (known-vulnerable components in production), L10 (compliance drift between runs)

**Likelihood / Impact / Risk:**
- Likelihood: High — CVE disclosure cadence is continuous; pipeline runs are not
- Impact: Medium — mitigated by the fact that this is a demo pipeline with no production deployment
- Risk: **Medium** (production context would be **High**)

**Recommended Mitigations:**
- For production: re-introduce SBOM-against-advisory continuous monitoring (Dependency-Track, Grype scheduled scans, or GitHub Dependabot on the published BOM)
- The README's explicit acknowledgment of this gap is the correct governance posture for a demo
- Evidently drift becomes meaningful only with a representative reference corpus; the README documents this honestly

**SSRM Ownership:**
- Primary: AIC
- Agent Owner accountable: yes

---

### L10-T05 — Audit Trail Gaps (Evidence Retention and Completeness)

**MAESTRO Layer:** L10: Governance, Authority, and Compliance (Domain 3, Horizontal)

**Current Evidence:**
- Evidence retention is 90 days for critical artifacts (AI-BOM, signatures, evidence summary, sign-evidence)
- Scan reports retain for 7 days only
- `sign-evidence` produces a SHA-256 hash manifest over the entire run's evidence
- `evidence-summary` reads verdicts with 3-state pass/fail/inert logic
- The AI-BOM embeds Cosign signatures, vulnerabilities, and provenance

**Reasonable Inferences:**
- After 7 days, individual scan reports (Semgrep, pip-audit, Grype, Trivy, ModelScan, ModelAudit) are unavailable — only the evidence summary and AI-BOM remain
- The `sign-evidence` hash manifest can prove the reports existed and were unmodified, but cannot reproduce their contents after expiry
- 90-day retention does not satisfy the EU AI Act's 10-year retention mandate (if applicable)

**Assessment Status:** Answerable

**Attack Vector:** An auditor requests the detailed Grype vulnerability report from a run 30 days ago. The report expired after 7 days. The evidence summary records the verdict, and the sign-evidence manifest proves the report's hash, but the report itself is gone. The audit trail is provably complete but not provably *reproducible*.

**Cross-Layer Impact:** L8 (cannot re-examine scan details after expiry), L10 (regulatory retention requirements not met for detailed artifacts)

**Likelihood / Impact / Risk:**
- Likelihood: High — 7-day retention is short; audit requests commonly exceed this window
- Impact: Low (demo context) / Medium (production with regulatory obligations)
- Risk: **Low**

**Recommended Mitigations:**
- Extend scan report retention to at least 90 days (matching the evidence artifacts)
- For EU AI Act compliance: implement 10-year retention for AI-BOM and evidence artifacts (archive to S3/GCS with lifecycle policies)
- The sign-evidence hash manifest is a strong compensating control — it proves what existed even after expiry

**SSRM Ownership:**
- Primary: AIC (non-delegable)
- Agent Owner accountable: yes

---

## 9. Cross-Layer Path Analysis

**Path 1: CI Tool Image Compromise → Silent Control Bypass**
`L1 (compromised tool image) → L6 (scanner produces false negatives) → L8 (malicious artifact passes all gates) → L7 (artifact receives valid Cosign signature) → L5 (signed malicious artifact published to deploy target)`

The pipeline's integrity depends on the integrity of its tool images. If a scanner image is compromised, every downstream finding, evidence artifact, and signature is trustworthy-looking but built on false data. Digest pinning mitigates tag-mutation but not initial-compromise-before-pin.

**Path 2: Baseline Tampering → Trusted Malicious Artifacts**
`L10 (model-baseline.json modified) → L2 (different model accepted as approved) → L7 (new model signed with valid identity) → L5 (published as legitimate)`

Write access to `model-baseline.json` or `dataset-baseline.json` redefines what the pipeline considers "approved." All downstream integrity checks verify against the new baseline. This is mitigated by GitLab protected branches and MR review requirements — but those controls are outside the pipeline's own scope.

**Path 3: Teeth-Last Gap → Unblocked Vulnerable Release**
`L6 (advisory-only gate) → L8 (finding recorded but not blocking) → L9 (evidence summary shows finding) → L10 (AI-BOM contains vulnerability) → L5 (pipeline exits green, artifact published)`

This is not an attack — it's the designed behavior during the hardening phase. The risk is that "green pipeline" is interpreted as "all controls passed" when it actually means "all *enforced* controls passed; advisory controls may have findings."

## 10. SSRM Ownership Summary

| Threat ID | Threat | Primary Owner | Shared | AIC Accountable |
| --- | --- | --- | --- | --- |
| L1-T01 | CI tool image compromise | AIC | CSP, Tool Provider | Yes |
| L2-T04 | Model supply-chain (fixture) | AIC | MP (Hugging Face) | Yes |
| L3-T01 | Dataset poisoning (redaction gaps) | AIC | — | Yes |
| L5-T06 | Unvalidated deploy-time controls | AIC | CSP | Yes |
| L6-T03 | Teeth-last enforcement gap | AIC | — | Yes |
| L7-T02 | Signing identity (pre-verification) | AIC | CSP (GitLab OIDC) | Yes |
| L9-T01 | Point-in-time monitoring | AIC | — | Yes |
| L10-T05 | Evidence retention gaps | AIC | — | Yes |

All findings are AIC-primary. This is consistent with a self-built, self-operated pipeline (AaI deployment model).

## 11. Framework Crosswalk

Not requested. Available on request. Note: the README already contains a detailed control alignment section mapping to CSA AICM, NIST SP 800-53, NIST AI RMF, ISO 42001, and ISO 27002 — a crosswalk would largely validate or refine that existing mapping.

## 12. Required Validation Steps

1. **Complete the first protected-main CI run** on the standalone repo to close `signature-verification`, `secure-software-scan`, and digest-pull gaps
2. **Inspect `.gitlab-ci.yml` source** to verify README descriptions match actual job definitions
3. **Validate deploy-time controls** with a real Kubernetes cluster (Kyverno `Enforce`, ArgoCD PreSync)
4. **Validate Vault integration** with a real Vault instance
5. **Test Presidio import failure** to confirm degradation behavior matches documentation
6. **Confirm `GITLAB_PUSH_TOKEN` scope** (single repo, minimal permissions)
7. **Verify model baseline provenance** — document how the initial SHA-256 pin was established

## 13. Conclusion: What Can and Cannot Be Concluded

**What can be concluded:** This is a remarkably well-documented and thoughtfully designed ML security pipeline. The standout governance feature is the **explicit honest gap accounting** — the Validation Status section, the teeth-last enforcement model documentation, the vacuous-drift acknowledgment, and the `model.verified: false` transparency are all examples of security engineering that values accuracy over appearance. Most pipeline projects claim their controls work; this one documents exactly which ones have proven themselves and which haven't.

The threat surface is narrow for a demo repo. The eight findings are mostly about the gap between "designed" and "validated" — which the README itself acknowledges. The most operationally relevant findings for production are: the Presidio open-degradation behavior (L3-T01), the script-default footgun for `REDACT_MAX_SECRETS` (L3-T01), and the 7-day scan report retention (L10-T05).

**What cannot be concluded:** Whether the deploy-time verification chain works. The pipeline's sign→verify loop is architecturally sound but has never executed end-to-end. The Kyverno, ArgoCD, Vault, and `image-sign` components are YAML that has never been applied to a real cluster. The assessment cannot validate these controls — only the infrastructure they target can.
