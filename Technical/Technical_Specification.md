# Technical Reference & Architecture Specification: Counter-Spy.ai

**Version:** v2.1  
**Status:** Beta / Promotion to Beta  
**Classification:** Proprietary / AppSec Engineering  

---

## 1. Architecture Deep Dive: The 'Shield-and-Sword' Pattern

Counter-Spy.ai employs a **Shield-and-Sword** architectural pattern to secure Large Language Model (LLM) interactions. This multi-stage defense-in-depth strategy ensures that adversarial payloads are neutralized at the edge before reaching high-compute inference engines.

### 1.1 Logical Flow
The system bifurcates the request lifecycle into two distinct phases:
1.  **The Shield (Local Sanitization & Governance):** A low-latency engine that performs heuristic analysis, PII redaction, and policy enforcement.
2.  **The Sword (Backend-Mediated Inference):** The backend gateway first calls an OpenAI-compatible safeguard judge, then forwards only `CLEAN` payloads to the downstream responder. Safeguard runtime configuration is separate from responder runtime configuration; each can use backend-managed credentials plus optional browser-local Base URL, Model ID, and memory-only API key overrides.
    *   **Current prompt-contract note:** The firewall prompt and guardrails policy are sent to the safeguard judge for inspection and forwarding decisions. The recommended visible Firewall Prompt includes baseline forbidden-category and gibberish/obfuscation guidance. The backend appends the JSON verdict contract outside the user-visible System Configuration prompt, and normalizes legacy firewall decisions when needed. The Downstream Responder Prompt from System Configuration is sent as the responder instruction only after clean traffic clears the safeguard judge.
    *   **Current forbidden-category note:** Operator-managed forbidden phrases are enforced locally and can supplement safeguard context, while the visible recommended Firewall Prompt remains the reviewable source for baseline category and gibberish guidance.

### 1.2 System Resilience & Fallback Policies
The Beta implementation adheres to a **Fail-Secure** philosophy across all critical components:

| Component | Failure Scenario | Policy | Outcome |
| :--- | :--- | :--- | :--- |
| **Shield Engine** | Timeout / 5xx Error | **Fail-Secure** | Request is blocked; user receives a 503 Service Unavailable. |
| **Governance Sync** | Database Connection Loss | **Best-Effort Sync** | The app keeps its current in-memory/default governance state. It does not automatically force `isGlobalPause: true` on startup or sync failure. |
| **Sanitization** | ReDoS / Logic Error | **Fail-Secure** | If sanitization latency exceeds 100ms, the triggering request is blocked before inference, logged as `Adversarial` with `ReDoS_ATTEMPT_DETECTED`, and automatic Global System Pause is activated for subsequent traffic. |

---

## 2. Heuristic Logic & Mathematical Intent

### 2.1 Shannon Entropy Sliding Window
To defeat **Token Dilution**, the system utilizes a **Sliding Window Shannon Entropy** calculation.
*   **Formula:** $H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i)$
*   **Intent:** By isolating high-entropy spikes (e.g., Base64 shellcode) in 35-character windows, the system identifies obfuscated payloads that would otherwise be averaged out in a global entropy check.

### 2.1.1 English-Likeness Heuristic
To catch alphabetic substitution gibberish that still resembles plain prose, the frontend sanitizer also applies a bounded English-likeness check.
*   **Signals:** low English trigram support after normalization, bounded Caesar-shift recovery improvement, high token uniqueness, and prose-like spacing.
*   **Intent:** Surface cipher-style concealment that entropy and syntactic heuristics alone may under-rate.
*   **Current Policy:** A hit is treated as an obfuscation-family signal and therefore classified as `Adversarial`.

### 2.1.2 Entropy Policy Bands
The current Beta uses one shared entropy policy across the submit-time firewall, Audit Logs, and Metrics.
*   **Allowed:** prompt entropy `<= 3.6`
*   **Suspicious:** prompt entropy `> 3.6` and `<= configured Entropy Threshold`
*   **Adversarial:** prompt entropy `> configured Entropy Threshold`
*   **Operator Meaning:** the governance slider now sets the maximum approved entropy before a prompt becomes adversarial; it no longer acts as the suspicious floor.

