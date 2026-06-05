# Platform Roadmap — EU AI Act–Aligned Agent Orchestration Platform on AWS

> **Status:** planning document. No code commitments. Counter-Spy.ai is referenced as the foundation for several early phases; the platform itself is a larger, multi-service distributed system.
>
> **Source caveat:** The source plan this document derives from truncates mid-sentence at section 7.1 step 4 ("capability") with no 7.2–7.4. Phase 7 covers what's stated plus reasonable inferences; confirm scope before building.

---

## What Counter-Spy.ai already gives this platform

| Platform capability | Where Counter-Spy covers it today | Gap |
| :--- | :--- | :--- |
| Audit spine (Phase 1) | Postgres-backed audit log store + `/v1/audit-logs` (`d374f90`/`2b30215`) | Needs hash-chaining + S3 Object Lock export, multi-tenant schema |
| Secrets (Phase 1) | AWS Secrets Manager wired in prod per CLAUDE.md | Needs short-lived creds + rotation enforcement |
| Ingress kernel (Phase 1) | Gateway container (`cb59ecf`) | Needs JWT/OIDC, tenant extraction, rate limiting, WAF |
| Safeguard kernel (Phase 2) | `backend/src/security/sanitizer.ts` is the Shield | Extract into `safeguard-service`; add ML scoring + quarantine pipeline |
| Console seed (Phase 5) | SSR analyst console (`backend/src/web/ssr.ts`) | Extend with approval, intervention, FRIA, classification UIs |

Everything else is net-new. Multi-tenancy in particular is not in Counter-Spy today and will reshape every existing module.

---

## Core AWS architecture decisions to lock

| Decision | Recommendation | Alternative |
| :--- | :--- | :--- |
| Compute | **EKS** (need k8s for OPA sidecars, service mesh, SPIFFE) | ECS Fargate is simpler but you outgrow it by Phase 6 |
| Orchestrator state machine | **AWS Step Functions** (Phase 3 MVP) | **Temporal on EKS** if you need long-running, signal-driven workflows by Phase 7 |
| Event bus | **EventBridge + SQS fanout** | MSK (Kafka) if replay-able streams needed; ElastiCache Redis Streams for low-latency hot paths |
| Audit immutability | **Postgres hash-chain → nightly export to S3 Object Lock (Compliance mode) + Glacier** | QLDB is deprecating; avoid |
| Identity | **Cognito** for end-user; **IRSA + Private CA + SPIFFE/SPIRE** for workload mTLS | Auth0/Okta federation in front of Cognito |
| Policy | **OPA sidecars, bundles in S3** | Cedar via Verified Permissions for fine-grained authz |
| Observability | **ADOT → AMP + AMG + X-Ray**, logs to CloudWatch + S3 archive | Self-hosted Tempo/Loki on EKS |
| Drift / ML monitoring | **SageMaker Model Monitor** + custom prompt-drift via Bedrock evals | Roll-your-own statistical drift in EKS |

---

## Cross-phase ground rules

- Multi-tenancy, OTel tracing, structured logging, signed audit events, schema-registry-validated payloads, and deny-by-default policy enforcement are baked in from Phase 1. Retrofitting any of these is expensive.
- Each phase ends with a vertical demo: a request flows end-to-end through the planes built so far and produces a signed audit bundle.
- Every service ships with contract tests, policy tests, OTel traces, a runbook, and a rollback plan.
- One ADR per major decision, kept in `docs/adr/`.

---

## Phase 0 — Foundations (4–6 wks, 2 eng)

**Goal:** standards, tooling, dev cluster, observability spine — before any product service.
**Prereqs:** AWS organization with dev / staging / prod / audit accounts.

