# 🔐 Secure GenAI CounterAgent Assistant (AWS + Adversarial AI Defense)

**This project demonstrates a secure, adversary-aware GenAI architecture aligned with MITRE ATLAS, CSA MAESTRO, and NIST AI RMF.**

## Overview

A production-minded reference implementation for a secure GenAI assistant for security operations.  
Combines **local inference for sensitive content**, **RAG for sanitized knowledge**, and **multi-layer adversarial defenses** to enable safe LLM usage while minimizing prompt injection, data leakage, and model abuse.

---

## Objectives

- Build a **secure AI assistant** for SOC analysts and security engineers.  
- Prevent **prompt injection, model extraction, and data exfiltration**.  
- Enforce **governance-aligned AI controls** and auditability.  
- Provide **traceable, citation-based responses** with section-level provenance.  
- Deliver a production-ready architecture with clear operational runbooks.

---

## Architecture Overview

**Flow**: User → API (FastAPI) → Lambda sanitization → RAG (OpenSearch) → Model routing (Ollama local / Bedrock) → Guardrails → Response → CloudWatch logs

**Key Components**
- **FastAPI** — Chat UI and API layer  
- **Lambda** — Input normalization, sanitization, adversarial detection  
- **OpenSearch Serverless** — Vector store and retrieval  
- **Ollama (local)** — Inference for sensitive internal queries  
- **AWS Bedrock** — Inference for general knowledge queries (optional)  
- **Terraform** — Infrastructure as Code  
- **ECR + EC2** — Containerized deployment for Ollama and services

---

## Security Architecture

### Multi-Layer Defense
| Layer | Controls |
|---|---|
| **Input** | Sanitization, entropy detection, regex-based secret removal |
| **Retrieval** | Metadata filtering, trust-tier enforcement, sanitized excerpts only |
| **Model** | Prompt guardrails, instruction constraints, local inference for sensitive data |
| **Output** | Redaction, verbatim leakage detection, citation enforcement |
| **Infrastructure** | VPC endpoints, IAM least privilege, Secrets Manager |
| **Operations** | Immutable logging, monitoring, escalation playbooks |

---

## Threat Model

Aligned to MITRE ATLAS and CSA MAESTRO in an AWS context. Primary threats:
- **Prompt Injection**  
- **Model Extraction**  
- **Data Leakage**  
- **RAG Poisoning**  
- **Privilege Escalation**

See `THREAT_MODEL.md` for detailed mappings and mitigations.

---

## Detection and Adversarial Signals

**Signals monitored**
- High-entropy payloads and encoded inputs  
- Repeated boundary probing and session anomalies  
- Large verbatim outputs and unusual token patterns  
- Obfuscated or concatenated prompts

**Detection layers**
1. **Input Layer** — Lambda normalization and pattern detection  
2. **Behavioral Layer** — Session risk scoring and repeated-query heuristics (phase 2+)  
3. **Output Layer** — Post-model filtering and leakage detection

---

## RAG and Data Governance

**Data Policy**
- **Never** send credentials, secrets, raw logs with PII, or detailed architecture diagrams to any external model.  
- **Conditional** documents require metadata tagging and sanitization before embedding.  
- **Allowed** content: sanitized runbooks, MITRE ATLAS mappings, security SOPs.

**Indexing Rules**
- Source-level metadata: `sensitivity`, `owner`, `last_updated`, `trust_tier`.  
- Embeddings: **sanitized excerpts only** for conditional content; **never** embed `never-embed` documents.

**Citation Model**
- Responses include **document name**, **section header**, **snippet excerpt**, and **metadata** (timestamp, source id).

---

## Model Strategy

| Query Type | Model |
|---|---|
| Sensitive internal queries | **Ollama** (local inference inside VPC) |
| General knowledge queries | **AWS Bedrock** (private endpoints where available) |

Routing rules enforce that sensitive-tagged content never leaves the local inference path.

---

## Project Plan Summary

**Duration**: 8–12 weeks  
**Phases**:
- **Phase 0 Planning and Prep** (week 0–1) — intake, RACI, infra skeleton  
- **Phase 1 Secure MVP Build** (week 2–4) — chat API, sanitization, local model, RAG index  
- **Phase 2 Detection and Guardrails** (week 4–6) — adversarial detectors, multi-layer guardrails, logging  
- **Phase 3 Pilot and Validation** (week 6–8) — 2–3 week pilot with 5–10 analysts, red-team testing  
- **Phase 4 Iterate and Harden** (week 8–12) — remediation, production IaC, runbooks

