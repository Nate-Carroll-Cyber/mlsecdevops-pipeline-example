## AI Bill of Materials (AI-BOM) — `mlsecdevops-pipeline-example`

**BOM Version:** 1.0
**Assessment Date:** 2026-07-06
**Revised:** 2026-09-19, corrected against commit `9dcf595` (see Revision Note at the end)
**Author:** AI-BOM Architect (automated)
**System Description:** An 11-stage GitLab CI/CD pipeline for ML model and dataset supply-chain assurance, producing signed CycloneDX 1.6 AI-BOMs, integrity-verified artifacts, and deploy-time verification materials.

---

### 1. Model Identity & Provenance

| Field | Value | Verification |
| --- | --- | --- |
| **Model Name** | Qwen 2.5-1.5B-Instruct-GGUF | ✅ Documented in `model-baseline.json` |
| **Model Provider** | Qwen (Alibaba Cloud), via Hugging Face Hub | Third-party open-weight model |
| **Model Version** | `qwen2.5-1.5b-instruct-q2_k.gguf` | Pinned to specific quantization variant in `evals/model-baseline.json` |
| **Model Architecture** | Transformer (Qwen 2.5 family, 1.5B parameters, Q2_K GGUF quantization) | Documented |
| **Model Weights** | Downloaded from Hugging Face, SHA-256 pinned | ✅ VERIFIED — `sha256sum --check --strict` against `MODEL_FIXTURE_SHA256` |
| **Weight Checksum (SHA-256)** | ✅ VERIFIED — pinned in `model-baseline.json` and verified every pipeline run | Pass |
| **Inference Parameters** | Used only for MarkLLM watermark evaluation (local CPU inference); not production inference | Documented as eval-only |
| **Model Signing** | ✅ Cosign keyless (Fulcio + Rekor) with GitLab OIDC identity | Signature generation proven; verification pending protected-main run |
| **Licensing** | Not recorded. `evals/model-baseline.json` has no `license` or `producer` field, so the AI-BOM model component carries `gaips:license.disclosure=UNKNOWN` | ❌ UNVERIFIED. Add both keys to the baseline |
| **Model Security Scanning** | ModelScan (excludes GGUF — 0 files scanned), ModelAudit (covers GGUF), ClamAV (malware) | ⚠️ ModelScan gap on GGUF explicitly documented |

**Finding:** Model provenance is strong. SHA-256 integrity pin, baseline manifest, and Cosign signing create a verifiable chain from download through publication. The one gap — ModelScan's GGUF exclusion — is compensated by ModelAudit + ClamAV and honestly documented. Signature verification has not yet executed on a protected-main ref (`model.verified: false`).

---

### 2. Data Lineage & Transparency

| Field | Value | Status |
| --- | --- | --- |
| **Dataset Name** | Lakera Gandalf Prompt Injection eval dataset | ✅ Documented |
| **Dataset Provider** | Lakera AI, via Hugging Face Hub | Third-party |
| **Dataset Purpose** | Evaluation fixture (prompt-injection classification); NOT training data | ✅ Documented |
| **Dataset Version** | Pinned to specific HF revision in `dataset-baseline.json` | ✅ Tracked |
| **Dataset Checksum (SHA-256)** | ✅ VERIFIED — pinned via `DATASET_EXPECTED_SHA256`, validated every run | Pass |
| **Dataset Signing** | ✅ Cosign keyless (separate signing identity from model) | Proven |
| **PII Status** | ✅ DISCLOSED — Presidio PII scan + Gitleaks secret scan in `redact_dataset.py` | Active control with caveats (see below) |
| **PII Redaction** | Gitleaks (secrets) + Presidio (PII entities) with configurable thresholds | ⚠️ Presidio import failure degrades open; script default for `REDACT_MAX_SECRETS` is `-1` (disabled) |
| **Synthetic Data** | Not applicable — eval dataset is human-curated prompt-injection samples | N/A |
| **Copyright Status** | License tracked in `dataset-baseline.json` | ✅ Documented |
| **Data Processing** | Download → ClamAV scan → Gitleaks + Presidio redaction → schema validation (Great Expectations) → profiling (YData) → Cosign signing | ✅ Full processing chain documented |
| **Data Retention** | Governed by GitLab artifact retention (90 days for signed artifacts, 7 days for scan reports) | ⚠️ No long-term retention policy |
| **Drift Monitoring** | Evidently statistical drift detection configured | ⚠️ Vacuous on current fixture (self-compares → "no drift" always) |