### A. Repo + standards
1. Set up monorepo (Nx or Turborepo). Counter-Spy becomes `apps/gateway`; new services land under `apps/`.
2. Create `packages/platform-sdk`: event envelope types, OTel init, structured logger, tenant-context propagator, audit emitter.
3. Define schema registry: protobuf in `schemas/`, codegen to TS/Go/Python in CI.
4. Adopt ADR template. First ADRs: tenant model, orchestration choice, audit immutability strategy.

### B. AWS scaffolding
5. Bootstrap accounts via Control Tower + IaC (pick CDK or Terraform — stick with it).
6. Per-account VPCs (3 AZs, private/public subnets, NAT, VPC endpoints for S3/ECR/Secrets Manager).
7. Central ECR in shared-services account with replication to env accounts.
8. CloudTrail org-wide → S3 Object Lock bucket in audit account.

### C. EKS cluster (dev)
9. Provision EKS via IaC; IRSA, EBS CSI, Container Insights on.
10. Cluster baseline: external-secrets, cert-manager, AWS Load Balancer Controller, Kyverno, ADOT, ArgoCD.
11. Wire ArgoCD to GitHub via app-of-apps.

### D. CI/CD
12. GitHub Actions: lint, type-check, schema-validate, unit tests on PR.
13. Build pipeline: container → Cosign sign → ECR push → Syft SBOM attached → Grype/Trivy scan with fail thresholds.
14. Kyverno `verifyImages` to enforce signed-image-only on cluster.

### E. Observability
15. AMP + AMG workspaces; X-Ray on.
16. ADOT fan-out: traces → X-Ray, metrics → AMP, logs → CloudWatch + S3 archive.
17. Baseline Grafana dashboards: per-service RED, SLO scaffolding.

### F. Validation
18. Ship a no-op `hello-service` through the full pipeline; verify traces/metrics/logs/signed audit event.

**Exit:** new service → PR → deployed to dev → fully observable.

---

## Phase 1 — Ingress, Identity, Audit Spine (6–8 wks, 3 eng)

**Goal:** every request authenticated, tenant-scoped, signed in audit.

### A. Identity
1. Cognito user pool per env; OIDC discovery; advanced security on.
2. ADR: tenant model. Recommendation: Cognito groups → `tenant_id` claim, Aurora RLS keyed on `tenant_id`.
3. Build `auth-service`: token exchange, refresh, federation hooks, API-key issuance/revocation (hashed in DynamoDB).
4. SDK helper to extract + validate auth + tenant on every request.

### B. Ingress
5. ALB + AWS WAF in front of EKS; managed rule sets + custom rules (rate, geo, prompt-injection signatures).
6. Envoy via Gateway API as cluster ingress.
7. `api-gateway` middleware chain: request-ID → JWT validate → tenant extract → schema validate → PII pre-scan → audit emit → route.
8. ElastiCache Redis for rate-limit buckets; per-tenant quotas in DynamoDB.

### C. Workload identity + mTLS
9. AWS Private CA hierarchy; cert-manager issuer wired to it.
10. SPIRE on EKS; SPIFFE IDs bound to service accounts via IRSA.
11. mTLS east-west via Istio (or App Mesh — ADR).

### D. Audit DB (extend Counter-Spy's store)
12. Migrate Counter-Spy's `audit_logs` into shared `audit` schema in Aurora PostgreSQL Serverless v2 (multi-AZ, PITR).
13. Add columns: `tenant_id, correlation_id, trace_id, signing_key_id, hash_prev, hash_self`.
14. Hash-chain on insert (trigger or app-side); `verify-chain` CLI for ops.
15. Nightly export → S3 Object Lock (Compliance mode, 7-year) → Glacier at 90 days.
16. `/v1/audit-logs/verify` walks the chain and reports breaks.

### E. Network
17. Default-deny NetworkPolicies per namespace; explicit allowlists per service.
18. VPC endpoints for every AWS service used; remove NAT egress for service workloads.
19. Istio egress gateway with FQDN allowlist (Bedrock, Secrets Manager, S3, CloudWatch initially).