### Definition of Done per Phase
**Phase 0**
- Intake form completed; S3 paths validated; RACI confirmed.  
**Phase 1**
- Secure chat API deployed and accessible.  
- Input sanitization pipeline active and tested.  
- Ollama P95 latency ≤ 2.5s.  
- RAG citations meet ≥ 75% precision@k on validation set.  
- No sensitive data leaves local inference path.  
**Phase 2**
- Multi-layer guardrails active.  
- Adversarial detector passes internal suite ≥ 80% detection.  
- Logging and immutable audit trail validated.  
**Phase 3**
- Pilot KPIs meet fallback or target thresholds.  
- Red-team findings remediated or accepted with mitigation plan.  
**Phase 4**
- Production IaC and runbooks completed; operational handoff signed off.

---

## Security Gates

Progression between phases requires explicit checks and signoffs.

- **Phase 1 → Phase 2**
  - Secrets migrated to AWS Secrets Manager  
  - No public exposure of model ports  
  - IAM least privilege validated
- **Phase 2 → Phase 3**
  - Adversarial test suite ≥ 80% detection  
  - No critical data leakage observed  
  - Logging and audit trail validated
- **Phase 3 → Phase 4**
  - Pilot KPIs meet thresholds  
  - No unresolved high-risk findings  
  - Threat model reviewed and updated

Gate owners: **Infra Lead** for infra gates, **Security SME** for adversarial gates, **Architect** for final signoff.

---

## Adversarial Detection Architecture

**Input Layer (Lambda)**
- Normalization, HTML/script stripping, regex secret removal, entropy scoring.

**Behavioral Layer (Session)**
- Repeated-query detection, boundary probing heuristics, session risk scoring.

**Output Layer**
- Response filtering, verbatim leakage detection, citation cross-checks, redaction.

Detection outputs feed the audit trail and trigger escalation flags for human review.

---

## Failure Classification

| Failure Type | Severity | Example |
|---|---|---|
| False Negative | **Critical** | Successful injection or data leakage |
| False Positive | Medium | Legitimate query blocked |
| Model Failure | Medium | Model unavailable or high latency |
| RAG Failure | Low | Reduced retrieval relevance |

**Priority principle**: Prevent False Negatives > Manage False Positives.

---

## Testing and Red Teaming

**Adversarial tests**
- Prompt injection corpus, extraction attempts, jailbreak scenarios, RAG manipulation.

**Validation metrics**
- Prompt injection detection rate (target ≥ 85% for MVP)  
- False negative rate (target ≤ 5% for known patterns)  
- RAG precision@k (target ≥ 75%)  
- Response latency P95 ≤ 2.5s

Cadence: pre-MVP, pre-pilot, quarterly thereafter.

---

## Monitoring and Observability

**Metrics**
- Query volume, latency (P95), adversarial detection rate, RAG precision, error rates, escalation events.

**Logging**
- Fields: user id, role, sanitized prompt, retrieved doc ids, model id, response hash, detection flags.  
- Storage: AWS CloudWatch (60-day retention, immutable for MVP).

**Alerts**
- Injection detection spikes, model unavailability, RAG degradation, suspicious query patterns.

---

## Deployment

**Infrastructure**
- Terraform modules for VPC, IAM, EC2, ECR, Security Groups, OpenSearch.

**Deployment flow**
- Build Docker images → Push to ECR → Deploy to EC2/ECS → Start Ollama and API services.

**Secrets**
- Migrate from .env to AWS Secrets Manager; rotation every 60–90 days.

---

## Future Enhancements

- Knowledge Graph integration for ATLAS correlation and richer provenance.  
- Session-based adversarial risk scoring and automated playbook execution.  
- SIEM / SOAR integration for automated escalation and ticketing.  
- Private Bedrock endpoints for full VPC isolation.  
- Automated model evaluation and continuous RAG re-indexing.

---

## Author and Contacts

**Author**: Senior AWS Architect (project lead)  
**Initial Owners**: Architect / Infra Lead / Security SME (see `PROJECT_PLAN.md` for RACI)  
For intake and content submission use: `s3://secure-llm-rag/` and complete the prioritized intake form.

---

## Key Takeaway

Secure AI systems require **adversarial thinking**, **layered controls**, **strict data governance**, and **continuous validation**. This project provides a pragmatic, governance-aligned blueprint to safely operationalize GenAI for security operations.