**Finding:** Dataset lineage is exceptionally well-documented — provenance, license, integrity pin, processing chain, and signing are all present. Two operational gaps: Presidio's open-degradation mode means PII redaction silently fails if the dependency breaks, and the script-level default for secret thresholds is permissive. The README documents both honestly.

---

### 3. Technical Dependencies & Integrity

#### 3.1 Python Dependencies

| Component | Version | Pinned | SHA-256 Hash | Status |
| --- | --- | --- | --- | --- |
| `requirements.txt` | Present | ✅ Versions pinned | Not hashed | ⚠️ Pinned but not hash-locked |
| `requirements.hashed.txt` | Present | ✅ Versions pinned | ✅ `--require-hashes` | ✅ VERIFIED |
| `pip-audit` | CI job | Scans against OSV database | N/A | ✅ Active vulnerability scanning |
| Lock drift detection | `pip-lock-drift` job | Compares installed vs. locked | N/A | ✅ Advisory (enforcement switchable via `LOCK_DRIFT_REQUIRE`) |

**Finding:** The dual requirements file strategy (`requirements.txt` for readability + `requirements.hashed.txt` for integrity) is a strong pattern. Hash-locked installs with `--require-hashes` satisfy CRA SBOM integrity requirements. Lock drift detection catches silent dependency changes but is advisory by default.

#### 3.2 CI Tool Images

| Tool | Image | Digest Pinned | Signature Verified | Status |
| --- | --- | --- | --- | --- |
| **Syft** (SBOM generation) | `anchore/syft` | ✅ | ❌ No keyless signature found | ⚠️ Digest-pinned only |
| **Grype** (vulnerability scan) | `anchore/grype` | ✅ | ❌ No keyless signature found | ⚠️ Digest-pinned only |
| **Trivy** (container/IaC scan) | `aquasec/trivy` | ✅ | ✅ Cosign verified | ✅ VERIFIED |
| **Semgrep** (SAST) | `semgrep/semgrep` | ✅ | ❌ No keyless signature found | ⚠️ Digest-pinned only |
| **ClamAV** (malware) | `clamav/clamav` | ✅ | ❌ No keyless signature found | ⚠️ Digest-pinned only |
| **Python** (pipeline base) | `python:3.11-slim` | ✅ | ❌ Not checked | ⚠️ Digest-pinned only |
| **Cosign** (signing) | `cgr.dev/chainguard/cosign` | ✅ | Chainguard image (high trust) | ✅ Trusted publisher |
| **ReversingLabs Spectra** | `reversinglabs/rl-scanner-cloud` | ✅ | ❌ Not checked | ⚠️ Digest-pinned only; job unvalidated |

**Finding:** All tool images are digest-pinned — this prevents tag-mutation attacks. Only Trivy has proven keyless signature verification. The `image-provenance-verify` job probes for signatures but reports rather than blocks when absent (`IMAGE_VERIFY_REQUIRE` is blank). This is the teeth-last model applied to infrastructure integrity.

#### 3.3 External Services