### F. Validation
20. E2E: unauth request rejected at ALB; tenant A cannot see tenant B; audit chain verifies clean over 24h soak.

**Exit:** tamper-evident audit trail + cross-tenant isolation proven.

---

## Phase 2 — Policy + Safeguard MVP (6–8 wks, 3 eng)

**Goal:** deny-by-default; Counter-Spy sanitizer extracted into `safeguard-service`.

### A. Policy service
1. OPA as sidecar to every service; central `policy-bundle-builder` ships bundles to S3.
2. Bundle layout: `global/*.rego` + `tenant/{tenant_id}/*.rego`; versioned + signed.
3. Signed decision envelope (decision + inputs hash + policy version + key id) → audit.
4. Simulation mode: replay last N decisions against new bundle before promotion.
5. Wire `policy-service` as the gate for every future orchestrator state transition.

### B. Safeguard service (extract Counter-Spy sanitizer)
6. Refactor `backend/src/security/sanitizer.ts` into `apps/safeguard-service` (TS first; Go/Rust rewrite is later optimization).
7. `POST /v1/safeguard/scan` contract; Counter-Spy gateway's `/v1/analyze*` proxies to it.
8. Add ML scoring stage: Bedrock Guardrails for prompt-injection + content mod, called in parallel with deterministic engine.
9. Verdict schema: `allow | suspicious | adversarial | quarantine` + reasons + scores + redaction map.
10. Quarantine pipeline: SQS quarantine queue + DLQ; payloads encrypted in S3 with restricted IAM.

### C. Cross-cutting
11. Codify decision + verdict schemas in `schemas/`; auto-generate clients.
12. Replay test harness: adversarial-prompt corpus → both engines → assert verdicts; runs in CI.
13. CloudWatch alarms: quarantine rate, safeguard p99, denial rate.

### D. Validation
14. Soak 1M synthetic + replay corpus through safeguard; zero regressions vs. current sanitizer.

**Exit:** every request gets signed policy decision + signed safeguard verdict; both CI-regressed.

---

## Phase 3 — Orchestrator + Approvals MVP (8–10 wks, 4 eng)

**Goal:** governed execution lifecycle with HITL.

### A. Runtime choice (ADR)
1. Step Functions vs Temporal. Recommendation: Step Functions for MVP (faster, AWS-native, `waitForTaskToken` for approvals); reconsider at Phase 7.

### B. Orchestrator
2. Execution record (Aurora): `id, tenant_id, state, policy_decision_id, safeguard_verdict_id, parent_execution_id, transitions[]`.
3. State machine: `pending → policy_review → awaiting_approval? → queued → executing → completed/failed/quarantined/compensated`.
4. Step Functions definitions per execution type; every transition emits signed audit event.
5. Compensation framework: per-step hooks registered at start; failure runs reverse-order compensation.
6. EventBridge bus for lifecycle events; SQS subscriptions for consumers.

### C. Approval service
7. Schema: `approvals, approval_actions, approval_policies, approval_escalations, approval_evidence`.
8. Policy DSL (Rego): "executions of type X with risk Y require N approvers from group Z within T minutes."
9. APIs: `request`, `grant`, `deny`, `pending`.
10. Step Functions integration via `waitForTaskToken`; grant resumes machine.
11. Timeout + escalation: SQS delay queues for timeout; escalation policies widen approver groups.
12. Emergency override: break-glass MFA + post-hoc justification + 100% audit highlight.

### D. Approval UI (extend Counter-Spy console)
13. New `/approvals` route: pending list, decision drawer with required rationale, history.
14. Real-time updates via SSE.

### E. Validation
15. E2E: tenant submits high-risk → policy review → approval → analyst approves with rationale → Step Function resumes → execution runs → replay reconstructs full timeline.

**Exit:** regulator-defensible "who approved what, when, why" for every gated execution.

---

## Phase 4 — Classification + Transparency + Deployment Gating (6–8 wks, 3 eng)