### 2.2 Syntactic Complexity Scoring
The analyzer uses a weighted heuristic to detect "Instruction Stacking":
*   **Constraint Density (High Weight):** Frequency of imperative keywords.
*   **Special Char Ratio (Medium Weight):** Inverse-match regex `/[a-zA-Z0-9\s]/g` to detect code-like syntax.
*   **Thresholds:** Scores > 50 contribute to `Suspicious` classification; scores > 90 independently trigger `Adversarial` classification.

### 2.3 Obfuscation Severity Policy
Counter-Spy.ai now treats prompt concealment itself as a hostile act in the governed path.
*   **Policy:** Any recognized obfuscation signal is classified as `Adversarial`, even if the concealed content would otherwise decode into something benign.
*   **Covered families:** URL encoding, HTML entities, unicode escapes, compatibility glyphs, symbol substitution, leetspeak, ROT13, reverse text, NATO phonetic, Morse code, braille, regional indicators, recursive decode chains, coordinate ciphers, structural wrappers, and low-English-likeness alphabetic gibberish.
*   **Routing rule:** Once the frontend sanitizer classifies a prompt as obfuscation-family `Adversarial` or otherwise locally `Suspicious`/`Adversarial`, that prompt should terminate before backend inference. Backend error messaging is reserved for prompts that were actually allowed to attempt `/v1/intercept`.
*   **Known coverage gap:** The present `VERTICAL_TEXT` family is still narrow and can miss some position-indexed or structured vertical layouts even though the overall policy treats such concealment as adversarial when recognized.

---

## 3. State Management & Persistence

### 3.1 Global Pause (HOTL) Persistence
The governance state is persisted in Firestore (`config/governance`). 
*   **Current runtime behavior:** The frontend initializes `isGlobalPause` to `false` and then overlays Firestore state when the governance document arrives. In local review mode the same state remains in memory only. Startup should not be treated as implicitly paused.

### 3.2 Audit Log Retention
*   **Policy:** By default, logs are intended to be permanent for forensic auditability.
*   **Cost Management:** The Beta supports **Firestore TTL (Time-to-Live)**. Administrators can designate a TTL policy field in the Google Cloud Console, enabling automatic purging of logs older than a defined retention period (e.g., 90 days).

> [!NOTE]
> **Forensic Gap Awareness**: Firestore audit logs are retained independently of any downstream provider-side abuse monitoring window. For incidents requiring cross-referencing provider-side request logs, forensic analysis must occur within that provider's retention window.

---

## 4. Security Mitigations

### 4.1 Anti-ReDoS Circuit Breaker
*   **Logic:** Every `sanitizeInput` execution is wrapped in a high-resolution timing block (`performance.now()`).
*   **Threshold:** 100ms.
*   **Policy:** Any sanitization pass completing above 100ms is treated as a potential ReDoS event. The triggering request is blocked before inference, logged as `Adversarial` with the `ReDoS_ATTEMPT_DETECTED` flag, and contributes to both the `ReDoS Trips` resilience metric and the Defense Funnel's pre-inference blocked count.

---

## 5. API Reference: `/v1/intercept`

### 5.1 Authentication
External services must authenticate with the Counter-Spy gateway using **Bearer Tokens (JWT)**. 
*   **Header:** `Authorization: Bearer <JWT_TOKEN>`
*   **Validation:** 
    *   **Provider:** Tokens are validated against the configured Auth Provider (Firebase/OIDC).
    *   **Claims:** Validation requires `sub` (subject), `aud` (audience), and `exp` (expiration).
    *   **Policy:** Tokens are validated per-request; no local caching of validation state is performed in the Beta to ensure immediate revocation propagation.
    *   **TTL:** Token lifespan and refresh cycles are governed by the Identity Provider's policy.
*   **Current Beta Note:** In dev, the backend can run without a bearer token. Outside dev, `INTERCEPT_BEARER_TOKEN` can be required before the gateway serves `/v1/intercept`.
*   **Future Support:** Integration with **AWS IAM SigV4** is planned for service-to-service communication within VPC environments.

### 5.2 Endpoint Specification
`POST /v1/intercept`