| Service | Purpose | Integrity Control | Status |
| --- | --- | --- | --- |
| **Hugging Face Hub** | Model and dataset download | SHA-256 checksum verification | ✅ |
| **Sigstore (Fulcio + Rekor)** | Keyless signing and transparency log | GitLab OIDC identity binding | ✅ Signing proven; verification pending |
| **GitLab Package Registry** | Signed artifact publication | Cosign signature attached | ✅ |
| **HashiCorp Vault** | Secrets management, OIDC JWT auth | Configured but unvalidated | ❌ VERIFICATION FAILURE — never executed |
| **ReversingLabs Cloud** | Malware / software assurance | API token auth | ❌ VERIFICATION FAILURE — never executed |

#### 3.4 EOL / Vulnerability Tracking

| Mechanism | Scope | Frequency | Status |
| --- | --- | --- | --- |
| `pip-audit` | Python dependencies | Per pipeline run | ✅ Active |
| Grype SBOM scan | Full SBOM (CycloneDX) | Per pipeline run | ✅ Active |
| Trivy filesystem scan | IaC, configs, container | Per pipeline run | ✅ Active |
| Continuous re-analysis | Published SBOMs against new CVEs | Not implemented | ❌ Point-in-time only |

**Finding:** Vulnerability scanning is comprehensive at pipeline-run time but point-in-time only. A CVE disclosed after a pipeline run is not caught until the next run. The README acknowledges this and frames Dependency-Track integration as a production enhancement.

---

### 4. Environment & Infrastructure

| Field | Value | Status |
| --- | --- | --- |
| **CI/CD Platform** | GitLab CI (`.gitlab-ci.yml`, 11 stages, 52 jobs in the committed CI file at `9dcf595`; the README counts 55, including three live-eval jobs that are documented but not present in that file) | ✅ Documented |
| **Deployment Target** | Kubernetes (manifests in `deployment/kubernetes/`) | Evidenced but unvalidated |
| **Admission Control** | Kyverno ClusterPolicy (signature verification) | ❌ Never executed |
| **GitOps** | ArgoCD PreSync hook (attestation verification) | ❌ Never executed |
| **Secrets Management** | HashiCorp Vault (OIDC JWT auth) + GitLab CI Variables fallback | ⚠️ Vault path unvalidated |
| **IaC** | Terraform (Vault configuration) | Evidenced in `deployment/vault/terraform/` |
| **Container Image Build** | Not present — pipeline produces no container image | N/A (the `image-sign` job is wired but inert) |
| **Hardware Requirements** | CPU-only (MarkLLM eval runs on CPU) | ✅ Documented |

---

### 5. Governance & Safety

| Requirement | Status | Detail |
| --- | --- | --- |
| **Risk Classification** | ⚠️ PARTIAL | Control alignment maps to frameworks but no formal risk classification against EU AI Act Annex III categories |
| **Algorithmic Discrimination** | Not applicable | Pipeline is a security control system, not a decision-making AI system |
| **Guardrails** | ✅ DOCUMENTED | Multi-layer scanning gates, `artifact-signing-gate` hard convergence, `ai-bom-content-gate` substance assertions; teeth-last enforcement model explicitly documented |
| **Human Oversight** | ✅ DESIGNED | GitLab MR review required for protected branches; pipeline produces evidence for human decision-making | 
| **System Limitations** | ✅ DOCUMENTED | "Validation Status & Known Gaps" section explicitly enumerates what works and what doesn't |
| **Impact Assessment (CO SB 24-205)** | Not performed | Pipeline itself is unlikely to be classified as a "high-risk AI system" |
| **Watermark Detection** | ✅ IMPLEMENTED | MarkLLM eval with KGW algorithm (advisory, not blocking) |
| **Content Safety** | Not applicable | Pipeline does not generate user-facing content |

---

### 6. AI-BOM Self-Referentiality

This pipeline **generates its own AI-BOM** (`ai-bom-assemble` → `ai-bom-validate` + `ai-bom-content-gate` → `ai-bom-sign`). The pipeline's CycloneDX 1.6 output includes:

| AI-BOM Field | Producing job(s) | Source |
| --- | --- | --- |
| Header (graph type, included and excluded scope, completeness claim, generation method) | `ai-bom-assemble` | `scripts/build_ai_bom.py` |
| Input ledger (`gaips:input.*` = present, skipped, absent, not-configured) | `ai-bom-assemble` | Presence of each producer report |
| `compositions[]` completeness claim | `ai-bom-assemble` | Derived from the input ledger |
| Model component | `model-digest`, `model-sign`, `hf-artifact-scan`, `modelscan`, `modelaudit-scan`, `clamav-scan` | `evidence/model-digests.txt`, scan reports, `evals/model-baseline.json` |
| Dataset component | `dataset-download`, `dataset-scan`, `dataset-redact`, `dataset-sign` | Reports plus `evals/dataset-baseline.json` |
| Software components and `dependencies[]` | `syft-cyclonedx` | `sbom/sbom.cyclonedx.json` |
| `vulnerabilities[]` with accepted-risk analysis, owner, and review date | `pip-audit`, `lockfile-audit`, `markllm-deps-audit`, `grype-scan`, `trivy-scan` | Audit reports |
| `services[]` with directed data flows and trust zones | `ai-bom-assemble` | Only services a report proves the run used (Hugging Face Hub, Sigstore, ReversingLabs, the live-eval endpoint) |
| Embedded model and dataset signatures | `model-sign`, `dataset-sign` | Sigstore keyless |
| The BOM's own signature | `ai-bom-sign` | Detached cosign keyless signature over the XML rendering |
| Content gate | `ai-bom-content-gate` | Asserts vulnerability coverage, model signing, declared scope and completeness, no absence rendered as a clean result, model identity fields, a rooted dependency graph, commit currency, and owned, unexpired accepted risks |

**Finding:** The pipeline is a BOM-generating system. This external AI-BOM assessment validates the *pipeline's own supply chain*, meaning the inputs, tools, and infrastructure that produce the BOM. The pipeline's self-generated AI-BOM covers one pipeline run. It excludes the deployed RAG application and Weaviate under `deployment/`, the CI tool images, and the runner, and it says so in `gaips:aibom.scope.excluded`. The self-generated BOM records fact. It does not assert that the system is compliant, safe, or acceptable.

**Known wiring gap:** `markllm-watermark-eval` and `signature-verification` are not in `ai-bom-assemble`'s `needs`, so their reports never reach the assembler. `gaips:model.verified` therefore reads `unknown` and the MarkLLM `modelCard` fold does not fire, regardless of what those jobs produce. The input ledger now reports both as `absent`.

---

### 7. Regulatory Compliance Mapping

| Regulation | Requirement | Status |
| --- | --- | --- |
| **EU AI Act Annex IV** | Technical documentation including training data, design choices, risk assessment | ✅ Model/dataset provenance documented; ⚠️ no formal risk classification |
| **EU AI Act Art. 53** | Transparency obligations for GPAI models | ⚠️ Model provider (Qwen/Alibaba) responsibility; pipeline documents usage context |
| **EU AI Act 10-year retention** | Maintain versioned change history | ❌ Current retention: 90 days (signed artifacts), 7 days (scan reports) |
| **CA AB 2013** | High-level summary of training data for GenAI systems | ✅ Dataset provenance, license, source, and processing chain documented in `dataset-baseline.json` and AI-BOM |
| **CO SB 24-205** | Risk assessment and disclosure for high-risk AI systems | ⚠️ Pipeline itself unlikely to qualify; downstream AI system would need its own assessment |
| **CRA (Cyber Resilience Act)** | SBOM for software with digital elements | ✅ CycloneDX 1.6 SBOM generated (Syft), vulnerability-enriched (Grype), hash-locked dependencies |

---

### 8. Verification Summary