### A. Classification service
1. Schema (Aurora): `ai_systems, classifications, classification_reviews, legal_obligations, deployment_restrictions`.
2. Rules engine: YAML mapping intended-use + data-class + capability → EU AI Act tier (prohibited/high/limited/minimal).
3. Risk scoring: weighted features (sensitivity, autonomy, decision impact, population) → banded.
4. Workflow API: start → HITL review when in ambiguity band → approve/reject; signed artifact in S3 Object Lock.
5. Wire classification id as input to `policy-service`; high-risk attracts stricter policies automatically.

### B. Transparency service
6. Model card schema (Croissant-aligned); versioned per model release.
7. Disclosure renderer: HTML + JSON; embeddable in console + exportable.
8. Content-labeling hooks: outputs in `executing` state pass through transparency service for provenance metadata (C2PA-style where applicable).

### C. Deployment gating
9. ArgoCD pre-sync hook calls a light conformity precheck: requires valid classification + transparency bundle.
10. GitHub Actions gate fails PR if a touched model/agent lacks a signed classification.
11. Kyverno: pods with `model-id` label must carry an annotation pointing to a valid classification artifact.

### D. Validation
12. Attempt to deploy unclassified model → blocked at CI, ArgoCD, and admission; classify → deploys clean.

**Exit:** no AI system reaches users without a regulator-exportable classification + transparency bundle.

---

## Phase 5 — Human Oversight + FRIA (6–8 wks, 3 eng)

### A. Oversight service
1. Runtime controls: `pause`, `terminate`, `override`; each requires rationale + tenant auth.
2. Step Functions integration: pause injects wait state; terminate cancels + runs compensation; override signals to bypass next policy gate (high-audit).
3. Operator action audit: operator id, timestamp, scope, rationale, affected execution ids.

### B. Intervention console (extend Counter-Spy console)
4. Execution timeline view: per-execution swimlane (state transitions, policy decisions, safeguard verdicts, approvals).
5. Delegation graph view (placeholder; Phase 7 fills it).
6. Intervention drawer: pause/terminate/override with rationale capture, SSE broadcast.
7. Checkpoint enforcement: long-running executions surface "approval refresh required after T hours."

### C. FRIA service
8. Schema (Aurora): `frias, fria_evidence, fria_reviews, fria_signoffs`.
9. Workflow API: start → evidence upload (S3 Object Lock) → bias-test ingestion → reviewer assignments → legal signoff → approve.
10. Template library: per-use-case templates with required-evidence checklists.
11. Expiration scheduler (EventBridge cron): auto-flag FRIAs at 11 months; deployment gate blocks expired.
12. Integrations: Jira webhook for review tasks; SES email + Slack notifications.

### D. Validation
13. Drill: analyst pauses runaway execution within 60s; FRIA expiration blocks a deploy; legal signoff E2E.

**Exit:** complete oversight + rights-impact paper trail for every high-risk system.

---

## Phase 6 — MCP Governance (4–6 wks, 2 eng)

### A. MCP gateway
1. Manifest schema: tool name, version, owner, allowed actions, required approvals, max payload, network access, data classifications, output sensitivity.
2. Registration API: `POST /v1/mcp/register` → manifest validate → security review workflow → approval → activation.
3. Runtime enforcement: every invocation passes through gateway → validates manifest, tenant boundary, policy decision, timeout, output safeguard scan.
4. Quarantine on unsafe output: blocked + alert + audit highlight.

### B. Storage + ops
5. Manifests in DynamoDB (high read); history in S3 Object Lock.
6. Per-MCP dashboards: invocation rate, latency, quarantine rate.
7. Capability revocation API: instant disable + reason; in-flight invocations terminate; alert fanout.

### C. Validation
8. Register test MCP; invoke; attempt manifest privilege escalation (new domain) — rejected; revoke mid-invocation — terminates cleanly.

**Exit:** MCP tools are governed citizens with audit + revocation.