**Request Body (JSON):**
| Field | Type | Description |
| :--- | :--- | :--- |
| `prompt` | `string` | The raw input string to be sanitized. |
| `userId` | `string` | The unique identifier for the requesting user. |
| `sessionId` | `string` | The identifier for the current interaction session. |
| `metadata` | `object` | Optional key-value pairs, including browser-local safeguard Base URL, safeguard Model ID, memory-only safeguard API key override, responder provider, responder Base URL, responder Model ID, memory-only responder API key override, the active downstream responder prompt, and Sam Spade responder persona/scenario prompts for `ctf_chat` traffic. |

**Response Definitions:**
| Code | Status | Description |
| :--- | :--- | :--- |
| `200` | `CLEAN` | Payload passed local prechecks and the safeguard judge, and, when configured, includes downstream responder output plus responder telemetry. |
| `202` | `QUEUED` | Payload intercepted for HITL/HOTL review. |
| `401` | `UNAUTHORIZED` | Missing or invalid Bearer Token. |
| `403` | `INTERCEPTED` | Local precheck or safeguard judge blocked payload (Adversarial/Suspicious). This is a governed result with a structured intercept payload, not a backend transport failure. |
| `502` | `SAFEGUARD_OR_RESPONDER_ERROR` | Fail-closed block because the safeguard judge or downstream responder could not complete. |
| `503` | `SHIELD_ERROR` | Fail-Secure block due to Shield Engine timeout/failure. |

Downstream responder outputs are output-sanitized before display. Safeguard telemetry and responder telemetry such as provider, model ID, status, latency, prompt hash, token usage, prompt profile, context utilization, and output-sanitization flags are normalized back into Counter-Spy.ai audit records.

### 5.3 Backend Safeguard Attribution Fields
The frontend carries structured backend outcome data from `/v1/intercept` into Audit Logs, local review state, and browser-local Playground/Bulk metrics:

| Field | Meaning |
| :--- | :--- |
| `backendGatewayStatus` | Gateway outcome: `CLEAN`, `INTERCEPTED`, `QUEUED`, or `SHIELD_ERROR`. |
| `backendSafeguardVerdict` | Safeguard judge verdict: `CLEAN`, `SUSPICIOUS`, or `ADVERSARIAL`. |
| `backendSafeguardReasoning` | Backend safeguard reasoning for review and operator context. |
| `backendReachedSafeguard` | True when local gates allowed the prompt to reach the backend safeguard judge. |

These fields prevent model/safeguard interventions from being misclassified as local sanitizer results. They are especially important for Bulk Ingest prompts that appear in Analyst Chat but are blocked by the backend safeguard judge after local sanitizer redaction.

---

## 6. Operational Controls: Telemetry Isolation

### 6.1 The `source` Field
The `source` field preserves provenance without hiding traffic from the primary analyst views.
*   **Metrics Isolation:** Records can distinguish `analyst_chat`, `playground`, `bulk_ingest`, and `ctf_chat` traffic while still remaining visible in the same operational surfaces.
*   **DPO Labeling:** Bulk-ingest records carry `batchId` and `expectedVerdict` metadata, allowing analysts to perform false-negative audits without losing the surrounding production-like context.
*   **Local Review Note:** In local review mode, Metrics now use the full in-memory audit set instead of truncating counts to the newest 50 records.

### 6.2 Metrics Architecture
The platform utilizes a real-time anomaly detection engine to monitor threat velocity.
*   **Statistical Baseline:** Calculates a rolling 24-hour mean ($\mu$) and standard deviation ($\sigma$) of threat events.
*   **Z-Score Calculation:** $Z = \frac{x - \mu}{\sigma}$.
*   **Alerting Thresholds:** 
    *   **Z > 2.0**: Triggers "Anomalous Activity" dashboard alerts.
    *   **Z > 5.0**: Triggers high-priority escalation via PagerDuty/Slack integrations.
*   **Implementation Details**: For detailed dashboard telemetry and SOPs, refer to the [Analyst & Administrator Operations Guide](../OPERATIONS_GUIDE.MD).
*   **Layered Defense Funnel:** The Metrics surface tracks pre-inference blocks, backend safeguard/model interventions, and post-model escapes. It uses `backendReachedSafeguard`, `backendGatewayStatus`, and `backendSafeguardVerdict` as structured layer attribution before falling back to older severity heuristics.