| AI-BOM Section | Items Assessed | Verified | Partially Verified | Unverified | Failures |
| --- | --- | --- | --- | --- | --- |
| Model Provenance | 10 fields | 6 | 2 (signing proven, verification pending; ModelScan GGUF gap) | 1 (model licence and producer not recorded) | 0 |
| Data Lineage | 12 fields | 8 | 3 (PII redaction caveats, drift vacuous, retention short) | 0 | 0 |
| Python Dependencies | 4 mechanisms | 3 | 1 (lock drift advisory) | 0 | 0 |
| CI Tool Images | 8 images | 2 (Trivy, Cosign) | 6 (digest-pinned, no signature) | 0 | 0 |
| External Services | 5 services | 3 | 0 | 2 (Vault, ReversingLabs) | 0 |
| EOL/Vuln Tracking | 4 mechanisms | 3 | 0 | 0 | 1 (no continuous re-analysis) |
| Governance | 7 requirements | 4 | 2 | 0 | 0 |
| Regulatory | 6 regulations | 2 | 3 | 0 | 1 (10-year retention) |
| **Totals** | **56** | **31** | **17** | **3** | **2** |

**31 verified. 17 partially verified. 3 unverified. 2 failures.**

---

### 9. Prioritized Remediation

1. **Complete the first protected-main CI run** — closes signature verification, `secure-software-scan`, and multiple "pending" items; converts ~5 partial verifications to full
2. **Extend scan report retention** to at least 90 days (matching signed artifact retention); implement 10-year archival for EU AI Act if targeting regulated contexts
3. **Change `REDACT_MAX_SECRETS` script default** from `-1` to `0` — fail-closed by default, not just when CI variables override
4. **Fail closed on Presidio import failure** — or tag the dataset evidence as "PII-unredacted" so downstream consumers know
5. **Validate Vault and ReversingLabs integrations** — currently UNVERIFIED service dependencies
6. **Enable enforcement switches** incrementally: `IMAGE_VERIFY_REQUIRE`, `LOCK_DRIFT_REQUIRE`, `rl-fail-on`, `ai-bom-content-gate --enforce`
7. **Implement continuous SBOM re-analysis** — even a scheduled Grype scan against published BOMs closes the point-in-time gap
8. **Document initial model SHA-256 provenance** — how was the first pin established and verified?
9. **Record the model licence and producer** in `evals/model-baseline.json` (`license: {id}` and `producer`). The AI-BOM builder reads both
10. **Add `markllm-watermark-eval` and `signature-verification` to `ai-bom-assemble`'s `needs`** where the DAG allows, or the BOM can never report a verified model

---
This repo has 31 verified items and 2 failures. The difference is architectural: this pipeline was designed with supply-chain integrity as its primary purpose. The remaining gaps are almost entirely about execution evidence (first protected-main run) rather than design absences.

---

### Revision Note (2026-09-19)

Corrected against commit `9dcf595`. The original assessment date is retained because the findings that were not re-examined still date from it.

| Item | Was | Now | Basis |
| --- | --- | --- | --- |
| Model quantization | `q4_k_m` / Q4_K_M | `q2_k` / Q2_K | `evals/model-baseline.json` |
| Model licensing | Verified, "documented in `model-baseline.json`" | Unverified | That file has no licence or producer field |
| Deployment paths | `deploy/k8s/`, `deploy/vault/` | `deployment/kubernetes/`, `deployment/vault/terraform/` | Repository tree |
| Job count | 53 | 52 in the committed CI file | Parsed `.gitlab-ci.yml` |
| Section 6 job names | `sign-ai-bom`, `dataset-integrity`, `sbom-generate`, `vuln-scan-sbom` | `ai-bom-sign`, `dataset-download` and peers, `syft-cyclonedx`, `grype-scan` and peers | Parsed `.gitlab-ci.yml` |
| Section 6 content-gate description | "Asserts non-empty components, vulnerabilities, and properties" | Actual assertions listed | `scripts/assert_ai_bom_content.py` |
| Verification totals | 32 / 17 / 2 / 2 | 31 / 17 / 3 / 2 | Licensing row moved from verified to unverified |

Not re-verified in this revision: sections 2, 3, 5, and 7, and the image-signature findings in 3.2.