---

## Phase 7 — A2A + Runtime Agent Governance (6–8 wks, 4 eng)

> Source plan truncates here; confirm 7.2–7.4 scope first.

### A. A2A coordinator
1. Delegation envelope: `parent_execution_id, child_execution_id, capability_grant (subset of parent's), inherited_approvals, depth, tenant_id`.
2. Delegation depth cap (per-tenant, default 5); cycle detection on delegation graph in Aurora.
3. Tenant-boundary enforcement: cross-tenant delegation requires explicit policy + double approval.
4. Approval inheritance: child inherits unless `capability_grant` exceeds approved scope (then re-approval required).

### B. Runtime governance
5. Max-duration enforcer: Step Functions heartbeat + Lambda watchdog; expired = force-terminate.
6. Bounded action space: per-execution action-count budget; exceed → quarantine.
7. Capability revocation propagation: parent revoke cascades to all live children.
8. Anomaly pipeline: Kinesis Data Streams from orchestrator events → Managed Flink → loop detection, privilege escalation, token-spend deviation, delegation fan-out outliers.
9. Mitigation: warn → pause → terminate, driven by score thresholds.

### C. Validation
10. Adversarial test: infinite delegation loop → detect + terminate within 30s; cross-tenant access attempt → signed denial.

**Exit:** escaping/runaway agents detected and mitigated within SLO.

---

## Phase 8 — Conformity + Post-Market Monitoring (6–8 wks, 3 eng)

### A. Conformity service
1. Evidence checklist DSL: per-tier required evidence (classification, FRIA, safeguard tests, security review, model eval, monitoring, rollback, IR config).
2. Validation engine: per-deployment, fetch evidence, verify signatures + expirations, compute readiness score.
3. Signed conformity decision artifact in S3 Object Lock; referenced by ArgoCD pre-sync hook.
4. Override path: C-suite approval + post-hoc audit + auto-expire.

### B. Post-market monitoring
5. Telemetry pipeline: Kinesis Firehose → S3 (raw) + Aurora (aggregates).
6. SageMaker Model Monitor per deployed model: data quality, feature drift, model quality, bias drift.
7. Custom prompt-drift: rolling window comparison of prompt embeddings (Bedrock embed → vector store → cosine drift).
8. Complaint ingestion API + console form; auto-route to incident pipeline if severity ≥ threshold.
9. AMG dashboards: model performance, bias regression, safety incidents, drift, interventions, denial trends.

### C. Alerting
10. CloudWatch composite alarms → SNS → PagerDuty: drift, hallucination spike, override spike, denial surge, latency degradation.
11. Auto-escalation: 3 alarms in 1h on same model → auto-trigger FRIA review.

### D. Validation
12. Inject synthetic drift → Model Monitor detects → alarm pages → conformity status flips → console surfaces it.

**Exit:** ship is evidence-gated, run is drift-watched.

---

## Phase 9 — Technical Docs + Incident Reporting (4–6 wks, 2 eng)

### A. Documentation pipeline
1. EKS CronJob assembles per-system bundle: architecture (Mermaid from service registry), dependency graph, model inventory, deployment lineage (ArgoCD history), SBOM index (ECR), governance evidence index, API inventory (OpenAPI), risk summary.
2. PDF + Markdown rendering; Cosign-sign; store in S3 Object Lock.
3. `GET /v1/compliance/export?system_id=X` returns tar with bundles + verification instructions.

### B. Incident response
4. Detection sources: anomaly pipeline (P7), conformity flip events (P8), manual reports.
5. Severity classifier: rules-driven; severity dictates response timeline (regulator notification within 72h for serious incidents).
6. Evidence preservation: on open, snapshot related audit segment + executions + verdicts → S3 Object Lock incident bucket.
7. Timeline reconstruction tool: walk audit chain + EventBridge replay to produce minute-by-minute narrative.
8. Step Functions: detect → classify → preserve → notify (PagerDuty + legal + DPO) → assign → resolve → corrective actions → recurrence tracking.
9. Regulator report templates: pre-filled from incident record; legal reviews and submits.

### C. Validation
10. Tabletop: simulate serious incident; bundle within 1h; draft report for legal within 4h.

**Exit:** regulator-ready docs and incident response on demand.

---

## Phase 10 — Hardening + Compliance Ops (ongoing)

### A. Zero-trust completion
1. Istio (or App Mesh) cluster-wide; mTLS strict mode everywhere.
2. SPIFFE workload attestation for every service-to-service call; 1h SVIDs.
3. Egress via Istio egress gateway with explicit FQDN allowlist per service.
4. AWS PrivateLink for cross-account service calls; no public endpoints.

### B. Admission + runtime
5. Kyverno: PSS baseline+restricted, signed-images-only, no-root, network-policy required, resource limits required.
6. Falco + GuardDuty EKS Protection; alerts to SIEM.
7. Amazon Inspector continuous container scan; auto-PR fixes for high CVEs.

### C. DR + retention
8. AWS Backup: Aurora PITR + S3 cross-region replication for audit + evidence buckets.
9. Multi-region active/active: Aurora Global DB, EKS in second region, Route 53 health-check failover.
10. Quarterly DR drill: measure RPO/RTO, document gaps.
11. Retention Lambdas: legal-hold honor + tokenized-PII deletion where lawfully required.

### D. Continuous compliance
12. Annual external pen test; remediation tracked.
13. Quarterly compliance evidence dry-runs; gaps feed the roadmap.
14. AWS Audit Manager mapped to internal framework; ISO 42001 + EU AI Act control catalogs.

**Exit:** production-grade, audit-ready, regulator-defensible.

---

## Cost shape (single region, rough)

- **Phase 0–3 baseline** (dev + staging + prod): Aurora + EKS + ElastiCache + AMP/AMG/CloudWatch ≈ **$3–6k/mo** before traffic. Bedrock and SageMaker dominate variable cost from Phase 2 onward.
- **Phase 8+ adds**: SageMaker Model Monitor, cross-region replication, AWS Backup retention — plan another **$2–4k/mo** baseline.
- **Phase 10 multi-region active/active**: **2.0–2.3×** single-region.

---

## Cross-phase tracking

- One ADR per major decision (`docs/adr/`). Initial set:
  1. Tenant model (Cognito groups vs separate user pools; Aurora RLS vs schema-per-tenant vs cluster-per-tenant)
  2. Orchestration runtime (Step Functions vs Temporal)
  3. Audit immutability (Postgres hash-chain + S3 Object Lock vs ledger DB)
  4. Service mesh (Istio vs App Mesh vs Linkerd)
  5. Policy DSL (OPA only vs OPA + Cedar)
  6. IaC tool (CDK vs Terraform)
  7. Safeguard implementation language (TS vs Go/Rust)
  8. Drift detection (SageMaker Model Monitor vs custom)
  9. Documentation rendering (Mermaid in pipeline vs precommit)
  10. DR posture (active/passive vs active/active)
- **Per-phase exit review**: independent reviewer (not phase lead) verifies exit criteria before next phase starts.
- **Phase 4 + 5 can parallelize** across two squads once Phase 3 is stable.
- **Phases 6 → 7 sequential**: A2A reuses MCP runtime patterns.

---

## Known gaps in the source plan

- **Sections 7.2–7.4 missing.** Likely topics: A2A messaging schema, cycle/recursion enforcement, cross-tenant delegation rules. Confirm before Phase 7.
- **Classification risk inputs unspecified.** Workshop with legal before Phase 4.
- **Model evaluation harness unspecified** (referenced in Phase 8 conformity gates but not defined). Need before Phase 4.
- **Tenant model not decided.** Must be locked before Phase 0 ends — it shapes every downstream service.
